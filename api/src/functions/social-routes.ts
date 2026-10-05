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
import { moderation } from '../moderation.js';
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
  /**
   * The forum it was said in, for a forum post read anywhere but its forum -
   * on somebody's wall, or in the feed - so it reads "Sana ▸ Deal spotting".
   */
  forum?: { id: string; name: string } | null;
  /** Other forums the same post went to. */
  alsoIn?: { id: string; name: string }[];
  /** Said by a shop, in its own name - which is what has a channel to open. */
  shop?: boolean;
  /** Why the home feed is showing it, beyond "you follow them". See `home`. */
  badges?: Boost[];
}

/** Trending: among the liveliest posts anywhere. Rising: new, and being tried on a wider audience. */
type Boost = 'trending' | 'rising';

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
  const { reactions: _reactions, comments: _comments, poll: _poll, sharedBy: _sharedBy, ...rest } = post;
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
  // A comment taken down after a dispute must not come back as a preview.
  const moderated = await moderation(repository);
  posts = posts.map((post) => (post.comments?.some((comment) => moderated.isRemoved('post_comment', comment.id))
    ? { ...post, comments: post.comments.filter((comment) => !moderated.isRemoved('post_comment', comment.id)) }
    : post));
  // A wall entry is its forum post, read where the author put it. The forum
  // post is fetched and decorated in its place, so reacting on the wall and
  // reacting in the forum are one reaction on one post.
  if (!options.nested && posts.some((post) => post.wallOf)) {
    const forumPosts = new Map<string, Post>();
    await Promise.all(posts.filter((post) => post.wallOf).map(async (post) => {
      const found = await repository.getPost(post.wallOf!.forumId, post.wallOf!.postId);
      if (found) forumPosts.set(post.id, found);
    }));
    // The same forum post can be here twice - its wall entry and itself - and
    // should be read once.
    const seen = new Set<string>();
    const resolved: Post[] = [];
    for (const post of posts) {
      const actual = post.wallOf ? forumPosts.get(post.id) : post;
      if (!actual || seen.has(actual.id)) continue;
      seen.add(actual.id);
      resolved.push(actual);
    }
    return decorate(resolved, repository, viewer, options);
  }

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

  const forumNames = new Map<string, string>();
  if (posts.some((post) => post.channel === 'forum')) {
    for (const forum of await repository.listForums()) forumNames.set(forum.id, forum.name);
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
      shop: spokenAsShop,
    };
    if (post.repostOf) card.original = originalCards.get(post.id) ?? null;
    if (post.channel === 'forum') {
      card.forum = { id: post.channelId, name: forumNames.get(post.channelId) ?? 'Forum' };
      if (post.alsoIn?.length) card.alsoIn = post.alsoIn.map((entry) => ({ id: entry.forumId, name: entry.forumName }));
      // A forum is not somebody to follow; its posts are read by joining.
      card.following = true;
    }
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

/**
 * A forum's posts without any said in a shop's name.
 *
 * A shop's voice is recognised the way the rest of this file does it: the
 * post carries the storefront's name rather than the person's.
 */
async function withoutShops(posts: Post[], repository: Repo): Promise<Post[]> {
  const authors = new Map((await repository.listUsersByIds([...new Set(posts.map((post) => post.authorId))]))
    .map((user) => [user.id, user]));
  return posts.filter((post) => {
    const author = authors.get(post.authorId);
    return !author?.sellerProfile || author.sellerProfile.storefrontName !== post.authorName
      || author.displayName === post.authorName;
  });
}

/** Said when a shop tries to take part in a forum. */
const MAX_ALSO_FORUMS = 2;
const shopsStayOut = () => error(403, 'people_only', 'Forums are for people. Switch to your profile to take part.');
/** A shop has one room - its own. In anybody else's channel you are a customer. */
const shopsStayHome = () => error(403, 'people_only', 'Only people read and write in other shops\' channels. Switch to your profile.');
/** A channel message, touched by a shop that does not own the channel. */
const shopInSomebodyElsesRoom = (post: Post, actor: Actor) =>
  post.channel === 'seller' && post.reach === 'channel' && Boolean(actor.storeId) && actor.storeId !== post.channelId;

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

