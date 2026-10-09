import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ManagerRights, TradeRight, User } from '../../../shared/models.js';
import { deriveCapabilities } from '../../../shared/capabilities.js';
import { verifiedChecks } from '../../../shared/verification.js';
import { emailUsage } from '../verification/email-providers.js';
import { currentRound, decisionOverdue, isClosed, releaseOverdue, roundsOf, standingDecision } from '../../../shared/disputes.js';
import { isCancelledLike, isPlaced } from '../../../shared/orders.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import {
  applySanction, bringReleaseUpToDate, bringUpToDate, commit, excludedFrom, isManager, loadActions, loadLedger, mutateActions, pickManager,
  pickManagerFor, reassignRelease, reassignRound,
} from '../community.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';
import { getPhotoStore } from '../storage/index.js';
import { releaseListingPhotos, releasePostPhotos } from '../storage/release.js';
import { deleteUnused, graceFrom, scanUnused } from '../storage/unused.js';

/**
 * Operating the marketplace.
 *
 * Everything here is destructive or financial: deleting accounts, deleting what
 * people made, appointing the community managers who decide disputes, and
 * approving what their decisions ask for. So three rules run through the whole module.
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
  const capabilities = deriveCapabilities(user);
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
    managerRights: user.managerRights ?? null,
    buyerTrust: user.buyerTrust,
    sellerTrust: user.sellerTrust,
    // Whether they can be signed into at all. A catalog fixture is not an
    // account somebody lost access to, and the list should not read as if it is.
    signInAccount: user.passwordHash !== null,
    // What they have proved, what that lets them do, and any operator say over it.
    verified: verifiedChecks(user),
    aadhaar: user.verification.proofs?.aadhaar
      ? { name: user.verification.proofs.aadhaar.name, last4: user.verification.proofs.aadhaar.last4, at: user.verification.proofs.aadhaar.at }
      : null,
    canBuy: capabilities.canBuy,
    canSell: capabilities.canSell,
    tradeOverride: user.tradeOverride ?? null,
  };
}

/** GET /api/ops/email-usage - how much of each free email tier today has used. */
async function emailUsageToday(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  return json(200, { providers: await emailUsage(await getRepository()) });
}

const TRADE_RIGHTS: readonly TradeRight[] = ['auto', 'grant', 'block'];

/**
 * POST /api/ops/users/{id}/rights - { buy, sell, reason }: who may trade.
 *
 * `grant` opens buying or selling to an account that has not finished
 * verifying (somebody with no WhatsApp, an Aadhaar without a linked mobile);
 * `block` closes it to one that has; `auto` hands it back to verification.
 * Anything but auto needs a reason, and every change records who and when.
 */
