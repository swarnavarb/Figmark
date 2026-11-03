import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import {
  GIFT_METHODS, GIVER_KINDS, PRO_FEATURES, cleanPricing, cleanVoucherCode, creditStoreId, daysForMonths, extendPro, feeDiscountBp,
  gstFor, gstSplit, isProActive, proDaysLeft, proLocked, voucherProblem,
  type GiftMethod, type GiverKind, type ProGrant, type ProVoucher, type Pricing, type StoreGift,
} from '../../../shared/billing.js';
import type { User } from '../../../shared/models.js';
import { storeCreditLeft, type StoreCredit } from '../../../shared/play.js';
import { rupees } from '../../../shared/payments.js';
import { rightsIn, storeOf } from '../../../shared/service-stores.js';
import { can } from '../../../shared/stores.js';
import { emptyGrowth, tidyGrowth } from '../../../shared/store-growth.js';
import { emptyQuestState, tidyQuestState } from '../../../shared/quest.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { audited } from '../audit.js';
import {
  loadFeeIndex, loadPricing, recordEarning, refreshFees, savePricing, settleFees,
} from '../billing.js';
import { loadLedger, mutateList } from '../community.js';
import { tooFast } from '../rate-limit.js';
import { AuthError } from '../auth/errors.js';
import { storeKey, type ServiceRequest } from '../../../shared/service-work.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';

/**
 * Figmark's money, as the people paying it and the operators setting it see it:
 *
 * - `/api/pricing` - the fees, GST and Pro plans, for the words on screen.
 * - `/api/me/fees` - the account's platform-fee statement, and paying it.
 * - `/api/me/pro` - Pro: plans, buying, a voucher, the free trial.
 * - `/api/me/gifts` - a store paying or crediting anybody, and the person
 *   saying a direct payment arrived.
 * - `/api/ops/pricing`, `/api/ops/pro/*`, `/api/ops/fees` - the console.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;
const anon = { authLevel: 'anonymous' } as const;

async function body<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const money = (value: unknown): number => {
  const amount = Math.round(Number(value));
  return Number.isFinite(amount) && amount > 0 ? Math.min(amount, 1_00_00_000) : 0;
};
const gatewayRef = () => `gw_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** What a visitor may read of the pricing: everything but who last edited it. */
function publicPricing(pricing: Pricing) {
  const { updatedBy: _by, ...rest } = pricing;
  return rest;
}

/* ── Pricing, for everybody ──────────────────────────────────────────────── */

/** GET /api/pricing */
async function readPricing(_request: HttpRequest, _context: InvocationContext) {
  const pricing = await loadPricing(await getRepository());
  const response = json(200, publicPricing(pricing));
  // Read on every listing form: a minute in the browser is fresh enough.
  (response.headers as Headers).set('Cache-Control', 'public, max-age=60');
  return response;
}

/* ── Platform fees ───────────────────────────────────────────────────────── */

async function me(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const account = await repository.getUserById(user.id);
  if (!account) throw new AuthError(401, 'unauthenticated', 'Sign in again.');
  return { user, repository, account };
}

/** GET /api/me/fees - the statement, worked out now, and the lock brought in line with it. */
async function myFees(request: HttpRequest, _context: InvocationContext) {
  const { repository, account } = await me(request);
  const [{ statement, owner }, pricing] = await Promise.all([refreshFees(repository, account), loadPricing(repository)]);
  return json(200, {
    statement,
    locked: Boolean(owner.feeLock),
    lockedSince: owner.feeLock?.since ?? null,
    discountBp: feeDiscountBp(owner.pro, pricing.pro),
    pro: isProActive(owner.pro),
    fees: pricing.fees,
    gst: pricing.gst.enabled && pricing.gst.applyTo.platform ? { rateBp: pricing.gst.rateBp, mode: pricing.gst.mode } : null,
  });
}

