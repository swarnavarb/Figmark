import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { FirstDibs, FirstDibsView, Listing } from '../../../shared/models.js';
import { actorName } from '../../../shared/notifications.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { notify } from './notify.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Two ways a buyer hears about stock before they would have found it:
 *
 * - "Tell me when it's back" on a sold-out item: a list on the listing, told
 *   the moment it goes from sold out to on sale, then emptied.
 * - First dibs for a stock poll's voters: a shop that lists what its poll
 *   asked for gives the people who voted for it a head start before anybody
 *   else may buy. They are told; everybody else sees when it opens.
 */

/** Most people one item will tell when it is back: a cap so one document stays small. */
export const RESTOCK_WATCH_MAX = 2000;

/** How long the voters of a stock poll have the item to themselves. */
export const FIRST_DIBS_HOURS = 24;

const listingLink = (listing: Pick<Listing, 'id'>) => `/listing/${listing.id}`;

/** The reader's side of an item's back-in-stock list. */
export function restockView(listing: Listing, viewerId: string | null) {
  const watch = listing.restockWatch ?? [];
  return { on: Boolean(viewerId && watch.includes(viewerId)), count: watch.length };
}

/** A first-dibs window as this reader may see it. */
export function firstDibsView(listing: Listing, viewerId: string | null): FirstDibsView | null {
  const dibs = listing.firstDibs;
  if (!dibs) return null;
  return {
    until: dibs.until,
    label: dibs.label,
    mine: Boolean(viewerId && (dibs.voterIds.includes(viewerId) || viewerId === listing.sellerId)),
    open: Date.parse(dibs.until) > Date.now(),
  };
}

/**
 * Tell whoever asked that an item is back. Called with the listing as it was
 * and as it is now, after any change that can put stock back: an edit, a
 * cancelled order returning its units.
 */
export async function tellRestocked(repository: Repo, before: Listing, after: Listing): Promise<number> {
  if (before.status !== 'sold_out' || after.status !== 'active') return 0;
  const watchers = after.restockWatch ?? [];
  if (watchers.length === 0) return 0;
  try {
    const shop = await repository.getUserById(after.sellerId);
    const shopName = shop?.sellerProfile?.storefrontName ?? 'The shop';
    await notify(repository, watchers, {
      kind: 'back_in_stock',
      title: `Back in stock: ${after.title}`,
      body: `${actorName(shopName)} has it again. You asked to be told.`,
      link: listingLink(after),
    });
    await repository.changeListing(after.id, after.sellerId, (current) => ({
      ...current,
      restockWatch: (current.restockWatch ?? []).filter((id) => !watchers.includes(id)),
    }));
  } catch {
    /* A missed alert is a pity, not a failure of the edit that caused it. */
  }
  return watchers.length;
}

/**
 * Tell the people who saved an item that it just got cheaper.
 *
 * A save is the buyer saying "not at this price, not yet"; a lower price is
 * the answer to that, and the one moment worth a notification. Only on a real
 * drop, never on a private deal, and never to the shop itself.
 */
export async function tellPriceDropped(repository: Repo, before: Listing, after: Listing): Promise<number> {
  if (after.privateFor || after.priceMinor >= before.priceMinor) return 0;
  try {
    const savers = [...new Set((await repository.listLikesForListings([after.id])).map((like) => like.userId))]
      .filter((id) => id !== after.sellerId);
    if (savers.length === 0) return 0;
    const shop = await repository.getUserById(after.sellerId);
    const shopName = shop?.sellerProfile?.storefrontName ?? 'The shop';
    const off = Math.round(((before.priceMinor - after.priceMinor) / before.priceMinor) * 100);
    await notify(repository, savers, {
      kind: 'price_drop',
      title: `Price drop: ${after.title}`,
      body: `${actorName(shopName)} cut it ${off > 0 ? `${off}% ` : ''}to ${rupees(after.priceMinor)}. You saved it.`,
      link: listingLink(after),
    }, { pushLater: true });
    return savers.length;
  } catch {
    /* A missed alert is a pity, not a failure of the edit that caused it. */
    return 0;
  }
}