async function rights(request: HttpRequest, _context: InvocationContext) {
  const admin = await operator(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  let body: { buy?: unknown; sell?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const buy = body.buy as TradeRight;
  const sell = body.sell as TradeRight;
  if (!TRADE_RIGHTS.includes(buy) || !TRADE_RIGHTS.includes(sell)) {
    return error(400, 'invalid_rights', 'Buy and sell are each auto, grant or block.');
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  if ((buy !== 'auto' || sell !== 'auto') && !reason) {
    return error(400, 'reason_required', 'Say why: it is kept with the decision.');
  }

  const user = await repository.getUserById(id);
  if (!user) return error(404, 'not_found', 'No such account.');

  user.tradeOverride = buy === 'auto' && sell === 'auto'
    ? null
    : { buy, sell, reason, by: admin.id, at: new Date().toISOString() };
  user.updatedAt = new Date().toISOString();
  return json(200, { user: row(await repository.updateUser(user)) });
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
    repository.listListings({ sellerId: id, includeHidden: true }),
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
  const [purchases, sales, asParty, asManager] = await Promise.all([
    repository.listOrdersForBuyer(id),
    repository.listOrdersForSeller(id),
    repository.listDisputesForParty(id),
    repository.listDisputesForManager(id),
  ]);

  const blockers: string[] = [];
  const live = [...purchases, ...sales].filter(
    (order) => order.hold.state === 'held' || order.hold.state === 'disputed',
  );
  if (live.length > 0) {
    blockers.push(
      `${live.length} order(s) still hold money. Settle or release them before deleting the account.`,
    );
  }
  const open = [...asParty, ...asManager.filter((dispute) => currentRound(dispute)?.managerId === id)]
    .filter((dispute) => !isClosed(dispute));
  if (open.length > 0) {
    blockers.push(`${new Set(open.map((dispute) => dispute.id)).size} dispute(s) they are in or deciding are still open.`);
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
    repository.listListings({ sellerId: id, includeHidden: true }),
    repository.listLots({ sellerId: id }),
    repository.listPostsByAuthor(id),
  ]);
  for (const listing of listings) await repository.deleteListing(id, listing.id);
  for (const lot of lots) await repository.deleteLot(id, lot.id);
  for (const post of posts) await repository.deletePost(post.channelId, post.id);
  await releasePostPhotos(posts, repository);
  await releaseListingPhotos(listings, repository);
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
    case 'listing': {
      // Something somebody bought stays: their order, tracking and collection
      // card all point at it. It can be expired instead, which takes it out of
      // the catalogue without taking it out of anybody's history.
      // The listing's own seller is the partition it lives in, so use that
      // rather than trusting the caller's ownerId: a mismatch would make the
      // delete a silent no-op.
      const listing = await repository.getListing(id);
      if (!listing) return error(404, 'not_found', 'That item no longer exists.');
      const live = (await repository.listOrdersForListing(id))
        .filter((order) => isPlaced(order) && !isCancelledLike(order.status));
      if (live.length > 0) {
        const buyers = new Set<string>();
        for (const order of live) {
          const buyer = await repository.getUserById(order.buyerId);
          buyers.add(buyer?.displayName ?? order.buyerId);
        }
        return error(
          409,
          'listing_purchased',
          `Heads up: "${listing.title}" has been bought (${live.length} order${live.length === 1 ? '' : 's'}, buyer${buyers.size === 1 ? '' : 's'}: ${[...buyers].join(', ')}). `
          + 'It was not deleted, because the buyer\'s order and tracking point at it. Expire it instead, or settle the order first.',
        );
      }
      await repository.deleteListing(listing.sellerId, id);
      if (await repository.getListing(id)) {
        return error(500, 'delete_failed', 'The item could not be deleted. Try again.');
      }
      const photosRemoved = await releaseListingPhotos([listing], repository);
      return json(200, { deleted: { kind, id }, photosRemoved });
    }
    case 'lot':
      await repository.deleteLot(ownerId, id);
      break;
    case 'post': {
      const gone = await repository.getPost(ownerId, id);
      await repository.deletePost(ownerId, id);
      if (gone) await releasePostPhotos([gone], repository);
      break;
    }
    case 'review':
      await repository.deleteReview(ownerId, id);
      break;
    default:
      return error(400, 'invalid_request', 'That is not something that can be deleted.');
  }

  return json(200, { deleted: { kind, id } });
}

/**
 * POST /api/ops/photos/scan - which stored photos does nothing use?
 *
 * Read-only. Slow on a big database because it reads every record, so it runs
 * when an operator asks and never by itself.
 */
async function scanPhotos(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const body = (await request.json().catch(() => ({}))) as { graceHours?: unknown };
  const store = await getPhotoStore();
  const scan = await scanUnused(store, await getRepository(), graceFrom(body.graceHours));
  return json(200, { ...scan, storage: store.status() });
}

/**
 * POST /api/ops/photos/cleanup - delete the photos nothing uses.
 *
 * Looks again before deleting, so it never acts on a stale list. With `only` it
 * deletes just those photos, if they are still unused.
 */
async function cleanupPhotos(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  let body: { graceHours?: unknown; only?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  let only: { scope: 'public' | 'private'; name: string }[] | undefined;
  if (body.only !== undefined) {
    if (!Array.isArray(body.only) || !body.only.every((entry) =>
      entry && (entry.scope === 'public' || entry.scope === 'private') && typeof entry.name === 'string')) {
      return error(400, 'invalid_request', 'Name photos as { scope, name }.');
    }
    only = body.only as typeof only;
  }
  const result = await deleteUnused(await getPhotoStore(), await getRepository(), graceFrom(body.graceHours), only);
  return json(200, result);
}

/**
 * POST /api/ops/users/{id}/manager - appoint or remove a community manager.
 *
 * A community manager hears disputes. They never hold money: every payment
 * bought with buyer protection is held by Figmark. Operators appoint them;
 * fees are not theirs to set - every fee is set centrally in the settings, and
 * managers are paid a share of the dispute fees.
 */
async function appointManager(request: HttpRequest, _context: InvocationContext) {
  const admin = await operator(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  let body: { enabled?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const user = await repository.getUserById(id);
  if (!user) return error(404, 'not_found', 'No such account.');

  if (body.enabled === false) {
    // Removing them stops new disputes reaching them.
    user.managerRights = null;
  } else {
    const rights: ManagerRights = {
      // Re-appointing keeps the original date: the grant is a standing decision.
      grantedAt: user.managerRights?.grantedAt ?? new Date().toISOString(),
      grantedBy: admin.id,
      available: user.managerRights?.available ?? true,
    };
    user.managerRights = rights;
  }

  user.updatedAt = new Date().toISOString();
  return json(200, { user: row(await repository.updateUser(user)) });
}

/**
 * GET /api/ops/disputes - every dispute, for oversight.
 *
 * Community managers decide disputes; Figmark does not. What an operator
 * does here is watch the clock: a manager past their deadline is flagged
 * first, to be reassigned - and if nobody does within two days, the system
 * reassigns it.
 */
async function disputes(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();

  const all = await Promise.all(
    (await repository.listDisputes(request.query.get('status') ?? undefined)).map(async (entry) => bringReleaseUpToDate(repository, await bringUpToDate(repository, entry))),
  );
  const rows = await Promise.all(
    all.map(async (dispute) => {
      const order = dispute.subjectRef ? null : await repository.getOrder(dispute.orderId);
      const [raiser, respondent, buyer, seller] = await Promise.all([
        repository.getUserById(dispute.raisedBy),
        repository.getUserById(dispute.againstUserId),
        order ? repository.getUserById(order.buyerId) : null,
        order ? repository.getUserById(order.sellerId) : null,
      ]);
      const round = currentRound(dispute);
      return {
        dispute,
        itemName: order?.itemName ?? dispute.subjectRef?.excerpt ?? 'Unknown',
        heldMinor: order?.hold.amountMinor ?? 0,
        currency: order?.currency ?? 'INR',
        protectionFeeMinor: order?.protection?.feeMinor ?? 0,
        raiser: raiser ? { id: raiser.id, name: raiser.sellerProfile?.storefrontName ?? raiser.displayName } : null,
        respondent: respondent ? { id: respondent.id, name: respondent.sellerProfile?.storefrontName ?? respondent.displayName } : null,
        buyer: buyer ? { id: buyer.id, name: buyer.displayName, trust: buyer.buyerTrust } : null,
        seller: seller
          ? {
              id: seller.id,
              name: seller.sellerProfile?.storefrontName ?? seller.displayName,
              trust: seller.sellerTrust,
            }
          : null,
        round: round ? { n: round.n, managerId: round.managerId, managerName: round.managerName, decideBy: round.decideBy, decided: Boolean(round.decision) } : null,
        rounds: roundsOf(dispute).length,
        overdue: !isClosed(dispute) ? decisionOverdue(round) : !dispute.release && releaseOverdue(dispute.releaseDuty),
        /** Agreed, and waiting on a manager to release the held payment. */
        releasePending: dispute.status === 'resolved' && !dispute.release ? dispute.releaseDuty ?? null : null,
        standing: standingDecision(dispute),
      };
    }),
  );

  const weight = (row: (typeof rows)[number]) => (row.overdue ? 0 : isClosed(row.dispute) ? 2 : 1);
  rows.sort((a, b) => weight(a) - weight(b));
  return json(200, { disputes: rows });
}

/**
 * POST /api/ops/disputes/{id}/reassign - hand the current round to another manager.
 *
 * Named, or - with no `managerId` - whoever the system would pick by
 * availability. Never a party, and never a manager who already held a round.
 * On a resolved dispute whose held payment is still waiting to be released,
 * it is the release that moves.
 */
async function reassign(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();

  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A dispute id is required.');
  const dispute = await repository.getDisputeById(id);
  if (!dispute) return error(404, 'not_found', 'No such dispute.');
  const pendingRelease = dispute.status === 'resolved' && !dispute.release && dispute.releaseDuty;
  if (pendingRelease) {
    let releaseBody: { managerId?: string };
    try {
      releaseBody = (await request.json()) as typeof releaseBody;
    } catch {
      releaseBody = {};
    }
    const parties = [dispute.raisedBy, dispute.againstUserId, pendingRelease.managerId];
    const to = releaseBody.managerId
      ? await repository.getUserById(releaseBody.managerId)
      : await pickManager(repository, parties);
    if (!to) return error(409, 'no_manager', 'No other community manager is available.');
    if (!isManager(to)) return error(400, 'invalid_manager', 'That person is not a community manager.');
    if (parties.includes(to.id)) return error(400, 'invalid_manager', 'A party, or the manager it is with now, cannot take it.');
    return json(200, { dispute: await reassignRelease(repository, dispute, to) });
  }
  if (isClosed(dispute)) return error(409, 'already_resolved', 'That dispute is closed.');
  const round = currentRound(dispute);
  if (!round || round.decision) return error(409, 'nothing_to_reassign', 'The current round has already been decided.');

  let body: { managerId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const excluded = excludedFrom(dispute);
  let manager: User | null;
  if (body.managerId) {
    manager = await repository.getUserById(body.managerId);
    if (!isManager(manager)) return error(400, 'invalid_manager', 'That person is not a community manager.');
    if (excluded.includes(manager.id)) return error(400, 'invalid_manager', 'A party, or a manager who already held a round, cannot take it.');
  } else {
    manager = await pickManagerFor(repository, dispute);
    if (!manager) return error(409, 'no_manager', 'No other community manager is available.');
  }

  await reassignRound(repository, dispute, manager, 'admin');
  return json(200, { dispute: await commit(repository, dispute) });
}

/** GET /api/ops/actions - managers' decisions waiting for an operator: alert banners and XP deductions. */
async function actions(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const all = await loadActions(await getRepository());
  return json(200, {
    actions: [...all].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt.localeCompare(a.createdAt)),
  });
}

/**
 * POST /api/ops/actions/{id}/decide - approve or reject one.
 *
 * An operator may adjust it on the way through - a shorter banner, a lighter
 * deduction - but not change what it is or who it is against.
 */
async function decideAction(request: HttpRequest, _context: InvocationContext) {
  const admin = await operator(request);
  const repository = await getRepository();
  const id = request.params.id;

  let body: { approve?: boolean; days?: number; severity?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (typeof body.approve !== 'boolean') return error(400, 'invalid_request', 'Approve it or reject it.');

  const found = (await loadActions(repository)).find((entry) => entry.id === id);
  if (!found) return error(404, 'not_found', 'No such action.');
  if (found.status !== 'pending') return error(409, 'already_decided', 'That action has already been decided.');

  const sanction = { ...found.sanction };
  if (body.days !== undefined) {
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 60) return error(400, 'invalid_request', 'Between 1 and 60 days.');
    sanction.days = days;
  }
  if (body.severity !== undefined) {
    if (body.severity !== 'light' && body.severity !== 'severe') return error(400, 'invalid_request', 'Light or severe.');
    sanction.severity = body.severity;
  }

  const now = new Date().toISOString();
  let action = found;
  // Decided against what is stored at that moment: two operators pressing at
  // once get one decision, and the sanction is carried out once.
  let raced = false;
  await mutateActions(repository, admin.id, (all) => all.map((entry) => {
    if (entry.id !== id) return entry;
    if (entry.status !== 'pending') {
      raced = true;
      return entry;
    }
    action = {
      ...entry,
      sanction,
      status: body.approve ? 'approved' : 'rejected',
      decidedAt: now,
      decidedBy: admin.displayName ?? admin.email,
      note: body.note?.trim().slice(0, 500) || null,
    };
    return action;
  }));
  if (raced) return error(409, 'already_decided', 'That action has already been decided.');

  if (body.approve) {
    const dispute = await repository.getDisputeById(action.disputeId);
    if (dispute) await applySanction(repository, dispute, sanction, action.managerName, action.managerId);
  }
  await notify(repository, [action.managerId], {
    kind: 'dispute_action',
    title: `Figmark ${body.approve ? 'approved' : 'rejected'} your ${sanction.kind === 'xp_deduction' ? 'XP deduction' : 'alert banner'}`,
    body: `Against ${action.targetName}. ${action.note ?? ''}`.trim(),
    link: `/dispute/${action.disputeId}`,
  });
  return json(200, { action });
}

/** GET /api/ops/ledger - every fee paid through the gateway, and Figmark's commission on it. */
async function ledger(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const entries = await loadLedger(await getRepository());
  const sum = (pick: (entry: (typeof entries)[number]) => number) => entries.reduce((total, entry) => total + pick(entry), 0);
  return json(200, {
    entries: [...entries].reverse().slice(0, 500),
    totals: {
      collectedMinor: sum((entry) => entry.amountMinor),
      commissionMinor: sum((entry) => entry.commissionMinor),
      managerShareMinor: sum((entry) => entry.managerShareMinor),
    },
  });
}

export const adminUsersRoute = handler(users);
export const adminUserDetailRoute = handler(userDetail);
export const adminSuspendRoute = handler(suspend);
export const adminDeleteUserRoute = handler(deleteAccount);
export const adminDeleteResourceRoute = handler(deleteResource);
export const adminPhotoScanRoute = handler(scanPhotos);
export const adminPhotoCleanupRoute = handler(cleanupPhotos);
export const adminManagerRoute = handler(appointManager);
export const adminRightsRoute = handler(rights);
export const adminEmailUsageRoute = handler(emailUsageToday);
export const adminDisputesRoute = handler(disputes);
export const adminReassignRoute = handler(reassign);
export const adminActionsRoute = handler(actions);
export const adminDecideActionRoute = handler(decideAction);
export const adminLedgerRoute = handler(ledger);

const anon = { authLevel: 'anonymous' } as const;

app.http('admin-users', { ...anon, methods: ['GET'], route: 'ops/users', handler: adminUsersRoute });
app.http('admin-user', { ...anon, methods: ['GET'], route: 'ops/users/{id}', handler: adminUserDetailRoute });
app.http('admin-suspend', { ...anon, methods: ['POST'], route: 'ops/users/{id}/suspend', handler: adminSuspendRoute });
app.http('admin-delete-user', { ...anon, methods: ['POST'], route: 'ops/users/{id}/delete', handler: adminDeleteUserRoute });
app.http('admin-email-usage', { ...anon, methods: ['GET'], route: 'ops/email-usage', handler: adminEmailUsageRoute });
app.http('admin-rights', { ...anon, methods: ['POST'], route: 'ops/users/{id}/rights', handler: adminRightsRoute });
app.http('admin-manager', { ...anon, methods: ['POST'], route: 'ops/users/{id}/manager', handler: adminManagerRoute });
app.http('admin-delete-resource', { ...anon, methods: ['POST'], route: 'ops/resources/delete', handler: adminDeleteResourceRoute });
app.http('admin-photo-scan', { ...anon, methods: ['POST'], route: 'ops/photos/scan', handler: adminPhotoScanRoute });
app.http('admin-photo-cleanup', { ...anon, methods: ['POST'], route: 'ops/photos/cleanup', handler: adminPhotoCleanupRoute });
app.http('admin-disputes', { ...anon, methods: ['GET'], route: 'ops/disputes', handler: adminDisputesRoute });
app.http('admin-reassign', { ...anon, methods: ['POST'], route: 'ops/disputes/{id}/reassign', handler: adminReassignRoute });
app.http('admin-actions', { ...anon, methods: ['GET'], route: 'ops/actions', handler: adminActionsRoute });
app.http('admin-action-decide', { ...anon, methods: ['POST'], route: 'ops/actions/{id}/decide', handler: adminDecideActionRoute });
app.http('admin-ledger', { ...anon, methods: ['GET'], route: 'ops/ledger', handler: adminLedgerRoute });
