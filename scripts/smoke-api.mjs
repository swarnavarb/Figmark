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
  supplierLotsRoute: supplierLots, supplierLotRoute: supplierLot,
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
  wantsBoardRoute: wantsBoard, wantPostRoute: postWant, wantReadRoute: readWant,
  wantOfferRoute: offerOnWant, wantCloseRoute: closeWant, wantAlsoMeRoute: alsoMe,
} = await import(new URL('want-routes.js', fns));
const { notificationsRoute: notifications, notificationsReadRoute: markRead } =
  await import(new URL('notification-routes.js', fns));
const { preOrderReadRoute: readPreOrder, preOrderPledgeRoute: pledge } =
  await import(new URL('preorder-routes.js', fns));
const {
  powerSalesRoute: powerSales, powerSaleCreateRoute: schedulePowerSale,
  powerSaleReadRoute: readPowerSale, powerSaleStopRoute: stopPowerSale,
} = await import(new URL('power-sale-routes.js', fns));
const { rejectOrderRoute: rejectOrder } = await import(new URL('order-routes.js', fns));
const { insightsRoute: insights } = await import(new URL('insight-routes.js', fns));
const {
  servicesHubRoute: servicesHub, serviceDirectoryRoute: serviceDirectory,
  offerServiceRoute: offerService, consignmentsRoute: consignments,
  distributionRoute: distribution, distributionDetailRoute: distributionDetail,
} = await import(new URL('service-routes.js', fns));
const { setCrewRoute: setCrew } = await import(new URL('fulfilment-routes.js', fns));
const {
  listRoutesRoute: listRoutes, saveRouteRoute: saveRoute, deleteRouteRoute: deleteRoute,
  lotCandidatesRoute: lotCandidates, addItemsRoute: addItems, stepLotRoute: stepLot,
  noteOnLotRoute: noteOnLot, setLotRouteRoute: setLotRoute, stepItemRoute: stepItem,
  myItemsRoute: myItems,
} = await import(new URL('tracking-routes.js', fns));
const {
  listTemplatesRoute: listTemplates, saveTemplateRoute: saveTemplate,
  deleteTemplateRoute: deleteTemplate, uploadRoute: upload, photoRoute,
  assignOrderToLotRoute: assignOrderToLot,
} = await import(new URL('template-routes.js', fns));
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
const { isAnnouncement } = await import(new URL('../api/dist/shared/posts.js', import.meta.url));
const { LOT_STAGES } = await import(new URL('../api/dist/shared/enums.js', import.meta.url));
const {
  aggregateBox, boxClassFor, checkpointProgress, doorToDoor, packingEstimate,
  phaseOf, phaseOfCounts, timingsOf,
} = await import(new URL('../api/dist/shared/insights.js', import.meta.url));
const { tally: tallyOf } = await import(new URL('../api/dist/shared/board.js', import.meta.url));
const {
  DEMO_EMAIL, DEMO_PHONE, DEMO_PASSWORD, PACKER_EMAIL, ESCROW_EMAIL, HANDLER_EMAIL,
  seedListings, seedReviews,
} = await import(
  new URL('../api/dist/api/src/data/seed.js', import.meta.url)
);

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };

/** Reads a row straight from the store, for the state a response does not carry. */
const { getRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));
const repository_user = async (id) => (await getRepository()).getUserById(id);
const repository_dispute = async (id) => (await getRepository()).getDisputeById(id);
// Fixture buyers have no password, so their notifications are read through the
// same repository the routes write them to rather than by signing in as them.
const noticesFor = async (id) => (await getRepository()).listNotifications(id, 40);
// Campaigns end when a cutoff passes, and a smoke test cannot wait a week for
// one. Moving the cutoff into the past is the same fact arriving sooner.
const expireCampaign = async (id) => {
  const repository = await getRepository();
  const listing = await repository.getListing(id);
  await repository.updateListing({
    ...listing,
    preOrder: { ...listing.preOrder, cutoffAt: new Date(Date.now() - 1000).toISOString() },
  });
};
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

