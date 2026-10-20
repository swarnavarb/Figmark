import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { hasAnyCapability, type UserCapabilities } from '../../../shared/capabilities.js';
import { inLot } from '../../../shared/fulfilment.js';
import { PHOTO_AUDIENCES, type Order, type OrderPhoto, type PhotoAudience } from '../../../shared/models.js';
import { photosFor } from '../../../shared/services.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { getPhotoStore } from '../storage/index.js';
import { tooFast } from '../rate-limit.js';
import { crewRolesOn, lotsStoreFor } from './fulfilment-routes.js';
import { readPhoto } from './template-routes.js';
import { error, handler, json } from './http.js';

/**
 * The people a shop tags on a lot, and the photos taken of its orders.
 *
 * Tagging is by a person's own handle: a shop cannot unpack a crate, and its
 * handle would put the lot on nobody's My services. The suggestions here are
 * people only, for the same reason.
 *
 * The photos are of one piece on its way - in a hand at the supplier's, out of
 * the crate at the handler's. They never reach the listing; the seller always
 * sees them, and decides who else does: the buyer on their timeline, the
 * supplier, the handler.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** A piece is photographed a handful of times, not catalogued. */
const MAX_ORDER_PHOTOS = 12;

/** GET /api/people/suggest?q= - people to tag on a lot, by name or handle. Never shops. */
async function suggestPeople(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const needle = (request.query.get('q') ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!needle) return json(200, { people: [] });

  const repository = await getRepository();
  const hit = (field: string | null | undefined) => (field ?? '').toLowerCase().includes(needle);
  const starts = (field: string | null | undefined) => (field ?? '').toLowerCase().startsWith(needle);
  const people = (await repository.searchUsers(needle, 60))
    // Their own handle, matched on their own name or handle: a shop owner turns
    // up as themselves, never because their shop's name matched.
    .filter((person) => person.id !== user.id && !person.suspended && person.username
      && (hit(person.displayName) || hit(person.username)))
    .map((person) => ({ id: person.id, name: person.displayName, handle: person.username! }))
    .sort((a, b) => Number(!(starts(a.handle) || starts(a.name))) - Number(!(starts(b.handle) || starts(b.name)))
      || a.name.localeCompare(b.name))
    .slice(0, 8);
  return json(200, { people });
}

/** Who this person is on this order: its shop, one of its crew, or nobody. */
async function seatOn(request: HttpRequest, repository: Repo, userId: string, capabilities: UserCapabilities, order: Order) {
  const sellerId = await lotsStoreFor(request, { id: userId }, order.sellerId);
  if (sellerId === order.sellerId && hasAnyCapability(capabilities, ['sell'])) {
    return { as: 'seller' as const, lot: null };
  }
  const lot = inLot(order) ? await repository.getLot(order.sellerId, order.lotId) : null;
  const role = (await crewRolesOn(repository, userId, order, lot)).find((each) => each !== 'forwarder');
  return role ? { as: role, lot } : null;
}

/** POST /api/orders/{id}/photos - a photo of this piece, from its shop or its crew. */
async function addOrderPhoto(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const slow = await tooFast(user.id, 'upload');
  if (slow) return slow;
  const id = request.params.id;
  if (!id) return error(400, 'invalid_order', 'An order id is required.');

  let body: { dataUrl?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const order = await repository.getOrder(id);
  if (!order) return error(404, 'not_found', 'No such order.');
  const seat = await seatOn(request, repository, user.id, user.capabilities, order);
  if (!seat) return error(403, 'forbidden', 'That order is not yours to photograph.');
  if ((order.photos ?? []).length >= MAX_ORDER_PHOTOS) {
    return error(409, 'too_many_photos', `An order holds ${MAX_ORDER_PHOTOS} photos. Remove one first.`);
  }

  const read = await readPhoto(body.dataUrl);
  if ('refusal' in read) return read.refusal;
  const stored = await (await getPhotoStore()).upload(read.photo.bytes, read.photo.contentType, user.id, read.photo.thumb);

  const photo: OrderPhoto = {
    id: `oph_${randomUUID().slice(0, 12)}`,
    url: stored.url,
    blobName: stored.blobName,
    addedAt: new Date().toISOString(),
    addedBy: user.id,
    addedAs: seat.as,
    // The crew's own photo shows on their own screen; anyone else is the seller's call.
    showTo: seat.as === 'seller' ? [] : [seat.as],
  };
  order.photos = [...(order.photos ?? []), photo];
  order.updatedAt = photo.addedAt;
  const saved = await repository.updateOrder(order);
  // Owned by the order, so no other screen's clean-up can take it.
  await (await getPhotoStore()).claimPublic(stored.blobName, `order:${order.id}`).catch(() => false);
  return json(201, { photo, photos: photosFor(saved, seat.as, user.id) });
}

/**
 * POST /api/orders/{id}/photos/{photoId} - who sees it, or take it down.
 *
 * Who sees it is the seller's alone. Taking it down is the seller's, or the
 * person who took it.
 */
async function updateOrderPhoto(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const { id, photoId } = request.params;
  if (!id || !photoId) return error(400, 'invalid_photo', 'An order and a photo are required.');

  let body: { showTo?: string[]; remove?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const order = await repository.getOrder(id);
  if (!order) return error(404, 'not_found', 'No such order.');
  const seat = await seatOn(request, repository, user.id, user.capabilities, order);
  if (!seat) return error(403, 'forbidden', 'That order is not yours.');
  const photo = (order.photos ?? []).find((each) => each.id === photoId);
  if (!photo) return error(404, 'not_found', 'No such photo.');

  if (body.remove) {
    if (seat.as !== 'seller' && photo.addedBy !== user.id) {
      return error(403, 'forbidden', 'Only the shop or whoever took it can remove a photo.');
    }
    order.photos = (order.photos ?? []).filter((each) => each.id !== photoId);
  } else if (body.showTo !== undefined) {
    if (seat.as !== 'seller') return error(403, 'forbidden', 'The shop decides who sees a photo.');
    if (!Array.isArray(body.showTo) || body.showTo.some((who) => !PHOTO_AUDIENCES.includes(who as PhotoAudience))) {
      return error(400, 'invalid_audience', 'Show a photo to the buyer, the supplier or the handler.');
    }
    photo.showTo = [...new Set(body.showTo as PhotoAudience[])];
  } else {
    return error(400, 'invalid_body', 'Say who sees the photo, or remove it.');
  }

  order.updatedAt = new Date().toISOString();
  const saved = await repository.updateOrder(order);
  if (body.remove) {
    // Deleted means deleted: the file goes too, not just the line naming it.
    // A file that cannot be removed now is still caught by the operator's unused-photo scan.
    await (await getPhotoStore()).remove('public', photo.blobName).catch(() => false);
  }
  return json(200, { photos: photosFor(saved, seat.as, user.id) });
}

export const suggestPeopleRoute = handler(suggestPeople);
export const addOrderPhotoRoute = handler(addOrderPhoto);
export const updateOrderPhotoRoute = handler(updateOrderPhoto);

const anon = { authLevel: 'anonymous' as const };
app.http('people-suggest', { ...anon, methods: ['GET'], route: 'people/suggest', handler: suggestPeopleRoute });
app.http('order-photos', { ...anon, methods: ['POST'], route: 'orders/{id}/photos', handler: addOrderPhotoRoute });
app.http('order-photo', { ...anon, methods: ['POST'], route: 'orders/{id}/photos/{photoId}', handler: updateOrderPhotoRoute });
