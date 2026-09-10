import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { FORUM_CAP } from '../../../shared/enums.js';
import type { Forum, Listing, Post, User } from '../../../shared/models.js';
import { can } from '../../../shared/stores.js';
import { personRef, sellerRef, type PartyRef } from '../../../shared/parties.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * The social side: what the people you follow are saying, and the forums.
 *
 * A seller channel and a forum are the same shape - an id with posts under it -
 * so they share one store and one set of routes. The difference is who may
 * write: a channel takes posts from its owner only, a forum from anyone.
 */

/** Enough of a listing to render a sale post without a second round trip. */
interface PostCard {
  post: Post;
  listing: Pick<Listing, 'id' | 'title' | 'priceMinor' | 'currency' | 'condition'> | null;
  /**
   * Where the author's name goes when tapped.
   *
   * Resolved on read rather than stored on the post: a post keeps the name as
   * it was written, which is right, but an address that was frozen a year ago
   * points at whoever holds that handle now. A shop post opens the shop, a
   * person's post opens the person - the same rule as everywhere else.
   */
  author: PartyRef;
}

async function decorate(posts: Post[], repository: Awaited<ReturnType<typeof getRepository>>): Promise<PostCard[]> {
  // A sale post is worth nothing without the item on it, and fetching them one
  // at a time would be a request per post.
  const ids = [...new Set(posts.map((p) => p.listingId).filter((id): id is string => id !== null))];
  const listings = new Map<string, Listing>();
  const [authors] = await Promise.all([
    repository.listUsersByIds([...new Set(posts.map((post) => post.authorId))]),
    Promise.all(
      ids.map(async (id) => {
        const listing = await repository.getListing(id);
        if (listing) listings.set(id, listing);
      }),
    ),
  ]);
  const authorOf = new Map(authors.map((author) => [author.id, author]));

  return posts.map((post) => {
    const listing = post.listingId ? listings.get(post.listingId) : undefined;
    const author = authorOf.get(post.authorId);
    // A post made as the shop opens the shop; one made as the person opens the
    // person. The post already records which voice it was written in.
    const spokenAsShop = author?.sellerProfile?.storefrontName === post.authorName;
    return {
      post,
      author: spokenAsShop ? sellerRef(author) : personRef(author),
      listing: listing
        ? {
            id: listing.id,
            title: listing.title,
            priceMinor: listing.priceMinor,
            currency: listing.currency,
            condition: listing.condition,
          }
        : null,
    };
  });
}

/** Everyone whose posts belong in this user's feed: those they follow, plus themselves. */
async function myChannelIds(userId: string, repository: Awaited<ReturnType<typeof getRepository>>) {
  const followed = await repository.listFollowedSellerIds(userId);
  return [...new Set([...followed, userId])];
}

/** GET /api/social/feed - posts from everyone you follow, newest first. */
async function socialFeed(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const channelIds = await myChannelIds(user.id, repository);
  const posts = await repository.listPostsForChannels(channelIds);
  // Channel messages stay in their channel. A post written before the two were
  // separate carries no reach and was a broadcast, so absent reads as 'feed'.
  const broadcast = posts.filter((post) => (post.reach ?? 'feed') === 'feed');
  return json(200, { posts: await decorate(broadcast, repository) });
}

/**
 * GET /api/social/channels - one row per seller you follow, newest post first.
 *
 * The message-list shape: who, what they last said, and when. Ordered by that
 * last post rather than by name, so a channel that just moved comes to the top.
 */
async function channels(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const followed = await repository.listFollowedSellerIds(user.id);
  // Your own shop is always here, whether or not you follow yourself, and
  // whether or not it has ever been posted in: it is the one channel you write
  // rather than read, so an empty one is a prompt, not an absence. Shops you
  // help run count too - a manager posting for a shop needs its channel.
  const mineToo = [...new Set([...followed, user.id])];
  const candidates = await repository.listUsersByIds(mineToo);

  // Only a shop has a channel. A person's page is where their own posts live;
  // a channel is a shopfront's address book, and giving one to every account
  // would fill this list with rooms nobody has any reason to open.
  const shops = candidates.filter((account: User) => account.sellerProfile);

  const rows = await Promise.all(
    shops.map(async (seller: User) => {
      const posts = await repository.listPosts(seller.id, 1);
      const latest = posts[0] ?? null;
      return {
        sellerId: seller.id,
        name: seller.sellerProfile?.storefrontName ?? seller.displayName,
        handle: seller.sellerProfile?.username ?? seller.username ?? null,
        photoUrl: seller.sellerProfile?.photoUrl ?? null,
        tier: seller.sellerProfile?.tier ?? null,
        mine: can(seller, user.id, 'posts'),
        lastPost: latest?.body ?? null,
        lastPostAt: latest?.createdAt ?? null,
        lastPostKind: latest?.kind ?? null,
      };
    }),
  );

  // Yours on top, then whoever spoke most recently.
  rows.sort(
    (a, b) => Number(b.mine) - Number(a.mine) || (b.lastPostAt ?? '').localeCompare(a.lastPostAt ?? ''),
  );
  return json(200, { channels: rows });
}

