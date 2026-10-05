import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { isPersonFollow, reviewSide } from '../../../shared/storefront.js';
import type { Dispute, QuestState, User } from '../../../shared/models.js';
import { isCancelledLike, isPlaced, reviewRevealed, scoreFrom } from '../../../shared/orders.js';
import {
  CARD_XP, claimKey, dayKey, drawCard, emptyQuestState, packFor, questView, tidyQuestState,
  type QuestFacts, type QuestView,
} from '../../../shared/quest.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { invitedSellerCount } from '../share.js';
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
  const [allOrders, likes, follows, posts, wants, pledged, reviewsAbout, pageReviews, invitedSellers] = await Promise.all([
    repository.listOrdersForBuyer(user.id),
    repository.listLikesBy(user.id),
    repository.listFollowsBy(user.id),
    repository.listPostsByAuthor(user.id),
    repository.listWantsBy(user.id),
    repository.listPledgedListingIds(user.id),
    repository.listReviewsAbout(user.id),
    repository.listStoreReviews(user.id),
    invitedSellerCount(repository, user),
  ]);

  // Pressing Buy is not an order, and an order called off is not one either.
  const orders = allOrders.filter((order) => isPlaced(order) && !isCancelledLike(order.status));

  // A pre-order is a fact about the item, so it is read off the listing.
  const listingIds = [...new Set(orders.map((order) => order.listingId))];
  const listings = await Promise.all(listingIds.map((id) => repository.getListing(id)));
  const preOrder = new Set(listings.filter((listing) => listing?.preOrder).map((listing) => listing!.id));

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
      preOrder: preOrder.has(order.listingId),
    })),
    reviewsWritten: written.map((review) => ({ createdAt: review.createdAt })),
    ratingsReceived: reviewsAbout
      .filter((review) => review.direction === 'seller_to_buyer' && reviewRevealed(review, false))
      .map((review) => review.rating),
    // The person's page only: what people said about their shop is the shop's.
    pageRatings: pageReviews
      .filter((review) => reviewSide(review, Boolean(user.sellerProfile)) === 'person')
      .map((review) => review.rating),
    likes: likes.map((like) => ({ createdAt: like.createdAt })),
    follows: follows.filter((follow) => !isPersonFollow(follow.sellerId)).map((follow) => ({ createdAt: follow.createdAt })),
    posts: posts.map((post) => ({ createdAt: post.createdAt })),
    wants: wants.map((want) => ({ createdAt: want.createdAt })),
    pledges: pledged.length,
    disputesLost: user.buyerTrust?.disputesLost ?? 0,
    collection: (user.collection ?? []).map((item) => ({ addedAt: item.addedAt })),
    hasBio: Boolean(user.bio?.trim()),
    shares: Object.keys(user.affiliateLinks ?? {}).length,
    referredSales: (user.affiliateOrderIds ?? []).length,
    hasTags: (user.tags ?? []).length > 0,
    shareOpens: (user.shareOpens ?? []).map((open) => ({ createdAt: open.at })),
    sharesSent: (user.shareLog ?? []).map((sent) => ({ createdAt: sent.at })),
    invites: (user.invitees ?? []).map((invite) => ({ createdAt: invite.at })),
    invitedSellers,
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
  if (!key) return error(404, 'not_found', 'No such task.');

  const state = user.quest ?? emptyQuestState();
  const before = await viewFor(repository, user, state);
  const task = before.tasks.find((entry) => entry.id === taskId);
  if (!task) return error(409, 'not_active', 'That task is not on your list right now.');
  if (!task.done) return error(409, 'not_done', 'Finish the task first.');
  if (task.claimed) return error(409, 'already_claimed', 'You already collected this one.');

  return commit(repository, user, before, {
    ...state,
    claimed: { ...state.claimed, [key]: new Date().toISOString() },
    bumps: (state.bumps ?? 0) + task.bumps,
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

/** An average out of 100, a count, and how many of each star - five first. */
function ratingSummary(ratings: readonly number[]) {
  return {
    average: scoreFrom(ratings),
    count: ratings.length,
    stars: [5, 4, 3, 2, 1].map((value) => ratings.filter((rating) => rating === value).length),
  };
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
  // Whoever opens the page refreshes the level their name wears elsewhere.
  const state = user.quest ?? emptyQuestState();
  if (state.xpCache !== view.xp || state.levelCache !== view.level) {
    user.quest = tidyQuestState({ ...state, xpCache: view.xp, levelCache: view.level, computedAt: new Date().toISOString() });
    await repository.updateUser(user);
  }

  const visible = reviews.filter((review) => reviewRevealed(review, false));
  const asBuyer = visible.filter((review) => review.direction === 'seller_to_buyer').map((review) => review.rating);
  const asSeller = visible.filter((review) => review.direction === 'buyer_to_seller').map((review) => review.rating);
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
    // One of each card, rarest first, with how many copies: a shelf rather
    // than every duplicate.
    cards: view.cards
      .filter((card, index, all) => all.findIndex((other) => other.id === card.id) === index)
      .map((card) => ({ ...card, copies: view.cards.filter((other) => other.id === card.id).length })),
    cardCount: view.cards.length,
    sets: view.sets,
    penalty: view.penalty,
    // Three kinds of rating, never added together: from sellers (as a buyer),
    // from buyers (as a seller), and notes anybody left on the page.
    ratings: {
      buyer: ratingSummary(asBuyer),
      seller: ratingSummary(asSeller),
      page: ratingSummary(facts.pageRatings),
    },
    stats: {
      rating: scoreFrom(asBuyer),
      ratingCount: asBuyer.length,
      orders: facts.orders.length,
      completed: facts.orders.filter((order) => order.status === 'delivered').length,
      reviewsWritten: facts.reviewsWritten.length,
      preOrders: facts.orders.filter((order) => order.preOrder).length,
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
