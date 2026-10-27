import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Listing, Pledge } from '../../../shared/models.js';
import { gistOf } from '../../../shared/notifications.js';
import { fullRuleOf, isGoingAhead } from '../../../shared/preorder.js';
import { can } from '../../../shared/stores.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { notify } from './notify.js';
import {
  editPreOrder, holdsPlace, isWaiting, reconcilePreOrder, rosterOf, sellerDecides, verifiedReferrer,
  type PreOrderEdit, type SellerAction,
} from './preorder.js';

/**
 * Joining a group-buy without paying for it yet.
 *
 * The rest of the pre-order lives on the listing: the threshold, the cutoff,
 * the count. What is here is the half that makes it a group - who is in it,
 * who brought them, and the free first step that gets the number off zero.
 */

/** The most one person can pledge, so one account cannot fill a campaign. */
const MAX_UNITS = 10;

type Repo = Awaited<ReturnType<typeof getRepository>>;

async function campaign(
  request: HttpRequest,
  repository: Repo,
): Promise<{ listing: Listing } | { refusal: ReturnType<typeof error> }> {
  const id = request.params.id;
  if (!id) return { refusal: error(400, 'invalid_request', 'A listing id is required.') };

  const listing = await repository.getListing(id);
  if (!listing) return { refusal: error(404, 'not_found', 'No such listing.') };
  if (!listing.preOrder) {
    return { refusal: error(409, 'not_a_preorder', 'This item is not being pre-ordered.') };
  }
  return { listing };
}

/**
 * GET /api/listings/{id}/preorder - the meter and everyone behind it.
 *
 * Public, because the whole point of showing a group is that somebody outside
 * it can see how close it is. A signed-out reader sees the counts and the
 * names of whoever chose to be named, and nothing that is theirs.
 */
async function read(request: HttpRequest, _context: InvocationContext) {
  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const viewer = await auth.getCurrentUser(request);

  const found = await campaign(request, repository);
  if ('refusal' in found) return found.refusal;

  const { listing, pledges, orders } = await reconcilePreOrder(repository, found.listing);
  return json(200, await rosterOf(repository, listing, pledges, orders, viewer?.id ?? null));
}

/**
 * POST /api/listings/{id}/pledge - "I'm in, if enough others are."
 *
 * A toggle, like the +Me button on the wanted board and for the same reason: a
 * commitment you cannot withdraw is one people think twice about making, and
 * thinking twice is exactly what keeps a bar at zero.
 *
 * It costs nothing and holds nothing. What it does is put a number on demand
 * that would otherwise be invisible, and give whoever is reading the card a
 * reason to believe the thing might actually happen.
 */
