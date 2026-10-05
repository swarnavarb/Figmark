import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ShareEvent, User } from '../../../shared/models.js';
import { isCancelledLike, isPlaced } from '../../../shared/orders.js';
import { accessFor } from '../../../shared/stores.js';
import { claimGrowth, emptyGrowth, growthView, tidyGrowth, type GrowthFacts } from '../../../shared/store-growth.js';
import { buyerTag, storeTag } from '../../../shared/storefront.js';
import { offersAffiliate } from '../affiliate.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import {
  INVITE_COOKIE, inviteCodeFor, inviteCookie, invitedSellerCount, isShareKind, isShareVia, logSend, readCookie,
  recordOpen, resolveInvite,
} from '../share.js';
import { error, handler, json } from './http.js';

/**
 * Sharing outside the app: logging a send, invites, and a shop's growth
 * quests with the Spotlights they pay. The link previews WhatsApp and the
 * rest show live in `og-routes.ts`; the counting rules in `../share.ts`.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

async function signedIn(request: HttpRequest) {
  const auth = await getAuthService();
  const principal = await auth.requireAuth(request);
  const repository = await getRepository();
  const user = await repository.getUserById(principal.id);
  return { repository, user };
}

/* ── Sends ──────────────────────────────────────────────────────────────── */

/**
 * POST /api/share/log - the person sent something out of the app.
 *
 * `{ kind, via, target?, storeId? }`. With a `storeId` the person helps run,
 * the shop's growth quests count it too.
 */
