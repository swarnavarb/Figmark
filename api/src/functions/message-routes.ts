import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { checkUsername, threadIdFor, USERNAME_PROBLEMS } from '../../../shared/handles.js';
import type { Listing, Message, MessageDeal, MessageItem, MessageParty, User } from '../../../shared/models.js';
import type { DealState } from '../../../shared/deals.js';
import { isExpired, isMultiple } from '../../../shared/payments.js';
import { reviewRevealed } from '../../../shared/orders.js';
import {
  buyerTag, mergedRating, personFollowId, reviewSide, storeLevel, storeStickers, storeTag,
} from '../../../shared/storefront.js';
import { moderation } from '../moderation.js';
import { accessFor } from '../../../shared/stores.js';
import { isReaction } from '../../../shared/social.js';
import { getAuthService } from '../auth/index.js';
import { tooFast } from '../rate-limit.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { affiliateUnitMinor } from '../../../shared/affiliate.js';
import { storeFactsFrom } from '../store-facts.js';

/**
 * The handle namespace, and the messages addressed through it.
 *
 * The unit is a handle, not an account, because a storefront is a voice of its
 * own: an owner writing as their shop is saying something different from the
 * same person writing as themselves, and whoever reads it needs to be able to
 * tell. So a thread is between two handles, and the account behind each is
 * recorded alongside rather than instead.
 *
 * People and shops draw from one namespace, so resolving a handle and claiming
 * a personal one live here too - the shop's own is claimed alongside the rest
 * of the storefront, which is where its owner goes to change it.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Every handle this account may speak as: their own, plus stores they run. */
async function handlesFor(userId: string, repository: Repo): Promise<MessageParty[]> {
  const me = await repository.getUserById(userId);
  if (!me) return [];

  const parties: MessageParty[] = [];
  if (me.username) {
    parties.push({ handle: me.username, userId: me.id, isStore: false, displayName: me.displayName });
  }

  // Speaking as a store needs the `posts` right, which is the same permission
  // that lets someone put words in the shop's mouth publicly.
  const own = me.sellerProfile?.username;
  if (own) {
    parties.push({
      handle: own, userId: me.id, isStore: true,
      displayName: me.sellerProfile!.storefrontName,
    });
  }
  for (const owner of await repository.listStoreOwners()) {
    if (owner.id === userId) continue;
    const access = accessFor(owner, userId);
    if (!access?.permissions.includes('posts')) continue;
    const handle = owner.sellerProfile?.username;
    if (handle) {
      parties.push({
        handle, userId: owner.id, isStore: true,
        displayName: owner.sellerProfile!.storefrontName,
      });
    }
  }
  return parties;
}

/**
 * Which of your voices a conversation with someone is already on.
 *
 * Only used when the caller did not name one: a link to `/messages/arjun`
 * should land in the conversation that exists rather than opening a second,
 * empty one under a different handle. Falls back to your own name, which is
 * who a first message is from unless you say otherwise.
 */
async function defaultVoice(
  mine: MessageParty[],
  them: string,
  repository: Repo,
): Promise<MessageParty> {
  const byHandle = new Map(mine.map((party) => [party.handle, party]));
  const messages = await repository.listMessagesForHandles([...byHandle.keys()]);

  let latest: { at: string; us: MessageParty } | null = null;
  for (const message of messages) {
    const usIsSender = byHandle.has(message.from.handle);
    const other = usIsSender ? message.to.handle : message.from.handle;
    if (other !== them) continue;
    const us = usIsSender ? byHandle.get(message.from.handle)! : byHandle.get(message.to.handle)!;
    if (!latest || message.createdAt > latest.at) latest = { at: message.createdAt, us };
  }

  return latest?.us ?? mine.find((party) => !party.isStore) ?? mine[0]!;
}

