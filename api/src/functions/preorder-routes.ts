import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Listing, Pledge } from '../../../shared/models.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { reconcilePreOrder, referrer, rosterOf } from './preorder.js';

/**
 * Joining a group-buy without paying for it yet.
 *
 * The rest of the pre-order lives on the listing: the threshold, the cutoff,
 * the count. What is here is the half that makes it a group - who is in it,
 * who brought them, and the free first step that gets the number off zero.
 */

/** The most one person can pledge, so one account cannot fill a campaign. */
const MAX_UNITS = 10;

type Repo = Awaited<ReturnType<typeof getRepository>>;

async function campaign(
  request: HttpRequest,
  repository: Repo,
): Promise<{ listing: Listing } | { refusal: ReturnType<typeof error> }> {
  const id = request.params.id;
  if (!id) return { refusal: error(400, 'invalid_request', 'A listing id is required.') };

  const listing = await repository.getListing(id);
  if (!listing) return { refusal: error(404, 'not_found', 'No such listing.') };
  if (!listing.preOrder) {
    return { refusal: error(409, 'not_a_preorder', 'This item is not being pre-ordered.') };
  }
  return { listing };
}

/**
 * GET /api/listings/{id}/preorder - the meter and everyone behind it.
 *
 * Public, because the whole point of showing a group is that somebody outside
 * it can see how close it is. A signed-out reader sees the counts and the
 * names of whoever chose to be named, and nothing that is theirs.
 */
async function read(request: HttpRequest, _context: InvocationContext) {
  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const viewer = await auth.getCurrentUser(request);

  const found = await campaign(request, repository);
  if ('refusal' in found) return found.refusal;

  const { listing, pledges, orders } = await reconcilePreOrder(repository, found.listing);
  return json(200, await rosterOf(repository, listing, pledges, orders, viewer?.id ?? null));
}

/**
 * POST /api/listings/{id}/pledge - "I'm in, if enough others are."
 *
 * A toggle, like the +Me button on the wanted board and for the same reason: a
 * commitment you cannot withdraw is one people think twice about making, and
 * thinking twice is exactly what keeps a bar at zero.
 *
 * It costs nothing and holds nothing. What it does is put a number on demand
 * that would otherwise be invisible, and give whoever is reading the card a
 * reason to believe the thing might actually happen.
 */
async function pledge(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await campaign(request, repository);
  if ('refusal' in found) return found.refusal;
  const listing = found.listing;

  if (listing.sellerId === user.id) {
    return error(400, 'own_listing', 'You cannot pledge for your own item.');
  }

  let body: { units?: number; listed?: boolean; via?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const preOrder = listing.preOrder!;
  if (preOrder.closedAt) return error(409, 'preorder_closed', 'That pre-order is over.');
  if (Date.parse(preOrder.cutoffAt) <= Date.now()) {
    return error(409, 'preorder_closed', 'Booking closed for this one.');
  }
  if (preOrder.filledAt) {
    // Once it has filled, the places are being paid for rather than promised.
    return error(409, 'preorder_filled', 'This one filled — book it rather than pledging.');
  }

  const existing = (await repository.listPledges(listing.id)).find(
    (entry) => entry.userId === user.id && entry.convertedOrderId === null,
  );
  const now = new Date().toISOString();

  if (existing && body.units === undefined && body.listed === undefined) {
    // A bare second tap is leaving.
    await repository.deletePledge(existing.id, listing.id);
  } else {
    const units = Math.min(MAX_UNITS, Math.max(1, Math.round(body.units ?? existing?.units ?? 1)));
    const row: Pledge = {
      id: existing?.id ?? `pdg_${randomUUID().slice(0, 12)}`,
      listingId: listing.id,
      userId: user.id,
      sellerId: listing.sellerId,
      units,
      listed: body.listed ?? existing?.listed ?? false,
      // Credit is recorded once, when they first join. Re-reading a card
      // through somebody else's link later does not move it: whoever actually
      // brought them in is a fact about that moment.
      broughtBy: existing?.broughtBy ?? referrer(body.via, user.id, listing.sellerId),
      convertedOrderId: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await repository.savePledge(row);
  }

  const settled = await reconcilePreOrder(repository, listing, { actorId: user.id });
  return json(200, await rosterOf(repository, settled.listing, settled.pledges, settled.orders, user.id));
}

export const preOrderReadRoute = handler(read);
export const preOrderPledgeRoute = handler(pledge);

const anon = { authLevel: 'anonymous' } as const;

app.http('preorder-read', { ...anon, methods: ['GET'], route: 'listings/{id}/preorder', handler: preOrderReadRoute });
app.http('preorder-pledge', { ...anon, methods: ['POST'], route: 'listings/{id}/pledge', handler: preOrderPledgeRoute });
