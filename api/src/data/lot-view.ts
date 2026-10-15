import { inLot, kindOf } from '../../../shared/fulfilment.js';
import type { Lot, Order, OrderLotView, StageEvent } from '../../../shared/models.js';
import { isStopped, travellingStatus } from '../../../shared/orders.js';
import { currentStepOf, lotOffset, routeOf } from '../../../shared/routes.js';
import { adopt } from './concurrency.js';
import type { Repository } from './repository.js';

/*
 * The lot is the one record of where a consignment is.
 *
 * Moving a lot used to write every order in it - its stage, its step, its
 * status and a copy of the event - so a crate of forty items was forty-one
 * writes, and one of them failing left the lot moved and some items behind
 * with nobody told. Now a move writes the lot alone. Each order keeps only
 * what is its own (paid, received at the warehouse, dispatched, delivered,
 * a step this one item took), and is read with its lot's news laid over it:
 *
 *   - news: lot events numbered after the last one the order already holds
 *     (`Lot.seq` against `Order.lotSeenSeq`);
 *   - position: the lot's, once the lot has moved since this item was last
 *     placed on its own (`Lot.movedSeq` against `Order.positionSeq`).
 *
 * The repository does this on every read and undoes it on every write, so a
 * handler sees the same order it always did and writes back only what it
 * changed. That happens here, once, around whichever store is loaded.
 */

type Reach = OrderLotView['reach'];

/**
 * How much of its lot's news an order still hears.
 *
 * The rules the fan-out used to apply when it chose whom to write: an item
 * called off or refunded hears nothing more, one delivered on its own has left
 * the crate and hears only notes, and everything else travels with it.
 */
export function reachOf(status: Order['status']): Reach {
  if (isStopped(status)) return 'none';
  return status === 'delivered' ? 'notes' : 'all';
}

/** Two histories as one, by time; the order's own first where two share a moment. */
function interleave(own: readonly StageEvent[], news: readonly StageEvent[]): StageEvent[] {
  const out: StageEvent[] = [];
  let at = 0;
  for (const event of news) {
    while (at < own.length && own[at]!.enteredAt <= event.enteredAt) out.push(own[at++]!);
    out.push(event);
  }
  while (at < own.length) out.push(own[at++]!);
  return out;
}

function setOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/**
 * The order as its buyer and seller read it: its own record, with its lot's
 * news and position applied. Returns a copy for an order in a lot, and the
 * order itself otherwise.
 */
export function rideLot(order: Order, lot: Lot | null): Order {
  if (!inLot(order)) return order;
  const reach = reachOf(order.status);
  const own: OrderLotView['own'] = { stage: order.stage, status: order.status };
  setOptional(own, 'currentStep', order.currentStep);
  const view = (shown: OrderLotView['shown'], follows: boolean): OrderLotView => {
    const result: OrderLotView = { lotId: order.lotId, own, shown, follows, reach };
    setOptional(result, 'positionSeq', order.positionSeq);
    return result;
  };
  if (!lot || lot.id !== order.lotId) return { ...order, lotView: view(own, false) };

  const seen = order.lotSeenSeq ?? 0;
  const news = reach === 'none'
    ? []
    : lot.stageHistory
      .filter((event) => typeof event.seq === 'number' && event.seq > seen
        && (reach === 'all' || (kindOf(event) === 'note' && !event.movedLot)))
      .map((event) => ({ ...event, fromLot: lot.id }));

  const follows = reach === 'all' && (lot.movedSeq ?? 0) > (order.positionSeq ?? 0);
  let shown = own;
  if (follows) {
    const at = currentStepOf(lot);
    shown = { stage: lot.stage, status: travellingStatus(order.status) };
    // Back to filling, an item rides its own buttons again rather than a
    // position that would read as received before it was.
    setOptional(shown, 'currentStep', at < lotOffset(routeOf(lot)) ? undefined : at);
  }

  const read: Order = {
    ...order,
    stage: shown.stage,
    status: shown.status,
    stageHistory: news.length > 0 ? interleave(order.stageHistory, news) : order.stageHistory,
    lotView: view(shown, follows),
  };
  setOptional(read, 'currentStep', shown.currentStep);
  return read;
}

/** The lot's news taken out again: it is read off the lot, never stored twice. */
function withoutLotNews(history: readonly StageEvent[]): StageEvent[] {
  return history.some((event) => event.fromLot) ? history.filter((event) => !event.fromLot) : [...history];
}

/** The lot's news kept as the order's own, for an order that stops hearing it. */
function asOwnHistory(history: readonly StageEvent[]): StageEvent[] {
  return history.map((event) => {
    if (!event.fromLot) return event;
    const { fromLot: _from, seq: _seq, movedLot: _moved, ...own } = event;
    return own;
  });
}

/**
 * What an order stores, from the order as read and changed by a handler.
 *
 * `lot` is the order's lot as it stands now, read just before the write, so
 * whatever the caller placed is stamped with the lot's count at that moment.
 * While the order keeps travelling with its lot, its lot's news comes off and
 * whatever the caller did not change goes back to what the order held. An
 * order joining a lot, leaving one, or stopping (delivered, called off)
 * keeps what it was shown as its own, since it will not read it again.
 */
