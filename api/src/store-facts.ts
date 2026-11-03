import type { Listing, Order, Post, Review, User } from '../../shared/models.js';
import { isCancelledLike, isPlaced, reviewRevealed } from '../../shared/orders.js';
import type { GrowthFacts } from '../../shared/store-growth.js';
import { mergedRating, reviewSide, storeStickers, type MergedRating, type StoreFacts } from '../../shared/storefront.js';
import { accessFor } from '../../shared/stores.js';
import { offersAffiliate } from './affiliate.js';
import type { getRepository } from './data/index.js';
import { moderation } from './moderation.js';

/**
 * What a shop's level, stickers and quests are read from, worked out one way
 * for the public page and for the shop's own quest board so the two agree.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

export interface ShopRecord {
  user: User;
  /** Every item the shop has put up, hidden ones included. */
  all: Listing[];
  sales: Order[];
  posts: Post[];
  rating: MergedRating;
  /** Revealed reviews buyers left after an order. */
  buyerReviews: Review[];
  now?: number;
}

/** Items anybody may see on the shop's page: live or sold out, not private. */
export function shelfOf(all: readonly Listing[]): Listing[] {
  return all.filter((listing) => (listing.status === 'active' || listing.status === 'sold_out') && !listing.unlisted && !listing.feeHold && !listing.privateFor);
}

const isLive = (listing: Listing, now: number) =>
  listing.status === 'active' && listing.quantityAvailable !== 0 && !(listing.expiresAt && Date.parse(listing.expiresAt) <= now);

const counts = (order: Order) => isPlaced(order) && !isCancelledLike(order.status);

export function storeFactsFrom({ user, all, sales, posts, rating, buyerReviews, now = Date.now() }: ShopRecord): StoreFacts {
  const shelf = shelfOf(all);
  const ordersPerBuyer = new Map<string, number>();
  for (const order of sales) {
    if (counts(order)) ordersPerBuyer.set(order.buyerId, (ordersPerBuyer.get(order.buyerId) ?? 0) + 1);
  }
  const facts: StoreFacts = {
    completedSales: user.sellerTrust.completedTransactions,
    affiliateSales: sales.filter((order) => order.affiliate && counts(order)).length,
    affiliateItems: shelf.filter((listing) => isLive(listing, now) && offersAffiliate(listing)).length,
    posts: posts.length,
    followers: user.sellerProfile?.followerCount ?? 0,
    likes: shelf.reduce((sum, listing) => sum + listing.likeCount, 0),
    ratingAverage: rating.average,
    ratingCount: rating.count,
    stars: rating.stars,
    tradeGoodReviews: buyerReviews.filter((review) => review.rating >= 4).length,
    listings: shelf.length,
    soldOut: shelf.filter((listing) => listing.status === 'sold_out' || listing.quantityAvailable === 0).length,
    trust: user.sellerTrust.score,
    preOrders: all.filter((listing) => listing.preOrder).length,
    disputesLost: user.sellerTrust.disputesLost,
    penaltyXp: user.standing?.xpPenalty ?? 0,
    // Delivered within the days the listing promised, worked out from the orders (api/src/seller-stats.ts).
    dispatchOnTime: user.sellerTrust.onTimeDelivered ?? 0,
    ageDays: Math.floor((now - Date.parse(user.createdAt)) / 86_400_000),
    fiveStarReviews: buyerReviews.filter((review) => review.rating === 5).length,
    gamesRun: posts.filter((post) => post.contest || post.guess).length,
    repeatBuyers: [...ordersPerBuyer.values()].filter((count) => count >= 2).length,
    buyers: ordersPerBuyer.size,
  };
  facts.stickerSteps = storeStickers(facts).reduce((sum, sticker) => sum + sticker.reached, 0);
  return facts;
}

/** The shop's ratings: the after-trade ones from buyers, and the ones left on its page. */
export async function shopRatings(repository: Repo, owner: User) {
  const [tradeReviews, pageReviews, moderated] = await Promise.all([
    repository.listReviewsAbout(owner.id),
    repository.listStoreReviews(owner.id),
    moderation(repository),
  ]);
  const buyerReviews = tradeReviews.filter((review) => review.direction === 'buyer_to_seller' && reviewRevealed(review, false));
  const merged = mergedRating(
    buyerReviews.map((review) => review.rating),
    pageReviews
      .filter((review) => !moderated.isRemoved('store_review', review.id))
      .filter((review) => reviewSide(review, Boolean(owner.sellerProfile)) === 'store')
      .map((review) => review.rating),
  );
  // Points a community manager's final decision took off the shop's rating.
  const penalty = owner.standing?.ratingPenalty ?? 0;
  const rating = penalty > 0 && merged.average !== null
    ? { ...merged, average: Math.max(0, merged.average - penalty) }
    : merged;
  return { buyerReviews, rating };
}

