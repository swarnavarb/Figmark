import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Post, User } from '../../../shared/models.js';
import {
  HIDDEN_MAX, LESS_FROM_MAX, MUTED_MAX, SAVED_POSTS_MAX, SEEN_BATCH_MAX, SEEN_MS_MAX, hashtagsIn, pushCapped,
  type FeedPrefs, type FollowSuggestion, type Leaderboard, type SeenEntry,
} from '../../../shared/feed.js';
import { PERSON_FOLLOW, isPersonFollow } from '../../../shared/storefront.js';
import { tagFromSlug, tagKey, tidyLabel } from '../../../shared/shop-tags.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { shopIndex } from '../shop-identity.js';
import { screenOf, screens } from '../feed-prefs.js';
import { moderation } from '../moderation.js';
import { tooFast } from '../rate-limit.js';
import { leaderboardOf } from '../play.js';
import { error, handler, json } from './http.js';
import {
  GUEST, actorFor, decorate, engagedActors, isBroadcast, mayRead, notYours, readJson, type PostCard, type Repo,
} from './social-routes.js';

/**
 * What a reader tells the feed, and what the feed can tell them back about
 * who is worth following.
 *
 * Saving, hiding and muting are kept on the account (see `FeedPrefs`); what
 * was read is counted on the post itself. Nothing here needs a container of
 * its own.
 */

const noPost = () => error(404, 'not_found', 'That post is not there any more.');

/**
 * Whether a post speaks as a shop - the rule the cards use: said in the
 * channel's own voice, under the storefront's name. A person's post on their
 * own wall shares the channel id with their shop, so the name tells them apart.
 */
function asShop(post: Post, owner: User | undefined): boolean {
  return post.channel === 'seller' && (post.voice ?? 'store') === 'store'
    && Boolean(owner?.sellerProfile) && owner!.sellerProfile!.storefrontName === post.authorName;
}

/** Everyone whose channel these posts are in, by id. */
async function channelOwners(posts: readonly Post[], repository: Repo): Promise<Map<string, User>> {
  const ids = [...new Set(posts.filter((post) => post.channel === 'seller').map((post) => post.channelId))];
  return new Map((await repository.listUsersByIds(ids)).map((person) => [person.id, person]));
}

/** The signed-in account, read whole, since a preference is written back onto it. */
async function account(request: HttpRequest) {
  const auth = await getAuthService();
  const viewer = await auth.requireAuth(request);
  const repository = await getRepository();
  const user = await repository.getUserById(viewer.id);
  return { viewer, repository, user };
}

/** Change this person's feed preferences and write them back. */
async function changePrefs(repository: Repo, user: User, change: (prefs: FeedPrefs) => FeedPrefs): Promise<FeedPrefs> {
  const prefs = change({ ...(user.feedPrefs ?? {}) });
  await repository.updateUser({ ...user, feedPrefs: prefs, updatedAt: new Date().toISOString() });
  return prefs;
}

/**
 * POST /api/social/posts/{channel}/{id}/save - keep a post to read again, or let it go.
 *
 * Toggles, like a bookmark on a listing. Anything the person may read can be
 * saved; a room message they lose access to drops out of the list on read.
 */
async function savePost(request: HttpRequest, _context: InvocationContext) {
  const { viewer, repository, user } = await account(request);
  if (!user) return error(401, 'unauthorized', 'Sign in first.');
  const slow = await tooFast(viewer.id, 'feedpref');
  if (slow) return slow;
  const channelId = request.params.channel ?? '';
  const postId = request.params.id ?? '';
  const post = channelId && postId ? await repository.getPost(channelId, postId) : null;
  const already = (user.feedPrefs?.saved ?? []).some((entry) => entry.postId === postId);
  if (!post && !already) return noPost();
  if (post && !already && !(await mayRead(post, viewer.id, repository))) return noPost();
  const prefs = await changePrefs(repository, user, (current) => ({
    ...current,
    saved: already
      ? (current.saved ?? []).filter((entry) => entry.postId !== postId)
      : pushCapped(current.saved, { channelId, postId, savedAt: new Date().toISOString() }, SAVED_POSTS_MAX,
          (a, b) => a.postId === b.postId),
  }));
  return json(200, { saved: !already, count: prefs.saved?.length ?? 0 });
}

