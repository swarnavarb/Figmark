/**
 * Smoke test for the seller conveniences: usual days learned from past lots,
 * a lot's costs split into landed cost and margin, the shop's held and
 * released money, the public tracking link, and the WhatsApp update body.
 *
 * Pure rules first, then the compiled handlers against the fixture world.
 * Run `npm run build:api && npm run build:fixtures` first.
 */
import assert from 'node:assert/strict';
import { fixtures, useFixtures } from './fixtures.mjs';

process.env.FIGMARK_RATE_LIMITS = 'off';
await useFixtures();

const dist = new URL('../api/dist/', import.meta.url);
const fns = new URL('api/src/functions/', dist);
const { loginRoute: login, signupRoute: rawSignup } = await import(new URL('auth-routes.js', fns));
const { verifiedSignup } = await import('./verified-signup.mjs');
const signup = verifiedSignup(rawSignup);
const { payoutsRoute: payouts, sellDashboardRoute: sellDashboard } = await import(new URL('seller-routes.js', fns));
const desk = await import(new URL('seller-desk-routes.js', fns));
const { myListingsRoute: myListings } = await import(new URL('catalog-routes.js', fns));
const { listTemplatesRoute: listTemplates } = await import(new URL('template-routes.js', fns));
const track = await import(new URL('public-track-routes.js', fns));
const { getRepository } = await import(new URL('api/src/data/index.js', dist));
const routes = await import(new URL('shared/routes.js', dist));
const costs = await import(new URL('shared/lot-costs.js', dist));
const stepDays = await import(new URL('shared/step-days.js', dist));
const money = await import(new URL('shared/payouts.js', dist));
const wa = await import(new URL('api/src/whatsapp-updates.js', dist));

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
const DAY = 86_400_000;
const at = (day) => new Date(Date.UTC(2026, 0, 1) + day * DAY).toISOString();

console.log('usual days from past lots');

await check('each step takes the middle of its real times, rounded up, by name whatever the case', () => {
  const lot = (steps) => ({ stageHistory: steps.map(([step, day]) => ({ step, enteredAt: at(day), kind: 'step' })) });
  const learned = routes.learnedStepDays([
    lot([['Customs', 0], ['Out for delivery', 3]]),
    lot([['customs ', 0], ['Out for delivery', 5]]),
    lot([['Customs', 0], ['Out for delivery', 30]]),
  ]);
  assert.deepEqual(learned.customs, { days: 5, lots: 3 }, 'one stuck lot does not drag the estimate');
  assert.equal(learned['out for delivery'], undefined, 'a step nothing moved off has no time yet');
});

await check('a note, or a move still inside its undo window, is not history', () => {
  const learned = routes.learnedStepDays([{ stageHistory: [
    { step: 'Packed', enteredAt: at(0), kind: 'step' },
    { step: 'Packed', enteredAt: at(1), kind: 'note' },
    { step: 'Shipped', enteredAt: at(2), kind: 'step', undoUntil: new Date(Date.now() + 60_000).toISOString() },
  ] }]);
  assert.deepEqual(learned, {});
});

console.log('step times the system works out');

await check('a step reads as a range, never one number, and a stuck lot is left out', () => {
  const lot = (steps) => ({ stageHistory: steps.map(([step, day]) => ({ step, enteredAt: at(day), kind: 'step' })) });
  const spans = stepDays.stepSpans([
    lot([['Customs', 0], ['Landed', 3]]).stageHistory,
    lot([['Customs', 0], ['Landed', 4]]).stageHistory,
    lot([['Customs', 0], ['Landed', 5]]).stageHistory,
    lot([['customs', 0], ['Landed', 4]]).stageHistory,
    lot([['Customs', 0], ['Landed', 40]]).stageHistory,
  ]);
  const range = stepDays.rangeOf(spans.get('customs'), 'yours');
  assert.equal(range.samples, 4, 'the forty-day lot is a delay, not what customs takes');
  assert.ok(range.high <= 5 && range.low >= 3 && range.low < range.high, JSON.stringify(range));
  assert.equal(stepDays.dayRangeLabel({ low: 3, high: 5 }), '3–5 days');
  assert.deepEqual(stepDays.rangeOf([2.2], 'yours'), { low: 2, high: 3, source: 'yours', samples: 1 }, 'one time still reads as two numbers');
});

