/**
 * Smoke test for the lot as the one record of where a consignment is.
 *
 * A lot move writes the lot and nothing else; every order reads its lot's
 * news and position off the lot, and is written back as only its own. These
 * checks run the read/write rules directly and through a store wrapped the
 * way the API wraps it, counting the writes that reach the store.
 * Run `npm run build:api` first.
 */
import assert from 'node:assert/strict';

const data = new URL('../api/dist/api/src/data/', import.meta.url);
const { rideLot, ownPart, tellLot, withLotView, mapLimit } = await import(new URL('lot-view.js', data));
const { MemoryRepository } = await import(new URL('memory-repository.js', data));
const { BUILT_IN_ROUTE } = await import(new URL('../api/dist/shared/routes.js', import.meta.url));
const { LOT_STAGES } = await import(new URL('../api/dist/shared/enums.js', import.meta.url));

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const T0 = '2026-10-01T10:00:00.000Z';
let lotCount = 0;
const newLot = (extra = {}) => ({
  id: `lot_view_${++lotCount}`,
  sellerId: 'usr_view_seller',
  name: 'View lot',
  description: '',
  origin: 'Guangzhou',
  supplier: null,
  status: 'open',
  stage: 'ordering',
  stageHistory: [],
  route: { ...BUILT_IN_ROUTE },
  currentStep: 0,
  estimatedDispatchAt: null,
  costModel: {},
  forwarder: null,
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});
let orderCount = 0;
const newOrder = (lot, extra = {}) => ({
  id: `ord_view_${++orderCount}`,
  lotId: lot.id,
  sellerId: lot.sellerId,
  buyerId: `usr_view_buyer_${orderCount}`,
  listingId: 'lst_view',
  itemName: 'A figure',
  quantity: 1,
  unitPriceMinor: 1000,
  unitWeightGrams: 100,
  status: 'confirmed',
  stage: 'ordering',
  stageHistory: [{ stage: 'ordering', enteredAt: T0, note: 'Order placed.', recordedBy: 'usr_view_buyer' }],
  placedAt: T0,
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});
// Each event a minute after the last, as they would be written.
let clock = Date.parse(T0);
const tick = () => new Date((clock += 60_000)).toISOString();
const event = (stage, note = null, at = tick()) => ({ stage, enteredAt: at, note, recordedBy: 'usr_view_seller' });
const moved = (lot, step, note) => ({
  ...lot,
  currentStep: step,
  // The built-in route is the seven stages, one step each.
  stage: LOT_STAGES[step],
  ...tellLot(lot, event('x', note), { moved: true }),
});

/** A memory store wrapped as the API wraps it, with every order write counted. */
async function countedStore() {
  const base = new MemoryRepository();
  await base.init();
  const writes = { orders: 0, lots: 0 };
  for (const name of ['updateOrder', 'createOrder', 'moveOrderToLot']) {
    const real = base[name].bind(base);
    base[name] = (...args) => { writes.orders += 1; return real(...args); };
  }
  const realLot = base.updateLot.bind(base);
  base.updateLot = (...args) => { writes.lots += 1; return realLot(...args); };
  return { base, repository: withLotView(base), writes };
}

console.log('the lot holds the step');

await check('moving a lot of forty items writes the lot once and no order', async () => {
  const { base, repository, writes } = await countedStore();
  const lot = newLot();
  await base.createLot(lot);
  for (let i = 0; i < 40; i += 1) await base.createOrder(newOrder(lot));
  writes.orders = 0;
  writes.lots = 0;

  await repository.updateLot(moved(lot, 2, 'Left the warehouse'));
  assert.equal(writes.lots, 1);
  assert.equal(writes.orders, 0, 'not one order is written');

  const orders = await repository.listOrdersForLot(lot.id);
  assert.equal(orders.length, 40);
  for (const order of orders) {
    assert.equal(order.currentStep, 2, 'every item reads where the lot is');
    assert.equal(order.stage, 'dispatched_from_china');
    assert.equal(order.status, 'in_fulfilment', 'a confirmed order is being worked once its lot moves');
    const last = order.stageHistory.at(-1);
    assert.equal(last.note, 'Left the warehouse');
    assert.equal(last.fromLot, lot.id);
  }
  // And nothing was stored on them.
  const raw = await base.getOrder(orders[0].id);
  assert.equal(raw.stageHistory.length, 1, 'the stored order holds only its own history');
  assert.equal(raw.status, 'confirmed');
});

