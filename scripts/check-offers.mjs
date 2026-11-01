/**
 * Seller offers: what each one promises, checked on small made-up baskets.
 *
 * `priceBasket` and `cleanOffers` are pure (see shared/offers.ts), so each rule
 * is one basket and one assertion - the same sum the item page, the checkout
 * and the server's repricing all read.
 *
 * Run `npm run build:api` first.
 */
import assert from 'node:assert/strict';

const offers = await import(new URL('../api/dist/shared/offers.js', import.meta.url));
const { priceBasket, cleanOffers, offerLabel, offerSummary, offerTerms, wholesaleHint, earlyBirdOpen, nextStepFor } = offers;

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const line = (over = {}) => ({
  id: 'o1', listingId: 'l1', lotId: null, quantity: 1, unitPriceMinor: 100_000, shippingPerItemMinor: 5_000,
  offers: [], active: true, ...over,
});
const price = (lines, who = { repeatBuyer: false }) => priceBasket(lines, who);

check('with no offer, shipping is charged per item and nothing comes off', () => {
  const out = price([line({ quantity: 2 })]).get('o1');
  assert.equal(out.shippingMinor, 10_000);
  assert.equal(out.discountMinor, 0);
});

const freeShip = { id: 'fs', kind: 'free_shipping', scope: 'lot', minItems: 2 };

check('free shipping in the same lot: two items in one lot, shipping is free on both', () => {
  const out = price([
    line({ id: 'a', lotId: 'lotA', offers: [freeShip] }),
    line({ id: 'b', lotId: 'lotA', offers: [freeShip] }),
  ]);
  assert.equal(out.get('a').shippingMinor, 0);
  assert.equal(out.get('b').shippingMinor, 0);
});

check('free shipping in the same lot: different lots do not count together', () => {
  const out = price([
    line({ id: 'a', lotId: 'lotA', offers: [freeShip] }),
    line({ id: 'b', lotId: 'lotB', offers: [freeShip] }),
  ]);
  assert.equal(out.get('a').shippingMinor, 5_000);
});

check('an order not yet in any lot does not count toward a lot offer, and gets it once filed', () => {
  const waiting = price([line({ id: 'a', lotId: null, offers: [freeShip] }), line({ id: 'b', lotId: null, offers: [freeShip] })]);
  assert.equal(waiting.get('a').shippingMinor, 5_000);
  const filed = price([line({ id: 'a', lotId: 'lotA', offers: [freeShip] }), line({ id: 'b', lotId: 'lotA', offers: [freeShip] })]);
  assert.equal(filed.get('a').shippingMinor, 0);
});

check('a shop-wide offer counts items across different lots', () => {
  const shopShip = { ...freeShip, scope: 'shop' };
  const out = price([
    line({ id: 'a', lotId: 'lotA', offers: [shopShip] }),
    line({ id: 'b', lotId: 'lotB', offers: [shopShip] }),
  ]);
  assert.equal(out.get('a').shippingMinor, 0);
  assert.equal(out.get('b').shippingMinor, 0);
});

check('quantity counts as items: two of one item qualifies', () => {
  assert.equal(price([line({ id: 'a', lotId: 'lotA', quantity: 2, offers: [freeShip] })]).get('a').shippingMinor, 0);
});

check('cancelling an item drops the offer on the rest', () => {
  const out = price([
    line({ id: 'a', lotId: 'lotA', offers: [freeShip] }),
    line({ id: 'b', lotId: 'lotA', offers: [freeShip], active: false }),
  ]);
  assert.equal(out.get('a').shippingMinor, 5_000);
  assert.equal(out.get('b').shippingMinor, 0, 'a cancelled item owes nothing');
});

check('rupees off on 2 or more in the same lot comes off each item', () => {
  const off = { id: 'd', kind: 'discount', scope: 'lot', minItems: 2, discount: { type: 'fixed', value: 20_000 } };
  const out = price([line({ id: 'a', lotId: 'L', offers: [off] }), line({ id: 'b', lotId: 'L', offers: [off] })]);
  assert.equal(out.get('a').discountMinor, 20_000);
  const alone = price([line({ id: 'a', lotId: 'L', offers: [off] })]);
  assert.equal(alone.get('a').discountMinor, 0);
});

check('a percentage discount is worked out on the item price', () => {
  const off = { id: 'd', kind: 'discount', scope: 'shop', minItems: 2, discount: { type: 'percent', value: 10 } };
  const out = price([line({ id: 'a', quantity: 2, offers: [off] })]);
  assert.equal(out.get('a').discountMinor, 20_000);
});

