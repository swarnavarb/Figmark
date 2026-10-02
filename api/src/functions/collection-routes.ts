import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { CollectionGroup, CollectionItem, Listing, Order, User } from '../../../shared/models.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { settleAll } from '../delivery.js';
import { error, handler, json } from './http.js';

/**
 * A buyer's collection: delivered purchases, kept as cards on their page.
 *
 * Only something that actually arrived can go in - an order is eligible once
 * it is delivered, and the card remembers that day. The photos and name are
 * copied when it is added so the card keeps showing what was bought even if
 * the listing is later edited or expires. The owner may rename a card, sort
 * cards onto shelves of their own, or take one out again; nobody else can
 * change anything here.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

const GROUP_MAX = 30;
const GROUPS_MAX = 20;

function photosOf(listing: Listing | null): string[] {
  if (!listing) return [];
  const photos = [...(listing.photos ?? [])].sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)));
  return photos.map((photo) => photo.url).filter((url): url is string => Boolean(url));
}

/** Delivered orders not yet in the collection: what the owner could add. */
async function candidatesFor(repository: Repo, user: User) {
  const added = new Set((user.collection ?? []).map((item) => item.orderId));
  // Settled first: an item whose protection window ran out while nobody had
  // its page open is delivered, and belongs in this list today.
  const delivered = (await settleAll(await repository.listOrdersForBuyer(user.id), repository))
    .filter((order) => order.status === 'delivered' && !added.has(order.id));
  const listings = new Map<string, Listing | null>();
  await Promise.all([...new Set(delivered.map((order) => order.listingId))].map(async (id) => {
    listings.set(id, await repository.getListing(id));
  }));
  return delivered
    .map((order) => ({
      orderId: order.id,
      listingId: order.listingId,
      itemName: order.itemName,
      photo: photosOf(listings.get(order.listingId) ?? null)[0] ?? null,
      deliveredAt: deliveredAt(order),
    }))
    .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt));
}

/** The day it reached the buyer: the delivered tick first, which never moves once set. */
function deliveredAt(order: Order): string {
  return order.checkpoints?.delivered
    ?? order.completedAt
    ?? [...(order.stageHistory ?? [])].reverse().find((event) => event.stage === 'delivered')?.enteredAt
    ?? order.updatedAt;
}

function shelf(user: User, visitor = false) {
  const items = [...(user.collection ?? [])].sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt));
  return {
    groups: user.collectionGroups ?? [],
    // Photos the owner hid are theirs to see and nobody else's.
    items: visitor
      ? items.map(({ hiddenPhotos, ...item }) => ({ ...item, photos: item.photos.filter((url) => !hiddenPhotos?.includes(url)) }))
      : items,
  };
}

async function me(request: HttpRequest) {
  const auth = await getAuthService();
  const principal = await auth.requireAuth(request);
  const repository = await getRepository();
  const user = await repository.getUserById(principal.id);
  return { repository, user };
}

async function body<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function save(repository: Repo, user: User) {
  user.updatedAt = new Date().toISOString();
  return repository.updateUser(user);
}

/** GET /api/users/{id}/collection - anybody's shelves. */
async function publicCollection(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');
  const repository = await getRepository();
  const user = await repository.getUserById(id);
  if (!user || user.suspended) return error(404, 'not_found', 'No such account.');
  return json(200, shelf(user, true));
}