/** POST /api/me/fees/pay { amountMinor? } - pays through the gateway; all that is owed unless told less. */
async function payFees(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, account } = await me(request);
  const slow = await tooFast(user.id, 'billing');
  if (slow) return slow;
  const input = await body<{ amountMinor?: unknown }>(request);
  const { statement } = await refreshFees(repository, account);
  if (statement.owedMinor <= 0) return error(409, 'nothing_owed', 'There is nothing to pay.');
  const amount = input?.amountMinor === undefined ? statement.owedMinor : money(input.amountMinor);
  if (amount <= 0) return error(400, 'invalid_amount', 'Enter an amount to pay.');
  if (amount > statement.owedMinor) return error(400, 'too_much', `You owe ${rupees(statement.owedMinor)}.`);
  const settlement = await settleFees(repository, account, amount, user.id);
  const fresh = (await repository.getUserById(account.id)) ?? account;
  const after = await refreshFees(repository, fresh);
  await notify(repository, [account.id], {
    kind: 'platform_fees',
    title: `Paid ${rupees(amount)} in platform fees`,
    body: `Gateway reference ${settlement.gatewayRef}.${after.statement.owedMinor > 0 ? ` ${rupees(after.statement.owedMinor)} still to pay.` : ' All settled.'}`,
    link: '/fees',
  });
  return json(200, { settlement, statement: after.statement, locked: Boolean(after.owner.feeLock) });
}

/* ── Pro ─────────────────────────────────────────────────────────────────── */

function proView(account: User, pricing: Pricing) {
  const now = Date.now();
  const gst = gstFor(pricing.gst, 'pro');
  return {
    enabled: pricing.pro.enabled,
    active: isProActive(account.pro, now),
    until: account.pro?.until ?? null,
    daysLeft: proDaysLeft(account.pro, now),
    discountUntil: account.pro?.discountUntil ?? null,
    discountBp: feeDiscountBp(account.pro, pricing.pro, now),
    trialDays: pricing.pro.trialDays,
    trialUsed: Boolean(account.pro?.trialUsed),
    plans: pricing.pro.plans.filter((plan) => plan.enabled).map((plan) => ({ ...plan, ...gstSplit(gst, plan.priceMinor) })),
    feeDiscount: { bp: pricing.pro.feeDiscountBp, days: pricing.pro.feeDiscountDays },
    features: PRO_FEATURES.map((feature) => ({ ...feature, pro: pricing.pro.enabled && pricing.pro.features[feature.id] !== false })),
    locked: Object.fromEntries(PRO_FEATURES.map((feature) => [feature.id, proLocked(feature.id, pricing.pro, account.pro, now)])),
    bumpPoints: (account.sellerProfile?.growth?.spotlights ?? 0) + (account.quest?.bumps ?? 0),
    history: [...(account.pro?.history ?? [])].reverse().slice(0, 20),
    gst: gst ? { ...gst, gstin: pricing.gst.gstin } : null,
    fees: pricing.fees,
  };
}

/** GET /api/me/pro */
async function myPro(request: HttpRequest, _context: InvocationContext) {
  const { repository, account } = await me(request);
  return json(200, proView(account, await loadPricing(repository)));
}

/**
 * GET /api/pro/status?owner= - whether a store's owner is Pro, and which tools
 * are shut: what a manager working the store, and its Pro badge, need.
 */
async function proStatus(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const ownerId = request.query.get('owner') ?? '';
  const [owner, pricing] = await Promise.all([ownerId ? repository.getUserById(ownerId) : null, loadPricing(repository)]);
  if (!owner) return error(404, 'not_found', 'No such store.');
  const now = Date.now();
  return json(200, {
    enabled: pricing.pro.enabled,
    active: isProActive(owner.pro, now),
    locked: Object.fromEntries(PRO_FEATURES.map((feature) => [feature.id, proLocked(feature.id, pricing.pro, owner.pro, now)])),
  });
}

/** Adds bump points to the shop, or to the person when they have no shop. */
function addBumps(account: User, points: number): void {
  if (points <= 0) return;
  if (account.sellerProfile) {
    const growth = account.sellerProfile.growth ?? emptyGrowth();
    account.sellerProfile.growth = tidyGrowth({ ...growth, spotlights: (growth.spotlights ?? 0) + points });
  } else {
    const quest = account.quest ?? emptyQuestState();
    account.quest = tidyQuestState({ ...quest, bumps: (quest.bumps ?? 0) + points });
  }
}

