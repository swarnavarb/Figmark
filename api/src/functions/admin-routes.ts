import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { DISPUTE_OUTCOMES, type DisputeOutcome } from '../../../shared/enums.js';
import type { EscrowRights, User } from '../../../shared/models.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { settleDispute } from './dispute-routes.js';
import { error, handler, json } from './http.js';

/**
 * Operating the marketplace.
 *
 * Everything here is destructive or financial: deleting accounts, deleting what
 * people made, handing out the right to hold other people's money, and settling
 * disputes over it. So three rules run through the whole module.
 *
 * Only a configured operator gets in. `isAdmin` is read from ADMIN_EMAILS at
 * request time rather than from a row, so the right cannot be acquired by
 * signing up, by a bug in a write path, or by restoring a database from
 * somewhere else.
 *
 * Nothing is deleted while money is in play. An account with a held payment or
 * an open dispute is refused with the reason, because deleting one end of a
 * live transaction leaves the other end holding nothing and no way to say so.
 *
 * Suspending is the reversible answer and deletion is not, so both exist. Most
 * of what an operator wants is the first one.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Everyone who runs the marketplace passes through here, and nobody else. */
async function operator(request: HttpRequest) {
  const auth = await getAuthService();
  return auth.requireCapability(request, ['admin']);
}

/** A one-line summary of an account, as the operator list reads it. */
function row(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username ?? null,
    email: user.email,
    phone: user.phone,
    suspended: user.suspended,
    createdAt: user.createdAt,
    store: user.sellerProfile
      ? {
          name: user.sellerProfile.storefrontName,
          username: user.sellerProfile.username ?? null,
          tier: user.sellerProfile.tier,
          followerCount: user.sellerProfile.followerCount,
          managers: user.sellerProfile.managers?.length ?? 0,
        }
      : null,
    escrowRights: user.escrowRights ?? null,
    buyerTrust: user.buyerTrust,
    sellerTrust: user.sellerTrust,
    // Whether they can be signed into at all. A catalog fixture is not an
    // account somebody lost access to, and the list should not read as if it is.
    signInAccount: user.passwordHash !== null,
  };
}

/** GET /api/ops/users - everyone, with the store they run. */
async function users(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();

  const all = await repository.listAllUsers();
  const search = (request.query.get('q') ?? '').trim().toLowerCase();
  const matching = search
    ? all.filter((user) =>
        [user.displayName, user.email, user.phone, user.username, user.sellerProfile?.storefrontName]
          .some((field) => (field ?? '').toLowerCase().includes(search)),
      )
    : all;

  return json(200, { users: matching.map(row), total: all.length });
}

/**
 * GET /api/ops/users/{id} - everything one account has made.
 *
 * One call rather than six, because the operator opening this is deciding
 * whether to delete somebody and needs to see the whole of what would go.
 */
async function userDetail(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');
  const user = await repository.getUserById(id);
  if (!user) return error(404, 'not_found', 'No such account.');

  const [listings, lots, posts, purchases, sales, reviewsAbout] = await Promise.all([
    repository.listListings({ sellerId: id }),
    repository.listLots({ sellerId: id }),
    repository.listPostsByAuthor(id),
    repository.listOrdersForBuyer(id),
    repository.listOrdersForSeller(id),
    repository.listReviewsAbout(id),
  ]);

  return json(200, {
    user: row(user),
    listings: listings.map((listing) => ({
      id: listing.id, title: listing.title, status: listing.status,
      priceMinor: listing.priceMinor, currency: listing.currency,
      lotId: listing.lotId, createdAt: listing.createdAt,
    })),
    lots: lots.map((lot) => ({ id: lot.id, name: lot.name, stage: lot.stage, status: lot.status })),
    posts: posts.map((post) => ({
      id: post.id, channelId: post.channelId, kind: post.kind,
      body: post.body.slice(0, 200), createdAt: post.createdAt,
    })),
    orders: { purchases: purchases.length, sales: sales.length },
    reviews: reviewsAbout.map((review) => ({
      id: review.id, subjectId: review.subjectId, rating: review.rating,
      body: review.body.slice(0, 200), revealed: review.revealed, createdAt: review.createdAt,
    })),
    // What stands between this account and deletion, if anything.
    blockers: await deletionBlockers(id, repository),
  });
}

/**
 * Why this account cannot be deleted yet.
 *
 * Checked before the button is offered and again before it acts, because the
 * state can change between the two and the second check is the one that
 * matters.
 */
async function deletionBlockers(id: string, repository: Repo): Promise<string[]> {
  const [purchases, sales] = await Promise.all([
    repository.listOrdersForBuyer(id),
    repository.listOrdersForSeller(id),
  ]);

  const blockers: string[] = [];
  const live = [...purchases, ...sales].filter(
    (order) => order.escrow.state === 'held' || order.escrow.state === 'disputed',
  );
  if (live.length > 0) {
    blockers.push(
      `${live.length} order(s) still hold money. Settle or release them before deleting the account.`,
    );
  }
  return blockers;
}

