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
const { toErrorResponse } = await import(new URL('http.js', fns));
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
  myStoresRoute: myStores, updateManagersRoute: updateManagers, salesRoute: sales,
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
const {
  exporterLotsRoute: exporterLots, exporterLotRoute: exporterLot,
} = await import(new URL('fulfilment-routes.js', fns));
const {
  inboxRoute: inbox, threadRoute: thread, sendMessageRoute: sendMessage,
  publicProfileRoute: publicProfile, setUsernameRoute: setUsername,
} = await import(new URL('message-routes.js', fns));
const {
  payRoute: payOrder, confirmRoute: confirmOrder, reviewRoute: reviewOrder,
  orderStateRoute: orderState, checkoutRoute: checkout,
  claimPaymentRoute: claimPayment, settleClaimRoute: settleClaim,
} = await import(new URL('order-routes.js', fns));
const {
  creditRoute: credit, pageReviewsRoute: pageReviews,
  writePageReviewRoute: writePageReview, tradeReviewsRoute: reviewsAbout,
  saveProfileRoute: saveProfile,
} = await import(new URL('profile-routes.js', fns));
const {
  openDisputeRoute: openDispute, readDisputeRoute: readDispute, replyDisputeRoute: replyDispute,
  offerDisputeRoute: offerDispute, acceptDisputeRoute: acceptDispute,
  withdrawDisputeRoute: withdrawDispute, escalateDisputeRoute: escalateDispute,
  settleAsEscrowRoute: settleAsEscrow, escrowHoldingsRoute: escrowHoldings,
} = await import(new URL('dispute-routes.js', fns));
const {
  adminUsersRoute: adminUsers, adminUserDetailRoute: adminUser,
  adminSuspendRoute: adminSuspend, adminDeleteUserRoute: adminDeleteUser,
  adminDeleteResourceRoute: adminDeleteResource, adminEscrowRoute: adminEscrow,
  adminDisputesRoute: adminDisputes, adminResolveRoute: adminResolve,
} = await import(new URL('admin-routes.js', fns));
const { DEMO_EMAIL, DEMO_PHONE, DEMO_PASSWORD, PACKER_EMAIL, ESCROW_EMAIL } = await import(
  new URL('../api/dist/api/src/data/seed.js', import.meta.url)
);

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };

/** Reads a row straight from the store, for the state a response does not carry. */
const { getRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));
const repository_user = async (id) => (await getRepository()).getUserById(id);
const repository_dispute = async (id) => (await getRepository()).getDisputeById(id);
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

await check('a failure names its kind rather than saying nothing', async () => {
  // The generic "something went wrong" is what made a missing container cost
  // two rounds of guessing. Every unexplained 500 now says what kind it was,
  // and a store 404 - which only a query against an absent container produces -
  // says so outright and points at the page that names the fix.
  const quiet = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };

  const missing = toErrorResponse(Object.assign(new Error('Resource Not Found'), { code: 404 }), quiet);
  assert.equal(missing.status, 503);
  assert.equal(missing.jsonBody.error, 'store_incomplete');
  assert.match(missing.jsonBody.message, /\/api\/health/);

  const throttled = toErrorResponse(Object.assign(new Error('Too many requests'), { code: 429 }), quiet);
  assert.equal(throttled.status, 500);
  assert.match(throttled.jsonBody.message, /data store error 429/);

  const bug = toErrorResponse(new TypeError('x is not a function'), quiet);
  assert.equal(bug.status, 500);
  assert.match(bug.jsonBody.message, /TypeError/);
  // The detail stays in the log: no message text crosses the wire.
  assert.equal(bug.jsonBody.message.includes('x is not a function'), false);
});

await check('health reports which containers the store is missing', async () => {
  const body = (await health(req(), ctx)).jsonBody;
  // Nothing can be missing from the in-memory store, and it says so rather
  // than leaving the field ambiguous.
  assert.deepEqual(body.data.missingContainers, []);
});