/** The party a username resolves to, or null when nobody holds it. */
async function partyFor(username: string, repository: Repo): Promise<MessageParty | null> {
  const found = await repository.getByHandle(username);
  if (!found) return null;
  const { user, isStore } = found;
  return {
    handle: username.trim().toLowerCase(),
    userId: user.id,
    isStore,
    displayName: isStore ? (user.sellerProfile?.storefrontName ?? user.displayName) : user.displayName,
    level: isStore ? storeTag(user.sellerProfile?.levelCache) : buyerTag(user.quest?.levelCache),
  };
}

/**
 * GET /api/messages - the inbox.
 *
 * One row per thread, newest first, across every handle this account speaks as -
 * so an owner sees their own conversations and their shop's in one list, each
 * labelled with which of their voices it belongs to.
 */
async function inbox(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const mine = await handlesFor(user.id, repository);
  const byHandle = new Map(mine.map((party) => [party.handle, party]));
  const [messages, me] = await Promise.all([
    repository.listMessagesForHandles([...byHandle.keys()]),
    repository.getUserById(user.id),
  ]);
  const blocked = new Set(me?.messageBlocks ?? []);
  const muted = new Set(me?.mutedThreads ?? []);

  // Newest message per thread wins the row; the rest are history.
  const threads = new Map<string, { message: Message; unread: number }>();
  for (const message of messages) {
    const existing = threads.get(message.threadId);
    const unread = !message.readAt && byHandle.has(message.to.handle) ? 1 : 0;
    if (!existing) {
      threads.set(message.threadId, { message, unread });
    } else {
      existing.unread += unread;
      if (message.createdAt > existing.message.createdAt) existing.message = message;
    }
  }

  const rows = [...threads.values()].map(({ message, unread }) => {
    // "Us" is whichever end of this thread is one of ours.
    const usIsSender = byHandle.has(message.from.handle);
    const isMuted = muted.has(message.threadId);
    return {
      threadId: message.threadId,
      us: usIsSender ? message.from : message.to,
      them: usIsSender ? message.to : message.from,
      lastMessage: message.body,
      lastAt: message.createdAt,
      lastFromUs: usIsSender,
      // A muted conversation is kept, not counted.
      unread: isMuted ? 0 : unread,
      muted: isMuted,
    };
  }).filter((row) => !blocked.has(row.them.userId));

  rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  // The names are snapshots; their levels are read fresh, in one batch.
  const people = new Map((await repository.listUsersByIds([...new Set(rows.map((row) => row.them.userId))]))
    .map((person: User) => [person.id, person]));
  for (const row of rows) {
    const person = people.get(row.them.userId);
    if (person) {
      row.them = {
        ...row.them,
        level: row.them.isStore ? storeTag(person.sellerProfile?.levelCache) : buyerTag(person.quest?.levelCache),
      };
    }
  }
  return json(200, { handles: mine, threads: rows });
}

/**
 * GET /api/messages/{handle}?as=<handle> - one conversation.
 *
 * `as` names which of the caller's voices this thread belongs to, because the
 * same two people have a different conversation when a shop is one end of it.
 */
