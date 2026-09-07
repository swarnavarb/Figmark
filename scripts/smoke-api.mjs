/**
 * Smoke test for the HTTP contract.
 *
 * Calls the compiled route handlers directly with stand-in request/context
 * objects, so status codes, bodies and cookies are checked without an Azure
 * Functions host. Run `npm run build:api` first.
 */
import assert from 'node:assert/strict';

const fns = new URL('../api/dist/api/src/functions/', import.meta.url);
const { healthRoute: health } = await import(new URL('health.js', fns));
const { loginRoute: login, signupRoute: signup, meRoute: me } = await import(new URL('auth-routes.js', fns));
const {
  feedRoute: feed, listingDetailRoute: listingDetail, createListingRoute: createListing,
  toggleLikeRoute: toggleLike, bumpListingRoute: bump, addCommentRoute: addComment,
  toggleFollowRoute: toggleFollow, createOrderRoute: createOrder,
  myActivityRoute: myActivity, forwardersRoute: forwarders,
} = await import(new URL('catalog-routes.js', fns));
const {
  myLotsRoute: myLots, createLotRoute: createLot, lotContentsRoute: lotContents,
  updateLotDetailsRoute: updateLotDetails,
} = await import(new URL('fulfilment-routes.js', fns));
const {
  storefrontRoute: storefront, updateStorefrontRoute: saveStorefront, dashboardRoute: dashboard,
  myStoresRoute: myStores, updateManagersRoute: updateManagers,
} = await import(new URL('seller-routes.js', fns));
const {
  socialFeedRoute: socialFeed, channelsRoute: channels, channelThreadRoute: channelThread,
  createPostRoute: createPost, listForumsRoute: listForums, createForumRoute: createForum,
} = await import(new URL('social-routes.js', fns));
const {
  assignToLotRoute: assignToLot, advanceStageRoute: advanceStage,
  setTrackingRoute: setTracking, orderTrackingRoute: orderTracking,
  lotsBoardRoute: lotsBoard, lotBoardRoute: lotBoard, setCheckpointRoute: setCheckpoint,
} = await import(new URL('fulfilment-routes.js', fns));
const { DEMO_EMAIL, DEMO_PHONE, DEMO_PASSWORD } = await import(
  new URL('../api/dist/api/src/data/seed.js', import.meta.url)
);

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
const req = ({ headers = {}, body, query = {}, params = {} } = {}) => ({
  headers: new Headers(headers),
  query: new URLSearchParams(query),
  params,
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
});

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/* ── auth ──────────────────────────────────────────────────────────────── */
console.log('auth');

await check('health reports the session-key source and account durability', async () => {
  const body = (await health(req(), ctx)).jsonBody;
  // No database configured here, so both must read as the unsafe case.
  assert.equal(body.auth.sessionSecretSource, 'development');
  // 'ephemeral' would differ per worker and break sessions across instances,
  // so only 'configured' and 'derived' may ever count as healthy.
  assert.ok(!['configured', 'derived'].includes(body.auth.sessionSecretSource));
  // The key must never differ per worker: 'ephemeral' would mean one worker
  // rejecting another's tokens, which reads to a user as being logged out at
  // random. No configuration may produce it.
  assert.notEqual(body.auth.sessionSecretSource, 'ephemeral');
  assert.equal(body.auth.accountsDurable, false);
  // ...and that alone is enough to keep the deployment out of "ok".
  assert.equal(body.status, 'degraded');
});

await check('health advertises exactly one sign-in account', async () => {
  const body = (await health(req(), ctx)).jsonBody;
  assert.equal(body.auth.demoAccounts.length, 1);
  assert.equal(body.auth.demoAccounts[0].identifier, DEMO_EMAIL);
});

const session = await login(req({ body: { identifier: DEMO_EMAIL, password: DEMO_PASSWORD } }), ctx);
const auth = { authorization: `Bearer ${session.jsonBody.token}` };

/**
 * The browser has no bearer token - only the cookie.
 *
 * Every check below authenticates with the Authorization header, which no
 * browser ever sends, so the cookie could stop reaching it entirely and this
 * suite would stay green. It did: the session went out through the runtime's
 * structured cookie collection, the local dev server rebuilt the header by
 * hand, and the deployed host sent none, so every request from the browser
 * arrived anonymous. These read the cookie back out of the response headers the
 * way a browser would.
 */
const setCookies =
  session.headers instanceof Headers ? session.headers.getSetCookie() : [];
const sessionCookie = setCookies.find((value) => value.startsWith('figmark_session='));

await check('sign-in emits a real Set-Cookie header', () => {
  assert.ok(sessionCookie, `expected a figmark_session cookie, got ${JSON.stringify(setCookies)}`);
  for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) {
    assert.ok(sessionCookie.includes(attribute), `cookie is missing ${attribute}: ${sessionCookie}`);
  }
});

/** Headers as a browser would send them back: the cookie pair, nothing else. */
const cookieAuth = { cookie: sessionCookie.split(';')[0] };

await check('the cookie alone is enough to be signed in', async () => {
  const who = await me(req({ headers: cookieAuth }), ctx);
  assert.equal(who.status, 200);
  assert.equal(who.jsonBody.user.id, session.jsonBody.user.id);
});

await check('a request carrying no session says exactly that', async () => {
  const anonymous = await myLots(req(), ctx);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.jsonBody.error, 'no_session');
});

await check('a tampered cookie is reported as unverifiable, not as a logout', async () => {
  const tampered = { cookie: `figmark_session=${session.jsonBody.token.slice(0, -3)}xyz` };
  const refused = await myLots(req({ headers: tampered }), ctx);
  assert.equal(refused.status, 401);
  assert.equal(refused.jsonBody.error, 'session_unverified');
});

