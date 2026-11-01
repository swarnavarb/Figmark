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
import { dayKey, type ViewLog, type ViewSource } from '../shared/seller-data.js';

const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const IMPORT_ETA = { minDays: 40, maxDays: 50 };
const IN_HAND_ETA = { minDays: 3, maxDays: 7 };

/**
 * A delivery time on every listing. Orders are left as they are: like orders
 * placed before delivery times existed, they carry no promise and are not
 * measured - only the history below, and orders placed from now, are.
 */
export function withDeliveryTimes(listings: Listing[], orders: Order[]): { listings: Listing[]; orders: Order[] } {
  return {
    listings: listings.map((listing) => listing.deliveryEta ? listing
      : { ...listing, deliveryEta: listing.sourcing === 'import' ? IMPORT_ETA : IN_HAND_ETA }),
    orders,
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

/** Where the demo views come from, roughly as a shop's do: mostly the feed and its own page. */
const SOURCE_MIX: [ViewSource, number][] = [
  ['feed', 34], ['shop', 18], ['search', 14], ['channel', 11], ['discover', 8], ['share', 6], ['similar', 5], ['saved', 4],
];

/**
 * The last month of views behind each listing's total, spread over the days
 * and the places they came from - so the shop's Data screens can draw views
 * by day and by source for the demo account's shop.
 */
export function withViewHistory(listings: Listing[], sellerIds: ReadonlySet<string>): Listing[] {
  return listings.map((listing, n) => {
    if (!sellerIds.has(listing.sellerId) || listing.viewLog || listing.viewCount <= 0) return listing;
    const log: ViewLog = {};
    let left = listing.viewCount;
    for (let day = 29; day >= 0 && left > 0; day -= 1) {
      // A gentle rise toward today, with a wobble so no two items look alike.
      const share = Math.max(1, Math.round((listing.viewCount / 30) * (0.6 + ((29 - day) / 29) * 0.8) * (0.8 + ((n * 7 + day * 3) % 5) / 10)));
      const today = Math.min(left, share);
      left -= today;
      const key = dayKey(Date.now() - day * DAY);
      const sources: Partial<Record<ViewSource, number>> = {};
      let placed = 0;
      SOURCE_MIX.forEach(([source, weight], k) => {
        const count = k === SOURCE_MIX.length - 1 ? today - placed : Math.floor((today * weight) / 100);
        if (count > 0) { sources[source] = count; placed += count; }
      });
      log[key] = sources;
    }
    return { ...listing, viewLog: log };
  });
}