async function thread(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const other = request.params.handle;
  if (!other) return error(400, 'invalid_handle', 'Name who the conversation is with.');

  const mine = await handlesFor(user.id, repository);
  if (mine.length === 0) return error(409, 'no_handle', 'Pick a username before messaging.');

  const them = await partyFor(other, repository);
  if (!them) return error(404, 'not_found', `Nobody holds @${other}.`);

  const asHandle = request.query.get('as')?.toLowerCase();
  const us = asHandle
    ? mine.find((party) => party.handle === asHandle)
    : await defaultVoice(mine, them.handle, repository);
  if (!us) return error(403, 'forbidden', 'That is not one of your handles.');
  if (them.handle === us.handle) return error(400, 'invalid_handle', 'You cannot message yourself.');

  const threadId = threadIdFor(us.handle, them.handle);
  // `before` pages back through a long conversation; `since` is the refresh
  // while it is open, and only carries what is new.
  const before = request.query.get('before') || undefined;
  const since = request.query.get('since') || null;
  const page = await repository.listMessages(threadId, THREAD_PAGE, before);
  // Inclusive, as `before` is: the app drops what it already has.
  const messages = since ? page.filter((message) => message.createdAt >= since) : page;
  // Writing read receipts is a write per message; only when there is one to write.
  if (!before && page.some((message) => message.to.handle === us.handle && !message.readAt)) {
    await repository.markThreadRead(threadId, us.handle);
  }
  const me = await repository.getUserById(user.id);

  // Every voice the caller has, so the thread can offer a switch rather than
  // making them go back to the inbox to change who is speaking.
  return json(200, {
    us, them, handles: mine, threadId, messages: await withLiveItems(messages, repository),
    /** Whether there is more to page back to. */
    more: !since && page.length === THREAD_PAGE,
    blocked: (me?.messageBlocks ?? []).includes(them.userId),
    muted: (me?.mutedThreads ?? []).includes(threadId),
  });
}

/** Where an item stands now, as a deal or an item talked about sees it. */
function stateOf(listing: Listing | null): DealState {
  if (!listing || listing.status === 'archived' || listing.status === 'draft') return 'gone';
  if (isExpired(listing)) return 'expired';
  if (listing.status === 'sold_out' || (!isMultiple(listing) && listing.quantityAvailable === 0)) return 'bought';
  return 'live';
}

/**
 * The deals and items in a page of messages, with where each stands now.
 *
 * The message keeps the snapshot it was sent with - what was offered is what
 * was offered - but whether it can still be bought, and until when, is read
 * from the item, so a card never offers something that has gone.
 */
async function withLiveItems(messages: Message[], repository: Repo): Promise<Message[]> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.deal?.kind === 'offer' && message.deal.listingId) ids.add(message.deal.listingId);
    if (message.item) ids.add(message.item.listingId);
  }
  if (ids.size === 0) return messages;
  const found = new Map<string, Listing | null>(
    await Promise.all([...ids].map(async (id) => [id, await repository.getListing(id)] as const)),
  );
  return messages.map((message) => {
    let next = message;
    if (message.deal?.kind === 'offer' && message.deal.listingId) {
      const listing = found.get(message.deal.listingId) ?? null;
      next = { ...next, deal: { ...message.deal, state: stateOf(listing), expiresAt: listing?.expiresAt ?? message.deal.expiresAt ?? null } };
    }
    if (message.item) {
      const listing = found.get(message.item.listingId) ?? null;
      const state = stateOf(listing);
      next = {
        ...next,
        item: {
          ...message.item, state,
          ...(listing && listing.priceMinor !== message.item.priceMinor ? { nowMinor: listing.priceMinor } : {}),
        },
      };
    }
    return next;
  });
}

/** How many messages a conversation opens with, and each page back adds. */
const THREAD_PAGE = 60;

/**
 * Whether `from` may write to `to` at all: neither end has blocked the other.
 *
 * Checked by account, both ways round. Blocking somebody also stops you
 * writing to them - a conversation where only one side can speak is not one.
 */
async function blockedBetween(fromUserId: string, to: MessageParty, repository: Repo): Promise<'you' | 'them' | null> {
  const [sender, recipient] = await Promise.all([repository.getUserById(fromUserId), repository.getUserById(to.userId)]);
  if ((sender?.messageBlocks ?? []).includes(to.userId)) return 'you';
  if ((recipient?.messageBlocks ?? []).includes(fromUserId)) return 'them';
  return null;
}

/**
 * POST /api/messages/{handle}/block - stop, or start again, taking messages from them.
 *
 * `{ block: true | false }`. By account, so their shop is blocked with them.
 */
