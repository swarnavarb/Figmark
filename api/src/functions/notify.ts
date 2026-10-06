import { randomUUID } from 'node:crypto';
import type { Notification, NotificationKind, Order, SellerProfile, User } from '../../../shared/models.js';
import { actorName, gistOf, toWhom } from '../../../shared/notifications.js';
import { expandPermissions } from '../../../shared/stores.js';
import type { StorePermission } from '../../../shared/enums.js';
import type { getRepository } from '../data/index.js';
import { isVisibleNotice, pushNotice, sendHeldPushesAt } from '../push.js';

/**
 * Telling somebody something happened.
 *
 * One helper because every caller has the same three obligations and they are
 * easy to forget one at a time: never tell somebody about their own action,
 * never let a failed notification undo the thing it was about, and always
 * carry somewhere to go.
 *
 * That last one is the rule that makes the bell worth having. A row that says
 * "your order changed" and leaves the reader to find which order is an
 * interruption; one that opens the order is a message.
 *
 * It is also the one place a notice goes out to the person's phone (see
 * push.ts), so every event that reaches the bell reaches the lock screen.
 */
type Repo = Awaited<ReturnType<typeof getRepository>>;

export interface NoticeDraft {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where tapping it goes, as an in-app route. */
  link: string;
  /**
   * Fold into an unread notice about the same thing instead of adding a row.
   *
   * `key` names the thing (a conversation, a post's likes) and must be unique
   * to it; `title` says the collected events, given how many there are and
   * who did them, newest first. Without it every event is a row of its own.
   */
  group?: {
    key: string;
    actor: string;
    title: (collected: { count: number; actors: string[] }) => string;
  };
}

/** How many unread rows to look through for one to fold into. */
const GROUP_LOOKBACK = 30;
/** Names kept on a folded notice: enough for "and 3 others" to stay true. */
const GROUP_ACTORS_MAX = 50;

/**
 * Write one notice to each person, minus whoever caused it.
 *
 * Failures are swallowed per person. A notification that could not be written
 * must never roll back the payment, dispute or answer it was reporting - the
 * thing that happened has happened, and the worst case here is somebody has to
 * look for themselves.
 */
export async function notify(
  repository: Repo,
  audience: readonly (string | null | undefined)[],
  draft: NoticeDraft,
  options: { except?: string; notBefore?: string; undoId?: string } = {},
): Promise<void> {
  const now = new Date().toISOString();
  // Held while its step can still be undone: the clock sends it when the hold
  // ends, unless it has been taken back by then.
  const held = Boolean(options.notBefore && Date.parse(options.notBefore) > Date.now());
  const people = new Set(
    audience.filter((id): id is string => Boolean(id) && id !== options.except),
  );

  await Promise.all(
    [...people].map(async (userId) => {
      try {
        const folded = draft.group && !held ? await foldInto(repository, userId, draft, now) : null;
        const notice: Notification = folded ?? {
          id: `ntf_${randomUUID().slice(0, 12)}`,
          userId,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          link: draft.link,
          readAt: null,
          ...(options.notBefore ? { notBefore: options.notBefore } : {}),
          ...(options.undoId ? { undoId: options.undoId } : {}),
          ...(held ? {} : { pushedAt: now }),
          ...(draft.group ? { group: draft.group.key, count: 1, actors: [draft.group.actor] } : {}),
          createdAt: now,
          updatedAt: now,
        };
        await repository.saveNotification(notice);
        if (!held) await pushNotice(repository, notice);
      } catch {
        // One person's missing notice is not a reason to fail the thing it was
        // about, which is already done.
      }
    }),
  );
  if (held && people.size > 0) sendHeldPushesAt(repository, options.notBefore!);
}

/**
 * The unread notice about the same thing, brought up to date with this event,
 * or null when there is none to fold into.
 *
 * Only unread ones: once somebody has seen "Arjun sent you 3 messages", the
 * fourth is news again and gets a row of its own. It moves to the top, as the
 * newest thing that happened.
 */
