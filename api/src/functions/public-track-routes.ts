import { createHmac, timingSafeEqual } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { asBuyerSees, inLot, lotIsDone, settledHistory } from '../../../shared/fulfilment.js';
import { ladderBeforeLot, withReceivedAs } from '../../../shared/buttons.js';
import {
  currentStepOf, itemStepOn, renderStepText, routeOf, ticksOf, triggeredStep,
} from '../../../shared/routes.js';
import { AuthError } from '../auth/errors.js';
import { getAuthService } from '../auth/index.js';
import { config } from '../config.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { shopDays } from '../step-days.js';
import { daysLeftRange, rangeForStep, type DayRange } from '../../../shared/step-days.js';

/**
 * "Where is my parcel", for people without an account.
 *
 * A buyer sends this to the family member waiting at the door, and a seller
 * sends it to a buyer who asks on WhatsApp instead of opening the app. Both
 * questions were a message the seller had to answer by hand.
 *
 * The link is signed rather than stored, like an affiliate link: nothing to
 * issue, nothing to look up, and an edited link simply does not verify. It
 * shows the item, the shop and the journey - never the buyer's name, address,
 * phone, or anything about money.
 */

function signature(orderId: string): string {
  return createHmac('sha256', config.sessionSecret).update(`track:v1:${orderId}`).digest('base64url').slice(0, 22);
}

/** The token in `/track/<token>` for one order. */
export function trackToken(orderId: string): string {
  return `${Buffer.from(orderId, 'utf8').toString('base64url')}.${signature(orderId)}`;
}

/** The order a token names, or null when it was not issued here. */
export function orderOfTrackToken(token: string | undefined): string | null {
  if (!token) return null;
  const cut = token.lastIndexOf('.');
  if (cut <= 0) return null;
  let orderId: string;
  try {
    orderId = Buffer.from(token.slice(0, cut), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!orderId || orderId.length > 120) return null;
  const given = Buffer.from(token.slice(cut + 1));
  const expected = Buffer.from(signature(orderId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? orderId : null;
}

/** Buyer or seller of the order: the link to share. */
async function makeTrackLink(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'An order id is required.');
  const repository = await getRepository();
  const order = await repository.getOrder(id);
  if (!order) return error(404, 'not_found', 'No such order.');
  if (order.buyerId !== user.id && order.sellerId !== user.id) throw AuthError.forbidden('That order is not yours.');
  const token = trackToken(order.id);
  return json(200, { token, path: `/track/${token}` });
}

/** Anybody with the link: the journey, and nothing personal. */
async function publicTracking(request: HttpRequest, _context: InvocationContext) {
  const orderId = orderOfTrackToken(request.params.token);
  if (!orderId) return error(404, 'not_found', 'This tracking link is not valid.');
  const repository = await getRepository();
  const stored = await repository.getOrder(orderId);
  if (!stored) return error(404, 'not_found', 'This tracking link is not valid.');
  // What the buyer would see: a dispatch that can still be taken back has not happened yet.
  const order = asBuyerSees(stored);
  const stopped = order.status === 'cancelled' || order.status === 'rejected' || order.status === 'cancelled_reversed';

  const [lot, sellers, listing] = await Promise.all([
    inLot(order) ? repository.getLot(order.sellerId, order.lotId) : Promise.resolve(null),
    repository.listUsersByIds([order.sellerId]),
    repository.getListing(order.listingId),
  ]);
  const seller = sellers[0];
  const vars = { origin: lot?.originCountry ?? null, destination: lot?.destinationCountry ?? null };

  // How long each step usually takes, as the system worked it out - the shop's own, or the market's.
  const days = await shopDays(repository, order.sellerId).catch(() => null);
  let steps: string[];
  let stepDays: (DayRange | null)[] = [];
  let at: number;
  let eta: { low: number; high: number; source: DayRange['source'] } | null = null;
  if (lot) {
    const route = routeOf(lot);
    steps = route.steps.map((step) => renderStepText(step.name, vars));
    stepDays = route.steps.map((step, index) => (index < route.steps.length - 1 ? rangeForStep(days?.steps, step.name) : null));
    at = itemStepOn(route, currentStepOf(lot), order.currentStep, ticksOf(order));
    const lastMove = settledHistory(lot.stageHistory).filter((event) => event.step).at(-1);
    const daysIn = lastMove ? Math.max(0, Math.floor((Date.now() - Date.parse(lastMove.enteredAt)) / 86_400_000)) : 0;
    eta = lotIsDone(lot) || order.status === 'delivered' ? null : daysLeftRange(route.steps, Math.max(0, at), days?.steps, daysIn);
  } else {
    const template = listing?.lotRouteId ? await repository.getRoute(order.sellerId, listing.lotRouteId) : null;
    const before = ladderBeforeLot(order, template);
    const ladder = withReceivedAs(before.steps, order.receivedAs);
    steps = [...ladder.map((step) => renderStepText(step.name, vars)), 'Waiting for its shipment'];
    stepDays = [...ladder.map((step) => rangeForStep(days?.steps, step.name)), null];
    at = Math.max(0, triggeredStep({ steps: ladder }, ticksOf(order)));
  }
  if (order.status === 'delivered') at = steps.length - 1;

  const lead = listing?.photos.find((photo) => photo.isPrimary) ?? listing?.photos[0] ?? null;
  const updates = settledHistory(order.stageHistory)
    .filter((event) => event.step || event.kind === 'step')
    .slice(-6)
    .reverse()
    .map((event) => ({ at: event.enteredAt, text: event.step ? renderStepText(event.step, vars) : event.note ?? '' }))
    .filter((row) => row.text);

  return json(200, {
    itemName: order.itemName,
    quantity: order.quantity,
    photo: lead ? { url: lead.url, thumbUrl: lead.thumbUrl ?? null } : null,
    shop: seller ? { name: seller.displayName, handle: seller.username ?? null } : null,
    status: stopped ? 'cancelled' : order.status === 'delivered' ? 'delivered' : 'moving',
    steps,
    at: Math.min(Math.max(0, at), steps.length - 1),
    stepDays,
    eta,
    updates,
  });
}

export const makeTrackLinkRoute = handler(makeTrackLink);
export const publicTrackingRoute = handler(publicTracking);

const anon = { authLevel: 'anonymous' } as const;
app.http('order-track-link', { ...anon, methods: ['POST'], route: 'orders/{id}/track-link', handler: makeTrackLinkRoute });
app.http('public-track', { ...anon, methods: ['GET'], route: 'track/{token}', handler: publicTrackingRoute });
