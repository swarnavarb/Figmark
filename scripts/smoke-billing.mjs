/**
 * Smoke test for Figmark's own money: platform fees (bands, per kg, the Pro
 * discount, GST in or on top), the monthly statement and the lock on an
 * account that has not paid, Pro (plans, vouchers, the server refusing a
 * locked tool), and a store paying or crediting anybody.
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
const { listingDetailRoute: listingDetail } = await import(new URL('catalog-routes.js', fns));
const { powerSaleCreateRoute: schedulePowerSale } = await import(new URL('power-sale-routes.js', fns));
const billing = await import(new URL('billing-routes.js', fns));
const cancels = await import(new URL('cancel-routes.js', fns));
const loyalty = await import(new URL('loyalty-routes.js', fns));
const { noteSellerCancel, directRefusal } = await import(new URL('api/src/cancel-watch.js', dist));
const { adminLedgerRoute: ledger } = await import(new URL('admin-routes.js', fns));
const { getRepository } = await import(new URL('api/src/data/index.js', dist));
const { forgetPricing, sweepFees } = await import(new URL('api/src/billing.js', dist));
const B = await import(new URL('shared/billing.js', dist));
const { DEMO_EMAIL, DEMO_PASSWORD } = fixtures;

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
    body: { acceptTerms: true, displayName: name, email: `bill${seq}@figmark.example`, phone: `+91900008${String(1000 + seq).slice(-4)}`, password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return { id: made.jsonBody.user.id, headers: { authorization: `Bearer ${made.jsonBody.token}` } };
};

const session = await login(req({ body: { identifier: DEMO_EMAIL, password: DEMO_PASSWORD } }), ctx);
// The demo account owns the demo shop and is an operator (ADMIN_EMAILS).
const shop = { id: session.jsonBody.user.id, headers: { authorization: `Bearer ${session.jsonBody.token}` } };
const repository = await getRepository();
const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

/* ── The arithmetic ────────────────────────────────────────────────────── */
console.log('platform fee arithmetic');

await check('a band is a flat fee up to its price and a percentage above; a flat fee is never more than the price', () => {
  const terms = { kind: 'shop', feeBands: [{ upToMinor: 50_000, mode: 'flat', value: 1_000 }, { upToMinor: null, mode: 'percent', value: 300 }], discountBp: 0, gst: null, at: '' };
  assert.equal(B.platformFee(terms, { amountMinor: 40_000 }).totalMinor, 1_000, '₹400 sale: ₹10 flat');
  assert.equal(B.platformFee(terms, { amountMinor: 50_000 }).totalMinor, 1_000, 'the upper price is inside the band');
  assert.equal(B.platformFee(terms, { amountMinor: 1_00_000 }).totalMinor, 3_000, '₹1,000 sale: 3%');
  assert.equal(B.platformFee(terms, { amountMinor: 500 }).totalMinor, 500, '₹5 sale: the flat fee stops at the price');
});

await check('a forwarder pays per chargeable kg; Pro takes its discount off before GST', () => {
  const kg = { kind: 'forwarder', perKgMinor: 1_000, discountBp: 0, gst: null, at: '' };
  assert.equal(B.platformFee(kg, { amountMinor: 0, kg: 12.5 }).totalMinor, 12_500);
  const pro = { ...kg, discountBp: 2_500 };
  assert.equal(B.platformFee(pro, { amountMinor: 0, kg: 10 }).totalMinor, 7_500, 'a quarter off');
  const taxed = { ...pro, gst: { rateBp: 1_800, mode: 'exclusive' } };
  const fee = B.platformFee(taxed, { amountMinor: 0, kg: 10 });
  assert.deepEqual([fee.feeMinor, fee.gstMinor, fee.totalMinor], [7_500, 1_350, 8_850], 'GST on top of the discounted fee');
});

await check('GST included keeps the price and carves the tax out; GST on top adds it', () => {
  assert.deepEqual(B.gstSplit({ rateBp: 1_800, mode: 'inclusive' }, 11_800), { baseMinor: 10_000, gstMinor: 1_800, totalMinor: 11_800 });
  assert.deepEqual(B.gstSplit({ rateBp: 1_800, mode: 'exclusive' }, 10_000), { baseMinor: 10_000, gstMinor: 1_800, totalMinor: 11_800 });
  assert.deepEqual(B.gstSplit(null, 10_000), { baseMinor: 10_000, gstMinor: 0, totalMinor: 10_000 });
  const gst = { ...B.DEFAULT_PRICING.gst, enabled: true, applyTo: { platform: true, protection: false, disputes: true, pro: false } };
  assert.equal(B.gstFor(gst, 'protection'), null, 'a scope left unticked is untaxed');
  assert.equal(B.gstFor({ ...gst, enabled: false }, 'platform'), null, 'switched off is untaxed everywhere');
});