/** How many of the hottest posts count as trending. */
const TRENDING_SIZE = 12;
/**
 * And never more than this share of the posts anybody engaged with: on a quiet
 * day the top twelve is most of them, and a lightning on everything means nothing.
 */
const TRENDING_SHARE = 0.25;
/** How long a post counts as new, and so may rise. */
const RISING_WINDOW_MS = 48 * 3_600_000;
/** Share of everybody else a new post is tried on before it has earned more. */
const RISING_SEED_PERCENT = 15;
/** Different people engaging before a new post is shown to everyone. */
const RISING_GRADUATE = 3;
/** One followed post, then one found post, in this rhythm. */
const DISCOVER_EVERY = 3;

/** Everyone who reacted, commented or voted, not counting whoever wrote it. */
function engagedActors(post: Post): Set<string> {
  const actors = new Set<string>();
  for (const reaction of post.reactions ?? []) actors.add(reactionActor(reaction));
  for (const comment of post.comments ?? []) actors.add(actorKey(comment.authorId, comment.asStore));
  for (const option of post.poll?.options ?? []) for (const id of option.voterIds) actors.add(id);
  actors.delete(post.authorId);
  actors.delete(`store:${post.channelId}`);
  return actors;
}

/**
 * A stable number 0-99 for a post and a viewer.
 *
 * Picks who a new post is tried on without storing an audience: the same
 * viewer lands in the same bucket on every load, so a post does not flicker
 * in and out of somebody's feed between refreshes.
 */
