/**
 * A shop's customers, worked out from what they did toward the shop.
 *
 * Everything here is a pure function of orders, saves, checkouts and the
 * like, so the API, the tests and any later screen read one set of rules.
 * Nothing here names a person for browsing: a customer is somebody who
 * ordered, saved, checked out, pledged, followed, voted or commented - acts
 * a buyer knows a shop sees.
 */
import type { OrderStatus } from './enums.js';
import type { Order } from './models.js';
import { orderMoney } from './payments.js';

const DAY = 86_400_000;

/** Orders that never turned into money kept: called off, turned down, or given back. */
export const GONE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'cancelled', 'rejected', 'refunded', 'cancelled_reversed', 'payment_reversal_pending',
]);

export const placedOf = (order: Pick<Order, 'placedAt' | 'createdAt'>) => order.placedAt ?? order.createdAt;
export const valueOf = (order: Pick<Order, 'quantity' | 'unitPriceMinor'>) => order.quantity * order.unitPriceMinor;

/* ── Value groups ───────────────────────────────────────────────────────── */

export const VALUE_LABELS = ['vip', 'regular', 'at_risk', 'one_time', 'new'] as const;
export type ValueLabel = (typeof VALUE_LABELS)[number];

export const VALUE_LABEL_NAMES: Record<ValueLabel, { label: string; hint: string }> = {
  vip: { label: 'VIP', hint: 'Your top tenth by spend, still ordering.' },
  regular: { label: 'Regular', hint: 'Order more than once, on their usual rhythm.' },
  at_risk: { label: 'At risk', hint: 'Regulars who have gone well past their usual gap.' },
  one_time: { label: 'One-time', hint: 'One order, more than 30 days ago.' },
  new: { label: 'New', hint: 'First order in the last 30 days.' },
};

export interface Spend {
  buyerId: string;
  orders: number;
  spentMinor: number;
  firstAt: string;
  lastAt: string;
}

/**
 * The spend at or above which a customer is VIP: the top tenth. Infinity with
 * nobody to rank.
 */
export function vipCutoff(spends: readonly Pick<Spend, 'spentMinor'>[]): number {
  const sorted = [...spends].sort((a, b) => b.spentMinor - a.spentMinor);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.1) - 1)]?.spentMinor ?? Infinity;
}

/** Which group one customer is in. */
export function valueLabel(row: Spend, vipCut: number, now = Date.now()): ValueLabel {
  const quiet = (now - Date.parse(row.lastAt)) / DAY;
  if (row.orders === 1) return quiet <= 30 ? 'new' : 'one_time';
  const gap = (Date.parse(row.lastAt) - Date.parse(row.firstAt)) / DAY / (row.orders - 1);
  if (quiet > 30 && quiet > Math.max(gap, 15) * 1.5) return 'at_risk';
  return row.spentMinor >= vipCut ? 'vip' : 'regular';
}

/**
 * When a regular is likely to order next: their last order plus their usual
 * gap. Null for anybody with a single order - one order has no rhythm.
 */
export function nextOrderDue(row: Spend): string | null {
  if (row.orders < 2) return null;
  const gap = (Date.parse(row.lastAt) - Date.parse(row.firstAt)) / (row.orders - 1);
  return new Date(Date.parse(row.lastAt) + gap).toISOString();
}

/* ── Where an order came from ──────────────────────────────────────────── */

export const ORDER_SOURCES = ['affiliate', 'shared', 'channel', 'sale', 'private', 'preorder', 'shop'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  affiliate: 'Affiliate link',
  shared: 'Shared by a buyer',
  channel: 'Channel or post',
  sale: 'Scheduled sale',
  private: 'Private deal',
  preorder: 'Pre-order',
  shop: 'Shop & catalog',
};

/** Where one order came through, by the marks it carries. */
export function orderSource(
  order: Pick<Order, 'affiliate' | 'broughtBy' | 'fromPost' | 'privateDeal' | 'listingId'>,
  facts: { saleListings?: ReadonlySet<string>; preOrderListings?: ReadonlySet<string> } = {},
): OrderSource {
  if (order.affiliate) return 'affiliate';
  if (order.broughtBy) return 'shared';
  if (order.privateDeal) return 'private';
  if (facts.saleListings?.has(order.listingId)) return 'sale';
  if (order.fromPost) return 'channel';
  if (facts.preOrderListings?.has(order.listingId)) return 'preorder';
  return 'shop';
}

/* ── How a customer pays and keeps their word ──────────────────────────── */