/**
 * POST /api/ops/users/{id}/suspend - stop an account without erasing it.
 *
 * The answer to almost everything deletion is reached for. It is reversible,
 * it keeps the history a dispute might need, and it does not take a
 * counterparty's records down with it.
 */
async function suspend(request: HttpRequest, _context: InvocationContext) {
  const admin = await operator(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  let body: { suspended?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const user = await repository.getUserById(id);
  if (!user) return error(404, 'not_found', 'No such account.');
  if (user.id === admin.id) return error(400, 'invalid_target', 'You cannot suspend yourself.');

  user.suspended = body.suspended !== false;
  user.updatedAt = new Date().toISOString();
  return json(200, { user: row(await repository.updateUser(user)) });
}

/** POST /api/ops/users/{id}/delete - permanently, and only when nothing is owed. */
async function deleteAccount(request: HttpRequest, _context: InvocationContext) {
  const admin = await operator(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  const user = await repository.getUserById(id);
  if (!user) return error(404, 'not_found', 'No such account.');
  if (user.id === admin.id) return error(400, 'invalid_target', 'You cannot delete yourself.');

  const blockers = await deletionBlockers(id, repository);
  if (blockers.length > 0) return error(409, 'has_live_money', blockers.join(' '));

  // What they made goes with them. Orders deliberately do not: they are the
  // counterparty's record too, and erasing one side of a completed transaction
  // takes the other side's history with it.
  const [listings, lots, posts] = await Promise.all([
    repository.listListings({ sellerId: id }),
    repository.listLots({ sellerId: id }),
    repository.listPostsByAuthor(id),
  ]);
  for (const listing of listings) await repository.deleteListing(id, listing.id);
  for (const lot of lots) await repository.deleteLot(id, lot.id);
  for (const post of posts) await repository.deletePost(post.channelId, post.id);
  await repository.deleteUser(id);

  return json(200, {
    deleted: { user: id, listings: listings.length, lots: lots.length, posts: posts.length },
  });
}

/** POST /api/ops/resources/delete - remove one thing somebody made. */
async function deleteResource(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();

  let body: { kind?: string; id?: string; ownerId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const { kind, id, ownerId } = body;
  if (!id || !ownerId) return error(400, 'invalid_request', 'Name what to delete and whose it is.');

  switch (kind) {
    case 'listing':
      await repository.deleteListing(ownerId, id);
      break;
    case 'lot':
      await repository.deleteLot(ownerId, id);
      break;
    case 'post':
      await repository.deletePost(ownerId, id);
      break;
    case 'review':
      await repository.deleteReview(ownerId, id);
      break;
    default:
      return error(400, 'invalid_request', 'That is not something that can be deleted.');
  }

  return json(200, { deleted: { kind, id } });
}

/**
 * POST /api/ops/users/{id}/escrow - approve or remove an escrow.
 *
 * The commercial decision behind the whole feature: this person may hold other
 * people's money and settle what happens to it. Buyers choose from the people
 * approved here, so the grant is what puts somebody on that list, and the rate
 * is theirs — it is their fee for doing the work.
 */
async function escrowRights(request: HttpRequest, _context: InvocationContext) {
  const admin = await operator(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  let body: { enabled?: boolean; feeBasisPoints?: number; note?: string; displayName?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const user = await repository.getUserById(id);
  if (!user) return error(404, 'not_found', 'No such account.');

  if (body.enabled === false) {
    // Withdrawing it stops new protected checkouts. Orders already protected
    // keep the terms they were bought under - those are settled transactions,
    // not a setting.
    user.escrowRights = null;
  } else {
    const points = Math.round(Number(body.feeBasisPoints ?? 200));
    if (!Number.isFinite(points) || points < 0 || points > 2_000) {
      return error(400, 'invalid_rate', 'A protection fee is between 0 and 2000 basis points (0-20%).');
    }
    const rights: EscrowRights = {
      // Regranting keeps the original date: the grant is a standing decision,
      // and re-rating somebody is not the marketplace meeting them again.
      grantedAt: user.escrowRights?.grantedAt ?? new Date().toISOString(),
      grantedBy: admin.id,
      feeBasisPoints: points,
      displayName:
        (body.displayName ?? '').trim().slice(0, 80) ||
        user.escrowRights?.displayName ||
        user.sellerProfile?.storefrontName ||
        user.displayName,
      note: (body.note ?? '').trim().slice(0, 500),
    };
    user.escrowRights = rights;
  }

  user.updatedAt = new Date().toISOString();
  return json(200, { user: row(await repository.updateUser(user)) });
}

/**
 * GET /api/ops/disputes - the mediation queue.
 *
 * Escalated first, because those are the ones actually waiting on the company.
 * Everything else is here to be read, not worked.
 */
async function disputes(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();

  const all = await repository.listDisputes(request.query.get('status') ?? undefined);
  const rows = await Promise.all(
    all.map(async (dispute) => {
      const order = await repository.getOrder(dispute.orderId);
      const [buyer, seller] = await Promise.all([
        order ? repository.getUserById(order.buyerId) : null,
        order ? repository.getUserById(order.sellerId) : null,
      ]);
      return {
        dispute,
        itemName: order?.itemName ?? 'Unknown item',
        heldMinor: order?.escrow.amountMinor ?? 0,
        currency: order?.currency ?? 'INR',
        protectionFeeMinor: order?.protection?.feeMinor ?? 0,
        buyer: buyer ? { id: buyer.id, name: buyer.displayName, trust: buyer.buyerTrust } : null,
        seller: seller
          ? {
              id: seller.id,
              name: seller.sellerProfile?.storefrontName ?? seller.displayName,
              trust: seller.sellerTrust,
            }
          : null,
      };
    }),
  );

  const weight = (status: string) => (status === 'under_mediation' ? 0 : status === 'resolved' || status === 'withdrawn' ? 2 : 1);
  rows.sort((a, b) => weight(a.dispute.status) - weight(b.dispute.status));
  return json(200, { disputes: rows });
}

/**
 * POST /api/ops/disputes/{id}/resolve - the company decides.
 *
 * The last step, not the first: a dispute reaches here because the two sides
 * could not settle it themselves. The note is written into the record both of
 * them can read, because a ruling nobody can see the reasoning for is
 * indistinguishable from an arbitrary one.
 */
async function resolveDispute(request: HttpRequest, _context: InvocationContext) {
  const admin = await operator(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A dispute id is required.');

  let body: { outcome?: string; refundMinor?: number; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const dispute = await repository.getDisputeById(id);
  if (!dispute) return error(404, 'not_found', 'No such dispute.');
  if (dispute.resolvedAt) return error(409, 'already_resolved', 'That dispute is already settled.');

  const order = await repository.getOrder(dispute.orderId);
  if (!order) return error(404, 'not_found', 'That dispute has no order behind it.');

  const outcome = body.outcome as DisputeOutcome | undefined;
  if (!outcome || !DISPUTE_OUTCOMES.includes(outcome)) {
    return error(400, 'invalid_outcome', 'Say how it was decided.');
  }
  const noteText = (body.note ?? '').trim();
  if (!noteText) return error(400, 'invalid_outcome', 'Write the reasoning. Both parties read it.');

  const refundMinor = Math.round(Number(body.refundMinor ?? 0));
  if (outcome === 'split' && (!Number.isFinite(refundMinor) || refundMinor <= 0 || refundMinor >= order.escrow.amountMinor)) {
    return error(400, 'invalid_outcome', 'A split is between nothing and the full amount held.');
  }

  const settled = await settleDispute(
    dispute, order, outcome, refundMinor, noteText, admin.id, true, repository,
  );
  return json(200, settled);
}

export const adminUsersRoute = handler(users);
export const adminUserDetailRoute = handler(userDetail);
export const adminSuspendRoute = handler(suspend);
export const adminDeleteUserRoute = handler(deleteAccount);
export const adminDeleteResourceRoute = handler(deleteResource);
export const adminEscrowRoute = handler(escrowRights);
export const adminDisputesRoute = handler(disputes);
export const adminResolveRoute = handler(resolveDispute);

const anon = { authLevel: 'anonymous' } as const;

app.http('admin-users', { ...anon, methods: ['GET'], route: 'ops/users', handler: adminUsersRoute });
app.http('admin-user', { ...anon, methods: ['GET'], route: 'ops/users/{id}', handler: adminUserDetailRoute });
app.http('admin-suspend', { ...anon, methods: ['POST'], route: 'ops/users/{id}/suspend', handler: adminSuspendRoute });
app.http('admin-delete-user', { ...anon, methods: ['POST'], route: 'ops/users/{id}/delete', handler: adminDeleteUserRoute });
app.http('admin-escrow', { ...anon, methods: ['POST'], route: 'ops/users/{id}/escrow', handler: adminEscrowRoute });
app.http('admin-delete-resource', { ...anon, methods: ['POST'], route: 'ops/resources/delete', handler: adminDeleteResourceRoute });
app.http('admin-disputes', { ...anon, methods: ['GET'], route: 'ops/disputes', handler: adminDisputesRoute });
app.http('admin-resolve', { ...anon, methods: ['POST'], route: 'ops/disputes/{id}/resolve', handler: adminResolveRoute });