async function block(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const them = request.params.handle ? await partyFor(request.params.handle, repository) : null;
  if (!them) return error(404, 'not_found', 'Nobody holds that handle.');
  if (them.userId === user.id) return error(400, 'invalid_handle', 'You cannot block yourself.');
  let body: { block?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (typeof body.block !== 'boolean') return error(400, 'invalid_body', 'Say block: true or false.');
  const me = await repository.getUserById(user.id);
  if (!me) return error(404, 'not_found', 'No such account.');
  const blocks = new Set(me.messageBlocks ?? []);
  if (body.block) blocks.add(them.userId);
  else blocks.delete(them.userId);
  await repository.updateUser({ ...me, messageBlocks: [...blocks], updatedAt: new Date().toISOString() });
  return json(200, { blocked: body.block });
}

/**
 * POST /api/messages/{handle}/mute?as=<handle> - keep the conversation, stop counting it.
 *
 * `{ mute: true | false }`. Per conversation, so muting a shop's thread with
 * somebody leaves your own one with them alone.
 */
async function mute(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const them = request.params.handle ? await partyFor(request.params.handle, repository) : null;
  if (!them) return error(404, 'not_found', 'Nobody holds that handle.');
  let body: { mute?: unknown; as?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (typeof body.mute !== 'boolean') return error(400, 'invalid_body', 'Say mute: true or false.');
  const mine = await handlesFor(user.id, repository);
  const us = typeof body.as === 'string'
    ? mine.find((party) => party.handle === (body.as as string).toLowerCase())
    : await defaultVoice(mine, them.handle, repository);
  if (!us) return error(403, 'forbidden', 'That is not one of your handles.');
  const threadId = threadIdFor(us.handle, them.handle);
  const me = await repository.getUserById(user.id);
  if (!me) return error(404, 'not_found', 'No such account.');
  const muted = new Set(me.mutedThreads ?? []);
  if (body.mute) muted.add(threadId);
  else muted.delete(threadId);
  await repository.updateUser({ ...me, mutedThreads: [...muted], updatedAt: new Date().toISOString() });
  return json(200, { muted: body.mute });
}

/** POST /api/messages/{handle}/send - say something, as one of your handles. */
async function send(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const other = request.params.handle;
  if (!other) return error(400, 'invalid_handle', 'Name who this is for.');

  let body: {
    body?: string; as?: string; deal?: Partial<MessageDeal> | null; replyToId?: string | null;
    /** An item this message is about: one either side of the chat sells. */
    itemId?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  let text = body.body?.trim() ?? '';
  if (!text && !body.deal && !body.itemId) return error(400, 'invalid_message', 'Write something first.');
  if (text.length > 4000) return error(400, 'invalid_message', 'Keep a message under 4000 characters.');
  const slow = tooFast(user.id, 'message');
  if (slow) return slow;

  const mine = await handlesFor(user.id, repository);
  if (mine.length === 0) return error(409, 'no_handle', 'Pick a username before messaging.');

  const them = await partyFor(other, repository);
  if (!them) return error(404, 'not_found', `Nobody holds @${other}.`);

  const us = body.as
    ? mine.find((party) => party.handle === body.as!.toLowerCase())
    : await defaultVoice(mine, them.handle, repository);
  if (!us) return error(403, 'forbidden', 'That is not one of your handles.');
  if (them.handle === us.handle) return error(400, 'invalid_handle', 'You cannot message yourself.');
  const wall = await blockedBetween(user.id, them, repository);
  if (wall === 'you') return error(403, 'blocked', `You blocked @${them.handle}. Unblock them to write.`);
  // Not saying who blocked whom: being told is its own message.
  if (wall === 'them') return error(403, 'blocked', `@${them.handle} is not taking messages from you.`);

  // A private deal, either way round. An offer is the shop's: an item made
  // for this buyer alone, bought like any other. A request is the buyer's:
  // what they want and roughly for how much, for the shop to answer with one.
  let deal: MessageDeal | null = null;
  if (body.deal?.kind === 'offer') {
    const listing = body.deal.listingId ? await repository.getListing(body.deal.listingId) : null;
    if (!us.isStore || !listing || listing.privateFor !== them.userId || listing.sellerId !== us.userId) {
      return error(400, 'invalid_deal', 'Make the private deal for this buyer first.');
    }
    const photo = listing.photos.find((row) => row.isPrimary) ?? listing.photos[0];
    deal = {
      kind: 'offer', listingId: listing.id, title: listing.title, priceMinor: listing.priceMinor,
      quantity: listing.quantityAvailable, photo: photo?.url || null,
      expiresAt: listing.expiresAt ?? null,
      wasMinor: listing.dealFrom && listing.dealFrom.priceMinor !== listing.priceMinor ? listing.dealFrom.priceMinor : null,
    };
    text ||= `Private deal for you: ${listing.title}`;
  } else if (body.deal?.kind === 'request') {
    if (!them.isStore) return error(400, 'invalid_deal', 'Ask a shop for a private deal.');
    const title = body.deal.title?.toString().trim().slice(0, 120);
    if (!title) return error(400, 'invalid_deal', 'Say what you are looking for.');
    deal = {
      kind: 'request', listingId: null, title,
      priceMinor: Math.max(0, Math.round(Number(body.deal.priceMinor) || 0)),
      quantity: Math.min(999, Math.max(1, Math.round(Number(body.deal.quantity) || 1))),
      photo: null,
    };
    text ||= `Asking for a private deal: ${title}`;
  } else if (body.deal) {
    return error(400, 'invalid_deal', 'A deal is an offer or a request.');
  }

  // An item the message is about: one this chat's shop sells, and that the
  // writer can see - a private deal is its own buyer's and its shop's only.
  let item: MessageItem | null = null;
  if (body.itemId) {
    const listing = await repository.getListing(String(body.itemId));
    const sellers = new Set([us.userId, them.userId]);
    const visible = listing && listing.status !== 'draft' && listing.status !== 'archived'
      && sellers.has(listing.sellerId) && (!listing.privateFor || sellers.has(listing.privateFor));
    if (!listing || !visible) return error(404, 'not_found', 'That item is not one of theirs to ask about.');
    const photo = listing.photos.find((row) => row.isPrimary) ?? listing.photos[0];
    item = {
      listingId: listing.id, title: listing.title, photo: photo?.url || null,
      priceMinor: listing.priceMinor, currency: listing.currency, condition: listing.condition,
    };
    text ||= `About ${listing.title}`;
  }

  // Answering one message in particular: quoted, so the quote survives.
  const threadId = threadIdFor(us.handle, them.handle);
  let replyTo: Message['replyTo'] = null;
  if (typeof body.replyToId === 'string' && body.replyToId) {
    const original = (await repository.listMessages(threadId)).find((entry) => entry.id === body.replyToId);
    if (!original) return error(404, 'not_found', 'That message is not in this conversation.');
    const line = original.body.replace(/\s+/g, ' ').trim();
    replyTo = {
      id: original.id,
      name: original.from.displayName,
      body: line.length > 80 ? `${line.slice(0, 77)}…` : line,
    };
  }

  const now = new Date().toISOString();
  const message: Message = {
    id: `msg_${randomUUID().slice(0, 12)}`,
    threadId,
    from: us,
    to: them,
    body: text,
    readAt: null,
    ...(deal ? { deal } : {}),
    ...(item ? { item } : {}),
    ...(replyTo ? { replyTo } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const [sent] = await withLiveItems([await repository.sendMessage(message)], repository);
  return json(201, { message: sent });
}

/**
 * GET /api/messages/{handle}/items - the shop's own items, to make a deal from.
 *
 * Everything it has put up, sold out and expired included: an item that ran
 * out is exactly the one a buyer asks to have again. Not other buyers' private
 * deals, which are theirs.
 */
async function dealItems(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const mine = await handlesFor(user.id, repository);
  const asHandle = request.query.get('as')?.toLowerCase();
  const us = mine.find((party) => party.handle === asHandle);
  if (!us?.isStore) return error(403, 'forbidden', 'Make deals as one of your shops.');
  const listings = (await repository.listListings({ sellerId: us.userId, limit: 200, includeHidden: true }))
    .filter((listing) => (listing.status === 'active' || listing.status === 'sold_out') && !listing.privateFor)
    .map((listing) => ({ listing, state: stateOf(listing) }))
    .sort((a, b) => b.listing.createdAt.localeCompare(a.listing.createdAt));
  return json(200, {
    items: listings.map(({ listing, state }) => ({
      id: listing.id, title: listing.title, description: listing.description, category: listing.category,
      condition: listing.condition, priceMinor: listing.priceMinor, currency: listing.currency,
      quantityAvailable: listing.quantityAvailable, tags: listing.tags,
      photos: listing.photos.map((photo) => ({ blobName: photo.blobName, url: photo.url, isPrimary: photo.isPrimary })),
      state,
    })),
  });
}

/**
 * POST /api/messages/{handle}/react - react to one message, change it, or take it back.
 *
 * One reaction per handle, as everywhere else: the same reaction again takes
 * it back, a different one replaces it.
 */
async function reactToMessage(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const other = request.params.handle;
  if (!other) return error(400, 'invalid_handle', 'Name who the conversation is with.');

  let body: { messageId?: string; kind?: unknown; as?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (body.kind !== null && !isReaction(body.kind)) return error(400, 'invalid_reaction', 'No such reaction.');

  const mine = await handlesFor(user.id, repository);
  const them = await partyFor(other, repository);
  if (!them) return error(404, 'not_found', `Nobody holds @${other}.`);
  const us = body.as
    ? mine.find((party) => party.handle === body.as!.toLowerCase())
    : await defaultVoice(mine, them.handle, repository);
  if (!us) return error(403, 'forbidden', 'That is not one of your handles.');

  const message = (await repository.listMessages(threadIdFor(us.handle, them.handle)))
    .find((entry) => entry.id === body.messageId);
  if (!message) return error(404, 'not_found', 'That message is not in this conversation.');

  const others = (message.reactions ?? []).filter((entry) => entry.handle !== us.handle);
  const had = (message.reactions ?? []).find((entry) => entry.handle === us.handle)?.kind ?? null;
  message.reactions = body.kind && body.kind !== had ? [...others, { handle: us.handle, kind: body.kind }] : others;
  message.updatedAt = new Date().toISOString();
  const saved = await repository.updateMessage(message);
  return json(200, { reactions: saved.reactions ?? [] });
}

/**
 * GET /api/u/{handle} - the public page behind a username.
 *
 * One route for people and shops alike, because `/<username>` is one namespace:
 * what comes back says which it was, and the page renders accordingly.
 */
async function publicProfile(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const handle = request.params.handle;
  if (!handle) return error(400, 'invalid_handle', 'A username is required.');

  const found = await repository.getByHandle(handle);
  if (!found) return error(404, 'not_found', `Nobody holds @${handle}.`);

  const { user, isStore }: { user: User; isStore: boolean } = found;
  const side = isStore ? 'store' : 'person';
  const followId = isStore ? user.id : personFollowId(user.id);
  const auth = await getAuthService();
  // Everything the page needs in one round trip: the shelf, the rating the
  // slab shows, and whether this viewer follows it.
  const [viewer, all, tradeReviews, pageReviews, moderated, sales, posts] = await Promise.all([
    auth.getCurrentUser(request),
    // Every item they have put up, not one page of it, including what sold
    // out or ran out of time: the shelf shows those too, stamped.
    isStore ? repository.listListings({ sellerId: user.id, limit: 200, includeHidden: true }) : Promise.resolve([]),
    repository.listReviewsAbout(user.id),
    repository.listStoreReviews(user.id),
    moderation(repository),
    // A shop's level counts what it did to bring people in: sales through
    // affiliate links and what it posted to its followers.
    isStore ? repository.listOrdersForSeller(user.id) : Promise.resolve([]),
    isStore ? repository.listPosts(user.id, 200) : Promise.resolve([]),
  ]);
  const following = viewer
    ? (await repository.listFollowsBy(viewer.id)).some((follow) => follow.sellerId === followId)
    : false;

  // A shop is rated as a seller and a person as a buyer, each with the page
  // ratings left on that page, merged into the one figure the slab shows.
  const direction = isStore ? 'buyer_to_seller' : 'seller_to_buyer';
  const rating = mergedRating(
    tradeReviews.filter((review) => review.direction === direction && reviewRevealed(review, false)).map((review) => review.rating),
    pageReviews
      .filter((review) => !moderated.isRemoved('store_review', review.id))
      .filter((review) => reviewSide(review, Boolean(user.sellerProfile)) === side)
      .map((review) => review.rating),
  );

  // A person's page is about them; a shop's is about the shop. The two carry
  // different names, pictures and words, and reading the wrong set is how a
  // storefront ends up with somebody's personal bio on it.
  const shop = isStore ? user.sellerProfile : null;

  const now = Date.now();
  const stateOf = (listing: Listing): 'active' | 'sold' | 'expired' =>
    listing.status === 'sold_out' || listing.quantityAvailable === 0 ? 'sold'
      : listing.expiresAt && Date.parse(listing.expiresAt) <= now ? 'expired' : 'active';
  const ORDER = { active: 0, sold: 1, expired: 2 } as const;
  // Drafts, private deals and members-only drops are nobody else's business.
  const listings = all
    .filter((listing) => (listing.status === 'active' || listing.status === 'sold_out') && !listing.unlisted && !listing.privateFor)
    .map((listing) => ({ listing, state: stateOf(listing) }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  const count = (state: string) => listings.filter((entry) => entry.state === state).length;
  const followerCount = isStore ? (shop?.followerCount ?? 0) : (user.followerCount ?? 0);

  const facts = storeFactsFrom({
    user,
    all,
    sales,
    posts,
    rating,
    buyerReviews: tradeReviews.filter((review) => review.direction === 'buyer_to_seller' && reviewRevealed(review, false)),
    now,
  });
  const level = isStore ? storeLevel(facts, shop?.growth) : null;
  // Kept on the account so every name elsewhere can wear it without a recount.
  if (level && shop && shop.levelCache !== level.level) {
    shop.levelCache = level.level;
    await repository.updateUser(user);
  }

  return json(200, {
    handle: handle.toLowerCase(),
    isStore,
    displayName: shop?.storefrontName ?? user.displayName,
    bio: (isStore ? shop?.bio : user.bio) ?? '',
    photoUrl: shop?.photoUrl ?? null,
    coverUrl: (isStore ? shop?.coverUrl : user.coverUrl) ?? null,
    tags: (isStore ? shop?.tags : user.tags) ?? [],
    link: shop?.link ?? null,
    dispatchRegion: shop?.dispatchRegion ?? '',
    followerCount,
    following,
    rating,
    tier: shop?.tier ?? null,
    // The owner's own handle, so a shop page can point at the person behind it.
    ownerHandle: isStore ? (user.username ?? null) : null,
    sellerId: user.id,
    // The same Trust a listing's "Posted by" card shows, so the two never disagree.
    trustScore: isStore ? user.sellerTrust.score : null,
    level,
    stickers: isStore ? storeStickers(facts) : [],
    // The level and title shown beside the name: a shop's own, or the buyer's.
    levelTag: isStore ? storeTag(level?.level) : buyerTag(user.quest?.levelCache),
    memberSince: user.createdAt,
    lastSeenAt: user.lastSeenAt ?? null,
    /** What the tabs and chips count, so neither has to guess. */
    counts: { listings: listings.length, onSale: count('active'), sold: count('sold'), expired: count('expired') },
    // Active first, then sold out, then expired.
    listings: listings.map(({ listing, state }) => ({
      id: listing.id,
      title: listing.title,
      priceMinor: listing.priceMinor,
      currency: listing.currency,
      condition: listing.condition,
      quantityAvailable: listing.quantityAvailable,
      likeCount: listing.likeCount,
      state,
      // Highlighted on the card when sharing it pays a commission.
      affiliate: listing.affiliate && state === 'active'
        ? { amountMinor: affiliateUnitMinor(listing.affiliate, listing.priceMinor) } : null,
      // The lead picture only: the grid shows one, and the rest is weight.
      photos: (listing.photos ?? []).filter((photo, i, list) => photo.isPrimary || (i === 0 && !list.some((p) => p.isPrimary))).slice(0, 1),
    })),
  });
}

/**
 * POST /api/me/username - claim or change your own handle.
 *
 * Separate from the storefront's, because they are two addresses: the shop is
 * followed and bought from, the person behind it is not the same party. An
 * account that predates handles has none at all, which is the case this exists
 * to close.
 */
async function setUsername(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: { username?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const record = await repository.getUserById(user.id);
  if (!record) return error(404, 'not_found', 'This account no longer exists.');

  const wanted = (body.username ?? '').trim().toLowerCase();
  const problem = checkUsername(wanted);
  if (problem) return error(400, 'invalid_username', USERNAME_PROBLEMS[problem]);

  if (wanted !== record.username) {
    // The new one is held before the old is let go: a rename that frees first
    // can lose both if the name it wanted turns out to be taken.
    if (!(await repository.reserveHandle(wanted, record.id, false))) {
      return error(409, 'username_taken', `@${wanted} is already taken.`);
    }
    if (record.username) await repository.releaseHandle(record.username);
    record.username = wanted;
    record.updatedAt = new Date().toISOString();
    await repository.updateUser(record);
  }

  return json(200, { username: record.username });
}

export const inboxRoute = handler(inbox);
export const setUsernameRoute = handler(setUsername);
export const threadRoute = handler(thread);
export const sendMessageRoute = handler(send);
export const reactToMessageRoute = handler(reactToMessage);
export const blockRoute = handler(block);
export const muteRoute = handler(mute);
export const dealItemsRoute = handler(dealItems);
export const publicProfileRoute = handler(publicProfile);

const anon = { authLevel: 'anonymous' } as const;

app.http('messages-inbox', { ...anon, methods: ['GET'], route: 'messages', handler: inboxRoute });
app.http('messages-thread', { ...anon, methods: ['GET'], route: 'messages/{handle}', handler: threadRoute });
// A distinct template, not just a distinct method: the Functions host treats
// equivalent templates as a conflict regardless of verb.
app.http('messages-deal-items', { ...anon, methods: ['GET'], route: 'messages/{handle}/items', handler: dealItemsRoute });
app.http('messages-send', { ...anon, methods: ['POST'], route: 'messages/{handle}/send', handler: sendMessageRoute });
app.http('messages-react', { ...anon, methods: ['POST'], route: 'messages/{handle}/react', handler: reactToMessageRoute });
app.http('messages-block', { ...anon, methods: ['POST'], route: 'messages/{handle}/block', handler: blockRoute });
app.http('messages-mute', { ...anon, methods: ['POST'], route: 'messages/{handle}/mute', handler: muteRoute });
app.http('public-profile', { ...anon, methods: ['GET'], route: 'u/{handle}', handler: publicProfileRoute });
app.http('me-username', { ...anon, methods: ['POST'], route: 'me/username', handler: setUsernameRoute });
