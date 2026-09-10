import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { CONDITION_TAGS, type ConditionTag } from '../../../shared/enums.js';
import type { Want, WantOffer } from '../../../shared/models.js';
import { personRef, sellerRef } from '../../../shared/parties.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * What people are looking for, and who says they can get it.
 *
 * The other half of a marketplace, and the half that is normally silent. A
 * buyer who cannot find what they want leaves, taking with them the one fact a
 * seller most needs: that there was demand at all. On an import marketplace
 * that fact is worth more than usual, because most of what gets wanted has not
 * been bought by anybody yet - a seller reading this board is deciding what to
 * put in the next consignment.
 *
 * So the answer to a hunt is not only "here is one". It is also "I can get
 * this", which is the offer that actually matters here.
 */

/** How long a hunt stays on the board before it stops being one. */
const WANT_DAYS = 30;

/** Longest a hunt can be, so the board stays scannable. */
const MAX_TITLE = 90;
const MAX_DETAILS = 600;

function expiryFrom(now = new Date()): string {
  return new Date(now.getTime() + WANT_DAYS * 86_400_000).toISOString();
}

/** One hunt, as a card on the board reads it. */
function card(want: Want) {
  return {
    id: want.id,
    buyerId: want.buyerId,
    buyer: { name: want.buyerName, handle: want.buyerHandle },
    title: want.title,
    details: want.details,
    category: want.category,
    budgetMinor: want.budgetMinor,
    currency: want.currency,
    condition: want.condition,
    status: want.status,
    offerCount: want.offerCount,
    createdAt: want.createdAt,
    expiresAt: want.expiresAt,
    closedAt: want.closedAt,
  };
}

/**
 * GET /api/wants - the board.
 *
 * Open hunts only, newest first, optionally one category. Closed and expired
 * ones are gone from it: a board of hunts nobody is still hunting is a board
 * sellers stop opening, and this only earns its place while sellers read it.
 */
async function board(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request);
  const repository = await getRepository();

  const category = request.query.get('category')?.trim() || undefined;
  const wants = await repository.listOpenWants({ category, limit: 50 });

  const search = (request.query.get('q') ?? '').trim().toLowerCase();
  const matching = search
    ? wants.filter((want) =>
        `${want.title} ${want.details} ${want.category}`.toLowerCase().includes(search),
      )
    : wants;

  return json(200, {
    wants: matching.map(card),
    // Their own, so the board can say what they are already asking for
    // rather than making them go and look somewhere else.
    mine: viewer ? (await repository.listWantsBy(viewer.id)).map(card) : [],
  });
}

/**
 * POST /api/wants - say what you are looking for.
 *
 * A budget is optional and that is deliberate: for a rare piece "what will you
 * take" is a real answer, and forcing a number would either invent one or stop
 * the post being made.
 */