await check('the shop\'s own times win; with too few of its own, the market\'s are used and say so', () => {
  assert.equal(stepDays.pickRange([3, 4, 5], [10, 11]).source, 'yours');
  assert.equal(stepDays.pickRange([3], [10, 11, 12]).source, 'market');
  assert.equal(stepDays.pickRange([], [10, 11]).source, 'market');
  assert.equal(stepDays.pickRange(undefined, undefined), null);
});

await check('the days left add up every step still to come, or say nothing', () => {
  const ranges = { a: { low: 2, high: 3, source: 'yours' }, b: { low: 5, high: 8, source: 'market' } };
  const steps = [{ name: 'A' }, { name: 'B' }, { name: 'Delivered' }];
  assert.deepEqual(stepDays.daysLeftRange(steps, 0, ranges), { low: 7, high: 11, source: 'market' });
  assert.equal(stepDays.daysLeftRange([{ name: 'A' }, { name: 'C' }, { name: 'D' }], 0, ranges), null, 'an unmeasured step leaves no total');
});

await check('a whole delivery is counted from order to the buyer\'s hands, in-hand and import apart', () => {
  const spans = stepDays.deliverySpans([
    { lotId: 'direct', createdAt: at(0), placedAt: at(0), status: 'delivered', checkpoints: { delivered: at(4) } },
    { lotId: 'lot_1', createdAt: at(0), placedAt: at(0), status: 'delivered', checkpoints: { delivered: at(40) } },
    { lotId: 'lot_1', createdAt: at(0), placedAt: at(0), status: 'in_fulfilment', checkpoints: {} },
  ]);
  assert.deepEqual(spans.in_hand, [4]);
  assert.deepEqual(spans.import, [40]);
});

console.log('button words');

await check('a long step name becomes a short button in its own words', () => {
  const vars = { origin: 'China', destination: 'India' };
  const label = (name) => routes.stepButtonLabel({ name, custom: true }, vars);
  assert.equal(label('Seller Purchases & Ships to Freight Forwarder'), 'Ships to forwarder');
  assert.equal(label('Out for delivery: Handed to the courier in {dest}'), 'Out for delivery');
  assert.equal(label('Freight Forwarder Consolidates'), 'Forwarder Consolidates');
  assert.equal(label('Dispatched to Freight Forwarder'), 'Dispatched to forwarder');
  for (const name of ['Supplier Accumulates Orders', 'A very long step name that nobody would ever fit on a button']) {
    assert.ok(label(name).length <= routes.BUTTON_TEXT_HARD_MAX, label(name));
    assert.ok(!/…$|\s(to|the|at)$/i.test(label(name)), label(name));
  }
  assert.equal(label('Packed'), 'Packed', 'a short name is left alone');
});

console.log('lot costs');

const line = (id, revenue, weight, unitCost = null, quantity = 1) => ({
  orderId: id, itemName: id, buyerName: 'B', quantity, revenueMinor: revenue, unitWeightGrams: weight, unitCostMinor: unitCost,
});

await check('shares add back up to the costs typed, to the paisa', () => {
  const out = costs.splitLotCosts({ freightMinor: 1000, customsDutyMinor: 1, splitBy: 'value' }, [line('a', 100, 0), line('b', 100, 0), line('c', 100, 0)]);
  assert.equal(out.sharedMinor, 1001);
  assert.equal(out.rows.reduce((sum, row) => sum + row.shareMinor, 0), 1001);
});

await check('by weight when every item has one, by price otherwise, and the own cost counts per unit', () => {
  const byWeight = costs.splitLotCosts({ freightMinor: 900, splitBy: 'weight' }, [line('a', 1000, 100, 200, 2), line('b', 1000, 100)]);
  assert.equal(byWeight.split, 'weight');
  assert.deepEqual(byWeight.rows.map((row) => row.shareMinor), [600, 300]);
  assert.equal(byWeight.rows[0].landedMinor, 600 + 400);
  assert.equal(byWeight.rows[0].marginMinor, 0);
  assert.equal(byWeight.totals.unknownCost, 1);
  const fallback = costs.splitLotCosts({ freightMinor: 900, splitBy: 'weight' }, [line('a', 2000, 100), line('b', 1000, 0)]);
  assert.equal(fallback.split, 'value');
  assert.deepEqual(fallback.rows.map((row) => row.shareMinor), [600, 300]);
});

