/**
 * The demo shop's past: deliveries over the last five months, so its on-time
 * rate, repeat buyers and customer screens have a history to read rather than
 * a row of "New". Mostly on time, a few late, two still out past their
 * promise - what a real import shop's record looks like.
 *
 * Also gives every fixture listing and order a delivery time, the way every
 * listing has one now: imports a few weeks, stock in hand a few days.
 */
import type { Listing, Order } from '../shared/models.js';
import { DIRECT_LOT_ID } from '../shared/fulfilment.js';

const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const IMPORT_ETA = { minDays: 40, maxDays: 50 };
const IN_HAND_ETA = { minDays: 3, maxDays: 7 };

/** A delivery time on every listing, and the same promise on every order bought from one. */
export function withDeliveryTimes(listings: Listing[], orders: Order[]): { listings: Listing[]; orders: Order[] } {
  const byId = new Map<string, Listing>();
  const out = listings.map((listing) => {
    const next = listing.deliveryEta ? listing : { ...listing, deliveryEta: listing.sourcing === 'import' ? IMPORT_ETA : IN_HAND_ETA };
    byId.set(next.id, next);
    return next;
  });
  return {
    listings: out,
    orders: orders.map((order) => order.deliveryEta !== undefined ? order : {
      ...order,
      deliveryEta: byId.get(order.listingId)?.deliveryEta
        ?? (order.lotId && order.lotId !== DIRECT_LOT_ID ? IMPORT_ETA : IN_HAND_ETA),
    }),
  };
}

/** [buyer, days ago placed, days it took, eta, item, price] */
type Row = [string, number, number | null, { minDays: number; maxDays: number }, string, string, number];

const ROWS: Row[] = [
  ['usr_b_avradeep', 150, 44, IMPORT_ETA, 'lst_my_statue', 'Garage kit statue — built and painted', 1_20_000],
  ['usr_b_nikhil', 140, 47, IMPORT_ETA, 'lst_my_statue', 'Garage kit statue — built and painted', 1_20_000],
  ['usr_b_sana', 128, 5, IN_HAND_ETA, 'lst_my_cards', 'Card binder — 200+ commons and rares', 18_000],
  ['usr_b_avradeep', 120, 6, IN_HAND_ETA, 'lst_my_cards', 'Card binder — 200+ commons and rares', 18_000],
  ['usr_b_rohit', 110, 55, IMPORT_ETA, 'lst_my_statue', 'Garage kit statue — built and painted', 1_20_000],
  ['usr_b_nikhil', 98, 4, IN_HAND_ETA, 'lst_my_cards', 'Card binder — 200+ commons and rares', 18_000],
  ['usr_b_sana', 92, 48, IMPORT_ETA, 'lst_my_statue', 'Garage kit statue — built and painted', 1_20_000],
  ['usr_b_avradeep', 84, 45, IMPORT_ETA, 'lst_my_statue', 'Garage kit statue — built and painted', 1_20_000],
  ['usr_b_rohit', 70, 9, IN_HAND_ETA, 'lst_my_cards', 'Card binder — 200+ commons and rares', 18_000],
  ['usr_b_nikhil', 66, 42, IMPORT_ETA, 'lst_my_statue', 'Garage kit statue — built and painted', 1_20_000],
  ['usr_b_sana', 50, 3, IN_HAND_ETA, 'lst_my_cards', 'Card binder — 200+ commons and rares', 18_000],
  ['usr_b_avradeep', 30, 5, IN_HAND_ETA, 'lst_my_cards', 'Card binder — 200+ commons and rares', 18_000],
  // Still out, past the longest day promised: counts as late until it lands.
  ['usr_b_rohit', 58, null, IMPORT_ETA, 'lst_my_statue', 'Garage kit statue — built and painted', 1_20_000],
  ['usr_b_sana', 12, null, IN_HAND_ETA, 'lst_my_cards', 'Card binder — 200+ commons and rares', 18_000],
];

export function seedDeliveredHistory(): Order[] {
  return ROWS.map(([buyerId, placedAgo, took, eta, listingId, itemName, price], n) => {
    const placed = iso(-placedAgo);
    const arrived = took == null ? null : iso(-placedAgo + took);
    const isImport = eta === IMPORT_ETA;
    return {
      id: `ord_hist_${String(n + 1).padStart(2, '0')}`,
      lotId: isImport ? 'lot_my_batch' : DIRECT_LOT_ID,
      sellerId: 'usr_demo', buyerId, listingId, itemName,
      condition: 'LOOSE', quantity: 1, unitWeightGrams: 900, unitPriceMinor: price, currency: 'INR',
      status: arrived ? 'delivered' : 'shipped', paymentStatus: 'paid',
      paymentMethod: 'direct',
      payments: [{
        id: `pay_hist_${n + 1}`, kind: 'full', method: 'direct', amountMinor: price, at: iso(-placedAgo + 1),
        batchId: null, batchTotalMinor: null, reference: `UPI${100200 + n}`, recordedBy: 'usr_demo',
      }],
      stage: arrived ? 'delivered' : isImport ? 'local_dispatch' : 'dispatched',
      stageHistory: [
        { stage: isImport ? 'ordering' : 'preparing', enteredAt: placed, note: 'Order placed.', recordedBy: buyerId },
        ...(arrived ? [{ stage: 'delivered' as const, enteredAt: arrived, note: null, recordedBy: 'usr_demo' }] : []),
      ],
      checkpoints: {
        dispatched: iso(-placedAgo + Math.max(1, Math.floor((took ?? 20) * 0.8))),
        ...(arrived ? { delivered: arrived } : {}),
      },
      accepted: true, acceptedAt: placed,
      deliveryEta: eta,
      hold: { state: 'none', amountMinor: price, heldAt: null, releasedAt: null, autoReleaseAt: null, disputeId: null },
      placedAt: placed,
      receivedAt: arrived,
      completedAt: arrived, createdAt: placed, updatedAt: arrived ?? iso(-placedAgo + 5),
    } as Order;
  });
}