await check('writing an order back stores only what is its own', async () => {
  const { base, repository } = await countedStore();
  const lot = newLot();
  await base.createLot(lot);
  const placed = newOrder(lot);
  await base.createOrder(placed);
  await repository.updateLot(moved(lot, 2, 'Flown'));

  const read = await repository.getOrder(placed.id);
  read.stageHistory = [...read.stageHistory, event(read.stage, 'Paid the balance')];
  read.paymentStatus = 'paid';
  const saved = await repository.updateOrder(read);

  const raw = await base.getOrder(placed.id);
  assert.deepEqual(raw.stageHistory.map((e) => e.note), ['Order placed.', 'Paid the balance'], 'the lot news is not copied in');
  assert.equal(raw.stage, 'ordering', 'and the position stays the lot\'s to say');
  assert.equal(raw.currentStep, undefined);
  assert.equal(raw.status, 'confirmed');
  assert.equal(raw.lotView, undefined, 'the view is never stored');
  // The caller's object still reads as an order does.
  assert.equal(saved, read, 'the caller keeps the object it passed');
  assert.equal(saved.currentStep, 2);
  assert.ok(saved.stageHistory.some((e) => e.note === 'Flown'));

  // The next move of the lot still reaches it.
  await repository.updateLot(moved(await base.getLot(lot.sellerId, lot.id), 3, 'Customs'));
  const again = await repository.getOrder(placed.id);
  assert.equal(again.currentStep, 3);
  assert.deepEqual(again.stageHistory.map((e) => e.note), ['Order placed.', 'Flown', 'Paid the balance', 'Customs']);
});

await check('an item moved on its own keeps its place until the lot moves again', async () => {
  const { base, repository } = await countedStore();
  const lot = newLot();
  await base.createLot(lot);
  const held = newOrder(lot);
  const rest = newOrder(lot);
  await base.createOrder(held);
  await base.createOrder(rest);
  await repository.updateLot(moved(lot, 3, 'Customs'));

  // Held at customs: the seller steps this one back.
  const read = await repository.getOrder(held.id);
  await repository.updateOrder({ ...read, currentStep: 2, stage: 'dispatched_from_china' });
  assert.equal((await repository.getOrder(held.id)).currentStep, 2, 'its own place');
  assert.equal((await repository.getOrder(rest.id)).currentStep, 3, 'the rest follow the lot');

  const stepped = await repository.getOrder(held.id);
  assert.equal(stepped.status, 'in_fulfilment', 'placed on its own, it keeps the status it travelled with');
  assert.equal((await base.getOrder(held.id)).status, 'in_fulfilment', 'stored as its own');

  // A note on the lot is not a move: the held item stays where it was put.
  const current = await base.getLot(lot.sellerId, lot.id);
  await repository.updateLot({ ...current, ...tellLot(current, event('india_received', 'Still waiting on duty')) });
  const noted = await repository.getOrder(held.id);
  assert.equal(noted.currentStep, 2);
  assert.equal(noted.stageHistory.at(-1).note, 'Still waiting on duty', 'but it hears the note');

  // The next move brings it back in line.
  await repository.updateLot(moved(await base.getLot(lot.sellerId, lot.id), 4, 'Repacked'));
  assert.equal((await repository.getOrder(held.id)).currentStep, 4);
});

await check('the lot moving while an order is being written does not pin the order behind', async () => {
  const { base, repository } = await countedStore();
  const lot = newLot();
  await base.createLot(lot);
  const placed = newOrder(lot);
  await base.createOrder(placed);
  await repository.updateLot(moved(lot, 2, 'Flown'));

  const stale = await repository.getOrder(placed.id);
  await repository.updateLot(moved(await base.getLot(lot.sellerId, lot.id), 3, 'Customs'));
  // The buyer's payment lands, written from what was read before the move.
  await repository.updateOrder({ ...stale, paymentStatus: 'paid' });
  const after = await repository.getOrder(placed.id);
  assert.equal(after.currentStep, 3, 'the move it did not see still reaches it');
  assert.ok(after.stageHistory.some((e) => e.note === 'Customs'));
});

await check('a join and a move in the same millisecond are told apart', async () => {
  const { base, repository } = await countedStore();
  const lot = newLot({ currentStep: 2, stage: 'dispatched_from_china' });
  const early = { ...lot, ...tellLot(lot, event('dispatched_from_china', 'Before you joined'), { moved: true }) };
  await base.createLot(early);
  // Joins at the very moment of the lot's earlier news.
  const joining = newOrder(lot, { lotId: 'awaiting_lot' });
  await base.createOrder(joining);
  const waiting = await repository.getOrder(joining.id);
  await repository.moveOrderToLot({ ...waiting, lotId: lot.id, currentStep: 1 }, 'awaiting_lot');
  const joined = await repository.getOrder(joining.id);
  assert.ok(!joined.stageHistory.some((e) => e.note === 'Before you joined'), 'news from before it joined is not its');
  assert.equal(joined.currentStep, 1, 'and it is where it joined, not where the lot was');
});