await check('costs from the browser are whole, non-negative paise or refused', () => {
  const clean = costs.cleanLotCosts({ freightMinor: 1234.4, splitBy: 'units' }, at(0));
  assert.equal(clean.freightMinor, 1234);
  assert.equal(clean.customsDutyMinor, 0);
  assert.equal(clean.splitBy, 'units');
  assert.equal(costs.cleanLotCosts({ freightMinor: -1 }, at(0)), null);
  assert.equal(costs.cleanLotCosts('nope', at(0)), null);
});

console.log('the shop\'s money');

const order = (id, hold, extra = {}) => ({
  id, itemName: id, buyerId: 'u1', currency: 'INR', status: 'shipped', createdAt: at(100), paymentStatus: 'paid',
  unitPriceMinor: 1000, quantity: 1, hold: { state: 'none', amountMinor: 0, heldAt: null, releasedAt: null, autoReleaseAt: null, disputeId: null, ...hold }, ...extra,
});

await check('held money is grouped by the day it releases, undated last; released counts only inside the window', () => {
  const out = money.payoutsOf([
    order('h1', { state: 'held', amountMinor: 500, autoReleaseAt: at(110) }),
    order('h2', { state: 'held', amountMinor: 300, autoReleaseAt: at(110) }),
    order('h3', { state: 'held', amountMinor: 200 }),
    order('r1', { state: 'released', amountMinor: 700, releasedAt: at(105) }),
    order('r0', { state: 'released', amountMinor: 999, releasedAt: at(50) }),
    order('d1', { state: 'disputed', amountMinor: 400 }),
    order('direct', {}),
  ], at(90));
  assert.equal(out.heldMinor, 1000);
  assert.deepEqual(out.upcoming.map((slot) => [slot.date, slot.amountMinor, slot.orders]), [[at(110).slice(0, 10), 800, 2], [null, 200, 1]]);
  assert.equal(out.releasedMinor, 700);
  assert.equal(out.disputedMinor, 400);
  assert.equal(out.directMinor, 1000, 'paid straight to the shop, never held');
});

const session = await login(req({ body: { identifier: fixtures.DEMO_EMAIL, password: fixtures.DEMO_PASSWORD } }), ctx);
const shop = { id: session.jsonBody.user.id, headers: { authorization: `Bearer ${session.jsonBody.token}` } };
const repository = await getRepository();

await check('the shop reads its own money; anybody else is refused', async () => {
  const mine = await payouts(req({ headers: shop.headers, query: { days: '30' } }), ctx);
  assert.equal(mine.status, 200, JSON.stringify(mine.jsonBody));
  assert.equal(typeof mine.jsonBody.heldMinor, 'number');
  assert.ok(Array.isArray(mine.jsonBody.upcoming));
  const strangers = await payouts(req({ headers: shop.headers, query: { store: 'usr_nobody' } }), ctx);
  assert.equal(strangers.status, 403);
});

console.log('public tracking');

await check('a tracking token round-trips, and an edited one does not verify', () => {
  const token = track.trackToken('ord_abc123');
  assert.equal(track.orderOfTrackToken(token), 'ord_abc123');
  assert.equal(track.orderOfTrackToken(`${token.slice(0, -1)}x`), null);
  assert.equal(track.orderOfTrackToken(token.replace(/^[^.]+/, Buffer.from('ord_other').toString('base64url'))), null);
  assert.equal(track.orderOfTrackToken('garbage'), null);
});