/** Whole rupees, the way a notification line reads them. */
function rupees(minor: number): string {
  return `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;
}

/**
 * POST /api/listings/{id}/restock-alert - `{ on }`: be told when this sold-out
 * item is back, or stop. Not on your own item, and only while it is sold out.
 */
async function restockAlert(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const id = request.params.id;
  const listing = id ? await repository.getListing(id) : null;
  if (!listing || listing.privateFor) return error(404, 'not_found', 'No such listing.');
  if (listing.sellerId === user.id) return error(400, 'own_item', 'This is your own item.');
  let body: { on?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const on = body.on !== false;
  if (on && listing.status !== 'sold_out') return error(409, 'in_stock', 'It is on sale now - no need to wait.');
  if (on && (listing.restockWatch ?? []).length >= RESTOCK_WATCH_MAX) {
    return error(409, 'too_many', 'Too many people are waiting on this one already.');
  }
  const saved = await repository.changeListing(listing.id, listing.sellerId, (current) => {
    const others = (current.restockWatch ?? []).filter((who) => who !== user.id);
    return { ...current, restockWatch: on ? [...others, user.id] : others };
  });
  if (!saved) return error(404, 'not_found', 'No such listing.');
  return json(200, restockView(saved, user.id));
}

/**
 * Give a stock poll's voters first dibs on an item the shop just listed from
 * it, and tell them. `optionId` names the answer it is; without one, everybody
 * who voted gets it. Returns the window, or a message saying why not.
 */
export async function startFirstDibs(
  repository: Repo, sellerId: string, from: { channelId?: unknown; postId?: unknown; optionId?: unknown },
): Promise<{ dibs: FirstDibs; optionId: string | null } | string> {
  const channelId = typeof from.channelId === 'string' ? from.channelId : '';
  const postId = typeof from.postId === 'string' ? from.postId : '';
  const post = channelId && postId ? await repository.getPost(channelId, postId) : null;
  if (!post || !post.poll?.stock || post.channelId !== sellerId) return 'That is not one of your stock polls.';
  const optionId = typeof from.optionId === 'string' && from.optionId ? from.optionId : null;
  const option = optionId ? post.poll.options.find((entry) => entry.id === optionId) : null;
  if (optionId && !option) return 'That poll has no such answer.';
  const voters = (option ? [option] : post.poll.options)
    .flatMap((entry) => entry.voterIds)
    // A shop's vote is its owner's, and it is their own stock.
    .filter((id) => !id.startsWith('store:') && id !== sellerId);
  return {
    optionId,
    dibs: {
      until: new Date(Date.now() + FIRST_DIBS_HOURS * 3_600_000).toISOString(),
      voterIds: [...new Set(voters)],
      channelId,
      postId,
      label: option?.label ?? post.body.slice(0, 80),
    },
  };
}

/** Once the listing exists: mark the poll as stocked and tell the voters. */
export async function announceFirstDibs(repository: Repo, listing: Listing, optionId: string | null): Promise<void> {
  const dibs = listing.firstDibs;
  if (!dibs) return;
  const now = new Date().toISOString();
  await repository.mutatePost(dibs.channelId, dibs.postId, (current) => (current.poll ? {
    ...current,
    poll: { ...current.poll, stocked: [...(current.poll.stocked ?? []), { optionId, listingId: listing.id, at: now }] },
  } : null)).catch(() => null);
  if (dibs.voterIds.length === 0) return;
  const shop = await repository.getUserById(listing.sellerId);
  const shopName = shop?.sellerProfile?.storefrontName ?? 'A shop';
  await notify(repository, dibs.voterIds, {
    kind: 'first_dibs',
    title: `${actorName(shopName)} stocked what you voted for`,
    body: `${listing.title} - yours first for ${FIRST_DIBS_HOURS} hours, before anybody else can buy.`,
    link: listingLink(listing),
  });
}

export const restockAlertRoute = handler(restockAlert);

app.http('listing-restock-alert', {
  authLevel: 'anonymous', methods: ['POST'], route: 'listings/{id}/restock-alert', handler: restockAlertRoute,
});