async function logShare(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  let body: { kind?: unknown; via?: unknown; target?: unknown; storeId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (!isShareKind(body.kind) || !isShareVia(body.via)) return error(400, 'invalid_share', 'Say what was shared and how.');
  const event: ShareEvent = {
    at: new Date().toISOString(),
    kind: body.kind,
    via: body.via,
    target: typeof body.target === 'string' ? body.target.slice(0, 80) : null,
  };
  await logSend(repository, user, event);

  if (typeof body.storeId === 'string' && body.storeId) {
    const owner = body.storeId === user.id ? user : await repository.getUserById(body.storeId);
    if (owner?.sellerProfile && accessFor(owner, user.id)) {
      const growth = owner.sellerProfile.growth ?? emptyGrowth();
      owner.sellerProfile.growth = tidyGrowth({ ...growth, shares: [...(growth.shares ?? []), { at: event.at, kind: event.kind, by: user.id }] });
      await repository.updateUser(owner);
    }
  }
  return json(200, { ok: true });
}

/* ── Invites ────────────────────────────────────────────────────────────── */

/** GET /api/invite/me - your invite links and who came through them. */
async function myInvite(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const code = await inviteCodeFor(repository, user);
  const recent = (user.invitees ?? []).slice(-8).reverse();
  const people = await repository.listUsersByIds(recent.map((entry) => entry.userId));
  const byId = new Map(people.map((person) => [person.id, person]));
  return json(200, {
    code,
    path: `/i/${code}`,
    sellerPath: `/i/${code}?as=seller`,
    joined: (user.invitees ?? []).length,
    sellers: await invitedSellerCount(repository, user),
    opens: (user.shareOpens ?? []).length,
    recent: recent.flatMap((entry) => {
      const person = byId.get(entry.userId);
      return person ? [{
        name: person.sellerProfile?.storefrontName ?? person.displayName,
        handle: person.sellerProfile?.username ?? person.username ?? null,
        seller: Boolean(person.sellerProfile),
        at: entry.at,
      }] : [];
    }),
  });
}

/**
 * GET /api/i/{code} - somebody opened an invite, or a page shared with one.
 *
 * Says whose invite it is, counts the open for them, and keeps the invite in
 * a cookie until sign-up. `?t=item|shop|profile&id=` names the page the link
 * led to when it was a shared page rather than the invite itself.
 */
async function openInvite(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const inviter = await resolveInvite(repository, request.params.code ?? '');
  if (!inviter) return error(404, 'not_found', 'That invite does not lead anywhere.');
  const viewer = await (await getAuthService()).getCurrentUser(request);
  const asSeller = request.query.get('as') === 'seller';
  const target = await openTarget(repository, request, inviter);
  const counted = await recordOpen(repository, request, inviter.id, target, viewer?.id ?? null);
  // Signed-out visitors carry the invite to sign-up. Keep an earlier invite
  // rather than letting every shared page overwrite whose friend this is.
  const keep = viewer || readCookie(request, INVITE_COOKIE);
  const cookies = keep ? counted : [...counted, inviteCookie(request.params.code ?? '', asSeller)];
  return json(200, {
    inviter: {
      name: inviter.displayName,
      handle: inviter.username ?? null,
      shop: inviter.sellerProfile ? { name: inviter.sellerProfile.storefrontName, handle: inviter.sellerProfile.username ?? null } : null,
      levelTag: inviter.sellerProfile ? storeTag(inviter.sellerProfile.levelCache) : buyerTag(inviter.quest?.levelCache),
    },
    asSeller,
    self: viewer?.id === inviter.id,
  }, cookies);
}

/** What an invite-carrying link pointed at, and the shop it leads into. */
async function openTarget(repository: Repo, request: HttpRequest, inviter: User) {
  const kind = request.query.get('t');
  const id = (request.query.get('id') ?? '').slice(0, 80);
  if (kind === 'item' && id) {
    const listing = await repository.getListing(id);
    if (listing) return { kind: 'item' as const, target: listing.id, storeOwnerId: listing.sellerId };
  }
  if ((kind === 'shop' || kind === 'profile') && id) {
    const found = await repository.getByHandle(id);
    if (found) return { kind: found.isStore ? 'shop' as const : 'profile' as const, target: id.toLowerCase(), storeOwnerId: found.isStore ? found.user.id : null };
  }
  return { kind: 'invite' as const, target: inviter.inviteCode ?? '', storeOwnerId: null };
}

/* ── A shop's growth quests ─────────────────────────────────────────────── */

async function growthFacts(repository: Repo, owner: User): Promise<GrowthFacts> {
  const [listings, sales, posts] = await Promise.all([
    repository.listListings({ sellerId: owner.id, limit: 200, includeHidden: true }),
    repository.listOrdersForSeller(owner.id),
    repository.listPosts(owner.id, 200),
  ]);
  const now = Date.now();
  const live = listings.filter((listing) => listing.status === 'active' && !(listing.expiresAt && Date.parse(listing.expiresAt) <= now));
  const fills = live
    .filter((listing) => listing.preOrder && listing.preOrder.fillThreshold > 0)
    .map((listing) => (listing.preOrder!.filledCount + (listing.preOrder!.pledgedCount ?? 0)) / listing.preOrder!.fillThreshold);
  const growth = owner.sellerProfile?.growth;
  return {
    shares: (growth?.shares ?? []).map((entry) => ({ at: entry.at })),
    opens: (growth?.opens ?? []).map((entry) => ({ at: entry.at })),
    posts: posts.map((post) => ({ at: post.createdAt })),
    affiliateItems: live.filter((listing) => offersAffiliate(listing)).length,
    affiliateSales: sales
      .filter((order) => order.affiliate && isPlaced(order) && !isCancelledLike(order.status))
      .map((order) => ({ at: order.placedAt ?? order.createdAt })),
    bestFill: Math.min(1, Math.max(0, ...fills)),
  };
}

/** The shop, when the signed-in person helps run it. */
async function shopFor(request: HttpRequest, ownerId: string | undefined) {
  const { repository, user } = await signedIn(request);
  if (!user) return { ok: false, refusal: error(404, 'not_found', 'This account no longer exists.') } as const;
  const owner = ownerId === user.id ? user : ownerId ? await repository.getUserById(ownerId) : null;
  const access = owner?.sellerProfile ? accessFor(owner, user.id) : null;
  if (!owner?.sellerProfile || !access) return { ok: false, refusal: error(403, 'forbidden', 'You do not help run this shop.') } as const;
  return { ok: true, repository, user, owner, access } as const;
}

/** GET /api/growth/{ownerId} - the shop's growth quests and Spotlights. */
async function growth(request: HttpRequest, _context: InvocationContext) {
  const found = await shopFor(request, request.params.ownerId);
  if (!found.ok) return found.refusal;
  const { repository, owner } = found;
  const view = growthView(await growthFacts(repository, owner), owner.sellerProfile!.growth);
  const shop = owner.sellerProfile!;
  return json(200, {
    view,
    handle: shop.username ?? null,
    name: shop.storefrontName,
    photoUrl: shop.photoUrl ?? null,
    levelTag: storeTag(shop.levelCache),
    followers: shop.followerCount ?? 0,
  });
}

/** POST /api/growth/{ownerId}/claim - `{ taskId }`: collect a finished quest's Spotlights. */
async function claim(request: HttpRequest, _context: InvocationContext) {
  const found = await shopFor(request, request.params.ownerId);
  if (!found.ok) return found.refusal;
  const { repository, owner } = found;
  let body: { taskId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (typeof body.taskId !== 'string') return error(400, 'invalid_task', 'Say which quest.');
  const facts = await growthFacts(repository, owner);
  const result = claimGrowth(facts, owner.sellerProfile!.growth, body.taskId);
  if ('refusal' in result) return error(409, 'not_claimable', result.refusal);
  owner.sellerProfile!.growth = tidyGrowth(result.state);
  await repository.updateUser(owner);
  return json(200, { view: growthView(facts, result.state), gained: { spotlights: result.task.spotlights, xp: result.task.xp } });
}

/**
 * POST /api/listings/{id}/spotlight - spend a Spotlight on one of the shop's
 * items: it goes straight back to the top of the feed, bump limit or not.
 */
async function spotlight(request: HttpRequest, _context: InvocationContext) {
  const { repository, user } = await signedIn(request);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const listing = request.params.id ? await repository.getListing(request.params.id) : null;
  if (!listing) return error(404, 'not_found', 'No such listing.');
  const owner = listing.sellerId === user.id ? user : await repository.getUserById(listing.sellerId);
  const access = owner?.sellerProfile ? accessFor(owner, user.id) : null;
  if (!owner?.sellerProfile || !access?.permissions.includes('listings')) {
    return error(403, 'forbidden', 'Only the shop can spotlight its items.');
  }
  if (listing.status !== 'active') return error(409, 'not_active', 'Only a live item can be spotlit.');
  const state = owner.sellerProfile.growth ?? emptyGrowth();
  if (state.spotlights < 1) return error(409, 'no_spotlights', 'No Spotlights left. Finish a growth quest to earn one.');
  const now = new Date().toISOString();
  listing.bumpedAt = now;
  listing.updatedAt = now;
  await repository.updateListing(listing);
  owner.sellerProfile.growth = tidyGrowth({
    ...state,
    spotlights: state.spotlights - 1,
    spotlightLog: [...(state.spotlightLog ?? []), { listingId: listing.id, at: now, by: user.id }],
  });
  await repository.updateUser(owner);
  return json(200, { spotlights: owner.sellerProfile.growth.spotlights, bumpedAt: now });
}

export const logShareRoute = handler(logShare);
export const myInviteRoute = handler(myInvite);
export const openInviteRoute = handler(openInvite);
export const growthRoute = handler(growth);
export const growthClaimRoute = handler(claim);
export const spotlightRoute = handler(spotlight);

const anon = { authLevel: 'anonymous' } as const;
app.http('share-log', { ...anon, methods: ['POST'], route: 'share/log', handler: logShareRoute });
app.http('invite-me', { ...anon, methods: ['GET'], route: 'invite/me', handler: myInviteRoute });
app.http('invite-open', { ...anon, methods: ['GET'], route: 'i/{code}', handler: openInviteRoute });
app.http('growth', { ...anon, methods: ['GET'], route: 'growth/{ownerId}', handler: growthRoute });
app.http('growth-claim', { ...anon, methods: ['POST'], route: 'growth/{ownerId}/claim', handler: growthClaimRoute });
app.http('listing-spotlight', { ...anon, methods: ['POST'], route: 'listings/{id}/spotlight', handler: spotlightRoute });