await check('the statement: a month falls due after the grace days, payments clear the oldest month first, and overdue locks', () => {
  const line = (at, total, via = 'direct') => ({ id: at, kind: 'shop', label: 'x', link: '', at, basisMinor: 0, kg: null, feeMinor: total, gstMinor: 0, totalMinor: total, via });
  const now = Date.parse('2026-11-20T12:00:00Z');
  const lines = [line('2026-09-10T10:00:00Z', 5_000), line('2026-10-10T10:00:00Z', 3_000), line('2026-11-05T10:00:00Z', 2_000), line('2026-10-12T10:00:00Z', 9_000, 'gateway')];
  const open = B.buildStatement(lines, [], 7, now);
  assert.equal(open.owedMinor, 10_000, 'gateway fees are already settled');
  assert.equal(open.overdueMinor, 8_000, 'September and October are past due; November is not');
  assert.equal(open.locked, true);
  const paid = B.buildStatement(lines, [{ id: 'a', at: '', amountMinor: 8_000, gatewayRef: 'gw', by: 'x' }], 7, now);
  assert.equal(paid.overdueMinor, 0);
  assert.equal(paid.locked, false);
  assert.equal(paid.owedMinor, 2_000);
  assert.equal(paid.nextDueAt, B.monthDueAt('2026-11', 7));
  assert.equal(B.monthDueAt('2026-11', 7), '2026-12-07T18:30:00.000Z', 'day 8 of the next month, midnight India time');
});

await check('pricing an operator sends is checked: bands rise, percentages are capped, a GSTIN has its shape', () => {
  assert.ok('pricing' in B.cleanPricing({}), 'nothing sent keeps the defaults');
  assert.match(B.cleanPricing({ fees: { shop: [{ upToMinor: 5_000, mode: 'flat', value: 100 }, { upToMinor: 4_000, mode: 'flat', value: 100 }, { mode: 'percent', value: 100 }] } }).error, /starts above/);
  assert.match(B.cleanPricing({ fees: { shop: [{ mode: 'percent', value: 9_000 }] } }).error, /50%/);
  assert.match(B.cleanPricing({ gst: { gstin: 'nonsense' } }).error, /GSTIN/);
  const fine = B.cleanPricing({ gst: { gstin: '29ABCDE1234F1Z5', enabled: true }, pro: { plans: [{ months: 3, priceMinor: 100, bumpPoints: 2 }] } });
  assert.equal(fine.pricing.gst.gstin, '29ABCDE1234F1Z5');
  assert.equal(fine.pricing.pro.plans.length, 3, 'every plan is kept; the ones not sent keep their defaults');
});

/* ── The console ───────────────────────────────────────────────────────── */
console.log('pricing in the console');

await check('anybody reads the pricing; only an operator changes it, and a bad change is refused whole', async () => {
  const buyer = await newPerson('Price Reader');
  const read = await billing.pricingRoute(req(), ctx);
  assert.equal(read.status, 200);
  assert.equal(read.jsonBody.updatedBy, undefined, 'who changed it is the operators’ business');
  assert.equal((await billing.opsSavePricingRoute(req({ headers: buyer.headers, body: { graceDays: 3 } }), ctx)).status, 403);
  const bad = await billing.opsSavePricingRoute(req({ headers: shop.headers, body: { fees: { forwarderPerKgMinor: -5 } } }), ctx);
  assert.equal(bad.status, 400);
  const saved = await billing.opsSavePricingRoute(req({ headers: shop.headers, body: { graceDays: 5, fees: { forwarderPerKgMinor: 1_500 } } }), ctx);
  assert.equal(saved.status, 200, JSON.stringify(saved.jsonBody));
  assert.equal(saved.jsonBody.graceDays, 5);
  assert.equal(saved.jsonBody.fees.forwarderPerKgMinor, 1_500);
  assert.equal(saved.jsonBody.fees.shop.length, 2, 'what was not sent is kept');
});

/* ── Pro ───────────────────────────────────────────────────────────────── */
console.log('Pro');