async function pledge(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  // A pledge is a promise to buy, so it takes what buying takes.
  const user = await auth.requireCapability(request, ['buy']);
  const repository = await getRepository();

  const found = await campaign(request, repository);
  if ('refusal' in found) return found.refusal;
  const listing = found.listing;

  if (listing.sellerId === user.id) {
    return error(400, 'own_listing', 'You cannot pledge for your own item.');
  }

  let body: { units?: number; listed?: boolean; via?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  // Up to date before anything is decided about it: a cutoff that passed a
  // minute ago is passed, whether or not anybody has looked since.
  const current = (await reconcilePreOrder(repository, listing)).listing;
  const preOrder = current.preOrder!;
  if (preOrder.closedAt) return error(409, 'preorder_closed', 'That pre-order is over.');
  if (preOrder.decisionDueAt) {
    return error(409, 'preorder_paused', 'The seller is deciding whether this goes ahead. Check back soon.');
  }
  const full = isGoingAhead(preOrder);
  if (!full && Date.parse(preOrder.cutoffAt) <= Date.now()) {
    return error(409, 'preorder_closed', 'Booking closed for this one.');
  }

  const pledges = await repository.listPledges(listing.id);
  const holding = pledges.find((entry) => entry.userId === user.id && holdsPlace(entry));
  const queued = pledges.find((entry) => entry.userId === user.id && isWaiting(entry));

  // Once it is going ahead, the places are being paid for rather than
  // promised. What a newcomer can do is what the seller chose for this moment.
  if (full) {
    if (holding) return error(409, 'preorder_filled', 'Your place is being called in — book it to keep it.');
    const rule = fullRuleOf(preOrder);
    if (rule === 'keep_open') {
      return error(409, 'preorder_filled', 'This one filled — book it rather than pledging.');
    }
    if (rule === 'close') return error(409, 'preorder_full', 'This one is full, and the seller is not taking more.');
  }

  const existing = full ? queued : holding;
  const now = new Date().toISOString();
  let joined: Pledge | null = null;

  if (existing && body.units === undefined && body.listed === undefined) {
    // A bare second tap is leaving - the waitlist as much as the group.
    await repository.deletePledge(existing.id, listing.id);
  } else {
    const asked = body.units ?? existing?.units ?? 1;
    if (typeof asked !== 'number' || !Number.isFinite(asked)) {
      return error(400, 'invalid_units', 'Units must be a number.');
    }
    const units = Math.min(MAX_UNITS, Math.max(1, Math.round(asked)));
    const row: Pledge = {
      id: existing?.id ?? `pdg_${randomUUID().slice(0, 12)}`,
      listingId: listing.id,
      userId: user.id,
      sellerId: listing.sellerId,
      units,
      listed: body.listed ?? existing?.listed ?? false,
      // Credit is recorded once, when they first join. Re-reading a card
      // through somebody else's link later does not move it: whoever actually
      // brought them in is a fact about that moment.
      broughtBy: existing?.broughtBy ?? await verifiedReferrer(repository, body.via, user.id, listing),
      convertedOrderId: null,
      // Joining a full campaign under a waitlist is joining the queue.
      ...(full ? { waitlisted: true } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await repository.savePledge(row);
    if (!existing) joined = row;
  }

  // Whoever's link it was hears that it worked: the only reward for sharing a
  // group-buy is seeing it get closer, and they cannot see that from outside.
  if (joined?.broughtBy) {
    const brought = pledges.filter((entry) => entry.broughtBy === joined!.broughtBy && !entry.lapsedAt).length + 1;
    await notify(repository, [joined.broughtBy], {
      kind: 'preorder_brought',
      title: `${user.displayName ?? 'Someone'} joined ${gistOf(listing.title, 'the pre-order', 40)} through your link`,
      body: `That is ${brought} you have brought in${joined.waitlisted ? ', this one on the waitlist' : ''}.`,
      link: `/listing/${listing.id}`,
    });
  }

  const settled = await reconcilePreOrder(repository, current, { actorId: user.id });
  return json(200, await rosterOf(repository, settled.listing, settled.pledges, settled.orders, user.id));
}

/**
 * The campaign, for somebody allowed to run it: the seller, or a manager of
 * their store who can manage its listings.
 */
async function runnable(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const found = await campaign(request, repository);
  if ('refusal' in found) return found;
  if (found.listing.sellerId !== user.id) {
    const owner = await repository.getUserById(found.listing.sellerId);
    if (!owner || !can(owner, user.id, 'listings')) {
      return { refusal: error(403, 'forbidden', 'That item is not in a store you manage.') };
    }
  }
  return { listing: found.listing, repository, user };
}

async function bodyOf<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * POST /api/listings/{id}/preorder/edit - change the terms or the rules.
 *
 * The threshold and the cutoff until it goes ahead; what happens if it is
 * short, and what happens once it fills, at any time before it is over.
 */
async function edit(request: HttpRequest, _context: InvocationContext) {
  const found = await runnable(request);
  if ('refusal' in found) return found.refusal;
  const { listing, repository, user } = found;

  const body = await bodyOf<PreOrderEdit>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');
  const changes: PreOrderEdit = {
    ...(body.fillThreshold !== undefined ? { fillThreshold: body.fillThreshold } : {}),
    ...(body.cutoffAt !== undefined ? { cutoffAt: body.cutoffAt } : {}),
    ...(body.whenShort !== undefined ? { whenShort: body.whenShort } : {}),
    ...(body.whenFull !== undefined ? { whenFull: body.whenFull } : {}),
  };
  if (Object.keys(changes).length === 0) return error(400, 'invalid_preorder', 'Nothing to change.');

  const result = await editPreOrder(repository, listing, changes, user.id);
  if ('refusal' in result) return error(409, 'invalid_preorder', result.refusal);
  return json(200, await rosterOf(repository, result.listing, result.pledges, result.orders, user.id));
}

const DECISIONS = new Set(['proceed', 'cancel', 'extend', 'admit', 'dismiss']);

/**
 * POST /api/listings/{id}/preorder/decide - the seller's call.
 *
 * `proceed` goes ahead with whoever is in; `cancel` calls it off and refunds;
 * `extend` gives it a new cutoff. `admit` lets people in off the waitlist -
 * all of them, or `units` worth - and `dismiss` lets the waitlist go.
 */
async function decide(request: HttpRequest, _context: InvocationContext) {
  const found = await runnable(request);
  if ('refusal' in found) return found.refusal;
  const { listing, repository, user } = found;

  const body = await bodyOf<{ action?: string; cutoffAt?: string; units?: number }>(request);
  if (!body?.action || !DECISIONS.has(body.action)) {
    return error(400, 'invalid_decision', 'Say proceed, cancel, extend, admit or dismiss.');
  }
  if (body.action === 'extend' && typeof body.cutoffAt !== 'string') {
    return error(400, 'invalid_decision', 'Extending needs a new date for bookings to close.');
  }
  if (body.units !== undefined && (typeof body.units !== 'number' || !Number.isFinite(body.units) || body.units < 1)) {
    return error(400, 'invalid_units', 'Units must be a number of at least 1.');
  }

  const result = await sellerDecides(repository, listing, body as SellerAction, user.id);
  if ('refusal' in result) return error(409, 'invalid_decision', result.refusal);
  return json(200, await rosterOf(repository, result.listing, result.pledges, result.orders, user.id));
}

export const preOrderReadRoute = handler(read);
export const preOrderPledgeRoute = handler(pledge);
export const preOrderEditRoute = handler(edit);
export const preOrderDecideRoute = handler(decide);

const anon = { authLevel: 'anonymous' } as const;

app.http('preorder-read', { ...anon, methods: ['GET'], route: 'listings/{id}/preorder', handler: preOrderReadRoute });
app.http('preorder-pledge', { ...anon, methods: ['POST'], route: 'listings/{id}/pledge', handler: preOrderPledgeRoute });
app.http('preorder-edit', { ...anon, methods: ['POST'], route: 'listings/{id}/preorder/edit', handler: preOrderEditRoute });
app.http('preorder-decide', { ...anon, methods: ['POST'], route: 'listings/{id}/preorder/decide', handler: preOrderDecideRoute });
