import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { FORUM_CAP } from '../../../shared/enums.js';
import type { Forum, Listing, Post, User } from '../../../shared/models.js';
import { can } from '../../../shared/stores.js';
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
}

async function decorate(posts: Post[], repository: Awaited<ReturnType<typeof getRepository>>): Promise<PostCard[]> {
  // A sale post is worth nothing without the item on it, and fetching them one
  // at a time would be a request per post.
  const ids = [...new Set(posts.map((p) => p.listingId).filter((id): id is string => id !== null))];
  const listings = new Map<string, Listing>();
  await Promise.all(
    ids.map(async (id) => {
      const listing = await repository.getListing(id);
      if (listing) listings.set(id, listing);
    }),
  );

  return posts.map((post) => {
    const listing = post.listingId ? listings.get(post.listingId) : undefined;
    return {
      post,
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
  return json(200, { posts: await decorate(posts, repository) });
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
  const sellers = await repository.listUsersByIds(followed);

  const rows = await Promise.all(
    sellers.map(async (seller: User) => {
      const posts = await repository.listPosts(seller.id, 1);
      const latest = posts[0] ?? null;
      return {
        sellerId: seller.id,
        name: seller.sellerProfile?.storefrontName ?? seller.displayName,
        photoUrl: seller.sellerProfile?.photoUrl ?? null,
        tier: seller.sellerProfile?.tier ?? null,
        lastPost: latest?.body ?? null,
        lastPostAt: latest?.createdAt ?? null,
        lastPostKind: latest?.kind ?? null,
      };
    }),
  );

  rows.sort((a, b) => (b.lastPostAt ?? '').localeCompare(a.lastPostAt ?? ''));
  return json(200, { channels: rows });
}

/** GET /api/social/channels/{id} - one channel or forum, newest first. */
async function channelThread(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireAuth(request);
  const channelId = request.params.id;
  if (!channelId) return error(400, 'invalid_channel', 'A channel id is required.');

  const repository = await getRepository();
  const posts = await repository.listPosts(channelId);
  const forum = await repository.getForum(channelId);
  const seller = forum ? null : await repository.getUserById(channelId);

  return json(200, {
    channel: forum
      ? { id: forum.id, kind: 'forum' as const, name: forum.name, description: forum.description }
      : {
          id: channelId,
          kind: 'seller' as const,
          name: seller?.sellerProfile?.storefrontName ?? seller?.displayName ?? 'Unknown',
          description: seller?.sellerProfile?.bio ?? '',
        },
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

  let body: { body?: string; forumId?: string; listingId?: string; photoUrl?: string; storeId?: string };
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

  if (body.forumId) {
    const forum = await repository.getForum(body.forumId);
    if (!forum) return error(404, 'not_found', 'No such forum.');
    channelId = forum.id;
    channel = 'forum';
    kind = 'thread';
  }

  // A sale post has to point at an item this account actually sells.
  let listingId: string | null = null;
  if (body.listingId) {
    const listing = await repository.getListing(body.listingId);
    // Belongs to whoever is being posted as, not to whoever is typing: a
    // manager posts a store's items, not their own.
    if (!listing || listing.sellerId !== channelId) {
      return error(404, 'not_found', 'No such listing of yours to post about.');
    }
    listingId = listing.id;
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
