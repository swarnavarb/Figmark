/**
 * Smoke test for the shop's data: delivery times and the on-time rate, where
 * views come from, what buyers search for, the customer screens, and group
 * messages to customers.
 *
 * Calls the compiled route handlers directly, like smoke-api.mjs. Run
 * `npm run build:api && npm run build:fixtures` first.
 */
import assert from 'node:assert/strict';
import { fixtures, useFixtures } from './fixtures.mjs';

process.env.FIGMARK_RATE_LIMITS = 'off';
process.env.FIGMARK_UNDO_WINDOW_MS = '0';
await useFixtures();

const dist = new URL('../api/dist/', import.meta.url);
const fns = new URL('api/src/functions/', dist);
const { loginRoute: login, signupRoute: rawSignup } = await import(new URL('auth-routes.js', fns));
const { verifiedSignup } = await import('./verified-signup.mjs');
const signup = verifiedSignup(rawSignup);
const {
  feedRoute: feed, listingDetailRoute: listingDetail, createListingRoute: createListing,
  editListingRoute: editListing, createOrderRoute: openCheckout, toggleLikeRoute: toggleLike,
  toggleFollowRoute: toggleFollow,
} = await import(new URL('catalog-routes.js', fns));
const { bookOrderRoute: bookOrder } = await import(new URL('order-routes.js', fns));
const { powerSaleCreateRoute: schedulePowerSale } = await import(new URL('power-sale-routes.js', fns));
const {
  customersRoute: customers, customerRoute: customer, messageGroupRoute: messageGroup, dataOverviewRoute: overview,
} = await import(new URL('customer-routes.js', fns));
const { notificationSettingsSaveRoute: saveNotificationSettings, notificationsRoute: notifications } =
  await import(new URL('notification-routes.js', fns));
const { getRepository } = await import(new URL('api/src/data/index.js', dist));
const { refreshSellerStats } = await import(new URL('api/src/seller-stats.js', dist));
const eta = await import(new URL('shared/delivery-eta.js', dist));
const cust = await import(new URL('shared/customers.js', dist));
const data = await import(new URL('shared/seller-data.js', dist));
const { DEMO_EMAIL, DEMO_PASSWORD, PACKER_EMAIL } = fixtures;

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

