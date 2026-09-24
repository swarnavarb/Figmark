import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { FORUM_CAP } from '../../../shared/enums.js';
import type { Forum, Listing, Post, User } from '../../../shared/models.js';
import {
  COMMENT_MAX_CHARS, POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, POLL_OPTION_MAX_CHARS, POST_MAX_COMMENTS,
  POST_MAX_PHOTOS, REACTION_META, VIBE_MAX_CHARS, actorKey, isReaction, isVibe, reactionActor, summarise,
  type CommentThread, type CommentView, type PollView, type PostSocial, type ReactorRow,
  type StoredComment, type StoredPoll, type StoredReaction,
} from '../../../shared/social.js';
import { can } from '../../../shared/stores.js';
import { personRef, sellerRef, type PartyRef } from '../../../shared/parties.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { notify } from './notify.js';

/**
 * The social side: what the people you follow are saying, and the forums.
 *
 * A seller channel and a forum are the same shape - an id with posts under it -
 * so they share one store and one set of routes. The difference is who may
 * write: a channel takes posts from its owner only, a forum from anyone.
 */

/** Enough of a listing to render a sale post without a second round trip. */
interface PostCard {
  /** The post, without the lists `social` summarises - who voted is nobody's business. */
  post: Post;
  listing: (Pick<Listing, 'id' | 'title' | 'priceMinor' | 'currency' | 'condition'> & { photoUrl: string | null }) | null;
  /**
   * Where the author's name goes when tapped.
   *
   * Resolved on read rather than stored on the post: a post keeps the name as
   * it was written, which is right, but an address that was frozen a year ago
   * points at whoever holds that handle now. A shop post opens the shop, a
   * person's post opens the person - the same rule as everywhere else.
   */
  author: PartyRef;
  /** Reactions, comments, shares and the poll, as this viewer sees them. */
  social: PostSocial;
  /**
   * Whether the viewer follows whoever's channel this is in.
   *
   * The feed only holds people you follow, so this is there for trending,
   * which is mostly people you do not - and a trending post with no way to
   * follow its author is a dead end.
   */
  following: boolean;
  /** The post this one passes on, when it is a repost. Null when that post has gone. */
  original?: PostCard | null;
}

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Who is acting: the signed-in person, or a shop they speak for.
 *
 * Chosen by the viewer and sent as `?as=<shop id>` on every call, reads
 * included, because "did I react to this" depends on which of your voices is
 * asking. Rights are checked here, once, so no handler has to remember to.
 */
interface Actor {
  userId: string;
  storeId: string | null;
  key: string;
  name: string;
}

async function actorFor(request: HttpRequest, user: Viewer, repository: Repo): Promise<Actor | null> {
  const asked = request.query?.get('as')?.trim() || null;
  if (!asked) return { userId: user.id, storeId: null, key: user.id, name: user.displayName };
  const owner = asked === user.id ? await repository.getUserById(user.id) : await repository.getUserById(asked);
  if (!owner?.sellerProfile || !can(owner, user.id, 'posts')) return null;
  return {
    userId: user.id,
    storeId: owner.id,
    key: actorKey(user.id, owner.id),
    name: owner.sellerProfile.storefrontName,
  };
}

/** The signed-in account, as much of it as choosing a voice needs. */
type Viewer = { id: string; displayName: string };

const notYours = () => error(403, 'forbidden', 'You cannot speak for that shop.');

/** The post as it goes over the wire: the heavy lists summarised elsewhere. */
function publicPost(post: Post): Post {
  const { reactions: _reactions, comments: _comments, poll: _poll, ...rest } = post;
  return {
    ...rest,
    likeCount: post.reactions?.length ?? post.likeCount,
    replyCount: post.comments?.length ?? post.replyCount,
  };
}

function pollView(poll: StoredPoll | null | undefined, viewerId: string): PollView | null {
  if (!poll) return null;
  const options = poll.options.map((option) => ({ id: option.id, label: option.label, votes: option.voterIds.length }));
  return {
    options,
    total: options.reduce((sum, option) => sum + option.votes, 0),
    myVote: poll.options.find((option) => option.voterIds.includes(viewerId))?.id ?? null,
    closesAt: poll.closesAt,
    closed: poll.closesAt !== null && poll.closesAt < new Date().toISOString(),
  };
}

/** A name and an address for a reaction or a comment: the shop it was given as, or the person. */
function partyOf(userId: string, asStore: string | null | undefined, people: Map<string, User>, fallback?: string): PartyRef {
  return asStore ? sellerRef(people.get(asStore), fallback) : personRef(people.get(userId), fallback);
}

function commentView(comment: StoredComment, post: Post, viewer: Actor, people: Map<string, User>): CommentView {
  return {
    id: comment.id,
    author: partyOf(comment.authorId, comment.asStore, people, comment.authorName),
    authorName: comment.authorName,
    body: comment.body,
    parentId: comment.parentId,
    replyToName: comment.replyToName ?? null,
    likeCount: comment.likedBy.length,
    likedByMe: comment.likedBy.includes(viewer.key),
    canDelete: comment.authorId === viewer.userId || post.authorId === viewer.userId,
    createdAt: comment.createdAt,
  };
}