/** GET /api/social/channels/{id} - one channel or forum, newest first. */
async function channelThread(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const viewer = await auth.requireAuth(request);
  const channelId = request.params.id;
  if (!channelId) return error(400, 'invalid_channel', 'A channel id is required.');

  const repository = await getRepository();
  const posts = await repository.listPosts(channelId);
  const forum = await repository.getForum(channelId);
  const seller = forum ? null : await repository.getUserById(channelId);

  if (!forum && !seller?.sellerProfile) {
    return error(404, 'not_found', 'Only a shop has a channel.');
  }

  // Whoever may speak for the shop. A manager posting for it is the shop
  // speaking, which is why this is a rights check rather than an id comparison.
  const mine = Boolean(seller && can(seller, viewer.id, 'posts'));

  // What the shop could put in front of its followers without leaving the
  // channel to go and find it. Only for whoever runs it - nobody else has a
  // reason to see an unsorted list of somebody's stock.
  const shareable = mine
    ? (await repository.listListings({ sellerId: channelId, limit: 8 })).map((listing) => ({
        id: listing.id,
        title: listing.title,
        priceMinor: listing.priceMinor,
        currency: listing.currency,
      }))
    : [];

  return json(200, {
    channel: forum
      ? { id: forum.id, kind: 'forum' as const, name: forum.name, description: forum.description, mine: false }
      : {
          id: channelId,
          kind: 'seller' as const,
          name: seller!.sellerProfile!.storefrontName,
          handle: seller!.sellerProfile!.username ?? seller!.username ?? null,
          description: seller!.sellerProfile!.bio ?? '',
          photoUrl: seller!.sellerProfile!.photoUrl ?? null,
          mine,
        },
    shareable,
    posts: await decorate(posts, repository),
  });
}

/**
 * POST /api/social/posts - say something.
 *
 * Posting to a seller channel is posting to your own: a channel is one seller's
 * voice, so the id is taken from the session rather than the body and there is
 * no way to write into someone else's. A forum takes posts from anyone.
 */