/** Orders placed by a buyer who had already ordered from the shop, oldest first. */
function repeatSalesOf(placed: readonly Order[]): { at: string }[] {
  const seen = new Set<string>();
  const repeat: { at: string }[] = [];
  const stamped = placed.map((order) => ({ order, at: order.placedAt ?? order.createdAt }))
    .sort((a, b) => a.at.localeCompare(b.at));
  for (const { order, at } of stamped) {
    if (seen.has(order.buyerId)) repeat.push({ at });
    seen.add(order.buyerId);
  }
  return repeat;
}

/** Everything the shop's quest board counts, with when each thing happened. */
export async function shopQuestFacts(repository: Repo, owner: User): Promise<{ facts: GrowthFacts; totals: StoreFacts }> {
  const [all, sales, posts, ratings, follows] = await Promise.all([
    repository.listListings({ sellerId: owner.id, limit: 200, includeHidden: true }),
    repository.listOrdersForSeller(owner.id),
    repository.listPosts(owner.id, 200),
    shopRatings(repository, owner),
    repository.listFollowsOf(owner.id),
  ]);
  const now = Date.now();
  // Hearts from the people running the shop are not popularity.
  const likes = (await repository.listLikesForListings(shelfOf(all).map((listing) => listing.id)))
    .filter((like) => !accessFor(owner, like.userId));
  const totals = storeFactsFrom({ user: owner, all, sales, posts, ...ratings, now });
  const live = all.filter((listing) => isLive(listing, now));
  const fills = live
    .filter((listing) => listing.preOrder && listing.preOrder.fillThreshold > 0)
    .map((listing) => (listing.preOrder!.filledCount + (listing.preOrder!.pledgedCount ?? 0)) / listing.preOrder!.fillThreshold);
  const growth = owner.sellerProfile?.growth;
  const placed = sales.filter(counts);
  return {
    totals,
    facts: {
      shares: (growth?.shares ?? []).map((entry) => ({ at: entry.at })),
      opens: (growth?.opens ?? []).map((entry) => ({ at: entry.at })),
      posts: posts.map((post) => ({ at: post.createdAt })),
      affiliateSales: placed.filter((order) => order.affiliate).map((order) => ({ at: order.placedAt ?? order.createdAt })),
      sales: placed.map((order) => ({ at: order.placedAt ?? order.createdAt })),
      delivered: sales.filter((order) => order.status === 'delivered')
        .map((order) => ({ at: order.completedAt ?? order.updatedAt })),
      goodReviews: ratings.buyerReviews.filter((review) => review.rating >= 4).map((review) => ({ at: review.createdAt })),
      hearts: likes.map((like) => ({ at: like.createdAt })),
      // The shop's own people following it is not popularity either.
      follows: follows.filter((follow) => !accessFor(owner, follow.followerId)).map((follow) => ({ at: follow.createdAt })),
      listed: all.filter((listing) => listing.status !== 'draft').map((listing) => ({ at: listing.createdAt })),
      preOrdersRun: all.filter((listing) => listing.preOrder).map((listing) => ({ at: listing.createdAt })),
      affiliateItems: totals.affiliateItems,
      bestFill: Math.min(1, Math.max(0, ...fills)),
      totals,
      games: posts.filter((post) => post.contest || post.guess).map((post) => ({ at: post.createdAt })),
      bumps: (growth?.spotlightLog ?? []).map((entry) => ({ at: entry.at })),
      timedDrops: all.filter((listing) => listing.status !== 'draft' && listing.expiresAt).map((listing) => ({ at: listing.createdAt })),
      repeatSales: repeatSalesOf(placed),
      setup: {
        logo: Boolean(owner.sellerProfile?.photoUrl),
        cover: Boolean(owner.sellerProfile?.coverUrl),
        bio: Boolean(owner.sellerProfile?.bio?.trim()),
        payment: Boolean(owner.sellerProfile?.payment),
      },
    },
  };
}
