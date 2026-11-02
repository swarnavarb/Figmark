import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { isPersonFollow, reviewSide } from '../../../shared/storefront.js';
import type { Dispute, QuestState, User } from '../../../shared/models.js';
import { isCancelledLike, isPlaced, reviewRevealed, scoreFrom } from '../../../shared/orders.js';
import {
  DETAILED_REVIEW_CHARS, EARLY_BACK_HOURS, claimKey, dayKey, emptyQuestState, questView, tidyQuestState,
  type QuestFacts, type QuestView,
} from '../../../shared/quest.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { invitedSellerCount } from '../share.js';
import { error, handler, json } from './http.js';

/**
 * The collector game: XP, levels, tasks, honours and the public collector page.
 *
 * The rules live in `shared/quest.ts`. What this file adds is the reading -
 * gathering everything a person has done into the facts those rules count -
 * and the three writes the game owns: checking in, collecting a task's reward
 * and revealing the daily drop. Each write is idempotent by construction (a
 * day is checked into once, a claim key is set once, a day is revealed once),
 * so a double tap or a retry can never pay twice.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Everything the rules count, read from the rows rather than from a tally. */
export async function factsFor(repository: Repo, user: User): Promise<QuestFacts> {
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
  const openedAt = new Map(listings.filter((listing) => listing).map((listing) => [listing!.id, Date.parse(listing!.createdAt)]));

  // Reviews this person wrote live under whoever they wrote about, so they are
  // found through the person's own orders - one small partition read each.
  const written = (
    await Promise.all(orders.map((order) => repository.listReviewsForOrder(order.id)))
  ).flat().filter((review) => review.authorId === user.id);

  return {
    orders: orders.map((order) => {
      const at = order.placedAt ?? order.createdAt;
      const opened = openedAt.get(order.listingId);
      return {
        createdAt: at,
        status: order.status,
        totalMinor: order.unitPriceMinor * order.quantity,
        preOrder: preOrder.has(order.listingId),
        sellerId: order.sellerId,
        early: preOrder.has(order.listingId) && opened !== undefined
          && Date.parse(at) - opened <= EARLY_BACK_HOURS * 3_600_000,
      };
    }),
    reviewsWritten: written.map((review) => ({
      createdAt: review.createdAt, detailed: review.body.trim().length >= DETAILED_REVIEW_CHARS,
    })),
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
    penaltyXp: user.standing?.xpPenalty ?? 0,
    collection: (user.collection ?? []).map((item) => ({ addedAt: item.addedAt })),
    hasBio: Boolean(user.bio?.trim()),
    shares: Object.keys(user.affiliateLinks ?? {}).length,
    referredSales: (user.affiliateOrderIds ?? []).length,
    hasTags: (user.tags ?? []).length > 0,
    shareOpens: (user.shareOpens ?? []).map((open) => ({ createdAt: open.at })),
    sharesSent: (user.shareLog ?? []).map((sent) => ({ createdAt: sent.at, kind: sent.kind })),
    invites: (user.invitees ?? []).map((invite) => ({ createdAt: invite.at })),
    invitedSellers,
    wins: {
      contest: (user.badges ?? []).filter((badge) => badge.kind === 'contest_winner' || badge.kind === 'challenge_winner').length,
      debate: (user.badges ?? []).filter((badge) => badge.kind === 'debate_winner').length,
      guess: (user.badges ?? []).filter((badge) => badge.kind === 'guess_winner').length,
    },
    helpfulAnswers: user.helpfulAnswers ?? 0,
    joinedAt: user.createdAt,
    podiums: (user.podiums ?? []).length,
    hasPhoto: Boolean(user.photoUrl),
    tagCount: (user.tags ?? []).length,
    pushOn: (user.pushEndpoints ?? []).length > 0,
    phoneVerified: user.verification?.phone === 'verified',
    emailVerified: user.verification?.email === 'verified',
    boards: (user.boards ?? []).length,
  };
}

/**
 * Works the view out and remembers the XP it came to.
 *
 * The cache is only there so a name can wear its level elsewhere without
 * recounting every account's orders; it is rewritten whenever it has moved,
 * and never read as the truth about anybody's own XP.
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

/** Somebody's level as of now, the cache brought up to date on the way. */
export async function levelOf(repository: Repo, user: User): Promise<number> {
  return (await viewFor(repository, user)).level;
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

/** GET /api/quest/me - your level, XP, streak, tasks and honours. */
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
 * Once a day, India time: the day is recorded, which is what pays the reveal's
 * XP, so asking again is not an error and pays nothing.
 */
async function reveal(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const state = user.quest ?? emptyQuestState();
  const today = dayKey(Date.now());
  const before = await viewFor(repository, user, state);
  if ((state.reveals ?? []).includes(today)) {
    return json(200, { view: before, gained: 0, levelBefore: before.level, levelAfter: before.level, already: true });
  }
  return commit(repository, user, before, { ...state, reveals: [...(state.reveals ?? []), today] });
}

/** How one dispute ended for one of its two people. */
function outcomeFor(dispute: Dispute, userId: string): 'won' | 'lost' | 'even' | 'open' | 'none' {
  if (dispute.status !== 'resolved' && dispute.status !== 'withdrawn') return 'open';
  // A community manager's final result, or a settlement between the two: the
  // record says who won. A withdrawal counts for nobody.
  if (dispute.result) {
    if (dispute.result.how === 'settled') return 'even';
    if (dispute.result.how === 'withdrawn') return 'none';
    return dispute.result.winnerId === userId ? 'won' : 'lost';
  }
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
 * Public: level and honours are things people show off, and the trade record
 * next to them is the same record the credit sheet already publishes.
 * Nothing private crosses - no tasks, no saves, no amounts spent.
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
  const tally = { won: 0, lost: 0, even: 0, open: 0, none: 0 };
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
    podiums: user.podiums ?? [],
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
export const collectorRoute = handler(collector);

const anon = { authLevel: 'anonymous' } as const;
app.http('quest-me', { ...anon, methods: ['GET'], route: 'quest/me', handler: questMeRoute });
app.http('quest-checkin', { ...anon, methods: ['POST'], route: 'quest/checkin', handler: questCheckInRoute });
app.http('quest-claim', { ...anon, methods: ['POST'], route: 'quest/claim', handler: questClaimRoute });
app.http('quest-reveal', { ...anon, methods: ['POST'], route: 'quest/reveal', handler: questRevealRoute });
app.http('user-collector', { ...anon, methods: ['GET'], route: 'users/{id}/collector', handler: collectorRoute });