export interface Reliability {
  /** Median hours from placing an order to its first payment; null with nothing paid. */
  payHours: number | null;
  /** Orders paid in full. */
  paidUp: number;
  /** Orders the buyer or seller called off, or the seller turned down. */
  cancelled: number;
  /** Bookings or checkouts placed and never paid, older than a week. */
  neverPaid: number;
  /** Disputes raised on their orders. */
  disputes: number;
  /** Payment claims the shop found had not arrived. */
  deniedClaims: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One customer's record with this shop, from their orders. */
export function reliabilityOf(orders: readonly Order[], now = Date.now()): Reliability {
  const payHours: number[] = [];
  let paidUp = 0;
  let cancelled = 0;
  let neverPaid = 0;
  let disputes = 0;
  let deniedClaims = 0;
  for (const order of orders) {
    if (order.placedAt === null) continue;
    const firstPaid = (order.payments ?? []).filter((payment) => payment.kind !== 'refund').map((payment) => payment.at).sort()[0];
    if (firstPaid) payHours.push(Math.max(0, (Date.parse(firstPaid) - Date.parse(placedOf(order))) / 3_600_000));
    if (order.paymentStatus === 'paid') paidUp += 1;
    if (order.status === 'cancelled' || order.status === 'rejected' || order.status === 'cancelled_reversed') cancelled += 1;
    else if (order.paymentStatus === 'unpaid' && !firstPaid && now - Date.parse(placedOf(order)) > 7 * DAY && !GONE_STATUSES.has(order.status)) neverPaid += 1;
    disputes += order.disputeLinks?.length ?? 0;
    if (order.paymentClaim?.decision === 'denied') deniedClaims += 1;
  }
  const hours = median(payHours);
  return { payHours: hours === null ? null : Math.round(hours * 10) / 10, paidUp, cancelled, neverPaid, disputes, deniedClaims };
}

/** "Pays within a day" and its like: the record in a few words, for a list row. */
export function reliabilityWord(record: Reliability): { word: string; tone: 'ok' | 'warn' | 'neutral' } {
  if (record.disputes > 0 || record.deniedClaims > 0 || record.neverPaid > 1) return { word: 'Check first', tone: 'warn' };
  if (record.payHours === null) return record.paidUp > 0 ? { word: 'Paid up', tone: 'ok' } : { word: 'No payments yet', tone: 'neutral' };
  if (record.payHours <= 24) return { word: 'Pays within a day', tone: 'ok' };
  if (record.payHours <= 72) return { word: 'Pays within 3 days', tone: 'ok' };
  return { word: 'Slow to pay', tone: 'warn' };
}

/* ── Where each customer got stuck ─────────────────────────────────────── */

/** The steps from noticing an item to reviewing it, in order. */
export const PATH_STEPS = ['saved', 'checkout', 'ordered', 'paid', 'delivered', 'reviewed'] as const;
export type PathStep = (typeof PATH_STEPS)[number];

export const PATH_STEP_LABELS: Record<PathStep, string> = {
  saved: 'Saved',
  checkout: 'Pressed Buy',
  ordered: 'Ordered',
  paid: 'Paid',
  delivered: 'Delivered',
  reviewed: 'Reviewed',
};

/** The furthest step one customer reached on one item. */
export function furthestStep(facts: {
  saved: boolean; checkout: boolean; order: Pick<Order, 'placedAt' | 'paymentStatus' | 'status' | 'completedAt'> | null; reviewed: boolean;
}): PathStep | null {
  const { order } = facts;
  if (facts.reviewed) return 'reviewed';
  if (order && (order.completedAt || order.status === 'delivered')) return 'delivered';
  if (order && order.paymentStatus === 'paid') return 'paid';
  if (order && order.placedAt !== null && !GONE_STATUSES.has(order.status as OrderStatus)) return 'ordered';
  if (facts.checkout || (order && order.placedAt === null)) return 'checkout';
  if (facts.saved) return 'saved';
  return null;
}

/* ── How fast the shop answers ─────────────────────────────────────────── */

export interface ReplyTimes {
  /** Median hours from a booking being placed to the shop accepting or turning it down. */
  bookingHours: number | null;
  bookings: number;
  /** Median hours from a buyer saying they paid to the shop confirming or denying it. */
  claimHours: number | null;
  claims: number;
  /** Claims and bookings still unanswered after a day. */
  waitingOverDay: number;
}

export function replyTimes(orders: readonly Order[], now = Date.now()): ReplyTimes {
  const booking: number[] = [];
  const claim: number[] = [];
  let waiting = 0;
  for (const order of orders) {
    if (order.placedAt === null) continue;
    if (order.bookingOnly) {
      const answered = order.acceptedAt ?? (order.status === 'rejected' ? order.updatedAt : null);
      if (answered) booking.push(Math.max(0, (Date.parse(answered) - Date.parse(placedOf(order))) / 3_600_000));
      else if (!GONE_STATUSES.has(order.status) && now - Date.parse(placedOf(order)) > DAY) waiting += 1;
    }
    const asked = order.paymentClaim;
    if (asked) {
      if (asked.decidedAt) claim.push(Math.max(0, (Date.parse(asked.decidedAt) - Date.parse(asked.claimedAt)) / 3_600_000));
      else if (now - Date.parse(asked.claimedAt) > DAY) waiting += 1;
    }
  }
  const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
  return {
    bookingHours: round(median(booking)), bookings: booking.length,
    claimHours: round(median(claim)), claims: claim.length,
    waitingOverDay: waiting,
  };
}

/** Answers a shop needs before its confirm time is shown. */
export const CONFIRM_MIN_ANSWERS = 3;

/**
 * The shop's public confirm time: median hours from a booking or a payment
 * claim to the shop answering it, over the last `days`. Null below
 * CONFIRM_MIN_ANSWERS, so one quick reply is not a promise.
 */
export function confirmHours(orders: readonly Order[], now = Date.now(), days = 90): number | null {
  const since = now - days * DAY;
  const recent = orders.filter((order) => order.placedAt !== null && Date.parse(placedOf(order)) >= since);
  const answers: number[] = [];
  for (const order of recent) {
    if (order.bookingOnly) {
      const answered = order.acceptedAt ?? (order.status === 'rejected' ? order.updatedAt : null);
      if (answered) answers.push(Math.max(0, (Date.parse(answered) - Date.parse(placedOf(order))) / 3_600_000));
    }
    const asked = order.paymentClaim;
    if (asked?.decidedAt) answers.push(Math.max(0, (Date.parse(asked.decidedAt) - Date.parse(asked.claimedAt)) / 3_600_000));
  }
  if (answers.length < CONFIRM_MIN_ANSWERS) return null;
  const value = median(answers);
  return value === null ? null : Math.round(value * 10) / 10;
}

/** "Under 1h", "5h", "2 days": a confirm time as a buyer reads it. */
export function confirmLabel(hours: number): string {
  if (hours < 1) return 'Under 1h';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
}

/* ── Interests ─────────────────────────────────────────────────────────── */

export interface Interest {
  /** Categories and tags, strongest first: an order counts three, a save one. */
  topics: { name: string; weight: number }[];
  /** The price range they buy and save in, in paise; null with nothing to go on. */
  priceBand: { lowMinor: number; highMinor: number } | null;
}

/** What one customer is into, from what they bought and saved here. */
export function interestOf(
  bought: readonly { category: string; tags: readonly string[]; priceMinor: number }[],
  saved: readonly { category: string; tags: readonly string[]; priceMinor: number }[],
): Interest {
  const weights = new Map<string, number>();
  const add = (name: string, weight: number) => {
    const key = name.trim();
    if (key) weights.set(key, (weights.get(key) ?? 0) + weight);
  };
  for (const item of bought) { add(item.category, 3); for (const tag of item.tags) add(`#${tag}`, 3); }
  for (const item of saved) { add(item.category, 1); for (const tag of item.tags) add(`#${tag}`, 1); }
  const prices = [...bought, ...saved].map((item) => item.priceMinor).filter((price) => price > 0).sort((a, b) => a - b);
  const at = (q: number) => prices[Math.min(prices.length - 1, Math.max(0, Math.round(q * (prices.length - 1))))]!;
  return {
    topics: [...weights].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, weight]) => ({ name, weight })),
    priceBand: prices.length ? { lowMinor: at(0.1), highMinor: at(0.9) } : null,
  };
}

/**
 * How well an item suits one customer's interests, 0-1: the share of the
 * item's category and tags they care about, weighted by how much, and whether
 * the price is in their range.
 */
export function matchScore(interest: Interest, item: { category: string; tags: readonly string[]; priceMinor: number }): number {
  if (interest.topics.length === 0) return 0;
  const strongest = interest.topics[0]!.weight;
  const topicWeight = new Map(interest.topics.map((topic) => [topic.name, topic.weight / strongest]));
  const names = [item.category, ...item.tags.map((tag) => `#${tag}`)];
  const topical = Math.max(0, ...names.map((name) => topicWeight.get(name) ?? 0));
  if (topical === 0) return 0;
  const band = interest.priceBand;
  const priced = !band ? 0.7
    : item.priceMinor >= band.lowMinor * 0.7 && item.priceMinor <= band.highMinor * 1.3 ? 1 : 0.4;
  return Math.round(topical * priced * 100) / 100;
}

/** What one customer still owes this shop. */
export function owedBy(orders: readonly Order[]): number {
  return orders
    .filter((order) => order.placedAt !== null && !GONE_STATUSES.has(order.status))
    .reduce((sum, order) => sum + orderMoney(order).outstandingMinor, 0);
}