/** GET /api/social/saved - the posts this person saved, newest saved first. */
async function savedPosts(request: HttpRequest, _context: InvocationContext) {
  const { viewer, repository, user } = await account(request);
  if (!user) return error(401, 'unauthorized', 'Sign in first.');
  const actor = await actorFor(request, viewer, repository);
  if (!actor) return notYours();
  const refs = user.feedPrefs?.saved ?? [];
  const found = await Promise.all(refs.slice(0, 100).map((ref) => repository.getPost(ref.channelId, ref.postId)));
  const readable: Post[] = [];
  for (const post of found) if (post && (await mayRead(post, viewer.id, repository))) readable.push(post);
  const cards = await decorate(readable, repository, actor);
  return json(200, { posts: cards.map((card) => ({ ...card, saved: true })) });
}

/**
 * POST /api/social/posts/{channel}/{id}/hide - put a post out of sight.
 *
 * `{ notInterested: true }` also tells ranking to show less from whoever
 * wrote it - lower, not gone. `{ undo: true }` brings the post back and takes
 * the "less from" with it.
 */
async function hidePost(request: HttpRequest, _context: InvocationContext) {
  const { viewer, repository, user } = await account(request);
  if (!user) return error(401, 'unauthorized', 'Sign in first.');
  const slow = await tooFast(viewer.id, 'feedpref');
  if (slow) return slow;
  const body = (await readJson<{ notInterested?: unknown; undo?: unknown }>(request)) ?? {};
  const channelId = request.params.channel ?? '';
  const postId = request.params.id ?? '';
  const post = channelId && postId ? await repository.getPost(channelId, postId) : null;
  if (!post) return noPost();
  if (post.authorId === viewer.id) return error(400, 'invalid_request', 'That is your own post. Delete it instead.');
  // Whose "less" it is: the shop whose channel it is in, or the person.
  const whose = post.channel === 'seller' ? post.channelId : post.authorId;
  const undo = body.undo === true;
  await changePrefs(repository, user, (current) => ({
    ...current,
    hidden: undo ? (current.hidden ?? []).filter((id) => id !== post.id) : pushCapped(current.hidden, post.id, HIDDEN_MAX),
    lessFrom: undo
      ? (current.lessFrom ?? []).filter((id) => id !== whose)
      : body.notInterested === true ? pushCapped(current.lessFrom, whose, LESS_FROM_MAX) : current.lessFrom,
  }));
  return json(200, { hidden: !undo });
}

/**
 * POST /api/social/mute - `{ id, on }`: stop seeing a person or a shop in
 * Discover, suggestions and the posts the feed finds - or start again.
 *
 * Following is left alone. Somebody who mutes a shop they follow still reads
 * its channel, which they chose; unfollowing is how to stop that.
 */
async function mute(request: HttpRequest, _context: InvocationContext) {
  const { viewer, repository, user } = await account(request);
  if (!user) return error(401, 'unauthorized', 'Sign in first.');
  const slow = await tooFast(viewer.id, 'feedpref');
  if (slow) return slow;
  const body = await readJson<{ id?: unknown; on?: unknown }>(request);
  const raw = typeof body?.id === 'string' ? body.id.trim() : '';
  const id = isPersonFollow(raw) ? raw.slice(PERSON_FOLLOW.length) : raw;
  if (!id) return error(400, 'invalid_request', 'Say who.');
  if (id === viewer.id) return error(400, 'invalid_request', 'You cannot mute yourself.');
  const on = body?.on !== false;
  if (on && !(await repository.getUserById(id))) return error(404, 'not_found', 'Nobody to mute there.');
  const prefs = await changePrefs(repository, user, (current) => ({
    ...current,
    muted: on ? pushCapped(current.muted, id, MUTED_MAX) : (current.muted ?? []).filter((entry) => entry !== id),
  }));
  return json(200, { muted: on, count: prefs.muted?.length ?? 0 });
}

/** GET /api/social/mutes - who this person muted, named, so they can be let back in. */
async function mutes(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await account(request);
  if (!user) return error(401, 'unauthorized', 'Sign in first.');
  const ids = user.feedPrefs?.muted ?? [];
  const people = new Map((await repository.listUsersByIds(ids)).map((person) => [person.id, person]));
  return json(200, {
    muted: ids.map((id) => {
      const person = people.get(id);
      return {
        id,
        name: person?.sellerProfile?.storefrontName ?? person?.displayName ?? 'Somebody',
        handle: person?.sellerProfile?.username ?? person?.username ?? null,
        shop: Boolean(person?.sellerProfile),
      };
    }),
  });
}

