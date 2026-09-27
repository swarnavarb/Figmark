import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Dispute, QuestState, User } from '../../../shared/models.js';
import { isCancelledLike, isPlaced, reviewRevealed, scoreFrom } from '../../../shared/orders.js';
import {
  CARD_XP, TASK_BY_ID, claimKey, dayKey, drawCard, emptyQuestState, packFor, questView, tidyQuestState,
  type QuestFacts, type QuestView,
} from '../../../shared/quest.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * The collector game: XP, levels, tasks, packs and the public collector page.
 *
 * The rules live in `shared/quest.ts`. What this file adds is the reading -
 * gathering everything a person has done into the facts those rules count -
 * and the four writes the game owns: checking in, collecting a task's reward,
 * revealing the daily drop and opening a pack. Each write is idempotent by
 * construction (a day is checked into once, a claim key is set once, a pack id
 * opens once), so a double tap or a retry can never pay twice.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Everything the rules count, read from the rows rather than from a tally. */
async function factsFor(repository: Repo, user: User): Promise<QuestFacts> {
  const [allOrders, likes, follows, posts, wants, pledged, reviewsAbout] = await Promise.all([
    repository.listOrdersForBuyer(user.id),
    repository.listLikesBy(user.id),
    repository.listFollowedSellerIds(user.id),
    repository.listPostsByAuthor(user.id),
    repository.listWantsBy(user.id),
    repository.listPledgedListingIds(user.id),
    repository.listReviewsAbout(user.id),
  ]);

  // Pressing Buy is not an order, and an order called off is not one either.
  const orders = allOrders.filter((order) => isPlaced(order) && !isCancelledLike(order.status));

  // A group buy is a fact about the item, so it is read off the listing.
  const listingIds = [...new Set(orders.map((order) => order.listingId))];
  const listings = await Promise.all(listingIds.map((id) => repository.getListing(id)));
  const groupBuy = new Set(listings.filter((listing) => listing?.preOrder).map((listing) => listing!.id));

  // Reviews this person wrote live under whoever they wrote about, so they are
  // found through the person's own orders - one small partition read each.
  const written = (
    await Promise.all(orders.map((order) => repository.listReviewsForOrder(order.id)))
  ).flat().filter((review) => review.authorId === user.id);

  return {
    orders: orders.map((order) => ({
      createdAt: order.placedAt ?? order.createdAt,
      status: order.status,
      totalMinor: order.unitPriceMinor * order.quantity,
      groupBuy: groupBuy.has(order.listingId),
    })),
    reviewsWritten: written.map((review) => ({ createdAt: review.createdAt })),
    fiveStarsReceived: reviewsAbout.filter(
      (review) => review.direction === 'seller_to_buyer' && review.rating === 5 && reviewRevealed(review, false),
    ).length,
    likes: likes.map((like) => ({ createdAt: like.createdAt })),
    follows: follows.length,
    posts: posts.map((post) => ({ createdAt: post.createdAt })),
    wants: wants.length,
    pledges: pledged.length,
    disputesLost: user.buyerTrust?.disputesLost ?? 0,
    hasBio: Boolean(user.bio?.trim()),
    hasTags: (user.tags ?? []).length > 0,
  };
}

/**
 * Works the view out and remembers the XP it came to.
 *
 * The cache is only there so the leaderboard can rank everybody with one scan
 * instead of recounting every account's orders; it is rewritten whenever it
 * has moved, and never read as the truth about anybody's own XP.
 */
async function viewFor(repository: Repo, user: User, state: QuestState = user.quest ?? emptyQuestState()) {
  const view = questView(user.id, await factsFor(repository, user), state);
  if (state.xpCache !== view.xp || state.levelCache !== view.level) {
    user.quest = tidyQuestState({ ...state, xpCache: view.xp, levelCache: view.level, computedAt: new Date().toISOString() });
    user.updatedAt = new Date().toISOString();
    await repository.updateUser(user);
  }
  return view;
}

async function signedIn(request: HttpRequest) {
  const auth = await getAuthService();
  const principal = await auth.requireAuth(request);
  const repository = await getRepository();
  const user = await repository.getUserById(principal.id);
  return { repository, user };
}