await check('signs in by email', () => {
  assert.equal(session.status, 200);
  assert.equal(session.jsonBody.user.displayName, 'Arjun Mehta');
  assert.equal(session.jsonBody.user.capabilities.canSell, true);
});

await check('signs in by phone too', async () => {
  const byPhone = await login(req({ body: { identifier: DEMO_PHONE, password: DEMO_PASSWORD } }), ctx);
  assert.equal(byPhone.status, 200);
  assert.equal(byPhone.jsonBody.user.id, session.jsonBody.user.id);
});

await check('rejects a wrong password with 401', async () => {
  const bad = await login(req({ body: { identifier: DEMO_EMAIL, password: 'nope' } }), ctx);
  assert.equal(bad.status, 401);
});

await check('signup creates an account with no storefront', async () => {
  const created = await signup(req({
    body: { displayName: 'New Person', email: 'new@figmark.example', phone: '+919000012345', password: 'longenough1' },
  }), ctx);
  assert.equal(created.status, 201);
  assert.equal(created.jsonBody.user.sellerProfile, null);
  // But still permitted to sell - the storefront appears on first listing.
  assert.equal(created.jsonBody.user.capabilities.canSell, true);
});

await check('signup refuses a duplicate identifier with 409', async () => {
  const dup = await signup(req({
    body: { displayName: 'Impostor', email: DEMO_EMAIL, phone: '+919000099999', password: 'longenough1' },
  }), ctx);
  assert.equal(dup.status, 409);
});

await check('signup validates a short password', async () => {
  const weak = await signup(req({
    body: { displayName: 'X', email: 'x@figmark.example', phone: '+919000088888', password: 'short' },
  }), ctx);
  assert.equal(weak.status, 400);
});

/* ── feed ──────────────────────────────────────────────────────────────── */
console.log('\nfeed and search');

await check('serves the catalog anonymously', async () => {
  const body = (await feed(req(), ctx)).jsonBody;
  assert.ok(body.listings.length >= 10);
  assert.ok(body.categories.length > 3);
  assert.ok(body.listings.every((l) => l.seller !== null), 'every card needs its seller');
});

await check('text search narrows results', async () => {
  const body = (await feed(req({ query: { q: 'sneaker' } }), ctx)).jsonBody;
  assert.equal(body.listings.length, 2);
  assert.ok(body.listings.every((l) => /sneaker|runner|high-top/i.test(`${l.title} ${l.tags.join(' ')}`)));
});

await check('extra search words narrow rather than widen', async () => {
  const one = (await feed(req({ query: { q: 'sneaker' } }), ctx)).jsonBody.listings.length;
  const two = (await feed(req({ query: { q: 'sneaker deadstock' } }), ctx)).jsonBody.listings.length;
  assert.ok(two < one, 'a second term should narrow the result set');
});

await check('filters by kind, condition and price', async () => {
  const pre = (await feed(req({ query: { kind: 'pre_order' } }), ctx)).jsonBody.listings;
  assert.ok(pre.length > 0 && pre.every((l) => l.preOrder !== null));
  const misb = (await feed(req({ query: { condition: 'MISB' } }), ctx)).jsonBody.listings;
  assert.ok(misb.every((l) => l.condition === 'MISB'));
  const cheap = (await feed(req({ query: { maxPrice: '50000' } }), ctx)).jsonBody.listings;
  assert.ok(cheap.every((l) => l.priceMinor <= 50000));
});

await check('pre-orders carry their own fill counts', async () => {
  const body = (await feed(req({ query: { kind: 'pre_order' } }), ctx)).jsonBody;
  assert.ok(body.listings.every((l) => typeof l.preOrder.fillThreshold === 'number'));
});

await check('the feed never exposes a shipment batch to buyers', async () => {
  const body = (await feed(req({ headers: auth }), ctx)).jsonBody;
  // lotId is on the listing document, but no lot object may ride along.
  assert.ok(body.listings.every((l) => !('lot' in l)), 'feed cards must not carry a lot');
  const tagged = body.listings.find((l) => l.lotId !== null);
  assert.ok(tagged, 'expected at least one tagged listing');
  // ...only the one fact it contributes.
  assert.ok('estimatedDispatchAt' in tagged);
});

