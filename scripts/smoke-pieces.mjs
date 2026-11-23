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
const { readFileSync } = await import('node:fs');
const { getPhotoStore } = await import(new URL('api/src/storage/index.js', dist));
const store = await getPhotoStore();
const shelf = await store.upload(new Uint8Array(readFileSync(new URL('../test-fixtures/photos/shelf.jpg', import.meta.url))), 'image/jpeg', session.jsonBody.user.id);
const shelfPhoto = { blobName: shelf.blobName, url: shelf.url, isPrimary: true };
const found = JSON.parse(readFileSync(new URL('../test-fixtures/photos/shelf-things.json', import.meta.url), 'utf8')).map((thing) => thing.boxes[0]);
const setBody = (extra) => ({ title: 'Marvel Legends shelf', priceMinor: 25_00_000, deliveryEta: { minDays: 3, maxDays: 5 }, bundle: true, photos: [shelfPhoto], ...extra });

await check('a client that sends no items still lists a set, charged at least what it says', async () => {
  const older = await createListing(req({ headers: shop, body: { title: 'Blind box lot', priceMinor: 4_00_000, deliveryEta: { minDays: 3, maxDays: 5 }, bundle: true, bundleItems: 6 } }), ctx);
  assert.equal(older.status, 201, JSON.stringify(older.jsonBody));
  assert.equal(older.jsonBody.listing.bundleCount.charged, 6);
});

await check('a set lists every item, shares its price among them, and is charged per item', async () => {
  const items = found.map((box, index) => ({ title: index === 0 ? 'Green Goblin' : '', boxes: [box] }));
  const made = await createListing(req({ headers: shop, body: setBody({ setItems: items, seen: found }) }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const listing = made.jsonBody.listing;
  assert.equal(listing.setItems.length, found.length);
  assert.equal(listing.setItems[1].title, 'Item 2', 'an unnamed item gets a name');
  assert.equal(listing.setItems.reduce((sum, item) => sum + item.priceMinor, 0), 25_00_000, 'the shares add back up');
  assert.ok(listing.bundleCount.charged >= found.length - 2, `different figures are counted apart (${listing.bundleCount.charged} of ${found.length})`);
  assert.equal(listing.pieces, undefined, 'buyers buy the set as one');
});

await check('calling twenty-five different figures one item does not make the fee one', async () => {
  // One row holding every figure's place, and the phone's finds sent as they were.
  const made = await createListing(req({ headers: shop, body: setBody({ setItems: [{ title: 'Everything', boxes: found.slice(0, 4) }, { title: 'And this', boxes: [found[4]] }], seen: found }) }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const charged = made.jsonBody.listing.bundleCount.charged;
  assert.ok(charged >= Math.ceil(found.length * 0.85) - 2, `charged on ${charged}, found ${found.length}`);
});

await check('the same thing shown twice is one item; two different things in one row are two', async () => {
  const one = found[5];
  const again = [one[0] + 0.004, one[1] + 0.004, one[2], one[3]];
  const made = await createListing(req({ headers: shop, body: {
    title: 'Two figures', deliveryEta: { minDays: 3, maxDays: 5 }, photos: [shelfPhoto],
    pieces: [
      { title: 'Wolverine, front and back', priceMinor: 1_75_000, boxes: [one, again] },
      { title: 'Two figures in one row', priceMinor: 3_00_000, boxes: [found[12], found[30]] },
    ],
  } }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const [same, two] = made.jsonBody.listing.pieces;
  assert.equal(same.units ?? 1, 1);
  assert.equal(two.units, 2);
});

await check('a published piece listing is edited: sold pieces stay, others change, new ones join', async () => {
  const { editListingRoute: editListing } = await import(new URL('catalog-routes.js', fns));
  const before = await repository.getListing(lot.id);
  const sold = before.pieces.filter((piece) => piece.soldAt);
  const edited = await editListing(req({ headers: shop, params: { id: lot.id }, body: {
    pieces: [
      ...before.pieces.map((piece) => ({ id: piece.id, title: piece.soldAt ? 'Renamed after selling' : `${piece.title} (boxed)`, priceMinor: 9_99_900, boxes: piece.boxes })),
      { title: 'Doctor Strange', priceMinor: 2_00_000, boxes: [[0.69, 0.41, 0.065, 0.165]] },
    ],
  } }), ctx);
  assert.equal(edited.status, 200, JSON.stringify(edited.jsonBody));
  const after = edited.jsonBody.listing;
  for (const piece of sold) {
    const kept = after.pieces.find((entry) => entry.id === piece.id);
    assert.equal(kept.title, piece.title, 'a sold piece keeps its title');
    assert.equal(kept.priceMinor, piece.priceMinor, 'and its price');
  }
  assert.equal(after.pieces.length, before.pieces.length + 1);
  assert.equal(after.status, 'active', 'a new piece puts a sold-out listing back on sale');
  assert.equal(after.quantityAvailable, 1);
});

await check('taking found items off an individual listing does not lower the fee count', () => {
  assert.deepEqual(P.spreadUnits([1, 1, 1], 5), [2, 2, 1], 'the floor is spread over the rows');
  assert.deepEqual(P.spreadUnits([2, 1], 2), [2, 1], 'already over the floor: unchanged');
  const units = P.spreadUnits(Array(42).fill(1), 46);
  assert.equal(units.reduce((a, b) => a + b, 0), 46, '42 listed of 54 found is charged for 46');
});

console.log(`\n${passed} checks passed`);