/**
 * POST /api/social/seen - `{ items: SeenEntry[] }`: what was on screen, for how
 * long, and what was opened.
 *
 * Counted on each post, not per reader (see `Post.views`). The app sends each
 * post once per visit, and a minute on screen is all one view can add, so
 * leaving a phone open on a post does not make it popular.
 */
async function seen(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const viewer = await auth.requireAuth(request);
  const slow = await tooFast(viewer.id, 'seen');
  if (slow) return slow;
  const body = await readJson<{ items?: unknown }>(request);
  const raw = Array.isArray(body?.items) ? body!.items.slice(0, SEEN_BATCH_MAX) : [];
  const items = raw.filter((entry): entry is SeenEntry => Boolean(entry) && typeof entry === 'object'
    && typeof (entry as SeenEntry).channelId === 'string' && typeof (entry as SeenEntry).postId === 'string');
  const repository = await getRepository();
  let counted = 0;
  await Promise.all(items.map(async (item) => {
    const ms = Math.max(0, Math.min(SEEN_MS_MAX, Math.round(Number(item.ms) || 0)));
    const changed = await repository.mutatePost(item.channelId, item.postId, (post) => (post.authorId === viewer.id ? null : {
      ...post,
      views: (post.views ?? 0) + 1,
      opens: (post.opens ?? 0) + (item.opened === true ? 1 : 0),
      dwellMs: (post.dwellMs ?? 0) + ms,
    }));
    if (changed) counted += 1;
  }));
  return json(200, { counted });
}

/** How many people and shops to suggest. */
const SUGGESTIONS = 12;

/**
 * GET /api/social/suggestions - people and shops worth following.
 *
 * Three reasons, strongest first: you keep engaging with their posts; people
 * you follow follow them; they sell what you save. Nobody you follow, have
 * muted, or are; and a reason is given for each, because "suggested for you"
 * on its own is not one.
 */