/** The whole conversation under a post: top-level oldest first, each with its replies. */
function threadsOf(post: Post, viewer: Actor, people: Map<string, User>): CommentThread[] {
  const comments = post.comments ?? [];
  const byTime = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return byTime
    .filter((comment) => comment.parentId === null)
    .map((top) => ({
      ...commentView(top, post, viewer, people),
      replies: byTime
        .filter((reply) => reply.parentId === top.id)
        .map((reply) => commentView(reply, post, viewer, people)),
    }));
}

/**
 * The liveliest comment or two, for the feed.
 *
 * Most liked first, then newest: a feed that shows the first thing anybody
 * said shows "first!" forever.
 */
function previewOf(post: Post): StoredComment[] {
  return [...(post.comments ?? [])]
    .filter((comment) => comment.parentId === null)
    .sort((a, b) => b.likedBy.length - a.likedBy.length || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
}

const newestReactions = (post: Post) =>
  [...(post.reactions ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 2);

/** Everyone a set of posts needs a name or an address for, in one read. */
async function peopleFor(posts: readonly Post[], repository: Repo, extra: readonly string[] = []) {
  const ids = new Set<string>(extra);
  for (const post of posts) {
    ids.add(post.authorId);
    // Whose channel it is decides whether the name opens a shop.
    if (post.channel === 'seller') ids.add(post.channelId);
    // Only the names the summary line uses, not every reactor on a busy post.
    for (const reaction of newestReactions(post)) ids.add(reaction.asStore ?? reaction.userId);
    for (const comment of previewOf(post)) ids.add(comment.asStore ?? comment.authorId);
  }
  const users = await repository.listUsersByIds([...ids]);
  return new Map(users.map((user) => [user.id, user]));
}

/** The picture a listing leads with, if it has one. */
function leadPhotoOf(listing: Listing): string | null {
  const photos = listing.photos ?? [];
  return (photos.find((photo) => photo.isPrimary) ?? photos[0])?.url ?? null;
}

async function decorate(
  posts: Post[],
  repository: Repo,
  viewer: Actor,
  options: { nested?: boolean; followed?: ReadonlySet<string> } = {},
): Promise<PostCard[]> {
  // A sale post is worth nothing without the item on it, and fetching them one
  // at a time would be a request per post.
  const ids = [...new Set(posts.map((p) => p.listingId).filter((id): id is string => id !== null))];
  const listings = new Map<string, Listing>();
  const originals = new Map<string, Post>();
  const [people, followedIds] = await Promise.all([
    peopleFor(posts, repository),
    options.followed
      ? Promise.resolve(options.followed)
      : repository.listFollowedSellerIds(viewer.userId).then((list) => new Set(list)),
    Promise.all(
      ids.map(async (id) => {
        const listing = await repository.getListing(id);
        if (listing) listings.set(id, listing);
      }),
    ),
    // A repost shows what it passes on. One level only: a repost of a repost
    // already points at the original, so there is never a second hop.
    options.nested
      ? Promise.resolve()
      : Promise.all(
          posts
            .filter((post) => post.repostOf)
            .map(async (post) => {
              const ref = post.repostOf!;
              const original = await repository.getPost(ref.channelId, ref.postId);
              if (original) originals.set(post.id, original);
            }),
        ),
  ]);

  const originalCards = new Map<string, PostCard>();
  if (originals.size > 0) {
    const entries = [...originals.entries()];
    const cards = await decorate(entries.map(([, original]) => original), repository, viewer, {
      nested: true, followed: followedIds,
    });
    entries.forEach(([repostId], index) => originalCards.set(repostId, cards[index]!));
  }

  return posts.map((post) => {
    const listing = post.listingId ? listings.get(post.listingId) : undefined;
    const author = people.get(post.authorId);
    // A post made as the shop opens the shop; one made as the person opens the
    // person. The post already records which voice it was written in.
    const channelOwner = people.get(post.channelId);
    const spokenAsShop = post.channel === 'seller' && (post.voice ?? 'store') === 'store'
      && channelOwner?.sellerProfile?.storefrontName === post.authorName;
    const card: PostCard = {
      post: publicPost(post),
      author: spokenAsShop ? sellerRef(channelOwner) : personRef(author),
      listing: listing
        ? {
            id: listing.id,
            title: listing.title,
            priceMinor: listing.priceMinor,
            currency: listing.currency,
            condition: listing.condition,
            photoUrl: leadPhotoOf(listing),
          }
        : null,
      social: {
        reactions: summarise(post.reactions ?? [], viewer.key, (reaction) => {
          const who = people.get(reaction.asStore ?? reaction.userId);
          return reaction.asStore ? who?.sellerProfile?.storefrontName ?? null : who?.displayName ?? null;
        }),
        commentCount: post.comments?.length ?? post.replyCount,
        preview: previewOf(post).map((comment) => commentView(comment, post, viewer, people)),
        shareCount: post.shareCount ?? 0,
        poll: pollView(post.poll, viewer.userId),
        mine: post.authorId === viewer.userId,
      },
      following: followedIds.has(post.channelId) || post.channelId === viewer.userId,
    };
    if (post.repostOf) card.original = originalCards.get(post.id) ?? null;
    return card;
  });
}

/** Where a post is read in full, for notifications and shared links. */
function linkTo(post: Pick<Post, 'channelId' | 'id'>): string {
  return `/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`;
}

/** A line of the post, for a notification that has to say which one. */
function gist(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'your post';
}

/**
 * Photo addresses a post may carry.
 *
 * Only what the upload route hands back, or a plain https link. Anything else
 * - a data URL, a javascript: link - is somebody putting something in an
 * <img> that the upload route exists to have vetted.
 */
function cleanPhotos(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const urls = value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
  if (urls.length > POST_MAX_PHOTOS) return null;
  const ok = urls.every(
    (url) => url.length <= 500 && (/^\/api\/photos\/[\w.-]+$/.test(url) || /^https:\/\/[^\s"'<>]+$/.test(url)),
  );
  return ok ? urls : null;
}

/** The viewer speaking as themselves, for reads that have no voice to choose. */
function personActor(user: Viewer): Actor {
  return { userId: user.id, storeId: null, key: user.id, name: user.displayName };
}

/** GET /api/social/feed - posts from everyone you follow, newest first. */
async function socialFeed(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const actor = await actorFor(request, user, repository);
  if (!actor) return notYours();

  const followed = await repository.listFollowedSellerIds(user.id);
  const channelIds = [...new Set([...followed, user.id])];
  const posts = await repository.listPostsForChannels(channelIds);
  // Channel messages stay in their channel. A post written before the two were
  // separate carries no reach and was a broadcast, so absent reads as 'feed'.
  const broadcast = posts.filter((post) => (post.reach ?? 'feed') === 'feed');
  return json(200, { posts: await decorate(broadcast, repository, actor, { followed: new Set(followed) }) });
}

/**
 * How much is happening on a post, discounted by age.
 *
 * Shares weigh most because passing something on costs a reputation; comments
 * next because they cost a sentence; a reaction costs a tap. The age discount
 * is gentle - a day-old post with real conversation still beats a fresh one
 * nobody has touched - but it is there, so the list turns over.
 */
function heat(post: Post, now: number): number {
  const votes = post.poll?.options.reduce((sum, option) => sum + option.voterIds.length, 0) ?? 0;
  const engagement = (post.reactions?.length ?? post.likeCount)
    + 2 * (post.comments?.length ?? post.replyCount)
    + 3 * (post.shareCount ?? 0)
    + 0.5 * votes;
  const hours = Math.max(0, (now - new Date(post.createdAt).getTime()) / 3_600_000);
  return engagement / Math.pow(hours / 24 + 1, 0.6);
}

/**
 * GET /api/social/trending - what everyone is reacting to, followed or not.
 *
 * The feed only shows people you already chose. This is how you find the next
 * ones: the liveliest public posts from any person or shop, with a follow
 * button attached. Your own posts are left out - you know about those.
 */
async function trending(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const actor = await actorFor(request, user, repository);
  if (!actor) return notYours();

  const now = Date.now();
  const recent = await repository.listRecentPosts(200);
  const ranked = recent
    .filter((post) => post.channel === 'seller' && (post.reach ?? 'feed') === 'feed')
    .filter((post) => post.authorId !== user.id && post.channelId !== user.id)
    .map((post) => ({ post, score: heat(post, now) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((entry) => entry.post);
  return json(200, { posts: await decorate(ranked, repository, actor) });
}

/**
 * GET /api/social/shareable?as=<shop> - the items a shop can put in a post.
 *
 * Only for whoever may speak for the shop: nobody else has a reason to see an
 * unsorted list of somebody's stock, and posting it is theirs alone.
 */
async function shareable(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const actor = await actorFor(request, user, repository);
  if (!actor) return notYours();
  if (!actor.storeId) return json(200, { listings: [] });
  const listings = await repository.listListings({ sellerId: actor.storeId, limit: 40 });
  return json(200, {
    listings: listings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      priceMinor: listing.priceMinor,
      currency: listing.currency,
      condition: listing.condition,
      photoUrl: leadPhotoOf(listing),
    })),
  });
}

/** GET /api/me/posts - everything this account wrote, newest first, for its own profile. */
async function myPosts(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const posts = (await repository.listPostsByAuthor(user.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json(200, { posts: await decorate(posts, repository, personActor(user)) });
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
  const followedSet = new Set(followed);
  // Your own shop is always here, whether or not you follow yourself, and
  // whether or not it has ever been posted in: it is the one channel you write
  // rather than read, so an empty one is a prompt, not an absence. Shops you
  // help run count too - a manager posting for a shop needs its channel.
  const owners = await repository.listStoreOwners();
  const run = owners.filter((owner) => can(owner, user.id, 'posts')).map((owner) => owner.id);
  const mineToo = [...new Set([...followed, ...run, user.id])];
  const candidates = await repository.listUsersByIds(mineToo);

  // Only a shop has a channel. A person's page is where their own posts live;
  // a channel is a shopfront's address book, and giving one to every account
  // would fill this list with rooms nobody has any reason to open.
  const shops = candidates.filter((account: User) => account.sellerProfile);

  const rowFor = async (seller: User) => {
    // The newest few, not one: the app counts what arrived since you last
    // looked, and it needs the times to do it without a read receipt per room.
    const posts = await repository.listPosts(seller.id, 20);
    const latest = posts[0] ?? null;
    return {
      sellerId: seller.id,
      name: seller.sellerProfile?.storefrontName ?? seller.displayName,
      handle: seller.sellerProfile?.username ?? seller.username ?? null,
      photoUrl: seller.sellerProfile?.photoUrl ?? null,
      tier: seller.sellerProfile?.tier ?? null,
      bio: seller.sellerProfile?.bio ?? '',
      followerCount: seller.sellerProfile?.followerCount ?? 0,
      following: followedSet.has(seller.id),
      mine: can(seller, user.id, 'posts'),
      lastPost: latest?.body ?? null,
      lastPostAt: latest?.createdAt ?? null,
      lastPostKind: latest?.kind ?? null,
      lastPostBy: latest?.authorName ?? null,
      pinned: posts.some((post) => post.pinned),
      recent: posts.filter((post) => post.authorId !== user.id).map((post) => post.createdAt),
    };
  };

  const rows = await Promise.all(shops.map(rowFor));
  // Yours on top, then whoever spoke most recently.
  rows.sort(
    (a, b) => Number(b.mine) - Number(a.mine) || (b.lastPostAt ?? '').localeCompare(a.lastPostAt ?? ''),
  );

  // Rooms you are not in yet, busiest first: a channel list that only ever
  // shows what you already chose never grows.
  const strangers = owners.filter((owner) => owner.sellerProfile && !mineToo.includes(owner.id));
  const discover = (await Promise.all(strangers.map(rowFor)))
    .filter((row) => row.lastPostAt)
    .sort((a, b) => b.recent.length - a.recent.length || (b.lastPostAt ?? '').localeCompare(a.lastPostAt ?? ''))
    .slice(0, 8);

  return json(200, { channels: rows, discover });
}

/** GET /api/social/channels/{id} - one channel or forum, newest first. */
async function channelThread(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const viewer = await auth.requireAuth(request);
  const channelId = request.params.id;
  if (!channelId) return error(400, 'invalid_channel', 'A channel id is required.');

  const repository = await getRepository();
  const actor = await actorFor(request, viewer, repository);
  if (!actor) return notYours();
  const [posts, followed] = await Promise.all([
    repository.listPosts(channelId, 100),
    repository.listFollowedSellerIds(viewer.id),
  ]);
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
    ? (await repository.listListings({ sellerId: channelId, limit: 30 })).map((listing) => ({
        id: listing.id,
        title: listing.title,
        priceMinor: listing.priceMinor,
        currency: listing.currency,
        condition: listing.condition,
        photoUrl: leadPhotoOf(listing),
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
          tier: seller!.sellerProfile!.tier ?? null,
          followerCount: seller!.sellerProfile!.followerCount ?? 0,
          following: followed.includes(channelId),
          mine,
        },
    shareable,
    posts: await decorate(posts, repository, actor, { followed: new Set(followed) }),
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
    body?: string; forumId?: string; listingId?: string; storeId?: string;
    /** Somebody else's shop channel, which a follower may speak in. */
    channelId?: string;
    /** Mark it as something followers should not miss. Shops only. */
    announcement?: boolean;
    /** Uploaded photos, in order. Several make a carousel. */
    photoUrls?: unknown;
    /** A question to vote on: the body is the question, these the answers. */
    poll?: { options?: unknown; closesInHours?: unknown } | null;
    /** A short line on one of the brand gradients. */
    vibe?: unknown;
    /** The message in the same room this one answers. */
    replyToId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const photoUrls = cleanPhotos(body.photoUrls);
  if (!photoUrls) {
    return error(400, 'invalid_post', `Up to ${POST_MAX_PHOTOS} photos, uploaded here first.`);
  }
  // A photo can speak for itself; anything else needs words.
  const text = body.body?.trim() ?? '';
  if (!text && photoUrls.length === 0) return error(400, 'invalid_post', 'Write something first.');
  if (text.length > 2000) return error(400, 'invalid_post', 'Keep a post under 2000 characters.');

  let poll: StoredPoll | null = null;
  if (body.poll) {
    const raw = Array.isArray(body.poll.options) ? body.poll.options : [];
    const labels = raw.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
    if (!text) return error(400, 'invalid_poll', 'A poll needs a question.');
    if (labels.length < POLL_MIN_OPTIONS || labels.length > POLL_MAX_OPTIONS) {
      return error(400, 'invalid_poll', `A poll takes ${POLL_MIN_OPTIONS} to ${POLL_MAX_OPTIONS} answers.`);
    }
    if (labels.some((label) => label.length > POLL_OPTION_MAX_CHARS)) {
      return error(400, 'invalid_poll', `Keep each answer under ${POLL_OPTION_MAX_CHARS} characters.`);
    }
    if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
      return error(400, 'invalid_poll', 'Two answers say the same thing.');
    }
    const hours = Number(body.poll.closesInHours);
    poll = {
      options: labels.map((label, index) => ({ id: `opt_${index + 1}`, label, voterIds: [] })),
      closesAt: Number.isFinite(hours) && hours > 0
        ? new Date(Date.now() + Math.min(hours, 24 * 30) * 3_600_000).toISOString()
        : null,
    };
  }

  // A vibe is a poster, and a poster is one line with nothing else on it.
  let vibe: Post['vibe'] = null;
  if (body.vibe !== undefined && body.vibe !== null) {
    if (!isVibe(body.vibe)) return error(400, 'invalid_post', 'No such colour.');
    if (text.length > VIBE_MAX_CHARS || photoUrls.length > 0 || poll || body.listingId) {
      return error(400, 'invalid_post', `A colour post is text only, under ${VIBE_MAX_CHARS} characters.`);
    }
    vibe = body.vibe;
  }

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
      // A customer who runs a shop of their own may speak as it in somebody
      // else's room - still a visitor there, just a named one.
      authorName = user.displayName;
      if (body.storeId) {
        const theirs = await repository.getUserById(body.storeId);
        if (!theirs?.sellerProfile || !can(theirs, user.id, 'posts')) {
          return error(403, 'forbidden', 'You cannot post as that store.');
        }
        authorName = theirs.sellerProfile.storefrontName;
      }
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

  // Answering something: only in a room, and only something said in the same one.
  let replyTo: Post['replyTo'] = null;
  let answeredAuthor: string | null = null;
  if (typeof body.replyToId === 'string' && body.replyToId) {
    const original = await repository.getPost(channelId, body.replyToId);
    if (!original || reach !== 'channel') {
      return error(404, 'not_found', 'That message is not in this room any more.');
    }
    replyTo = { postId: original.id, authorName: original.authorName, body: gist(original.body || 'Photo') };
    answeredAuthor = original.authorId;
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
    photoUrl: photoUrls[0] ?? null,
    likeCount: 0,
    replyCount: 0,
    voice,
    reach,
    announcement,
    photoUrls,
    reactions: [],
    comments: [],
    shareCount: 0,
    poll,
    vibe,
    replyTo,
    createdAt: now,
    updatedAt: now,
  };

  const saved = await repository.createPost(post);
  if (answeredAuthor) {
    await notify(repository, [answeredAuthor], {
      kind: 'comment_replied',
      title: `${authorName} replied to you`,
      body: gist(text || 'Photo'),
      link: `/social/c/${encodeURIComponent(channelId)}`,
    }, { except: user.id });
  }
  return json(201, { post: saved });
}

/* ── Reacting, commenting, sharing, voting ─────────────────────────────── */

/** The post a route names, and the viewer: the two things every handler below starts from. */
async function target(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const channelId = request.params.channel;
  const postId = request.params.id;
  const post = channelId && postId ? await repository.getPost(channelId, postId) : null;
  const actor = await actorFor(request, user, repository);
  return { user, repository, post, actor };
}

async function readJson<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** One post, decorated, as this viewer sees it. */
async function cardFor(post: Post, repository: Repo, viewer: Actor): Promise<PostCard> {
  return (await decorate([post], repository, viewer))[0]!;
}

/** The whole conversation, with every commenter's address resolved. */
async function commentsFor(post: Post, repository: Repo, viewer: Actor): Promise<CommentThread[]> {
  const ids = [...new Set((post.comments ?? []).map((comment) => comment.asStore ?? comment.authorId))];
  const people = new Map((await repository.listUsersByIds(ids)).map((user) => [user.id, user]));
  return threadsOf(post, viewer, people);
}

const noPost = () => error(404, 'not_found', 'That post is not there any more.');

/** GET /api/social/posts/{channel}/{id} - one post and everything said under it. */
async function readPost(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  return json(200, {
    card: await cardFor(post, repository, actor),
    comments: await commentsFor(post, repository, actor),
  });
}

/**
 * POST /api/social/posts/{channel}/{id}/react - react, change it, or take it back.
 *
 * `kind: null` takes it back. Sending the reaction you already have also takes
 * it back, because that is what tapping a lit heart means everywhere else.
 */
async function react(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  const body = await readJson<{ kind?: unknown }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');
  if (body.kind !== null && !isReaction(body.kind)) {
    return error(400, 'invalid_reaction', 'No such reaction.');
  }

  let firstTime = false;
  const saved = await repository.mutatePost(post.channelId, post.id, (current) => {
    const reactions = current.reactions ?? [];
    const had = reactions.find((reaction) => reactionActor(reaction) === actor.key);
    const rest = reactions.filter((reaction) => reactionActor(reaction) !== actor.key);
    const kind = body.kind === null || had?.kind === body.kind ? null : (body.kind as StoredReaction['kind']);
    firstTime = !had && kind !== null;
    const next = kind
      ? [...rest, { userId: user.id, asStore: actor.storeId, kind, at: new Date().toISOString() }]
      : rest;
    return { ...current, reactions: next, likeCount: next.length, updatedAt: current.updatedAt };
  });
  if (!saved) return noPost();

  // Only the first reaction is news. Changing a heart to a laugh is not a
  // second thing to tell anybody about.
  if (firstTime) {
    const kind = body.kind as StoredReaction['kind'];
    await notify(repository, [post.authorId], {
      kind: 'post_reacted',
      title: `${actor.name} reacted ${REACTION_META[kind].emoji}`,
      body: gist(post.body),
      link: linkTo(post),
    }, { except: user.id });
  }

  const card = await cardFor(saved, repository, actor);
  return json(200, { reactions: card.social.reactions });
}

/** GET /api/social/posts/{channel}/{id}/reactions - who reacted, and with what. */
async function reactors(request: HttpRequest, _context: InvocationContext) {
  const { repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  const reactions = [...(post.reactions ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));
  const people = new Map(
    (await repository.listUsersByIds(reactions.map((reaction) => reaction.asStore ?? reaction.userId)))
      .map((user) => [user.id, user]),
  );
  const rows: ReactorRow[] = reactions.map((reaction) => ({
    party: partyOf(reaction.userId, reaction.asStore, people),
    kind: reaction.kind,
    at: reaction.at,
  }));
  return json(200, { reactors: rows });
}

/**
 * POST /api/social/posts/{channel}/{id}/comments - say something under a post.
 *
 * `parentId` makes it a reply. A reply to a reply is filed under the same
 * top-level comment and remembers whose it answered, so the thread stays two
 * levels deep however long the back-and-forth runs.
 */
async function addPostComment(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  const body = await readJson<{ body?: unknown; parentId?: unknown }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return error(400, 'invalid_comment', 'Write something first.');
  if (text.length > COMMENT_MAX_CHARS) {
    return error(400, 'invalid_comment', `Keep a comment under ${COMMENT_MAX_CHARS} characters.`);
  }

  let parent: StoredComment | null = null;
  let answering: StoredComment | null = null;
  if (typeof body.parentId === 'string' && body.parentId) {
    answering = post.comments?.find((comment) => comment.id === body.parentId) ?? null;
    if (!answering) return error(404, 'not_found', 'That comment is not there any more.');
    parent = answering.parentId
      ? post.comments?.find((comment) => comment.id === answering!.parentId) ?? answering
      : answering;
  }

  const now = new Date().toISOString();
  const comment: StoredComment = {
    id: `cmt_${randomUUID().slice(0, 12)}`,
    authorId: user.id,
    authorName: actor.name,
    asStore: actor.storeId,
    body: text,
    parentId: parent?.id ?? null,
    replyToName: answering && answering.id !== parent?.id ? answering.authorName : null,
    likedBy: [],
    createdAt: now,
  };

  let full = false;
  const saved = await repository.mutatePost(post.channelId, post.id, (current) => {
    const comments = current.comments ?? [];
    if (comments.length >= POST_MAX_COMMENTS) {
      full = true;
      return null;
    }
    const next = [...comments, comment];
    return { ...current, comments: next, replyCount: next.length };
  });
  if (!saved) return noPost();
  if (full) return error(409, 'comments_full', 'This conversation is full. Start a new post about it.');

  // The author hears about comments; whoever was answered hears about the
  // reply. Somebody who is both hears once.
  const answered = answering?.authorId ?? null;
  if (answered && answered !== post.authorId) {
    await notify(repository, [answered], {
      kind: 'comment_replied',
      title: `${actor.name} replied to you`,
      body: gist(text),
      link: linkTo(post),
    }, { except: user.id });
  }
  await notify(repository, [post.authorId], {
    kind: answered === post.authorId ? 'comment_replied' : 'post_commented',
    title: answered === post.authorId ? `${actor.name} replied to you` : `${actor.name} commented`,
    body: gist(text),
    link: linkTo(post),
  }, { except: user.id });

  return json(201, {
    comment: comment.id,
    card: await cardFor(saved, repository, actor),
    comments: await commentsFor(saved, repository, actor),
  });
}

/** POST /api/social/posts/{channel}/{id}/comments/{comment}/like - a heart on a comment, or not. */
async function likeComment(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  const commentId = request.params.comment;
  if (!post.comments?.some((comment) => comment.id === commentId)) {
    return error(404, 'not_found', 'That comment is not there any more.');
  }

  const saved = await repository.mutatePost(post.channelId, post.id, (current) => ({
    ...current,
    comments: (current.comments ?? []).map((comment) =>
      comment.id !== commentId
        ? comment
        : {
            ...comment,
            likedBy: comment.likedBy.includes(actor.key)
              ? comment.likedBy.filter((id) => id !== actor.key)
              : [...comment.likedBy, actor.key],
          },
    ),
  }));
  if (!saved) return noPost();
  const liked = saved.comments?.find((comment) => comment.id === commentId);
  return json(200, { liked: Boolean(liked?.likedBy.includes(actor.key)), likeCount: liked?.likedBy.length ?? 0 });
}

/**
 * POST /api/social/posts/{channel}/{id}/comments/{comment}/delete - take one back.
 *
 * Its writer may, and so may the post's author: it is their post the thing is
 * under. A top-level comment goes with its replies, which have nothing left to
 * answer.
 */
async function deletePostComment(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  const commentId = request.params.comment;
  const comment = post.comments?.find((entry) => entry.id === commentId);
  if (!comment) return error(404, 'not_found', 'That comment is not there any more.');
  if (comment.authorId !== user.id && post.authorId !== user.id) {
    return error(403, 'forbidden', 'Only whoever wrote it, or the post\'s author, can remove that.');
  }

  const saved = await repository.mutatePost(post.channelId, post.id, (current) => {
    const next = (current.comments ?? []).filter((entry) => entry.id !== commentId && entry.parentId !== commentId);
    return { ...current, comments: next, replyCount: next.length };
  });
  if (!saved) return noPost();
  return json(200, {
    card: await cardFor(saved, repository, actor),
    comments: await commentsFor(saved, repository, actor),
  });
}

/**
 * POST /api/social/posts/{channel}/{id}/share - pass it on.
 *
 * `repost` puts it in front of your own followers, with a line of your own if
 * you like. `link` only counts it: the link itself went out through the phone's
 * share sheet or the clipboard, which the server never sees.
 */
async function sharePost(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  const body = await readJson<{ mode?: unknown; body?: unknown }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');
  if (body.mode !== 'repost' && body.mode !== 'link') {
    return error(400, 'invalid_share', 'Share as a repost or as a link.');
  }

  // A repost of a repost passes on the original, not the wrapper around it.
  const source = post.repostOf ? await repository.getPost(post.repostOf.channelId, post.repostOf.postId) : post;
  if (!source) return noPost();

  let repost: Post | null = null;
  if (body.mode === 'repost') {
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (text.length > 2000) return error(400, 'invalid_post', 'Keep a post under 2000 characters.');
    // Posts that stay in a room were said to that room, not to the world.
    if ((source.reach ?? 'feed') !== 'feed') {
      return error(400, 'invalid_share', 'That was said in a room. Share the link instead.');
    }
    const now = new Date().toISOString();
    repost = await repository.createPost({
      id: `pst_${randomUUID().slice(0, 12)}`,
      // A shop passing something on does it in its own channel, to its own followers.
      channelId: actor.storeId ?? user.id,
      channel: 'seller',
      kind: 'update',
      authorId: user.id,
      authorName: actor.name,
      body: text,
      listingId: null,
      photoUrl: null,
      likeCount: 0,
      replyCount: 0,
      voice: 'store',
      reach: 'feed',
      announcement: false,
      photoUrls: [],
      reactions: [],
      comments: [],
      shareCount: 0,
      poll: null,
      vibe: null,
      repostOf: { channelId: source.channelId, postId: source.id },
      createdAt: now,
      updatedAt: now,
    });
  }

  const saved = await repository.mutatePost(source.channelId, source.id, (current) => ({
    ...current,
    shareCount: (current.shareCount ?? 0) + 1,
  }));
  if (!saved) return noPost();

  if (repost) {
    await notify(repository, [source.authorId], {
      kind: 'post_shared',
      title: `${actor.name} shared your post`,
      body: gist(source.body),
      link: linkTo(source),
    }, { except: user.id });
  }

  return json(repost ? 201 : 200, {
    shareCount: saved.shareCount ?? 0,
    repost: repost ? await cardFor(repost, repository, actor) : null,
  });
}

/** POST /api/social/posts/{channel}/{id}/vote - pick an answer, or change your mind. */
async function vote(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  if (!post.poll) return error(400, 'invalid_vote', 'That post has nothing to vote on.');
  const body = await readJson<{ optionId?: unknown }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');
  const optionId = body.optionId;
  if (!post.poll.options.some((option) => option.id === optionId)) {
    return error(400, 'invalid_vote', 'No such answer.');
  }
  if (post.poll.closesAt && post.poll.closesAt < new Date().toISOString()) {
    return error(409, 'poll_closed', 'Voting on this one has closed.');
  }

  const saved = await repository.mutatePost(post.channelId, post.id, (current) => {
    if (!current.poll) return null;
    return {
      ...current,
      poll: {
        ...current.poll,
        options: current.poll.options.map((option) => {
          const others = option.voterIds.filter((id) => id !== user.id);
          return { ...option, voterIds: option.id === optionId ? [...others, user.id] : others };
        }),
      },
    };
  });
  if (!saved) return noPost();
  return json(200, { poll: pollView(saved.poll, user.id) });
}

/**
 * POST /api/social/posts/{channel}/{id}/pin - pin it to the top of the room, or unpin it.
 *
 * Whoever speaks for the shop decides what a newcomer reads first; nobody
 * else can move somebody's shop's furniture. At most three at a time, so the
 * pins stay a noticeboard rather than becoming a second feed.
 */
async function pinPost(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  const owner = post.channel === 'seller' ? await repository.getUserById(post.channelId) : null;
  if (!owner?.sellerProfile || !can(owner, user.id, 'posts')) {
    return error(403, 'forbidden', 'Only whoever runs the shop can pin in its channel.');
  }
  if (!post.pinned) {
    const pinned = (await repository.listPosts(post.channelId, 100)).filter((entry) => entry.pinned);
    if (pinned.length >= 3) return error(409, 'too_many_pins', 'Three pins at most. Unpin one first.');
  }
  const saved = await repository.mutatePost(post.channelId, post.id, (current) => ({
    ...current,
    pinned: !current.pinned,
  }));
  if (!saved) return noPost();
  return json(200, { pinned: Boolean(saved.pinned) });
}

/** POST /api/social/posts/{channel}/{id}/delete - take a post down. Its author only. */
async function removePost(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  if (post.authorId !== user.id) return error(403, 'forbidden', 'Only whoever posted it can take it down.');
  await repository.deletePost(post.channelId, post.id);
  return json(200, { deleted: post.id });
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
export const myPostsRoute = handler(myPosts);
export const channelsRoute = handler(channels);
export const channelThreadRoute = handler(channelThread);
export const createPostRoute = handler(createPost);
export const listForumsRoute = handler(listForums);
export const createForumRoute = handler(createForum);
export const readPostRoute = handler(readPost);
export const trendingRoute = handler(trending);
export const shareableRoute = handler(shareable);
export const reactRoute = handler(react);
export const reactorsRoute = handler(reactors);
export const addPostCommentRoute = handler(addPostComment);
export const likeCommentRoute = handler(likeComment);
export const deletePostCommentRoute = handler(deletePostComment);
export const sharePostRoute = handler(sharePost);
export const voteRoute = handler(vote);
export const removePostRoute = handler(removePost);
export const pinPostRoute = handler(pinPost);

const anon = { authLevel: 'anonymous' } as const;

app.http('me-posts', { ...anon, methods: ['GET'], route: 'me/posts', handler: myPostsRoute });
app.http('social-feed', { ...anon, methods: ['GET'], route: 'social/feed', handler: socialFeedRoute });
app.http('social-channels', { ...anon, methods: ['GET'], route: 'social/channels', handler: channelsRoute });
app.http('social-channel', { ...anon, methods: ['GET'], route: 'social/channels/{id}', handler: channelThreadRoute });
app.http('social-post', { ...anon, methods: ['POST'], route: 'social/posts', handler: createPostRoute });
app.http('social-forums', { ...anon, methods: ['GET'], route: 'social/forums', handler: listForumsRoute });
app.http('social-forum-create', { ...anon, methods: ['POST'], route: 'social/forums/new', handler: createForumRoute });

app.http('social-post-read', { ...anon, methods: ['GET'], route: 'social/posts/{channel}/{id}', handler: readPostRoute });
app.http('social-post-react', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/react', handler: reactRoute });
app.http('social-post-reactors', { ...anon, methods: ['GET'], route: 'social/posts/{channel}/{id}/reactions', handler: reactorsRoute });
app.http('social-post-comment', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/comments', handler: addPostCommentRoute });
app.http('social-comment-like', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/comments/{comment}/like', handler: likeCommentRoute });
app.http('social-comment-delete', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/comments/{comment}/delete', handler: deletePostCommentRoute });
app.http('social-post-share', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/share', handler: sharePostRoute });
app.http('social-post-vote', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/vote', handler: voteRoute });
app.http('social-post-delete', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/delete', handler: removePostRoute });
app.http('social-trending', { ...anon, methods: ['GET'], route: 'social/trending', handler: trendingRoute });
app.http('social-shareable', { ...anon, methods: ['GET'], route: 'social/shareable', handler: shareableRoute });
app.http('social-post-pin', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/pin', handler: pinPostRoute });