async function foldInto(repository: Repo, userId: string, draft: NoticeDraft, now: string): Promise<Notification | null> {
  const group = draft.group!;
  const existing = (await repository.listNotifications(userId, GROUP_LOOKBACK))
    .find((row) => row.group === group.key && row.readAt === null && isVisibleNotice(row));
  if (!existing) return null;
  const count = (existing.count ?? 1) + 1;
  const actors = [group.actor, ...(existing.actors ?? []).filter((name) => name !== group.actor)].slice(0, GROUP_ACTORS_MAX);
  return {
    ...existing,
    kind: draft.kind,
    title: group.title({ count, actors }),
    body: draft.body,
    link: draft.link,
    count,
    actors,
    pushedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Mark a group read for one person, as when they open the conversation it is
 * about: reading the messages is reading the news of them.
 */
export async function readGroup(repository: Repo, userId: string, key: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    const rows = (await repository.listNotifications(userId, GROUP_LOOKBACK))
      .filter((row) => row.group === key && row.readAt === null);
    await Promise.all(rows.map((row) => repository.saveNotification({ ...row, readAt: now, updatedAt: now })));
  } catch {
    // The bell still has it; tapping it reads it.
  }
}

/**
 * Everybody who hears about a store's news: its owner, and the people they
 * gave the right that the news is about - whoever posts as the store hears
 * what is said to it.
 */
export function storeCrew(
  owner: Pick<User, 'id'> & { sellerProfile: SellerProfile | null },
  permission: StorePermission = 'posts',
): string[] {
  const managers = (owner.sellerProfile?.managers ?? [])
    .filter((entry) => expandPermissions(entry.permissions).includes(permission))
    .map((entry) => entry.userId);
  return [owner.id, ...managers];
}

/**
 * The two sides of an order, as notices about it name them.
 *
 * `buyer` and `shop` are who did something ("Arjun paid", "Kaiju Imports
 * accepted"); `forShop` is the shop as its own people read it - its name, or
 * "your store" when the name is too long - so somebody who both buys and runs
 * a shop can tell at a glance which side of an order a notice is about.
 */
export interface OrderNames {
  buyer: string;
  shop: string;
  forShop: string;
}

export async function orderNames(repository: Repo, order: Pick<Order, 'buyerId' | 'sellerId'>): Promise<OrderNames> {
  const [buyer, seller] = await Promise.all([repository.getUserById(order.buyerId), repository.getUserById(order.sellerId)]);
  const storeName = seller?.sellerProfile?.storefrontName ?? seller?.displayName ?? null;
  return {
    buyer: buyer ? actorName(buyer.displayName, buyer.username) : 'Your buyer',
    shop: storeName ? actorName(storeName, seller?.sellerProfile?.username) : 'The shop',
    forShop: toWhom(storeName ?? 'your store'),
  };
}

/**
 * One event on an order, told to each side in its own words: the buyer reads
 * "Your dispute with Kaiju Imports was settled", the shop reads "Arjun's
 * dispute with Kaiju Imports was settled". A side left out is not told.
 */
export async function notifySides(
  repository: Repo,
  order: Pick<Order, 'buyerId' | 'sellerId'> & { protection?: { escrowAgentId?: string | null } | null },
  drafts: {
    buyer?: (names: OrderNames) => NoticeDraft;
    seller?: (names: OrderNames) => NoticeDraft;
    agent?: (names: OrderNames) => NoticeDraft;
  },
  options: { except?: string } = {},
): Promise<void> {
  const names = await orderNames(repository, order);
  const agent = order.protection?.escrowAgentId ?? null;
  await Promise.all([
    drafts.buyer ? notify(repository, [order.buyerId], drafts.buyer(names), options) : null,
    drafts.seller ? notify(repository, [order.sellerId], drafts.seller(names), options) : null,
    drafts.agent && agent ? notify(repository, [agent], drafts.agent(names), options) : null,
  ]);
}

/** The first letter up, for a name that opens a sentence: "your store's" → "Your store's". */
export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * News about items on their way, told to each buyer about their own.
 *
 * A lot carries many people's purchases, and "Lot 7: cleared customs" makes
 * every one of them work out whether it is theirs and from which shop. This
 * says "Godzilla 1954 from Kaiju Imports: cleared customs", or "your 3 items"
 * for somebody with several, and opens their order when there is one.
 *
 * `track` folds a lot's updates into one row per buyer while unread, showing
 * the latest: five steps in an afternoon is one thing to look at, not five.
 */
export async function notifyBuyers(
  repository: Repo,
  orders: readonly Pick<Order, 'id' | 'buyerId' | 'sellerId' | 'itemName'>[],
  make: (what: { items: string; shop: string }) => { kind: NotificationKind; title: string; body: string },
  options: { except?: string; notBefore?: string; undoId?: string; track?: string } = {},
): Promise<void> {
  const byBuyer = new Map<string, typeof orders[number][]>();
  for (const order of orders) byBuyer.set(order.buyerId, [...(byBuyer.get(order.buyerId) ?? []), order]);
  if (byBuyer.size === 0) return;
  const first = orders[0]!;
  const names = await orderNames(repository, first);
  await Promise.all([...byBuyer.entries()].map(([buyerId, theirs]) => {
    const items = theirs.length === 1 ? gistOf(theirs[0]!.itemName, 'your item', 40) : `your ${theirs.length} items`;
    const draft = make({ items, shop: names.shop });
    return notify(repository, [buyerId], {
      ...draft,
      link: theirs.length === 1 ? `/order/${encodeURIComponent(theirs[0]!.id)}` : '/me?tab=purchases',
      ...(options.track ? { group: { key: `track:${options.track}`, actor: names.shop, title: () => draft.title } } : {}),
    }, options);
  }));
}