/** POST /api/me/pro/buy { months } - pays through the gateway and adds the months. */
async function buyPro(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, account } = await me(request);
  const slow = await tooFast(user.id, 'billing');
  if (slow) return slow;
  const input = await body<{ months?: unknown }>(request);
  const pricing = await loadPricing(repository);
  if (!pricing.pro.enabled) return error(409, 'pro_off', 'Pro is not on sale right now - every tool is open to everybody.');
  const plan = pricing.pro.plans.find((entry) => entry.enabled && entry.months === Number(input?.months));
  if (!plan) return error(400, 'no_plan', 'Pick 3, 6 or 12 months.');
  const charge = gstSplit(gstFor(pricing.gst, 'pro'), plan.priceMinor);
  const ref = gatewayRef();
  const now = Date.now();
  const grant: ProGrant = {
    id: `pro_${randomUUID().slice(0, 12)}`, at: new Date(now).toISOString(), source: 'purchase', days: daysForMonths(plan.months),
    months: plan.months, amountMinor: charge.totalMinor, gstMinor: charge.gstMinor, gatewayRef: ref, bumpPoints: plan.bumpPoints, by: user.id,
  };
  account.pro = extendPro(account.pro, grant.days, grant, pricing.pro, now);
  addBumps(account, plan.bumpPoints);
  await repository.updateUser(account);
  if (charge.totalMinor > 0) {
    await recordEarning(repository, {
      kind: 'pro', payerId: account.id, amountMinor: charge.totalMinor, gstMinor: charge.gstMinor, reference: grant.id, gatewayRef: ref,
    });
  }
  await notify(repository, [account.id], {
    kind: 'pro_plan',
    title: `You're Pro until ${new Date(account.pro.until!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    body: `${plan.months} months${plan.bumpPoints ? ` and ${plan.bumpPoints} bump points` : ''}. Every Pro tool is open.`,
    link: '/pro',
  });
  return json(200, proView(account, pricing));
}

const VOUCHERS_ID = 'pro-vouchers';

async function loadVouchers(repository: Repo): Promise<ProVoucher[]> {
  const saved = await repository.getSiteContent(VOUCHERS_ID);
  const list = (saved?.data as { vouchers?: ProVoucher[] } | undefined)?.vouchers;
  return Array.isArray(list) ? list : [];
}

const mutateVouchers = (repository: Repo, by: string, change: (list: ProVoucher[]) => ProVoucher[]) =>
  mutateList<ProVoucher>(repository, VOUCHERS_ID, 'vouchers', 5_000, by, change);

/** POST /api/me/pro/redeem { code } */
async function redeemVoucher(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, account } = await me(request);
  // Codes are guessable by brute force otherwise.
  const slow = await tooFast(user.id, 'voucher');
  if (slow) return slow;
  const input = await body<{ code?: unknown }>(request);
  const code = cleanVoucherCode(input?.code);
  if (!code) return error(400, 'no_code', 'Enter the code.');
  const pricing = await loadPricing(repository);
  let days = 0;
  let refused: string | null = null;
  // Checked and claimed in one write, so a code with one use left is used once.
  await mutateVouchers(repository, user.id, (list) => {
    const voucher = list.find((entry) => entry.code === code);
    refused = voucherProblem(voucher, user.id);
    if (refused || !voucher) return list;
    days = voucher.days;
    return list.map((entry) => entry === voucher
      ? { ...entry, redeemed: [...entry.redeemed, { userId: user.id, name: account.displayName, at: new Date().toISOString() }] }
      : entry);
  });
  if (refused) return error(400, 'bad_code', refused);
  const grant: ProGrant = { id: `pro_${randomUUID().slice(0, 12)}`, at: new Date().toISOString(), source: 'voucher', days, code, by: user.id };
  account.pro = extendPro(account.pro, days, grant, pricing.pro);
  await repository.updateUser(account);
  await notify(repository, [account.id], {
    kind: 'pro_plan', title: `Voucher applied: ${days} days of Pro`, body: 'Every Pro tool is open.', link: '/pro',
  });
  return json(200, proView(account, pricing));
}

/** POST /api/me/pro/trial - the free days, once per account. */
async function startTrial(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, account } = await me(request);
  const pricing = await loadPricing(repository);
  if (!pricing.pro.enabled || pricing.pro.trialDays <= 0) return error(409, 'no_trial', 'There is no free trial right now.');
  if (account.pro?.trialUsed || (account.pro?.history ?? []).length > 0) return error(409, 'trial_used', 'The free trial is for accounts new to Pro.');
  const grant: ProGrant = { id: `pro_${randomUUID().slice(0, 12)}`, at: new Date().toISOString(), source: 'trial', days: pricing.pro.trialDays, by: user.id };
  account.pro = extendPro(account.pro, grant.days, grant, pricing.pro);
  await repository.updateUser(account);
  return json(200, proView(account, pricing));
}

/* ── Paying or crediting anybody ─────────────────────────────────────────── */

const GIFTS_PREFIX = 'store-gifts-';
const GIFTS_IN_PREFIX = 'gifts-in-';

async function loadGifts(repository: Repo, id: string): Promise<StoreGift[]> {
  const saved = await repository.getSiteContent(id);
  const list = (saved?.data as { gifts?: StoreGift[] } | undefined)?.gifts;
  return Array.isArray(list) ? list : [];
}
const mutateGifts = (repository: Repo, id: string, by: string, change: (list: StoreGift[]) => StoreGift[]) =>
  mutateList<StoreGift>(repository, id, 'gifts', 2_000, by, change);

const isGiver = (value: unknown): value is GiverKind => typeof value === 'string' && (GIVER_KINDS as readonly string[]).includes(value);
const isMethod = (value: unknown): value is GiftMethod => typeof value === 'string' && (GIFT_METHODS as readonly string[]).includes(value);

/** The store a giver acts for, and its name, if they may pay out of it. */
async function giverStore(repository: Repo, userId: string, kind: GiverKind, ownerIdRaw: unknown) {
  const ownerId = typeof ownerIdRaw === 'string' && ownerIdRaw ? ownerIdRaw : userId;
  const owner = await repository.getUserById(ownerId);
  if (!owner) return null;
  if (kind === 'shop') {
    if (!owner.sellerProfile) return null;
    // Money out of a shop is the owner's, or an admin manager's, to send.
    if (owner.id !== userId && !can(owner, userId, 'admin')) return null;
    return { owner, name: owner.sellerProfile.storefrontName || owner.displayName };
  }
  const store = storeOf(owner, kind);
  if (!store) return null;
  if (owner.id !== userId && !rightsIn(owner, kind, userId).includes('store')) return null;
  return { owner, name: store.companyName };
}

/** GET /api/me/gifts?kind=&owner= - what the store has paid or credited, and who it may pay. */
async function listGiven(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const kind = request.query.get('kind') ?? 'shop';
  if (!isGiver(kind)) return error(400, 'bad_kind', 'Unknown store.');
  const found = await giverStore(repository, user.id, kind, request.query.get('owner'));
  if (!found) return error(403, 'forbidden', 'You cannot pay out of that store.');
  const gifts = (await loadGifts(repository, `${GIFTS_PREFIX}${found.owner.id}`)).filter((gift) => gift.giverKind === kind);
  // Customers to pick from: people who bought from this store, newest first.
  let people: { id: string; name: string; handle: string | null }[] = [];
  if (kind === 'shop') {
    const orders = await repository.listOrdersForSeller(found.owner.id);
    const seen = new Map<string, string>();
    for (const order of [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      if (!seen.has(order.buyerId)) seen.set(order.buyerId, order.buyerId);
      if (seen.size >= 40) break;
    }
    const users = await repository.listUsersByIds([...seen.keys()]);
    people = users.map((entry) => ({ id: entry.id, name: entry.displayName, handle: entry.username ?? null }));
  } else {
    const requests = await repository.listServiceWork<ServiceRequest>(storeKey(kind, found.owner.id), 'request', 500);
    const seen = new Map<string, { id: string; name: string; handle: string | null }>();
    for (const row of requests) {
      if (row.customerId && !seen.has(row.customerId)) seen.set(row.customerId, { id: row.customerId, name: row.customerName, handle: row.customerHandle });
    }
    people = [...seen.values()].slice(0, 40);
  }
  return json(200, { store: { kind, ownerId: found.owner.id, name: found.name }, gifts: [...gifts].reverse(), people });
}

/**
 * POST /api/me/gifts - a store pays or credits somebody.
 * { kind, owner?, recipient (id or @handle), amountMinor, method, reason, reference?, orderId? }
 */
async function give(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const slow = await tooFast(user.id, 'gift');
  if (slow) return slow;
  const input = await body<Record<string, unknown>>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  const kind = input.kind ?? 'shop';
  if (!isGiver(kind)) return error(400, 'bad_kind', 'Unknown store.');
  if (!isMethod(input.method)) return error(400, 'bad_method', 'Pick how to send it: direct, the gateway, or store credit.');
  const found = await giverStore(repository, user.id, kind, input.owner);
  if (!found) return error(403, 'forbidden', 'You cannot pay out of that store.');
  if (found.owner.feeLock) return error(409, 'fee_locked', 'Pay your overdue platform fees first.');

  const amount = money(input.amountMinor);
  if (!amount) return error(400, 'invalid_amount', 'Enter an amount.');
  const reason = text(input.reason, 200);
  if (!reason) return error(400, 'no_reason', 'Say what it is for - a refund, goodwill, a mistake put right.');
  const raw = text(input.recipient, 80);
  let recipient = raw && !raw.startsWith('@') ? await repository.getUserById(raw) : null;
  if (!recipient && raw) recipient = (await repository.getByHandle(raw.replace(/^@/, '').toLowerCase()))?.user ?? null;
  if (!recipient) return error(404, 'no_person', 'Nobody by that name. Pick a customer or type their @handle.');
  if (recipient.id === found.owner.id) return error(400, 'self', 'A store cannot pay itself.');

  const reference = text(input.reference, 80) || null;
  if (input.method === 'direct' && !reference) return error(400, 'no_reference', 'Add the UPI or bank reference, so they can find it.');
  const now = new Date().toISOString();
  const gift: StoreGift = {
    id: `gift_${randomUUID().slice(0, 12)}`,
    at: now,
    giverKind: kind,
    ownerId: found.owner.id,
    storeName: found.name,
    recipientId: recipient.id,
    recipientName: recipient.displayName,
    amountMinor: amount,
    method: input.method,
    reason,
    reference,
    gatewayRef: input.method === 'gateway' ? gatewayRef() : null,
    orderId: text(input.orderId, 80) || null,
    by: user.id,
    byName: user.displayName,
    status: input.method === 'direct' ? 'sent' : input.method === 'credit' ? 'credited' : 'received',
    answeredAt: input.method === 'direct' ? null : now,
  };

  if (gift.method === 'credit') {
    const credit: StoreCredit = {
      id: gift.id,
      storeId: creditStoreId(kind, found.owner.id),
      storeName: found.name,
      amountMinor: amount,
      spentMinor: 0,
      reason,
      link: kind === 'shop' ? `/${found.owner.sellerProfile?.username ?? found.owner.username ?? ''}` : `/services/${kind}/${storeOf(found.owner, kind)?.directorySlug ?? ''}`,
      createdAt: now,
      spends: [],
      kind,
      given: true,
    };
    await repository.updateUser({ ...recipient, storeCredits: [...(recipient.storeCredits ?? []), credit] });
  }
  await Promise.all([
    mutateGifts(repository, `${GIFTS_PREFIX}${found.owner.id}`, user.id, (list) => [...list, gift]),
    mutateGifts(repository, `${GIFTS_IN_PREFIX}${recipient.id}`, user.id, (list) => [...list, gift]),
  ]);
  await notify(repository, [recipient.id], {
    kind: 'store_gift',
    title: gift.method === 'credit'
      ? `${found.name} gave you ${rupees(amount)} store credit`
      : `${found.name} sent you ${rupees(amount)}`,
    body: gift.method === 'credit'
      ? `${reason}. It comes off your next order there on its own.`
      : gift.method === 'gateway'
        ? `${reason}. Paid through the gateway · ${gift.gatewayRef}.`
        : `${reason}. Ref ${reference}. Tell them whether it arrived.`,
    link: '/wallet?tab=gifts',
  });
  return json(201, { gift });
}

/** GET /api/me/gifts/received - what stores sent or credited this person. */
async function received(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const gifts = await loadGifts(await getRepository(), `${GIFTS_IN_PREFIX}${user.id}`);
  return json(200, { gifts: [...gifts].reverse() });
}

/** POST /api/me/gifts/{id}/answer { arrived } - the person says whether a direct payment arrived. */
async function answer(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const id = request.params.id ?? '';
  const input = await body<{ arrived?: unknown }>(request);
  const mine = (await loadGifts(repository, `${GIFTS_IN_PREFIX}${user.id}`)).find((gift) => gift.id === id);
  if (!mine || mine.method !== 'direct') return error(404, 'not_found', 'No such payment.');
  if (mine.status === 'received') return error(409, 'answered', 'You already said it arrived.');
  const status: StoreGift['status'] = input?.arrived === true ? 'received' : 'not_received';
  const now = new Date().toISOString();
  const change = (list: StoreGift[]) => list.map((gift) => (gift.id === id ? { ...gift, status, answeredAt: now } : gift));
  await Promise.all([
    mutateGifts(repository, `${GIFTS_IN_PREFIX}${user.id}`, user.id, change),
    mutateGifts(repository, `${GIFTS_PREFIX}${mine.ownerId}`, user.id, change),
  ]);
  await notify(repository, [mine.ownerId], {
    kind: 'store_gift',
    title: status === 'received' ? `${mine.recipientName} got your ${rupees(mine.amountMinor)}` : `${mine.recipientName} says your ${rupees(mine.amountMinor)} has not arrived`,
    body: status === 'received' ? mine.reason : `Ref ${mine.reference ?? '-'}. Check it and send it again, or talk to them.`,
    link: mine.giverKind === 'shop' ? '/shop?tab=refunds' : `/services/store/${mine.giverKind}/${mine.ownerId}?tab=refunds`,
  });
  return json(200, { status });
}

/**
 * GET /api/me/store-credit - every store this person has credit at, and how
 * much: what the corner chip on a store's pages reads. One small read,
 * cached by the browser for the session.
 */
async function myStoreCredit(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const principal = await auth.getCurrentUser(request);
  if (!principal) return json(200, { credits: [] });
  const account = await (await getRepository()).getUserById(principal.id);
  const byStore = new Map<string, { storeId: string; storeName: string; leftMinor: number }>();
  for (const credit of account?.storeCredits ?? []) {
    const left = storeCreditLeft(credit);
    if (left <= 0) continue;
    const row = byStore.get(credit.storeId) ?? { storeId: credit.storeId, storeName: credit.storeName, leftMinor: 0 };
    row.leftMinor += left;
    byStore.set(credit.storeId, row);
  }
  return json(200, { credits: [...byStore.values()] });
}

/* ── The console ─────────────────────────────────────────────────────────── */

async function operator(request: HttpRequest) {
  const auth = await getAuthService();
  return auth.requireCapability(request, ['admin']);
}

/** GET /api/ops/pricing */
async function opsPricing(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  return json(200, await loadPricing(await getRepository()));
}

/** POST /api/ops/pricing/save - the whole document, or any part of it. */
async function opsSavePricing(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const input = await body<Record<string, unknown>>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  const repository = await getRepository();
  const { updatedAt: _at, updatedBy: _by, ...current } = await loadPricing(repository);
  const merged = {
    ...current,
    ...input,
    fees: { ...current.fees, ...(input.fees as object | undefined) },
    gst: { ...current.gst, ...(input.gst as object | undefined), applyTo: { ...current.gst.applyTo, ...((input.gst as { applyTo?: object } | undefined)?.applyTo) } },
    pro: { ...current.pro, ...(input.pro as object | undefined), features: { ...current.pro.features, ...((input.pro as { features?: object } | undefined)?.features) } },
  };
  const cleaned = cleanPricing(merged);
  if ('error' in cleaned) return error(400, 'invalid_pricing', cleaned.error);
  return json(200, await savePricing(repository, cleaned.pricing, user.displayName ?? user.email));
}

/** GET /api/ops/pro/vouchers */
async function opsVouchers(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  return json(200, { vouchers: [...(await loadVouchers(await getRepository()))].reverse() });
}

const VOUCHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(prefix: string): string {
  const bytes = randomUUID().replace(/-/g, '');
  let code = '';
  for (let index = 0; index < 8; index += 1) code += VOUCHER_ALPHABET[parseInt(bytes.slice(index * 2, index * 2 + 2), 16) % VOUCHER_ALPHABET.length];
  return `${prefix ? `${prefix}-` : ''}${code}`;
}

/**
 * POST /api/ops/pro/vouchers { count, days, maxUses, expiresAt?, prefix?, code?, note? }
 * Makes one code (named, or made up) or a batch of single-use ones.
 */
async function opsMakeVouchers(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const input = await body<Record<string, unknown>>(request);
  const repository = await getRepository();
  const days = Math.round(Number(input?.days));
  if (!Number.isInteger(days) || days < 1 || days > 730) return error(400, 'bad_days', 'A voucher gives 1 to 730 days.');
  const count = Math.max(1, Math.min(500, Math.round(Number(input?.count) || 1)));
  const maxUses = Math.max(1, Math.min(100_000, Math.round(Number(input?.maxUses) || 1)));
  const expires = typeof input?.expiresAt === 'string' && input.expiresAt ? new Date(input.expiresAt) : null;
  if (expires && Number.isNaN(expires.getTime())) return error(400, 'bad_date', 'That expiry date is not a date.');
  const named = cleanVoucherCode(input?.code);
  const prefix = cleanVoucherCode(input?.prefix).slice(0, 10);
  const now = new Date().toISOString();
  const made: ProVoucher[] = [];
  let clash = false;
  await mutateVouchers(repository, user.id, (list) => {
    const taken = new Set(list.map((voucher) => voucher.code));
    if (named && (count > 1 || taken.has(named))) {
      clash = true;
      return list;
    }
    for (let index = 0; index < count; index += 1) {
      let code = named || newCode(prefix);
      while (taken.has(code)) code = newCode(prefix);
      taken.add(code);
      made.push({
        code, days, maxUses, expiresAt: expires ? expires.toISOString() : null, disabled: false,
        note: text(input?.note, 120), createdAt: now, createdBy: user.displayName ?? user.email, redeemed: [],
      });
    }
    return [...list, ...made];
  });
  if (clash) return error(409, 'code_taken', named && count > 1 ? 'A named code is one code; leave the name empty for a batch.' : 'That code already exists.');
  return json(201, { vouchers: made });
}

/** POST /api/ops/pro/vouchers/{code}/toggle - switch a code off, or back on. */
async function opsToggleVoucher(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const code = cleanVoucherCode(request.params.code);
  let found = false;
  await mutateVouchers(await getRepository(), user.id, (list) => list.map((voucher) => {
    if (voucher.code !== code) return voucher;
    found = true;
    return { ...voucher, disabled: !voucher.disabled };
  }));
  return found ? json(200, { ok: true }) : error(404, 'not_found', 'No such code.');
}

/** POST /api/ops/pro/grant { userId, days } - Pro given by hand (negative days take it back). */
async function opsGrantPro(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const input = await body<{ userId?: unknown; days?: unknown }>(request);
  const repository = await getRepository();
  const account = typeof input?.userId === 'string' ? await repository.getUserById(input.userId) : null;
  if (!account) return error(404, 'not_found', 'No such account.');
  const days = Math.round(Number(input?.days));
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 1_000) return error(400, 'bad_days', 'Give -1,000 to 1,000 days, not zero.');
  const pricing = await loadPricing(repository);
  const grant: ProGrant = { id: `pro_${randomUUID().slice(0, 12)}`, at: new Date().toISOString(), source: 'admin', days, by: user.displayName ?? user.email };
  if (days > 0) {
    account.pro = extendPro(account.pro, days, grant, pricing.pro);
  } else {
    const until = account.pro?.until ? new Date(Date.parse(account.pro.until) + days * 86_400_000).toISOString() : null;
    account.pro = { until, discountUntil: account.pro?.discountUntil ?? null, trialUsed: account.pro?.trialUsed, history: [...(account.pro?.history ?? []), grant] };
  }
  await repository.updateUser(account);
  if (days > 0) {
    await notify(repository, [account.id], { kind: 'pro_plan', title: `Figmark gave you ${days} days of Pro`, body: 'Every Pro tool is open.', link: '/pro' });
  }
  return json(200, { pro: account.pro });
}

/**
 * GET /api/ops/fees - every account with platform fees and where it stands,
 * and what Figmark has earned, by kind: platform fees, Pro, protection and
 * disputes (Figmark's commission on those, the managers' share apart).
 */
async function opsFees(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();
  const [index, ledger] = await Promise.all([loadFeeIndex(repository), loadLedger(repository)]);
  const earnings: Record<string, { collectedMinor: number; figmarkMinor: number; managerMinor: number; gstMinor: number; count: number }> = {};
  for (const entry of ledger) {
    const row = earnings[entry.kind] ?? { collectedMinor: 0, figmarkMinor: 0, managerMinor: 0, gstMinor: 0, count: 0 };
    row.collectedMinor += entry.amountMinor;
    row.figmarkMinor += entry.commissionMinor;
    row.managerMinor += entry.managerShareMinor;
    row.gstMinor += entry.gstMinor ?? 0;
    row.count += 1;
    earnings[entry.kind] = row;
  }
  const accounts = Object.entries(index).map(([userId, entry]) => ({ userId, ...entry }))
    .sort((a, b) => b.overdueMinor - a.overdueMinor || b.owedMinor - a.owedMinor);
  return json(200, { accounts, earnings });
}

/** POST /api/ops/fees/{id}/refresh - work one account's statement out now (and lock or open it). */
async function opsRefreshFees(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();
  const account = await repository.getUserById(request.params.id ?? '');
  if (!account) return error(404, 'not_found', 'No such account.');
  const { statement, owner } = await refreshFees(repository, account);
  return json(200, { statement, locked: Boolean(owner.feeLock) });
}

/** POST /api/ops/fees/{id}/waive { amountMinor, note } - write some or all of what is owed off. */
async function opsWaiveFees(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const repository = await getRepository();
  const account = await repository.getUserById(request.params.id ?? '');
  if (!account) return error(404, 'not_found', 'No such account.');
  const input = await body<{ amountMinor?: unknown; note?: unknown }>(request);
  const { statement } = await refreshFees(repository, account);
  const amount = Math.min(money(input?.amountMinor) || statement.owedMinor, statement.owedMinor);
  if (amount <= 0) return error(409, 'nothing_owed', 'This account owes nothing.');
  await settleFees(repository, account, amount, user.displayName ?? user.email, { waived: true, note: text(input?.note, 200) || null });
  const after = await refreshFees(repository, (await repository.getUserById(account.id)) ?? account);
  return json(200, { statement: after.statement, locked: Boolean(after.owner.feeLock) });
}

export const pricingRoute = handler(readPricing);
export const myFeesRoute = handler(myFees);
export const payFeesRoute = handler(payFees);
export const myProRoute = handler(myPro);
export const proStatusRoute = handler(proStatus);
export const buyProRoute = handler(buyPro);
export const redeemVoucherRoute = handler(redeemVoucher);
export const startTrialRoute = handler(startTrial);
export const listGivenRoute = handler(listGiven);
export const giveRoute = handler(give);
export const receivedGiftsRoute = handler(received);
export const answerGiftRoute = handler(answer);
export const myStoreCreditRoute = handler(myStoreCredit);
export const opsPricingRoute = handler(opsPricing);
export const opsSavePricingRoute = audited('pricing.save', handler(opsSavePricing));
export const opsVouchersRoute = handler(opsVouchers);
export const opsMakeVouchersRoute = audited('pro.vouchers.create', handler(opsMakeVouchers));
export const opsToggleVoucherRoute = audited('pro.vouchers.toggle', handler(opsToggleVoucher));
export const opsGrantProRoute = audited('pro.grant', handler(opsGrantPro));
export const opsFeesRoute = handler(opsFees);
export const opsRefreshFeesRoute = handler(opsRefreshFees);
export const opsWaiveFeesRoute = audited('fees.waive', handler(opsWaiveFees));

app.http('pricing', { ...anon, methods: ['GET'], route: 'pricing', handler: pricingRoute });
app.http('my-fees', { ...anon, methods: ['GET'], route: 'me/fees', handler: myFeesRoute });
app.http('my-fees-pay', { ...anon, methods: ['POST'], route: 'me/fees/pay', handler: payFeesRoute });
app.http('my-pro', { ...anon, methods: ['GET'], route: 'me/pro', handler: myProRoute });
app.http('pro-status', { ...anon, methods: ['GET'], route: 'pro/status', handler: proStatusRoute });
app.http('my-pro-buy', { ...anon, methods: ['POST'], route: 'me/pro/buy', handler: buyProRoute });
app.http('my-pro-redeem', { ...anon, methods: ['POST'], route: 'me/pro/redeem', handler: redeemVoucherRoute });
app.http('my-pro-trial', { ...anon, methods: ['POST'], route: 'me/pro/trial', handler: startTrialRoute });
app.http('my-gifts', { ...anon, methods: ['GET'], route: 'me/gifts', handler: listGivenRoute });
app.http('my-gifts-give', { ...anon, methods: ['POST'], route: 'me/gifts/give', handler: giveRoute });
app.http('my-gifts-received', { ...anon, methods: ['GET'], route: 'me/gifts/received', handler: receivedGiftsRoute });
app.http('my-gifts-answer', { ...anon, methods: ['POST'], route: 'me/gifts/{id}/answer', handler: answerGiftRoute });
app.http('my-store-credit', { ...anon, methods: ['GET'], route: 'me/store-credit', handler: myStoreCreditRoute });
app.http('ops-pricing', { ...anon, methods: ['GET'], route: 'ops/pricing', handler: opsPricingRoute });
app.http('ops-pricing-save', { ...anon, methods: ['POST'], route: 'ops/pricing/save', handler: opsSavePricingRoute });
app.http('ops-pro-vouchers', { ...anon, methods: ['GET'], route: 'ops/pro/vouchers', handler: opsVouchersRoute });
app.http('ops-pro-vouchers-make', { ...anon, methods: ['POST'], route: 'ops/pro/vouchers/make', handler: opsMakeVouchersRoute });
app.http('ops-pro-voucher-toggle', { ...anon, methods: ['POST'], route: 'ops/pro/vouchers/{code}/toggle', handler: opsToggleVoucherRoute });
app.http('ops-pro-grant', { ...anon, methods: ['POST'], route: 'ops/pro/grant', handler: opsGrantProRoute });
app.http('ops-fees', { ...anon, methods: ['GET'], route: 'ops/fees', handler: opsFeesRoute });
app.http('ops-fees-refresh', { ...anon, methods: ['POST'], route: 'ops/fees/{id}/refresh', handler: opsRefreshFeesRoute });
app.http('ops-fees-waive', { ...anon, methods: ['POST'], route: 'ops/fees/{id}/waive', handler: opsWaiveFeesRoute });