await check('the shop gets a link for its order, and the page shows the journey with nothing personal', async () => {
  const orders = await repository.listOrdersForSeller(shop.id);
  assert.ok(orders.length > 0, 'the fixture shop has orders');
  const made = await track.makeTrackLinkRoute(req({ headers: shop.headers, params: { id: orders[0].id } }), ctx);
  assert.equal(made.status, 200, JSON.stringify(made.jsonBody));
  assert.match(made.jsonBody.path, /^\/track\//);
  const shown = await track.publicTrackingRoute(req({ params: { token: made.jsonBody.token } }), ctx);
  assert.equal(shown.status, 200, JSON.stringify(shown.jsonBody));
  assert.ok(shown.jsonBody.steps.length > 0);
  const text = JSON.stringify(shown.jsonBody);
  for (const secret of ['buyerId', 'priceMinor', 'address', 'phone', 'email']) assert.ok(!text.includes(secret), `no ${secret} on the public page`);
  const bad = await track.publicTrackingRoute(req({ params: { token: 'x.y' } }), ctx);
  assert.equal(bad.status, 404);
});

await check('somebody who is not the buyer or shop cannot make a link', async () => {
  const made = await signup(req({
    body: { acceptTerms: true, displayName: 'Stranger', email: 'stranger.track@figmark.example', phone: '+919000071234', password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const [first] = await repository.listOrdersForSeller(shop.id);
  const refused = await track.makeTrackLinkRoute(req({ headers: { authorization: `Bearer ${made.jsonBody.token}` }, params: { id: first.id } }), ctx);
  assert.equal(refused.status, 403);
});

console.log('whatsapp updates');

await check('the update is the approved template with the title and an absolute link, and is off without keys', () => {
  const body = wa.whatsappUpdateBody('+91 98765 43210', { title: 'Your item from Shop: Customs cleared', link: '/order/o1' }, 'lot_update', 'en', 'https://example.test');
  assert.equal(body.to, '919876543210');
  assert.equal(body.template.name, 'lot_update');
  assert.deepEqual(body.template.components[0].parameters.map((p) => p.text), ['Your item from Shop: Customs cleared', 'https://example.test/order/o1']);
  assert.equal(wa.whatsappUpdatesEnabled(), false, 'nothing configured here, so nothing is sent');
});

console.log('the seller\'s desk');

const strangerLogin = await login(req({ body: { identifier: 'stranger.track@figmark.example', password: 'longenough1' } }), ctx);
const stranger = { id: strangerLogin.jsonBody.user.id, headers: { authorization: `Bearer ${strangerLogin.jsonBody.token}` } };

await check('a draft is kept with the shop, counted on the dashboard, read back whole, and gone once deleted', async () => {
  const before = (await sellDashboard(req({ headers: shop.headers }), ctx)).jsonBody.listings.drafts;
  const form = { title: '  Half a listing ', price: '1450', category: 'Figures', photos: [{ url: '/api/photos/a.jpg', isPrimary: true }] };
  const saved = await desk.saveDraftRoute(req({ headers: shop.headers, body: { form } }), ctx);
  assert.equal(saved.status, 200, JSON.stringify(saved.jsonBody));
  const card = saved.jsonBody.draft;
  assert.equal(card.title, 'Half a listing');
  assert.equal(card.priceMinor, 145000);
  assert.equal(card.photoUrl, '/api/photos/a.jpg');
  assert.equal(card.form, undefined, 'the shelf card does not carry the form');
  assert.equal((await sellDashboard(req({ headers: shop.headers }), ctx)).jsonBody.listings.drafts, before + 1);
  // Saving again with its id corrects it rather than making a second.
  await desk.saveDraftRoute(req({ headers: shop.headers, body: { id: card.id, form: { ...form, title: 'Renamed' } } }), ctx);
  const list = (await desk.listDraftsRoute(req({ headers: shop.headers }), ctx)).jsonBody.drafts;
  assert.equal(list.filter((entry) => entry.id === card.id).length, 1);
  assert.equal(list.find((entry) => entry.id === card.id).title, 'Renamed');
  const whole = (await desk.listDraftsRoute(req({ headers: shop.headers, query: { id: card.id } }), ctx)).jsonBody.draft;
  assert.equal(whole.form.title, 'Renamed');
  // A draft is not a quick fill, though they are kept side by side.
  const templates = (await listTemplates(req({ headers: shop.headers }), ctx)).jsonBody.templates;
  assert.ok(!templates.some((entry) => entry.id === card.id));
  // Not somebody else's to read or write.
  const peek = await desk.listDraftsRoute(req({ headers: stranger.headers, query: { store: shop.id } }), ctx);
  assert.equal(peek.status, 403);
  await desk.deleteDraftRoute(req({ headers: shop.headers, params: { id: card.id } }), ctx);
  assert.equal((await sellDashboard(req({ headers: shop.headers }), ctx)).jsonBody.listings.drafts, before);
});

await check('a shop\'s listings are read by store, and only by somebody with the listings right there', async () => {
  const own = (await myListings(req({ headers: shop.headers }), ctx)).jsonBody.listings;
  assert.ok(own.length > 0);
  const refused = await myListings(req({ headers: stranger.headers, query: { store: shop.id } }), ctx);
  assert.equal(refused.status, 403);
  // Given the right, a manager reads the shop's shelf - not their own empty one.
  const owner = await repository.getUserById(shop.id);
  const managers = owner.sellerProfile.managers ?? [];
  await repository.updateUser({ ...owner, sellerProfile: { ...owner.sellerProfile, managers: [...managers, { userId: stranger.id, permissions: ['listings'], addedAt: new Date().toISOString() }] } });
  const managed = await myListings(req({ headers: stranger.headers, query: { store: shop.id } }), ctx);
  assert.equal(managed.status, 200, JSON.stringify(managed.jsonBody));
  assert.deepEqual(managed.jsonBody.listings.map((row) => row.id).sort(), own.map((row) => row.id).sort());
  const again = await repository.getUserById(shop.id);
  await repository.updateUser({ ...again, sellerProfile: { ...again.sellerProfile, managers } });
});

await check('several listings change in one request, each by the single edit\'s own rules', async () => {
  const [first, second] = (await myListings(req({ headers: shop.headers }), ctx)).jsonBody.listings.filter((row) => row.status === 'active' && !row.privateFor);
  const answer = await desk.batchListingsRoute(req({ headers: shop.headers, body: { items: [
    { id: first.id, edit: { priceMinor: first.priceMinor + 100 } },
    { id: second.id, edit: { priceMinor: 1 } },
    { id: 'lst_not_there', expire: true },
  ] } }), ctx);
  assert.equal(answer.status, 200, JSON.stringify(answer.jsonBody));
  assert.deepEqual(answer.jsonBody.results.map((row) => row.ok), [true, false, false]);
  assert.equal(answer.jsonBody.done, 1);
  assert.ok(answer.jsonBody.results[1].message, 'a refusal says why');
  assert.equal((await repository.getListing(first.id)).priceMinor, first.priceMinor + 100);
  assert.equal((await repository.getListing(second.id)).priceMinor, second.priceMinor, 'the refused one is untouched');
  await desk.batchListingsRoute(req({ headers: shop.headers, body: { items: [{ id: first.id, edit: { priceMinor: first.priceMinor } }] } }), ctx);
  const strangers = await desk.batchListingsRoute(req({ headers: stranger.headers, body: { items: [{ id: first.id, expire: true }] } }), ctx);
  assert.ok(strangers.status === 403 || strangers.jsonBody.results[0].ok === false, 'not by somebody outside the shop');
});

await check('several orders are answered in one request; one with nothing to accept is named, not fatal', async () => {
  const [order] = await repository.listOrdersForSeller(shop.id);
  const answer = await desk.answerOrdersRoute(req({ headers: shop.headers, body: { ids: [order.id, 'ord_not_there'], action: 'accept' } }), ctx);
  assert.equal(answer.status, 200, JSON.stringify(answer.jsonBody));
  assert.equal(answer.jsonBody.results.length, 2);
  assert.equal(answer.jsonBody.results[1].ok, false);
  const bad = await desk.answerOrdersRoute(req({ headers: shop.headers, body: { ids: [order.id], action: 'deny' } }), ctx);
  assert.equal(bad.status, 400);
});

console.log(`\n${passed} seller-ease checks passed`);