function bucket(postId: string, viewerId: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${postId}:${viewerId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return (hash >>> 0) % 100;
}

/** A broadcast on somebody's feed, as opposed to a room message, a forum post or a wall echo of one. */
const isBroadcast = (post: Post) =>
  post.channel === 'seller' && (post.reach ?? 'feed') === 'feed' && !post.wallOf;

/**
 * GET /api/social/home - one feed: who you follow, with what is catching on mixed in.
 *
 * Followed posts keep their order, newest first, so "what did my people say"
 * stays reliable; every few of them, one post from outside is slotted in. Two
 * kinds come from outside, and each carries a badge saying why it is there:
 *
 * - trending: among the liveliest posts anywhere right now (see `heat`).
 * - rising: new (under two days old), from somebody you do not follow, and
 *   either tried on you first or already proven. A new post goes to a small
 *   audience - people who have engaged with its author before, people whose
 *   follows reacted to it, and a stable slice of everybody else - and once
 *   enough different people engage it goes to everyone.
 *
 * A followed post that is also trending or rising stays where it is and gets
 * the badge, rather than showing twice.
 */
async function home(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const actor = await actorFor(request, user, repository);
  if (!actor) return notYours();

  const followed = await repository.listFollowedSellerIds(user.id);
  const followedSet = new Set(followed);
  const [ownFeed, recent] = await Promise.all([
    repository.listPostsForChannels([...new Set([...followed, user.id])]),
    repository.listRecentPosts(200),
  ]);
  const now = Date.now();
  const scores = new Map(recent.map((post) => [post.id, heat(post, now)]));
  const engaged = new Map(recent.map((post) => [post.id, engagedActors(post)]));

  const lively = recent.filter((post) => isBroadcast(post) && scores.get(post.id)! > 0);
  const trendingIds = new Set(lively
    .sort((a, b) => scores.get(b.id)! - scores.get(a.id)!)
    .slice(0, Math.min(TRENDING_SIZE, Math.ceil(lively.length * TRENDING_SHARE)))
    .map((post) => post.id));

  // Whose posts this viewer has engaged with lately: the strongest sign a new
  // one from them is wanted.
  const affinity = new Set<string>();
  for (const post of recent) {
    const who = engaged.get(post.id)!;
    if (who.has(actor.key) || who.has(user.id)) affinity.add(post.channelId);
  }
  const followedActed = (post: Post) =>
    (post.reactions ?? []).some((reaction) => followedSet.has(reaction.asStore ?? reaction.userId))
    || (post.comments ?? []).some((comment) => followedSet.has(comment.asStore ?? comment.authorId));

  const risingIds = new Set<string>();
  for (const post of recent) {
    if (!isBroadcast(post) || post.repostOf || now - new Date(post.createdAt).getTime() > RISING_WINDOW_MS) continue;
    if (post.authorId === user.id || post.channelId === user.id) continue;
    const proven = engaged.get(post.id)!.size >= RISING_GRADUATE;
    const tried = !followedSet.has(post.channelId) && (affinity.has(post.channelId) || followedActed(post)
      || bucket(post.id, user.id) < RISING_SEED_PERCENT);
    if (proven || tried) risingIds.add(post.id);
  }

  const followedPosts = ownFeed.filter((post) => (post.reach ?? 'feed') === 'feed');
  const inFeed = new Set(followedPosts.map((post) => post.id));
  // Trending first, hottest first; then rising, proven before merely tried.
  const found = [
    ...recent.filter((post) => trendingIds.has(post.id))
      .sort((a, b) => scores.get(b.id)! - scores.get(a.id)!),
    ...recent.filter((post) => risingIds.has(post.id) && !trendingIds.has(post.id))
      .sort((a, b) => engaged.get(b.id)!.size - engaged.get(a.id)!.size || b.createdAt.localeCompare(a.createdAt)),
  ].filter((post) => !inFeed.has(post.id) && post.authorId !== user.id && post.channelId !== user.id);

  const merged: Post[] = [];
  let next = 0;
  followedPosts.forEach((post, index) => {
    merged.push(post);
    if ((index + 1) % DISCOVER_EVERY === 0 && next < found.length) merged.push(found[next++]!);
  });
  merged.push(...found.slice(next));

  const cards = await decorate(merged, repository, actor, { followed: followedSet });
  return json(200, {
    posts: cards.map((card) => {
      const badges: Boost[] = [];
      if (trendingIds.has(card.post.id)) badges.push('trending');
      if (risingIds.has(card.post.id)) badges.push('rising');
      return badges.length ? { ...card, badges } : card;
    }),
  });
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
 * GET /api/users/{id}/posts - what one person has said in the open, newest first.
 *
 * For their collector page. Only forum posts, in their own voice: a shop's
 * channel is for its followers, so a person's messages there are not this
 * page's to repeat, and a post in a shop's name belongs on the shop's page.
 */
async function personPosts(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');
  const repository = await getRepository();
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request);
  const open = (await repository.listPostsByAuthor(id))
    .filter((post) => post.channel === 'forum' || Boolean(post.wallOf))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);
  const actor: Actor = viewer ? personActor(viewer) : { userId: '', storeId: null, key: '', name: '' };
  return json(200, { posts: await decorate(await withoutShops(open, repository), repository, actor) });
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
  if (!forum && actor.storeId && actor.storeId !== channelId) return shopsStayHome();

  // Whoever may speak for the shop. A manager posting for it is the shop
  // speaking, which is why this is a rights check rather than an id comparison.
  const mine = Boolean(seller && can(seller, viewer.id, 'posts'));
  const following = followed.includes(channelId);

  // A channel is for the people who follow the shop. Everybody else sees the
  // door - who it is, how many are inside - and a button to come in.
  const locked = !forum && !mine && !following;
  // A forum is people talking as themselves. Anything said there in a shop's
  // name predates that rule and is not shown.
  const shown = locked ? [] : forum ? await withoutShops(posts, repository) : posts;

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
    locked,
    channel: forum
      ? {
          id: forum.id, kind: 'forum' as const, name: forum.name, description: forum.description, mine: false,
          memberCount: forum.memberIds?.length ?? 0,
          member: (forum.memberIds ?? []).includes(viewer.id),
          postCount: shown.length,
        }
      : {
          id: channelId,
          kind: 'seller' as const,
          name: seller!.sellerProfile!.storefrontName,
          handle: seller!.sellerProfile!.username ?? seller!.username ?? null,
          description: seller!.sellerProfile!.bio ?? '',
          photoUrl: seller!.sellerProfile!.photoUrl ?? null,
          tier: seller!.sellerProfile!.tier ?? null,
          followerCount: seller!.sellerProfile!.followerCount ?? 0,
          following,
          mine,
          postCount: posts.length,
        },
    shareable,
    posts: await decorate(shown, repository, actor, { followed: new Set(followed) }),
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
    /** A forum post that goes on the author's feed too. */
    toWall?: boolean;
    /** Up to two more forums to share the same post into. */
    alsoForumIds?: unknown;
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
      // A customer is a person. A shop does not speak in another shop's room.
      authorName = user.displayName;
      if (body.storeId) return shopsStayHome();
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

  let forumName: string | null = null;
  const alsoForums: Forum[] = [];
  if (body.forumId) {
    const forum = await repository.getForum(body.forumId);
    if (!forum) return error(404, 'not_found', 'No such forum.');
    // People only, and only the ones who joined.
    if (body.storeId) return shopsStayOut();
    if (!(forum.memberIds ?? []).includes(user.id)) {
      return error(403, 'not_a_member', `Join ${forum.name} to post in it.`);
    }
    forumName = forum.name;
    authorName = user.displayName;
    channelId = forum.id;
    const extra = Array.isArray(body.alsoForumIds) ? [...new Set(body.alsoForumIds)] : [];
    if (extra.length > MAX_ALSO_FORUMS || extra.some((id) => typeof id !== 'string' || id === forum.id)) {
      return error(400, 'invalid_post', `Share into ${MAX_ALSO_FORUMS + 1} forums at most.`);
    }
    for (const id of extra as string[]) {
      const other = await repository.getForum(id);
      if (!other) return error(404, 'not_found', 'No such forum.');
      if (!(other.memberIds ?? []).includes(user.id)) {
        return error(403, 'not_a_member', `Join ${other.name} to post in it.`);
      }
      alsoForums.push(other);
    }
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

  // On the author's wall too, when they asked: an entry there that points
  // back at the forum post, so there is one conversation, not two.
  if (forumName && body.toWall) {
    post.wallPostId = `pst_${randomUUID().slice(0, 12)}`;
  }
  // The same post into the other forums picked: a post of its own in each,
  // each knowing where else it went.
  if (alsoForums.length > 0) {
    const everywhere = [
      { forumId: channelId, forumName: forumName!, postId: post.id },
      ...alsoForums.map((forum) => ({ forumId: forum.id, forumName: forum.name, postId: `pst_${randomUUID().slice(0, 12)}` })),
    ];
    post.alsoIn = everywhere.slice(1);
    for (const copy of everywhere.slice(1)) {
      await repository.createPost({
        ...post,
        id: copy.postId,
        channelId: copy.forumId,
        wallPostId: null,
        alsoIn: everywhere.filter((entry) => entry.forumId !== copy.forumId),
      });
    }
  }
  const saved = await repository.createPost(post);
  if (forumName && post.wallPostId) {
    await repository.createPost({
      ...post,
      id: post.wallPostId,
      channelId: user.id,
      channel: 'seller',
      kind: 'update',
      body: '',
      listingId: null,
      photoUrl: null,
      photoUrls: [],
      poll: null,
      voice: 'store',
      reach: 'feed',
      announcement: false,
      replyTo: null,
      wallPostId: null,
      wallOf: { forumId: channelId, forumName, postId: post.id },
    });
  }
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
  // Comments an operator took down after a dispute are gone for everybody;
  // the rest carry what the report button under them needs to say.
  const moderated = await moderation(repository);
  const mark = <T extends CommentView>(view: T): T => ({
    ...view,
    mine: (post.comments ?? []).find((comment) => comment.id === view.id)?.authorId === viewer.userId,
    moderation: moderated.mark('post_comment', view.id, viewer.userId),
  });
  return threadsOf(post, viewer, people)
    .filter((thread) => !moderated.isRemoved('post_comment', thread.id))
    .map((thread) => ({
      ...mark(thread),
      replies: thread.replies.filter((reply) => !moderated.isRemoved('post_comment', reply.id)).map(mark),
    }));
}

const noPost = () => error(404, 'not_found', 'That post is not there any more.');
const followFirst = () => error(403, 'follow_required', 'Follow the shop to read its channel.');

/**
 * Whether this person may read a post.
 *
 * Broadcasts are public - they are what trending is made of. What was said
 * inside a shop's channel is for the people who follow the shop, and for
 * whoever runs it.
 */
async function mayRead(post: Post, userId: string, repository: Repo): Promise<boolean> {
  if (post.channel !== 'seller' || (post.reach ?? 'feed') === 'feed') return true;
  const owner = await repository.getUserById(post.channelId);
  if (!owner?.sellerProfile || can(owner, userId, 'posts')) return true;
  return (await repository.listFollowedSellerIds(userId)).includes(post.channelId);
}

/** GET /api/social/posts/{channel}/{id} - one post and everything said under it. */
async function readPost(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  if (!(await mayRead(post, user.id, repository))) return followFirst();
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
  if (!(await mayRead(post, user.id, repository))) return followFirst();
  if (post.channel === 'forum' && actor.storeId) return shopsStayOut();
  if (shopInSomebodyElsesRoom(post, actor)) return shopsStayHome();
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
  const { user, repository, post, actor } = await target(request);
  if (!actor) return notYours();
  if (!post) return noPost();
  if (!(await mayRead(post, user.id, repository))) return followFirst();
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
  if (!(await mayRead(post, user.id, repository))) return followFirst();
  if (post.channel === 'forum' && actor.storeId) return shopsStayOut();
  if (shopInSomebodyElsesRoom(post, actor)) return shopsStayHome();
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
  if (!(await mayRead(post, user.id, repository))) return followFirst();
  if (post.channel === 'forum' && actor.storeId) return shopsStayOut();
  if (shopInSomebodyElsesRoom(post, actor)) return shopsStayHome();
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
  if (!(await mayRead(post, user.id, repository))) return followFirst();
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

  // Once per actor, however many times it goes out: shares weigh most in
  // trending, and a counter anybody can tap forever would rank anything.
  const saved = await repository.mutatePost(source.channelId, source.id, (current) => {
    const sharers = current.sharedBy ?? [];
    if (sharers.includes(actor.key)) return null;
    return { ...current, shareCount: (current.shareCount ?? 0) + 1, sharedBy: [...sharers, actor.key] };
  });
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
  if (!(await mayRead(post, user.id, repository))) return followFirst();
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
  // A forum post and its wall entry go together, whichever end is deleted.
  if (post.wallPostId) await repository.deletePost(post.authorId, post.wallPostId);
  if (post.wallOf) await repository.deletePost(post.wallOf.forumId, post.wallOf.postId);
  return json(200, { deleted: post.id });
}

/** A forum as a list shows it: who is in it is a count, and whether you are. */
function forumRow(forum: Forum, viewerId: string, latest: Post | null = null) {
  const { memberIds, ...rest } = forum;
  return {
    ...rest,
    memberCount: memberIds?.length ?? 0,
    member: (memberIds ?? []).includes(viewerId),
    lastPost: latest ? gist(latest.body || 'Photo') : null,
    lastPostAt: latest?.createdAt ?? null,
    lastPostBy: latest?.authorName ?? null,
  };
}

/** GET /api/social/forums - the rooms, yours first, and how much room is left. */
async function listForums(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const forums = await repository.listForums();
  const rows = await Promise.all(forums.map(async (forum) => {
    const [latest] = await withoutShops(await repository.listPosts(forum.id, 5), repository);
    return forumRow(forum, user.id, latest ?? null);
  }));
  rows.sort((a, b) => Number(b.member) - Number(a.member) || (b.lastPostAt ?? '').localeCompare(a.lastPostAt ?? ''));
  return json(200, { forums: rows, cap: FORUM_CAP, remaining: Math.max(0, FORUM_CAP - forums.length) });
}

/**
 * POST /api/social/forums/{id}/join - join, or leave when already in.
 *
 * As yourself only: a shop has a channel of its own and no seat in a forum.
 */
async function joinForum(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  if (request.query?.get('as')) return shopsStayOut();
  const repository = await getRepository();
  const forum = request.params.id ? await repository.getForum(request.params.id) : null;
  if (!forum) return error(404, 'not_found', 'No such forum.');
  const members = new Set(forum.memberIds ?? []);
  if (members.has(user.id)) members.delete(user.id);
  else members.add(user.id);
  forum.memberIds = [...members];
  forum.updatedAt = new Date().toISOString();
  const saved = await repository.saveForum(forum);
  return json(200, { forum: forumRow(saved, user.id) });
}

/**
 * GET /api/social/search?q= - people, shops and forums by name or handle.
 *
 * The social tab's search is for finding somebody, not something: items have
 * the marketplace search. Everybody is read and filtered here, which is fine
 * at this size and is the one place to swap for an index later.
 */
async function search(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const needle = (request.query?.get('q') ?? '').trim().toLowerCase().replace(/^@/, '');
  if (needle.length < 1) return json(200, { people: [], shops: [], forums: [] });
  const repository = await getRepository();
  const [everyone, followed, forums] = await Promise.all([
    repository.listAllUsers(),
    repository.listFollowedSellerIds(user.id),
    repository.listForums(),
  ]);
  const following = new Set(followed);
  const hit = (...fields: (string | null | undefined)[]) =>
    fields.some((field) => field?.toLowerCase().includes(needle));
  // Starts-with beats contains, so typing a name finds that name first.
  const rank = (name: string, handle: string | null) =>
    Number(!(name.toLowerCase().startsWith(needle) || (handle ?? '').startsWith(needle)));

  const people = everyone
    .filter((person) => person.id !== user.id && person.username && hit(person.displayName, person.username))
    .map((person) => ({
      id: person.id,
      name: person.displayName,
      handle: person.username ?? null,
      bio: person.bio ?? '',
      following: following.has(person.id),
    }))
    .sort((a, b) => rank(a.name, a.handle) - rank(b.name, b.handle) || a.name.localeCompare(b.name))
    .slice(0, 12);
  const shops = everyone
    .filter((owner) => owner.sellerProfile
      && hit(owner.sellerProfile.storefrontName, owner.sellerProfile.username, owner.sellerProfile.bio))
    .map((owner) => ({
      id: owner.id,
      name: owner.sellerProfile!.storefrontName,
      handle: owner.sellerProfile!.username ?? null,
      bio: owner.sellerProfile!.bio ?? '',
      photoUrl: owner.sellerProfile!.photoUrl ?? null,
      followerCount: owner.sellerProfile!.followerCount ?? 0,
      tier: owner.sellerProfile!.tier ?? null,
      following: following.has(owner.id),
      mine: can(owner, user.id, 'posts'),
    }))
    .sort((a, b) => rank(a.name, a.handle) - rank(b.name, b.handle) || b.followerCount - a.followerCount)
    .slice(0, 12);
  const rooms = forums
    .filter((forum) => hit(forum.name, forum.description))
    .map((forum) => forumRow(forum, user.id))
    .slice(0, 6);
  return json(200, { people, shops, forums: rooms });
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
  if (request.query?.get('as')) return shopsStayOut();

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
    // Whoever opens a room is in it.
    memberIds: [user.id],
    createdAt: now,
    updatedAt: now,
  };

  return json(201, { forum: forumRow(await repository.createForum(forum), user.id) });
}