await check('without Pro a Pro tool is refused by the server, not only hidden', async () => {
  const pro = (await billing.myProRoute(req({ headers: shop.headers }), ctx)).jsonBody;
  assert.equal(pro.active, false);
  assert.equal(pro.locked.powerSale, true);
  assert.equal(pro.plans.length, 3);
  const sale = await schedulePowerSale(req({ headers: shop.headers, body: { openingBody: 'Drop!', items: [] } }), ctx);
  assert.equal(sale.status, 402);
  assert.equal(sale.jsonBody.error, 'pro_required');
});

await check('buying 3 months opens every tool, adds the bump points, and is in the ledger', async () => {
  const before = (await repository.getUserById(shop.id)).sellerProfile.growth?.spotlights ?? 0;
  const bought = await billing.buyProRoute(req({ headers: shop.headers, body: { months: 3 } }), ctx);
  assert.equal(bought.status, 200, JSON.stringify(bought.jsonBody));
  assert.equal(bought.jsonBody.active, true);
  assert.ok(bought.jsonBody.daysLeft >= 90);
  assert.equal(bought.jsonBody.locked.powerSale, false);
  assert.equal(bought.jsonBody.discountBp, undefined, 'Pro never lowers the platform fee');
  const after = (await repository.getUserById(shop.id)).sellerProfile.growth.spotlights;
  assert.equal(after - before, 5);
  const sale = await schedulePowerSale(req({ headers: shop.headers, body: { openingBody: 'Drop!', items: [] } }), ctx);
  assert.notEqual(sale.status, 402, 'past the Pro check (whatever the sale itself says)');
  const entries = (await ledger(req({ headers: shop.headers }), ctx)).jsonBody.entries;
  assert.ok(entries.some((entry) => entry.kind === 'pro' && entry.amountMinor === 49_900));
  const status = (await billing.proStatusRoute(req({ query: { owner: shop.id } }), ctx)).jsonBody;
  assert.equal(status.active, true, 'the badge reads it');
});