await check('the feed never exposes a shipment lot to buyers', async () => {
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

await check('detail includes seller and comments but never the lot', async () => {
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

/* ── shipment lots ──────────────────────────────────────────────────── */
console.log('\nshipment lots');

const lot = await createLot(req({
  headers: auth,
  body: {
    name: 'Test consignment', description: 'smoke',
    origin: 'Guangzhou, CN',
    supplierName: 'Baiyun Hobby', supplierContact: 'wechat: baiyun', supplierReference: 'BH-1',
    estimatedDispatchAt: new Date(Date.now() + 6e8).toISOString(), forwarderName: 'Test Freight',
  },
}), ctx);

await check('a lot carries its origin and supplier', () => {
  assert.equal(lot.jsonBody.lot.origin, 'Guangzhou, CN');
  assert.equal(lot.jsonBody.lot.supplier.name, 'Baiyun Hobby');
  assert.equal(lot.jsonBody.lot.supplier.reference, 'BH-1');
});

await check('the name is the only field a lot insists on', async () => {
  const bare = await createLot(req({ headers: auth, body: { name: 'Bare lot' } }), ctx);
  assert.equal(bare.status, 201);
  assert.equal(bare.jsonBody.lot.origin, '');
  // A contact with nobody attached to it is not a supplier.
  assert.equal(bare.jsonBody.lot.supplier, null);

  const nameless = await createLot(req({ headers: auth, body: { origin: 'Shenzhen, CN' } }), ctx);
  assert.equal(nameless.status, 400);
  assert.equal(nameless.jsonBody.error, 'invalid_lot');
});

await check('every detail can be corrected afterwards', async () => {
  const id = lot.jsonBody.lot.id;
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

  /* A supplier can have an account behind the name, the way the forwarder and
     the handler already can - which is what turns a name typed into a box into
     somebody who can see the lot they are supplying. */
  const tagged = await updateLotDetails(req({
    headers: auth, params: { id },
    body: { supplierName: 'Yiwu Trading', supplierHandle: '@tokyoline', supplierContact: 'wechat: yiwu' },
  }), ctx);
  assert.equal(tagged.status, 200, JSON.stringify(tagged.jsonBody));
  assert.equal(tagged.jsonBody.lot.supplier.supplierUserId, 'usr_tokyoline');
  assert.equal(tagged.jsonBody.lot.supplier.contact, 'wechat: yiwu');
  assert.equal(tagged.jsonBody.lot.name, 'Renamed consignment', 'and naming one renames nothing');

  // A handle nobody answers to is refused rather than silently dropped: a tag
  // that quietly did nothing is worse than one that failed.
  const nobody = await updateLotDetails(req({
    headers: auth, params: { id },
    body: { supplierName: 'Yiwu Trading', supplierHandle: '@nobody_at_all' },
  }), ctx);
  assert.equal(nobody.status, 404);
});

await check('a lot cannot be renamed to nothing, or by someone else', async () => {
  const id = lot.jsonBody.lot.id;
  const blank = await updateLotDetails(req({ headers: auth, params: { id }, body: { name: '  ' } }), ctx);
  assert.equal(blank.status, 400);

  // A lot is read from its owner's partition, so another seller's id does not
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

await check('an item can be filed into a lot as it is listed', async () => {
  const id = lot.jsonBody.lot.id;
  const listed = await createListing(req({
    headers: auth,
    body: { title: 'Straight into the lot', priceMinor: 90_000, lotId: id },
  }), ctx);
  assert.equal(listed.status, 201);
  assert.equal(listed.jsonBody.listing.lotId, id);
  // A lot is a consignment of imports, so it settles the sourcing itself.
  assert.equal(listed.jsonBody.listing.sourcing, 'import');
});

await check('someone else\'s lot is not a place to file things', async () => {
  const refused = await createListing(req({
    headers: auth,
    body: { title: 'Nice try', priceMinor: 1000, lotId: 'lot_gz_sep' },
  }), ctx);
  assert.equal(refused.status, 404);
});

await check('an item with no lot behind it is in hand', async () => {
  const single = await createListing(req({
    headers: auth, body: { title: 'Off my own shelf', priceMinor: 5000, sourcing: 'in_hand' },
  }), ctx);
  assert.equal(single.jsonBody.listing.sourcing, 'in_hand');
  assert.equal(single.jsonBody.listing.lotId, null);

  // Nothing claimed, nothing promised: an unstated item ships from the shelf.
  const quiet = await createListing(req({ headers: auth, body: { title: 'Unstated', priceMinor: 5000 } }), ctx);
  assert.equal(quiet.jsonBody.listing.sourcing, 'in_hand');
});

await check('an import can wait for its lot, and promises nothing until it has one', async () => {
  // Filing an item into a lot is bookkeeping a shop does when the lot is
  // being packed, often weeks after the item went up. Refusing the listing
  // until then made shops either misdescribe the sourcing or not list at all.
  const waiting = await createListing(req({
    headers: auth, body: { title: 'Coming in the next run', priceMinor: 5000, sourcing: 'import' },
  }), ctx);
  assert.equal(waiting.status, 201);
  assert.equal(waiting.jsonBody.listing.sourcing, 'import');
  assert.equal(waiting.jsonBody.listing.lotId, null);

  // What it must not do is promise a date nothing can keep.
  const page = (await listingDetail(req({ params: { id: waiting.jsonBody.listing.id } }), ctx)).jsonBody;
  assert.equal(page.estimatedDispatchAt, null, 'an unfiled import has no dispatch date to give');
});

await check('listing it can tell the channel and the feed at the same time', async () => {
  const before = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody;
  const made = await createListing(req({
    headers: auth,
    body: { title: 'Shared as it went up', priceMinor: 7_500, shareToChannel: true, shareToFeed: true },
  }), ctx);
  assert.equal(made.status, 201);

  // One post, not two: a shop's channel is the record of everything it said,
  // so a post that reaches the feed is already in the room.
  const after = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody;
  assert.equal(after.posts.length, before.posts.length + 1, 'the channel heard about it, once');
  assert.ok(
    after.posts.some((card) => card.post.listingId === made.jsonBody.listing.id),
    'and the post points at the item',
  );

  const feedPosts = (await socialFeed(req({ headers: auth }), ctx)).jsonBody.posts;
  assert.ok(
    feedPosts.some((card) => card.post.listingId === made.jsonBody.listing.id),
    'the feed heard about it too',
  );

  // Channel only stays in the channel, which is the whole reason the two are
  // different choices.
  const quiet = await createListing(req({
    headers: auth, body: { title: 'Told the room only', priceMinor: 4_000, shareToChannel: true },
  }), ctx);
  const quietFeed = (await socialFeed(req({ headers: auth }), ctx)).jsonBody.posts;
  assert.ok(!quietFeed.some((card) => card.post.listingId === quiet.jsonBody.listing.id));
});

await check('an item in a lot is always an import, and never the reverse by accident', async () => {
  // The invariant that still holds now a lot can be chosen later: a lot
  // means import. The other direction is the seller's to state - an import
  // waiting to be filed says so and simply has no dispatch date yet.
  const body = (await feed(req({ headers: auth }), ctx)).jsonBody;
  for (const listing of body.listings) {
    if (listing.lotId) {
      assert.equal(listing.sourcing, 'import', `${listing.title} is in a lot but says ${listing.sourcing}`);
    }
    // And nothing promises a dispatch date it has no lot to get one from.
    if (!listing.lotId) {
      assert.equal(listing.estimatedDispatchAt, null, `${listing.title} has no lot but names a date`);
    }
  }
});

await check('a seller can open a lot', () => {
  assert.equal(lot.status, 201);
  assert.equal(lot.jsonBody.lot.sellerId, 'usr_demo');
  assert.equal(lot.jsonBody.lot.stage, 'ordering');
});

const lotId = lot.jsonBody.lot.id;

await check('lists the seller\'s lots and unassigned listings', async () => {
  const body = (await myLots(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.lots.some((entry) => entry.lot.id === lotId));
  assert.ok(Array.isArray(body.unassigned));
});

await check('items can be tagged into and out of a lot', async () => {
  const added = await assignToLot(req({ headers: auth, params: { id: lotId }, body: { listingIds: ['lst_my_cards'] } }), ctx);
  assert.equal(added.jsonBody.changed, 1);
  const contents = (await lotContents(req({ headers: auth, params: { id: lotId } }), ctx)).jsonBody;
  assert.ok(contents.listings.some((l) => l.id === 'lst_my_cards'));

  const removed = await assignToLot(req({ headers: auth, params: { id: lotId }, body: { listingIds: ['lst_my_cards'], remove: true } }), ctx);
  assert.equal(removed.jsonBody.changed, 1);
});

await check("a seller cannot touch someone else's lot", async () => {
  for (const call of [
    lotContents(req({ headers: auth, params: { id: 'lot_gz_sep' } }), ctx),
    advanceStage(req({ headers: auth, params: { id: 'lot_gz_sep' }, body: { stage: 'qc_repack' } }), ctx),
  ]) {
    assert.equal((await call).status, 403);
  }
});

await check('stages only move forward', async () => {
  const back = await advanceStage(req({ headers: auth, params: { id: lotId }, body: { stage: 'ordering' } }), ctx);
  assert.equal(back.status, 409);
  const bogus = await advanceStage(req({ headers: auth, params: { id: lotId }, body: { stage: 'teleported' } }), ctx);
  assert.equal(bogus.status, 400);
});

await check('advancing a lot writes tracking onto every order in it', async () => {
  // Put a real order in the lot first.
  await assignToLot(req({ headers: auth, params: { id: lotId }, body: { listingIds: [published.jsonBody.listing.id] } }), ctx);
  const buyer = await signup(req({
    body: { displayName: 'Buyer Two', email: 'b2@figmark.example', phone: '+919000054321', password: 'longenough1' },
  }), ctx);
  const buyerAuth = { authorization: `Bearer ${buyer.jsonBody.token}` };
  const placed = await createOrder(req({ headers: buyerAuth, body: { listingId: published.jsonBody.listing.id } }), ctx);
  assert.equal(placed.status, 201);
  assert.equal(placed.jsonBody.order.lotId, lotId, 'the order inherits the item\'s lot');

  const moved = await advanceStage(req({ headers: auth, params: { id: lotId }, body: { stage: 'china_wh_received', note: 'Checked in' } }), ctx);
  assert.equal(moved.status, 200);
  assert.ok(moved.jsonBody.ordersUpdated >= 1);

  const tracked = (await orderTracking(req({ headers: buyerAuth, params: { id: placed.jsonBody.order.id } }), ctx)).jsonBody;
  assert.equal(tracked.currentStage, 'china_wh_received');
  assert.ok(tracked.order.stageHistory.some((e) => e.note === 'Checked in'));
});

await check("the buyer's order view never names the lot", async () => {
  const buyer = await login(req({ body: { identifier: 'b2@figmark.example', password: 'longenough1' } }), ctx);
  const orders = (await myActivity(req({ headers: { authorization: `Bearer ${buyer.jsonBody.token}` } }), ctx)).jsonBody.orders;
  const view = (await orderTracking(req({ headers: { authorization: `Bearer ${buyer.jsonBody.token}` }, params: { id: orders[0].id } }), ctx)).jsonBody;
  assert.ok(!('lot' in view), 'no lot object');
  assert.ok(!JSON.stringify(view).includes('Test consignment'), 'the lot name must not leak');
  // But the two facts it does contribute are present.
  assert.ok('trackingReference' in view && 'estimatedDispatchAt' in view);
});

await check('tracking reference reaches the buyer', async () => {
  await setTracking(req({ headers: auth, params: { id: lotId }, body: { trackingReference: 'TF-999' } }), ctx);
  const buyer = await login(req({ body: { identifier: 'b2@figmark.example', password: 'longenough1' } }), ctx);
  const orders = (await myActivity(req({ headers: { authorization: `Bearer ${buyer.jsonBody.token}` } }), ctx)).jsonBody.orders;
  const view = (await orderTracking(req({ headers: { authorization: `Bearer ${buyer.jsonBody.token}` }, params: { id: orders[0].id } }), ctx)).jsonBody;
  assert.equal(view.trackingReference, 'TF-999');
});

await check('a direct sale tracks against the short vocabulary', async () => {
  const buyer = await login(req({ body: { identifier: 'b2@figmark.example', password: 'longenough1' } }), ctx);
  const buyerAuth = { authorization: `Bearer ${buyer.jsonBody.token}` };
  // lst_handheld is not in any lot.
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
    headers: theirs, body: { body: 'Is the September lot still open?', channelId: 'usr_kaiju' },
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

await check('a shop chooses which of its messages is an announcement', async () => {
  // Not everything a shop says is news. A shop answering a question is talking,
  // and a list that treated the two alike would be worth nothing to open.
  const chat = await createPost(req({
    headers: auth, body: { body: 'Yes, still available.', channelId: 'usr_demo' },
  }), ctx);
  assert.equal(chat.jsonBody.post.announcement, false, 'ordinary by default');

  const news = await createPost(req({
    headers: auth,
    body: { body: 'Lot closes Friday.', channelId: 'usr_demo', announcement: true },
  }), ctx);
  assert.equal(news.jsonBody.post.announcement, true);
});

await check('a customer cannot announce in somebody else\'s room', async () => {
  const visitor = await signup(req({
    body: {
      displayName: 'Loud Visitor', email: 'loud@figmark.example',
      phone: '+919000045804', password: 'longenough1',
    },
  }), ctx);
  const said = await createPost(req({
    headers: { authorization: `Bearer ${visitor.jsonBody.token}` },
    body: { body: 'LOOK AT ME', channelId: 'usr_demo', announcement: true },
  }), ctx);
  assert.equal(said.status, 201, 'they may still speak');
  assert.equal(said.jsonBody.post.announcement, false, 'but not announce');
});

await check('a broadcast is an announcement without being asked', async () => {
  // It went to every follower's feed; there is no other thing that could be.
  const said = await createPost(req({
    headers: auth, body: { body: 'New drop.', storeId: 'usr_demo' },
  }), ctx);
  assert.equal(said.jsonBody.post.announcement, true);
});

await check('a message from before the choice existed still reads as one', async () => {
  // The rule the filter and the badge both read, tested directly rather than
  // inferred from a response. An unmarked post from the shop was made when the
  // shop's voice was the only kind there was, so the list must not come up
  // empty on a room full of them.
  assert.equal(isAnnouncement({}), true, 'an unmarked shop post counts');
  assert.equal(isAnnouncement({ voice: 'store' }), true);
  assert.equal(isAnnouncement({ voice: 'visitor' }), false, 'an unmarked customer post never did');
  // An explicit choice always wins over the fallback, both ways.
  assert.equal(isAnnouncement({ voice: 'store', announcement: false }), false);
  assert.equal(isAnnouncement({ voice: 'visitor', announcement: true }), true);

  // And the seeded rooms are not empty under it.
  const room = (await channelThread(req({ headers: auth, params: { id: 'usr_kaiju' } }), ctx)).jsonBody;
  assert.ok(room.posts.some((card) => isAnnouncement(card.post)), 'an older room still has some');
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
  const created = await createPost(req({ headers: auth, body: { body: 'Fresh lot landing Friday.' } }), ctx);
  assert.equal(created.status, 201);
  // The channel is taken from the session, so there is no field to point it
  // at another seller in the first place.
  assert.equal(created.jsonBody.post.channelId, 'usr_demo');
  assert.equal(created.jsonBody.post.kind, 'update');

  const mine = await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx);
  assert.ok(mine.jsonBody.posts.some((card) => card.post.body === 'Fresh lot landing Friday.'));
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

/* ── the supplier's packing view ───────────────────────────────────────── */
console.log("\nthe supplier's packing view");

const packerSession = await login(req({
  body: { identifier: PACKER_EMAIL, password: DEMO_PASSWORD },
}), ctx);
const packer = { authorization: `Bearer ${packerSession.jsonBody.token}` };

await check('a packer sees the lots they pack for, and only those', async () => {
  const body = (await supplierLots(req({ headers: packer }), ctx)).jsonBody;
  const ids = body.lots.map((row) => row.lot.id);
  assert.ok(ids.includes('lot_open_24'), 'the open lot is theirs to pack');
  // Already gone from China, so no longer theirs.
  assert.equal(ids.includes('lot_ship_23'), false);

  const outsider = (await supplierLots(req({ headers: helper }), ctx)).jsonBody;
  assert.deepEqual(outsider.lots, []);
});

await check('a packing list is pieces, never customers or prices', async () => {
  const body = (await supplierLot(req({ headers: packer, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
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
  const first = (await supplierLot(req({ headers: packer, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
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
  const body = (await supplierLot(req({ headers: packer, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
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
  const body = (await supplierLot(req({ headers: packer, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.equal(body.store.handle, 'arjun_collects');

  const sent = await sendMessage(req({
    headers: packer, params: { handle: body.store.handle },
    body: { body: 'Lot 24 landed at the warehouse this morning.' },
  }), ctx);
  assert.equal(sent.status, 201);
  assert.equal(sent.jsonBody.message.from.handle, 'baiyun_hobby');
});

await check('a lot they do not pack for is closed to them', async () => {
  const refused = await supplierLot(req({ headers: packer, params: { id: 'lot_ship_23' } }), ctx);
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

await check('the lot suggests the escrow the rest of it already uses', async () => {
  // ord_2003 and ord_2004 are both in lot_my_batch and both held by Kaiju, so
  // a third order in that lot should be pointed at them. Thirty buyers each
  // picking a different holder turns one conversation into thirty.
  const listed = await createListing(req({
    headers: auth, body: { title: 'Third in the lot', priceMinor: 40_000, lotId: 'lot_my_batch', sourcing: 'import' },
  }), ctx);
  assert.equal(listed.status, 201);

  const buyer = await signup(req({
    body: {
      displayName: 'Lot Buyer', email: 'lot@figmark.example',
      phone: '+919000045511', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${buyer.jsonBody.token}` };
  const placed = await createOrder(req({
    headers: theirs, body: { listingId: listed.jsonBody.listing.id, quantity: 1 },
  }), ctx);
  assert.equal(placed.status, 201);

  const body = (await checkout(req({ headers: theirs, params: { id: placed.jsonBody.order.id } }), ctx)).jsonBody;
  assert.ok(body.suggested, 'the lot has an escrow to suggest');
  assert.equal(body.suggested.agentId, 'usr_kaiju');
  assert.match(body.suggested.because, /2 other orders in this lot already use them/);
});

await check('the suggestion reads correctly for a single other order', async () => {
  // One order says "uses", two say "use". A count in a sentence is a sentence.
  const body = (await checkout(req({ headers: auth, params: { id: 'ord_1005' } }), ctx)).jsonBody;
  if (body.suggested) assert.match(body.suggested.because, /already uses? them\./);
});

await check('a direct sale has no lot, so nothing to agree with', async () => {
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

console.log('\nwhat people are hunting for');

await check('the board carries open hunts, and says how many answers each has', async () => {
  const body = (await wantsBoard(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.wants.length >= 3, 'the seeded board is not empty');
  const answered = body.wants.find((want) => want.id === 'wnt_1');
  assert.equal(answered.offerCount, 1);
  // A hunt is addressed to somebody, and that name opens their page.
  assert.ok(answered.buyer.name && answered.buyer.handle);
  // Their own are separated out, so they need not go looking for them.
  assert.ok(body.mine.some((want) => want.id === 'wnt_1'));
});

await check('a category narrows it without inventing rows', async () => {
  const all = (await wantsBoard(req({ headers: auth }), ctx)).jsonBody.wants;
  const cards = (await wantsBoard(req({
    headers: auth, query: { category: 'Trading cards' },
  }), ctx)).jsonBody.wants;
  assert.ok(cards.length > 0 && cards.length < all.length);
  assert.ok(cards.every((want) => want.category === 'Trading cards'));
});

await check('a hunt needs saying what and where to look', async () => {
  const bare = await postWant(req({ headers: auth, body: { title: 'x', category: 'Model kits' } }), ctx);
  assert.equal(bare.status, 400);
  const uncategorised = await postWant(req({
    headers: auth, body: { title: 'A real thing I want' },
  }), ctx);
  assert.equal(uncategorised.status, 400);
  assert.match(uncategorised.jsonBody.message, /category/);
});

await check('a budget is optional, because for a rare piece it has to be', async () => {
  const posted = await postWant(req({
    headers: auth,
    body: { title: 'Anything from the 2019 Kotobukiya run', category: 'Scale figures' },
  }), ctx);
  assert.equal(posted.status, 201);
  assert.equal(posted.jsonBody.want.budgetMinor, null, 'unstated, not zero');
  assert.equal(posted.jsonBody.want.status, 'open');
  assert.ok(posted.jsonBody.want.expiresAt > new Date().toISOString(), 'and it expires');
});

await check('a budget that is not a number is refused', async () => {
  const bad = await postWant(req({
    headers: auth, body: { title: 'Something', category: 'Model kits', budgetMinor: -5 },
  }), ctx);
  assert.equal(bad.status, 400);
});

await check('a seller answers with what they can get, not only with a link', async () => {
  // The answer that matters on an import marketplace: most of what is wanted
  // here has not been bought by anybody yet.
  const answered = await offerOnWant(req({
    headers: auth, params: { id: 'wnt_2' }, query: { buyer: 'usr_gadgetgrid' },
    body: { message: 'I can source these on the next run.', priceMinor: 45_000 },
  }), ctx);
  assert.equal(answered.status, 201);
  assert.equal(answered.jsonBody.offerCount, 1, 'counted on the hunt itself');

  const detail = (await readWant(req({
    headers: auth, params: { id: 'wnt_2' }, query: { buyer: 'usr_gadgetgrid' },
  }), ctx)).jsonBody;
  assert.equal(detail.offers.length, 1);
  assert.equal(detail.offers[0].listing, null, 'nothing attached, and that is fine');
  assert.ok(detail.yours, 'and the form knows it is mine to edit');
});

await check('answering again replaces it rather than stacking another on', async () => {
  const again = await offerOnWant(req({
    headers: auth, params: { id: 'wnt_2' }, query: { buyer: 'usr_gadgetgrid' },
    body: { message: 'Actually I can do better than that.', priceMinor: 42_000 },
  }), ctx);
  assert.equal(again.status, 200);
  assert.equal(again.jsonBody.offerCount, 1, 'still one answer from me');

  const detail = (await readWant(req({
    headers: auth, params: { id: 'wnt_2' }, query: { buyer: 'usr_gadgetgrid' },
  }), ctx)).jsonBody;
  assert.equal(detail.offers.length, 1);
  assert.equal(detail.offers[0].priceMinor, 42_000);
});

await check('nobody answers their own hunt', async () => {
  const self = await offerOnWant(req({
    headers: auth, params: { id: 'wnt_1' }, query: { buyer: 'usr_demo' },
    body: { message: 'I have one myself' },
  }), ctx);
  assert.equal(self.status, 400);
  assert.equal(self.jsonBody.error, 'own_want');
});

await check("an offered item has to be the seller's own", async () => {
  // Otherwise the board becomes a place to advertise other people's stock.
  const refused = await offerOnWant(req({
    headers: auth, params: { id: 'wnt_2' }, query: { buyer: 'usr_gadgetgrid' },
    body: { message: 'Here you go', listingId: 'lst_dragon_knight' },
  }), ctx);
  assert.equal(refused.status, 404);
});

/* Somebody who is neither the buyer nor already involved. */
const bystander = await signup(req({
  body: {
    displayName: 'Not Their Business', email: 'notmine@figmark.example',
    phone: '+919000045911', password: 'longenough1',
  },
}), ctx);
const bystanderAuth = { authorization: `Bearer ${bystander.jsonBody.token}` };

await check('somebody else looking for the same thing is one tap, and reversible', async () => {
  const joined = await alsoMe(req({
    headers: bystanderAuth, params: { id: 'wnt_3' }, query: { buyer: 'usr_tokyoline' },
  }), ctx);
  assert.equal(joined.status, 200);
  assert.equal(joined.jsonBody.joined, true);
  assert.equal(joined.jsonBody.seekerCount, 1);

  const again = await alsoMe(req({
    headers: bystanderAuth, params: { id: 'wnt_3' }, query: { buyer: 'usr_tokyoline' },
  }), ctx);
  assert.equal(again.jsonBody.joined, false, 'pressing it again takes you off');
  assert.equal(again.jsonBody.seekerCount, 0);

  // Back on, so the notification test below has an audience.
  await alsoMe(req({
    headers: bystanderAuth, params: { id: 'wnt_3' }, query: { buyer: 'usr_tokyoline' },
  }), ctx);
});

await check('you cannot add yourself to your own hunt', async () => {
  // You are already on it, by having written it.
  const self = await alsoMe(req({
    headers: auth, params: { id: 'wnt_1' }, query: { buyer: 'usr_demo' },
  }), ctx);
  assert.equal(self.status, 400);
  assert.equal(self.jsonBody.error, 'own_want');
});

await check('an answer tells the person who asked and everyone who joined in', async () => {
  // The reason to press +Me at all: a board you have to keep going back to
  // check is a board you stop checking.
  const answered = await offerOnWant(req({
    headers: auth, params: { id: 'wnt_3' }, query: { buyer: 'usr_tokyoline' },
    body: { message: 'I can bring twenty HGs in on the next run.' },
  }), ctx);
  assert.equal(answered.status, 201);

  const theirs = (await notifications(req({ headers: bystanderAuth }), ctx)).jsonBody;
  assert.equal(theirs.unread, 1, 'somebody who joined in hears about it');
  const row = theirs.notifications[0];
  assert.equal(row.kind, 'want_answered');
  assert.match(row.body, /HG Gundam/);
  // It goes somewhere. A notification that only says something happened makes
  // the reader go and find it.
  assert.match(row.link, /view=wanted/);
  assert.match(row.link, /want=wnt_3/);
  assert.match(row.link, /buyer=usr_tokyoline/);
});

await check('the seller who answered is not told about their own answer', async () => {
  const mine = (await notifications(req({ headers: auth }), ctx)).jsonBody;
  assert.equal(
    mine.notifications.some((row) => row.body.includes('HG Gundam')),
    false,
    'they know: they wrote it',
  );
});

await check('editing an answer is not news', async () => {
  const before = (await notifications(req({ headers: bystanderAuth }), ctx)).jsonBody.notifications.length;
  await offerOnWant(req({
    headers: auth, params: { id: 'wnt_3' }, query: { buyer: 'usr_tokyoline' },
    body: { message: 'Twenty, and I can do better on the price.' },
  }), ctx);
  const after = (await notifications(req({ headers: bystanderAuth }), ctx)).jsonBody.notifications.length;
  assert.equal(after, before, 'a reworded answer would teach people to ignore the rest');
});

await check('reading one marks it read without touching the others', async () => {
  const before = (await notifications(req({ headers: bystanderAuth }), ctx)).jsonBody;
  assert.ok(before.unread > 0);

  const marked = await markRead(req({
    headers: bystanderAuth, body: { id: before.notifications[0].id },
  }), ctx);
  assert.equal(marked.status, 200);

  const after = (await notifications(req({ headers: bystanderAuth }), ctx)).jsonBody;
  assert.equal(after.unread, before.unread - 1);
  assert.equal(after.notifications[0].read, true);
});

await check('notifications are yours alone', async () => {
  const stranger = await signup(req({
    body: {
      displayName: 'Uninvolved', email: 'uninvolved@figmark.example',
      phone: '+919000045921', password: 'longenough1',
    },
  }), ctx);
  const theirs = (await notifications(req({
    headers: { authorization: `Bearer ${stranger.jsonBody.token}` },
  }), ctx)).jsonBody;
  assert.deepEqual(theirs.notifications, []);
  assert.equal(theirs.unread, 0);
});

await check('only whoever posted a hunt can close it', async () => {
  assert.equal(bystander.status, 201, `signup failed: ${JSON.stringify(bystander.jsonBody)}`);
  const refused = await closeWant(req({
    headers: bystanderAuth, params: { id: 'wnt_1' }, query: { buyer: 'usr_demo' },
  }), ctx);
  assert.equal(refused.status, 403);
});

await check('closing takes it off the board and refuses further answers', async () => {
  const closed = await closeWant(req({
    headers: auth, params: { id: 'wnt_1' }, query: { buyer: 'usr_demo' },
  }), ctx);
  assert.equal(closed.status, 200);
  assert.equal(closed.jsonBody.want.status, 'closed');

  const board = (await wantsBoard(req({ headers: auth }), ctx)).jsonBody;
  assert.equal(board.wants.some((want) => want.id === 'wnt_1'), false, 'gone from the board');

  // Asked by somebody who could otherwise have answered, so it is the hunt
  // being over that refuses them and not a rule about their own post.
  const late = await offerOnWant(req({
    headers: bystanderAuth, params: { id: 'wnt_1' }, query: { buyer: 'usr_demo' },
    body: { message: 'Still got one going' },
  }), ctx);
  assert.equal(late.status, 409);
  assert.equal(late.jsonBody.error, 'want_closed');
});

console.log('\nbeing told what happened');

await check('a claimed payment tells the seller, and nobody else', async () => {
  const buyer = await signup(req({
    body: {
      displayName: 'Told You', email: 'toldyou@figmark.example',
      phone: '+919000046101', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${buyer.jsonBody.token}` };

  const listed = await createListing(req({
    headers: auth, body: { title: 'Notifying item', priceMinor: 30_000, sourcing: 'in_hand' },
  }), ctx);
  const order = (await createOrder(req({
    headers: theirs, body: { listingId: listed.jsonBody.listing.id, quantity: 1 },
  }), ctx)).jsonBody.order;

  const before = (await notifications(req({ headers: auth }), ctx)).jsonBody.unread;
  await claimPayment(req({
    headers: theirs, params: { id: order.id }, body: { reference: 'UTR-NOTIFY-1' },
  }), ctx);

  const sellers = (await notifications(req({ headers: auth }), ctx)).jsonBody;
  assert.equal(sellers.unread, before + 1);
  const row = sellers.notifications[0];
  assert.equal(row.kind, 'payment_claimed');
  assert.equal(row.link, `/order/${order.id}`, 'straight to the order it is about');

  // The buyer did it; they do not need telling.
  const buyers = (await notifications(req({ headers: theirs }), ctx)).jsonBody;
  assert.equal(buyers.notifications.some((entry) => entry.kind === 'payment_claimed'), false);

  // And the answer comes back the other way.
  await settleClaim(req({
    headers: auth, params: { id: order.id },
    body: { accept: false, reason: 'Nothing against that reference yet.' },
  }), ctx);
  const answered = (await notifications(req({ headers: theirs }), ctx)).jsonBody;
  assert.equal(answered.notifications[0].kind, 'payment_settled');
  // A denial is the one they have to act on, so it carries the reason.
  assert.match(answered.notifications[0].body, /Nothing against that reference/);
});

await check('a lot moving tells everybody who bought into it', async () => {
  // The notification this whole product is for: twenty people paid weeks ago
  // and cannot know it cleared customs unless somebody tells them.
  // Read who is actually in the lot rather than naming fixture ids, which is
  // how the last version of this failed for a reason unrelated to notifying.
  const inLot = await (await getRepository()).listOrdersForLot('lot_my_batch');
  const buyerIds = [...new Set(inLot.map((order) => order.buyerId))];
  assert.ok(buyerIds.length > 0, 'somebody bought into this lot');

  const before = await Promise.all(
    buyerIds.map(async (id) => (await noticesFor(id)).length),
  );

  // Whatever comes next from where the lot actually is: earlier tests move
  // it, and a hard-coded stage fails for a reason that has nothing to do with
  // whether anybody was told.
  const lot = await (await getRepository()).getLot('usr_demo', 'lot_my_batch');
  const stages = LOT_STAGES;
  const next = stages[stages.indexOf(lot.stage) + 1];
  assert.ok(next, 'the lot has somewhere left to go');

  const moved = await advanceStage(req({
    headers: auth, params: { id: 'lot_my_batch' }, body: { stage: next },
  }), ctx);
  assert.equal(moved.status, 200, JSON.stringify(moved.jsonBody));

  const after = await Promise.all(
    buyerIds.map(async (id) => (await noticesFor(id)).length),
  );
  for (const [index, id] of buyerIds.entries()) {
    assert.ok(after[index] > before[index], `${id} was told`);
  }

  const one = (await noticesFor(buyerIds[0]))[0];
  assert.equal(one.kind, 'lot_moved');
  // To their own purchases, not to the seller's view of the lot, which
  // shows them everybody else's orders.
  assert.equal(one.link, '/me?tab=purchases');
});

await check('a dispute tells the other side and whoever holds the money', async () => {
  const opened = (await noticesFor('usr_demo'))
    .filter((row) => row.kind === 'dispute_opened');
  // dsp_1 was raised against usr_demo by usr_gadgetgrid in the fixtures, so
  // opening one in this run is what puts a row here.
  assert.ok(Array.isArray(opened));

  const buyer = await signup(req({
    body: {
      displayName: 'Will Dispute', email: 'willdispute@figmark.example',
      phone: '+919000046102', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${buyer.jsonBody.token}` };

  const listed = await createListing(req({
    headers: auth, body: { title: 'Disputable item', priceMinor: 50_000, sourcing: 'in_hand' },
  }), ctx);
  const order = (await createOrder(req({
    headers: theirs, body: { listingId: listed.jsonBody.listing.id, quantity: 1 },
  }), ctx)).jsonBody.order;
  await payOrder(req({
    headers: theirs, params: { id: order.id },
    body: { protection: true, escrowAgentId: 'usr_escrow_meera' },
  }), ctx);

  const beforeSeller = (await noticesFor('usr_demo')).length;
  const beforeEscrow = (await noticesFor('usr_escrow_meera')).length;

  const raised = await openDispute(req({
    headers: theirs, params: { id: order.id },
    body: { reasonCode: 'not_as_described', reason: 'The box arrived crushed and the figure is chipped.' },
  }), ctx);
  assert.equal(raised.status, 201);

  assert.ok(
    (await noticesFor('usr_demo')).length > beforeSeller,
    'the other side is told',
  );
  assert.ok(
    (await noticesFor('usr_escrow_meera')).length > beforeEscrow,
    'and so is whoever is holding the money',
  );
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

/* ── the social fill meter ─────────────────────────────────────────────── */
console.log('\nfilling a pre-order together');

/**
 * A campaign of the demo seller's, made here rather than taken from the
 * fixtures: these checks are about numbers moving, and a fixture another check
 * has already bought into has numbers that moved for reasons of its own.
 */
const openCampaign = async (threshold, title = 'Group-buy fixture') => {
  const made = await createListing(req({
    headers: auth,
    body: {
      title,
      priceMinor: 120_000,
      category: 'Scale figures',
      preOrder: {
        fillThreshold: threshold,
        cutoffAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
      quantityAvailable: 50,
    },
  }), ctx);
  assert.equal(made.status, 201);
  return made.jsonBody.listing.id;
};

let buyerSeq = 0;
const newBuyer = async (name) => {
  buyerSeq += 1;
  const made = await signup(req({
    body: {
      displayName: name,
      email: `pledger${buyerSeq}@figmark.example`,
      phone: `+91900007${String(1000 + buyerSeq).slice(-4)}`,
      password: 'longenough1',
    },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return {
    id: made.jsonBody.user.id,
    headers: { authorization: `Bearer ${made.jsonBody.token}` },
  };
};

await check('pledging joins the number without paying anything', async () => {
  const id = await openCampaign(10);
  const buyer = await newBuyer('Pledger One');

  const joined = await pledge(req({ headers: buyer.headers, params: { id }, body: { units: 2 } }), ctx);
  assert.equal(joined.status, 200);

  const view = joined.jsonBody.preOrder;
  assert.equal(view.pledgedCount, 2);
  // The half that is money has not moved, which is the whole point of it.
  assert.equal(view.filledCount, 0);
  assert.equal(view.committed, 2);
  assert.equal(view.toGo, 8);
  assert.equal(view.state, 'open');
  assert.deepEqual(joined.jsonBody.mine, { pledged: true, booked: 0, units: 2, listed: false });
});

await check('a second tap is leaving, and the number goes back down', async () => {
  const id = await openCampaign(10);
  const buyer = await newBuyer('Pledger Two');

  await pledge(req({ headers: buyer.headers, params: { id } }), ctx);
  const left = await pledge(req({ headers: buyer.headers, params: { id } }), ctx);
  assert.equal(left.jsonBody.preOrder.pledgedCount, 0);
  assert.equal(left.jsonBody.mine, null);
});

await check('nobody pledges their own campaign, and nothing else is one', async () => {
  const id = await openCampaign(10);
  const own = await pledge(req({ headers: auth, params: { id } }), ctx);
  assert.equal(own.status, 400);
  assert.equal(own.jsonBody.error, 'own_listing');

  // An ordinary listing has no meter to join.
  const plain = await createListing(req({ headers: auth, body: { title: 'Just a thing', priceMinor: 900 } }), ctx);
  const buyer = await newBuyer('Pledger Three');
  const refused = await pledge(req({
    headers: buyer.headers, params: { id: plain.jsonBody.listing.id },
  }), ctx);
  assert.equal(refused.status, 409);
  assert.equal(refused.jsonBody.error, 'not_a_preorder');
});

await check('being named is opt in, and being counted is not optional', async () => {
  const id = await openCampaign(10);
  const shy = await newBuyer('Shy Pledger');
  const loud = await newBuyer('Loud Pledger');

  await pledge(req({ headers: shy.headers, params: { id }, body: { units: 1 } }), ctx);
  await pledge(req({ headers: loud.headers, params: { id }, body: { units: 1, listed: true } }), ctx);

  // A stranger sees the count in full and one name.
  const outside = (await readPreOrder(req({ params: { id } }), ctx)).jsonBody;
  assert.equal(outside.preOrder.pledgedCount, 2);
  assert.deepEqual(outside.people.map((row) => row.ref.name), ['Loud Pledger']);
  assert.equal(outside.unlisted, 1);

  // ...and the shy one still sees their own place in it.
  const theirs = (await readPreOrder(req({ headers: shy.headers, params: { id } }), ctx)).jsonBody;
  assert.ok(theirs.people.some((row) => row.ref.name === 'Shy Pledger'));
  assert.equal(theirs.unlisted, 0, 'their own row is named to them, so nobody is left uncounted');
});

await check('nearly there tells everyone who is in, once', async () => {
  const id = await openCampaign(10);
  const first = await newBuyer('Nearly One');
  const second = await newBuyer('Nearly Two');

  await pledge(req({ headers: first.headers, params: { id }, body: { units: 5 } }), ctx);
  assert.equal((await noticesFor(first.id)).length, 0, 'halfway is not news');

  const near = await pledge(req({ headers: second.headers, params: { id }, body: { units: 4 } }), ctx);
  assert.equal(near.jsonBody.preOrder.state, 'nearly');

  for (const person of [first, second]) {
    const notices = (await noticesFor(person.id)).filter((row) => row.kind === 'preorder_nearly');
    assert.equal(notices.length, 1, `${person.id} should have been told exactly once`);
    assert.match(notices[0].title, /1 more/);
    assert.equal(notices[0].link, `/listing/${id}`);
  }

  // Reading it again must not send it again: a nudge that repeats is a reason
  // to turn notifications off.
  await readPreOrder(req({ params: { id } }), ctx);
  assert.equal((await noticesFor(first.id)).filter((r) => r.kind === 'preorder_nearly').length, 1);
});

await check('filling calls the pledges in, and says so to the right people', async () => {
  const id = await openCampaign(4);
  const pledger = await newBuyer('Filling Pledger');
  const buyer = await newBuyer('Filling Buyer');

  await pledge(req({ headers: pledger.headers, params: { id }, body: { units: 2 } }), ctx);
  const bought = await createOrder(req({ headers: buyer.headers, body: { listingId: id, quantity: 2 } }), ctx);
  assert.equal(bought.status, 201);

  // Read as the buyer, who is always shown their own row whether or not they
  // asked to be named.
  const roster = (await readPreOrder(req({ headers: buyer.headers, params: { id } }), ctx)).jsonBody;
  const view = roster.preOrder;
  assert.equal(view.filledCount, 2);
  assert.equal(view.pledgedCount, 2);
  // An order exists, but the buyer has not paid yet - they choose how on the
  // next screen. The roster must not say otherwise to the people weighing up
  // whether to join.
  const booker = roster.people.find((row) => row.booked);
  assert.equal(booker.paid, false, 'an unpaid order must not be shown as paid');
  // Committed, not sold: two of these four are still only promised, and the
  // state says which.
  assert.equal(view.state, 'called');
  assert.ok(view.pledgeDueAt, 'a called-in pledge has a deadline to be called in by');

  // Everybody hears it is happening; only the one who has not paid is billed.
  for (const person of [pledger, buyer]) {
    assert.equal((await noticesFor(person.id)).filter((r) => r.kind === 'preorder_filled').length, 1);
  }
  assert.equal((await noticesFor(pledger.id)).filter((r) => r.kind === 'preorder_due').length, 1);
  assert.equal((await noticesFor(buyer.id)).filter((r) => r.kind === 'preorder_due').length, 0);
});

await check('booking a pledge you already made does not count you twice', async () => {
  const id = await openCampaign(10);
  const buyer = await newBuyer('Converting Buyer');

  await pledge(req({ headers: buyer.headers, params: { id }, body: { units: 3 } }), ctx);
  await createOrder(req({ headers: buyer.headers, body: { listingId: id, quantity: 3 } }), ctx);

  const after = (await readPreOrder(req({ headers: buyer.headers, params: { id } }), ctx)).jsonBody;
  assert.equal(after.preOrder.filledCount, 3);
  assert.equal(after.preOrder.pledgedCount, 0, 'the pledge became the order rather than joining it');
  assert.equal(after.preOrder.committed, 3);
  assert.deepEqual(after.mine, { pledged: false, booked: 3, units: 3, listed: false });
});

await check('a campaign that runs out of time says so, and says what happened to the money', async () => {
  const id = await openCampaign(10);
  const pledger = await newBuyer('Short Pledger');
  const buyer = await newBuyer('Short Buyer');
  await pledge(req({ headers: pledger.headers, params: { id }, body: { units: 1 } }), ctx);
  await createOrder(req({ headers: buyer.headers, body: { listingId: id, quantity: 1 } }), ctx);

  await expireCampaign(id);

  const closed = (await readPreOrder(req({ params: { id } }), ctx)).jsonBody.preOrder;
  assert.equal(closed.state, 'closed');
  assert.ok(closed.closedAt);

  for (const person of [pledger, buyer]) {
    const notices = (await noticesFor(person.id)).filter((r) => r.kind === 'preorder_closed');
    assert.equal(notices.length, 1);
    assert.match(notices[0].title, /8 short/);
  }
  // A refund is only mentioned to a campaign that took money.
  assert.match((await noticesFor(buyer.id)).find((r) => r.kind === 'preorder_closed').body, /refunded/);

  // And a closed campaign takes no more pledges.
  const late = await newBuyer('Late Pledger');
  const refused = await pledge(req({ headers: late.headers, params: { id } }), ctx);
  assert.equal(refused.status, 409);
});

await check('whoever brought someone in gets the credit, and cannot give it to themselves', async () => {
  const id = await openCampaign(10);
  const recruiter = await newBuyer('Recruiter');
  const recruited = await newBuyer('Recruited');

  await pledge(req({ headers: recruiter.headers, params: { id }, body: { listed: true } }), ctx);
  await pledge(req({
    headers: recruited.headers, params: { id }, body: { listed: true, via: recruiter.id },
  }), ctx);

  const theirs = (await readPreOrder(req({ headers: recruiter.headers, params: { id } }), ctx)).jsonBody;
  assert.deepEqual(theirs.brought.map((ref) => ref.name), ['Recruited']);

  // Nobody credits themselves, and the seller does not recruit for their own.
  const selfMade = await newBuyer('Self Made');
  await pledge(req({
    headers: selfMade.headers, params: { id }, body: { via: selfMade.id },
  }), ctx);
  const sellerId = (await getRepository()).getListing(id).then((l) => l.sellerId);
  const viaSeller = await newBuyer('Via Seller');
  await pledge(req({
    headers: viaSeller.headers, params: { id }, body: { via: await sellerId },
  }), ctx);

  const own = (await readPreOrder(req({ headers: selfMade.headers, params: { id } }), ctx)).jsonBody;
  assert.deepEqual(own.brought, []);
});

await check('the credit follows a pledge into the order it becomes', async () => {
  const id = await openCampaign(10);
  const recruiter = await newBuyer('Credit Recruiter');
  const recruited = await newBuyer('Credit Recruited');

  await pledge(req({ headers: recruited.headers, params: { id }, body: { via: recruiter.id } }), ctx);
  const bought = await createOrder(req({ headers: recruited.headers, body: { listingId: id } }), ctx);
  assert.equal(bought.jsonBody.order.broughtBy, recruiter.id, 'paying does not lose the recruiter their credit');

  const theirs = (await readPreOrder(req({ headers: recruiter.headers, params: { id } }), ctx)).jsonBody;
  assert.deepEqual(theirs.brought.map((ref) => ref.name), ['Credit Recruited']);
});

await check('the listing page carries the group, not just the counter', async () => {
  const id = await openCampaign(10, 'Detail campaign');
  const buyer = await newBuyer('Detail Pledger');
  await pledge(req({ headers: buyer.headers, params: { id }, body: { listed: true } }), ctx);

  const page = (await listingDetail(req({ params: { id } }), ctx)).jsonBody;
  assert.equal(page.preOrder.preOrder.pledgedCount, 1);
  assert.deepEqual(page.preOrder.people.map((row) => row.ref.name), ['Detail Pledger']);

  // An ordinary listing has none of it rather than an empty one.
  const plain = await createListing(req({ headers: auth, body: { title: 'No meter', priceMinor: 500 } }), ctx);
  const flat = (await listingDetail(req({ params: { id: plain.jsonBody.listing.id } }), ctx)).jsonBody;
  assert.equal(flat.preOrder, null);
});

await check('the bar and the list under it are the same set of people', async () => {
  // The one way this feature can lie: counters cached on the listing drifting
  // from the pledges and orders the roster is drawn from. Checked against the
  // fixtures rather than something built here, because those are the rows that
  // predate the counters and would drift first.
  const board = (await feed(req({ query: { kind: 'pre_order' } }), ctx)).jsonBody.listings;
  assert.ok(board.length > 0, 'the fixtures should have open pre-orders');

  for (const card of board) {
    const roster = (await readPreOrder(req({ params: { id: card.id } }), ctx)).jsonBody;
    const view = roster.preOrder;

    assert.equal(view.committed, view.filledCount + view.pledgedCount, card.id);

    const booked = roster.people.filter((row) => row.booked).reduce((n, row) => n + row.units, 0);
    const pledged = roster.people.filter((row) => !row.booked).reduce((n, row) => n + row.units, 0);
    // Named people only, so the roster can be short of the count - but never
    // over it, which would mean somebody is on the list and not in the number.
    assert.ok(booked <= view.filledCount, `${card.id}: more booked rows than booked units`);
    assert.ok(pledged <= view.pledgedCount, `${card.id}: more pledged rows than pledged units`);
    assert.equal(
      roster.people.length + roster.unlisted >= 1 || view.committed === 0,
      true,
      `${card.id}: a committed campaign with nobody in it`,
    );

    // And the card and the page agree about how far along it is.
    assert.equal(card.preOrder.filledCount, view.filledCount, `${card.id}: the card disagrees with the page`);
  }
});

await check('the fixtures do not expire while nobody is looking', async () => {
  // Every date in the seed hangs off a frozen clock so two workers cannot
  // produce two different manifests. Deadlines cannot: a pre-order cutoff and a
  // review's reveal window mean nothing except relative to today, and fixed
  // ones lapsed twelve days after they were written - the campaign closed
  // itself, the hidden review revealed itself, and a suite that was green on
  // Friday failed on Sunday with nothing changed.
  // The seeded ones only: other checks in this file close campaigns on purpose
  // to see what closing does.
  const seeded = new Set(seedListings().map((listing) => listing.id));
  const open = (await feed(req({ query: { kind: 'pre_order' } }), ctx)).jsonBody.listings
    .filter((listing) => seeded.has(listing.id));
  assert.ok(open.length > 0, 'the fixtures should have open pre-orders');
  for (const listing of open) {
    assert.ok(
      Date.parse(listing.preOrder.cutoffAt) > Date.now(),
      `${listing.id} closed on ${listing.preOrder.cutoffAt}, so the fixture demonstrates nothing`,
    );
  }

  // And every review the seed writes as unrevealed still has a window open.
  // Read from the seed rather than from the store: checks above this one answer
  // that review on purpose, which reveals it, correctly.
  for (const review of seedReviews().filter((entry) => !entry.revealed)) {
    assert.ok(
      Date.parse(review.revealAt) > Date.now(),
      `${review.id} would reveal itself on ${review.revealAt}, so the fixture demonstrates nothing`,
    );
  }
});

/* ── browsing by what it is, and how it is sold ────────────────────────── */
console.log('\nnarrowing the catalog');

await check('a heading narrows to the categories under it', async () => {
  const all = (await feed(req(), ctx)).jsonBody.listings;
  const figures = (await feed(req({ query: { group: 'figures' } }), ctx)).jsonBody.listings;

  assert.ok(figures.length > 0, 'the fixtures should have figures in them');
  assert.ok(figures.length < all.length, 'a heading that changes nothing is not a filter');
  for (const listing of figures) {
    assert.ok(
      ['Scale figures', 'Anime merch', 'Collectibles'].includes(listing.category),
      `${listing.category} is not under Figures`,
    );
  }

  // An unknown heading matches nothing rather than everything, which is the
  // failure that would make every chip look broken.
  assert.equal((await feed(req({ query: { group: 'nonsense' } }), ctx)).jsonBody.listings.length, 0);
});

await check('the second row says how it is sold, not what it is', async () => {
  const all = (await feed(req(), ctx)).jsonBody.listings;

  const preOrders = (await feed(req({ query: { kind: 'pre_order' } }), ctx)).jsonBody.listings;
  assert.ok(preOrders.length > 0);
  assert.ok(preOrders.every((listing) => listing.preOrder !== null));

  const inHand = (await feed(req({ query: { kind: 'in_hand' } }), ctx)).jsonBody.listings;
  assert.ok(inHand.length > 0);
  assert.ok(inHand.every((listing) => listing.sourcing !== 'import'));

  // 'all' is a real chip rather than the absence of one, and must not narrow.
  assert.equal((await feed(req({ query: { kind: 'all' } }), ctx)).jsonBody.listings.length, all.length);
});

await check('a mixed lot is its own kind of thing to buy', async () => {
  const before = (await feed(req({ query: { kind: 'mixed_lot' } }), ctx)).jsonBody.listings.length;
  const made = await createListing(req({
    headers: auth,
    body: { title: 'Box of loose parts', priceMinor: 45_000, category: 'Model kits', bundle: true },
  }), ctx);
  assert.equal(made.jsonBody.listing.bundle, true);

  const after = (await feed(req({ query: { kind: 'mixed_lot' } }), ctx)).jsonBody.listings;
  assert.equal(after.length, before + 1);
  assert.ok(after.every((listing) => listing.bundle === true));
  // ...and it is not quietly also a single item.
  const singles = (await feed(req({ query: { kind: 'in_hand' } }), ctx)).jsonBody.listings;
  assert.ok(singles.some((listing) => listing.id === made.jsonBody.listing.id), 'a mixed lot in hand is still in hand');
});

await check('a category nobody offers cannot be stored as one', async () => {
  const made = await createListing(req({
    headers: auth, body: { title: 'Mystery', priceMinor: 100, category: 'Whatever I Typed' },
  }), ctx);
  assert.equal(made.jsonBody.listing.category, 'Collectibles');
});

/* ── power selling ─────────────────────────────────────────────────────── */
console.log('\nselling on a timer');

const saleItem = (title, price, after, extra = {}) => ({
  title, priceMinor: price, listPriceMinor: after,
  category: 'Scale figures', condition: 'MISB', quantity: 1, ...extra,
});

await check('a run posts its opening message and its first item', async () => {
  const before = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody;

  const made = await schedulePowerSale(req({
    headers: auth,
    body: {
      name: 'Friday drop',
      openingBody: 'Friday drop starts now — an hour on each piece.',
      closingBody: "That's the lot.",
      everyMinutes: 1,
      windowMinutes: 60,
      items: [saleItem('First piece', 50_000, 65_000), saleItem('Second piece', 40_000, 52_000)],
    },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));

  const sale = made.jsonBody.sale;
  assert.equal(sale.status, 'running', 'starting now means starting now');
  assert.equal(sale.posted, 1, 'one item out, not both — a quiet night must not arrive as one scroll');

  const after = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody;
  // The opening message and the first item.
  assert.equal(after.posts.length, before.posts.length + 2);

  // The item is a real listing, open at the members' price.
  const first = sale.items[0];
  assert.ok(first.listingId);
  const listed = (await listingDetail(req({ params: { id: first.listingId } }), ctx)).jsonBody;
  assert.equal(listed.listing.priceMinor, 50_000);
  assert.ok(first.windowLeft > 0, 'the window is open');
});

await check('a live sale item is in the channel and nowhere else', async () => {
  const made = await schedulePowerSale(req({
    headers: auth,
    body: {
      name: 'Members only',
      openingBody: 'Starting now.',
      everyMinutes: 1,
      windowMinutes: 60,
      items: [saleItem('Hidden while the window is open', 20_000, 30_000)],
    },
  }), ctx);
  const item = made.jsonBody.sale.items[0];
  assert.ok(item.listingId);

  // Buyable by whoever is in the room: the page resolves, at the members' price.
  const page = (await listingDetail(req({ params: { id: item.listingId } }), ctx)).jsonBody;
  assert.equal(page.listing.priceMinor, 20_000);
  assert.equal(page.listing.unlisted, true);

  // And absent from every list. That is the whole bargain of the window - a
  // price anybody browsing the buy page could take is not a members' price.
  const catalog = (await feed(req(), ctx)).jsonBody.listings;
  assert.ok(!catalog.some((listing) => listing.id === item.listingId), 'not on the buy page');

  const mine = (await myActivity(req({ headers: auth }), ctx)).jsonBody.listings;
  assert.ok(!mine.some((listing) => listing.id === item.listingId), "not in the shop's own grid");

  // Searching for it by name does not surface it either.
  const searched = (await feed(req({ query: { q: 'Hidden while' } }), ctx)).jsonBody.listings;
  assert.equal(searched.length, 0);
});

await check('stopping a run hands over what it already dropped', async () => {
  const made = await schedulePowerSale(req({
    headers: auth,
    body: {
      openingBody: 'Short one.',
      everyMinutes: 60,
      windowMinutes: 60,
      items: [saleItem('Dropped then stopped', 15_000, 21_000), saleItem('Never dropped', 15_000, 21_000)],
    },
  }), ctx);
  const sale = made.jsonBody.sale;
  const dropped = sale.items[0];
  assert.ok(dropped.listingId);

  await stopPowerSale(req({ headers: auth, params: { id: sale.id } }), ctx);

  // Stranding it would leave an item nobody can find, priced for a window that
  // will never close.
  const page = (await listingDetail(req({ params: { id: dropped.listingId } }), ctx)).jsonBody;
  assert.equal(page.listing.unlisted, false);
  assert.equal(page.listing.priceMinor, 21_000);
  const catalog = (await feed(req(), ctx)).jsonBody.listings;
  assert.ok(catalog.some((listing) => listing.id === dropped.listingId), 'it is on the buy page now');
});

await check('a run says when the last item hands over', async () => {
  const made = await schedulePowerSale(req({
    headers: auth,
    body: {
      openingBody: 'Three of them.',
      leadMinutes: 0,
      everyMinutes: 10,
      windowMinutes: 30,
      items: [
        saleItem('One', 10_000, 14_000),
        saleItem('Two', 10_000, 14_000),
        saleItem('Three', 10_000, 14_000),
      ],
    },
  }), ctx);
  const sale = made.jsonBody.sale;

  // The third is due at +20 minutes and its window shuts 30 after that, so the
  // whole run is public about fifty minutes from now.
  const minutesOut = (Date.parse(sale.finishesAt) - Date.now()) / 60_000;
  assert.ok(minutesOut > 45 && minutesOut < 55, `expected about 50 minutes, got ${minutesOut}`);

  // And nothing to count down to once it is over.
  await stopPowerSale(req({ headers: auth, params: { id: sale.id } }), ctx);
  const stopped = (await readPowerSale(req({ headers: auth, params: { id: sale.id } }), ctx)).jsonBody.sale;
  assert.equal(stopped.finishesAt, null);
});

await check('an item nobody has taken goes public at the higher price', async () => {
  const made = await schedulePowerSale(req({
    headers: auth,
    body: {
      name: 'Short window',
      openingBody: 'One piece, five minutes.',
      closingBody: 'Done.',
      everyMinutes: 1,
      // The floor, so the window can be run out inside a test rather than
      // waited out.
      windowMinutes: 5,
      items: [saleItem('Ends quickly', 30_000, 44_000)],
    },
  }), ctx);
  const sale = made.jsonBody.sale;
  const item = sale.items[0];
  assert.ok(item.listingId);

  // Wind the window back rather than sleeping for it.
  const repository = await getRepository();
  const stored = await repository.getPowerSale('usr_demo', sale.id);
  stored.items[0].windowEndsAt = new Date(Date.now() - 1000).toISOString();
  await repository.savePowerSale(stored);

  const again = (await readPowerSale(req({ headers: auth, params: { id: sale.id } }), ctx)).jsonBody.sale;
  assert.ok(again.items[0].liftedAt, 'the window closed');
  assert.equal(again.status, 'done', 'and with nothing left queued, so is the run');

  // Same listing, new price. Not a second listing: somebody who bookmarked it
  // should find the item, not a dead link beside a fresh one.
  const listed = (await listingDetail(req({ params: { id: item.listingId } }), ctx)).jsonBody;
  assert.equal(listed.listing.id, item.listingId);
  assert.equal(listed.listing.priceMinor, 44_000);

  // And it joins the catalog, which is what "moves to the shop" means.
  assert.equal(listed.listing.unlisted, false);
  const catalog = (await feed(req(), ctx)).jsonBody.listings;
  assert.ok(catalog.some((entry) => entry.id === item.listingId), 'it is on the buy page now');
});

await check('a members-only price has to actually be one', async () => {
  const same = await schedulePowerSale(req({
    headers: auth,
    body: {
      openingBody: 'Starting.',
      items: [saleItem('No discount at all', 20_000, 20_000)],
    },
  }), ctx);
  assert.equal(same.status, 400);
  assert.match(same.jsonBody.message, /above the members/);
});

await check('a run needs something to say and something to sell', async () => {
  const silent = await schedulePowerSale(req({
    headers: auth, body: { items: [saleItem('Lonely', 100, 200)] },
  }), ctx);
  assert.equal(silent.status, 400);

  const empty = await schedulePowerSale(req({
    headers: auth, body: { openingBody: 'Starting now.', items: [] },
  }), ctx);
  assert.equal(empty.status, 400);
});

await check('stopping a run leaves what it already said', async () => {
  const made = await schedulePowerSale(req({
    headers: auth,
    body: {
      openingBody: 'Long one.',
      everyMinutes: 60,
      windowMinutes: 60,
      items: [saleItem('One', 10_000, 15_000), saleItem('Two', 10_000, 15_000)],
    },
  }), ctx);
  const sale = made.jsonBody.sale;
  const posted = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody.posts.length;

  const stopped = await stopPowerSale(req({ headers: auth, params: { id: sale.id } }), ctx);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.jsonBody.sale.status, 'cancelled');

  // Nothing is un-said, and nothing further goes out.
  const after = (await channelThread(req({ headers: auth, params: { id: 'usr_demo' } }), ctx)).jsonBody.posts.length;
  assert.equal(after, posted);
  const again = await stopPowerSale(req({ headers: auth, params: { id: sale.id } }), ctx);
  assert.equal(again.status, 409);
});

await check('deleting an account takes its hidden listings too', async () => {
  // A sale item mid-window is out of every catalog, which is the point - but
  // the operations console deletes what an account made, and a filtered list is
  // how a row outlives the account that wrote it.
  const seller = await signup(req({
    body: {
      displayName: 'Briefly Selling', username: 'briefly_selling',
      email: 'briefly@figmark.example', phone: '+919000078801', password: 'longenough1',
    },
  }), ctx);
  assert.equal(seller.status, 201, JSON.stringify(seller.jsonBody));
  const theirs = { authorization: `Bearer ${seller.jsonBody.token}` };
  const shop = await saveStorefront(req({
    headers: theirs, body: { storefrontName: 'Briefly', username: 'briefly_shop' },
  }), ctx);
  assert.equal(shop.status, 200, JSON.stringify(shop.jsonBody));

  const run = await schedulePowerSale(req({
    headers: theirs,
    body: {
      openingBody: 'One item, starting now.',
      everyMinutes: 1,
      windowMinutes: 60,
      items: [{
        title: 'Hidden at deletion time', priceMinor: 11_000, listPriceMinor: 16_000,
        category: 'Scale figures', condition: 'MISB', quantity: 1,
      }],
    },
  }), ctx);
  assert.equal(run.status, 201, JSON.stringify(run.jsonBody));
  const hidden = run.jsonBody.sale.items[0].listingId;
  assert.ok(hidden);
  assert.equal((await listingDetail(req({ params: { id: hidden } }), ctx)).jsonBody.listing.unlisted, true);

  const id = seller.jsonBody.user.id;
  const seen = (await adminUser(req({ headers: auth, params: { id } }), ctx)).jsonBody;
  assert.ok(seen.listings.some((listing) => listing.id === hidden), 'an operator sees it');

  const deleted = await adminDeleteUser(req({ headers: auth, params: { id } }), ctx);
  assert.equal(deleted.status, 200);
  assert.equal((await listingDetail(req({ params: { id: hidden } }), ctx)).status, 404, 'and it goes with them');
});

await check('a run belongs to the shop that scheduled it', async () => {
  const stranger = await signup(req({
    body: { displayName: 'Not A Seller', email: 'nps@figmark.example', phone: '+919000077771', password: 'longenough1' },
  }), ctx);
  const theirs = { authorization: `Bearer ${stranger.jsonBody.token}` };
  // No storefront, so there is no shop to run one in.
  const refused = await powerSales(req({ headers: theirs }), ctx);
  assert.equal(refused.status, 409);
  assert.equal(refused.jsonBody.error, 'no_storefront');

  // And somebody else's shop is not theirs to post in.
  const nosy = await powerSales(req({ headers: theirs, query: { store: 'usr_kaiju' } }), ctx);
  assert.equal(nosy.status, 403);
});

/* ── turning an order down ─────────────────────────────────────────────── */
console.log('\nwhen the shop cannot serve it');

await check('a seller can turn an order down, and the stock comes back', async () => {
  const listed = await createListing(req({
    headers: auth, body: { title: 'Only one of these', priceMinor: 9_000, quantityAvailable: 1 },
  }), ctx);
  const id = listed.jsonBody.listing.id;

  const buyer = await signup(req({
    body: { displayName: 'Turned Down', email: 'td@figmark.example', phone: '+919000077772', password: 'longenough1' },
  }), ctx);
  const theirs = { authorization: `Bearer ${buyer.jsonBody.token}` };
  const placed = await createOrder(req({ headers: theirs, body: { listingId: id } }), ctx);
  assert.equal(placed.status, 201);

  // Sold out while it was held.
  const soldOut = (await listingDetail(req({ params: { id } }), ctx)).jsonBody.listing;
  assert.equal(soldOut.quantityAvailable, 0);

  // A reason is required: the buyer is owed one.
  const bare = await rejectOrder(req({
    headers: auth, params: { id: placed.jsonBody.order.id }, body: { reason: '' },
  }), ctx);
  assert.equal(bare.status, 400);

  const turned = await rejectOrder(req({
    headers: auth, params: { id: placed.jsonBody.order.id },
    body: { reason: 'Sold the last one this morning — sorry.' },
  }), ctx);
  assert.equal(turned.status, 200);
  assert.equal(turned.jsonBody.order.status, 'cancelled');

  // The unit goes back, and so does the listing.
  const back = (await listingDetail(req({ params: { id } }), ctx)).jsonBody.listing;
  assert.equal(back.quantityAvailable, 1);
  assert.equal(back.status, 'active');

  // And they are told, in the seller's own words.
  const told = (await noticesFor(buyer.jsonBody.user.id)).filter((row) => row.kind === 'order_rejected');
  assert.equal(told.length, 1);
  assert.match(told[0].body, /Sold the last one/);
});

await check('a rejected pre-order gives its place back too', async () => {
  const id = await openCampaign(10);
  const buyer = await newBuyer('Rejected Booker');
  const placed = await createOrder(req({ headers: buyer.headers, body: { listingId: id, quantity: 2 } }), ctx);

  const filled = (await readPreOrder(req({ params: { id } }), ctx)).jsonBody.preOrder;
  assert.equal(filled.filledCount, 2);

  await rejectOrder(req({
    headers: auth, params: { id: placed.jsonBody.order.id },
    body: { reason: 'The supplier pulled this line.' },
  }), ctx);

  const after = (await readPreOrder(req({ params: { id } }), ctx)).jsonBody.preOrder;
  assert.equal(after.filledCount, 0, 'a cancelled order must not hold a place nobody can take');
});

await check('the buyer cannot turn down their own order, and neither side can once money is held', async () => {
  const listed = await createListing(req({
    headers: auth, body: { title: 'Held money', priceMinor: 12_000, quantityAvailable: 2 },
  }), ctx);
  const buyer = await newBuyer('Escrowed Buyer');
  const placed = await createOrder(req({
    headers: buyer.headers, body: { listingId: listed.jsonBody.listing.id },
  }), ctx);
  const orderId = placed.jsonBody.order.id;

  // The buyer is a party to it, but rejecting is the seller's word.
  const wrongSide = await rejectOrder(req({
    headers: buyer.headers, params: { id: orderId }, body: { reason: 'Changed my mind.' },
  }), ctx);
  assert.equal(wrongSide.status, 409);

  // Once an escrow holds it, this is a refund or a dispute - different rules.
  await payOrder(req({
    headers: buyer.headers, params: { id: orderId },
    body: { protection: true, escrowAgentId: 'usr_escrow_meera' },
  }), ctx);
  const tooLate = await rejectOrder(req({
    headers: auth, params: { id: orderId }, body: { reason: 'Cannot serve it after all.' },
  }), ctx);
  assert.equal(tooLate.status, 409);
});

await check('every order a shop has to answer is on one screen', async () => {
  const board = (await sales(req({ headers: auth }), ctx)).jsonBody;
  // Three piles, and they need three different things: money confirmed,
  // servability confirmed, and a record of what was already said.
  for (const pile of ['waiting', 'placed', 'answered']) {
    assert.ok(Array.isArray(board[pile]), `${pile} should be a list`);
  }
  assert.ok(board.answered.some((row) => row.status === 'cancelled'), 'a turned-down order is on the record');
  assert.ok(board.placed.every((row) => row.paymentStatus === 'unpaid'));
});

/* ── what the consignments have been doing ─────────────────────────────── */
console.log('\nwhat the consignments have been doing');

/**
 * The analytics maths, checked away from HTTP.
 *
 * Every figure on the Pro panel is one of these functions over rows the
 * packing board already holds, so the arithmetic is worth pinning down on its
 * own: a wrong average is not a wrong pixel, and nobody spots it by looking.
 */
const day = (n) => new Date(Date.UTC(2026, 0, n)).toISOString();
const order = (buyerId, itemName, condition, checkpoints = {}, status = 'in_fulfilment') => ({
  id: `ord_${buyerId}_${itemName}`, buyerId, itemName, condition, status, checkpoints,
  createdAt: day(1), quantity: 1, unitPriceMinor: 100_00,
});

await check('the box is guessed from what is going in it', () => {
  // The keyword lists are AxisTwelve's, from somebody actually packing this
  // stuff: a Nendoroid goes in a small box and a 1/6 scale does not.
  assert.equal(boxClassFor({ itemName: 'Nendoroid Guts', condition: 'MISB' }), 'small');
  assert.equal(boxClassFor({ itemName: 'Hot Toys Batman 1/6', condition: 'MISB' }), 'large');
  // Out of the box it is smaller, whatever it is.
  assert.equal(boxClassFor({ itemName: 'Hot Toys Batman 1/6', condition: 'LOOSE' }), 'medium');
  assert.equal(boxClassFor({ itemName: 'Some unremarkable figure', condition: 'MISB' }), 'medium');
  // A name we have never seen is not a reason to guess large.
  assert.equal(boxClassFor({ itemName: '', condition: 'LOOSE' }), 'small');

  // A parcel goes to a person, so several items become one - bigger - box.
  const small = { itemName: 'Funko Pop! Goku', condition: 'MISB' };
  assert.equal(aggregateBox([small, small]), 'small');
  assert.equal(aggregateBox([small, small, small, small]), 'medium');
  assert.equal(aggregateBox([small, { itemName: 'Sideshow statue', condition: 'MISB' }]), 'large');
});

await check('a customer whose parcel is packed is no longer a box to pack', () => {
  const lots = [{ id: 'l1', name: 'One' }];
  const rows = [
    order('b1', 'Nendoroid A', 'MISB'),
    order('b1', 'Nendoroid B', 'MISB'),
    order('b2', 'Hot Toys Batman', 'MISB'),
  ];

  const before = packingEstimate(lots, new Map([['l1', rows]]));
  assert.deepEqual([before.small, before.medium, before.large], [1, 0, 1], 'one parcel each');
  assert.equal(before.byLot[0].total, 2);
  assert.equal(before.openLots, 1);

  // The number is work remaining, not work done: packing one takes it off.
  const packed = rows.map((row) =>
    row.buyerId === 'b1' ? { ...row, checkpoints: { packed: day(4) } } : row);
  const after = packingEstimate(lots, new Map([['l1', packed]]));
  assert.deepEqual([after.small, after.medium, after.large], [0, 0, 1]);

  // A cancelled order is not a box either.
  const dropped = rows.map((row) =>
    row.buyerId === 'b2' ? { ...row, status: 'cancelled' } : row);
  assert.equal(packingEstimate(lots, new Map([['l1', dropped]])).large, 0);

  // And a lot entirely dispatched is not on the list at all.
  const gone = rows.map((row) => ({ ...row, checkpoints: { packed: day(4), dispatched: day(5) } }));
  assert.deepEqual(packingEstimate(lots, new Map([['l1', gone]])).byLot, []);
});

await check('a stage only counts when it actually went forwards', () => {
  const rows = [order('b1', 'Statue', 'MISB', {
    china_received: day(2), china_packed: day(3), india_received: day(9),
    ready_to_dispatch: day(11), dispatched: day(12),
  })];

  const timings = timingsOf(rows, day(1));
  // Measured from when the consignment opened, because that is when the shop
  // started waiting - not from when this one order was placed.
  assert.equal(timings.toChinaPacked, 2);
  assert.equal(timings.chinaToIndia, 6);
  assert.equal(timings.indiaToReady, 2);
  assert.equal(timings.readyToDispatch, 1);
  assert.equal(doorToDoor(timings), 11);

  // Checkpoints are not forced to be ticked in order. Somebody catching up out
  // of sequence must not drag an average below zero.
  const muddled = [{ ...rows[0], checkpoints: { ...rows[0].checkpoints, india_received: day(2) } }];
  const off = timingsOf(muddled, day(1));
  assert.equal(off.chinaToIndia, null, 'a negative leg is no measurement at all');
  assert.equal(off.indiaToReady, 9);
  assert.equal(doorToDoor(off), null, 'and door to door cannot be summed without it');
});

await check('progress is weighted across the journey, not just the last tick', () => {
  assert.equal(checkpointProgress(order('b1', 'x', 'MISB', {})), 0);
  assert.equal(checkpointProgress(order('b1', 'x', 'MISB', { china_received: day(2) })), 0.15);
  // Cleared customs reads as half done rather than sitting at zero until the
  // final parcel goes out.
  assert.equal(checkpointProgress(order('b1', 'x', 'MISB', { india_received: day(9) })), 0.5);
  assert.equal(
    checkpointProgress(order('b1', 'x', 'MISB', { china_received: day(2), dispatched: day(12) })),
    1,
  );
});

await check('the status line and the counts under it cannot disagree', () => {
  const rows = [
    order('b1', 'A', 'MISB', { china_received: day(2), china_packed: day(3) }),
    order('b2', 'B', 'MISB', { china_received: day(2) }),
  ];

  // The card derives its line from the tally it charts; the analytics derive
  // theirs from the orders. Both go through the same function, so a card can
  // never say one thing while its own bars say another.
  assert.equal(phaseOf(rows), 'prepping');
  assert.equal(phaseOfCounts(tallyOf(rows).counts), phaseOf(rows));

  assert.equal(phaseOf([]), 'empty');
  assert.equal(phaseOfCounts(tallyOf([]).counts), 'empty');

  // "Prepping" is most of it at the China warehouse rather than all of it: a
  // lot waiting on one straggler is being prepared, not still filling.
  const most = [
    order('b1', 'A', 'MISB', { china_received: day(2) }),
    order('b2', 'B', 'MISB', { china_received: day(2) }),
    order('b3', 'C', 'MISB', {}),
  ];
  assert.equal(phaseOf(most), 'prepping');
  assert.equal(phaseOfCounts(tallyOf(most).counts), 'prepping');
  const few = [most[0], { ...most[1], checkpoints: {} }, most[2]];
  assert.equal(phaseOf(few), 'filling');
  assert.equal(phaseOfCounts(tallyOf(few).counts), 'filling');
  // One parcel in India moves the whole lot's story on, because that is the
  // question being asked: has any of it landed.
  const landed = [rows[0], { ...rows[1], checkpoints: { india_received: day(9) } }];
  assert.equal(phaseOf(landed), 'india');
  assert.equal(phaseOfCounts(tallyOf(landed).counts), 'india');

  const done = rows.map((row) => ({ ...row, checkpoints: { dispatched: day(12) } }));
  assert.equal(phaseOf(done), 'completed');
  // A cancelled order must not hold a finished lot open forever.
  assert.equal(phaseOf([...done, order('b3', 'C', 'MISB', {}, 'cancelled')]), 'completed');
});

await check('a shop reads its own figures and nobody else reads them', async () => {
  const mine = await insights(req({ headers: auth }), ctx);
  assert.equal(mine.status, 200, JSON.stringify(mine.jsonBody));
  for (const key of ['headline', 'boxes', 'timings', 'perLot', 'pending', 'cohorts', 'top']) {
    assert.ok(key in mine.jsonBody, `expected ${key} in the response`);
  }

  const stranger = await signup(req({
    body: {
      displayName: 'Nosy Analyst', email: 'nosy-analyst@figmark.example',
      phone: '+919000078801', password: 'longenough1',
    },
  }), ctx);
  assert.equal(stranger.status, 201, JSON.stringify(stranger.jsonBody));
  const theirs = { authorization: `Bearer ${stranger.jsonBody.token}` };

  // Their own figures are theirs to read, and they are empty.
  const own = await insights(req({ headers: theirs }), ctx);
  assert.equal(own.status, 200);
  assert.equal(own.jsonBody.perLot.length, 0);
  assert.equal(own.jsonBody.headline.ordersInFlight, 0);

  // Somebody else's are not, and this is the money screen.
  const nosy = await insights(req({ headers: theirs, query: { store: 'usr_demo' } }), ctx);
  assert.equal(nosy.status, 403);
});

await check('every lot is counted exactly as its own board lists it', async () => {
  const body = (await insights(req({ headers: auth }), ctx)).jsonBody;
  const entry = body.perLot.find((row) => row.lotId === 'lot_open_24');
  assert.ok(entry, 'the open lot should be on the screen');

  const rows = (await (await getRepository()).listOrdersForLot('lot_open_24'))
    .filter((row) => row.status !== 'cancelled');
  assert.equal(entry.orders, rows.length);
  assert.equal(entry.customers, new Set(rows.map((row) => row.buyerId)).size);
  assert.equal(entry.valueMinor, rows.reduce((sum, row) => sum + row.quantity * row.unitPriceMinor, 0));
  // The phase on the analytics screen and the phase on the lot card are the
  // same sentence about the same rows.
  assert.equal(entry.phase, phaseOfCounts(tallyOf(rows).counts));
  assert.ok(entry.progress >= 0 && entry.progress <= 100);
});

await check('the money it says is waiting is money that actually landed', async () => {
  const listed = await createListing(req({
    headers: auth,
    body: { title: 'Landed and unpaid', priceMinor: 45_000, quantityAvailable: 3, lotId: lot.jsonBody.lot.id },
  }), ctx);
  assert.equal(listed.status, 201, JSON.stringify(listed.jsonBody));

  const buyer = await newBuyer('Owes For It');
  const placed = await createOrder(req({
    headers: buyer.headers, body: { listingId: listed.jsonBody.listing.id, quantity: 2 },
  }), ctx);
  assert.equal(placed.status, 201, JSON.stringify(placed.jsonBody));
  assert.equal(placed.jsonBody.order.paymentStatus, 'unpaid');

  // Unpaid on its own is not a chase: half these people have not been asked for
  // money yet. It becomes one when the thing is here.
  const before = (await insights(req({ headers: auth }), ctx)).jsonBody;
  assert.equal(before.pending.some((row) => row.buyerId === buyer.id), false);

  const landed = await setCheckpoint(req({
    headers: auth, params: { id: placed.jsonBody.order.id },
    body: { checkpoint: 'india_received', on: true },
  }), ctx);
  assert.equal(landed.status, 200, JSON.stringify(landed.jsonBody));

  const after = (await insights(req({ headers: auth }), ctx)).jsonBody;
  const chase = after.pending.find((row) => row.buyerId === buyer.id);
  assert.ok(chase, 'somebody whose parcel is here and who has not paid is a chase');
  assert.equal(chase.totalMinor, 90_000, 'two of them, at the price they were sold for');
  assert.equal(chase.orders, 1);
  assert.equal(chase.who.name, 'Owes For It');
  assert.ok(after.headline.unpaidMinor >= 90_000);
});

/* ── the trades around the trade ───────────────────────────────────────── */
console.log('\nthe trades around the trade');

await check('the hub counts what there is to count, and says so where there is not', async () => {
  const body = (await servicesHub(req(), ctx)).jsonBody;
  const byKind = Object.fromEntries(body.categories.map((row) => [row.kind, row]));

  // Every job, in the order the goods move.
  assert.deepEqual(body.categories.map((row) => row.kind), ['supplier', 'forwarder', 'handler', 'escrow']);
  assert.ok(byKind.forwarder.count >= 3, 'the seeded forwarders should be counted');
  assert.ok(byKind.handler.count >= 2);
  assert.ok(byKind.escrow.count >= 1);
  // "0 suppliers" would be a lie about a category that has no roster at all.
  assert.equal(byKind.supplier.count, null);
  assert.equal(byKind.supplier.browsable, false);
});

await check('a private trade has no list, however politely you ask', async () => {
  const refused = await serviceDirectory(req({ params: { kind: 'supplier' } }), ctx);
  assert.equal(refused.status, 403);
  assert.equal(refused.jsonBody.error, 'not_browsable');

  const nonsense = await serviceDirectory(req({ params: { kind: 'plumber' } }), ctx);
  assert.equal(nonsense.status, 404);
});

await check('an unlisted handler is a working handler, not a listed one', async () => {
  const body = (await serviceDirectory(req({ params: { kind: 'handler' } }), ctx)).jsonBody;
  const ids = body.providers.map((row) => row.userId);
  assert.ok(ids.includes('usr_hnd_bombay'), 'the listed ones are on offer');
  assert.equal(ids.includes('usr_hnd_quiet'), false, 'the private one is not');

  // And nothing in the response leaks the one who opted out.
  assert.equal(JSON.stringify(body).includes('usr_hnd_quiet'), false);
  assert.equal(JSON.stringify(body).includes('+919000000203'), false);

  // The directory is browsable signed out: choosing a service is something you
  // do before committing to anything.
  const filtered = (await serviceDirectory(req({ params: { kind: 'handler' }, query: { q: 'bengaluru' } }), ctx)).jsonBody;
  assert.deepEqual(filtered.providers.map((row) => row.userId), ['usr_hnd_southline']);
});

await check('offering a service puts you on the list, and withdrawing takes you off', async () => {
  const made = await signup(req({
    body: {
      displayName: 'Kochi Parcel Co', email: 'kochi@figmark.example',
      phone: '+919000078811', password: 'longenough1',
    },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const theirs = { authorization: `Bearer ${made.jsonBody.token}` };

  const offered = await offerService(req({
    headers: theirs,
    body: {
      kind: 'handler', companyName: 'Kochi Parcel Co', places: ['Kochi', 'Thrissur'],
      description: 'Same-day breakdown at COK.', contactPhone: '+919000078811',
    },
  }), ctx);
  assert.equal(offered.status, 200, JSON.stringify(offered.jsonBody));
  assert.deepEqual(offered.jsonBody.profile.cities, ['Kochi', 'Thrissur']);

  const listed = (await serviceDirectory(req({ params: { kind: 'handler' } }), ctx)).jsonBody;
  assert.ok(listed.providers.some((row) => row.name === 'Kochi Parcel Co'));

  // And it is now one of their own.
  const hub = (await servicesHub(req({ headers: theirs }), ctx)).jsonBody;
  assert.deepEqual(hub.mine, ['handler']);

  // Withdrawing is a flag, not a delete: the lots they have already carried
  // still have to resolve to a name.
  const withdrawn = await offerService(req({ headers: theirs, body: { kind: 'handler', listed: false } }), ctx);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.jsonBody.profile.companyName, 'Kochi Parcel Co', 'the entry survives');
  const after = (await serviceDirectory(req({ params: { kind: 'handler' } }), ctx)).jsonBody;
  assert.equal(after.providers.some((row) => row.name === 'Kochi Parcel Co'), false);
  // Still theirs, still on their own screen - just not on offer.
  assert.deepEqual((await servicesHub(req({ headers: theirs }), ctx)).jsonBody.mine, ['handler']);
});

await check('the two you cannot sign up for, you cannot sign up for', async () => {
  for (const kind of ['escrow', 'supplier', 'plumber']) {
    const refused = await offerService(req({ headers: auth, body: { kind } }), ctx);
    assert.equal(refused.status, 400, `${kind} should not be self-service`);
    assert.equal(refused.jsonBody.error, 'invalid_service');
  }

  // Holding other people's money is granted, and the grant is an operator's.
  const demo = await repository_user('usr_demo');
  assert.ok(demo.escrowRights, 'the demo account was granted it by the fixture');
});

await check('a shop names a handler, and the lot turns up on their screen', async () => {
  const handlerAuth = { authorization: `Bearer ${(await login(req({
    body: { identifier: HANDLER_EMAIL, password: DEMO_PASSWORD },
  }), ctx)).jsonBody.token}` };

  const mine = (await distribution(req({ headers: handlerAuth }), ctx)).jsonBody;
  const open = mine.lots.find((row) => row.lot.id === 'lot_open_24');
  assert.ok(open, 'the fixture names them on the open lot');
  assert.equal(open.store.ownerId, 'usr_demo');
  assert.equal(open.city, 'Mumbai');

  // Parcels, not pieces: three items for one buyer is one job.
  const board = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.equal(open.parcels, board.customers.length);
  assert.ok(open.parcels < board.customers.reduce((sum, c) => sum + c.orders.length, 0));
});

await check('the parcel list is people and never prices', async () => {
  const handlerAuth = { authorization: `Bearer ${(await login(req({
    body: { identifier: HANDLER_EMAIL, password: DEMO_PASSWORD },
  }), ctx)).jsonBody.token}` };

  const body = (await distributionDetail(req({
    headers: handlerAuth, params: { id: 'lot_open_24' },
  }), ctx)).jsonBody;

  // The supplier's list is pieces and never customers, because they pack a
  // crate. This is the mirror: the whole job is which box goes to which person.
  assert.ok(body.parcels.length > 0);
  assert.ok(body.parcels.every((parcel) => parcel.name && parcel.name !== 'Unknown'));
  assert.equal(JSON.stringify(body).includes('priceMinor'), false, 'what it sold for is not theirs');
  assert.equal(JSON.stringify(body).includes('unitPriceMinor'), false);
  for (const item of body.parcels[0].items) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ['checkpoints', 'condition', 'id', 'itemName', 'quantity', 'unitWeightGrams'],
    );
  }
});

await check('a handler works the India end, and no earlier', async () => {
  const handlerAuth = { authorization: `Bearer ${(await login(req({
    body: { identifier: HANDLER_EMAIL, password: DEMO_PASSWORD },
  }), ctx)).jsonBody.token}` };
  const body = (await distributionDetail(req({
    headers: handlerAuth, params: { id: 'lot_open_24' },
  }), ctx)).jsonBody;
  const order = body.parcels[0].items[0];

  // Theirs: everything from the moment it lands.
  for (const checkpoint of ['india_received', 'ready_to_dispatch', 'packed', 'dispatched']) {
    const ticked = await setCheckpoint(req({
      headers: handlerAuth, params: { id: order.id }, body: { checkpoint, on: true },
    }), ctx);
    assert.equal(ticked.status, 200, `${checkpoint} is the handler's own work`);
  }

  // Not theirs: the packing floor in Guangzhou.
  for (const checkpoint of ['china_received', 'china_packed']) {
    const refused = await setCheckpoint(req({
      headers: handlerAuth, params: { id: order.id }, body: { checkpoint, on: true },
    }), ctx);
    assert.equal(refused.status, 403, `${checkpoint} happens before they have it`);
  }

  // And the shop sees the work on its own board: one number, two screens.
  const owners = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.ok(owners.tally.counts.find((row) => row.checkpoint === 'dispatched').done >= 1);
});

await check('somebody else’s lot is not on your screen and not yours to tick', async () => {
  const stranger = await signup(req({
    body: {
      displayName: 'Unnamed Handler', email: 'unnamed@figmark.example',
      phone: '+919000078812', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${stranger.jsonBody.token}` };

  assert.deepEqual((await distribution(req({ headers: theirs }), ctx)).jsonBody.lots, []);
  const refused = await distributionDetail(req({ headers: theirs, params: { id: 'lot_open_24' } }), ctx);
  assert.equal(refused.status, 403);

  const board = (await lotBoard(req({ headers: auth, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  const tick = await setCheckpoint(req({
    headers: theirs, params: { id: board.customers[0].orders[0].id },
    body: { checkpoint: 'dispatched', on: true },
  }), ctx);
  assert.equal(tick.status, 403);
});

await check('naming a supplier on one lot hands over that lot and no other', async () => {
  const checker = await signup(req({
    body: {
      displayName: 'One Run Checker', email: 'checker@figmark.example',
      phone: '+919000078813', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${checker.jsonBody.token}` };
  const handle = checker.jsonBody.user.username;
  assert.ok(handle, 'signup claims a handle');

  // Nothing yet.
  assert.deepEqual((await supplierLots(req({ headers: theirs }), ctx)).jsonBody.lots, []);

  /* Named where the supplier is named, which is with the supplier's own
     details: they were two roles until it became clear they never were. */
  const named = await updateLotDetails(req({
    headers: auth, params: { id: 'lot_open_24' },
    body: { supplierName: 'One Run Checker', supplierHandle: `@${handle}` },
  }), ctx);
  assert.equal(named.status, 200, JSON.stringify(named.jsonBody));
  assert.equal(named.jsonBody.lot.supplier.supplierUserId, checker.jsonBody.user.id);

  const theirLots = (await supplierLots(req({ headers: theirs }), ctx)).jsonBody.lots;
  assert.deepEqual(theirLots.map((row) => row.lot.id), ['lot_open_24'], 'that lot, and only it');

  // The packing list, which is pieces and nothing about the buyers.
  const list = (await supplierLot(req({ headers: theirs, params: { id: 'lot_open_24' } }), ctx)).jsonBody;
  assert.ok(list.items.length > 0);
  assert.equal(JSON.stringify(list).includes('buyerId'), false);

  // Still only the one checkpoint: being named is not being made staff.
  const refused = await setCheckpoint(req({
    headers: theirs, params: { id: list.items[0].id }, body: { checkpoint: 'dispatched', on: true },
  }), ctx);
  assert.equal(refused.status, 403);

  // A handle nobody answers to is refused rather than stored.
  const nobody = await updateLotDetails(req({
    headers: auth, params: { id: 'lot_open_24' },
    body: { supplierName: 'Nobody', supplierHandle: '@nobody_at_all' },
  }), ctx);
  assert.equal(nobody.status, 404);
});

await check('a forwarder finally has a screen of their own', async () => {
  // The directory has existed since the first week and led nowhere: a forwarder
  // could be listed, chosen and consigned to, and had no way to see any of it.
  const made = await signup(req({
    body: {
      displayName: 'Harbour Air Cargo', email: 'harbour@figmark.example',
      phone: '+919000078815', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${made.jsonBody.token}` };
  await offerService(req({
    headers: theirs,
    body: { kind: 'forwarder', companyName: 'Harbour Air Cargo', places: ['Guangzhou → Mumbai'] },
  }), ctx);

  assert.deepEqual((await consignments(req({ headers: theirs }), ctx)).jsonBody.consignments, []);

  const chosen = await setTracking(req({
    headers: auth, params: { id: 'lot_ship_23' },
    body: {
      forwarderUserId: made.jsonBody.user.id, forwarderName: 'Harbour Air Cargo',
      trackingReference: 'HAC-9931',
    },
  }), ctx);
  assert.equal(chosen.status, 200);

  const rows = (await consignments(req({ headers: theirs }), ctx)).jsonBody.consignments;
  assert.deepEqual(rows.map((row) => row.lot.id), ['lot_ship_23']);
  assert.equal(rows[0].lot.trackingReference, 'HAC-9931');
  // What they quote and load on, and nothing about what it sold for.
  assert.equal(typeof rows[0].weightGrams, 'number');
  assert.equal(JSON.stringify(rows).includes('priceMinor'), false);
});

await check('only the shop that owns a lot may name who works it', async () => {
  const stranger = await signup(req({
    body: {
      displayName: 'Not Their Shop', email: 'notshop@figmark.example',
      phone: '+919000078814', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${stranger.jsonBody.token}` };
  const refused = await setCrew(req({
    headers: theirs, params: { id: 'lot_open_24' }, body: { handlerUserId: 'usr_hnd_bombay' },
  }), ctx);
  assert.equal(refused.status, 403);
});

/* ── a lot that travels a route ──────────────────────────────────────── */
console.log('\na lot that travels a route');

let routeFixture;
let routedLot;
let earlyOrder;
let earlyBuyer;

/** An import listed with no lot behind it yet, which is the normal case. */
const waitingItem = async (title) => {
  const made = await createListing(req({
    headers: auth,
    body: { title, priceMinor: 30_000, quantityAvailable: 5, sourcing: 'import', category: 'Scale figures' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return made.jsonBody.listing.id;
};

await check('a route is a ladder you write once and reuse', async () => {
  const before = (await listRoutes(req({ headers: auth }), ctx)).jsonBody;
  // The ladder this app has always had is offered by name rather than assumed,
  // and the builder opens with something to edit rather than an empty list.
  assert.equal(before.builtIn.steps.length, 7);
  assert.ok(before.suggested.length >= 8);
  // Joining a lot is not one of them: it can happen before the item is listed,
  // when it sells, or halfway down, so it is an event and never a rung.
  assert.ok(!before.suggested.some((step) => /added to (a )?lot/i.test(step.name)));

  const made = await saveRoute(req({
    headers: auth,
    body: {
      name: 'Guangzhou air',
      steps: [
        { name: 'Order placed' },
        { name: 'At the China warehouse', description: 'Counted and photographed' },
        { name: 'Flown' },
        { name: 'Customs' },
        { name: 'Delivered' },
      ],
    },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const route = made.jsonBody.route;
  assert.equal(route.steps.length, 5);
  assert.deepEqual(route.steps.map((step) => step.position), [0, 1, 2, 3, 4]);
  assert.equal(route.steps[1].description, 'Counted and photographed');

  // One step is a status, not a journey.
  const thin = await saveRoute(req({ headers: auth, body: { name: 'Nope', steps: [{ name: 'Sent' }] } }), ctx);
  assert.equal(thin.status, 400);
  // And a blank step is dropped rather than stored, so the count is what shows.
  const padded = await saveRoute(req({
    headers: auth, body: { name: 'Padded', steps: [{ name: 'One' }, { name: '  ' }, { name: 'Two' }] },
  }), ctx);
  assert.equal(padded.jsonBody.route.steps.length, 2);

  const after = (await listRoutes(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(after.routes.some((row) => row.id === route.id));

  // Correcting one keeps its identity, so the lots that named it still can.
  const fixed = await saveRoute(req({
    headers: auth,
    body: { id: route.id, name: 'Guangzhou air express', steps: route.steps },
  }), ctx);
  assert.equal(fixed.status, 200);
  assert.equal(fixed.jsonBody.route.id, route.id);

  routeFixture = fixed.jsonBody.route;
});

await check('a lot carries a copy of its route, not a pointer to one', async () => {
  const made = await createLot(req({
    headers: auth,
    body: { name: 'Route lot', origin: 'Guangzhou, CN', routeId: routeFixture.id },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const lot = made.jsonBody.lot;
  assert.equal(lot.route.name, 'Guangzhou air express');
  assert.equal(lot.route.steps.length, 5);
  // Not step zero: that is an item step on this route, and a crate nobody has
  // touched has taken none of its own. It opens one short of its first.
  assert.equal(lot.currentStep, 1);
  assert.equal(lot.stage, 'ordering', 'and reads as what it is: filling');
  // A number a person can say out loud, derived rather than invented.
  assert.match(lot.lotNumber, /^\d\d-[A-Z0-9]{4}$/);

  // Renaming the template must not rewrite a timeline a buyer has been reading
  // for three weeks.
  await saveRoute(req({
    headers: auth,
    body: {
      id: routeFixture.id, name: 'Renamed entirely',
      steps: [{ name: 'Something' }, { name: 'Else' }],
    },
  }), ctx);
  const still = (await lotContents(req({ headers: auth, params: { id: lot.id } }), ctx)).jsonBody;
  assert.equal(still.route.name, 'Guangzhou air express');
  assert.equal(still.route.steps.length, 5);

  // A lot created against a route that does not exist is not created at all.
  const nonsense = await createLot(req({
    headers: auth, body: { name: 'Ghost route', routeId: 'rt_nope' },
  }), ctx);
  assert.equal(nonsense.status, 404);

  routedLot = lot;
});

await check('a lot with no route of its own travels the one that has always been here', async () => {
  const made = await createLot(req({ headers: auth, body: { name: 'Plain lot' } }), ctx);
  assert.equal(made.status, 201);
  const body = (await lotContents(req({ headers: auth, params: { id: made.jsonBody.lot.id } }), ctx)).jsonBody;
  assert.equal(body.route.steps.length, 7, 'the seven stages, spelled out');
  assert.equal(body.route.steps[0].name, 'Ordering');
  assert.equal(body.lot.stage, 'ordering', 'and the coarse stage still agrees with it');
});

await check('an item sold before its lot waits for one, and says so', async () => {
  const listing = await waitingItem('Sold before the run');
  const buyer = await newBuyer('Early Buyer');
  const placed = await createOrder(req({ headers: buyer.headers, body: { listingId: listing } }), ctx);
  assert.equal(placed.status, 201, JSON.stringify(placed.jsonBody));

  // Not filed as a domestic sale, which is what used to happen: the buyer was
  // shown a three-step timeline for something crossing an ocean.
  assert.equal(placed.jsonBody.order.lotId, 'awaiting_lot');

  const tracking = (await orderTracking(req({
    headers: buyer.headers, params: { id: placed.jsonBody.order.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.awaitingLot, true);
  assert.equal(tracking.route, null, 'no lot, no route to read');
  // Two steps and then it stops, rather than five hollow circles implying a
  // journey nobody has booked.
  assert.deepEqual(tracking.stages, ['ordering', 'china_wh_received']);

  earlyOrder = placed.jsonBody.order;
  earlyBuyer = buyer;
});

await check('the list of what can go in a lot is only what could', async () => {
  const body = (await lotCandidates(req({
    headers: auth, params: { id: routedLot.id },
  }), ctx)).jsonBody;
  const ids = body.items.map((item) => item.id);
  assert.ok(ids.includes(earlyOrder.id), 'an import with no lot is a candidate');
  assert.ok(body.items.every((item) => item.buyerName && item.buyerName !== 'Unknown'));

  // A domestic sale is never going in a crate.
  const shelf = await createListing(req({
    headers: auth, body: { title: 'Off the shelf', priceMinor: 4_000, sourcing: 'in_hand' },
  }), ctx);
  const buyer = await newBuyer('Domestic Buyer');
  const direct = await createOrder(req({
    headers: buyer.headers, body: { listingId: shelf.jsonBody.listing.id },
  }), ctx);
  assert.equal(direct.jsonBody.order.lotId, 'direct');
  const again = (await lotCandidates(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(again.items.some((item) => item.id === direct.jsonBody.order.id), false);

  // And the search is by item or by customer, because that is how a seller
  // looks for one.
  const found = (await lotCandidates(req({
    headers: auth, params: { id: routedLot.id }, query: { q: 'early buyer' },
  }), ctx)).jsonBody;
  assert.deepEqual(found.items.map((item) => item.id), [earlyOrder.id]);
});

await check('filling a lot moves the item into it, and tells the buyer', async () => {
  const second = await waitingItem('Second in the run');
  const other = await newBuyer('Second Buyer');
  const alsoPlaced = await createOrder(req({ headers: other.headers, body: { listingId: second } }), ctx);

  const added = await addItems(req({
    headers: auth, params: { id: routedLot.id },
    body: { orderIds: [earlyOrder.id, alsoPlaced.jsonBody.order.id] },
  }), ctx);
  assert.equal(added.status, 200, JSON.stringify(added.jsonBody));
  assert.equal(added.jsonBody.added, 2);

  const body = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(body.items.length, 2);
  assert.ok(body.items.every((item) => item.buyerName !== 'Unknown'), 'with who bought each');

  // The buyer's own timeline is now the lot's, in the seller's words.
  const tracking = (await orderTracking(req({
    headers: earlyBuyer.headers, params: { id: earlyOrder.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.awaitingLot, false);
  assert.equal(tracking.route.name, 'Guangzhou air express');
  assert.equal(tracking.route.steps.length, 5);
  // Joining is an event carrying the lot it names, not a sentence to grep and
  // not a rung: the timeline draws it where it happened.
  const join = tracking.order.stageHistory.find((event) => event.kind === 'joined');
  assert.ok(join, 'their history says where it went rather than silently growing five steps');
  assert.equal(join.lot.name, 'Route lot');
  assert.ok(join.lot.number, 'and names it the way a person would say it');

  // Adding the same item twice does nothing: it is already in a lot.
  const again = await addItems(req({
    headers: auth, params: { id: routedLot.id }, body: { orderIds: [earlyOrder.id] },
  }), ctx);
  assert.equal(again.jsonBody.added, 0);
});

await check('one click moves the lot, and every item in it', async () => {
  const before = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  // Filling: one short of its own first step, having taken none of them.
  assert.equal(before.route.offset, 2);
  assert.equal(before.route.currentStep, before.route.offset - 1);

  const moved = await stepLot(req({
    headers: auth, params: { id: routedLot.id }, body: { note: 'On the Thursday flight.' },
  }), ctx);
  assert.equal(moved.status, 200, JSON.stringify(moved.jsonBody));
  assert.equal(moved.jsonBody.ordersUpdated, 2, 'thirty-four items would be one click too');

  const after = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(after.route.currentStep, 2);
  assert.equal(
    after.route.steps[after.route.currentStep].name, 'Flown',
    'the first step of the lot\'s own half, not the warehouse arrival its items make',
  );

  // Every buyer, without the seller touching a single item.
  const tracking = (await orderTracking(req({
    headers: earlyBuyer.headers, params: { id: earlyOrder.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.route.currentStep, 2);
  const last = tracking.order.stageHistory[tracking.order.stageHistory.length - 1];
  assert.equal(last.step, 'Flown', 'in the words the seller wrote');
  assert.equal(last.note, 'On the Thursday flight.');

  // And they were told, which is the notification the product is really for.
  const told = await noticesFor(earlyBuyer.id);
  assert.ok(told.some((row) => row.kind === 'lot_moved' && row.title.includes('Flown')));
});

await check('a seller can say something without moving the lot', async () => {
  // What actually happens between two steps: a crate sits at the forwarder for
  // nine days and the honest thing to tell twenty buyers is not a step.
  const said = await noteOnLot(req({
    headers: auth, params: { id: routedLot.id },
    body: { note: 'Still waiting on the airline — booked for Thursday.' },
  }), ctx);
  assert.equal(said.status, 200, JSON.stringify(said.jsonBody));
  assert.equal(said.jsonBody.ordersUpdated, 2, 'every buyer in the lot, not just the lot');

  const after = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(after.route.currentStep, 2, 'and the lot has not moved');
  const last = after.history[after.history.length - 1];
  assert.equal(last.note, 'Still waiting on the airline — booked for Thursday.');
  assert.equal(last.step, 'Flown', 'filed at the step it was written at');

  // The buyer reads it on their own timeline, at the same rung.
  const tracking = (await orderTracking(req({
    headers: earlyBuyer.headers, params: { id: earlyOrder.id },
  }), ctx)).jsonBody;
  const theirs = tracking.order.stageHistory[tracking.order.stageHistory.length - 1];
  assert.equal(theirs.note, 'Still waiting on the airline — booked for Thursday.');
  assert.equal(tracking.route.currentStep, 2, 'a note is not a move');

  // Written against a step the lot has not reached yet: a seller saying what
  // is coming files it on the rung it is about, not on the one they are on.
  const ahead = await noteOnLot(req({
    headers: auth, params: { id: routedLot.id },
    body: { note: 'Booked on Thursday’s flight.', at: 2 },
  }), ctx);
  assert.equal(ahead.status, 200);
  const filed = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  const written = filed.history[filed.history.length - 1];
  assert.equal(written.step, filed.route.steps[2].name);
  assert.equal(filed.route.currentStep, 2, 'and writing ahead is still not moving');

  // A step off the end of the route is clamped rather than refused: the note
  // is the point, and there is always a rung it belongs nearest to.
  const far = await noteOnLot(req({
    headers: auth, params: { id: routedLot.id }, body: { note: 'Last word.', at: 99 },
  }), ctx);
  assert.equal(far.status, 200);
  const clamped = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(
    clamped.history[clamped.history.length - 1].step,
    clamped.route.steps[clamped.route.steps.length - 1].name,
  );

  // An empty note is not a note.
  const blank = await noteOnLot(req({
    headers: auth, params: { id: routedLot.id }, body: { note: '   ' },
  }), ctx);
  assert.equal(blank.status, 400);
});

await check('one item can travel differently from the rest of its lot', async () => {
  // Thirty-three pieces cleared and one was pulled for inspection. The lot has
  // not moved, and neither has the truth for thirty-three people.
  const held = await stepItem(req({
    headers: auth, params: { id: earlyOrder.id },
    body: { to: 3, note: 'Pulled for inspection at customs.' },
  }), ctx);
  assert.equal(held.status, 200, JSON.stringify(held.jsonBody));

  const board = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(board.route.currentStep, 2, 'the lot itself is where it was');
  const row = board.items.find((item) => item.id === earlyOrder.id);
  assert.equal(row.currentStep, 3);
  assert.equal(row.ownStep, true, 'and the screen says so rather than implying it');
  assert.ok(board.items.some((item) => item.id !== earlyOrder.id && item.ownStep === false));

  // Its buyer reads its position, not the lot's.
  const mine = (await orderTracking(req({
    headers: earlyBuyer.headers, params: { id: earlyOrder.id },
  }), ctx)).jsonBody;
  assert.equal(mine.route.currentStep, 3);
  assert.equal(
    mine.order.stageHistory[mine.order.stageHistory.length - 1].note,
    'Pulled for inspection at customs.',
  );

  // A note on one item alone, with no move.
  const noted = await stepItem(req({
    headers: auth, params: { id: earlyOrder.id }, body: { note: 'Released, back on the next flight.' },
  }), ctx);
  assert.equal(noted.status, 200);
  const stillThere = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(stillThere.items.find((item) => item.id === earlyOrder.id).currentStep, 3);

  // Neither a note nor a step is nothing to record.
  const nothing = await stepItem(req({ headers: auth, params: { id: earlyOrder.id }, body: {} }), ctx);
  assert.equal(nothing.status, 400);

  // Moving the lot brings the stray item back in line, rather than leaving it
  // stuck at a position nobody remembers setting.
  await stepLot(req({ headers: auth, params: { id: routedLot.id }, body: { to: 4 } }), ctx);
  const synced = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(synced.items.find((item) => item.id === earlyOrder.id).currentStep, 4);
  assert.equal(synced.items.find((item) => item.id === earlyOrder.id).ownStep, false);

  await stepLot(req({ headers: auth, params: { id: routedLot.id }, body: { to: 2 } }), ctx);
});

await check('somebody else’s item is not theirs to move or annotate', async () => {
  const stranger = await newBuyer('Not The Shop');
  for (const body of [{ to: 2 }, { note: 'mine now' }]) {
    const refused = await stepItem(req({
      headers: stranger.headers, params: { id: earlyOrder.id }, body,
    }), ctx);
    assert.equal(refused.status, 403);
  }
  const refusedNote = await noteOnLot(req({
    headers: stranger.headers, params: { id: routedLot.id }, body: { note: 'mine now' },
  }), ctx);
  assert.equal(refusedNote.status, 403);
});

await check('a lot walks its own half of the route, and neither end past it', async () => {
  const board = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  const { offset } = board.route;
  assert.ok(offset > 0, 'this route has a pre-lot half');

  /* The floor: one short of the lot's own first step, which is where a lot
     sits while it is filling. The commonest correction on any board is a
     button pressed once too often, so back is allowed - but only to there. */
  const back = await stepLot(req({
    headers: auth, params: { id: routedLot.id }, body: { to: offset - 1 },
  }), ctx);
  assert.equal(back.status, 200);
  assert.equal(
    (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody.route.currentStep,
    offset - 1,
  );

  // Below it is the half that happens to one item at a time, and a crate
  // cannot be "received at the warehouse".
  const tooFar = await stepLot(req({
    headers: auth, params: { id: routedLot.id }, body: { to: 0 } }), ctx);
  assert.equal(tooFar.status, 409, 'a lot cannot be stepped into an item step');

  // Walk it to the end, then try to walk off it.
  const steps = board.route.steps.length - offset;
  for (let i = 0; i < steps; i += 1) {
    const step = await stepLot(req({ headers: auth, params: { id: routedLot.id } }), ctx);
    assert.equal(step.status, 200, `step ${i} should move`);
  }
  const end = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(end.route.currentStep, end.route.steps.length - 1);
  assert.equal(end.lot.status, 'closed', 'the last step closes it');

  const past = await stepLot(req({ headers: auth, params: { id: routedLot.id } }), ctx);
  assert.equal(past.status, 409);

  // The items finished with it.
  const tracking = (await orderTracking(req({
    headers: earlyBuyer.headers, params: { id: earlyOrder.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.order.status, 'delivered');
  assert.ok(tracking.order.completedAt);
});

await check('a lot is only steppable by the shop that owns it', async () => {
  const stranger = await signup(req({
    body: {
      displayName: 'Not This Shop', email: 'notthisshop@figmark.example',
      phone: '+919000078821', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${stranger.jsonBody.token}` };

  for (const call of [
    () => stepLot(req({ headers: theirs, params: { id: routedLot.id } }), ctx),
    () => addItems(req({ headers: theirs, params: { id: routedLot.id }, body: { orderIds: ['x'] } }), ctx),
    () => lotCandidates(req({ headers: theirs, params: { id: routedLot.id } }), ctx),
  ]) {
    const refused = await call();
    assert.equal(refused.status, 403);
  }

  // And somebody else's template is not theirs to edit or delete.
  assert.equal((await deleteRoute(req({ headers: theirs, params: { id: routeFixture.id } }), ctx)).status, 404);
  const hijack = await saveRoute(req({
    headers: theirs, body: { id: routeFixture.id, name: 'Mine now', steps: [{ name: 'A' }, { name: 'B' }] },
  }), ctx);
  assert.equal(hijack.status, 404);
});

await check('the buyer sees one timeline per lot, not one per item', async () => {
  const body = (await myItems(req({ headers: earlyBuyer.headers }), ctx)).jsonBody;
  const group = body.groups.find((row) => row.lot?.id === routedLot.id);
  assert.ok(group, 'their item is grouped under the lot it travels in');
  assert.equal(group.kind, 'lot');
  assert.equal(group.lot.steps.length, 5);
  assert.equal(group.lot.currentStep, 4);
  // One card, one ladder, however many of their items are in it.
  assert.ok(group.items.length >= 1);
  assert.ok(group.sellerName);

  // A second item in the same lot joins the same group rather than making
  // a second identical timeline.
  const extra = await waitingItem('Also theirs');
  const alsoPlaced = await createOrder(req({ headers: earlyBuyer.headers, body: { listingId: extra } }), ctx);
  await addItems(req({
    headers: auth, params: { id: routedLot.id }, body: { orderIds: [alsoPlaced.jsonBody.order.id] },
  }), ctx);

  const after = (await myItems(req({ headers: earlyBuyer.headers }), ctx)).jsonBody;
  const groups = after.groups.filter((row) => row.lot?.id === routedLot.id);
  assert.equal(groups.length, 1, 'one group, two items');
  assert.equal(groups[0].items.length, group.items.length + 1);

  // What is waiting sorts first: it is the only thing a buyer might act on.
  const waiting = after.groups.find((row) => row.kind === 'awaiting');
  if (waiting) assert.equal(after.groups[0].kind, 'awaiting');
});

await check('the two ways to move a lot cannot disagree about where it is', async () => {
  // `advanceStage` names one of the seven fixed stages and the route screen
  // names a step. They are two doors onto one lot, so both have to set its
  // position - otherwise a lot advanced through the old door reads as still
  // at step zero and every buyer in it is told nothing happened.
  const made = await createLot(req({ headers: auth, body: { name: 'Two doors' } }), ctx);
  const id = made.jsonBody.lot.id;

  const moved = await advanceStage(req({
    headers: auth, params: { id }, body: { stage: 'india_received' },
  }), ctx);
  assert.equal(moved.status, 200, JSON.stringify(moved.jsonBody));

  const body = (await lotContents(req({ headers: auth, params: { id } }), ctx)).jsonBody;
  assert.equal(body.lot.stage, 'india_received');
  assert.equal(body.route.steps[body.route.currentStep].name, 'India received / customs');
  // And the history says what happened in the same words the ladder shows.
  const last = body.lot.stageHistory[body.lot.stageHistory.length - 1];
  assert.equal(last.step, 'India received / customs');
});

await check('a route can be dropped, and the lots on it carry on', async () => {
  const gone = await deleteRoute(req({ headers: auth, params: { id: routeFixture.id } }), ctx);
  assert.equal(gone.status, 200);
  assert.equal((await listRoutes(req({ headers: auth }), ctx)).jsonBody.routes.some((r) => r.id === routeFixture.id), false);

  // The lot carries its own copy, which is the reason it carries one.
  const still = (await lotContents(req({ headers: auth, params: { id: routedLot.id } }), ctx)).jsonBody;
  assert.equal(still.route.steps.length, 5);
  assert.equal(still.route.name, 'Guangzhou air express');
});

/* ── the order in front of you ─────────────────────────────────────────── */
console.log('\nthe order in front of you');

let templateFixture;
let photoFixture;
let templatedOrder;
let templatedBuyer;

await check('a Quick Post template is the stationery, not a straitjacket', async () => {
  const made = await saveTemplate(req({
    headers: auth,
    body: {
      name: 'Marvel Standard',
      category: 'Scale figures',
      sourcing: 'import',
      tags: ['Marvel', ' Action figure ', ''],
      condition: 'MISB',
      description: 'Original Marvel Legends figure.\nCondition: MISB.',
      preLotSteps: [{ name: 'Order placed' }, { name: 'At our Guangzhou desk' }],
      preLotName: 'China standard',
    },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const template = made.jsonBody.template;
  assert.deepEqual(template.tags, ['Marvel', 'Action figure'], 'blanks dropped, spaces trimmed');
  assert.equal(template.sourcing, 'import', 'and it knows what kind of thing it lists');
  assert.equal(template.condition, 'MISB');
  assert.equal(template.preLotRoute.steps.length, 2);
  assert.equal(template.preLotRoute.name, 'China standard');

  // A condition nobody grades by is not stored as one.
  const odd = await saveTemplate(req({
    headers: auth, body: { name: 'Odd', condition: 'PRISTINE-ISH' },
  }), ctx);
  assert.equal(odd.jsonBody.template.condition, null);

  // Correcting one keeps its identity, so the listings made from it still say
  // where they came from.
  const fixed = await saveTemplate(req({
    headers: auth, body: { id: template.id, name: 'Marvel Standard v2', category: 'Scale figures' },
  }), ctx);
  assert.equal(fixed.status, 200);
  assert.equal(fixed.jsonBody.template.id, template.id);

  const mine = (await listTemplates(req({ headers: auth }), ctx)).jsonBody.templates;
  assert.ok(mine.some((row) => row.id === template.id));

  templateFixture = fixed.jsonBody.template;
});

await check('somebody else’s stationery is not yours to read or edit', async () => {
  const stranger = await signup(req({
    body: {
      displayName: 'Other Shop', email: 'othershop@figmark.example',
      phone: '+919000078831', password: 'longenough1',
    },
  }), ctx);
  const theirs = { authorization: `Bearer ${stranger.jsonBody.token}` };

  assert.deepEqual((await listTemplates(req({ headers: theirs }), ctx)).jsonBody.templates, []);
  const hijack = await saveTemplate(req({
    headers: theirs, body: { id: templateFixture.id, name: 'Mine now' },
  }), ctx);
  assert.equal(hijack.status, 404);
  assert.equal((await deleteTemplate(req({ headers: theirs, params: { id: templateFixture.id } }), ctx)).status, 404);
});

await check('a photo goes in and comes back out', async () => {
  // One transparent pixel, which is a real PNG and small enough to read.
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const stored = await upload(req({ headers: auth, body: { dataUrl: pixel } }), ctx);
  assert.equal(stored.status, 201, JSON.stringify(stored.jsonBody));
  assert.ok(stored.jsonBody.blobName.endsWith('.png'));
  assert.ok(stored.jsonBody.url.includes(stored.jsonBody.blobName));

  const served = await photoRoute(req({ params: { name: stored.jsonBody.blobName } }), ctx);
  assert.equal(served.status, 200);
  assert.equal(served.headers['Content-Type'], 'image/png');
  assert.ok(served.body.length > 0);

  // Not an image, not a data URL, and far too big are three different refusals.
  assert.equal((await upload(req({ headers: auth, body: { dataUrl: 'https://example.com/x.png' } }), ctx)).status, 400);
  assert.equal((await upload(req({
    headers: auth, body: { dataUrl: 'data:application/pdf;base64,AAAA' },
  }), ctx)).status, 400);
  const huge = `data:image/jpeg;base64,${'A'.repeat(1_400_000)}`;
  const refused = await upload(req({ headers: auth, body: { dataUrl: huge } }), ctx);
  assert.equal(refused.status, 413);

  photoFixture = stored.jsonBody;
});

await check('a listing keeps its photos, in order, with one leading', async () => {
  const made = await createListing(req({
    headers: auth,
    body: {
      title: 'Photographed item', priceMinor: 20_000,
      photos: [
        { blobName: 'a.jpg', url: '/api/photos/a.jpg', isPrimary: false },
        { blobName: photoFixture.blobName, url: photoFixture.url, isPrimary: true },
      ],
    },
  }), ctx);
  assert.equal(made.status, 201);
  const photos = made.jsonBody.listing.photos;
  assert.equal(photos.length, 2);
  assert.equal(photos[0].url, '/api/photos/a.jpg', 'the order the seller arranged');
  assert.equal(photos[1].isPrimary, true, 'and the one they chose to lead');

  // Nobody said which leads, so the first does.
  const quiet = await createListing(req({
    headers: auth,
    body: {
      title: 'Unchosen', priceMinor: 20_000,
      photos: [{ blobName: 'x.jpg', url: '/x.jpg', isPrimary: false }, { blobName: 'y.jpg', url: '/y.jpg', isPrimary: false }],
    },
  }), ctx);
  assert.equal(quiet.jsonBody.listing.photos[0].isPrimary, true);

  // Six is the cap, because a document with forty images in it fails in
  // production and nowhere else.
  const many = await createListing(req({
    headers: auth,
    body: {
      title: 'Too many', priceMinor: 20_000,
      photos: Array.from({ length: 9 }, (_, i) => ({ blobName: `${i}.jpg`, url: `/${i}.jpg`, isPrimary: false })),
    },
  }), ctx);
  assert.equal(many.jsonBody.listing.photos.length, 6);
});

await check('a template’s ladder travels to the listing, and then to the order', async () => {
  const listed = await createListing(req({
    headers: auth,
    body: {
      title: 'Listed from a template', priceMinor: 25_000, sourcing: 'import',
      preLotSteps: [{ name: 'Order placed' }, { name: 'At our Guangzhou desk' }],
      preLotName: 'China standard',
    },
  }), ctx);
  assert.equal(listed.status, 201);
  assert.equal(listed.jsonBody.listing.preLotRoute.steps.length, 2);

  const buyer = await newBuyer('Template Buyer');
  const placed = await createOrder(req({
    headers: buyer.headers, body: { listingId: listed.jsonBody.listing.id },
  }), ctx);
  assert.equal(placed.status, 201);

  const tracking = (await orderTracking(req({
    headers: buyer.headers, params: { id: placed.jsonBody.order.id },
  }), ctx)).jsonBody;
  // The shop's own words, before any lot exists.
  assert.equal(tracking.preLot.name, 'China standard');
  assert.equal(tracking.preLot.steps[1].name, 'At our Guangzhou desk');
  assert.equal(tracking.preLot.currentStep, 0, 'nothing has reached the warehouse yet');
  assert.equal(tracking.awaitingLot, true);
  assert.equal(tracking.route, null);

  templatedOrder = placed.jsonBody.order;
  templatedBuyer = buyer;
});

await check('the warehouse tick moves the buyer’s timeline, without anyone editing it', async () => {
  const ticked = await setCheckpoint(req({
    headers: auth, params: { id: templatedOrder.id },
    body: { checkpoint: 'china_received', on: true },
  }), ctx);
  assert.equal(ticked.status, 200, JSON.stringify(ticked.jsonBody));

  const tracking = (await orderTracking(req({
    headers: templatedBuyer.headers, params: { id: templatedOrder.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.preLot.currentStep, 1, 'the second step is where it is now');

  // And the seller's own screen shows the same fact.
  const board = (await sales(req({ headers: auth }), ctx)).jsonBody;
  const row = board.orders.find((entry) => entry.id === templatedOrder.id);
  assert.ok(row, 'every purchase is on the orders screen');
  assert.ok(row.chinaReceivedAt, 'ticked, with when');
  assert.equal(row.awaitingLot, true);
  assert.equal(row.lotNumber, null);
});

await check('the order card carries everything it needs answering about', async () => {
  const board = (await sales(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(Array.isArray(board.orders));
  const row = board.orders[0];
  for (const key of [
    'itemName', 'buyer', 'inHand', 'awaitingLot', 'lotId', 'lotNumber', 'lotStep',
    'paymentStatus', 'escrowState', 'chinaReceivedAt',
  ]) {
    assert.ok(key in row, `an order card needs ${key}`);
  }
  // The three piles that need an answer about money are still there: this
  // screen replaced nothing, it absorbed it.
  for (const pile of ['waiting', 'placed', 'answered']) {
    assert.ok(Array.isArray(board[pile]), `${pile} should still be a list`);
  }
});

await check('the template picks the lot route too, so nobody picks it twice', async () => {
  // The last link: choose the template once when listing, and the lot opened
  // from that order already knows which ladder it should travel.
  const route = await saveRoute(req({
    headers: auth,
    body: { name: 'Nine step run', steps: [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }] },
  }), ctx);
  const withRoute = await saveTemplate(req({
    headers: auth,
    body: { name: 'Routed template', sourcing: 'import', lotRouteId: route.jsonBody.route.id },
  }), ctx);
  assert.equal(withRoute.jsonBody.template.lotRouteName, 'Nine step run');

  const listed = await createListing(req({
    headers: auth,
    body: {
      title: 'Routed item', priceMinor: 12_000, sourcing: 'import',
      lotRouteId: route.jsonBody.route.id,
    },
  }), ctx);
  const buyer = await newBuyer('Routed Buyer');
  const placed = await createOrder(req({
    headers: buyer.headers, body: { listingId: listed.jsonBody.listing.id },
  }), ctx);

  const board = (await sales(req({ headers: auth }), ctx)).jsonBody;
  const row = board.orders.find((entry) => entry.id === placed.jsonBody.order.id);
  assert.equal(row.lotRouteId, route.jsonBody.route.id, 'the order card carries it through');
});

await check('one order, one move: a lot opened and the order filed into it', async () => {
  const filed = await assignOrderToLot(req({
    headers: auth, params: { id: templatedOrder.id },
    body: {
      newLot: {
        name: 'Opened from an order', origin: 'Guangzhou, CN',
        routeId: undefined,
      },
    },
  }), ctx);
  assert.equal(filed.status, 200, JSON.stringify(filed.jsonBody));
  assert.equal(filed.jsonBody.order.lotId, filed.jsonBody.lot.id);
  assert.ok(filed.jsonBody.lot.lotNumber, 'and the lot has a number people can say');

  // The buyer's timeline is now both halves: the shop's own words, then the
  // lot's route.
  const tracking = (await orderTracking(req({
    headers: templatedBuyer.headers, params: { id: templatedOrder.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.awaitingLot, false);
  assert.equal(tracking.preLot.steps[1].name, 'At our Guangzhou desk');
  assert.ok(tracking.route.steps.length >= 2);

  // Filing it twice is refused rather than silently moving it.
  const again = await assignOrderToLot(req({
    headers: auth, params: { id: templatedOrder.id }, body: { lotId: filed.jsonBody.lot.id },
  }), ctx);
  assert.equal(again.status, 409);

  // A lot that does not exist does not quietly become a new one.
  const other = await newBuyer('Another Waiting');
  const listing = await createListing(req({
    headers: auth, body: { title: 'Waiting too', priceMinor: 9_000, sourcing: 'import' },
  }), ctx);
  const order = await createOrder(req({
    headers: other.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx);
  const nowhere = await assignOrderToLot(req({
    headers: auth, params: { id: order.jsonBody.order.id }, body: { lotId: 'lot_nope' },
  }), ctx);
  assert.equal(nowhere.status, 404);
});

await check('an item bought into a lot says so before it says anything else', async () => {
  // A shop can open the run first and list against it, so the item is in a lot
  // before anybody buys it. Then the first thing its buyer should read is which
  // shipment it travels with - not "added to a lot" halfway down a ladder it
  // was never off.
  const lot = await createLot(req({
    headers: auth, body: { name: 'Listed against this one', origin: 'Guangzhou, CN' },
  }), ctx);
  const lotId = lot.jsonBody.lot.id;

  const listing = await createListing(req({
    headers: auth,
    body: { title: 'Born in a lot', priceMinor: 12_000, sourcing: 'import', lotId },
  }), ctx);
  const buyer = await newBuyer('Bought Into A Lot');
  const placed = await createOrder(req({
    headers: buyer.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx);
  assert.equal(placed.status, 201, JSON.stringify(placed.jsonBody));

  const history = placed.jsonBody.order.stageHistory;
  assert.equal(history[0].kind, 'joined', 'the lot comes first');
  assert.equal(history[0].lot.id, lotId);
  assert.equal(history[0].lot.name, 'Listed against this one');
  assert.ok(history[0].lot.number);
  assert.equal(history[1].note, 'Order placed.', 'and the order after it');

  // And the buyer reads it on their own timeline, not only in the seller's copy.
  const tracking = (await orderTracking(req({
    headers: buyer.headers, params: { id: placed.jsonBody.order.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.order.stageHistory[0].kind, 'joined');
  assert.equal(tracking.route.lotName, 'Listed against this one');
});

await check('an item can be moved to another lot, and the timeline says so', async () => {
  // A piece misses the cut-off and rides the next run. It used to be refused,
  // and the only way to do it was to tell the buyer nothing.
  const first = await createLot(req({
    headers: auth, body: { name: 'Missed the cut-off', origin: 'Guangzhou, CN' },
  }), ctx);
  const second = await createLot(req({
    headers: auth, body: { name: 'The next run', origin: 'Guangzhou, CN' },
  }), ctx);

  const listing = await createListing(req({
    headers: auth, body: { title: 'Re-filed piece', priceMinor: 7_000, sourcing: 'import' },
  }), ctx);
  const buyer = await newBuyer('Moved Between Lots');
  const order = (await createOrder(req({
    headers: buyer.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx)).jsonBody.order;

  const filed = await assignOrderToLot(req({
    headers: auth, params: { id: order.id }, body: { lotId: first.jsonBody.lot.id },
  }), ctx);
  assert.equal(filed.status, 200, JSON.stringify(filed.jsonBody));
  assert.equal(filed.jsonBody.order.stageHistory.at(-1).kind, 'joined');

  const moved = await assignOrderToLot(req({
    headers: auth, params: { id: order.id }, body: { lotId: second.jsonBody.lot.id },
  }), ctx);
  assert.equal(moved.status, 200, JSON.stringify(moved.jsonBody));
  assert.equal(moved.jsonBody.order.lotId, second.jsonBody.lot.id);

  const event = moved.jsonBody.order.stageHistory.at(-1);
  assert.equal(event.kind, 'moved');
  assert.equal(event.lot.name, 'The next run');
  assert.equal(event.from.name, 'Missed the cut-off', 'and where it came from');

  // Both lots are on the buyer's record, in the order they happened, so the
  // move reads as a move rather than as the first lot quietly disappearing.
  const tracking = (await orderTracking(req({
    headers: buyer.headers, params: { id: order.id },
  }), ctx)).jsonBody;
  const lots = tracking.order.stageHistory.filter((row) => row.kind === 'joined' || row.kind === 'moved');
  assert.deepEqual(lots.map((row) => row.lot.name), ['Missed the cut-off', 'The next run']);
  assert.equal(tracking.route.lotName, 'The next run');

  // It is off the first lot's manifest and on the second's.
  const before = (await lotContents(req({
    headers: auth, params: { id: first.jsonBody.lot.id },
  }), ctx)).jsonBody;
  const after = (await lotContents(req({
    headers: auth, params: { id: second.jsonBody.lot.id },
  }), ctx)).jsonBody;
  assert.ok(!before.items.some((row) => row.id === order.id));
  assert.ok(after.items.some((row) => row.id === order.id));

  // Moving it into the lot it is already in is not a move.
  const nowhere = await assignOrderToLot(req({
    headers: auth, params: { id: order.id }, body: { lotId: second.jsonBody.lot.id },
  }), ctx);
  assert.equal(nowhere.status, 409);
});

await check('the warehouse tick stops at the hand-over, not past it', async () => {
  /* Ticking a parcel into the warehouse used to land it on "Dispatched from
     China" - the coarse seven stages overshoot on a longer route - so the
     buyer was told the crate had left the country because one box arrived. */
  const route = await saveRoute(req({
    headers: auth,
    body: {
      name: 'Eight steps',
      steps: [
        { name: 'Order placed', side: 'pre' },
        { name: 'Received at international warehouse', side: 'pre' },
        { name: 'Dispatched from China', side: 'post' },
        { name: 'International transit', side: 'post' },
        { name: 'Indian customs', side: 'post' },
        { name: 'Received by seller', side: 'post' },
        { name: 'Domestic dispatch', side: 'post' },
        { name: 'Delivered', side: 'post' },
      ],
    },
  }), ctx);
  const lot = await createLot(req({
    headers: auth,
    body: { name: 'Hand-over lot', origin: 'Guangzhou, CN', routeId: route.jsonBody.route.id },
  }), ctx);

  const listing = await createListing(req({
    headers: auth, body: { title: 'Waits at the warehouse', priceMinor: 5_000, sourcing: 'import' },
  }), ctx);
  const buyer = await newBuyer('Warehouse Watcher');
  const order = (await createOrder(req({
    headers: buyer.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx)).jsonBody.order;
  await assignOrderToLot(req({
    headers: auth, params: { id: order.id }, body: { lotId: lot.jsonBody.lot.id },
  }), ctx);

  await setCheckpoint(req({
    headers: auth, params: { id: order.id }, body: { checkpoint: 'china_received', on: true },
  }), ctx);

  const tracking = (await orderTracking(req({
    headers: buyer.headers, params: { id: order.id },
  }), ctx)).jsonBody;
  assert.equal(
    tracking.route.steps[tracking.route.currentStep].name,
    'Received at international warehouse',
    'the last step it travels alone, not the first one the lot travels',
  );
  assert.equal(tracking.route.waitingForLot, true, 'and it says it is waiting for the lot');

  // Once the lot itself moves, the wait is over and the position is the lot's.
  await stepLot(req({ headers: auth, params: { id: lot.jsonBody.lot.id }, body: { to: 2 } }), ctx);
  const after = (await orderTracking(req({
    headers: buyer.headers, params: { id: order.id },
  }), ctx)).jsonBody;
  assert.equal(after.route.steps[after.route.currentStep].name, 'Dispatched from China');
  assert.equal(after.route.waitingForLot, false);
});

await check('a lot can be put on a different ladder, carrying its place', async () => {
  const short = await saveRoute(req({
    headers: auth,
    body: {
      name: 'Short way',
      steps: [
        { name: 'Ordered', side: 'pre' }, { name: 'Packed', side: 'pre' },
        { name: 'Flown', side: 'post' }, { name: 'Landed', side: 'post' },
      ],
    },
  }), ctx);
  const long = await saveRoute(req({
    headers: auth,
    body: {
      name: 'The long way round',
      steps: [
        { name: 'Ordered', side: 'pre' }, { name: 'At the desk', side: 'pre' },
        { name: 'Consolidated', side: 'post' }, { name: 'Sailed', side: 'post' },
        { name: 'Customs', side: 'post' }, { name: 'Delivered', side: 'post' },
      ],
    },
  }), ctx);

  const lot = await createLot(req({
    headers: auth,
    body: { name: 'Rerouted', origin: 'Yiwu, CN', routeId: short.jsonBody.route.id },
  }), ctx);
  const lotId = lot.jsonBody.lot.id;

  const listing = await createListing(req({
    headers: auth, body: { title: 'Rides a changed route', priceMinor: 4_000, sourcing: 'import' },
  }), ctx);
  const buyer = await newBuyer('Route Changed');
  const order = (await createOrder(req({
    headers: buyer.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx)).jsonBody.order;
  await assignOrderToLot(req({ headers: auth, params: { id: order.id }, body: { lotId } }), ctx);
  await stepLot(req({ headers: auth, params: { id: lotId }, body: { to: 2 } }), ctx);

  const changed = await setLotRoute(req({
    headers: auth, params: { id: lotId },
    body: { routeId: long.jsonBody.route.id, note: 'Sea freight now, so the steps changed.' },
  }), ctx);
  assert.equal(changed.status, 200, JSON.stringify(changed.jsonBody));
  assert.equal(changed.jsonBody.ordersUpdated, 1);

  const board = (await lotContents(req({ headers: auth, params: { id: lotId } }), ctx)).jsonBody;
  assert.equal(board.route.name, 'The long way round');
  assert.equal(board.route.steps.length, 6);
  assert.ok(board.route.currentStep > 0, 'a lot halfway there does not start again');

  // The buyer reads the new ladder, from the equivalent point, and is told why.
  const tracking = (await orderTracking(req({
    headers: buyer.headers, params: { id: order.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.route.name, 'The long way round');
  assert.ok(tracking.route.currentStep < tracking.route.steps.length);
  assert.equal(
    tracking.order.stageHistory.at(-1).note,
    'Sea freight now, so the steps changed.',
  );

  // Twice over is refused, and somebody else's lot is not theirs to reroute.
  const again = await setLotRoute(req({
    headers: auth, params: { id: lotId }, body: { routeId: long.jsonBody.route.id },
  }), ctx);
  assert.equal(again.status, 409);
  const stranger = await newBuyer('Not This Shop Either');
  const refused = await setLotRoute(req({
    headers: stranger.headers, params: { id: lotId }, body: { routeId: short.jsonBody.route.id },
  }), ctx);
  assert.equal(refused.status, 403);
});

await check('a lot is named by the person opening it, never by the first thing in it', async () => {
  // The name used to fall back to "Lot for <whatever sold first>" when the
  // field was left blank, and that lot then held thirty other people's parcels.
  const listing = await createListing(req({
    headers: auth, body: { title: 'Names nothing', priceMinor: 6_000, sourcing: 'import' },
  }), ctx);
  const buyer = await newBuyer('No Name Given');
  const order = (await createOrder(req({
    headers: buyer.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx)).jsonBody.order;

  for (const name of [undefined, '', '   ']) {
    const refused = await assignOrderToLot(req({
      headers: auth, params: { id: order.id },
      body: { newLot: { name, origin: 'Guangzhou, CN' } },
    }), ctx);
    assert.equal(refused.status, 400, `"${name}" is not a name`);
  }
});

await check('a lot never carries a step that happens to one item', async () => {
  /* The complaint that started this: the lot screen listed "received at
     international warehouse", which is something a parcel does before it is in
     the crate. The same step cannot be at item level and lot level at once. */
  const route = await saveRoute(req({
    headers: auth,
    body: {
      name: 'Two halves',
      steps: [
        { name: 'Order placed', side: 'pre' },
        { name: 'Received at international warehouse', side: 'pre' },
        { name: 'Dispatched from China', side: 'post' },
        { name: 'Indian customs', side: 'post' },
        { name: 'Delivered', side: 'post' },
      ],
    },
  }), ctx);
  const opened = await createLot(req({
    headers: auth,
    body: { name: 'Halved', origin: 'Guangzhou, CN', routeId: route.jsonBody.route.id },
  }), ctx);
  const lotId = opened.jsonBody.lot.id;

  const board = (await lotContents(req({ headers: auth, params: { id: lotId } }), ctx)).jsonBody;
  assert.equal(board.route.offset, 2, 'the lot half starts after the two item steps');
  const lotSteps = board.route.steps.slice(board.route.offset).map((step) => step.name);
  assert.deepEqual(lotSteps, ['Dispatched from China', 'Indian customs', 'Delivered']);
  assert.ok(
    !lotSteps.some((name) => /warehouse|order placed/i.test(name)),
    'and nothing an item does on its own is among them',
  );

  // Filling: below its own first step, and saying so rather than borrowing the
  // name of the item step it happens to sit above.
  assert.equal(board.route.currentStep, board.route.offset - 1);
  assert.equal(opened.jsonBody.lot.stage, 'ordering');

  // The first move lands on the lot's own first step, not on an item's.
  await stepLot(req({ headers: auth, params: { id: lotId } }), ctx);
  const moved = (await lotContents(req({ headers: auth, params: { id: lotId } }), ctx)).jsonBody;
  assert.equal(moved.route.steps[moved.route.currentStep].name, 'Dispatched from China');
});

await check('an item counted into the warehouse has done it, and says so', async () => {
  const listing = await createListing(req({
    headers: auth, body: { title: 'Counted in', priceMinor: 8_000, sourcing: 'import' },
  }), ctx);
  const buyer = await newBuyer('Counted In');
  const order = (await createOrder(req({
    headers: buyer.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx)).jsonBody.order;

  // With no lot yet: the arrival is done, and what is in progress is the wait.
  await setCheckpoint(req({
    headers: auth, params: { id: order.id }, body: { checkpoint: 'china_received', on: true },
  }), ctx);
  const waiting = (await orderTracking(req({
    headers: buyer.headers, params: { id: order.id },
  }), ctx)).jsonBody;
  assert.equal(waiting.awaitingLot, true);
  assert.equal(
    waiting.preLot.currentStep, waiting.preLot.steps.length - 1,
    'the arrival it has made is the last thing on its own ladder',
  );
  assert.equal(waiting.preLot.waitingForLot, true, 'and the wait is what is left');

  // Filed into a lot afterwards: the join is recorded where the item was, so
  // "travelling with" falls after the arrival rather than above it.
  const lot = await createLot(req({
    headers: auth, body: { name: 'Takes counted items', origin: 'Guangzhou, CN' },
  }), ctx);
  await assignOrderToLot(req({
    headers: auth, params: { id: order.id }, body: { lotId: lot.jsonBody.lot.id },
  }), ctx);

  const after = (await orderTracking(req({
    headers: buyer.headers, params: { id: order.id },
  }), ctx)).jsonBody;
  const join = after.order.stageHistory.find((event) => event.kind === 'joined');
  const names = after.route.steps.map((step) => step.name);
  assert.equal(
    names.indexOf(join.step), after.route.steps.length - names.length + names.indexOf(join.step),
  );
  assert.ok(
    names.indexOf(join.step) > 0,
    'filed at the step the item had reached, not at the lot\'s step zero',
  );
  assert.equal(after.route.waitingForLot, true, 'still waiting on the crate, and still saying so');
});

await check('a button the shop already presses writes the buyer\'s tracking', async () => {
  /* The whole point of a route: the piece lands, the shop taps "China WH", and
     the buyer's timeline says "Received at international warehouse" without
     anybody editing a timeline. */
  const route = await saveRoute(req({
    headers: auth,
    body: {
      name: 'Triggered',
      steps: [
        { name: 'Order placed', side: 'pre' },
        { name: 'Received at international warehouse', side: 'pre', trigger: 'china_received' },
        { name: 'Dispatched from China', side: 'post' },
        { name: 'Landed in India', side: 'post', trigger: 'india_received' },
        { name: 'Out for delivery', side: 'post', trigger: 'dispatched' },
      ],
    },
  }), ctx);
  assert.equal(route.status, 201, JSON.stringify(route.jsonBody));
  assert.equal(route.jsonBody.route.steps[1].trigger, 'china_received', 'the binding is stored');
  assert.equal(route.jsonBody.route.steps[0].trigger, undefined, 'and only where it was set');

  const lot = await createLot(req({
    headers: auth,
    body: { name: 'Triggered run', origin: 'Guangzhou, CN', routeId: route.jsonBody.route.id },
  }), ctx);
  const lotId = lot.jsonBody.lot.id;
  const listing = await createListing(req({
    headers: auth, body: { title: 'Moves on a button', priceMinor: 5_000, sourcing: 'import' },
  }), ctx);
  const buyer = await newBuyer('Reads The Timeline');
  const order = (await createOrder(req({
    headers: buyer.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx)).jsonBody.order;
  await assignOrderToLot(req({ headers: auth, params: { id: order.id }, body: { lotId } }), ctx);

  const where = async () => {
    const t = (await orderTracking(req({
      headers: buyer.headers, params: { id: order.id },
    }), ctx)).jsonBody;
    return t.route.steps[t.route.currentStep].name;
  };
  assert.equal(await where(), 'Order placed', 'nothing pressed, nothing moved');

  // One press.
  await setCheckpoint(req({
    headers: auth, params: { id: order.id }, body: { checkpoint: 'china_received', on: true },
  }), ctx);
  assert.equal(await where(), 'Received at international warehouse');

  // A button bound to a step further along jumps straight there: the lot flew
  // while nobody was ticking, and the tick that lands is the truth.
  await setCheckpoint(req({
    headers: auth, params: { id: order.id }, body: { checkpoint: 'india_received', on: true },
  }), ctx);
  assert.equal(await where(), 'Landed in India');

  /* Unticked is untrue, and the timeline falls back to the furthest button
     still pressed rather than holding a position nobody remembers setting. */
  await setCheckpoint(req({
    headers: auth, params: { id: order.id }, body: { checkpoint: 'india_received', on: false },
  }), ctx);
  assert.equal(await where(), 'Received at international warehouse');

  // A button with nothing bound to it records the fact and moves nothing.
  await setCheckpoint(req({
    headers: auth, params: { id: order.id }, body: { checkpoint: 'china_packed', on: true },
  }), ctx);
  assert.equal(await where(), 'Received at international warehouse');

  // And the lot moving still carries everyone, buttons or no buttons.
  await stepLot(req({ headers: auth, params: { id: lotId }, body: { to: 4 } }), ctx);
  assert.equal(await where(), 'Out for delivery');
});

await check('a route with no buttons bound still works the way it always did', async () => {
  // Nobody is forced to bind anything: an unbound route falls back to the
  // hand-over, which is the best a guess can do and what shops had before.
  const route = await saveRoute(req({
    headers: auth,
    body: {
      name: 'Nothing bound',
      steps: [
        { name: 'Ordered', side: 'pre' },
        { name: 'At the warehouse', side: 'pre' },
        { name: 'Flown', side: 'post' },
        { name: 'Delivered', side: 'post' },
      ],
    },
  }), ctx);
  const lot = await createLot(req({
    headers: auth,
    body: { name: 'Unbound run', origin: 'Guangzhou, CN', routeId: route.jsonBody.route.id },
  }), ctx);
  const listing = await createListing(req({
    headers: auth, body: { title: 'No buttons here', priceMinor: 3_000, sourcing: 'import' },
  }), ctx);
  const buyer = await newBuyer('Unbound Buyer');
  const order = (await createOrder(req({
    headers: buyer.headers, body: { listingId: listing.jsonBody.listing.id },
  }), ctx)).jsonBody.order;
  await assignOrderToLot(req({
    headers: auth, params: { id: order.id }, body: { lotId: lot.jsonBody.lot.id },
  }), ctx);
  await setCheckpoint(req({
    headers: auth, params: { id: order.id }, body: { checkpoint: 'china_received', on: true },
  }), ctx);

  const tracking = (await orderTracking(req({
    headers: buyer.headers, params: { id: order.id },
  }), ctx)).jsonBody;
  assert.equal(tracking.route.steps[tracking.route.currentStep].name, 'At the warehouse');
  assert.equal(tracking.route.waitingForLot, true);
});

await check('a domestic sale is not something to file into a crate', async () => {
  const shelf = await createListing(req({
    headers: auth, body: { title: 'Straight off the shelf', priceMinor: 3_000, sourcing: 'in_hand' },
  }), ctx);
  const buyer = await newBuyer('Local Buyer');
  const placed = await createOrder(req({
    headers: buyer.headers, body: { listingId: shelf.jsonBody.listing.id },
  }), ctx);

  const refused = await assignOrderToLot(req({
    headers: auth, params: { id: placed.jsonBody.order.id }, body: { lotId: 'anything' },
  }), ctx);
  assert.equal(refused.status, 409);
  assert.match(refused.jsonBody.message, /domestic/i);

  // And the card says so rather than offering a control that cannot work.
  const board = (await sales(req({ headers: auth }), ctx)).jsonBody;
  const row = board.orders.find((entry) => entry.id === placed.jsonBody.order.id);
  assert.equal(row.inHand, true);
  assert.equal(row.awaitingLot, false);
});

await check('only the shop that sold it may file it, or tick it', async () => {
  const stranger = await signup(req({
    body: {
      displayName: 'Passing Stranger', email: 'passing-by@figmark.example',
      phone: '+919000078832', password: 'longenough1',
    },
  }), ctx);
  assert.equal(stranger.status, 201, JSON.stringify(stranger.jsonBody));
  const theirs = { authorization: `Bearer ${stranger.jsonBody.token}` };
  const refused = await assignOrderToLot(req({
    headers: theirs, params: { id: templatedOrder.id }, body: { lotId: 'x' },
  }), ctx);
  assert.equal(refused.status, 403);
});

console.log(`\n${passed} checks passed`);
