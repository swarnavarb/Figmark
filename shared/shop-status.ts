/**
 * Whether a shop is taking orders: open, paused or stopped.
 *
 * - open:    everything works.
 * - paused:  a short break - at most three days. The shop's items still show
 *            everywhere, but nobody can buy, book or pledge until it reopens.
 *            The pause lifts on its own when its time is up, so a shop that
 *            forgets does not stay shut.
 * - stopped: closed (the switch reads "Closed") until the shop says otherwise. Its items leave the Shop
 *            feed and search, but stay on its own page; nothing can be bought.
 *
 * Stored on the seller profile as `orderStatus`; absent reads as open.
 */
export type ShopOrderState = 'open' | 'paused' | 'stopped';

export const SHOP_ORDER_STATES: readonly ShopOrderState[] = ['stopped', 'paused', 'open'];

export interface ShopOrderStatus {
  state: ShopOrderState;
  /** ISO-8601. When a pause lifts on its own; null for open and stopped. */
  until: string | null;
  /** ISO-8601. When the shop last changed it. */
  at: string;
}

/** The longest a pause may run, in days. */
export const PAUSE_MAX_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The status as it stands now: a pause past its time reads as open. */
export function shopStatusOf(status: ShopOrderStatus | null | undefined, now = Date.now()): { state: ShopOrderState; until: string | null } {
  if (!status || status.state === 'open') return { state: 'open', until: null };
  if (status.state === 'paused') {
    if (!status.until || Date.parse(status.until) <= now) return { state: 'open', until: null };
    return { state: 'paused', until: status.until };
  }
  return { state: 'stopped', until: null };
}

/** Whether a buyer may place an order with this shop right now. */
export function takesOrders(status: ShopOrderStatus | null | undefined, now = Date.now()): boolean {
  return shopStatusOf(status, now).state === 'open';
}

/** Whether its items belong on the Shop feed and in search. */
export function listedInShop(status: ShopOrderStatus | null | undefined, now = Date.now()): boolean {
  return shopStatusOf(status, now).state !== 'stopped';
}

/**
 * The new status for a change the shop asked for. A pause takes 1 to 3 days
 * and is clamped there; open and stopped carry no end.
 */
export function nextShopStatus(state: ShopOrderState, pauseDays: number | undefined, now = Date.now()): ShopOrderStatus {
  const at = new Date(now).toISOString();
  if (state !== 'paused') return { state, until: null, at };
  const days = Math.min(PAUSE_MAX_DAYS, Math.max(1, Math.round(Number(pauseDays) || PAUSE_MAX_DAYS)));
  return { state, until: new Date(now + days * DAY_MS).toISOString(), at };
}

/** "3 days", "5 hours", "under an hour": how long until a pause lifts. */
export function timeLeft(until: string, now = Date.now()): string {
  const ms = Date.parse(until) - now;
  if (ms <= 60 * 60 * 1000) return 'under an hour';
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** The label on the shop's pill. */
export function shopStatusLabel(state: ShopOrderState): string {
  return state === 'open' ? 'Open for orders' : state === 'paused' ? 'Orders paused' : 'Shop closed';
}

/** What a buyer reads when they tap the pill, or when a purchase is refused. */
export function shopStatusMessage(status: { state: ShopOrderState; until: string | null }, now = Date.now()): string {
  if (status.state === 'open') return 'This shop is open for orders. Buy, book or pledge as usual.';
  if (status.state === 'paused') {
    const left = status.until ? ` It reopens in ${timeLeft(status.until, now)}.` : '';
    return `This shop has paused orders for a short break.${left} You can still browse, save and message it.`;
  }
  return 'This shop is closed right now and not taking orders. You can still browse its page, save items and message it.';
}

/** The refusal a purchase gets while the shop is not open, or null when it is. */
export function shopRefusal(status: ShopOrderStatus | null | undefined, now = Date.now()): string | null {
  const current = shopStatusOf(status, now);
  return current.state === 'open' ? null : shopStatusMessage(current, now);
}
