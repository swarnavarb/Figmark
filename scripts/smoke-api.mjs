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

await check('health advertises exactly one sign-in account', async () => {
  const body = (await health(req(), ctx)).jsonBody;
  assert.equal(body.auth.demoAccounts.length, 1);
  assert.equal(body.auth.demoAccounts[0].identifier, DEMO_EMAIL);
});

const session = await login(req({ body: { identifier: DEMO_EMAIL, password: DEMO_PASSWORD } }), ctx);
const auth = { authorization: `Bearer ${session.jsonBody.token}` };

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
  const lots = (await feed(req({ query: { kind: 'lot_slot' } }), ctx)).jsonBody.listings;
  assert.ok(lots.length > 0 && lots.every((l) => l.kind === 'lot_slot'));
  const misb = (await feed(req({ query: { condition: 'MISB' } }), ctx)).jsonBody.listings;
  assert.ok(misb.every((l) => l.condition === 'MISB'));
  const cheap = (await feed(req({ query: { maxPrice: '50000' } }), ctx)).jsonBody.listings;
  assert.ok(cheap.every((l) => l.priceMinor <= 50000));
});

await check('lot slots carry their lot for the fill meter', async () => {
  const body = (await feed(req({ query: { kind: 'lot_slot' } }), ctx)).jsonBody;
  assert.ok(body.listings.every((l) => l.lot && typeof l.lot.fillThreshold === 'number'));
});

await check('followed sellers rank first for a signed-in viewer', async () => {
  const body = (await feed(req({ headers: auth }), ctx)).jsonBody;
  assert.ok(body.followedSellerIds.includes('usr_kaiju'));
  assert.equal(body.listings[0].sellerId, 'usr_kaiju');
});

/* ── listing detail and social ─────────────────────────────────────────── */
console.log('\nlisting detail and social');

await check('detail includes seller, lot and comments', async () => {
  const body = (await listingDetail(req({ params: { id: 'lst_dragon_knight' } }), ctx)).jsonBody;
  assert.equal(body.seller.storefrontName, 'Kaiju Imports');
  assert.ok(body.lot);
  assert.equal(body.comments.length, 2);
  assert.equal(body.comments[1].replyToId, 'cmt_1');
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
  const on = await toggleFollow(req({ headers: auth, params: { id: 'usr_tokyoline' } }), ctx);
  assert.equal(on.jsonBody.following, true);
  await toggleFollow(req({ headers: auth, params: { id: 'usr_tokyoline' } }), ctx);
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

console.log(`\n${passed} checks passed`);
