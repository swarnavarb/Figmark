import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Order, Review, StoreReview, User } from '../../../shared/models.js';
import { reviewRevealed, scoreFrom } from '../../../shared/orders.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * A page about somebody, and what other people have said about them.
 *
 * The trust numbers on it are two different claims and are kept apart
 * everywhere: how somebody behaves as a seller and how they behave as a buyer
 * genuinely diverge, and a long-standing reliable buyer can be brand new at
 * selling. Collapsing them into one figure would lend a first listing credit it
 * has not earned.
 *
 * There is a third kind here and it is fenced off hardest of all. A review of a
 * completed order is earned - money moved, and both sides wrote blind so
 * neither could answer the other. A review of somebody's page is an opinion
 * anybody may leave. Both are worth showing; averaging them together would let
 * a shop be talked up or shouted down by people who never bought anything, and
 * the earned number is only worth reading because nothing unearned can move it.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Reviews of trades, counted per side. */
function summarise(reviews: readonly Review[], direction: string) {
  const ratings = reviews.filter((entry) => entry.direction === direction).map((entry) => entry.rating);
  return { average: scoreFrom(ratings), count: ratings.length };
}

/**
 * How an account reads to somebody deciding whether to deal with it.
 *
 * Counted from the rows rather than stored, because a stored total is a total
 * that can drift from what it claims to count.
 */
function creditFrom(orders: { asSeller: Order[]; asBuyer: Order[] }, reviews: readonly Review[], disputesLost: number) {
  const done = (list: Order[]) => list.filter((order) => order.status === 'delivered').length;
  const praised = (direction: string) =>
    reviews.filter((entry) => entry.direction === direction && entry.rating >= 4).length;
  const rated = (direction: string) => reviews.filter((entry) => entry.direction === direction).length;

  const rate = (good: number, total: number) => (total === 0 ? null : Math.round((good / total) * 100));

  return {
    asSeller: {
      sold: orders.asSeller.length,
      completed: done(orders.asSeller),
      praised: praised('buyer_to_seller'),
      rated: rated('buyer_to_seller'),
      goodRate: rate(praised('buyer_to_seller'), rated('buyer_to_seller')),
      disputes: disputesLost,
    },
    asBuyer: {
      bought: orders.asBuyer.length,
      completed: done(orders.asBuyer),
      praised: praised('seller_to_buyer'),
      rated: rated('seller_to_buyer'),
      goodRate: rate(praised('seller_to_buyer'), rated('seller_to_buyer')),
      disputes: 0,
    },
  };
}

/**
 * GET /api/users/{id}/credit - the whole record behind the two words on the page.
 *
 * "Excellent" on a card means nothing without what is behind it, so tapping it
 * opens this: how much they have sold and bought, how much of it was praised,
 * how many arguments they lost, how long they have been here, and what has
 * actually been verified about them. Nothing here is a grade we invented - each
 * number names the rows it counted.
 */
async function credit(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  const user = await repository.getUserById(id);
  if (!user) return error(404, 'not_found', 'No such account.');

  const [asSeller, asBuyer, reviews, storeReviews] = await Promise.all([
    repository.listOrdersForSeller(id),
    repository.listOrdersForBuyer(id),
    repository.listReviewsAbout(id),
    repository.listStoreReviews(id),
  ]);

  const visible = reviews.filter((entry) => reviewRevealed(entry, false));
  const record = creditFrom({ asSeller, asBuyer }, visible, user.sellerTrust.disputesLost);

  const opinions = storeReviews.map((entry) => entry.rating);

  return json(200, {
    memberSince: user.createdAt,
    ...record,
    seller: summarise(visible, 'buyer_to_seller'),
    buyer: summarise(visible, 'seller_to_buyer'),
    /** Opinions on the page, kept apart from everything above it. */
    page: { average: scoreFrom(opinions), count: opinions.length },
    verification: {
      phone: user.verification.phone,
      email: user.verification.email,
      governmentId: user.verification.governmentId,
      paymentMethod: user.verification.paymentMethod,
    },
    tier: user.sellerProfile?.tier ?? null,
  });
}

/**
 * GET /api/users/{id}/page-reviews - what people said about the page itself.
 *
 * Separate endpoint from the transaction reviews so that no caller can
 * accidentally read one list and think it is the other.
 */
async function pageReviews(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  const reviews = await repository.listStoreReviews(id);
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request);

  return json(200, {
    reviews: reviews.map((entry) => ({
      id: entry.id,
      rating: entry.rating,
      body: entry.body,
      authorName: entry.authorName,
      authorHandle: entry.authorHandle,
      createdAt: entry.createdAt,
      mine: viewer?.id === entry.authorId,
    })),
    average: scoreFrom(reviews.map((entry) => entry.rating)),
    count: reviews.length,
    /** Whether this viewer has already written one, so the form knows its job. */
    yours: viewer ? (reviews.find((entry) => entry.authorId === viewer.id)?.rating ?? null) : null,
  });
}

/**
 * POST /api/users/{id}/page-reviews - leave one, or replace your own.
 *
 * One per person, replaced rather than appended: a page where somebody can
 * write ten is a page that says nothing about them and everything about who had
 * the most time. Nobody reviews themselves, for the obvious reason.
 */