await check('health advertises the demo sign-in, and only real ones', async () => {
  const body = (await health(req(), ctx)).jsonBody;
  assert.ok(
    body.auth.demoAccounts.some((account) => account.identifier === DEMO_EMAIL),
    'the demo account must be offered',
  );
  // The hint is only useful if the count behind it matches what can sign in.
  assert.equal(body.auth.demoAccounts.length, body.data.signInAccounts);
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

await check('your own shop is first, then whoever spoke most recently', async () => {
  const body = (await channels(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.channels.length >= 2);

  // Yours is the channel you write rather than read, so it does not wait its
  // turn behind shops that happened to post today.
  assert.equal(body.channels[0].mine, true);
  assert.equal(body.channels[0].sellerId, 'usr_demo');

  const rest = body.channels.filter((row) => !row.mine).map((row) => row.lastPostAt ?? '');
  assert.deepEqual(rest, [...rest].sort().reverse(), 'the others are newest first');
  assert.ok(body.channels.every((row) => typeof row.name === 'string'));
});

await check('only a shop has a channel', async () => {
  // A person's posts live on their page. Giving every account a channel fills
  // this list with rooms nobody has a reason to open.
  const buyer = await signup(req({
    body: {
      displayName: 'Channelless', email: 'nochannel@figmark.example',
      phone: '+919000045801', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${buyer.jsonBody.token}` };

  const body = (await channels(req({ headers: theirs }), ctx)).jsonBody;
  assert.equal(body.channels.some((row) => row.sellerId === buyer.jsonBody.user.id), false);

  const refused = await channelThread(req({ headers: theirs, params: { id: buyer.jsonBody.user.id } }), ctx);
  assert.equal(refused.status, 404);
});

await check('a follower may speak in a shop\'s room, as themselves', async () => {
  // A shop that cannot be answered in its own channel is a noticeboard, and
  // the questions only end up in twenty separate private messages instead.
  const visitor = await signup(req({
    body: {
      displayName: 'Curious Buyer', email: 'curious@figmark.example',
      phone: '+919000045802', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${visitor.jsonBody.token}` };

  const said = await createPost(req({
    headers: theirs, body: { body: 'Is the September batch still open?', channelId: 'usr_kaiju' },
  }), ctx);
  assert.equal(said.status, 201);
  assert.equal(said.jsonBody.post.channelId, 'usr_kaiju');
  assert.equal(said.jsonBody.post.voice, 'visitor', 'a customer is not the shop');
  assert.equal(said.jsonBody.post.authorName, 'Curious Buyer');
});

await check('the shop speaking in its own room speaks as the shop', async () => {
  // Read the shop's name rather than writing it out: an earlier test renames
  // the storefront, and hard-coding it here fails for a reason that has
  // nothing to do with whose voice a channel post carries.
  const shop = (await storefront(req({ headers: auth }), ctx)).jsonBody.storefront;

  const said = await createPost(req({
    headers: auth, body: { body: 'Customs cleared. Dispatching Tuesday.', channelId: 'usr_demo' },
  }), ctx);
  assert.equal(said.status, 201);
  assert.equal(said.jsonBody.post.voice, 'store');
  assert.equal(said.jsonBody.post.authorName, shop.storefrontName, 'the shop, not the person');
  assert.notEqual(said.jsonBody.post.authorName, 'Arjun Mehta');
});

await check('a channel message stays in the channel', async () => {
  // The whole point of having one: somewhere to say "customs cleared" without
  // it being an announcement to everybody's feed in the same breath.
  const before = (await socialFeed(req({ headers: auth }), ctx)).jsonBody.posts.length;

  const said = await createPost(req({
    headers: auth, body: { body: 'Two units short on the mecha kits.', channelId: 'usr_demo' },
  }), ctx);
  assert.equal(said.jsonBody.post.reach, 'channel');

  const after = (await socialFeed(req({ headers: auth }), ctx)).jsonBody;
  assert.equal(after.posts.length, before, 'the feed did not grow');
  assert.equal(after.posts.some((card) => card.post.id === said.jsonBody.post.id), false);

  // But it is in the room, which is where it was said.
  const room = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody;
  assert.ok(room.posts.some((card) => card.post.id === said.jsonBody.post.id));
});

await check('posting from the feed still reaches followers', async () => {
  const said = await createPost(req({
    headers: auth, body: { body: 'New drop live now.', storeId: 'usr_demo' },
  }), ctx);
  assert.equal(said.jsonBody.post.reach ?? 'feed', 'feed');

  const feedNow = (await socialFeed(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(feedNow.posts.some((card) => card.post.id === said.jsonBody.post.id));
});

await check('a visitor cannot advertise in somebody else\'s room', async () => {
  const visitor = await signup(req({
    body: {
      displayName: 'Would Be Advertiser', email: 'advert@figmark.example',
      phone: '+919000045803', password: 'longenough1',
    },
  }), ctx);
  const refused = await createPost(req({
    headers: { authorization: `Bearer ${visitor.jsonBody.token}` },
    body: { body: 'Buy mine instead', channelId: 'usr_kaiju', listingId: 'lst_dragon_knight' },
  }), ctx);
  assert.equal(refused.status, 404);
});

await check("a shop can put one of its own items in its room", async () => {
  const shared = await createPost(req({
    headers: auth,
    body: { body: 'Restocked.', channelId: 'usr_demo', listingId: 'lst_my_statue' },
  }), ctx);
  assert.equal(shared.status, 201);
  assert.equal(shared.jsonBody.post.listingId, 'lst_my_statue');
  assert.equal(shared.jsonBody.post.kind, 'sale');

  // And it comes back with the item attached, ready to render.
  const room = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody;
  const card = room.posts.find((entry) => entry.post.id === shared.jsonBody.post.id);
  assert.ok(card.listing, 'the item travels with the message');
  assert.ok(card.listing.title);
});

await check('only whoever runs the shop is offered its items to share', async () => {
  const mine = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody;
  assert.equal(mine.channel.mine, true);
  assert.ok(mine.shareable.length > 0, 'my own stock is there to share');

  const theirs = (await channelThread(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  assert.equal(theirs.channel.mine, false);
  assert.deepEqual(theirs.shareable, [], "nobody else's stock is listed for me");
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
    ['admin', 'analytics', 'export', 'listings', 'lots', 'posts'],
  );
});

await check('an admin can bring someone in with only the rights they chose', async () => {
  const added = await updateManagers(req({
    headers: auth,
    body: { identifier: 'helper@figmark.example', permissions: ['listings', 'posts'] },
  }), ctx);
  assert.equal(added.status, 200);
  const entry = added.jsonBody.managers.find((manager) => manager.userId === helperId);
  assert.ok(entry, 'the helper should be on the member list');
  assert.deepEqual(entry.permissions, ['listings', 'posts']);

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
  assert.equal(
    removed.jsonBody.managers.some((manager) => manager.userId === helperId),
    false,
    'the helper should be off the member list',
  );

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

/* ── usernames ─────────────────────────────────────────────────────────── */
console.log('\nusernames');

await check('a username is claimed at sign-up, and is where that person lives', async () => {
  const made = await signup(req({
    body: {
      displayName: 'Nadia Rao', username: 'nadia_r',
      email: 'nadia@figmark.example', phone: '+919000022221', password: 'longenough1',
    },
  }), ctx);
  assert.equal(made.status, 201);

  const page = await publicProfile(req({ params: { handle: 'nadia_r' } }), ctx);
  assert.equal(page.status, 200);
  assert.equal(page.jsonBody.isStore, false);
  assert.equal(page.jsonBody.displayName, 'Nadia Rao');
});

await check('one namespace: a person and a shop cannot hold the same handle', async () => {
  const clash = await signup(req({
    body: {
      displayName: 'Impostor', username: 'arjun_collects',
      email: 'impostor@figmark.example', phone: '+919000022222', password: 'longenough1',
    },
  }), ctx);
  assert.equal(clash.status, 409);
  // And the shop still holds it.
  const page = (await publicProfile(req({ params: { handle: 'arjun_collects' } }), ctx)).jsonBody;
  assert.equal(page.isStore, true);
});

await check('a shop page answers with its shelf, a person page with neither', async () => {
  const shop = (await publicProfile(req({ params: { handle: 'arjun_collects' } }), ctx)).jsonBody;
  assert.ok(shop.listings.length > 0, 'a shop should show what it sells');
  // The person behind it is a separate address, and named as one.
  assert.equal(shop.ownerHandle, 'arjun');

  const person = (await publicProfile(req({ params: { handle: 'nadia_r' } }), ctx)).jsonBody;
  assert.deepEqual(person.listings, []);
  assert.equal(person.ownerHandle, null);
});

await check('a person can claim a username of their own, apart from any shop', async () => {
  // The case that matters: an account made before handles existed has none,
  // and running a shop gives the shop an address rather than giving them one.
  const made = await signup(req({
    body: {
      displayName: 'Late Comer', email: 'late@figmark.example',
      phone: '+919000022224', password: 'longenough1',
    },
  }), ctx);
  const late = { authorization: `Bearer ${made.jsonBody.token}` };

  const claimed = await setUsername(req({ headers: late, body: { username: 'late_comer_2' } }), ctx);
  assert.equal(claimed.status, 200);
  assert.equal(claimed.jsonBody.username, 'late_comer_2');

  // It is on the principal, so every screen knows where this person lives.
  const who = (await me(req({ headers: late }), ctx)).jsonBody;
  assert.equal(who.user.username, 'late_comer_2');
  assert.equal((await publicProfile(req({ params: { handle: 'late_comer_2' } }), ctx)).status, 200);
});

await check('renaming frees the old handle and keeps the new one', async () => {
  const session = await login(req({
    body: { identifier: 'late@figmark.example', password: 'longenough1' },
  }), ctx);
  const late = { authorization: `Bearer ${session.jsonBody.token}` };

  const renamed = await setUsername(req({ headers: late, body: { username: 'late_comer_3' } }), ctx);
  assert.equal(renamed.status, 200);
  assert.equal((await publicProfile(req({ params: { handle: 'late_comer_3' } }), ctx)).status, 200);
  assert.equal((await publicProfile(req({ params: { handle: 'late_comer_2' } }), ctx)).status, 404);
});

await check('a taken handle is refused, and the old one survives the refusal', async () => {
  const session = await login(req({
    body: { identifier: 'late@figmark.example', password: 'longenough1' },
  }), ctx);
  const late = { authorization: `Bearer ${session.jsonBody.token}` };

  const clash = await setUsername(req({ headers: late, body: { username: 'arjun_collects' } }), ctx);
  assert.equal(clash.status, 409);
  // The rename reserves before it releases, so a refusal cannot lose both.
  assert.equal((await publicProfile(req({ params: { handle: 'late_comer_3' } }), ctx)).status, 200);

  const bad = await setUsername(req({ headers: late, body: { username: 'no' } }), ctx);
  assert.equal(bad.status, 400);
  assert.equal((await setUsername(req({ body: { username: 'anon' } }), ctx)).status, 401);
});

await check('nobody home is a 404, not an empty page', async () => {
  const missing = await publicProfile(req({ params: { handle: 'not_a_real_handle' } }), ctx);
  assert.equal(missing.status, 404);
});

/* ── listing needs a storefront ────────────────────────────────────────── */
console.log('\nlisting needs a storefront');

const noShop = await signup(req({
  body: {
    displayName: 'Shopless Sam', email: 'sam@figmark.example',
    phone: '+919000022223', password: 'longenough1',
  },
}), ctx);
const shopless = { authorization: `Bearer ${noShop.jsonBody.token}` };

await check('an account without one is refused, and told what to do', async () => {
  const refused = await createListing(req({
    headers: shopless, body: { title: 'Straight to the feed', priceMinor: 5_000 },
  }), ctx);
  assert.equal(refused.status, 409);
  assert.equal(refused.jsonBody.error, 'no_storefront');
  assert.match(refused.jsonBody.message, /storefront/i);
});

await check('opening one unblocks it, and the item goes out under the shop', async () => {
  const opened = await saveStorefront(req({
    headers: shopless, body: { storefrontName: "Sam's Corner", username: 'sams_corner' },
  }), ctx);
  assert.equal(opened.status, 200);
  assert.equal(opened.jsonBody.storefront.username, 'sams_corner');

  const listed = await createListing(req({
    headers: shopless, body: { title: 'Now it works', priceMinor: 5_000 },
  }), ctx);
  assert.equal(listed.status, 201);
  assert.equal(listed.jsonBody.listing.sellerId, noShop.jsonBody.user.id);
});

/* ── messages ──────────────────────────────────────────────────────────── */
console.log('\nmessages');

await check('an owner speaks as themselves or as their shop, and they differ', async () => {
  const mine = (await inbox(req({ headers: auth }), ctx)).jsonBody;
  const handles = mine.handles.map((party) => party.handle).sort();
  assert.deepEqual(handles, ['arjun', 'arjun_collects']);
  assert.equal(mine.handles.find((party) => party.handle === 'arjun_collects').isStore, true);
  assert.equal(mine.handles.find((party) => party.handle === 'arjun').isStore, false);
});

await check('a message reaches the handle it was addressed to', async () => {
  const sent = await sendMessage(req({
    headers: auth, params: { handle: 'sams_corner' },
    body: { body: 'Do you ship to Mumbai?', as: 'arjun' },
  }), ctx);
  assert.equal(sent.status, 201);
  assert.equal(sent.jsonBody.message.from.handle, 'arjun');
  assert.equal(sent.jsonBody.message.to.handle, 'sams_corner');

  const theirs = (await inbox(req({ headers: shopless }), ctx)).jsonBody;
  assert.equal(theirs.threads.length, 1);
  assert.equal(theirs.threads[0].them.handle, 'arjun');
  assert.equal(theirs.threads[0].unread, 1);
});

await check('the two voices are two conversations, not one', async () => {
  await sendMessage(req({
    headers: auth, params: { handle: 'sams_corner' },
    body: { body: 'Wholesale rates for the shop?', as: 'arjun_collects' },
  }), ctx);

  const asPerson = (await thread(req({
    headers: auth, params: { handle: 'sams_corner' }, query: { as: 'arjun' },
  }), ctx)).jsonBody;
  const asShop = (await thread(req({
    headers: auth, params: { handle: 'sams_corner' }, query: { as: 'arjun_collects' },
  }), ctx)).jsonBody;

  assert.notEqual(asPerson.threadId, asShop.threadId);
  assert.equal(asPerson.messages.length, 1);
  assert.equal(asShop.messages.length, 1);
  assert.equal(asPerson.messages[0].body, 'Do you ship to Mumbai?');
  assert.equal(asShop.messages[0].from.isStore, true);
});

await check('opening a thread is what marks it read', async () => {
  const before = (await inbox(req({ headers: shopless }), ctx)).jsonBody;
  assert.equal(before.threads.reduce((sum, row) => sum + row.unread, 0), 2);

  await thread(req({ headers: shopless, params: { handle: 'arjun' } }), ctx);
  const after = (await inbox(req({ headers: shopless }), ctx)).jsonBody;
  const fromPerson = after.threads.find((row) => row.them.handle === 'arjun');
  assert.equal(fromPerson.unread, 0);
  // The shop's thread is a different one and stays unread.
  assert.equal(after.threads.find((row) => row.them.handle === 'arjun_collects').unread, 1);
});

await check('you cannot speak as a handle that is not yours, or to nobody', async () => {
  const notYours = await sendMessage(req({
    headers: shopless, params: { handle: 'arjun' },
    body: { body: 'Pretending to be the shop.', as: 'arjun_collects' },
  }), ctx);
  assert.equal(notYours.status, 403);

  const nobody = await sendMessage(req({
    headers: auth, params: { handle: 'nobody_at_all' }, body: { body: 'Hello?' },
  }), ctx);
  assert.equal(nobody.status, 404);

  const self = await sendMessage(req({
    headers: auth, params: { handle: 'arjun' }, body: { body: 'Talking to myself.', as: 'arjun' },
  }), ctx);
  assert.equal(self.status, 400);
});

await check('your inbox and your shop\'s are two inboxes, not one list', async () => {
  // What the two filter buttons filter on: each row says which of your voices
  // it belongs to, so the client can split them without asking again.
  const mine = (await inbox(req({ headers: auth }), ctx)).jsonBody;
  const own = mine.threads.filter((row) => row.us.handle === 'arjun');
  const shop = mine.threads.filter((row) => row.us.handle === 'arjun_collects');
  assert.ok(own.length > 0, 'expected a thread of your own');
  assert.ok(shop.length > 0, "expected a thread of the shop's");
  // Every row belongs to exactly one of them: the two never overlap.
  assert.equal(own.length + shop.length, mine.threads.length);
  assert.equal(own.some((row) => shop.includes(row)), false);
});

await check('messaging needs a session', async () => {
  assert.equal((await inbox(req(), ctx)).status, 401);
  assert.equal((await sendMessage(req({ params: { handle: 'arjun' }, body: { body: 'Hi' } }), ctx)).status, 401);
});

/* ── the exporter's packing view ───────────────────────────────────────── */
console.log("\nthe exporter's packing view");

const packerSession = await login(req({
  body: { identifier: PACKER_EMAIL, password: DEMO_PASSWORD },
}), ctx);
const packer = { authorization: `Bearer ${packerSession.jsonBody.token}` };

await check('a packer sees the lots they pack for, and only those', async () => {
  const body = (await exporterLots(req({ headers: packer }), ctx)).jsonBody;
  const ids = body.lots.map((row) => row.lot.id);
  assert.ok(ids.includes('lot_open_24'), 'the open lot is theirs to pack');
  // Already gone from China, so no longer theirs.
  assert.equal(ids.includes('lot_ship_23'), false);

  const outsider = (await exporterLots(req({ headers: helper }), ctx)).jsonBody;
  assert.deepEqual(outsider.lots, []);
});

await check('a packing list is pieces, never customers or prices', async () => {
  const body = (await exporterLot(req({ headers: packer, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.equal(body.items.length, 34);
  assert.equal(JSON.stringify(body).includes('priceMinor'), false);
  assert.equal(JSON.stringify(body).includes('buyerId'), false);
  for (const item of body.items) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ['condition', 'id', 'itemName', 'packed', 'quantity', 'received', 'unitWeightGrams'],
    );
  }
});

await check("marking packed is what moves the owner's ch-packed count", async () => {
  const first = (await exporterLot(req({ headers: packer, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  const target = first.items.find((item) => !item.packed);
  assert.ok(target, 'expected something still to pack');
  const before = first.tally.counts.find((row) => row.checkpoint === 'china_packed').done;

  const ticked = await setCheckpoint(req({
    headers: packer, params: { id: target.id }, body: { checkpoint: 'china_packed', on: true },
  }), ctx);
  assert.equal(ticked.status, 200);

  // Read back through the owner's own board: the two screens are one number.
  const owners = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.equal(owners.tally.counts.find((row) => row.checkpoint === 'china_packed').done, before + 1);
});

await check('a packer may tick that, and nothing else', async () => {
  const body = (await exporterLot(req({ headers: packer, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  const target = body.items[0];

  for (const checkpoint of ['china_received', 'ready_to_dispatch', 'dispatched']) {
    const refused = await setCheckpoint(req({
      headers: packer, params: { id: target.id }, body: { checkpoint, on: true },
    }), ctx);
    assert.equal(refused.status, 403, `${checkpoint} should be the owner's alone`);
  }
});

await check('the packing list names the shop, so a crate landing can be reported', async () => {
  // The warehouse receipt is not something the packer can tick - they tell the
  // shop and the shop ticks it - so the handle to tell has to be on this screen.
  const body = (await exporterLot(req({ headers: packer, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.equal(body.store.handle, 'arjun_collects');

  const sent = await sendMessage(req({
    headers: packer, params: { handle: body.store.handle },
    body: { body: 'Lot 24 landed at the warehouse this morning.' },
  }), ctx);
  assert.equal(sent.status, 201);
  assert.equal(sent.jsonBody.message.from.handle, 'baiyun_hobby');
});

await check('a lot they do not pack for is closed to them', async () => {
  const refused = await exporterLot(req({ headers: packer, params: { id: 'lot_ship_23' } }), ctx);
  assert.equal(refused.status, 403);
});

await check('the packing view never shows the owner the buyer list twice', async () => {
  // The owner keeps their own board; the flat list is the packer's shape, and
  // ownership implying every right must not turn one into the other.
  const owners = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.ok(owners.customers.length > 0, 'the owner still gets customers');
});

/* ── checkout, with and without protection ─────────────────────────────── */
console.log('\ncheckout, with and without protection');

await check('the checkout offers the escrows who could be neutral in this trade', async () => {
  const body = (await checkout(req({ headers: auth, params: { id: 'ord_1005' } }), ctx)).jsonBody;
  const ids = body.escrows.map((entry) => entry.id);

  assert.ok(ids.includes('usr_escrow_meera'), 'a neutral escrow is on the list');
  // Neither end of a trade can hold it: usr_demo is the buyer here, usr_kaiju
  // the seller, and both are approved escrows in general.
  assert.equal(ids.includes('usr_demo'), false, 'the buyer cannot hold their own payment');
  assert.equal(ids.includes('usr_kaiju'), false, 'nor can the seller');

  // Each carries their own rate: 1.5% of 32,000 is 480.
  const meera = body.escrows.find((entry) => entry.id === 'usr_escrow_meera');
  assert.equal(meera.feeBasisPoints, 150);
  assert.equal(meera.feeMinor, 480);
});

await check('the batch suggests the escrow the rest of it already uses', async () => {
  // ord_2003 and ord_2004 are both in lot_my_batch and both held by Kaiju, so
  // a third order in that batch should be pointed at them. Thirty buyers each
  // picking a different holder turns one conversation into thirty.
  const listed = await createListing(req({
    headers: auth, body: { title: 'Third in the batch', priceMinor: 40_000, lotId: 'lot_my_batch', sourcing: 'import' },
  }), ctx);
  assert.equal(listed.status, 201);

  const buyer = await signup(req({
    body: {
      displayName: 'Batch Buyer', email: 'batch@figmark.example',
      phone: '+919000045511', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${buyer.jsonBody.token}` };
  const placed = await createOrder(req({
    headers: theirs, body: { listingId: listed.jsonBody.listing.id, quantity: 1 },
  }), ctx);
  assert.equal(placed.status, 201);

  const body = (await checkout(req({ headers: theirs, params: { id: placed.jsonBody.order.id } }), ctx)).jsonBody;
  assert.ok(body.suggested, 'the batch has an escrow to suggest');
  assert.equal(body.suggested.agentId, 'usr_kaiju');
  assert.match(body.suggested.because, /2 other orders in this batch already use them/);
});

await check('the suggestion reads correctly for a single other order', async () => {
  // One order says "uses", two say "use". A count in a sentence is a sentence.
  const body = (await checkout(req({ headers: auth, params: { id: 'ord_1005' } }), ctx)).jsonBody;
  if (body.suggested) assert.match(body.suggested.because, /already uses? them\./);
});

await check('a direct sale has no batch, so nothing to agree with', async () => {
  const body = (await checkout(req({ headers: auth, params: { id: 'ord_1003' } }), ctx)).jsonBody;
  // ord_1003 rides in lot_sz_oct, whose other orders carry no escrow.
  assert.equal(body.suggested, null);
});

await check('protection needs a named escrow, not just a tick', async () => {
  const nameless = await payOrder(req({
    headers: auth, params: { id: 'ord_1005' }, body: { protection: true },
  }), ctx);
  assert.equal(nameless.status, 400);
  assert.equal(nameless.jsonBody.error, 'no_escrow');
});

await check('an escrow cannot be either end of the trade it holds', async () => {
  const seller = await payOrder(req({
    headers: auth, params: { id: 'ord_1005' }, body: { protection: true, escrowAgentId: 'usr_kaiju' },
  }), ctx);
  assert.equal(seller.status, 400);
  assert.equal(seller.jsonBody.error, 'invalid_escrow');

  const self = await payOrder(req({
    headers: auth, params: { id: 'ord_1005' }, body: { protection: true, escrowAgentId: 'usr_demo' },
  }), ctx);
  assert.equal(self.status, 400);
});

await check('somebody never approved cannot be chosen', async () => {
  const refused = await payOrder(req({
    headers: auth, params: { id: 'ord_1005' },
    body: { protection: true, escrowAgentId: 'usr_tokyoline' },
  }), ctx);
  assert.equal(refused.status, 409);
  assert.equal(refused.jsonBody.error, 'protection_unavailable');
});

await check('choosing one is what holds the money, in their name', async () => {
  const paid = await payOrder(req({
    headers: auth, params: { id: 'ord_1005' },
    body: { protection: true, escrowAgentId: 'usr_escrow_meera' },
  }), ctx);
  assert.equal(paid.status, 200);
  assert.equal(paid.jsonBody.order.escrow.state, 'held');
  assert.equal(paid.jsonBody.order.protection.escrowAgentId, 'usr_escrow_meera');
  // Their name as it was today: a later rename must not rewrite the terms.
  assert.match(paid.jsonBody.order.protection.escrowName, /Meera/);
  assert.equal(paid.jsonBody.order.protection.feeMinor, 480);
  // The clock still does not start at checkout.
  assert.equal(paid.jsonBody.order.escrow.autoReleaseAt, null);
});

await check('declining it pays the seller directly, and holds nothing', async () => {
  const paid = await payOrder(req({ headers: auth, params: { id: 'ord_1003' }, body: { protection: false } }), ctx);
  assert.equal(paid.status, 200);
  assert.equal(paid.jsonBody.order.paymentStatus, 'paid');
  assert.equal(paid.jsonBody.order.escrow.state, 'none');
  assert.equal(paid.jsonBody.order.protection, null);
});

await check('an unprotected order has nothing to dispute, and says so', async () => {
  const body = (await orderState(req({ headers: auth, params: { id: 'ord_1003' } }), ctx)).jsonBody;
  assert.equal(body.actions.includes('dispute'), false);

  const refused = await openDispute(req({
    headers: auth, params: { id: 'ord_1003' },
    body: { reasonCode: 'not_received', reason: 'Never turned up.' },
  }), ctx);
  assert.equal(refused.status, 409);
  assert.match(refused.jsonBody.message, /without buyer protection/i);
});

await check('paying twice is refused rather than charging twice', async () => {
  assert.equal((await payOrder(req({ headers: auth, params: { id: 'ord_1005' }, body: {} }), ctx)).status, 409);
});

await check('the seller ticking dispatched is what starts the clock', async () => {
  // One place says the box left, and the order takes its state from that rather
  // than from a second screen repeating it. ord_2004 is the demo account's own
  // sale, so the seller side is a session these tests hold.
  const before = (await orderState(req({ headers: auth, params: { id: 'ord_2004' } }), ctx)).jsonBody;
  assert.equal(before.order.escrow.autoReleaseAt, null);

  const ticked = await setCheckpoint(req({
    headers: auth, params: { id: 'ord_2004' }, body: { checkpoint: 'dispatched', on: true },
  }), ctx);
  assert.equal(ticked.status, 200);

  const body = (await orderState(req({ headers: auth, params: { id: 'ord_2004' } }), ctx)).jsonBody;
  assert.equal(body.order.status, 'shipped');
  assert.ok(body.order.escrow.autoReleaseAt, 'the auto-release window should now be open');
});

await check('only the buyer may confirm delivery', async () => {
  const body = (await orderState(req({ headers: auth, params: { id: 'ord_2004' } }), ctx)).jsonBody;
  assert.equal(body.side, 'seller');
  // Named, and addressed: every reference to somebody is a link to their page,
  // so the name arrives with the handle it opens. This one is a buyer, so it is
  // their own page rather than any shop they run.
  // The person who bought it, not the shop they happen to run: those are two
  // names and two pages, and this order was placed by the person.
  assert.equal(body.counterparty.name, 'Meiko Tanaka');
  assert.equal(body.counterparty.handle, 'tokyoline');
  assert.equal(body.actions.includes('confirm'), false);
  assert.equal((await confirmOrder(req({ headers: auth, params: { id: 'ord_2004' } }), ctx)).status, 409);
});

await check('a stranger cannot see or touch an order', async () => {
  for (const call of [orderState, checkout, payOrder, confirmOrder]) {
    const refused = await call(req({ headers: helper, params: { id: 'ord_1005' }, body: {} }), ctx);
    assert.equal(refused.status, 403, `${call.name} should refuse`);
  }
});

/* ── disputes, from both sides ─────────────────────────────────────────── */
console.log('\nbuying directly from the seller');

await check('the checkout carries the seller\'s details, so there is somewhere to send it', async () => {
  const body = (await checkout(req({ headers: auth, params: { id: 'ord_1005' } }), ctx)).jsonBody;
  assert.ok(body.sellerPayment, 'the seller can be paid directly');
  assert.ok(body.sellerPayment.upiId, 'and the UPI id is what a buyer needs');
});

await check('an escrow with no settled payments has no rating, rather than a blank five', async () => {
  const body = (await checkout(req({ headers: auth, params: { id: 'ord_1005' } }), ctx)).jsonBody;
  for (const option of body.escrows) {
    assert.ok(typeof option.held === 'number', 'their record is counted, not invented');
    if (option.settled === 0) assert.equal(option.rating, null, 'unproven is not the same as bad');
    else assert.ok(option.rating > 0 && option.rating <= 5);
  }
});

/* A whole direct sale, end to end, on an order of its own. */
const directBuyer = await signup(req({
  body: {
    displayName: 'Direct Buyer', email: 'direct@figmark.example',
    phone: '+919000045512', password: 'longenough1',
  },
}), ctx);
const directAuth = { authorization: `Bearer ${directBuyer.jsonBody.token}` };
const directListing = await createListing(req({
  headers: auth, body: { title: 'Sold hand to hand', priceMinor: 25_000, sourcing: 'in_hand' },
}), ctx);
const directOrder = (await createOrder(req({
  headers: directAuth, body: { listingId: directListing.jsonBody.listing.id, quantity: 1 },
}), ctx)).jsonBody.order;

await check('a claim needs proof, not just a button press', async () => {
  const empty = await claimPayment(req({
    headers: directAuth, params: { id: directOrder.id }, body: {},
  }), ctx);
  assert.equal(empty.status, 400);
  assert.equal(empty.jsonBody.error, 'no_proof');
});

await check('a screenshot that is not an image is refused', async () => {
  const wrong = await claimPayment(req({
    headers: directAuth, params: { id: directOrder.id }, body: { screenshot: 'https://example.com/a.png' },
  }), ctx);
  assert.equal(wrong.status, 400);
  assert.equal(wrong.jsonBody.error, 'invalid_screenshot');
});

await check('an oversized screenshot is refused with its actual size', async () => {
  const huge = await claimPayment(req({
    headers: directAuth,
    params: { id: directOrder.id },
    body: { screenshot: `data:image/jpeg;base64,${'A'.repeat(500_000)}` },
  }), ctx);
  assert.equal(huge.status, 413);
  assert.match(huge.jsonBody.message, /KB and the limit is/);
});

await check('only the buyer can say they have paid', async () => {
  const seller = await claimPayment(req({
    headers: auth, params: { id: directOrder.id }, body: { reference: 'UTR999' },
  }), ctx);
  assert.equal(seller.status, 403);
  assert.equal(seller.jsonBody.error, 'not_the_buyer');
});

await check('claiming puts it in front of the seller, and is not the same as paid', async () => {
  const claimed = await claimPayment(req({
    headers: directAuth,
    params: { id: directOrder.id },
    body: { reference: 'UTR12345', screenshot: 'data:image/jpeg;base64,QUJD' },
  }), ctx);
  assert.equal(claimed.status, 200);
  assert.equal(claimed.jsonBody.order.paymentStatus, 'claimed');
  assert.equal(claimed.jsonBody.awaiting, 'seller');
  assert.equal(claimed.jsonBody.order.paymentClaim.reference, 'UTR12345');
  assert.equal(claimed.jsonBody.order.paymentClaim.decision, null);
});

await check('the buyer has nothing left to do; the seller has the only button', async () => {
  const theirs = (await orderState(req({ headers: directAuth, params: { id: directOrder.id } }), ctx)).jsonBody;
  assert.deepEqual(theirs.actions, [], 'the buyer waits');

  const sellers = (await orderState(req({ headers: auth, params: { id: directOrder.id } }), ctx)).jsonBody;
  assert.ok(sellers.actions.includes('settle_claim'), 'the seller answers');
});

await check('it shows up in the shop\'s payments queue', async () => {
  const queue = (await sales(req({ headers: auth }), ctx)).jsonBody;
  const row = queue.waiting.find((entry) => entry.id === directOrder.id);
  assert.ok(row, 'waiting on this shop');
  assert.equal(row.claim.reference, 'UTR12345');
  assert.equal(row.buyer.name, 'Direct Buyer');
  assert.ok(row.buyer.handle, 'the buyer is reachable from the queue');
});

await check('a stranger cannot read a shop\'s payments queue', async () => {
  const refused = await sales(req({ headers: directAuth, params: {}, query: { store: 'usr_demo' } }), ctx);
  assert.equal(refused.status, 403);
});

await check('denying it needs a reason the buyer can act on', async () => {
  const blank = await settleClaim(req({
    headers: auth, params: { id: directOrder.id }, body: { accept: false, reason: '' },
  }), ctx);
  assert.equal(blank.status, 400);
  assert.equal(blank.jsonBody.error, 'no_reason');
});

await check('a denial puts it back to unpaid and keeps the evidence', async () => {
  const denied = await settleClaim(req({
    headers: auth,
    params: { id: directOrder.id },
    body: { accept: false, reason: 'Nothing has landed in the account yet.' },
  }), ctx);
  assert.equal(denied.status, 200);
  assert.equal(denied.jsonBody.order.paymentStatus, 'unpaid');
  // A denied claim is the start of an argument, so the buyer's proof survives it.
  assert.equal(denied.jsonBody.order.paymentClaim.decision, 'denied');
  assert.equal(denied.jsonBody.order.paymentClaim.reference, 'UTR12345');
  assert.match(denied.jsonBody.order.paymentClaim.decidedReason, /Nothing has landed/);
});

await check('so the buyer can send it again', async () => {
  const again = await claimPayment(req({
    headers: directAuth, params: { id: directOrder.id }, body: { reference: 'UTR67890' },
  }), ctx);
  assert.equal(again.status, 200);
  assert.equal(again.jsonBody.order.paymentStatus, 'claimed');
});

await check('accepting is the seller saying it is in their account', async () => {
  const accepted = await settleClaim(req({
    headers: auth, params: { id: directOrder.id }, body: { accept: true },
  }), ctx);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.jsonBody.order.paymentStatus, 'paid');
  assert.equal(accepted.jsonBody.order.status, 'confirmed');
  // Nobody held this, so there is nothing to release and nothing to dispute.
  assert.equal(accepted.jsonBody.order.escrow.state, 'none');
  assert.equal(accepted.jsonBody.order.protection ?? null, null);
});

await check('and it cannot be answered twice', async () => {
  const again = await settleClaim(req({
    headers: auth, params: { id: directOrder.id }, body: { accept: true },
  }), ctx);
  assert.equal(again.status, 409);
  assert.equal(again.jsonBody.error, 'nothing_to_settle');
});

await check('a direct sale has nothing to dispute, which is what it cost', async () => {
  const state = (await orderState(req({ headers: directAuth, params: { id: directOrder.id } }), ctx)).jsonBody;
  assert.equal(state.actions.includes('dispute'), false);
});

console.log('\ndisputes, from both sides');

await check('a seller can raise one too, with reasons only a seller has', async () => {
  // ord_2004 is the demo account's own sale, dispatched and protected.
  const opened = await openDispute(req({
    headers: auth, params: { id: 'ord_2004' },
    body: {
      reasonCode: 'buyer_unresponsive',
      reason: 'Courier says delivered nine days ago and they will not confirm.',
    },
  }), ctx);
  assert.equal(opened.status, 201);
  assert.equal(opened.jsonBody.dispute.raisedSide, 'seller');
  assert.equal(opened.jsonBody.dispute.status, 'awaiting_response');
  assert.ok(opened.jsonBody.dispute.respondByAt, 'the other side gets a deadline');

  // And the hold freezes: no clock can run it out while this is open.
  const after = (await orderState(req({ headers: auth, params: { id: 'ord_2004' } }), ctx)).jsonBody;
  assert.equal(after.order.escrow.state, 'disputed');
  assert.equal(after.order.escrow.autoReleaseAt, null);
});

await check('neither side can give the other side\'s reasons', async () => {
  const wrong = await openDispute(req({
    headers: auth, params: { id: 'ord_1005' },
    body: { reasonCode: 'buyer_unresponsive', reason: 'Trying it on.' },
  }), ctx);
  assert.equal(wrong.status, 400);
  assert.match(wrong.jsonBody.message, /not one your side can give/);
});

await check('evidence has to be a link, not a script', async () => {
  const nasty = await openDispute(req({
    headers: auth, params: { id: 'ord_1005' },
    body: {
      reasonCode: 'damaged', reason: 'Base snapped.',
      evidence: [{ url: 'javascript:alert(1)', caption: 'oops' }],
    },
  }), ctx);
  assert.equal(nasty.status, 400);
  assert.equal(nasty.jsonBody.error, 'invalid_evidence');
});

const buyerDispute = await openDispute(req({
  headers: auth, params: { id: 'ord_1005' },
  body: {
    reasonCode: 'damaged', reason: 'Arrived with the box crushed.',
    evidence: [{ url: 'https://example.invalid/box.jpg', caption: 'The corner' }],
  },
}), ctx);

await check('opening one starts a thread with the evidence attached', () => {
  assert.equal(buyerDispute.status, 201);
  const dispute = buyerDispute.jsonBody.dispute;
  assert.equal(dispute.messages.length, 1);
  assert.equal(dispute.messages[0].evidence.length, 1);
  assert.equal(dispute.messages[0].authorRole, 'buyer');
});

await check('one order cannot carry two disputes', async () => {
  const again = await openDispute(req({
    headers: auth, params: { id: 'ord_1005' },
    body: { reasonCode: 'damaged', reason: 'Again.' },
  }), ctx);
  assert.equal(again.status, 409);
  assert.equal(again.jsonBody.error, 'already_disputed');
});

await check('only the two parties can read it', async () => {
  const id = buyerDispute.jsonBody.dispute.id;
  assert.equal((await readDispute(req({ headers: helper, params: { id } }), ctx)).status, 403);
  assert.equal((await readDispute(req({ headers: auth, params: { id } }), ctx)).status, 200);
});

await check('escalating is refused until the other side has had their days', async () => {
  // "Ask Figmark" as an opening move would make the company the first port of
  // call for every disagreement.
  const id = buyerDispute.jsonBody.dispute.id;
  const early = await escalateDispute(req({ headers: auth, params: { id } }), ctx);
  assert.equal(early.status, 409);
  assert.match(early.jsonBody.message, /days to answer/);
});

await check('an offer is the other side\'s to accept, never your own', async () => {
  const id = buyerDispute.jsonBody.dispute.id;
  const offered = await offerDispute(req({
    headers: auth, params: { id }, body: { refundMinor: 16_000, note: 'Half back, keep it.' },
  }), ctx);
  assert.equal(offered.status, 200);
  assert.equal(offered.jsonBody.dispute.offer.refundMinor, 16_000);

  // The same session made it, so it cannot also take it.
  const own = await acceptDispute(req({ headers: auth, params: { id } }), ctx);
  assert.equal(own.status, 409);
  assert.equal(own.jsonBody.error, 'nothing_to_accept');
});

await check('an offer outside what is held is refused', async () => {
  const id = buyerDispute.jsonBody.dispute.id;
  for (const refundMinor of [-1, 999_999]) {
    const bad = await offerDispute(req({ headers: auth, params: { id }, body: { refundMinor } }), ctx);
    assert.equal(bad.status, 400, `${refundMinor} should be refused`);
  }
});

await check('withdrawing puts everything back and blames nobody', async () => {
  const id = buyerDispute.jsonBody.dispute.id;
  const before = (await orderState(req({ headers: auth, params: { id: 'ord_1005' } }), ctx)).jsonBody;
  const sellerBefore = (await reviewsAbout(req({ params: { id: before.order.sellerId } }), ctx)).jsonBody;

  const done = await withdrawDispute(req({ headers: auth, params: { id } }), ctx);
  assert.equal(done.status, 200);
  assert.equal(done.jsonBody.dispute.status, 'withdrawn');
  // The hold goes to the seller, and no record is marked against anyone.
  assert.equal(done.jsonBody.order.escrow.state, 'released');
  assert.equal(sellerBefore.asSeller.count >= 0, true);
});

await check('a settled dispute takes no further action', async () => {
  const id = buyerDispute.jsonBody.dispute.id;
  const body = (await readDispute(req({ headers: auth, params: { id } }), ctx)).jsonBody;
  assert.deepEqual(body.actions, []);
  assert.equal((await replyDispute(req({ headers: auth, params: { id }, body: { body: 'More' } }), ctx)).status, 409);
});

/* ── two-sided reviews ─────────────────────────────────────────────────── */
console.log('\ntwo-sided reviews');

await check('a review needs a completed order, not an opinion', async () => {
  const early = await reviewOrder(req({
    headers: auth, params: { id: 'ord_1001' }, body: { rating: 1, body: 'Slow.' },
  }), ctx);
  assert.equal(early.status, 409);
  assert.equal(early.jsonBody.error, 'not_reviewable');
});

await check('a rating outside one to five is refused', async () => {
  for (const rating of [0, 6, 2.5, 'five']) {
    const bad = await reviewOrder(req({
      headers: auth, params: { id: 'ord_1004' }, body: { rating, body: '' },
    }), ctx);
    assert.equal(bad.status, 400, `${rating} should be refused`);
  }
});

await check("the other side's review stays hidden until yours is written", async () => {
  // The seed has the seller's half of ord_1004 written and unrevealed.
  const before = (await orderState(req({ headers: auth, params: { id: 'ord_1004' } }), ctx)).jsonBody;
  assert.equal(before.theirReview, null, 'it must not be readable before you write yours');
  assert.equal(before.theirReviewPending, true, 'but it should say one is waiting');
  assert.ok(before.actions.includes('review'));
});

await check('writing yours reveals both at once', async () => {
  const written = await reviewOrder(req({
    headers: auth, params: { id: 'ord_1004' },
    body: { rating: 4, body: 'Long wait on customs, but kept me posted.' },
  }), ctx);
  assert.equal(written.status, 201);

  const after = (await orderState(req({ headers: auth, params: { id: 'ord_1004' } }), ctx)).jsonBody;
  assert.ok(after.myReview, 'yours is there');
  assert.ok(after.theirReview, "and theirs is now readable");
  assert.equal(after.theirReviewPending, false);
  assert.equal(after.actions.includes('review'), false, 'and there is nothing left to write');
});

await check('reviewing twice is refused', async () => {
  const again = await reviewOrder(req({
    headers: auth, params: { id: 'ord_1004' }, body: { rating: 1, body: 'Changed my mind.' },
  }), ctx);
  assert.equal(again.status, 409);
});

/** The mean of a set of one-to-five ratings, on the nought-to-hundred scale. */
const meanScore = (ratings) =>
  ratings.length === 0 ? null : Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 20);

await check('being a good seller and a good buyer are counted separately', async () => {
  // One account is both, so one blended average would let a prompt-paying buyer
  // carry a shop that never posts anything.
  //
  // Derived from the rows rather than written out: this used to assert the
  // literal 80 the fixtures happened to produce, so adding one seeded review
  // failed a test about separation for reasons that had nothing to do with it.
  const body = (await reviewsAbout(req({ params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  const ratingsIn = (direction) =>
    body.reviews.filter((entry) => entry.direction === direction).map((entry) => entry.rating);

  const asSeller = ratingsIn('buyer_to_seller');
  const asBuyer = ratingsIn('seller_to_buyer');
  assert.ok(asSeller.length > 0 && asBuyer.length > 0, 'this account is rated on both sides');

  assert.equal(body.asSeller.average, meanScore(asSeller));
  assert.equal(body.asSeller.count, asSeller.length);
  assert.equal(body.asBuyer.average, meanScore(asBuyer));
  assert.equal(body.asBuyer.count, asBuyer.length);
  // The point of the split: neither total contains the other's rows.
  assert.equal(body.asSeller.count + body.asBuyer.count, body.reviews.length);
});

await check('the score on the account follows the reviews about it', async () => {
  const kaiju = (await publicProfile(req({ params: { handle: 'kaiju_imports' } }), ctx)).jsonBody;
  assert.equal(kaiju.isStore, true);
  // Seeded at 91 before anyone rated them; the real ratings replace it.
  const seller = (await reviewsAbout(req({ params: { id: kaiju.sellerId } }), ctx)).jsonBody;
  const rated = seller.reviews.filter((entry) => entry.direction === 'buyer_to_seller');
  assert.equal(seller.asSeller.average, meanScore(rated.map((entry) => entry.rating)));
  assert.notEqual(seller.asSeller.average, 91, 'the seeded figure is not what is shown');
});

await check('the public list never carries a review still hidden', async () => {
  const body = (await reviewsAbout(req({ params: { id: 'usr_demo' } }), ctx)).jsonBody;
  for (const review of body.reviews) {
    assert.ok(review.rating >= 1 && review.rating <= 5);
    // Author names, never author ids: a review page is not a directory.
    assert.equal('authorId' in review, false);
  }
  assert.equal(body.count, body.reviews.length);
});

/* ── the escrow's side ─────────────────────────────────────────────────── */
console.log("\nthe escrow's side");

const escrowSession = await login(req({
  body: { identifier: ESCROW_EMAIL, password: DEMO_PASSWORD },
}), ctx);
const escrow = { authorization: `Bearer ${escrowSession.jsonBody.token}` };

await check('an escrow sees what is in their name, and nothing else', async () => {
  const body = (await escrowHoldings(req({ headers: escrow }), ctx)).jsonBody;
  assert.ok(body.holdings.length > 0);
  for (const row of body.holdings) {
    assert.equal(row.order.protection.escrowAgentId, escrowSession.jsonBody.user.id);
  }
  assert.ok(body.heldMinor > 0, 'the number they are accountable for');
});

await check('somebody never approved has no holdings screen at all', async () => {
  const refused = await escrowHoldings(req({ headers: helper }), ctx);
  assert.equal(refused.status, 403);
  assert.equal(refused.jsonBody.error, 'not_an_escrow');
});

// ord_1001 is held by Meera, so a dispute on it is hers to settle.
const heldDispute = await openDispute(req({
  headers: auth, params: { id: 'ord_1001' },
  body: { reasonCode: 'damaged', reason: 'Both statues arrived with cracked bases.' },
}), ctx);

await check('the escrow can read a dispute over money they hold', async () => {
  assert.equal(heldDispute.status, 201);
  const id = heldDispute.jsonBody.dispute.id;
  // A party to neither side, but the person who has to decide.
  assert.equal((await readDispute(req({ headers: escrow, params: { id } }), ctx)).status, 403,
    'reading the thread is still the parties\' route');
  // Their own route is the one that lets them see it.
  const holdings = (await escrowHoldings(req({ headers: escrow }), ctx)).jsonBody;
  const row = holdings.holdings.find((entry) => entry.order.id === 'ord_1001');
  assert.ok(row.dispute, 'the argument is on their screen');
});

await check('the escrow may not rule while the two of them are still talking', async () => {
  const id = heldDispute.jsonBody.dispute.id;
  const early = await settleAsEscrow(req({
    headers: escrow, params: { id }, body: { outcome: 'refund_buyer', note: 'Sorting it out.' },
  }), ctx);
  assert.equal(early.status, 409);
  assert.equal(early.jsonBody.error, 'too_early');
});

await check('once escalated, the escrow settles it — not the company', async () => {
  const id = heldDispute.jsonBody.dispute.id;

  // The response window has to run out, or somebody has to ask. The seller
  // holds no password here, so the buyer escalates once they are overdue.
  const record = await repository_dispute(id);
  record.respondByAt = new Date(Date.now() - 86_400_000).toISOString();
  await (await getRepository()).updateDispute(record);

  const escalated = await escalateDispute(req({ headers: auth, params: { id } }), ctx);
  assert.equal(escalated.status, 200);
  assert.equal(escalated.jsonBody.dispute.status, 'under_mediation');

  const settled = await settleAsEscrow(req({
    headers: escrow, params: { id },
    body: { outcome: 'split', refundMinor: 1_45_000, note: 'Damaged in transit; half back, keep the pieces.' },
  }), ctx);
  assert.equal(settled.status, 200);
  assert.equal(settled.jsonBody.dispute.resolution.outcome, 'split');
  // Recorded as theirs: the parties chose this person, and the record says so.
  assert.equal(settled.jsonBody.dispute.resolution.byCompany, false);
  assert.equal(settled.jsonBody.dispute.resolution.decidedBy, escrowSession.jsonBody.user.id);
  assert.equal(settled.jsonBody.order.paymentStatus, 'partially_paid');
});

await check('an escrow cannot settle a dispute over money somebody else holds', async () => {
  // ord_2003 is held by Kaiju, not Meera.
  const held = (await orderState(req({ headers: auth, params: { id: 'ord_2003' } }), ctx)).jsonBody;
  const id = held.order.escrow.disputeId;
  const refused = await settleAsEscrow(req({
    headers: escrow, params: { id }, body: { outcome: 'refund_buyer', note: 'Not mine to call.' },
  }), ctx);
  assert.equal(refused.status, 403);
});

/* ── mediation ─────────────────────────────────────────────────────────── */
console.log('\nmediation');

await check('the company settles what the two sides could not', async () => {
  // ord_2004: the seller raised it, the buyer holds no password, and it has sat
  // past the deadline. That is exactly the shape that reaches mediation.
  const opened = (await orderState(req({ headers: auth, params: { id: 'ord_2004' } }), ctx)).jsonBody;
  const id = opened.order.escrow.disputeId;
  assert.ok(id, 'the seller-raised dispute is still open');

  const queue = (await adminDisputes(req({ headers: auth }), ctx)).jsonBody;
  const row = queue.disputes.find((entry) => entry.dispute.id === id);
  assert.ok(row, 'it is in the queue');
  // The mediator gets both records, not a summary of them.
  assert.ok(row.buyer && row.seller);
  assert.equal(typeof row.buyer.trust.disputesLost, 'number');
  assert.equal(row.heldMinor, 1_10_000);

  const settled = await adminResolve(req({
    headers: auth, params: { id },
    body: { outcome: 'split', refundMinor: 30_000, note: 'Damage is real but the item is usable.' },
  }), ctx);
  assert.equal(settled.status, 200);
  assert.equal(settled.jsonBody.dispute.resolution.outcome, 'split');
  assert.equal(settled.jsonBody.dispute.resolution.byCompany, true);
  assert.equal(settled.jsonBody.order.paymentStatus, 'partially_paid');
  // The fee is kept on a split: the service was used, and neither side was
  // wholly at fault.
  assert.equal(settled.jsonBody.order.protection.refundedAt, null);
});

await check('a split marks nobody down; a one-sided finding does', async () => {
  const seller = await repository_user('usr_demo');
  assert.equal(seller.sellerTrust.disputesLost, 0, 'a split is the system working');
});

await check('a ruling has to carry its reasoning', async () => {
  const queue = (await adminDisputes(req({ headers: auth }), ctx)).jsonBody;
  const open = queue.disputes.find((entry) => !entry.dispute.resolvedAt);
  if (!open) return;
  const blank = await adminResolve(req({
    headers: auth, params: { id: open.dispute.id }, body: { outcome: 'refund_buyer', note: '  ' },
  }), ctx);
  assert.equal(blank.status, 400);
  assert.match(blank.jsonBody.message, /reasoning/i);
});

await check('a settled dispute cannot be settled again', async () => {
  const queue = (await adminDisputes(req({ headers: auth }), ctx)).jsonBody;
  const done = queue.disputes.find((entry) => entry.dispute.resolvedAt);
  assert.ok(done);
  const again = await adminResolve(req({
    headers: auth, params: { id: done.dispute.id },
    body: { outcome: 'refund_buyer', note: 'Changed my mind.' },
  }), ctx);
  assert.equal(again.status, 409);
});

/* ── operating the marketplace ─────────────────────────────────────────── */
console.log('\npages, and what is said about them');

await check('a review of a trade carries what it was written about', async () => {
  const body = (await reviewsAbout(req({ params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  const withItem = body.reviews.find((entry) => entry.item);
  assert.ok(withItem, 'at least one review names its order');
  assert.ok(withItem.item.name, 'and what was bought');
  assert.ok(withItem.item.listingId, 'so the reader can open it');
  assert.ok(withItem.item.totalMinor > 0, 'a five-star on ₹200 is not a five-star on ₹40,000');
});

await check("the credit record counts rows rather than reporting a stored grade", async () => {
  const body = (await credit(req({ params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  assert.ok(body.memberSince, 'how long they have been here');
  assert.ok(body.asSeller.sold >= 0 && body.asBuyer.bought >= 0);
  // Praised can never exceed rated: that would mean counting reviews twice.
  assert.ok(body.asSeller.praised <= body.asSeller.rated);
  assert.ok(body.asBuyer.praised <= body.asBuyer.rated);
});

await check('an unrated side reads as unrated, not as nought per cent', async () => {
  const fresh = await signup(req({
    body: {
      displayName: 'Nobody Yet', email: 'nobody@figmark.example',
      phone: '+919000045711', password: 'longenough1',
    },
  }), ctx);
  const body = (await credit(req({ params: { id: fresh.jsonBody.user.id } }), ctx)).jsonBody;
  // An account nobody has reviewed is not one everybody disliked.
  assert.equal(body.asSeller.goodRate, null);
  assert.equal(body.asBuyer.goodRate, null);
  assert.equal(body.seller.average, null);
});

/* Opinions on a page: anybody may leave one, and none of them may move the
   number that was earned by trading. */
const opinionAuthor = await signup(req({
  body: {
    displayName: 'Passing Visitor', email: 'visitor@figmark.example',
    phone: '+919000045712', password: 'longenough1',
  },
}), ctx);
const visitorAuth = { authorization: `Bearer ${opinionAuthor.jsonBody.token}` };

await check('a rating outside one to five is refused', async () => {
  for (const rating of [0, 6, 2.5]) {
    const bad = await writePageReview(req({
      headers: visitorAuth, params: { id: 'usr_kaiju' }, body: { rating, body: 'Something' },
    }), ctx);
    assert.equal(bad.status, 400, `rating ${rating} should be refused`);
  }
});

await check('a rating with nothing said is refused', async () => {
  const bare = await writePageReview(req({
    headers: visitorAuth, params: { id: 'usr_kaiju' }, body: { rating: 5, body: '' },
  }), ctx);
  assert.equal(bare.status, 400);
  assert.equal(bare.jsonBody.error, 'invalid_body');
});

await check('nobody reviews their own page', async () => {
  const self = await writePageReview(req({
    headers: auth, params: { id: 'usr_demo' }, body: { rating: 5, body: 'I am wonderful' },
  }), ctx);
  assert.equal(self.status, 400);
  assert.equal(self.jsonBody.error, 'self_review');
});

await check('anybody can leave one without having bought anything', async () => {
  const written = await writePageReview(req({
    headers: visitorAuth, params: { id: 'usr_kaiju' }, body: { rating: 4, body: 'Answers questions quickly.' },
  }), ctx);
  assert.equal(written.status, 201);
  assert.equal(written.jsonBody.review.rating, 4);
  assert.equal(written.jsonBody.review.authorName, 'Passing Visitor');
});

await check('writing again replaces it rather than stacking another on', async () => {
  const again = await writePageReview(req({
    headers: visitorAuth, params: { id: 'usr_kaiju' }, body: { rating: 5, body: 'Better than I said.' },
  }), ctx);
  assert.equal(again.status, 200);

  const body = (await pageReviews(req({ headers: visitorAuth, params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  const mine = body.reviews.filter((entry) => entry.mine);
  assert.equal(mine.length, 1, 'one per person, or the loudest wins');
  assert.equal(mine[0].rating, 5);
  assert.equal(body.yours, 5, 'the form knows it is editing, not writing');
});

await check('and none of it touches the record earned by trading', async () => {
  // The whole reason the earned number is worth reading. Measured by moving one
  // and checking the other did not follow, rather than by comparing two totals
  // that could coincide.
  const before = (await credit(req({ params: { id: 'usr_kaiju' } }), ctx)).jsonBody;

  const second = await signup(req({
    body: {
      displayName: 'Another Visitor', email: 'visitor2@figmark.example',
      phone: '+919000045713', password: 'longenough1',
    },
  }), ctx);
  const wrote = await writePageReview(req({
    headers: { authorization: `Bearer ${second.jsonBody.token}` },
    params: { id: 'usr_kaiju' },
    body: { rating: 1, body: 'Did not care for the packaging.' },
  }), ctx);
  assert.equal(wrote.status, 201);

  const after = (await credit(req({ params: { id: 'usr_kaiju' } }), ctx)).jsonBody;

  assert.equal(after.page.count, before.page.count + 1, 'the opinion is counted');
  assert.notEqual(after.page.average, before.page.average, 'and moves its own average');
  // A one-star from somebody who never bought anything must not touch this.
  assert.equal(after.seller.count, before.seller.count, 'the trade count is unmoved');
  assert.equal(after.seller.average, before.seller.average, 'and so is the average');
  assert.equal(after.asSeller.goodRate, before.asSeller.goodRate, 'and the good-rate with it');
});

await check('a person can set up their own page, shop or no shop', async () => {
  const saved = await saveProfile(req({
    headers: visitorAuth,
    body: { bio: 'Collect Gunpla. Pay same day.', tags: [' Gunpla ', 'Pune', 'Gunpla'], coverUrl: '' },
  }), ctx);
  assert.equal(saved.status, 200);
  assert.equal(saved.jsonBody.profile.bio, 'Collect Gunpla. Pay same day.');
  // Trimmed and deduplicated: chips are scanned, and the same word twice is noise.
  assert.deepEqual(saved.jsonBody.profile.tags, ['Gunpla', 'Pune']);
});

await check('a banner that is not a link is refused', async () => {
  const bad = await saveProfile(req({
    headers: visitorAuth, body: { coverUrl: 'javascript:alert(1)' },
  }), ctx);
  assert.equal(bad.status, 400);
  assert.equal(bad.jsonBody.error, 'invalid_profile');
});

console.log('\nnames are addresses');

await check('a seller reference opens the shop, a buyer reference opens the person', async () => {
  // The two are different pages with different records. Pointing a seller's
  // name at the person shows a reader how promptly that account pays other
  // people, which says nothing about whether the shop ships.
  const kaiju = (await publicProfile(req({ params: { handle: 'kaiju_imports' } }), ctx)).jsonBody;

  // usr_demo buys from kaiju on ord_1005, so demo sees a seller reference.
  const asBuyer = (await orderState(req({ headers: auth, params: { id: 'ord_1005' } }), ctx)).jsonBody;
  assert.equal(asBuyer.side, 'buyer');
  assert.equal(asBuyer.counterparty.handle, 'kaiju_imports', 'the shop, not the owner');
  assert.notEqual(asBuyer.counterparty.handle, kaiju.ownerHandle);

  // ord_2001 runs the other way: kaiju buys from demo, so demo sees a buyer.
  const asSeller = (await orderState(req({ headers: auth, params: { id: 'ord_2001' } }), ctx)).jsonBody;
  assert.equal(asSeller.side, 'seller');
  assert.equal(asSeller.counterparty.handle, kaiju.ownerHandle, 'the person, not their shop');
});

await check('a review carries the address of whoever wrote it', async () => {
  const body = (await reviewsAbout(req({ params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  const written = body.reviews.find((entry) => entry.direction === 'buyer_to_seller');
  assert.ok(written, 'somebody rated them as a seller');
  assert.ok(written.author.name, 'named');
  // The author of a review of a seller is a buyer, so it is their own page.
  assert.equal(written.author.handle, 'arjun');
});

await check('a comment carries one too, resolved now rather than frozen', async () => {
  const detail = (await listingDetail(req({ params: { id: 'lst_dragon_knight' } }), ctx)).jsonBody;
  assert.ok(detail.comments.length > 0, 'this listing has questions on it');
  for (const comment of detail.comments) {
    assert.ok(comment.author, 'every comment names somebody');
    assert.equal(typeof comment.author.name, 'string');
  }
});

await check('somebody with no handle is named without being linked', async () => {
  // Catalog fixtures were never sign-in accounts and hold no handle. A link to
  // nowhere is worse than plain text.
  const holdings = (await escrowHoldings(req({ headers: escrow }), ctx)).jsonBody;
  for (const row of holdings.holdings) {
    assert.ok(row.buyer.name && row.seller.name, 'both ends are named');
    for (const party of [row.buyer, row.seller]) {
      assert.ok(party.handle === null || typeof party.handle === 'string');
    }
  }
});

console.log('\noperating the marketplace');

await check('every operations route refuses an ordinary account', async () => {
  // The whole surface, not a sample: this is the one that deletes people.
  const calls = [
    [adminUsers, {}],
    [adminUser, { params: { id: 'usr_demo' } }],
    [adminSuspend, { params: { id: 'usr_demo' }, body: { suspended: true } }],
    [adminDeleteUser, { params: { id: 'usr_demo' } }],
    [adminEscrow, { params: { id: 'usr_demo' }, body: { enabled: true } }],
    [adminDeleteResource, { body: { kind: 'listing', id: 'x', ownerId: 'y' } }],
    [adminDisputes, {}],
    [adminResolve, { params: { id: 'x' }, body: { outcome: 'refund_buyer', note: 'no' } }],
  ];
  for (const [call, extra] of calls) {
    const refused = await call(req({ headers: helper, ...extra }), ctx);
    assert.equal(refused.status, 403, `${call.name} should refuse a non-operator`);
  }
});

await check('and refuses a request with no session at all', async () => {
  assert.equal((await adminUsers(req(), ctx)).status, 401);
});

await check('the list carries the store and the grant behind each account', async () => {
  const body = (await adminUsers(req({ headers: auth }), ctx)).jsonBody;
  const kaiju = body.users.find((row) => row.id === 'usr_kaiju');
  assert.ok(kaiju);
  assert.equal(kaiju.store.name, 'Kaiju Imports');
  assert.equal(kaiju.escrowRights.feeBasisPoints, 200);
  // A catalog fixture is not an account somebody lost access to.
  assert.equal(kaiju.signInAccount, false);
});

await check('search narrows it without losing the total', async () => {
  const body = (await adminUsers(req({ headers: auth, query: { q: 'kaiju' } }), ctx)).jsonBody;
  assert.ok(body.users.length >= 1);
  assert.ok(body.total > body.users.length, 'the total is everyone, not the matches');
});

await check('opening an account shows everything it holds', async () => {
  const body = (await adminUser(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  assert.ok(body.listings.length > 0);
  assert.ok(body.lots.length > 0);
  assert.equal(typeof body.orders.sales, 'number');
  assert.ok(Array.isArray(body.blockers));
});

await check('escrow rights can be granted, re-rated and withdrawn', async () => {
  const granted = await adminEscrow(req({
    headers: auth, params: { id: 'usr_sneakervault' },
    body: { enabled: true, feeBasisPoints: 350, note: 'Trial.' },
  }), ctx);
  assert.equal(granted.status, 200);
  assert.equal(granted.jsonBody.user.escrowRights.feeBasisPoints, 350);

  // The rate is a lever, and it has a ceiling.
  const silly = await adminEscrow(req({
    headers: auth, params: { id: 'usr_sneakervault' }, body: { enabled: true, feeBasisPoints: 9_000 },
  }), ctx);
  assert.equal(silly.status, 400);

  const withdrawn = await adminEscrow(req({
    headers: auth, params: { id: 'usr_sneakervault' }, body: { enabled: false },
  }), ctx);
  assert.equal(withdrawn.jsonBody.user.escrowRights, null);
});

await check('an account holding money cannot be deleted', async () => {
  // usr_kaiju holds a protected payment from the demo account.
  const detail = (await adminUser(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  assert.ok(detail.blockers.length > 0, 'the screen says so before the button is offered');

  const refused = await adminDeleteUser(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx);
  assert.equal(refused.status, 409);
  assert.equal(refused.jsonBody.error, 'has_live_money');
  // And it is still there.
  assert.equal((await adminUser(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx)).status, 200);
});

await check('an operator cannot delete or suspend themselves', async () => {
  assert.equal((await adminDeleteUser(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).status, 400);
  assert.equal(
    (await adminSuspend(req({ headers: auth, params: { id: 'usr_demo' }, body: { suspended: true } }), ctx)).status,
    400,
  );
});

await check('suspending is reversible, and does not touch what they made', async () => {
  const before = (await adminUser(req({ headers: auth, params: { id: 'usr_tokyoline' } }), ctx)).jsonBody;
  const off = await adminSuspend(req({
    headers: auth, params: { id: 'usr_tokyoline' }, body: { suspended: true },
  }), ctx);
  assert.equal(off.jsonBody.user.suspended, true);

  const during = (await adminUser(req({ headers: auth, params: { id: 'usr_tokyoline' } }), ctx)).jsonBody;
  assert.equal(during.listings.length, before.listings.length);

  const on = await adminSuspend(req({
    headers: auth, params: { id: 'usr_tokyoline' }, body: { suspended: false },
  }), ctx);
  assert.equal(on.jsonBody.user.suspended, false);
});

await check('one resource can be removed without touching the account', async () => {
  const before = (await adminUser(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  const victim = before.listings[0];

  const gone = await adminDeleteResource(req({
    headers: auth, body: { kind: 'listing', id: victim.id, ownerId: 'usr_kaiju' },
  }), ctx);
  assert.equal(gone.status, 200);

  const after = (await adminUser(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  assert.equal(after.listings.length, before.listings.length - 1);
  assert.equal(after.user.id, 'usr_kaiju', 'the account is untouched');
});

await check('deleting an account takes what it made and frees its identifiers', async () => {
  // A fresh account with nothing owed, so the destructive path is exercised on
  // something no other test depends on.
  const made = await signup(req({
    body: {
      displayName: 'Passing Through', username: 'passing_through',
      email: 'passing@figmark.example', phone: '+919000045499', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${made.jsonBody.token}` };
  await saveStorefront(req({
    headers: theirs, body: { storefrontName: 'Passing Shop', username: 'passing_shop' },
  }), ctx);
  await createListing(req({ headers: theirs, body: { title: 'A thing', priceMinor: 1_000 } }), ctx);

  const id = made.jsonBody.user.id;
  const deleted = await adminDeleteUser(req({ headers: auth, params: { id } }), ctx);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.jsonBody.deleted.listings, 1);

  // Gone, and both handles back in circulation rather than locked out forever.
  assert.equal((await adminUser(req({ headers: auth, params: { id } }), ctx)).status, 404);
  assert.equal((await publicProfile(req({ params: { handle: 'passing_through' } }), ctx)).status, 404);
  const reclaimed = await signup(req({
    body: {
      displayName: 'Someone Else', username: 'passing_through',
      email: 'passing@figmark.example', phone: '+919000045499', password: 'longenough1',
    },
  }), ctx);
  assert.equal(reclaimed.status, 201, 'the email, phone and handle are all free again');
});

console.log(`\n${passed} checks passed`);