export const socialFeedRoute = handler(socialFeed);
export const myPostsRoute = handler(myPosts);
export const personPostsRoute = handler(personPosts);
export const channelsRoute = handler(channels);
export const channelThreadRoute = handler(channelThread);
export const createPostRoute = handler(createPost);
export const listForumsRoute = handler(listForums);
export const createForumRoute = handler(createForum);
export const readPostRoute = handler(readPost);
export const trendingRoute = handler(trending);
export const homeRoute = handler(home);
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
export const joinForumRoute = handler(joinForum);
export const socialSearchRoute = handler(search);

const anon = { authLevel: 'anonymous' } as const;

app.http('me-posts', { ...anon, methods: ['GET'], route: 'me/posts', handler: myPostsRoute });
app.http('person-posts', { ...anon, methods: ['GET'], route: 'users/{id}/posts', handler: personPostsRoute });
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
app.http('social-home', { ...anon, methods: ['GET'], route: 'social/home', handler: homeRoute });
app.http('social-shareable', { ...anon, methods: ['GET'], route: 'social/shareable', handler: shareableRoute });
app.http('social-post-pin', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/pin', handler: pinPostRoute });
app.http('social-forum-join', { ...anon, methods: ['POST'], route: 'social/forums/{id}/join', handler: joinForumRoute });
app.http('social-search', { ...anon, methods: ['GET'], route: 'social/search', handler: socialSearchRoute });