async function suggestions(request: HttpRequest, _context: InvocationContext) {
  const { viewer, repository, user } = await account(request);
  if (!user) return error(401, 'unauthorized', 'Sign in first.');
  const [follows, recent, liked] = await Promise.all([
    repository.listFollowsBy(viewer.id),
    repository.listRecentPosts(300),
    repository.listLikedListingIds(viewer.id),
  ]);
  const followKeys = new Set(follows.map((follow) => follow.sellerId));
  const screen = screenOf(user);
  const tally = new Map<string, { score: number; reason: string; shop: boolean }>();
  const offer = (followKey: string, score: number, reason: string) => {
    const shop = !isPersonFollow(followKey);
    const id = shop ? followKey : followKey.slice(PERSON_FOLLOW.length);
    if (id === viewer.id || followKeys.has(followKey) || screen.muted.has(id)) return;
    const was = tally.get(followKey);
    if (!was) tally.set(followKey, { score, reason, shop });
    else was.score += score;
  };

  // Whose posts this person keeps engaging with: the shop when the post
  // spoke as one, the person otherwise.
  const touched = recent.filter((post) => engagedActors(post).has(viewer.id));
  const owners = await channelOwners(touched, repository);
  const engagedWith = new Map<string, number>();
  for (const post of touched) {
    const key = isBroadcast(post) && asShop(post, owners.get(post.channelId)) ? post.channelId : `${PERSON_FOLLOW}${post.authorId}`;
    engagedWith.set(key, (engagedWith.get(key) ?? 0) + 1);
  }
  for (const [key, times] of engagedWith) {
    offer(key, 10 * times, times > 1 ? `You engaged with ${times} of their posts` : 'You engaged with their post');
  }

  // Followed by the people this person follows.
  const people = follows.filter((follow) => isPersonFollow(follow.sellerId)).slice(0, 20)
    .map((follow) => follow.sellerId.slice(PERSON_FOLLOW.length));
  const theirs = await Promise.all(people.map((id) => repository.listFollowsBy(id)));
  const viaFriends = new Map<string, number>();
  for (const list of theirs) for (const follow of list) viaFriends.set(follow.sellerId, (viaFriends.get(follow.sellerId) ?? 0) + 1);
  for (const [key, count] of viaFriends) {
    offer(key, 6 * count, count > 1 ? `Followed by ${count} people you follow` : 'Followed by somebody you follow');
  }

  // Shops selling what this person saves.
  const saved = await Promise.all(liked.slice(0, 20).map((id) => repository.getListing(id)));
  const categories = new Map<string, number>();
  for (const listing of saved) if (listing) categories.set(listing.category, (categories.get(listing.category) ?? 0) + 1);
  const top = [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const inCategories = await Promise.all(top.map(([category]) => repository.listListings({ category, limit: 30 })));
  top.forEach(([category], index) => {
    for (const listing of inCategories[index]!) offer(listing.sellerId, 3, `Sells ${category}`);
  });

  // Nothing to go on yet: the shops most people follow.
  if (tally.size < SUGGESTIONS) {
    // The shop index is held for a minute, so this costs no read of every shop.
    const owners = [...await shopIndex(repository)]
      .sort((a, b) => b.followerCount - a.followerCount).slice(0, SUGGESTIONS);
    for (const owner of owners) offer(owner.id, 0.5, 'Popular on Figmark');
  }

  const ranked = [...tally.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, SUGGESTIONS * 2);
  const ids = ranked.map(([key]) => (isPersonFollow(key) ? key.slice(PERSON_FOLLOW.length) : key));
  const found = new Map((await repository.listUsersByIds(ids)).map((person) => [person.id, person]));
  const rows: FollowSuggestion[] = [];
  for (const [key, entry] of ranked) {
    const id = isPersonFollow(key) ? key.slice(PERSON_FOLLOW.length) : key;
    const person = found.get(id);
    // A shop key for somebody with no shop is a person after all; one for a
    // closed account is nobody.
    if (!person || (entry.shop && !person.sellerProfile)) continue;
    rows.push({
      followKey: key,
      id,
      name: entry.shop ? person.sellerProfile!.storefrontName : person.displayName,
      handle: entry.shop ? person.sellerProfile!.username ?? person.username ?? null : person.username ?? null,
      photoUrl: entry.shop ? person.sellerProfile!.photoUrl ?? null : null,
      shop: entry.shop,
      followerCount: entry.shop ? person.sellerProfile!.followerCount : person.followerCount ?? 0,
      reason: entry.reason,
    });
    if (rows.length >= SUGGESTIONS) break;
  }
  return json(200, { suggestions: rows });
}

const WEEK_MS = 7 * 86_400_000;

/**
 * GET /api/social/leaderboard - this week's best: the most loved shelves, the
 * most argued debates, and the voices whose posts drew the most.
 *
 * Read from the recent posts each time - a week of posts is well inside the
 * window trending ranks - so there is no tally to keep in step. Public.
 */
async function leaderboard(_request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const [recent, moderated] = await Promise.all([repository.listRecentPosts(500), moderation(repository)]);
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const week = recent.filter((post) => post.createdAt >= since && !post.repostOf && !post.wallOf
    && (post.channel === 'forum' || (post.reach ?? 'feed') === 'feed')
    && !moderated.isRemoved(post.channel === 'forum' ? 'forum_post' : 'post', post.id));
  const reactions = (post: Post) => post.reactions?.length ?? post.likeCount;
  const votes = (post: Post) => post.poll?.options.reduce((sum, option) => sum + option.voterIds.length, 0) ?? 0;

  const shelves = week.filter((post) => post.flex && reactions(post) > 0)
    .sort((a, b) => reactions(b) - reactions(a)).slice(0, 5)
    .map((post) => ({ postId: post.id, channelId: post.channelId, name: post.authorName, photoUrl: post.photoUrl, reactions: reactions(post) }));
  const debates = week.filter((post) => post.debate && votes(post) > 0)
    .sort((a, b) => votes(b) - votes(a)).slice(0, 3)
    .map((post) => {
      const options = [...post.poll!.options].sort((a, b) => b.voterIds.length - a.voterIds.length);
      const tied = options.length > 1 && options[0]!.voterIds.length === options[1]!.voterIds.length;
      return { postId: post.id, channelId: post.channelId, question: post.body, votes: votes(post), leading: tied ? null : options[0]!.label };
    });

  // A voice is whoever the post speaks as: the shop for a shop's broadcast, the person otherwise.
  const voices = new Map<string, { reactions: number; posts: number; shop: boolean }>();
  const owners = await channelOwners(week, repository);
  for (const post of week) {
    const shop = asShop(post, owners.get(post.channelId));
    const id = shop ? post.channelId : post.authorId;
    const entry = voices.get(id) ?? { reactions: 0, posts: 0, shop };
    entry.reactions += reactions(post);
    entry.posts += 1;
    voices.set(id, entry);
  }
  const loudest = [...voices.entries()].filter(([, entry]) => entry.reactions > 0)
    .sort((a, b) => b[1].reactions - a[1].reactions).slice(0, 5);
  // The games are scored over the whole window, not the week: a competition
  // runs longer than seven days, and its winners should not fall off the
  // board the day it ends.
  const games = [...leaderboardOf(recent).values()]
    .sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, 10);
  const people = new Map((await repository.listUsersByIds([...loudest.map(([id]) => id), ...games.map((row) => row.userId)]))
    .map((person) => [person.id, person]));
  const board: Leaderboard = {
    since,
    shelves,
    debates,
    voices: loudest.flatMap(([id, entry]) => {
      const person = people.get(id);
      if (!person) return [];
      const shop = entry.shop && Boolean(person.sellerProfile);
      return [{
        id,
        name: shop ? person.sellerProfile!.storefrontName : person.displayName,
        handle: shop ? person.sellerProfile!.username ?? person.username ?? null : person.username ?? null,
        shop,
        reactions: entry.reactions,
        posts: entry.posts,
      }];
    }),
    players: games.flatMap((row) => {
      const person = people.get(row.userId);
      return person ? [{ ...row, name: person.displayName, handle: person.username ?? null }] : [];
    }),
  };
  return json(200, board);
}