let seq = 0;
const newPerson = async (name) => {
  seq += 1;
  const made = await signup(req({
    body: { acceptTerms: true, displayName: name, email: `data${seq}@figmark.example`, phone: `+91900007${String(1000 + seq).slice(-4)}`, password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return { id: made.jsonBody.user.id, headers: { authorization: `Bearer ${made.jsonBody.token}` } };
};

const session = await login(req({ body: { identifier: DEMO_EMAIL, password: DEMO_PASSWORD } }), ctx);
const shop = { id: session.jsonBody.user.id, headers: { authorization: `Bearer ${session.jsonBody.token}` } };
const repository = await getRepository();
const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

/* ── Delivery time rules ───────────────────────────────────────────────── */
console.log('delivery time rules');

await check('a delivery time must be whole days, at least one, the longest no shorter than the quickest', () => {
  assert.equal(eta.etaProblem({ minDays: 45, maxDays: 50 }), null);
  assert.equal(eta.etaProblem({ minDays: 7, maxDays: 7 }), null);
  assert.match(eta.etaProblem(null), /how many days/);
  assert.match(eta.etaProblem({ minDays: 0, maxDays: 5 }), /at least 1/);
  assert.match(eta.etaProblem({ minDays: 10, maxDays: 5 }), /cannot be shorter/);
  assert.match(eta.etaProblem({ minDays: 1.5, maxDays: 5 }), /whole numbers/);
  assert.match(eta.etaProblem({ minDays: 1, maxDays: 400 }), /under 365/);
  assert.equal(eta.etaLabel({ minDays: 45, maxDays: 50 }), '45–50 days');
  assert.equal(eta.etaLabel({ minDays: 7, maxDays: 7 }), '7 days');
});

await check('an order is on time up to a day past its longest promised day, and late after; unarrived and past it is overdue', () => {
  const placed = ago(60);
  const base = { placedAt: placed, createdAt: placed, status: 'delivered', deliveryEta: { minDays: 40, maxDays: 50 } };
  const arrived = (days) => ({ ...base, completedAt: new Date(Date.parse(placed) + days * DAY).toISOString(), checkpoints: {} });
  assert.equal(eta.punctuality(arrived(45)), 'on_time');
  assert.equal(eta.punctuality(arrived(50.9)), 'on_time', 'the grace day');
  assert.equal(eta.punctuality(arrived(52)), 'late');
  assert.equal(eta.punctuality({ ...base, status: 'shipped', completedAt: null }), 'overdue');
  assert.equal(eta.punctuality({ ...base, placedAt: ago(10), createdAt: ago(10), status: 'shipped', completedAt: null }), 'pending');
  assert.equal(eta.punctuality({ ...base, status: 'cancelled', completedAt: null }), 'none', 'a cancelled order is not measured');
  assert.equal(eta.punctuality({ ...base, deliveryEta: null }), 'none', 'an order without a promise is not measured');
  assert.equal(eta.punctuality({ ...base, placedAt: null }), 'none', 'a checkout is not an order');
});

await check('the on-time rate needs five measured orders, and counts overdue ones as late', () => {
  const order = (placedAgo, took) => ({
    placedAt: ago(placedAgo), createdAt: ago(placedAgo), status: took == null ? 'shipped' : 'delivered',
    deliveryEta: { minDays: 5, maxDays: 10 },
    completedAt: took == null ? null : new Date(Date.now() - (placedAgo - took) * DAY).toISOString(),
  });
  const four = [order(30, 6), order(30, 8), order(30, 9), order(30, 15)];
  assert.equal(eta.onTimeStats(four).rate, null, 'four is too few');
  const stats = eta.onTimeStats([...four, order(30, null), order(3, null)]);
  assert.equal(stats.measured, 5);
  assert.equal(stats.onTime, 3);
  assert.equal(stats.late, 1);
  assert.equal(stats.overdue, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.rate, 0.6);
  assert.equal(eta.onTimeStats([order(200, 6), order(200, 6), order(200, 6), order(200, 6), order(200, 6)]).rate, null, 'older than 90 days does not count');
});

/* ── Listing with a delivery time ──────────────────────────────────────── */
console.log('\nlisting with a delivery time');

let listing;
await check('a listing without a delivery time is refused, and says why', async () => {
  const refused = await createListing(req({ headers: shop.headers, body: { title: 'No promise', priceMinor: 50_000 } }), ctx);
  assert.equal(refused.status, 400);
  assert.equal(refused.jsonBody.error, 'invalid_eta');
  const backwards = await createListing(req({ headers: shop.headers, body: { title: 'Backwards', priceMinor: 50_000, deliveryEta: { minDays: 20, maxDays: 10 } } }), ctx);
  assert.equal(backwards.status, 400);
  assert.equal(backwards.jsonBody.error, 'invalid_eta');
});

await check('a listing keeps its delivery time, buyers read it, and an edit can change it but not remove it', async () => {
  const made = await createListing(req({
    headers: shop.headers,
    body: { title: 'Promised figure', priceMinor: 60_000, quantityAvailable: 20, category: 'Figures', tags: ['figure', 'gogeta'], deliveryEta: { minDays: 45, maxDays: 50 } },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  listing = made.jsonBody.listing;
  assert.deepEqual(listing.deliveryEta, { minDays: 45, maxDays: 50 });
  const read = await listingDetail(req({ params: { id: listing.id } }), ctx);
  assert.deepEqual(read.jsonBody.listing.deliveryEta, { minDays: 45, maxDays: 50 });
  const changed = await editListing(req({ headers: shop.headers, params: { id: listing.id }, body: { deliveryEta: { minDays: 30, maxDays: 35 } } }), ctx);
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.jsonBody.listing.deliveryEta, { minDays: 30, maxDays: 35 });
  const removed = await editListing(req({ headers: shop.headers, params: { id: listing.id }, body: { deliveryEta: null } }), ctx);
  assert.equal(removed.status, 400);
  assert.equal(removed.jsonBody.error, 'invalid_eta');
});

await check('a scheduled sale item needs a delivery time too', async () => {
  const sale = (items) => schedulePowerSale(req({ headers: shop.headers, body: { openingBody: 'Sale on!', items } }), ctx);
  const refused = await sale([{ title: 'No promise', priceMinor: 10_000 }]);
  assert.equal(refused.status, 400);
  assert.equal(refused.jsonBody.error, 'invalid_eta');
  const fine = await sale([{ title: 'Promised', priceMinor: 10_000, deliveryEta: { minDays: 3, maxDays: 5 } }]);
  assert.equal(fine.status, 201, JSON.stringify(fine.jsonBody));
});

let buyer;
let booked;
await check('an order keeps the delivery time promised when it was placed, whatever the listing says later', async () => {
  buyer = await newPerson('Promise Priya');
  const opened = await openCheckout(req({ headers: buyer.headers, body: { listingId: listing.id, quantity: 1 } }), ctx);
  assert.equal(opened.status, 201, JSON.stringify(opened.jsonBody));
  const placed = await bookOrder(req({ headers: buyer.headers, params: { id: opened.jsonBody.order.id }, body: {} }), ctx);
  assert.equal(placed.status, 200, JSON.stringify(placed.jsonBody));
  booked = await repository.getOrder(opened.jsonBody.order.id);
  assert.deepEqual(booked.deliveryEta, { minDays: 30, maxDays: 35 });
  await editListing(req({ headers: shop.headers, params: { id: listing.id }, body: { deliveryEta: { minDays: 60, maxDays: 70 } } }), ctx);
  assert.deepEqual((await repository.getOrder(booked.id)).deliveryEta, { minDays: 30, maxDays: 35 }, 'editing the item does not move it');
});

/* ── The shop's on-time rate ───────────────────────────────────────────── */
console.log('\non-time rate');

await check('the seller card shows the on-time and repeat-buyer rates worked out from the orders', async () => {
  await refreshSellerStats(repository, shop.id);
  const card = (await listingDetail(req({ params: { id: listing.id } }), ctx)).jsonBody.seller;
  assert.equal(typeof card.onTimeDispatchRate, 'number', 'the demo shop has enough deliveries to have a rate');
  assert.ok(card.onTimeMeasured >= 5);
  assert.ok(card.onTimeDispatchRate > 0.5 && card.onTimeDispatchRate < 1, `a mostly on-time record: ${card.onTimeDispatchRate}`);
  assert.equal(typeof card.repeatCustomerRate, 'number');
  const stored = await repository.getUserById(shop.id);
  assert.ok(stored.sellerTrust.computedAt, 'the count is stored with when it was made');
});

await check('an order arriving after its promise brings the rate down, without anybody typing a number', async () => {
  const before = (await repository.getUserById(shop.id)).sellerTrust.onTimeDispatchRate;
  const late = await repository.getOrder(booked.id);
  // Placed sixty days ago with a 30-35 day promise, delivered today.
  await repository.updateOrder({ ...late, placedAt: ago(60), createdAt: ago(60), status: 'delivered', completedAt: new Date().toISOString(), checkpoints: { delivered: new Date().toISOString() } });
  await refreshSellerStats(repository, shop.id);
  const after = (await repository.getUserById(shop.id)).sellerTrust.onTimeDispatchRate;
  assert.ok(after < before, `${after} < ${before}`);
});

/* ── Views and searches ────────────────────────────────────────────────── */
console.log('\nviews and searches');

await check('a view is counted under where it came from, for today, and the log never leaves the server', async () => {
  const viewer = await newPerson('Viewer Vik');
  const today = data.dayKey();
  const before = (await repository.getListing(listing.id)).viewLog?.[today]?.search ?? 0;
  const read = await listingDetail(req({ headers: viewer.headers, params: { id: listing.id }, query: { from: 'search' } }), ctx);
  assert.equal(read.jsonBody.listing.viewLog, undefined, 'the view log is not sent');
  await listingDetail(req({ headers: viewer.headers, params: { id: listing.id }, query: { from: 'not-a-place' } }), ctx);
  const log = (await repository.getListing(listing.id)).viewLog[today];
  assert.equal(log.search, before + 1);
  assert.ok(log.other >= 1, 'an unknown place counts as elsewhere');
  await listingDetail(req({ headers: shop.headers, params: { id: listing.id }, query: { from: 'feed' } }), ctx);
  assert.equal((await repository.getListing(listing.id)).viewLog[today].feed ?? 0, 0, "the shop's own visits do not count");
});

await check('catalog searches are counted by term, with how often they found nothing', async () => {
  await feed(req({ query: { q: 'Gogeta' } }), ctx);
  await feed(req({ query: { q: 'gogeta ' } }), ctx);
  await feed(req({ query: { q: 'zzqx unobtainium' } }), ctx);
  await feed(req({ query: { q: 'gogeta', limit: '48' } }), ctx);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const month = (await repository.getSiteContent(data.searchMonthId())).data.terms;
  assert.equal(month.gogeta.n, 2, 'one term however it is typed; "show more" is not a second search');
  assert.equal(month['zzqx unobtainium'].empty, 1);
  assert.equal(data.searchTerm('  A '), null, 'one letter is not a search');
});

/* ── Customers ─────────────────────────────────────────────────────────── */
console.log('\ncustomers');

await check('the customer list names everybody who ordered, with spend, group, source and record - never the shop itself', async () => {
  const read = await customers(req({ headers: shop.headers }), ctx);
  assert.equal(read.status, 200, JSON.stringify(read.jsonBody));
  const { summary, customers: rows, pro } = read.jsonBody;
  assert.ok(rows.length >= 5);
  assert.ok(!rows.some((row) => row.id === shop.id));
  const avradeep = rows.find((row) => row.id === 'usr_b_avradeep');
  assert.ok(avradeep, 'a repeat buyer from the history is listed');
  assert.ok(avradeep.orders >= 4);
  assert.ok(['vip', 'regular', 'at_risk'].includes(avradeep.label));
  assert.ok(cust.ORDER_SOURCES.includes(avradeep.firstSource));
  assert.ok(avradeep.reliability.word);
  assert.ok(summary.customers >= 5 && summary.repeatRate > 0);
  assert.ok(Array.isArray(pro.path) && pro.path[0].step === 'saved');
  assert.ok(pro.sources.length > 0);
  assert.ok(pro.benchmark.shops >= 1);
});

await check('a customer page shows their orders, saves and record here, and only to the shop', async () => {
  const read = await customer(req({ headers: shop.headers, params: { buyerId: 'usr_b_avradeep' } }), ctx);
  assert.equal(read.status, 200, JSON.stringify(read.jsonBody));
  assert.ok(read.jsonBody.history.length >= 4);
  assert.ok(read.jsonBody.history.some((row) => row.punctuality === 'on_time'));
  assert.ok(read.jsonBody.interest.topics.length > 0);
  const stranger = await newPerson('Stranger Sam');
  assert.equal((await customer(req({ headers: shop.headers, params: { buyerId: stranger.id } }), ctx)).status, 404, 'somebody who did nothing here is not a customer');
  const other = await newPerson('Other Shop Olu');
  const refused = await customers(req({ headers: other.headers, query: { store: shop.id } }), ctx);
  assert.equal(refused.status, 403, 'another account cannot read this shop');
});

await check('saving or following makes somebody reachable before they ever order', async () => {
  const saver = await newPerson('Saver Sita');
  await toggleLike(req({ headers: saver.headers, params: { id: listing.id } }), ctx);
  await toggleFollow(req({ headers: saver.headers, params: { id: shop.id } }), ctx);
  const page = await customer(req({ headers: shop.headers, params: { buyerId: saver.id } }), ctx);
  assert.equal(page.status, 200);
  assert.equal(page.jsonBody.saves.length, 1);
  assert.equal(page.jsonBody.follows, true);
  const list = (await customers(req({ headers: shop.headers }), ctx)).jsonBody;
  assert.ok(list.pro.signals.saved.some((row) => row.id === saver.id), 'saved and not bought is a signal');
});

/* ── Group messages ────────────────────────────────────────────────────── */
console.log('\ngroup messages');

await check('a shop can message a group of its customers, once a day each, never people who turned it off or strangers', async () => {
  const keen = await newPerson('Keen Kavya');
  const quiet = await newPerson('Quiet Qasim');
  const stranger = await newPerson('Nobody Nia');
  for (const person of [keen, quiet]) await toggleFollow(req({ headers: person.headers, params: { id: shop.id } }), ctx);
  await saveNotificationSettings(req({ headers: quiet.headers, body: { shopMessagesOff: true } }), ctx);

  const sent = await messageGroup(req({ headers: shop.headers, body: { buyerIds: [keen.id, quiet.id, stranger.id], text: 'New drop for our regulars tonight!' } }), ctx);
  assert.equal(sent.status, 200, JSON.stringify(sent.jsonBody));
  assert.equal(sent.jsonBody.sent, 1);
  assert.equal(sent.jsonBody.optedOut, 1);
  assert.equal(sent.jsonBody.skipped, 1, 'a stranger is not reached');
  const bell = (await notifications(req({ headers: keen.headers }), ctx)).jsonBody;
  const list = bell.notifications ?? bell.items ?? [];
  assert.ok(list.some((row) => row.kind === 'shop_message' && row.body.includes('New drop')), JSON.stringify(bell).slice(0, 300));

  const again = await messageGroup(req({ headers: shop.headers, body: { buyerIds: [keen.id], text: 'And another thing' } }), ctx);
  assert.equal(again.jsonBody.sent, 0);
  assert.equal(again.jsonBody.recent, 1, 'one a day to the same person');
  const third = await messageGroup(req({ headers: shop.headers, body: { buyerIds: [keen.id], text: 'Third' } }), ctx);
  assert.equal(third.status, 200);
  const fourth = await messageGroup(req({ headers: shop.headers, body: { buyerIds: [keen.id], text: 'Fourth' } }), ctx);
  assert.equal(fourth.status, 429, 'three group messages a day');

  const tooMany = await messageGroup(req({ headers: shop.headers, body: { buyerIds: Array.from({ length: 101 }, (_, n) => `usr_${n}`), text: 'Hi all' } }), ctx);
  assert.equal(tooMany.status, 400);
  const helper = await login(req({ body: { identifier: PACKER_EMAIL, password: DEMO_PASSWORD } }), ctx);
  const notStaff = await messageGroup(req({ headers: { authorization: `Bearer ${helper.jsonBody.token}` }, query: { store: shop.id }, body: { buyerIds: [keen.id], text: 'Hi' } }), ctx);
  assert.equal(notStaff.status, 403, 'somebody without the analytics right cannot message the shop\'s customers');
});

/* ── The Data overview ─────────────────────────────────────────────────── */
console.log('\ndata overview');

await check('the overview compares the period with the one before, and lists late and overdue orders', async () => {
  const read = await overview(req({ headers: shop.headers, query: { days: '30' } }), ctx);
  assert.equal(read.status, 200, JSON.stringify(read.jsonBody));
  const body = read.jsonBody;
  assert.equal(body.days, 30);
  assert.equal(body.views.daily.length, 30);
  assert.ok(body.current.views > 0, 'the demo shop has views this month');
  assert.ok(body.views.bySource.length > 0);
  assert.ok(body.onTime.lateOrders.some((row) => row.state === 'overdue'), 'a parcel past its promise is on the list');
  assert.equal(typeof body.onTime.late, 'number', 'the count of late orders stays a number');
  assert.ok(body.onTime.measured >= 5);
  assert.ok('bookingHours' in body.reply);
  assert.ok(body.searches.unmet.some((row) => row.term === 'zzqx unobtainium'));
  assert.ok(body.searches.matching.some((row) => row.term === 'gogeta'), 'a search for what the shop sells is shown to it');
  assert.equal((await overview(req({ headers: shop.headers, query: { days: '7' } }), ctx)).jsonBody.views.daily.length, 7);
});

console.log(`\n${passed} checks passed`);