check('no discount can take an item below ₹1', () => {
  const off = { id: 'd', kind: 'discount', scope: 'shop', minItems: 2, discount: { type: 'fixed', value: 99_999_999 } };
  const out = price([line({ id: 'a', quantity: 2, unitPriceMinor: 5_000, offers: [off] })]);
  assert.ok(out.get('a').discountMinor <= 2 * (5_000 - 100));
});

check('wholesale: the best tier reached applies, as a percentage', () => {
  const w = { id: 'w', kind: 'wholesale', tiers: [{ minQty: 5, type: 'percent', value: 5 }, { minQty: 10, type: 'percent', value: 15 }] };
  assert.equal(price([line({ quantity: 4, offers: [w] })]).get('o1').discountMinor, 0);
  assert.equal(price([line({ quantity: 5, offers: [w] })]).get('o1').discountMinor, 25_000);
  assert.equal(price([line({ quantity: 12, offers: [w] })]).get('o1').discountMinor, 180_000);
});

check('wholesale: a dropped price replaces the unit price', () => {
  const w = { id: 'w', kind: 'wholesale', tiers: [{ minQty: 10, type: 'price', value: 80_000 }] };
  assert.equal(price([line({ quantity: 10, offers: [w] })]).get('o1').discountMinor, 200_000);
});

check('bundle: any 3 for a price, with the odd one left at full price', () => {
  const b = { id: 'b', kind: 'bundle', minItems: 3, bundlePriceMinor: 250_000 };
  assert.equal(price([line({ quantity: 3, offers: [b] })]).get('o1').discountMinor, 50_000);
  assert.equal(price([line({ quantity: 4, offers: [b] })]).get('o1').discountMinor, 50_000);
  assert.equal(price([line({ quantity: 6, offers: [b] })]).get('o1').discountMinor, 100_000);
});

check('buy X get Y: buy 2 get 1 free', () => {
  const b = { id: 'b', kind: 'buy_x_get_y', minItems: 2, freeQty: 1 };
  assert.equal(price([line({ quantity: 3, offers: [b] })]).get('o1').discountMinor, 100_000);
  assert.equal(price([line({ quantity: 2, offers: [b] })]).get('o1').discountMinor, 0);
});

check('free shipping over a spend uses the whole basket from the shop', () => {
  const s = { id: 's', kind: 'spend_free_shipping', minSpendMinor: 150_000 };
  assert.equal(price([line({ id: 'a', offers: [s] })]).get('a').shippingMinor, 5_000);
  const out = price([line({ id: 'a', offers: [s] }), line({ id: 'b', listingId: 'l2' })]);
  assert.equal(out.get('a').shippingMinor, 0);
});

check('early bird needs the order to have earned it, and keeps it', () => {
  const e = { id: 'e', kind: 'early_bird', limit: 3, discount: { type: 'percent', value: 10 } };
  assert.equal(price([line({ offers: [e] })]).get('o1').discountMinor, 0);
  assert.equal(price([line({ offers: [e], lockedOfferIds: ['e'] })]).get('o1').discountMinor, 10_000);
  assert.equal(earlyBirdOpen(e, 2), true);
  assert.equal(earlyBirdOpen(e, 3), false);
  assert.equal(earlyBirdOpen({ id: 'e2', kind: 'early_bird', until: '2000-01-01T00:00:00Z', discount: e.discount }, 0), false);
});

check('group-buy reward arrives only once the group buy fills', () => {
  const g = { id: 'g', kind: 'group_fill', freeShipping: true };
  assert.equal(price([line({ offers: [g] })]).get('o1').shippingMinor, 5_000);
  assert.equal(price([line({ offers: [g], groupFilled: true })]).get('o1').shippingMinor, 0);
  const d = { id: 'g2', kind: 'group_fill', discount: { type: 'fixed', value: 10_000 } };
  assert.equal(price([line({ offers: [d], groupFilled: true })]).get('o1').discountMinor, 10_000);
});

check('first-order and repeat-buyer perks follow what was settled at ordering', () => {
  const first = { id: 'f', kind: 'first_order', discount: { type: 'fixed', value: 10_000 } };
  const repeat = { id: 'r', kind: 'repeat_buyer', discount: { type: 'fixed', value: 7_000 } };
  assert.equal(price([line({ offers: [first, repeat] })], { repeatBuyer: false }).get('o1').discountMinor, 10_000);
  assert.equal(price([line({ offers: [first, repeat] })], { repeatBuyer: true }).get('o1').discountMinor, 7_000);
  assert.equal(price([line({ offers: [first, repeat], lockedOfferIds: ['f'] })], { repeatBuyer: true }).get('o1').discountMinor, 10_000,
    'finishing one order must not take a first-order offer off another');
});