export function ownPart(order: Order, lot: Lot | null): Order {
  const { lotView: view, ...rest } = order;
  const stored = rest as Order;
  const seqNow = lot && inLot(stored) && lot.id === stored.lotId ? lot.seq ?? 0 : undefined;

  if (!view || !inLot(stored) || view.lotId !== stored.lotId) {
    stored.stageHistory = asOwnHistory(stored.stageHistory);
    if (inLot(stored) && seqNow !== undefined) {
      stored.lotSeenSeq = seqNow;
      stored.positionSeq = seqNow;
    }
    return stored;
  }

  const placed = stored.stage !== view.shown.stage || stored.currentStep !== view.shown.currentStep;
  const restamped = stored.positionSeq !== view.positionSeq;
  if (placed && !restamped && seqNow !== undefined) stored.positionSeq = seqNow;

  if (view.reach === 'all' && reachOf(stored.status) === 'all') {
    stored.stageHistory = withoutLotNews(stored.stageHistory);
    // Placed on its own, it stops following the lot, so the position and
    // status it read with the lot applied are now its own. Otherwise the lot
    // keeps saying them, and the order keeps what it held.
    if (!placed) {
      stored.stage = view.own.stage;
      setOptional(stored, 'currentStep', view.own.currentStep);
      if (stored.status === view.shown.status) stored.status = view.own.status;
    }
    return stored;
  }

  stored.stageHistory = asOwnHistory(stored.stageHistory);
  if (seqNow !== undefined) stored.lotSeenSeq = seqNow;
  return stored;
}

/** True while this order's position is its lot's rather than one of its own. */
export function followsItsLot(order: Order): boolean {
  return order.lotView?.follows === true;
}

/**
 * News for a lot's buyers: the event numbered and added to the lot's history.
 * `moved` when the lot changed position with it, which every item still
 * following the lot then reads.
 */
export function tellLot(lot: Lot, event: StageEvent | null, options: { moved?: boolean } = {}): Pick<Lot, 'seq' | 'movedSeq' | 'stageHistory'> {
  const seq = (lot.seq ?? 0) + 1;
  const told: Pick<Lot, 'seq' | 'movedSeq' | 'stageHistory'> = {
    seq,
    stageHistory: event ? [...lot.stageHistory, { ...event, seq, ...(options.moved ? { movedLot: true } : {}) }] : lot.stageHistory,
  };
  setOptional(told, 'movedSeq', options.moved ? seq : lot.movedSeq);
  return told;
}

/** At most `limit` of these at once, results in order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const READ_MANY = [
  'listOrdersForLot', 'listOrdersForBuyer', 'listOrdersForListing', 'listOrdersCommissionedFrom',
  'listCheckoutDrafts', 'listOrdersAwaitingLot', 'listSellerOrdersIn',
] as const;

/**
 * The repository with every order read against its lot, and written back as
 * only its own. See the top of this file.
 */
export function withLotView(base: Repository): Repository {
  const lotOf = (order: Order): Promise<Lot | null> =>
    inLot(order) ? base.getLot(order.sellerId, order.lotId) : Promise.resolve(null);

  async function readAll(orders: Order[], known?: Map<string, Lot>): Promise<Order[]> {
    const lots = new Map<string, Lot | null>(known ?? []);
    const wanted = new Map<string, Order>();
    for (const order of orders) {
      if (inLot(order) && !lots.has(order.lotId)) wanted.set(order.lotId, order);
    }
    await mapLimit([...wanted.values()], 8, async (order) => {
      lots.set(order.lotId, await lotOf(order));
    });
    return orders.map((order) => rideLot(order, lots.get(order.lotId) ?? null));
  }

  async function write<A extends unknown[]>(
    order: Order,
    run: (stored: Order, ...rest: A) => Promise<Order>,
    ...rest: A
  ): Promise<Order> {
    const lot = await lotOf(order);
    const saved = await run(ownPart(order, lot), ...rest);
    // The caller keeps using the object it passed, as with the stores
    // themselves: it takes the saved etag and reads as an order does.
    return adopt(order, rideLot({ ...saved }, lot));
  }

  const overrides: Partial<Repository> = {
    async getOrder(id) {
      const order = await base.getOrder(id);
      return order ? (await readAll([order]))[0]! : null;
    },
    async listOrdersForSeller(sellerId) {
      const [orders, lots] = await Promise.all([
        base.listOrdersForSeller(sellerId),
        base.listLots({ sellerId, limit: 10_000 }),
      ]);
      return readAll(orders, new Map(lots.map((lot) => [lot.id, lot])));
    },
    updateOrder: (order) => write(order, (stored) => base.updateOrder(stored)),
    createOrder: (order) => write(order, (stored) => base.createOrder(stored)),
    moveOrderToLot: (order, fromLotId) => write(order, (stored, from: string) => base.moveOrderToLot(stored, from), fromLotId),
  };
  for (const name of READ_MANY) {
    const read = base[name].bind(base) as (...args: unknown[]) => Promise<Order[]>;
    (overrides as Record<string, unknown>)[name] = async (...args: unknown[]) => readAll(await read(...args));
  }

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in overrides) return (overrides as Record<string, unknown>)[prop];
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