/** GET /api/me/collection - your shelves, and the deliveries waiting to go on them. */
async function myCollection(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await me(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  return json(200, { ...shelf(user), candidates: await candidatesFor(repository, user) });
}

/** POST /api/me/collection/add - put a delivered purchase in the collection. */
async function add(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await me(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const input = await body<{ orderId?: string; groupId?: string | null }>(request);
  if (!input?.orderId) return error(400, 'invalid_request', 'Say which order to add.');

  const order = await repository.getOrder(input.orderId);
  if (!order || order.buyerId !== user.id) return error(404, 'not_found', 'No such purchase of yours.');
  if (order.status !== 'delivered') return error(409, 'not_delivered', 'Only a delivered item can go in your collection.');
  if ((user.collection ?? []).some((item) => item.orderId === order.id)) {
    return error(409, 'already_added', 'That item is already in your collection.');
  }
  const groupId = input.groupId && (user.collectionGroups ?? []).some((group) => group.id === input.groupId) ? input.groupId : null;

  const listing = await repository.getListing(order.listingId);
  const now = new Date().toISOString();
  const item: CollectionItem = {
    orderId: order.id,
    listingId: order.listingId,
    // Named as it was sold, and kept that way.
    name: order.itemName,
    itemName: order.itemName,
    photos: photosOf(listing),
    groupId,
    deliveredAt: deliveredAt(order),
    addedAt: now,
  };
  user.collection = [...(user.collection ?? []), item];
  await save(repository, user);
  return json(201, { item, ...shelf(user) });
}

/**
 * POST /api/me/collection/edit - move a card to another shelf, pick the photo
 * it leads with, or hide photos from everybody else. The name is the item's.
 */
async function edit(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await me(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const input = await body<{ orderId?: string; groupId?: string | null; cover?: string; hidden?: string[] }>(request);
  const item = (user.collection ?? []).find((entry) => entry.orderId === input?.orderId);
  if (!input || !item) return error(404, 'not_found', 'That item is not in your collection.');

  if (input.groupId !== undefined) {
    if (input.groupId !== null && !(user.collectionGroups ?? []).some((group) => group.id === input.groupId)) {
      return error(404, 'not_found', 'No such shelf.');
    }
    item.groupId = input.groupId;
  }
  if (input.cover !== undefined) {
    if (!item.photos.includes(input.cover)) return error(404, 'not_found', 'That photo is not on this card.');
    item.photos = [input.cover, ...item.photos.filter((url) => url !== input.cover)];
  }
  if (input.hidden !== undefined) {
    item.hiddenPhotos = item.photos.filter((url) => input.hidden!.includes(url) && url !== item.photos[0]);
  }
  await save(repository, user);
  return json(200, { item, ...shelf(user) });
}

/** POST /api/me/collection/remove - take a card off your page. The purchase itself is untouched. */
async function remove(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await me(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const input = await body<{ orderId?: string }>(request);
  const before = user.collection ?? [];
  user.collection = before.filter((entry) => entry.orderId !== input?.orderId);
  if (user.collection.length === before.length) return error(404, 'not_found', 'That item is not in your collection.');
  await save(repository, user);
  return json(200, shelf(user));
}

/**
 * POST /api/me/collection/groups - make, rename or delete a shelf.
 *
 * Deleting a shelf never deletes what is on it: those cards simply go back to
 * the unsorted pile.
 */
async function groups(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await me(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const input = await body<{ action?: string; id?: string; name?: string }>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  const list: CollectionGroup[] = [...(user.collectionGroups ?? [])];
  const name = (input.name ?? '').trim().slice(0, GROUP_MAX);

  if (input.action === 'create') {
    if (!name) return error(400, 'invalid_name', 'Name the shelf.');
    if (list.length >= GROUPS_MAX) return error(409, 'too_many', `You can have up to ${GROUPS_MAX} shelves.`);
    const group = { id: `grp_${randomUUID().slice(0, 8)}`, name };
    user.collectionGroups = [...list, group];
    await save(repository, user);
    return json(201, { group, ...shelf(user) });
  }

  const group = list.find((entry) => entry.id === input.id);
  if (!group) return error(404, 'not_found', 'No such shelf.');
  if (input.action === 'rename') {
    if (!name) return error(400, 'invalid_name', 'Name the shelf.');
    group.name = name;
    user.collectionGroups = list;
  } else if (input.action === 'delete') {
    user.collectionGroups = list.filter((entry) => entry.id !== group.id);
    user.collection = (user.collection ?? []).map((item) => (item.groupId === group.id ? { ...item, groupId: null } : item));
  } else {
    return error(400, 'invalid_action', 'The action is create, rename or delete.');
  }
  await save(repository, user);
  return json(200, shelf(user));
}

export const publicCollectionRoute = handler(publicCollection);
export const myCollectionRoute = handler(myCollection);
export const collectionAddRoute = handler(add);
export const collectionEditRoute = handler(edit);
export const collectionRemoveRoute = handler(remove);
export const collectionGroupsRoute = handler(groups);

const anon = { authLevel: 'anonymous' } as const;
app.http('user-collection', { ...anon, methods: ['GET'], route: 'users/{id}/collection', handler: publicCollectionRoute });
app.http('me-collection', { ...anon, methods: ['GET'], route: 'me/collection', handler: myCollectionRoute });
app.http('me-collection-add', { ...anon, methods: ['POST'], route: 'me/collection/add', handler: collectionAddRoute });
app.http('me-collection-edit', { ...anon, methods: ['POST'], route: 'me/collection/edit', handler: collectionEditRoute });
app.http('me-collection-remove', { ...anon, methods: ['POST'], route: 'me/collection/remove', handler: collectionRemoveRoute });
app.http('me-collection-groups', { ...anon, methods: ['POST'], route: 'me/collection/groups', handler: collectionGroupsRoute });
