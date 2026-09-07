import {
  LOT_PROGRESS_CHECKPOINTS,
  ORDER_CHECKPOINTS,
  type OrderCheckpoint,
} from './enums.js';
import type { Order } from './models.js';

/**
 * The counts a lot is read by.
 *
 * A consignment does not move as one piece - thirty-three of thirty-four reach
 * the warehouse and one is still with the supplier - so every headline number
 * here is a count of orders that have passed a checkpoint, never a state stored
 * on the lot. The card and the lot's own board therefore cannot disagree: they
 * are the same function of the same rows.
 */

export interface CheckpointCount {
  checkpoint: OrderCheckpoint;
  done: number;
  total: number;
}

export interface LotTally {
  customers: number;
  orders: number;
  /** Counts for every checkpoint, in travel order. */
  counts: CheckpointCount[];
  /** The three the card charts, in the same order it charts them. */
  progress: CheckpointCount[];
  /** Customers with every one of their orders ready to go. */
  customersReady: number;
  /** Customers with every one of their orders dispatched. */
  customersDispatched: number;
}

/** True when this order has passed that checkpoint. */
export function isTicked(order: Order, checkpoint: OrderCheckpoint): boolean {
  return Boolean(order.checkpoints?.[checkpoint]);
}

/** How many of these orders have passed each checkpoint. */
export function countCheckpoints(orders: readonly Order[]): CheckpointCount[] {
  return ORDER_CHECKPOINTS.map((checkpoint) => ({
    checkpoint,
    done: orders.filter((order) => isTicked(order, checkpoint)).length,
    total: orders.length,
  }));
}

/** Orders grouped by the person who placed them. */
export function byCustomer(orders: readonly Order[]): Map<string, Order[]> {
  const grouped = new Map<string, Order[]>();
  for (const order of orders) {
    const existing = grouped.get(order.buyerId);
    if (existing) existing.push(order);
    else grouped.set(order.buyerId, [order]);
  }
  return grouped;
}

export function tally(orders: readonly Order[]): LotTally {
  const counts = countCheckpoints(orders);
  const customers = byCustomer(orders);

  // A customer counts as ready only when everything of theirs is: a parcel goes
  // out whole, so one item short means the customer is not ready.
  const every = (list: Order[], checkpoint: OrderCheckpoint) =>
    list.length > 0 && list.every((order) => isTicked(order, checkpoint));

  return {
    customers: customers.size,
    orders: orders.length,
    counts,
    progress: LOT_PROGRESS_CHECKPOINTS.map(
      (checkpoint) => counts.find((entry) => entry.checkpoint === checkpoint)!,
    ),
    customersReady: [...customers.values()].filter((list) => every(list, 'ready_to_dispatch')).length,
    customersDispatched: [...customers.values()].filter((list) => every(list, 'dispatched')).length,
  };
}

/** Look one checkpoint up in a tally without scanning at the call site. */
export function countOf(tallied: LotTally, checkpoint: OrderCheckpoint): CheckpointCount {
  return tallied.counts.find((entry) => entry.checkpoint === checkpoint)!;
}