/**
 * GET /api/social/topics/{slug} - the posts filed under one topic: its #tag in
 * the words, or a piece of that name tagged on a shelf. Newest first; public,
 * like the shops on the same tag's page.
 */
async function topicPosts(request: HttpRequest, _context: InvocationContext) {
  const key = tagFromSlug(request.params.slug ?? '');
  if (!key) return error(400, 'invalid_request', 'Which topic?');
  const auth = await getAuthService();
  const user = await auth.getCurrentUser(request);
  const repository = await getRepository();
  const actor = user ? await actorFor(request, user, repository) : GUEST;
  if (!actor) return notYours();
  const [recent, me, moderated] = await Promise.all([
    repository.listRecentPosts(500),
    user ? repository.getUserById(user.id) : Promise.resolve(null),
    moderation(repository),
  ]);
  const screen = screenOf(me);
  const posts = recent.filter((post) => !post.repostOf && !post.wallOf
    && (post.channel === 'forum' || (post.reach ?? 'feed') === 'feed')
    && !moderated.isRemoved(post.channel === 'forum' ? 'forum_post' : 'post', post.id)
    && !screens(screen, post)
    && (hashtagsIn(post.body).includes(key) || (post.flex?.hotspots ?? []).some((spot) => tagKey(spot.label) === key)))
    .slice(0, 40);
  const cards: PostCard[] = await decorate(posts, repository, actor);
  return json(200, { topic: { key, label: tidyLabel(key) }, posts: cards });
}

export const savePostRoute = handler(savePost);
export const savedPostsRoute = handler(savedPosts);
export const hidePostRoute = handler(hidePost);
export const muteRoute = handler(mute);
export const mutesRoute = handler(mutes);
export const seenRoute = handler(seen);
export const suggestionsRoute = handler(suggestions);
export const leaderboardRoute = handler(leaderboard);
export const topicPostsRoute = handler(topicPosts);

const anon = { authLevel: 'anonymous' as const };
app.http('social-post-save', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/save', handler: savePostRoute });
app.http('social-saved', { ...anon, methods: ['GET'], route: 'social/saved', handler: savedPostsRoute });
app.http('social-post-hide', { ...anon, methods: ['POST'], route: 'social/posts/{channel}/{id}/hide', handler: hidePostRoute });
app.http('social-mute', { ...anon, methods: ['POST'], route: 'social/mute', handler: muteRoute });
app.http('social-mutes', { ...anon, methods: ['GET'], route: 'social/mutes', handler: mutesRoute });
app.http('social-seen', { ...anon, methods: ['POST'], route: 'social/seen', handler: seenRoute });
app.http('social-suggestions', { ...anon, methods: ['GET'], route: 'social/suggestions', handler: suggestionsRoute });
app.http('social-leaderboard', { ...anon, methods: ['GET'], route: 'social/leaderboard', handler: leaderboardRoute });
app.http('social-topic', { ...anon, methods: ['GET'], route: 'social/topics/{slug}', handler: topicPostsRoute });