/** Saves a changed state and answers with what it did to the numbers. */
async function commit(repository: Repo, user: User, before: QuestView, next: QuestState, extra: object = {}) {
  user.quest = tidyQuestState(next);
  user.updatedAt = new Date().toISOString();
  await repository.updateUser(user);
  const view = await viewFor(repository, user, user.quest);
  return json(200, {
    ...extra,
    view,
    gained: view.xp - before.xp,
    levelBefore: before.level,
    levelAfter: view.level,
  });
}

/** GET /api/quest/me - your level, XP, streak, tasks, stickers, cards and packs. */
async function me(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  return json(200, { view: await viewFor(repository, user) });
}

/** POST /api/quest/checkin - once a day, India time. Asking twice is not an error. */
async function checkIn(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const state = user.quest ?? emptyQuestState();
  const before = await viewFor(repository, user, state);
  const today = dayKey(Date.now());
  if (state.checkIns.includes(today)) {
    return json(200, { view: before, gained: 0, levelBefore: before.level, levelAfter: before.level, already: true });
  }
  return commit(repository, user, before, { ...state, checkIns: [...state.checkIns, today] });
}

/** POST /api/quest/claim - collect a finished task's reward. */
async function claim(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');

  let body: { taskId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const taskId = String(body.taskId ?? '');
  const key = claimKey(taskId);
  if (!key || !TASK_BY_ID.has(taskId)) return error(404, 'not_found', 'No such task.');

  const state = user.quest ?? emptyQuestState();
  const before = await viewFor(repository, user, state);
  const task = before.tasks.find((entry) => entry.id === taskId);
  if (!task?.done) return error(409, 'not_done', 'Finish the task first.');
  if (task.claimed) return error(409, 'already_claimed', 'You already collected this one.');

  return commit(repository, user, before, {
    ...state,
    claimed: { ...state.claimed, [key]: new Date().toISOString() },
  }, { taskId });
}

/**
 * POST /api/quest/reveal - flip today's drop.
 *
 * One card a day, drawn from who you are and which day it is, so it is the
 * same card however many times the request is made.
 */
async function reveal(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const state = user.quest ?? emptyQuestState();
  const packId = `daily-${dayKey(Date.now())}`;
  const card = drawCard(user.id, packId);
  const before = await viewFor(repository, user, state);
  if (state.cards.some((owned) => owned.packId === packId)) {
    return json(200, { card, view: before, gained: 0, levelBefore: before.level, levelAfter: before.level, already: true });
  }
  return commit(repository, user, before, {
    ...state,
    cards: [...state.cards, { cardId: card.id, packId, at: new Date().toISOString() }],
  }, { card, cardXp: CARD_XP[card.rarity] });
}

/** POST /api/quest/open - open one earned pack. */
async function openPack(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');

  let body: { packId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const packId = String(body.packId ?? '');
  const state = user.quest ?? emptyQuestState();
  const before = await viewFor(repository, user, state);
  const pack = packFor(state, before.level, packId);
  if (!pack) return error(404, 'not_found', 'There is no unopened pack by that name.');

  const card = drawCard(user.id, pack.id, pack.min);
  return commit(repository, user, before, {
    ...state,
    cards: [...state.cards, { cardId: card.id, packId: pack.id, at: new Date().toISOString() }],
  }, { card, cardXp: CARD_XP[card.rarity], pack });
}

/**
 * GET /api/quest/leaderboard - the top collectors.
 *
 * Ranked from the XP cached the last time each account's own view was worked
 * out. It can lag somebody who has not opened the app since their last order,
 * which is the right trade for a list: nobody's figure is recounted here.
 */
async function leaderboard(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request);

  const ranked = (await repository.listAllUsers())
    .filter((user) => !user.suspended && (user.quest?.xpCache ?? 0) > 0)
    .sort((a, b) => (b.quest?.xpCache ?? 0) - (a.quest?.xpCache ?? 0));

  const row = (user: User, index: number) => ({
    rank: index + 1,
    userId: user.id,
    name: user.displayName,
    handle: user.username ?? null,
    xp: user.quest?.xpCache ?? 0,
    level: user.quest?.levelCache ?? 1,
    cards: user.quest?.cards.length ?? 0,
  });

  const mine = viewer ? ranked.findIndex((user) => user.id === viewer.id) : -1;
  return json(200, {
    top: ranked.slice(0, 10).map(row),
    me: mine >= 0 ? row(ranked[mine]!, mine) : null,
    total: ranked.length,
  });
}

/** How one dispute ended for one of its two people. */
function outcomeFor(dispute: Dispute, userId: string): 'won' | 'lost' | 'even' | 'open' {
  if (dispute.status !== 'resolved' && dispute.status !== 'withdrawn') return 'open';
  const side = dispute.raisedBy === userId ? dispute.raisedSide : dispute.raisedSide === 'buyer' ? 'seller' : 'buyer';
  const outcome = dispute.resolution?.outcome ?? (dispute.status === 'withdrawn' ? 'withdrawn' : null);
  if (outcome === 'split') return 'even';
  if (outcome === 'withdrawn') return dispute.raisedBy === userId ? 'even' : 'won';
  if (outcome === 'refund_buyer') return side === 'buyer' ? 'won' : 'lost';
  if (outcome === 'release_seller') return side === 'seller' ? 'won' : 'lost';
  return 'even';
}

/**
 * GET /api/users/{id}/collector - somebody's collector page, from the record.
 *
 * Public: level, stickers and cards are things people show off, and the trade
 * record next to them is the same record the credit sheet already publishes.
 * Nothing private crosses - no tasks, no packs, no saves, no amounts spent.
 */
async function collector(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');
  const user = await repository.getUserById(id);
  if (!user || user.suspended) return error(404, 'not_found', 'No such account.');

  const [facts, reviews, disputes, following] = await Promise.all([
    factsFor(repository, user),
    repository.listReviewsAbout(id),
    repository.listDisputes(),
    repository.listFollowedSellerIds(id),
  ]);
  const view = questView(user.id, facts, user.quest);

  const asBuyer = reviews
    .filter((review) => review.direction === 'seller_to_buyer' && reviewRevealed(review, false))
    .map((review) => review.rating);
  const theirs = disputes.filter((dispute) => dispute.raisedBy === id || dispute.againstUserId === id);
  const tally = { won: 0, lost: 0, even: 0, open: 0 };
  for (const dispute of theirs) tally[outcomeFor(dispute, id)] += 1;

  return json(200, {
    userId: user.id,
    level: view.level,
    title: view.title,
    xp: view.xp,
    levelFloor: view.levelFloor,
    nextLevelXp: view.nextLevelXp,
    progress: view.progress,
    streak: { current: view.streak.current, best: view.streak.best },
    stickers: view.stickers,
    // One of each card, rarest first: a shelf rather than every duplicate.
    cards: view.cards.filter((card, index, all) => all.findIndex((other) => other.id === card.id) === index),
    cardCount: view.cards.length,
    sets: view.sets,
    stats: {
      rating: scoreFrom(asBuyer),
      ratingCount: asBuyer.length,
      orders: facts.orders.length,
      completed: facts.orders.filter((order) => order.status === 'delivered').length,
      reviewsWritten: facts.reviewsWritten.length,
      groupBuys: facts.orders.filter((order) => order.groupBuy).length,
      following: following.length,
      disputesWon: tally.won,
      disputesLost: tally.lost,
      disputesSettled: tally.even,
      disputesOpen: tally.open,
      memberSince: user.createdAt,
    },
  });
}

export const questMeRoute = handler(me);
export const questCheckInRoute = handler(checkIn);
export const questClaimRoute = handler(claim);
export const questRevealRoute = handler(reveal);
export const questOpenRoute = handler(openPack);
export const questLeaderboardRoute = handler(leaderboard);
export const collectorRoute = handler(collector);

const anon = { authLevel: 'anonymous' } as const;
app.http('quest-me', { ...anon, methods: ['GET'], route: 'quest/me', handler: questMeRoute });
app.http('quest-checkin', { ...anon, methods: ['POST'], route: 'quest/checkin', handler: questCheckInRoute });
app.http('quest-claim', { ...anon, methods: ['POST'], route: 'quest/claim', handler: questClaimRoute });
app.http('quest-reveal', { ...anon, methods: ['POST'], route: 'quest/reveal', handler: questRevealRoute });
app.http('quest-open', { ...anon, methods: ['POST'], route: 'quest/open', handler: questOpenRoute });
app.http('quest-leaderboard', { ...anon, methods: ['GET'], route: 'quest/leaderboard', handler: questLeaderboardRoute });
app.http('user-collector', { ...anon, methods: ['GET'], route: 'users/{id}/collector', handler: collectorRoute });