await check('a voucher an operator made gives its days once per account, and stops when used up or switched off', async () => {
  const made = await billing.opsMakeVouchersRoute(req({ headers: shop.headers, body: { days: 30, count: 1, maxUses: 1, code: 'launch-30' } }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  assert.equal(made.jsonBody.vouchers[0].code, 'LAUNCH-30');
  assert.equal((await billing.opsMakeVouchersRoute(req({ headers: shop.headers, body: { days: 30, code: 'LAUNCH-30' } }), ctx)).status, 409, 'a code is unique');
  const one = await newPerson('Voucher One');
  const two = await newPerson('Voucher Two');
  const redeemed = await billing.redeemVoucherRoute(req({ headers: one.headers, body: { code: ' launch-30 ' } }), ctx);
  assert.equal(redeemed.status, 200, JSON.stringify(redeemed.jsonBody));
  assert.equal(redeemed.jsonBody.active, true);
  assert.match((await billing.redeemVoucherRoute(req({ headers: one.headers, body: { code: 'LAUNCH-30' } }), ctx)).jsonBody.message, /already used/);
  assert.match((await billing.redeemVoucherRoute(req({ headers: two.headers, body: { code: 'LAUNCH-30' } }), ctx)).jsonBody.message, /used up/);
  const batch = await billing.opsMakeVouchersRoute(req({ headers: shop.headers, body: { days: 7, count: 3, prefix: 'fest' } }), ctx);
  assert.equal(batch.jsonBody.vouchers.length, 3);
  assert.ok(batch.jsonBody.vouchers.every((voucher) => /^FEST-[A-Z0-9]{8}$/.test(voucher.code)));
  const code = batch.jsonBody.vouchers[0].code;
  await billing.opsToggleVoucherRoute(req({ headers: shop.headers, params: { code } }), ctx);
  assert.match((await billing.redeemVoucherRoute(req({ headers: two.headers, body: { code } }), ctx)).jsonBody.message, /switched off/);
  assert.equal((await billing.redeemVoucherRoute(req({ headers: two.headers, body: { code: 'NOPE' } }), ctx)).status, 400);
});

/* ── Fees, settled monthly ─────────────────────────────────────────────── */
console.log('platform fees and the lock');

const anyOrder = (await repository.listAllUsers()).length > 0
  ? (await Promise.all((await repository.listAllUsers()).map((user) => repository.listOrdersForSeller(user.id)))).flat()[0]
  : null;
assert.ok(anyOrder, 'the fixtures have an order to copy');
const terms = B.feeTermsFor(B.DEFAULT_PRICING, 'shop', null);
const directSale = async (paidDaysAgo, priceMinor, method = 'direct') => {
  const at = ago(paidDaysAgo);
  const id = `ord_fee_${Math.random().toString(36).slice(2, 10)}`;
  await repository.createOrder({
    ...structuredClone(anyOrder),
    id, sellerId: shop.id, quantity: 1, unitPriceMinor: priceMinor, status: 'confirmed', placedAt: at, createdAt: at, updatedAt: at,
    paymentMethod: method, paymentStatus: 'paid', credits: [], closure: null,
    payments: [{ id: `pay_${id}`, at, kind: 'full', method, amountMinor: priceMinor, batchId: null, batchTotalMinor: null, reference: null, recordedBy: shop.id }],
    feeTerms: terms,
  });
  return id;
};

await check('direct sales owe their fee; past the month and its grace days the shop locks and its listings vanish', async () => {
  const listing = (await repository.listListings({ sellerId: shop.id }))[0];
  assert.ok(listing, 'the demo shop has an item on sale');
  await directSale(70, 2_00_000); // two months back: overdue
  await directSale(1, 30_000); // this month: not yet due
  await directSale(70, 1_00_000, 'protected'); // through the gateway: settled already
  const fees = await billing.myFeesRoute(req({ headers: shop.headers }), ctx);
  assert.equal(fees.status, 200, JSON.stringify(fees.jsonBody));
  const s = fees.jsonBody.statement;
  assert.equal(s.overdueMinor, 6_000, '3% of ₹2,000');
  assert.equal(s.owedMinor, 7_000, 'and ₹10 flat on the ₹300 sale this month');
  assert.ok(s.lines.some((line) => line.via === 'gateway'), 'the gateway sale is listed, already settled');
  assert.equal(fees.jsonBody.locked, true);
  assert.equal((await repository.getUserById(shop.id)).feeLock.overdueMinor, 6_000);
  assert.equal((await repository.listListings({ sellerId: shop.id })).length, 0, 'nobody sees the shop’s items');
  const buyer = await newPerson('Locked Out');
  assert.equal((await listingDetail(req({ headers: buyer.headers, params: { id: listing.id } }), ctx)).status, 404);
  assert.equal((await listingDetail(req({ headers: shop.headers, params: { id: listing.id } }), ctx)).status, 200, 'the shop still sees its own');
  assert.equal((await billing.giveRoute(req({ headers: shop.headers, body: { kind: 'shop', recipient: buyer.id, amountMinor: 100, method: 'credit', reason: 'x' } }), ctx)).status, 409);
});

await check('paying through the gateway opens the shop again at once and is in the ledger', async () => {
  const listing = (await repository.listListings({ sellerId: shop.id, includeHidden: true })).find((row) => row.feeHold);
  assert.ok(listing);
  assert.equal((await billing.payFeesRoute(req({ headers: shop.headers, body: { amountMinor: 999_999 } }), ctx)).status, 400, 'not more than is owed');
  const paid = await billing.payFeesRoute(req({ headers: shop.headers, body: {} }), ctx);
  assert.equal(paid.status, 200, JSON.stringify(paid.jsonBody));
  assert.equal(paid.jsonBody.locked, false);
  assert.equal(paid.jsonBody.statement.owedMinor, 0);
  assert.ok(paid.jsonBody.settlement.gatewayRef.startsWith('gw_'));
  assert.ok((await repository.listListings({ sellerId: shop.id })).length > 0, 'the items are back');
  assert.equal((await repository.getListing(listing.id)).feeHold, false);
  const entries = (await ledger(req({ headers: shop.headers }), ctx)).jsonBody.entries;
  assert.ok(entries.some((entry) => entry.kind === 'platform' && entry.amountMinor === 7_000));
  const ops = (await billing.opsFeesRoute(req({ headers: shop.headers }), ctx)).jsonBody;
  assert.ok(ops.accounts.some((row) => row.userId === shop.id && row.locked === false));
  assert.ok(ops.earnings.platform.figmarkMinor >= 7_000);
});

await check('the daily check locks an account that falls behind, and an operator can write the debt off', async () => {
  await directSale(70, 5_00_000); // ₹150 owed: more than the ₹70 paid ahead of it
  forgetPricing();
  assert.ok(await sweepFees(repository) >= 1);
  assert.ok((await repository.getUserById(shop.id)).feeLock, 'locked overnight');
  const waived = await billing.opsWaiveFeesRoute(req({ headers: shop.headers, params: { id: shop.id }, body: { note: 'Launch month' } }), ctx);
  assert.equal(waived.status, 200, JSON.stringify(waived.jsonBody));
  assert.equal(waived.jsonBody.locked, false);
  assert.equal((await repository.getUserById(shop.id)).feeLock, null);
});

/* ── Paying or crediting anybody ───────────────────────────────────────── */
console.log('a store paying or crediting anybody');

await check('store credit lands in the person’s wallet for that store, and the corner chip reads it', async () => {
  const buyer = await newPerson('Credit Kept');
  const given = await billing.giveRoute(req({ headers: shop.headers, body: { kind: 'shop', recipient: buyer.id, amountMinor: 25_000, method: 'credit', reason: 'Late parcel' } }), ctx);
  assert.equal(given.status, 201, JSON.stringify(given.jsonBody));
  const chip = (await billing.myStoreCreditRoute(req({ headers: buyer.headers }), ctx)).jsonBody.credits;
  assert.deepEqual(chip.map((row) => [row.storeId, row.leftMinor]), [[shop.id, 25_000]]);
  assert.deepEqual((await billing.myStoreCreditRoute(req(), ctx)).jsonBody.credits, [], 'signed out: nothing');
  const list = (await billing.listGivenRoute(req({ headers: shop.headers, query: { kind: 'shop' } }), ctx)).jsonBody;
  assert.equal(list.gifts[0].status, 'credited');
});

await check('a direct payment needs its reference and waits on the person; the gateway one is done at once', async () => {
  const buyer = await newPerson('Paid Back');
  const noRef = await billing.giveRoute(req({ headers: shop.headers, body: { kind: 'shop', recipient: buyer.id, amountMinor: 5_000, method: 'direct', reason: 'Refund' } }), ctx);
  assert.equal(noRef.status, 400);
  const direct = await billing.giveRoute(req({ headers: shop.headers, body: { kind: 'shop', recipient: buyer.id, amountMinor: 5_000, method: 'direct', reason: 'Refund', reference: 'UPI123' } }), ctx);
  assert.equal(direct.jsonBody.gift.status, 'sent');
  const answered = await billing.answerGiftRoute(req({ headers: buyer.headers, params: { id: direct.jsonBody.gift.id }, body: { arrived: true } }), ctx);
  assert.equal(answered.jsonBody.status, 'received');
  const gateway = await billing.giveRoute(req({ headers: shop.headers, body: { kind: 'shop', recipient: buyer.id, amountMinor: 7_000, method: 'gateway', reason: 'Goodwill' } }), ctx);
  assert.equal(gateway.jsonBody.gift.status, 'received');
  assert.ok(gateway.jsonBody.gift.gatewayRef.startsWith('gw_'));
  const theirs = (await billing.receivedGiftsRoute(req({ headers: buyer.headers }), ctx)).jsonBody.gifts;
  assert.deepEqual(theirs.map((gift) => gift.status), ['received', 'received']);
  const stranger = await newPerson('Not The Owner');
  assert.equal((await billing.giveRoute(req({ headers: stranger.headers, body: { kind: 'shop', owner: shop.id, recipient: buyer.id, amountMinor: 100, method: 'credit', reason: 'x' } }), ctx)).status, 403);
});

/* ── Closed months stay closed ─────────────────────────────────────────── */
console.log('closed months');

await check('a sale cancelled inside its own month just drops off; after the month closes it comes off the month it was cancelled in', () => {
  const now = Date.parse('2026-11-15T06:00:00Z');
  const line = (id, at) => ({ id, kind: 'shop', label: id, link: '', at, basisMinor: 1_00_000, kg: null, feeMinor: 3_000, gstMinor: 0, totalMinor: 3_000, via: 'direct' });
  const old = line('o:old', '2026-09-10T06:00:00Z');
  const fresh = line('o:new', '2026-11-02T06:00:00Z');
  let book = B.reconcileFeeBook([old, fresh], {}, now).book;
  // Both cancelled now.
  const after = B.reconcileFeeBook([], book, now);
  assert.equal(after.book['o:new'], undefined, 'this month: gone, never counted');
  assert.equal(after.book['o:old'].reversedIn, '2026-11');
  const september = after.lines.find((entry) => entry.id === 'o:old');
  const minus = after.lines.find((entry) => entry.reversalOf === 'o:old');
  assert.equal(september.totalMinor, 3_000, 'September still holds its fee');
  assert.equal(minus.totalMinor, -3_000);
  assert.equal(B.feeMonthOf(minus.at), '2026-11', 'it comes off November');
  const statement = B.buildStatement(after.lines, [], 7, now);
  assert.equal(statement.months.find((month) => month.month === '2026-09').directMinor, 3_000);
  assert.equal(statement.owedMinor, 0, 'the November credit pays September');
  assert.equal(statement.overdueMinor, 0);
  book = after.book;
  // Read again: nothing moves.
  assert.equal(B.reconcileFeeBook([], book, now).changed, false);
});

await check('the statement keeps a cancelled month-old sale in its month and credits it now', async () => {
  const id = await directSale(70, 2_00_000);
  const before = (await billing.myFeesRoute(req({ headers: shop.headers }), ctx)).jsonBody.statement;
  const order = await repository.getOrder(id);
  await repository.updateOrder({ ...order, status: 'cancelled' });
  const after = (await billing.myFeesRoute(req({ headers: shop.headers }), ctx)).jsonBody.statement;
  const month = B.feeMonthOf(ago(70));
  assert.equal(after.months.find((row) => row.month === month).directMinor, before.months.find((row) => row.month === month).directMinor,
    'the closed month is untouched');
  assert.ok(after.lines.some((line) => line.reversalOf === `o:${id}` && line.totalMinor === -6_000), 'a minus line this month');
  assert.equal(after.owedMinor, Math.max(0, before.owedMinor - 6_000));
});

/* ── Sellers who cancel too often ──────────────────────────────────────── */
console.log('cancellations');

await check('a seller over the limit is flagged, told, and direct buying pauses; an appeal reaches the console, which clears it', async () => {
  const seller = await newPerson('Cancels A Lot');
  const ids = [];
  for (let index = 0; index < 6; index += 1) {
    const id = `ord_cx_${index}_${seller.id.slice(-4)}`;
    await repository.createOrder({
      ...structuredClone(anyOrder), id, sellerId: seller.id, placedAt: ago(2), createdAt: ago(2), updatedAt: ago(2),
      status: index < 2 ? 'cancelled' : 'confirmed', sellerCancelledAt: index < 2 ? ago(1) : null, feeTerms: terms,
    });
    ids.push(id);
  }
  await billing.opsFeesRoute(req({ headers: shop.headers }), ctx);
  const { noteFeeAccount } = await import(new URL('api/src/billing.js', dist));
  await noteFeeAccount(repository, seller.id, 'Cancels A Lot');
  const flag = await noteSellerCancel(repository, seller.id);
  assert.equal(flag.status, 'flagged', '2 of 6 is 33%, over 20%');
  assert.equal(flag.directPaused, true);
  assert.ok(await directRefusal(repository, seller.id), 'direct buying refused');
  const mine = (await cancels.myCancelsRoute(req({ headers: seller.headers }), ctx)).jsonBody;
  assert.equal(mine.directPaused, true);
  assert.equal(mine.stats.cancelled, 2);
  assert.equal((await cancels.cancelAppealRoute(req({ headers: seller.headers, body: { text: 'short' } }), ctx)).status, 400);
  const appealed = await cancels.cancelAppealRoute(req({ headers: seller.headers, body: { text: 'A supplier shipment was lost at customs.' } }), ctx);
  assert.equal(appealed.jsonBody.flag.status, 'appealed');
  const ops = (await cancels.opsCancelsRoute(req({ headers: shop.headers }), ctx)).jsonBody;
  assert.equal(ops.rows[0].userId, seller.id, 'appeals come first');
  assert.equal((await cancels.opsCancelsRoute(req({ headers: seller.headers }), ctx)).status, 403);
  const cleared = await cancels.opsCancelDecideRoute(req({ headers: shop.headers, params: { id: seller.id }, body: { decision: 'clear', note: 'Customs loss confirmed' } }), ctx);
  assert.equal(cleared.jsonBody.flag.status, 'cleared');
  assert.equal(await directRefusal(repository, seller.id), null, 'direct buying back on');
  assert.equal((await noteSellerCancel(repository, seller.id)).status, 'cleared', 'old cancellations do not flag again');
});

/* ── Loyalty cards ─────────────────────────────────────────────────────── */
console.log('loyalty cards');

await check('a Pro shop’s card stamps every delivered order; cashback lands as store credit once, a free item waits for the shop', async () => {
  const bad = await loyalty.saveCardRoute(req({ headers: shop.headers, body: { name: 'X', rewards: [] } }), ctx);
  assert.equal(bad.status, 400);
  const tooMuch = await loyalty.saveCardRoute(req({ headers: shop.headers, body: { name: 'Greedy', rewards: [{ kind: 'cashback_flat', amountMinor: 9_99_900 }] } }), ctx);
  assert.equal(tooMuch.status, 400, 'over the operators’ cap');
  const saved = await loyalty.saveCardRoute(req({
    headers: shop.headers,
    body: { name: 'Regulars', theme: 'gold', rewards: [null, { kind: 'cashback_flat', amountMinor: 5_000 }, { kind: 'free_item', text: 'Sticker pack' }] },
  }), ctx);
  assert.equal(saved.status, 200, JSON.stringify(saved.jsonBody));
  const card = saved.jsonBody.card;
  const buyer = await newPerson('Loyal Buyer');
  for (let index = 0; index < 3; index += 1) {
    const at = new Date(Date.now() + 1_000 + index).toISOString();
    await repository.createOrder({
      ...structuredClone(anyOrder), id: `ord_loy_${index}_${buyer.id.slice(-4)}`, sellerId: shop.id, buyerId: buyer.id,
      status: 'delivered', completedAt: at, placedAt: at, quantity: 1, unitPriceMinor: 20_000, offerDiscountMinor: 0, appliedOffers: [],
    });
  }
  const view = (await loyalty.shopLoyaltyRoute(req({ headers: buyer.headers, params: { id: shop.id } }), ctx)).jsonBody;
  const row = view.cards.find((entry) => entry.card.id === card.id);
  assert.equal(row.stamps, 3);
  assert.equal(row.ready, 1, 'the sticker pack waits');
  await loyalty.shopLoyaltyRoute(req({ headers: buyer.headers, params: { id: shop.id } }), ctx);
  const credits = (await repository.getUserById(buyer.id)).storeCredits.filter((credit) => credit.id.startsWith('loyalty:'));
  assert.deepEqual(credits.map((credit) => credit.amountMinor), [5_000], 'cashback paid once, however often it is read');
  const wallet = (await loyalty.myLoyaltyRoute(req({ headers: buyer.headers }), ctx)).jsonBody.cards;
  assert.equal(wallet.find((entry) => entry.card.id === card.id).rewards.length, 2);
  const owed = (await loyalty.shopRewardsRoute(req({ headers: shop.headers }), ctx)).jsonBody.rewards;
  const sticker = owed.find((entry) => entry.status === 'ready' && entry.buyerId === buyer.id);
  assert.ok(sticker);
  assert.equal((await loyalty.useRewardRoute(req({ headers: shop.headers, params: { id: sticker.id } }), ctx)).status, 200);
  assert.equal((await loyalty.useRewardRoute(req({ headers: shop.headers, params: { id: sticker.id } }), ctx)).status, 404, 'once');
  const outsider = await newPerson('No Pro');
  assert.equal((await loyalty.saveCardRoute(req({ headers: outsider.headers, body: { name: 'Mine', rewards: [{ kind: 'free_shipping' }] } }), ctx)).status, 402);
});

await check('a per-item card stamps each item; a reward goes with an offer unless both give the same thing, and a clashing one waits', async () => {
  const saved = await loyalty.saveCardRoute(req({
    headers: shop.headers,
    body: {
      name: 'Per item', theme: 'mint', stampPer: 'item',
      rewards: [null, { kind: 'cashback_flat', amountMinor: 3_000 }, { kind: 'free_shipping' }, null, { kind: 'free_item', text: 'Keychain', withOffers: false }],
    },
  }), ctx);
  assert.equal(saved.status, 200, JSON.stringify(saved.jsonBody));
  const card = saved.jsonBody.card;
  assert.equal(card.stampPer, 'item');
  assert.equal(card.rewards[4].withOffers, false);
  const buyer = await newPerson('Offer Buyer');
  const money = [{ offerId: 'o1', kind: 'discount', perk: 'money', label: '10% off on 2+', savedMinor: 1_000 }];
  const ship = [{ offerId: 'o2', kind: 'spend_free_shipping', perk: 'shipping', label: 'Free shipping over ₹500', savedMinor: 500 }];
  const order = async (tag, quantity, applied, offset) => {
    const at = new Date(Date.now() + 5_000 + offset).toISOString();
    await repository.createOrder({
      ...structuredClone(anyOrder), id: `ord_per_${tag}_${buyer.id.slice(-4)}`, sellerId: shop.id, buyerId: buyer.id,
      status: 'delivered', completedAt: at, placedAt: at, quantity, unitPriceMinor: 10_000,
      offerDiscountMinor: applied.reduce((sum, row) => sum + row.savedMinor, 0), appliedOffers: applied,
    });
  };
  const mine = async () => (await loyalty.shopLoyaltyRoute(req({ headers: buyer.headers, params: { id: shop.id } }), ctx)).jsonBody.cards
    .find((entry) => entry.card.id === card.id);
  const cash = async () => ((await repository.getUserById(buyer.id)).storeCredits ?? [])
    .filter((credit) => credit.id.startsWith(`loyalty:${card.id}:`)).map((credit) => credit.amountMinor);

  // 3 items with money off: cashback clashes (both money) and waits; free shipping goes with it.
  await order('a', 3, money, 0);
  let row = await mine();
  assert.equal(row.total, 3, 'three items, three stamps');
  assert.equal(row.waiting, 1);
  assert.equal(row.ready, 1, 'free shipping came with the money-off offer');
  assert.deepEqual(await cash(), []);
  // Next order with no offer: the cashback comes.
  await order('b', 1, [], 1);
  row = await mine();
  assert.equal(row.waiting, 0);
  assert.deepEqual(await cash(), [3_000]);
  // The keychain is kept apart from every offer: on an order with free shipping it waits.
  await order('c', 1, ship, 2);
  row = await mine();
  assert.equal(row.total, 5);
  assert.equal(row.waiting, 1, 'kept apart from offers');
  await mine();
  assert.deepEqual(await cash(), [3_000], 'paid once');
});

await check('at checkout a clashing reward is the buyer’s pick: taking it drops that kind of offer from the order', async () => {
  const { checkoutLoyalty } = await import(new URL('api/src/loyalty.js', dist));
  const buyer = await newPerson('Picky Buyer');
  const base = await repository.getListing(anyOrder.listingId);
  const listing = {
    ...structuredClone(base), id: `lst_pick_${buyer.id.slice(-4)}`, sellerId: shop.id, quantityAvailable: 50, status: 'active',
    offers: [{ id: 'two', kind: 'discount', minItems: 2, scope: 'lot', discount: { type: 'percent', value: 10 } }],
  };
  await repository.createListing(listing);
  const checkout = {
    ...structuredClone(anyOrder), id: `ord_pick_${buyer.id.slice(-4)}`, sellerId: shop.id, buyerId: buyer.id, listingId: listing.id,
    status: 'pending', placedAt: null, completedAt: null, quantity: 2, unitPriceMinor: 10_000, paymentStatus: 'unpaid', payments: [],
    offerRules: listing.offers, appliedOffers: [], offerDiscountMinor: 0, lotId: null,
  };
  await repository.createOrder(checkout);
  const perItem = (await loyalty.myCardsRoute(req({ headers: shop.headers }), ctx)).jsonBody.cards.find((entry) => entry.name === 'Per item');
  assert.ok(perItem);
  // Keep the offer: priced with 10% off, and stamp 2's cashback clashes.
  assert.equal((await loyalty.pickAtCheckoutRoute(req({ headers: buyer.headers, params: { id: checkout.id }, body: { pick: 'offer' } }), ctx)).status, 200);
  let now = await repository.getOrder(checkout.id);
  assert.equal(now.offerDiscountMinor, 2_000);
  let rows = (await checkoutLoyalty(repository, now)).filter((entry) => entry.cardId === perItem.id);
  const clash = rows.find((entry) => !entry.fits);
  assert.ok(clash, JSON.stringify(rows));
  assert.equal(clash.reward.kind, 'cashback_flat');
  assert.deepEqual(clash.clashWith, [now.appliedOffers[0].label]);
  assert.equal(clash.clashMinor, 2_000);
  // Take the reward: the money-off offer comes off, and the cashback now fits.
  const took = await loyalty.pickAtCheckoutRoute(req({ headers: buyer.headers, params: { id: checkout.id }, body: { pick: 'reward' } }), ctx);
  assert.equal(took.status, 200, JSON.stringify(took.jsonBody));
  now = await repository.getOrder(checkout.id);
  assert.deepEqual(now.offersDropped, ['money']);
  assert.equal(now.offerDiscountMinor, 0);
  rows = (await checkoutLoyalty(repository, now)).filter((entry) => entry.cardId === perItem.id);
  assert.ok(rows.some((entry) => entry.fits && entry.reward.kind === 'cashback_flat'));
  // And back again.
  await loyalty.pickAtCheckoutRoute(req({ headers: buyer.headers, params: { id: checkout.id }, body: { pick: 'offer' } }), ctx);
  assert.equal((await repository.getOrder(checkout.id)).offerDiscountMinor, 2_000);
});

console.log(`\n${passed} billing checks passed`);