await check('a delivered item hears notes, not moves; a stopped one hears nothing', async () => {
  const { base, repository } = await countedStore();
  const lot = newLot({ currentStep: 4, stage: 'qc_repack' });
  await base.createLot(lot);
  const delivered = newOrder(lot, { status: 'delivered', stage: 'delivered', currentStep: 6 });
  const cancelled = newOrder(lot, { status: 'cancelled' });
  await base.createOrder(delivered);
  await base.createOrder(cancelled);
  const current = await base.getLot(lot.sellerId, lot.id);
  await repository.updateLot({ ...current, ...tellLot(current, event('qc_repack', 'Thanks, everyone')) });
  await repository.updateLot(moved(await base.getLot(lot.sellerId, lot.id), 5, 'Out for delivery'));

  const d = await repository.getOrder(delivered.id);
  assert.equal(d.currentStep, 6, 'a delivered item stays delivered');
  assert.deepEqual(d.stageHistory.slice(1).map((e) => e.note), ['Thanks, everyone']);
  const c = await repository.getOrder(cancelled.id);
  assert.equal(c.stageHistory.length, 1, 'a called-off item hears nothing more');
});

await check('an item that stops or leaves keeps what it was told', async () => {
  const { base, repository } = await countedStore();
  const lot = newLot();
  const other = newLot();
  await base.createLot(lot);
  await base.createLot(other);
  const stopping = newOrder(lot);
  const leaving = newOrder(lot);
  await base.createOrder(stopping);
  await base.createOrder(leaving);
  await repository.updateLot(moved(lot, 2, 'Flown'));

  const s = await repository.getOrder(stopping.id);
  await repository.updateOrder({ ...s, status: 'cancelled' });
  const rawStopped = await base.getOrder(stopping.id);
  assert.deepEqual(rawStopped.stageHistory.map((e) => e.note), ['Order placed.', 'Flown'], 'kept as its own');
  assert.equal(rawStopped.stageHistory[1].fromLot, undefined);
  assert.equal(rawStopped.currentStep, 2, 'stopped where it was');
  await repository.updateLot(moved(await base.getLot(lot.sellerId, lot.id), 3, 'Customs'));
  assert.equal((await repository.getOrder(stopping.id)).currentStep, 2, 'and stays stopped there');

  const l = await repository.getOrder(leaving.id);
  await repository.moveOrderToLot({ ...l, lotId: other.id }, lot.id);
  const gone = await repository.getOrder(leaving.id);
  assert.deepEqual(gone.stageHistory.map((e) => e.note), ['Order placed.', 'Flown', 'Customs'], 'its journey so far goes with it');
  await repository.updateLot(moved(await base.getLot(lot.sellerId, lot.id), 4, 'Repacked'));
  const later = await repository.getOrder(leaving.id);
  assert.ok(!later.stageHistory.some((e) => e.note === 'Repacked'), 'and the old lot\'s later news does not');
});

await check('orders written before this change read as they were', async () => {
  // Copies of every lot event, no counters: the shape the store already holds.
  const lot = newLot({ currentStep: 3, stage: 'india_received', stageHistory: [event('india_received', 'Customs')] });
  const legacy = newOrder(lot, {
    status: 'in_fulfilment', stage: 'india_received', currentStep: 3,
    stageHistory: [event('ordering', 'Order placed.'), event('india_received', 'Customs')],
  });
  const read = rideLot(legacy, lot);
  assert.equal(read.currentStep, 3);
  assert.deepEqual(read.stageHistory.map((e) => e.note), ['Order placed.', 'Customs'], 'nothing told twice');
  assert.deepEqual(ownPart(read, lot).stageHistory, legacy.stageHistory, 'and written back unchanged');

  // The first move after it reaches it.
  const next = moved(lot, 4, 'Repacked');
  assert.equal(rideLot(legacy, next).currentStep, 4);
});

await check('a lot-only event is not shown on items', async () => {
  const lot = newLot();
  const closed = { ...lot, stageHistory: [...lot.stageHistory, event('ordering', 'Lot closed – prepping for dispatch.')] };
  assert.equal(rideLot(newOrder(lot), closed).stageHistory.length, 1);
});

await check('bounded fan-out runs every item, a few at a time, in order', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.ok(peak <= 3, `at most three at once, saw ${peak}`);
});

await check('an order seen once is found again by its partition, and follows a move', async () => {
  const { ReadSnapshots } = await import(new URL('concurrency.js', data));
  const where = new ReadSnapshots(10, (kind, doc) => (kind === 'orders' ? doc.lotId : undefined), 3);
  where.remember('orders', { id: 'ord_a', lotId: 'lot_1' });
  assert.equal(where.whereIs('orders', 'ord_a'), 'lot_1', 'remembered without an etag too');
  where.remember('orders', { id: 'ord_a', lotId: 'lot_2' });
  assert.equal(where.whereIs('orders', 'ord_a'), 'lot_2', 'and moved with the order');
  for (const id of ['ord_b', 'ord_c', 'ord_d']) where.remember('orders', { id, lotId: 'lot_1' });
  assert.equal(where.whereIs('orders', 'ord_a'), undefined, 'bounded: the coldest is forgotten');
  assert.equal(where.whereIs('orders', 'ord_d'), 'lot_1');
});

console.log(`\n${passed} lot-view checks passed`);