check('pay-in-full discount applies only when paying in full', () => {
  const p = { id: 'p', kind: 'prepay', discount: { type: 'percent', value: 5 } };
  assert.equal(price([line({ offers: [p] })]).get('o1').discountMinor, 0);
  assert.equal(price([line({ offers: [p], paidInFull: true })]).get('o1').discountMinor, 5_000);
});

check('offers do not stack: a line gets the single best money-off', () => {
  const a = { id: 'a', kind: 'discount', scope: 'shop', minItems: 2, discount: { type: 'fixed', value: 10_000 } };
  const b = { id: 'b', kind: 'discount', scope: 'shop', minItems: 2, discount: { type: 'fixed', value: 30_000 } };
  const out = price([line({ quantity: 2, offers: [a, b] })]).get('o1');
  assert.equal(out.discountMinor, 60_000);
  assert.equal(out.applied.filter((x) => x.kind === 'discount').length, 1);
});

check('free shipping and money off can both apply', () => {
  const d = { id: 'd', kind: 'discount', scope: 'shop', minItems: 2, discount: { type: 'fixed', value: 10_000 } };
  const out = price([line({ quantity: 2, offers: [freeShip, { ...d }].map((o) => ({ ...o, scope: 'shop' })) })]).get('o1');
  assert.equal(out.shippingMinor, 0);
  assert.equal(out.discountMinor, 20_000);
});

check('validation: accepts good offers and refuses broken ones with a plain reason', () => {
  assert.equal(cleanOffers([freeShip]).error, null);
  assert.match(cleanOffers([{ kind: 'free_shipping', minItems: 1 }]).error, /how many items/);
  assert.match(cleanOffers([{ kind: 'discount', minItems: 2 }]).error, /amount off/);
  assert.match(cleanOffers([{ kind: 'bundle', minItems: 3, bundlePriceMinor: 400_000 }], 100_000).error, /less than buying/);
  assert.match(cleanOffers([{ kind: 'early_bird', discount: { type: 'percent', value: 10 } }]).error, /number of buyers, a date/);
  assert.match(cleanOffers([{ kind: 'wholesale', tiers: [] }]).error, /price steps/);
  assert.match(cleanOffers([{ kind: 'nonsense' }]).error, /what kind/);
  assert.match(cleanOffers(Array.from({ length: 9 }, () => freeShip)).error, /at most/);
  assert.match(cleanOffers([{ kind: 'wholesale', tiers: [{ minQty: 5, type: 'price', value: 120_000 }] }], 100_000).error, /lower than the normal price/);
});

check('text: every kind has a label, a summary and terms; group offers state the cancellation rule', () => {
  for (const kind of offers.OFFER_KINDS) {
    const sample = {
      id: 'x', kind, minItems: 2, scope: 'lot', discount: { type: 'percent', value: 10 }, minSpendMinor: 100_000,
      bundlePriceMinor: 150_000, freeQty: 1, limit: 5, tiers: [{ minQty: 5, type: 'percent', value: 10 }],
    };
    assert.ok(offerLabel(sample).length > 0, kind);
    assert.ok(offerSummary(sample).length > 0, kind);
    assert.ok(offerTerms(sample).length > 0, kind);
  }
  assert.ok(offerTerms(freeShip).some((line) => /cancel/i.test(line) && /price/i.test(line)));
  assert.match(offerSummary(freeShip), /same lot/);
  assert.match(offerSummary({ ...freeShip, scope: 'shop' }), /different lots/);
});

check('card hint: the lowest wholesale price, worked out from the unit price', () => {
  const w = { id: 'w', kind: 'wholesale', tiers: [{ minQty: 5, type: 'percent', value: 10 }, { minQty: 10, type: 'price', value: 70_000 }] };
  assert.deepEqual(wholesaleHint([w], 100_000), { minQty: 10, priceMinor: 70_000 });
  assert.equal(wholesaleHint([freeShip], 100_000), null);
});

check('progress message stays generic about lots', () => {
  assert.match(nextStepFor(freeShip, { items: 1, spendMinor: 0 }), /to the same lot/);
  assert.equal(nextStepFor(freeShip, { items: 2, spendMinor: 0 }), null);
});

console.log(`\n${passed} checks passed`);