async function writePageReview(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');
  if (id === user.id) return error(400, 'self_review', 'You cannot review your own page.');

  const subject = await repository.getUserById(id);
  if (!subject) return error(404, 'not_found', 'No such account.');

  let body: { rating?: number; body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return error(400, 'invalid_rating', 'A rating is one to five stars.');
  }
  const text = (body.body ?? '').trim();
  if (text.length < 4) {
    return error(400, 'invalid_body', 'Say something about them, not just a number.');
  }

  const author = await repository.getUserById(user.id);
  const existing = (await repository.listStoreReviews(id)).find((entry) => entry.authorId === user.id);
  const now = new Date().toISOString();

  const review: StoreReview = {
    id: existing?.id ?? `srv_${randomUUID().slice(0, 12)}`,
    subjectId: id,
    authorId: user.id,
    authorName: author?.displayName ?? user.displayName,
    authorHandle: author?.username ?? null,
    rating,
    body: text.slice(0, 600),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  return json(existing ? 200 : 201, { review: await repository.saveStoreReview(review) });
}

/**
 * GET /api/users/{id}/reviews - reviews earned by trades, with what they were about.
 *
 * A review with no item attached is an assertion; with the thing it was written
 * about next to it, it is evidence. So each one carries the order it came from
 * and what was bought, and the reader can tell a five-star on a ₹200 keyring
 * from one on a ₹40,000 consignment.
 */
async function tradeReviews(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  const all = await repository.listReviewsAbout(id);
  const visible = all.filter((entry) => reviewRevealed(entry, false));

  const [authors, orders] = await Promise.all([
    repository.listUsersByIds([...new Set(visible.map((entry) => entry.authorId))]),
    Promise.all(visible.map((entry) => repository.getOrder(entry.orderId))),
  ]);
  const nameOf = new Map(authors.map((author: User) => [author.id, author.displayName]));
  const orderOf = new Map(
    orders.filter((order): order is Order => Boolean(order)).map((order) => [order.id, order]),
  );

  return json(200, {
    reviews: visible.map((entry) => {
      const order = orderOf.get(entry.orderId);
      return {
        id: entry.id,
        rating: entry.rating,
        body: entry.body,
        direction: entry.direction,
        authorName: nameOf.get(entry.authorId) ?? 'Someone',
        createdAt: entry.createdAt,
        // What it was about. Null only where the order has since been deleted.
        item: order
          ? {
              orderId: order.id,
              listingId: order.listingId,
              name: order.itemName,
              totalMinor: order.unitPriceMinor * order.quantity,
              currency: order.currency,
            }
          : null,
      };
    }),
    asSeller: summarise(visible, 'buyer_to_seller'),
    asBuyer: summarise(visible, 'seller_to_buyer'),
    count: visible.length,
    // Written but not yet visible, so a thin page reads as young rather than as
    // nobody having bothered.
    pending: all.length - visible.length,
  });
}

/**
 * POST /api/me/profile - a person's own page, as distinct from their shop's.
 *
 * A buyer is somebody a seller decides whether to deal with, so they get the
 * same page a shop gets and the same control over it. Kept off the storefront
 * save deliberately: an account can be both, and the two pages are two
 * different faces - editing one must never quietly rewrite the other.
 */
async function saveProfile(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const record = await repository.getUserById(user.id);
  if (!record) return error(404, 'not_found', 'This account no longer exists.');

  let body: { bio?: string; coverUrl?: string; tags?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  if (body.bio !== undefined) record.bio = body.bio.trim().slice(0, 600);
  if (body.coverUrl !== undefined) {
    const cover = body.coverUrl.trim();
    if (cover && !/^https?:\/\//i.test(cover)) {
      return error(400, 'invalid_profile', 'The banner link is not a valid http(s) URL.');
    }
    record.coverUrl = cover || null;
  }
  if (body.tags !== undefined) {
    record.tags = [...new Set(body.tags.map((tag) => tag.trim()).filter(Boolean))]
      .map((tag) => tag.slice(0, 24))
      .slice(0, 6);
  }

  record.updatedAt = new Date().toISOString();
  const saved = await repository.updateUser(record);
  return json(200, {
    profile: { bio: saved.bio ?? '', coverUrl: saved.coverUrl ?? null, tags: saved.tags ?? [] },
  });
}

export const creditRoute = handler(credit);
export const saveProfileRoute = handler(saveProfile);
export const pageReviewsRoute = handler(pageReviews);
export const writePageReviewRoute = handler(writePageReview);
export const tradeReviewsRoute = handler(tradeReviews);

const anon = { authLevel: 'anonymous' } as const;

app.http('user-credit', { ...anon, methods: ['GET'], route: 'users/{id}/credit', handler: creditRoute });
app.http('page-reviews', { ...anon, methods: ['GET'], route: 'users/{id}/page-reviews', handler: pageReviewsRoute });
app.http('page-review-write', { ...anon, methods: ['POST'], route: 'users/{id}/page-reviews/new', handler: writePageReviewRoute });
app.http('user-reviews', { ...anon, methods: ['GET'], route: 'users/{id}/reviews', handler: tradeReviewsRoute });
app.http('me-profile-save', { ...anon, methods: ['POST'], route: 'me/profile', handler: saveProfileRoute });
