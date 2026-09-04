import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { getAuthService } from '../auth/index.js';
import { AuthError } from '../auth/errors.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * GET /api/lots - open lots across all sellers.
 *
 * Public: the unified catalog is the default entry point for buyers, so it must
 * render before anyone signs in.
 */
async function listLots(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const sellerId = request.query.get('sellerId') ?? undefined;
  const lots = await repository.listLots(sellerId ? { sellerId } : {});
  return json(200, { lots });
}

/**
 * GET /api/lots/{sellerId}/{lotId}/manifest - the order manifest for one lot.
 *
 * Sellers see their own lots; admins see any. This is the first route to go
 * through `requireCapability`, and it exercises the ownership check that every
 * seller-scoped route will need - capability and ownership are separate
 * questions, and a seller-scoped route needs both.
 */
async function lotManifest(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell', 'admin']);

  const sellerId = request.params.sellerId;
  const lotId = request.params.lotId;
  if (!sellerId || !lotId) {
    return error(400, 'invalid_request', 'Both sellerId and lotId are required.');
  }

  // Capability alone is not authorisation: anyone may sell, so "can sell" says
  // nothing about whose lot this is. Admins are the only accounts that read
  // across owners.
  if (!user.capabilities.isAdmin && user.id !== sellerId) {
    throw AuthError.forbidden('You can only view manifests for your own lots.');
  }

  const repository = await getRepository();
  const lot = await repository.getLot(sellerId, lotId);
  if (!lot) return error(404, 'not_found', 'No such lot.');

  const orders = await repository.listOrdersForLot(lotId);

  return json(200, {
    lot,
    orders,
    totals: {
      lines: orders.length,
      units: orders.reduce((sum, order) => sum + order.quantity, 0),
      weightGrams: orders.reduce((sum, o) => sum + o.quantity * o.unitWeightGrams, 0),
      valueMinor: orders.reduce((sum, o) => sum + o.quantity * o.unitPriceMinor, 0),
    },
  });
}

export const listLotsRoute = handler(listLots);
export const lotManifestRoute = handler(lotManifest);

app.http('lots-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'lots',
  handler: listLotsRoute,
});

app.http('lots-manifest', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'lots/{sellerId}/{lotId}/manifest',
  handler: lotManifestRoute,
});