async function createPost(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);

  let body: {
    body?: string; forumId?: string; listingId?: string; photoUrl?: string; storeId?: string;
    /** Somebody else's shop channel, which a follower may speak in. */
    channelId?: string;
    /** Mark it as something followers should not miss. Shops only. */
    announcement?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const text = body.body?.trim();
  if (!text) return error(400, 'invalid_post', 'Write something first.');
  if (text.length > 2000) return error(400, 'invalid_post', 'Keep a post under 2000 characters.');

  const repository = await getRepository();

  let channelId = user.id;
  let channel: Post['channel'] = 'seller';
  let kind: Post['kind'] = body.listingId ? 'sale' : 'update';
  // Posting as yourself is the default; posting as a store you manage puts it
  // in that store's channel, under the store's name, for its followers.
  let authorName = user.displayName;

  if (body.storeId && body.storeId !== user.id) {
    const owner = await repository.getUserById(body.storeId);
    if (!owner?.sellerProfile) return error(404, 'not_found', 'No such store.');
    if (!can(owner, user.id, 'posts')) {
      return error(403, 'forbidden', 'You cannot post as that store.');
    }
    channelId = owner.id;
    authorName = owner.sellerProfile.storefrontName;
  } else if (body.storeId === user.id) {
    authorName = user.sellerProfile?.storefrontName ?? user.displayName;
  }

  // Speaking in a shop's channel. Anybody may - that is the difference between
  // a channel and a broadcast, and a shop that cannot be answered in its own
  // room is a noticeboard. Whether it reads as the shop or as a customer is
  // decided by rights, not by who typed it: a manager is the shop.
  let voice: Post['voice'] = 'store';
  let reach: Post['reach'] = 'feed';
  // A broadcast is an announcement by definition - it went to every follower's
  // feed. Inside a room it is a choice, because most of what is said there is
  // conversation rather than news.
  let announcement = true;
  if (body.channelId) {
    const owner = await repository.getUserById(body.channelId);
    if (!owner?.sellerProfile) return error(404, 'not_found', 'Only a shop has a channel.');
    channelId = owner.id;
    if (can(owner, user.id, 'posts')) {
      authorName = owner.sellerProfile.storefrontName;
      voice = 'store';
    } else {
      authorName = user.displayName;
      voice = 'visitor';
    }
    // A channel message stays in the channel. That is the whole point of
    // having one: somewhere to say "customs cleared, dispatching Tuesday"
    // without it being an announcement to everybody's feed in the same breath.
    reach = 'channel';
    // Only the shop announces in its own room, and only when it says so. A
    // customer's message is never one, whatever they send.
    announcement = voice === 'store' && body.announcement === true;
  }

  if (body.forumId) {
    const forum = await repository.getForum(body.forumId);
    if (!forum) return error(404, 'not_found', 'No such forum.');
    channelId = forum.id;
    channel = 'forum';
    kind = 'thread';
    voice = 'visitor';
    reach = 'channel';
    announcement = false;
  }

  // A sale post has to point at an item this account actually sells.
  let listingId: string | null = null;
  if (body.listingId) {
    const listing = await repository.getListing(body.listingId);
    // Belongs to whoever is being posted as, not to whoever is typing: a
    // manager posts a store's items, not their own. And a visitor cannot
    // advertise in somebody else's channel.
    if (!listing || listing.sellerId !== channelId || voice === 'visitor') {
      return error(404, 'not_found', 'No such listing of yours to post about.');
    }
    listingId = listing.id;
    kind = 'sale';
  }

  const now = new Date().toISOString();
  const post: Post = {
    id: `pst_${randomUUID().slice(0, 12)}`,
    channelId,
    channel,
    kind,
    authorId: user.id,
    authorName,
    body: text,
    listingId,
    photoUrl: body.photoUrl?.trim() || null,
    likeCount: 0,
    replyCount: 0,
    voice,
    reach,
    announcement,
    createdAt: now,
    updatedAt: now,
  };

  return json(201, { post: await repository.createPost(post) });
}

/** GET /api/social/forums - the rooms, and how much room is left. */
async function listForums(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireAuth(request);
  const repository = await getRepository();
  const forums = await repository.listForums();
  return json(200, { forums, cap: FORUM_CAP, remaining: Math.max(0, FORUM_CAP - forums.length) });
}

/**
 * POST /api/social/forums - open a room, while there is room to open one.
 *
 * The cap is deliberate and temporary: a wall of empty rooms reads worse than a
 * few busy ones, so forums stay scarce until there is traffic to fill them.
 */
async function createForum(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);

  let body: { name?: string; description?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const name = body.name?.trim();
  if (!name) return error(400, 'invalid_forum', 'Give the forum a name.');

  const repository = await getRepository();
  const existing = await repository.listForums();
  if (existing.length >= FORUM_CAP) {
    return error(
      409,
      'forum_cap_reached',
      `Forums are capped at ${FORUM_CAP} while the feature is being built out. Post in an existing one for now.`,
    );
  }
  if (existing.some((forum) => forum.name.toLowerCase() === name.toLowerCase())) {
    return error(409, 'forum_exists', 'A forum with that name already exists.');
  }

  const now = new Date().toISOString();
  const forum: Forum = {
    id: `frm_${randomUUID().slice(0, 12)}`,
    name,
    description: body.description?.trim() ?? '',
    createdBy: user.id,
    postCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  return json(201, { forum: await repository.createForum(forum) });
}

export const socialFeedRoute = handler(socialFeed);
export const channelsRoute = handler(channels);
export const channelThreadRoute = handler(channelThread);
export const createPostRoute = handler(createPost);
export const listForumsRoute = handler(listForums);
export const createForumRoute = handler(createForum);

const anon = { authLevel: 'anonymous' } as const;

app.http('social-feed', { ...anon, methods: ['GET'], route: 'social/feed', handler: socialFeedRoute });
app.http('social-channels', { ...anon, methods: ['GET'], route: 'social/channels', handler: channelsRoute });
app.http('social-channel', { ...anon, methods: ['GET'], route: 'social/channels/{id}', handler: channelThreadRoute });
app.http('social-post', { ...anon, methods: ['POST'], route: 'social/posts', handler: createPostRoute });
app.http('social-forums', { ...anon, methods: ['GET'], route: 'social/forums', handler: listForumsRoute });
app.http('social-forum-create', { ...anon, methods: ['POST'], route: 'social/forums/new', handler: createForumRoute });