async function post(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: {
    title?: string; details?: string; category?: string;
    budgetMinor?: number | null; condition?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const title = (body.title ?? '').trim();
  if (title.length < 3) return error(400, 'invalid_want', 'Say what you are looking for.');
  if (title.length > MAX_TITLE) {
    return error(400, 'invalid_want', `Keep the title under ${MAX_TITLE} characters.`);
  }

  const category = (body.category ?? '').trim();
  if (!category) return error(400, 'invalid_want', 'Pick a category, so sellers can find it.');

  const budget = body.budgetMinor;
  if (budget !== undefined && budget !== null && (!Number.isFinite(budget) || budget <= 0)) {
    return error(400, 'invalid_want', 'A budget is a number above zero, or leave it out.');
  }

  const condition = body.condition ?? null;
  if (condition !== null && !CONDITION_TAGS.includes(condition as ConditionTag)) {
    return error(400, 'invalid_want', 'That is not a condition we recognise.');
  }

  const record = await repository.getUserById(user.id);
  const who = personRef(record ?? user);
  const now = new Date().toISOString();

  const want: Want = {
    id: `wnt_${randomUUID().slice(0, 12)}`,
    buyerId: user.id,
    buyerName: who.name,
    buyerHandle: who.handle,
    title,
    details: (body.details ?? '').trim().slice(0, MAX_DETAILS),
    category,
    budgetMinor: budget ?? null,
    currency: 'INR',
    condition: condition as ConditionTag | null,
    status: 'open',
    offerCount: 0,
    expiresAt: expiryFrom(),
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return json(201, { want: card(await repository.saveWant(want)) });
}

/** The hunt, or the refusal. Reading one needs its partition, which is its buyer. */
async function findWant(
  request: HttpRequest,
  repository: Awaited<ReturnType<typeof getRepository>>,
): Promise<{ want: Want } | { refusal: ReturnType<typeof error> }> {
  const id = request.params.id;
  if (!id) return { refusal: error(400, 'invalid_request', 'A want id is required.') };
  // The buyer is on the path for the same reason the partition key is: a hunt
  // is stored under whoever posted it.
  const buyerId = request.query.get('buyer') ?? '';
  const want = await repository.getWant(id, buyerId);
  if (!want) return { refusal: error(404, 'not_found', 'No such want.') };
  return { want };
}

/** GET /api/wants/{id} - one hunt and every answer to it. */
async function readWant(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const found = await findWant(request, repository);
  if ('refusal' in found) return found.refusal;

  const offers = await repository.listWantOffers(found.want.id);
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request);

  // The items offered, so a card can be rendered without a call per offer.
  const listings = await Promise.all(
    offers.map((offer) => (offer.listingId ? repository.getListing(offer.listingId) : null)),
  );

  return json(200, {
    want: card(found.want),
    mine: viewer?.id === found.want.buyerId,
    /** Whether this viewer has already answered, so the form knows its job. */
    yours: viewer ? (offers.find((offer) => offer.sellerId === viewer.id) ?? null) : null,
    offers: offers.map((offer, index) => {
      const listing = listings[index];
      return {
        id: offer.id,
        seller: { name: offer.sellerName, handle: offer.sellerHandle },
        message: offer.message,
        priceMinor: offer.priceMinor,
        createdAt: offer.createdAt,
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
    }),
  });
}

/**
 * POST /api/wants/{id}/offers - answer a hunt.
 *
 * With something already listed, or with nothing but a promise to look. The
 * second is the one that matters on an import marketplace: the answer to "can
 * anybody get me this" is usually not a link.
 *
 * One answer per seller, replaced rather than added to. A board where somebody
 * can reply ten times is a board that describes whoever had the most time.
 */
async function offer(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await findWant(request, repository);
  if ('refusal' in found) return found.refusal;
  const want = found.want;

  if (want.buyerId === user.id) {
    return error(400, 'own_want', 'You cannot answer your own want.');
  }
  if (want.status !== 'open' || want.expiresAt <= new Date().toISOString()) {
    return error(409, 'want_closed', 'That hunt is over.');
  }

  let body: { message?: string; listingId?: string | null; priceMinor?: number | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const message = (body.message ?? '').trim();
  if (message.length < 4) {
    return error(400, 'invalid_offer', 'Say what you have or what you can get.');
  }

  // An offered item has to be one this seller actually sells, or the board
  // becomes a place to advertise other people's stock.
  let listingId: string | null = null;
  if (body.listingId) {
    const listing = await repository.getListing(body.listingId);
    if (!listing || listing.sellerId !== user.id) {
      return error(404, 'not_found', 'No such listing of yours.');
    }
    listingId = listing.id;
  }

  const price = body.priceMinor;
  if (price !== undefined && price !== null && (!Number.isFinite(price) || price <= 0)) {
    return error(400, 'invalid_offer', 'A price is a number above zero, or leave it out.');
  }

  const record = await repository.getUserById(user.id);
  const who = sellerRef(record ?? { ...user, sellerProfile: null });
  const existing = (await repository.listWantOffers(want.id)).find(
    (entry) => entry.sellerId === user.id,
  );
  const now = new Date().toISOString();

  const answer: WantOffer = {
    id: existing?.id ?? `wof_${randomUUID().slice(0, 12)}`,
    wantId: want.id,
    sellerId: user.id,
    sellerName: who.name,
    sellerHandle: who.handle,
    listingId,
    priceMinor: price ?? null,
    message: message.slice(0, MAX_DETAILS),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const saved = await repository.saveWantOffer(answer);

  // Counted on the hunt so the board can say how much interest there is
  // without reading every answer to every row.
  if (!existing) {
    want.offerCount += 1;
    want.updatedAt = now;
    await repository.saveWant(want);
  }

  return json(existing ? 200 : 201, { offer: saved, offerCount: want.offerCount });
}

/**
 * POST /api/wants/{id}/close - the buyer is done looking.
 *
 * Theirs alone. Somebody else deciding a hunt is over is somebody else deciding
 * what you still want.
 */
async function close(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await findWant(request, repository);
  if ('refusal' in found) return found.refusal;
  const want = found.want;

  if (want.buyerId !== user.id) {
    return error(403, 'not_yours', 'Only whoever posted a want can close it.');
  }

  const now = new Date().toISOString();
  want.status = 'closed';
  want.closedAt = now;
  want.updatedAt = now;

  return json(200, { want: card(await repository.saveWant(want)) });
}

export const wantsBoardRoute = handler(board);
export const wantPostRoute = handler(post);
export const wantReadRoute = handler(readWant);
export const wantOfferRoute = handler(offer);
export const wantCloseRoute = handler(close);

const anon = { authLevel: 'anonymous' } as const;

app.http('wants-board', { ...anon, methods: ['GET'], route: 'wants', handler: wantsBoardRoute });
app.http('want-post', { ...anon, methods: ['POST'], route: 'wants/new', handler: wantPostRoute });
app.http('want-read', { ...anon, methods: ['GET'], route: 'wants/{id}', handler: wantReadRoute });
app.http('want-offer', { ...anon, methods: ['POST'], route: 'wants/{id}/offers', handler: wantOfferRoute });
app.http('want-close', { ...anon, methods: ['POST'], route: 'wants/{id}/close', handler: wantCloseRoute });