await check('followed sellers rank first for a signed-in viewer', async () => {
  const body = (await feed(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.followedSellerIds.includes('usr_kaiju'));

  // The invariant is the ordering, not which seller happens to be at the top:
  // every followed seller's listing comes before every unfollowed one. Naming a
  // single expected seller only held while exactly one was followed.
  const followed = new Set(body.followedSellerIds);
  const ranks = body.listings.map((listing) => Number(followed.has(listing.sellerId)));
  const sorted = [...ranks].sort((a, b) => b - a);
  assert.deepEqual(ranks, sorted, 'a listing from someone unfollowed came before a followed one');
  assert.ok(followed.has(body.listings[0].sellerId));
});

/* ── listing detail and social ─────────────────────────────────────────── */
console.log('\nlisting detail and social');

await check('detail includes seller and comments but never the batch', async () => {
  const body = (await listingDetail(req({ params: { id: 'lst_dragon_knight' } }), ctx)).jsonBody;
  assert.equal(body.seller.storefrontName, 'Kaiju Imports');
  assert.equal(body.comments.length, 2);
  assert.equal(body.comments[1].replyToId, 'cmt_1');
  assert.ok(!('lot' in body), 'the listing page must not receive a lot');
  assert.ok(body.estimatedDispatchAt, 'but it does inherit the dispatch estimate');
});

await check('404s an unknown listing', async () => {
  assert.equal((await listingDetail(req({ params: { id: 'nope' } }), ctx)).status, 404);
});

await check('like toggles and is reflected on the next read', async () => {
  const on = await toggleLike(req({ headers: auth, params: { id: 'lst_handheld' } }), ctx);
  assert.equal(on.jsonBody.liked, true);
  const detail = (await listingDetail(req({ headers: auth, params: { id: 'lst_handheld' } }), ctx)).jsonBody;
  assert.equal(detail.liked, true);
  const off = await toggleLike(req({ headers: auth, params: { id: 'lst_handheld' } }), ctx);
  assert.equal(off.jsonBody.liked, false);
});

await check('like requires a session', async () => {
  assert.equal((await toggleLike(req({ params: { id: 'lst_handheld' } }), ctx)).status, 401);
});

await check('follow toggles, and refuses following yourself', async () => {
  // Asserted as a flip rather than "the first toggle turns it on": whether the
  // demo account already follows this seller is a fact about the seed, and the
  // behaviour under test is that the toggle inverts and lands back where it was.
  const first = await toggleFollow(req({ headers: auth, params: { id: 'usr_tokyoline' } }), ctx);
  const second = await toggleFollow(req({ headers: auth, params: { id: 'usr_tokyoline' } }), ctx);
  assert.equal(typeof first.jsonBody.following, 'boolean');
  assert.equal(second.jsonBody.following, !first.jsonBody.following);

  const self = await toggleFollow(req({ headers: auth, params: { id: 'usr_demo' } }), ctx);
  assert.equal(self.status, 400);
});

await check('comments post and appear on the listing', async () => {
  const created = await addComment(req({ headers: auth, params: { id: 'lst_handheld' }, body: { body: 'Still available?' } }), ctx);
  assert.equal(created.status, 201);
  const detail = (await listingDetail(req({ params: { id: 'lst_handheld' } }), ctx)).jsonBody;
  assert.ok(detail.comments.some((c) => c.body === 'Still available?'));
});

await check('empty comments are refused', async () => {
  const empty = await addComment(req({ headers: auth, params: { id: 'lst_handheld' }, body: { body: '   ' } }), ctx);
  assert.equal(empty.status, 400);
});

/* ── selling ───────────────────────────────────────────────────────────── */
console.log('\nselling');

const published = await createListing(req({
  headers: auth,
  body: { title: 'Test sword replica', description: 'From my shelf', category: 'Collectibles', condition: 'LOOSE', priceMinor: 250000, quantityAvailable: 1, tags: ['replica'] },
}), ctx);

await check('publishes a listing owned by the signed-in account', () => {
  assert.equal(published.status, 201);
  assert.equal(published.jsonBody.listing.sellerId, 'usr_demo');
  assert.equal(published.jsonBody.listing.status, 'active');
});

await check('the new listing is searchable straight away', async () => {
  const body = (await feed(req({ query: { q: 'sword replica' } }), ctx)).jsonBody;
  assert.ok(body.listings.some((l) => l.id === published.jsonBody.listing.id));
});

await check('publishing requires a session and a valid price', async () => {
  assert.equal((await createListing(req({ body: { title: 'x', priceMinor: 100 } }), ctx)).status, 401);
  const noPrice = await createListing(req({ headers: auth, body: { title: 'No price' } }), ctx);
  assert.equal(noPrice.status, 400);
});

await check('bump works once, then is rate-limited', async () => {
  const id = published.jsonBody.listing.id;
  assert.equal((await bump(req({ headers: auth, params: { id } }), ctx)).status, 200);
  const again = await bump(req({ headers: auth, params: { id } }), ctx);
  assert.equal(again.status, 429, 'a second bump must be refused');
});

await check("bumping someone else's listing is refused", async () => {
  const other = await bump(req({ headers: auth, params: { id: 'lst_dragon_knight' } }), ctx);
  assert.equal(other.status, 429);
});

/* ── buying ────────────────────────────────────────────────────────────── */
console.log('\nbuying');

await check('buying decrements stock and appears in purchases', async () => {
  const before = (await listingDetail(req({ params: { id: 'lst_handheld' } }), ctx)).jsonBody.listing.quantityAvailable;
  const order = await createOrder(req({ headers: auth, body: { listingId: 'lst_handheld', quantity: 1 } }), ctx);
  assert.equal(order.status, 201);
  const after = (await listingDetail(req({ params: { id: 'lst_handheld' } }), ctx)).jsonBody.listing.quantityAvailable;
  assert.equal(after, before - 1);
  const activity = (await myActivity(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(activity.orders.some((o) => o.id === order.jsonBody.order.id));
});

await check('cannot buy your own listing', async () => {
  const own = await createOrder(req({ headers: auth, body: { listingId: published.jsonBody.listing.id } }), ctx);
  assert.equal(own.status, 400);
});

await check('refuses more than the available stock', async () => {
  const greedy = await createOrder(req({ headers: auth, body: { listingId: 'lst_sneaker_retro', quantity: 99 } }), ctx);
  assert.equal(greedy.status, 409);
});

await check('activity separates listings from purchases', async () => {
  const body = (await myActivity(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.listings.every((l) => l.sellerId === 'usr_demo'));
  assert.ok(body.orders.every((o) => o.buyerId === 'usr_demo'));
});

/* ── forwarders ────────────────────────────────────────────────────────── */
console.log('\nforwarder directory');

await check('lists forwarders ranked by trust', async () => {
  const body = (await forwarders(req(), ctx)).jsonBody;
  assert.equal(body.forwarders.length, 3);
  const scores = body.forwarders.map((f) => f.trust.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(body.forwarders.every((f) => f.routes.length > 0));
});

await check('filters forwarders by route', async () => {
  const body = (await forwarders(req({ query: { route: 'chennai' } }), ctx)).jsonBody;
  assert.equal(body.forwarders.length, 1);
  assert.equal(body.forwarders[0].companyName, 'Silk Route Cargo');
});

/* ── shipment batches ──────────────────────────────────────────────────── */
console.log('\nshipment batches');

const batch = await createLot(req({
  headers: auth,
  body: {
    name: 'Test consignment', description: 'smoke',
    origin: 'Guangzhou, CN',
    supplierName: 'Baiyun Hobby', supplierContact: 'wechat: baiyun', supplierReference: 'BH-1',
    estimatedDispatchAt: new Date(Date.now() + 6e8).toISOString(), forwarderName: 'Test Freight',
  },
}), ctx);

await check('a batch carries its origin and supplier', () => {
  assert.equal(batch.jsonBody.lot.origin, 'Guangzhou, CN');
  assert.equal(batch.jsonBody.lot.supplier.name, 'Baiyun Hobby');
  assert.equal(batch.jsonBody.lot.supplier.reference, 'BH-1');
});

await check('the name is the only field a batch insists on', async () => {
  const bare = await createLot(req({ headers: auth, body: { name: 'Bare batch' } }), ctx);
  assert.equal(bare.status, 201);
  assert.equal(bare.jsonBody.lot.origin, '');
  // A contact with nobody attached to it is not a supplier.
  assert.equal(bare.jsonBody.lot.supplier, null);

  const nameless = await createLot(req({ headers: auth, body: { origin: 'Shenzhen, CN' } }), ctx);
  assert.equal(nameless.status, 400);
  assert.equal(nameless.jsonBody.error, 'invalid_lot');
});

await check('every detail can be corrected afterwards', async () => {
  const id = batch.jsonBody.lot.id;
  const edited = await updateLotDetails(req({
    headers: auth, params: { id },
    body: { name: 'Renamed consignment', origin: 'Yiwu, CN', supplierName: 'Yiwu Trading' },
  }), ctx);
  assert.equal(edited.status, 200);
  assert.equal(edited.jsonBody.lot.name, 'Renamed consignment');
  assert.equal(edited.jsonBody.lot.origin, 'Yiwu, CN');
  assert.equal(edited.jsonBody.lot.supplier.name, 'Yiwu Trading');
  // Untouched keys stay as they were: editing the origin must not blank notes.
  assert.equal(edited.jsonBody.lot.description, 'smoke');
});

await check('a batch cannot be renamed to nothing, or by someone else', async () => {
  const id = batch.jsonBody.lot.id;
  const blank = await updateLotDetails(req({ headers: auth, params: { id }, body: { name: '  ' } }), ctx);
  assert.equal(blank.status, 400);

  // A batch is read from its owner's partition, so another seller's id does not
  // resolve at all - it is not found rather than forbidden.
  const stranger = await signup(req({
    body: { displayName: 'Other Seller', email: 'other@figmark.example', phone: '+919000077777', password: 'longenough1' },
  }), ctx);
  const theirs = await updateLotDetails(req({
    headers: { authorization: `Bearer ${stranger.jsonBody.token}` },
    params: { id }, body: { name: 'Mine now' },
  }), ctx);
  assert.equal(theirs.status, 404);
});

await check('an item can be filed into a batch as it is listed', async () => {
  const id = batch.jsonBody.lot.id;
  const listed = await createListing(req({
    headers: auth,
    body: { title: 'Straight into the batch', priceMinor: 90_000, lotId: id },
  }), ctx);
  assert.equal(listed.status, 201);
  assert.equal(listed.jsonBody.listing.lotId, id);
  // A batch is a consignment of imports, so it settles the sourcing itself.
  assert.equal(listed.jsonBody.listing.sourcing, 'import');
});

await check('someone else\'s batch is not a place to file things', async () => {
  const refused = await createListing(req({
    headers: auth,
    body: { title: 'Nice try', priceMinor: 1000, lotId: 'lot_gz_sep' },
  }), ctx);
  assert.equal(refused.status, 404);
});

await check('an item with no batch behind it is in hand', async () => {
  const single = await createListing(req({
    headers: auth, body: { title: 'Off my own shelf', priceMinor: 5000, sourcing: 'in_hand' },
  }), ctx);
  assert.equal(single.jsonBody.listing.sourcing, 'in_hand');
  assert.equal(single.jsonBody.listing.lotId, null);

  // Nothing claimed, nothing promised: an unstated item ships from the shelf.
  const quiet = await createListing(req({ headers: auth, body: { title: 'Unstated', priceMinor: 5000 } }), ctx);
  assert.equal(quiet.jsonBody.listing.sourcing, 'in_hand');
});

await check('an import with no lot is refused, not quietly downgraded', async () => {
  // The lot carries the stages a buyer waits on, so an imported item outside
  // one has no tracking to give them. Saying so beats publishing a listing that
  // claims an import and can never move.
  const refused = await createListing(req({
    headers: auth, body: { title: 'Import with nowhere to go', priceMinor: 5000, sourcing: 'import' },
  }), ctx);
  assert.equal(refused.status, 400);
  assert.match(refused.jsonBody.message, /has to go in a lot/);
});

await check('no listing anywhere claims an import without a batch', async () => {
  // The invariant, asserted across the whole catalog rather than one listing:
  // sourcing follows the batch, both ways.
  const body = (await feed(req({ headers: auth }), ctx)).jsonBody;
  for (const listing of body.listings) {
    const expected = listing.lotId ? 'import' : 'in_hand';
    assert.equal(listing.sourcing, expected, `${listing.title} says ${listing.sourcing}`);
  }
});

await check('a seller can open a batch', () => {
  assert.equal(batch.status, 201);
  assert.equal(batch.jsonBody.lot.sellerId, 'usr_demo');
  assert.equal(batch.jsonBody.lot.stage, 'ordering');
});

const batchId = batch.jsonBody.lot.id;

await check('lists the seller\'s batches and unassigned listings', async () => {
  const body = (await myLots(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.lots.some((entry) => entry.lot.id === batchId));
  assert.ok(Array.isArray(body.unassigned));
});

await check('items can be tagged into and out of a batch', async () => {
  const added = await assignToLot(req({ headers: auth, params: { id: batchId }, body: { listingIds: ['lst_my_cards'] } }), ctx);
  assert.equal(added.jsonBody.changed, 1);
  const contents = (await lotContents(req({ headers: auth, params: { id: batchId } }), ctx)).jsonBody;
  assert.ok(contents.listings.some((l) => l.id === 'lst_my_cards'));

  const removed = await assignToLot(req({ headers: auth, params: { id: batchId }, body: { listingIds: ['lst_my_cards'], remove: true } }), ctx);
  assert.equal(removed.jsonBody.changed, 1);
});

await check("a seller cannot touch someone else's batch", async () => {
  for (const call of [
    lotContents(req({ headers: auth, params: { id: 'lot_gz_sep' } }), ctx),
    advanceStage(req({ headers: auth, params: { id: 'lot_gz_sep' }, body: { stage: 'qc_repack' } }), ctx),
  ]) {
    assert.equal((await call).status, 403);
  }
});

await check('stages only move forward', async () => {
  const back = await advanceStage(req({ headers: auth, params: { id: batchId }, body: { stage: 'ordering' } }), ctx);
  assert.equal(back.status, 409);
  const bogus = await advanceStage(req({ headers: auth, params: { id: batchId }, body: { stage: 'teleported' } }), ctx);
  assert.equal(bogus.status, 400);
});

await check('advancing a batch writes tracking onto every order in it', async () => {
  // Put a real order in the batch first.
  await assignToLot(req({ headers: auth, params: { id: batchId }, body: { listingIds: [published.jsonBody.listing.id] } }), ctx);
  const buyer = await signup(req({
    body: { displayName: 'Buyer Two', email: 'b2@figmark.example', phone: '+919000054321', password: 'longenough1' },
  }), ctx);
  const buyerAuth = { authorization: `Bearer ${buyer.jsonBody.token}` };
  const placed = await createOrder(req({ headers: buyerAuth, body: { listingId: published.jsonBody.listing.id } }), ctx);
  assert.equal(placed.status, 201);
  assert.equal(placed.jsonBody.order.lotId, batchId, 'the order inherits the item\'s batch');

  const moved = await advanceStage(req({ headers: auth, params: { id: batchId }, body: { stage: 'china_wh_received', note: 'Checked in' } }), ctx);
  assert.equal(moved.status, 200);
  assert.ok(moved.jsonBody.ordersUpdated >= 1);

  const tracked = (await orderTracking(req({ headers: buyerAuth, params: { id: placed.jsonBody.order.id } }), ctx)).jsonBody;
  assert.equal(tracked.currentStage, 'china_wh_received');
  assert.ok(tracked.order.stageHistory.some((e) => e.note === 'Checked in'));
});

await check("the buyer's order view never names the batch", async () => {
  const buyer = await login(req({ body: { identifier: 'b2@figmark.example', password: 'longenough1' } }), ctx);
  const orders = (await myActivity(req({ headers: { authorization: `Bearer ${buyer.jsonBody.token}` } }), ctx)).jsonBody.orders;
  const view = (await orderTracking(req({ headers: { authorization: `Bearer ${buyer.jsonBody.token}` }, params: { id: orders[0].id } }), ctx)).jsonBody;
  assert.ok(!('lot' in view), 'no lot object');
  assert.ok(!JSON.stringify(view).includes('Test consignment'), 'the batch name must not leak');
  // But the two facts it does contribute are present.
  assert.ok('trackingReference' in view && 'estimatedDispatchAt' in view);
});

await check('tracking reference reaches the buyer', async () => {
  await setTracking(req({ headers: auth, params: { id: batchId }, body: { trackingReference: 'TF-999' } }), ctx);
  const buyer = await login(req({ body: { identifier: 'b2@figmark.example', password: 'longenough1' } }), ctx);
  const orders = (await myActivity(req({ headers: { authorization: `Bearer ${buyer.jsonBody.token}` } }), ctx)).jsonBody.orders;
  const view = (await orderTracking(req({ headers: { authorization: `Bearer ${buyer.jsonBody.token}` }, params: { id: orders[0].id } }), ctx)).jsonBody;
  assert.equal(view.trackingReference, 'TF-999');
});

await check('a direct sale tracks against the short vocabulary', async () => {
  const buyer = await login(req({ body: { identifier: 'b2@figmark.example', password: 'longenough1' } }), ctx);
  const buyerAuth = { authorization: `Bearer ${buyer.jsonBody.token}` };
  // lst_handheld is not in any batch.
  const placed = await createOrder(req({ headers: buyerAuth, body: { listingId: 'lst_handheld' } }), ctx);
  const view = (await orderTracking(req({ headers: buyerAuth, params: { id: placed.jsonBody.order.id } }), ctx)).jsonBody;
  assert.deepEqual(view.stages, ['preparing', 'dispatched', 'delivered']);
  assert.equal(view.currentStage, 'preparing');
});

await check('an order is private to its buyer and seller', async () => {
  const stranger = await signup(req({
    body: { displayName: 'Nosy', email: 'nosy@figmark.example', phone: '+919000011111', password: 'longenough1' },
  }), ctx);
  const orders = (await myActivity(req({ headers: auth }), ctx)).jsonBody.orders;
  const peek = await orderTracking(req({
    headers: { authorization: `Bearer ${stranger.jsonBody.token}` },
    params: { id: orders[0].id },
  }), ctx);
  assert.equal(peek.status, 403);
});

/* ── storefront and dashboards ─────────────────────────────────────────── */
console.log('\nstorefront and dashboards');

await check('the storefront can be designed, and reads back', async () => {
  const saved = await saveStorefront(req({
    headers: auth,
    body: {
      storefrontName: 'Arjun Collects Deluxe',
      bio: 'Resales from my own shelf.',
      dispatchRegion: 'Mumbai, MH',
      link: 'instagram.com/arjuncollects',
    },
  }), ctx);
  assert.equal(saved.status, 200);
  assert.equal(saved.jsonBody.storefront.storefrontName, 'Arjun Collects Deluxe');
  // A bare host is still a link; it is stored as one that a browser can follow.
  assert.equal(saved.jsonBody.storefront.link, 'https://instagram.com/arjuncollects');
  assert.equal(saved.jsonBody.storefront.storefrontSlug, 'arjun-collects-deluxe');

  const read = await storefront(req({ headers: auth }), ctx);
  assert.equal(read.jsonBody.storefront.bio, 'Resales from my own shelf.');
});

await check('a link that is not a link is refused, not rendered', async () => {
  // The storefront link is shown as an href on a public page, so a
  // javascript: URL there is stored XSS. Refused at the door rather than
  // sanitised at the point of rendering.
  for (const link of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'not a url at all']) {
    const refused = await saveStorefront(req({ headers: auth, body: { link } }), ctx);
    assert.equal(refused.status, 400, `expected ${link} to be refused`);
  }
});

await check('an empty storefront name is refused', async () => {
  const refused = await saveStorefront(req({ headers: auth, body: { storefrontName: '  ' } }), ctx);
  assert.equal(refused.status, 400);
});

await check('the storefront is private to its owner', async () => {
  assert.equal((await storefront(req(), ctx)).status, 401);
  assert.equal((await saveStorefront(req({ body: { storefrontName: 'Nope' } }), ctx)).status, 401);
});

await check('the dashboard reports tracking and analytics together', async () => {
  const body = (await dashboard(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.tracking.openLots >= 1);
  assert.equal(body.analytics.daily.length, 30, 'thirty days, one entry each');
  assert.ok(body.analytics.activeListings >= 2);
  // Revenue is what the seller sold, never what they bought.
  assert.ok(body.analytics.revenueMinor >= 0);
  assert.ok(body.analytics.conversion >= 0 && body.analytics.conversion <= 1);
});

/* ── social ────────────────────────────────────────────────────────────── */
console.log('\nsocial');

await check('the feed carries posts from the sellers you follow', async () => {
  const body = (await socialFeed(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.posts.length > 0);
  const authors = new Set(body.posts.map((card) => card.post.channelId));
  assert.ok(authors.has('usr_kaiju'), 'expected a followed seller in the feed');
  // Newest first, so the feed reads as a feed.
  const dates = body.posts.map((card) => card.post.createdAt);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

await check('a sale post carries the item, so it can be rendered inline', async () => {
  const body = (await socialFeed(req({ headers: auth }), ctx)).jsonBody;
  const sale = body.posts.find((card) => card.post.kind === 'sale');
  assert.ok(sale, 'expected a sale post');
  assert.ok(sale.listing, 'a sale post must carry its listing');
  assert.equal(typeof sale.listing.priceMinor, 'number');
});

await check('the feed never carries someone you do not follow', async () => {
  const body = (await socialFeed(req({ headers: auth }), ctx)).jsonBody;
  const followed = new Set([...(await feed(req({ headers: auth }), ctx)).jsonBody.followedSellerIds, 'usr_demo']);
  for (const card of body.posts) {
    assert.ok(followed.has(card.post.channelId), `${card.post.channelId} is not followed`);
  }
});

await check('channels list one row per followed seller, newest first', async () => {
  const body = (await channels(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.channels.length >= 2);
  const times = body.channels.map((row) => row.lastPostAt ?? '');
  assert.deepEqual(times, [...times].sort().reverse());
  assert.ok(body.channels.every((row) => typeof row.name === 'string'));
});

await check('a channel thread is that channel and nothing else', async () => {
  const body = (await channelThread(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  assert.equal(body.channel.kind, 'seller');
  assert.ok(body.posts.length >= 2);
  assert.ok(body.posts.every((card) => card.post.channelId === 'usr_kaiju'));
});

await check('posting an update goes to your own channel, never anyone else\'s', async () => {
  const created = await createPost(req({ headers: auth, body: { body: 'Fresh batch landing Friday.' } }), ctx);
  assert.equal(created.status, 201);
  // The channel is taken from the session, so there is no field to point it
  // at another seller in the first place.
  assert.equal(created.jsonBody.post.channelId, 'usr_demo');
  assert.equal(created.jsonBody.post.kind, 'update');

  const mine = await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx);
  assert.ok(mine.jsonBody.posts.some((card) => card.post.body === 'Fresh batch landing Friday.'));
});

await check('a sale post must point at an item you actually sell', async () => {
  const mine = await createPost(req({
    headers: auth, body: { body: 'This one is up.', listingId: 'lst_my_statue' },
  }), ctx);
  assert.equal(mine.jsonBody.post.kind, 'sale');
  assert.equal(mine.jsonBody.post.listingId, 'lst_my_statue');

  const theirs = await createPost(req({
    headers: auth, body: { body: 'Not mine.', listingId: 'lst_dragon_knight' },
  }), ctx);
  assert.equal(theirs.status, 404);
});

await check('an empty post is refused, and posting needs a session', async () => {
  assert.equal((await createPost(req({ headers: auth, body: { body: '   ' } }), ctx)).status, 400);
  assert.equal((await createPost(req({ body: { body: 'hello' } }), ctx)).status, 401);
});

await check('forums list with the cap and what is left of it', async () => {
  const body = (await listForums(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.forums.length >= 3);
  assert.equal(body.remaining, body.cap - body.forums.length);
});

await check('a forum can be created, and posted into', async () => {
  const created = await createForum(req({
    headers: auth, body: { name: 'Packing and repack', description: 'How to not have it arrive broken.' },
  }), ctx);
  assert.equal(created.status, 201);

  const posted = await createPost(req({
    headers: auth, body: { body: 'Double-box anything resin.', forumId: created.jsonBody.forum.id },
  }), ctx);
  assert.equal(posted.status, 201);
  assert.equal(posted.jsonBody.post.channel, 'forum');
  assert.equal(posted.jsonBody.post.kind, 'thread');

  const thread = await channelThread(req({ headers: auth, params: { id: created.jsonBody.forum.id } }), ctx);
  assert.equal(thread.jsonBody.channel.kind, 'forum');
  assert.equal(thread.jsonBody.posts.length, 1);
});

await check('forums are capped, and the refusal says so', async () => {
  // Fill whatever is left, then prove the next one is refused rather than
  // silently accepted - the cap is the feature being deliberately small.
  let remaining = (await listForums(req({ headers: auth }), ctx)).jsonBody.remaining;
  for (let index = 0; index < remaining; index += 1) {
    const filler = await createForum(req({ headers: auth, body: { name: `Filler room ${index}` } }), ctx);
    assert.equal(filler.status, 201);
  }
  const refused = await createForum(req({ headers: auth, body: { name: 'One too many' } }), ctx);
  assert.equal(refused.status, 409);
  assert.equal(refused.jsonBody.error, 'forum_cap_reached');
});

await check('a duplicate forum name is refused', async () => {
  const again = await createForum(req({ headers: auth, body: { name: 'Import questions' } }), ctx);
  // Either reason is correct here; both keep the room list clean.
  assert.equal(again.status, 409);
});

/* ── stores and who runs them ──────────────────────────────────────────── */
console.log('\nstores and who runs them');

// A second account, to be brought into the demo account's shop.
const helperSession = await signup(req({
  body: { displayName: 'Helper Person', email: 'helper@figmark.example', phone: '+919000088888', password: 'longenough1' },
}), ctx);
const helper = { authorization: `Bearer ${helperSession.jsonBody.token}` };
const helperId = helperSession.jsonBody.user.id;

await check('a fresh account runs no stores, which is what the sell tab asks', async () => {
  const body = (await myStores(req({ headers: helper }), ctx)).jsonBody;
  assert.deepEqual(body.stores, []);
});

await check('opening a storefront is what makes a store exist', async () => {
  const before = (await myStores(req({ headers: auth }), ctx)).jsonBody;
  assert.equal(before.stores.length, 1, 'the demo account already has one');
  assert.equal(before.stores[0].isOwner, true);
  // Ownership is total, and expanded once so a check is a plain includes.
  assert.deepEqual(
    [...before.stores[0].permissions].sort(),
    ['admin', 'analytics', 'listings', 'lots', 'posts'],
  );
});

await check('an admin can bring someone in with only the rights they chose', async () => {
  const added = await updateManagers(req({
    headers: auth,
    body: { identifier: 'helper@figmark.example', permissions: ['listings', 'posts'] },
  }), ctx);
  assert.equal(added.status, 200);
  assert.equal(added.jsonBody.managers.length, 1);
  assert.equal(added.jsonBody.managers[0].userId, helperId);
  assert.deepEqual(added.jsonBody.managers[0].permissions, ['listings', 'posts']);

  const theirs = (await myStores(req({ headers: helper }), ctx)).jsonBody;
  assert.equal(theirs.stores.length, 1);
  assert.equal(theirs.stores[0].isOwner, false);
  assert.deepEqual([...theirs.stores[0].permissions].sort(), ['listings', 'posts']);
});

await check('a manager lists into the store, not into their own', async () => {
  const listed = await createListing(req({
    headers: helper,
    body: { title: 'Filed on behalf of the shop', priceMinor: 30_000, storeId: 'usr_demo' },
  }), ctx);
  assert.equal(listed.status, 201);
  // The seller is the store, which is also the partition its items live in.
  assert.equal(listed.jsonBody.listing.sellerId, 'usr_demo');
});

await check('a manager posts as the store, under the store name', async () => {
  const posted = await createPost(req({
    headers: helper, body: { body: 'New arrivals up now.', storeId: 'usr_demo' },
  }), ctx);
  assert.equal(posted.status, 201);
  assert.equal(posted.jsonBody.post.channelId, 'usr_demo');
  assert.equal(posted.jsonBody.post.authorName, 'Arjun Collects Deluxe');
  // The author is still the person who typed it, which is what an audit needs.
  assert.equal(posted.jsonBody.post.authorId, helperId);
});

await check('rights not granted are refused', async () => {
  // Granted listings and posts, so lots and analytics are not theirs, and
  // neither is handing out access.
  const grabbing = await updateManagers(req({
    headers: helper,
    body: { storeId: 'usr_demo', identifier: DEMO_EMAIL, permissions: ['admin'] },
  }), ctx);
  assert.equal(grabbing.status, 403);
});

await check('a store you have no rights in is closed to you', async () => {
  const listing = await createListing(req({
    headers: helper, body: { title: 'Not my shop', priceMinor: 1000, storeId: 'usr_kaiju' },
  }), ctx);
  assert.equal(listing.status, 403);

  const post = await createPost(req({
    headers: helper, body: { body: 'Speaking for someone else.', storeId: 'usr_kaiju' },
  }), ctx);
  assert.equal(post.status, 403);
});

await check('a sale post must name an item the store sells, not the poster', async () => {
  const wrong = await createPost(req({
    headers: helper,
    body: { body: 'Look at this.', storeId: 'usr_demo', listingId: 'lst_dragon_knight' },
  }), ctx);
  assert.equal(wrong.status, 404);
});

await check('the owner cannot be demoted into a manager slot', async () => {
  const self = await updateManagers(req({
    headers: auth, body: { identifier: DEMO_EMAIL, permissions: ['listings'] },
  }), ctx);
  assert.equal(self.status, 400);
});

await check('removing someone takes the store away with it', async () => {
  const removed = await updateManagers(req({
    headers: auth, body: { identifier: 'helper@figmark.example', remove: true },
  }), ctx);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.jsonBody.managers, []);

  const theirs = (await myStores(req({ headers: helper }), ctx)).jsonBody;
  assert.deepEqual(theirs.stores, []);

  const refused = await createListing(req({
    headers: helper, body: { title: 'Still trying', priceMinor: 1000, storeId: 'usr_demo' },
  }), ctx);
  assert.equal(refused.status, 403);
});

/* ── the lot board ─────────────────────────────────────────────────────── */
console.log('\nthe lot board');

await check('the board counts orders past each checkpoint, never a lot state', async () => {
  const body = (await lotsBoard(req({ headers: auth }), ctx)).jsonBody;
  const open = body.lots.find((entry) => entry.lot.id === 'lot_open_24');
  assert.ok(open, 'expected the open lot');
  assert.equal(open.tally.customers, 15);
  assert.equal(open.tally.orders, 34);

  // The straggler is the whole point: 33 of 34 landed, one has not.
  const china = open.tally.counts.find((row) => row.checkpoint === 'china_received');
  assert.equal(china.done, 33);
  assert.equal(china.total, 34);
});

await check('the card charts three checkpoints, in travel order', async () => {
  const body = (await lotsBoard(req({ headers: auth }), ctx)).jsonBody;
  const open = body.lots.find((entry) => entry.lot.id === 'lot_open_24');
  assert.deepEqual(
    open.tally.progress.map((row) => row.checkpoint),
    ['china_received', 'china_packed', 'india_received'],
  );
});

await check('a lot is grouped by customer, because a parcel goes to a person', async () => {
  const body = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.equal(body.customers.length, 15);
  assert.equal(body.customers.reduce((sum, c) => sum + c.orders.length, 0), 34);
  // Alphabetical: a packing list is worked through, not ranked.
  const names = body.customers.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.ok(body.customers.every((c) => c.name !== 'Unknown'), 'every buyer resolves to a name');
});

await check('ticking a checkpoint moves the count, and unticking moves it back', async () => {
  const before = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  const target = before.customers[0].orders[0];
  assert.equal(Boolean(target.checkpoints.china_packed), false);

  const ticked = await setCheckpoint(req({
    headers: auth, params: { id: target.id }, body: { checkpoint: 'china_packed', on: true },
  }), ctx);
  assert.equal(ticked.status, 200);
  assert.ok(ticked.jsonBody.order.checkpoints.china_packed, 'a tick records when, not just whether');
  assert.equal(ticked.jsonBody.tally.counts.find((r) => r.checkpoint === 'china_packed').done, 1);

  const undone = await setCheckpoint(req({
    headers: auth, params: { id: target.id }, body: { checkpoint: 'china_packed', on: false },
  }), ctx);
  assert.equal(undone.jsonBody.order.checkpoints.china_packed, null);
  assert.equal(undone.jsonBody.tally.counts.find((r) => r.checkpoint === 'china_packed').done, 0);
});

await check('a customer counts as ready only when everything of theirs is', async () => {
  const board = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  // Someone with more than one order, so "all of it" means something.
  const many = board.customers.find((c) => c.orders.length > 1);
  assert.ok(many, 'expected a customer with several orders');

  let tally;
  for (const [index, order] of many.orders.entries()) {
    const result = await setCheckpoint(req({
      headers: auth, params: { id: order.id }, body: { checkpoint: 'ready_to_dispatch', on: true },
    }), ctx);
    tally = result.jsonBody.tally;
    // Not ready until the last one: a parcel goes out whole.
    if (index < many.orders.length - 1) assert.equal(tally.customersReady, 0);
  }
  assert.equal(tally.customersReady, 1);
});

await check('an unknown checkpoint is refused rather than stored', async () => {
  const board = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  const order = board.customers[0].orders[0];
  const refused = await setCheckpoint(req({
    headers: auth, params: { id: order.id }, body: { checkpoint: 'teleported', on: true },
  }), ctx);
  assert.equal(refused.status, 400);
});

await check('another seller cannot read or tick this lot', async () => {
  const stranger = await signup(req({
    body: { displayName: 'Rival Seller', email: 'rival@figmark.example', phone: '+919000066666', password: 'longenough1' },
  }), ctx);
  assert.equal(stranger.status, 201, `signup failed: ${JSON.stringify(stranger.jsonBody)}`);
  const theirs = { authorization: `Bearer ${stranger.jsonBody.token}` };

  const read = await lotBoard(req({ headers: theirs, params: { id: 'lot_open_24' } }), ctx);
  assert.equal(read.status, 404, 'a lot outside your partition simply is not there');

  const board = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  const tick = await setCheckpoint(req({
    headers: theirs, params: { id: board.customers[0].orders[0].id },
    body: { checkpoint: 'china_packed', on: true },
  }), ctx);
  assert.equal(tick.status, 403);
});

console.log(`\n${passed} checks passed`);
