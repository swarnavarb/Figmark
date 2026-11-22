/**
 * Smoke test for one photo of many things: sold separately (pieces, each with
 * its own price, ticked together at one checkout and crossed out once sold)
 * or all together (a lot, whose fee is per item on the larger of the
 * seller's count and Figmark's own).
 *
 * Calls the compiled route handlers directly, like smoke-api.mjs. Run
 * `npm run build:api && npm run build:fixtures` first.
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
const { createListingRoute: createListing, createOrderRoute: openCheckout, listingDetailRoute: listingDetail } = await import(new URL('catalog-routes.js', fns));
const { placeOrder } = await import(new URL('placement.js', fns));
const { orderFeeLine } = await import(new URL('api/src/billing.js', dist));
const { getRepository } = await import(new URL('api/src/data/index.js', dist));
const P = await import(new URL('shared/pieces.js', dist));
const B = await import(new URL('shared/billing.js', dist));
const { DEMO_EMAIL, DEMO_PASSWORD } = fixtures;

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
const req = ({ headers = {}, body, query = {}, params = {} } = {}) => ({
  headers: new Headers(headers), query: new URLSearchParams(query), params,
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
});
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`  ok  ${name}`); };

const terms = { kind: 'shop', feeBands: [{ upToMinor: 50_000, mode: 'flat', value: 1_000 }, { upToMinor: null, mode: 'percent', value: 300 }], discountBp: 0, gst: null, at: '' };

console.log('reading a sale post');
await check('a pasted sale post becomes names and prices, headings left out', () => {
  const post = [
    'Marvel legends lot starting from 1750', 'SALE POST',
    'MARVEL LEGENDS WOLVERINE CLASSIC YELLOW 1750',
    'Marvel legends wasp', '1850',
    'Marvel legends thing first appearance', '3000',
    'Marvel legends toybiz classic green goblin', '₹3,500/-',
    '1/6 Hot Toys Joker - 12k',
  ].join('\n');
  const lines = P.parsePriceList(post);
  assert.deepEqual(lines.map((line) => line.title), [
    'Marvel Legends Wolverine Classic Yellow', 'Marvel legends wasp', 'Marvel legends thing first appearance',
    'Marvel legends toybiz classic green goblin', '1/6 Hot Toys Joker',
  ]);
  assert.deepEqual(lines.map((line) => line.priceMinor), [175_000, 185_000, 300_000, 350_000, 12_00_000]);
});

console.log('the fee follows the number of things');
await check('pieces pay as if each sold alone', () => {
  // ₹300 + ₹400 under the flat band: ₹10 each, not ₹10 once on ₹700... and ₹1,000 at 3%.
  const fee = B.saleFee(terms, { amountMinor: 1_70_000, pieces: [{ priceMinor: 30_000 }, { priceMinor: 40_000 }, { priceMinor: 1_00_000 }] });
  assert.equal(fee.totalMinor, 1_000 + 1_000 + 3_000);
});
await check('a lot pays per item in it, the price shared out', () => {
  // ₹4,000 for 10: ₹400 each, ₹10 flat each = ₹100; as one sale it would be 3% = ₹120... and 1 item = 3%.
  assert.equal(B.saleFee(terms, { amountMinor: 4_00_000, units: 10 }).totalMinor, 10_000);
  assert.equal(B.saleFee(terms, { amountMinor: 4_00_000, units: 1 }).totalMinor, 12_000);
  // Shares in whole paise (333, 334, 334) add back up, and each is rounded on its own.
  assert.equal(B.saleFee({ ...terms, feeBands: [{ upToMinor: null, mode: 'percent', value: 1_000 }] }, { amountMinor: 1_001, units: 3 }).totalMinor, 33 * 3);
});
await check('saying fewer than the photo shows does not lower the count', () => {
  assert.equal(P.chargedUnits(3, 12), 12);
  assert.equal(P.chargedUnits(15, 12), 15);
  assert.equal(P.chargedUnits(4, 0), 4);
});
await check('pieces need a title, a price and a place; ids are made when missing', () => {
  const box = [0.1, 0.1, 0.2, 0.3];
  assert.ok('error' in P.cleanPieces([{ title: 'One', priceMinor: 10_000, boxes: [box] }]), 'one piece is not a group');
  assert.ok('error' in P.cleanPieces([{ title: 'A', priceMinor: 10_000, boxes: [box] }, { title: 'Bee', priceMinor: 10_000, boxes: [box] }]));
  assert.ok('error' in P.cleanPieces([{ title: 'Ant', priceMinor: 10_000, boxes: [] }, { title: 'Bee', priceMinor: 10_000, boxes: [box] }]));
  const ok = P.cleanPieces([{ title: 'Ant', priceMinor: 10_000, boxes: [box, [0.5, 0.5, 0.2, 0.2]] }, { title: 'Bee', priceMinor: 20_000, boxes: [box] }]);
  assert.equal(ok.pieces.length, 2);
  assert.equal(ok.pieces[0].boxes.length, 2, 'the same thing shown twice is one piece');
  assert.match(ok.pieces[0].id, /^pz_/);
});

const session = await login(req({ body: { identifier: DEMO_EMAIL, password: DEMO_PASSWORD } }), ctx);
const shop = { authorization: `Bearer ${session.jsonBody.token}` };
const made = await signup(req({ body: { acceptTerms: true, displayName: 'Piece Buyer', email: 'pieces1@figmark.example', phone: '+919000071001', password: 'longenough1' } }), ctx);
const buyer = { id: made.jsonBody.user.id, headers: { authorization: `Bearer ${made.jsonBody.token}` } };
const made2 = await signup(req({ body: { acceptTerms: true, displayName: 'Second Buyer', email: 'pieces2@figmark.example', phone: '+919000071002', password: 'longenough1' } }), ctx);
const other = { id: made2.jsonBody.user.id, headers: { authorization: `Bearer ${made2.jsonBody.token}` } };
const repository = await getRepository();

console.log('sold separately');
// Photos come from the shop's uploads; this listing is written straight to the store with pieces.
const base = (await createListing(req({ headers: shop, body: { title: 'Shelf base', priceMinor: 10_000, deliveryEta: { minDays: 3, maxDays: 5 }, advancePercent: 20 } }), ctx)).jsonBody.listing;
assert.ok(base, 'a plain listing is made');
const pieces = P.cleanPieces([
  { title: 'Wasp', priceMinor: 1_85_000, boxes: [[0.1, 0.1, 0.2, 0.3]] },
  { title: 'Thing', priceMinor: 3_00_000, boxes: [[0.4, 0.1, 0.2, 0.3]] },
  { title: 'Morbius', priceMinor: 2_50_000, boxes: [[0.7, 0.1, 0.2, 0.3], [0.7, 0.6, 0.2, 0.3]] },
]).pieces;
const lot = await repository.updateListing({ ...base, title: 'Marvel Legends shelf', pieces, priceMinor: 1_85_000, quantityAvailable: 3 });

await check('a listing with no photo cannot be sold separately', async () => {
  const refused = await createListing(req({ headers: shop, body: { title: 'No photo', priceMinor: 10_000, deliveryEta: { minDays: 3, maxDays: 5 }, pieces } }), ctx);
  assert.equal(refused.status, 400);
});

await check('Buy needs the pieces picked', async () => {
  const none = await openCheckout(req({ headers: buyer.headers, body: { listingId: lot.id } }), ctx);
  assert.equal(none.status, 400);
});

let first;
await check('two pieces checked out together: one order, priced as their sum', async () => {
  const opened = await openCheckout(req({ headers: buyer.headers, body: { listingId: lot.id, pieceIds: [pieces[0].id, pieces[2].id] } }), ctx);
  assert.equal(opened.status, 201, JSON.stringify(opened.jsonBody));
  first = opened.jsonBody.order;
  assert.equal(first.quantity, 1);
  assert.equal(first.unitPriceMinor, 1_85_000 + 2_50_000);
  assert.equal(first.pieces.length, 2);
  assert.equal(first.itemName, 'Wasp, Morbius');
  assert.equal(first.advancePercent, 20, 'the advance follows the listing, on the whole total');
});

await check('placing it crosses those pieces out, and the price moves to what is left', async () => {
  assert.equal(await placeOrder(repository, first, 'paid', buyer.id, { tellSeller: false }), null);
  const after = await repository.getListing(lot.id);
  assert.equal(after.quantityAvailable, 1);
  assert.equal(after.priceMinor, 3_00_000, 'from the cheapest piece still for sale');
  assert.ok(after.pieces.find((piece) => piece.id === pieces[0].id).soldAt);
  assert.equal(after.status, 'active');
});

await check('nobody else sees which order holds a piece', async () => {
  const seen = (await listingDetail(req({ headers: other.headers, params: { id: lot.id } }), ctx)).jsonBody.listing;
  const wasp = seen.pieces.find((piece) => piece.id === pieces[0].id);
  assert.ok(wasp.soldAt);
  assert.equal(wasp.soldOrderId, undefined);
});

await check('a sold piece cannot be bought again', async () => {
  const again = await openCheckout(req({ headers: other.headers, body: { listingId: lot.id, pieceIds: [pieces[0].id] } }), ctx);
  assert.equal(again.status, 409);
});

await check('two buyers at the same last piece: one gets it', async () => {
  const a = (await openCheckout(req({ headers: other.headers, body: { listingId: lot.id, pieceIds: [pieces[1].id] } }), ctx)).jsonBody.order;
  const b = (await openCheckout(req({ headers: buyer.headers, body: { listingId: lot.id, pieceIds: [pieces[1].id] } }), ctx)).jsonBody.order;
  assert.equal(await placeOrder(repository, a, 'paid', other.id, { tellSeller: false }), null);
  const refusal = await placeOrder(repository, b, 'paid', buyer.id, { tellSeller: false });
  assert.equal(refusal?.code, 'unavailable');
  const after = await repository.getListing(lot.id);
  assert.equal(after.status, 'sold_out');
  assert.equal(after.quantityAvailable, 0);
});

await check('the fee on the order is per piece', async () => {
  const placed = await repository.getOrder(first.id);
  placed.payments = [{ id: 'p1', kind: 'payment', amountMinor: placed.unitPriceMinor, method: 'upi', at: new Date().toISOString(), confirmedAt: new Date().toISOString() }];
  placed.paymentStatus = 'paid';
  const line = orderFeeLine(placed);
  const expected = B.saleFee(placed.feeTerms, { amountMinor: 0, pieces: placed.pieces }).totalMinor;
  assert.ok(line, 'a paid order owes a fee');
  assert.equal(line.totalMinor, expected);
  assert.match(line.label, /2 pieces/);
});

console.log('sold all together');
await check('a lot needs its count, and is charged on it', async () => {
  const nonsense = await createListing(req({ headers: shop, body: { title: 'Blind box lot', priceMinor: 4_00_000, deliveryEta: { minDays: 3, maxDays: 5 }, bundle: true, bundleItems: 0 } }), ctx);
  assert.equal(nonsense.status, 400, 'a count of nothing is refused');
  const older = await createListing(req({ headers: shop, body: { title: 'Blind box lot', priceMinor: 4_00_000, deliveryEta: { minDays: 3, maxDays: 5 }, bundle: true } }), ctx);
  assert.equal(older.status, 201, 'a client that sends no count still lists');
  assert.equal(older.jsonBody.listing.bundleCount.charged, 1);
  const madeLot = await createListing(req({ headers: shop, body: {
    title: 'Blind box lot', priceMinor: 4_00_000, deliveryEta: { minDays: 3, maxDays: 5 }, bundle: true, bundleItems: 4, bundleSeen: 10,
  } }), ctx);
  assert.equal(madeLot.status, 201, JSON.stringify(madeLot.jsonBody));
  const listing = madeLot.jsonBody.listing;
  assert.deepEqual(listing.bundleCount, { declared: 4, detected: 10, charged: 10 }, 'the larger count is charged');
  const opened = (await openCheckout(req({ headers: buyer.headers, body: { listingId: listing.id } }), ctx)).jsonBody.order;
  assert.equal(await placeOrder(repository, opened, 'paid', buyer.id, { tellSeller: false }), null);
  const placed = await repository.getOrder(opened.id);
  assert.equal(placed.feeUnits, 10);
  placed.payments = [{ id: 'p2', kind: 'payment', amountMinor: placed.unitPriceMinor, method: 'upi', at: new Date().toISOString(), confirmedAt: new Date().toISOString() }];
  placed.paymentStatus = 'paid';
  const line = orderFeeLine(placed);
  assert.equal(line.totalMinor, B.saleFee(placed.feeTerms, { amountMinor: 4_00_000, units: 10 }).totalMinor);
});

console.log(`\n${passed} checks passed`);
