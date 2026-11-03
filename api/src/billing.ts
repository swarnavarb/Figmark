import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PRICING, PRO_FEATURES, buildStatement, cleanPricing, feeTermsFor, gstFor, gstSplit, platformFee, proLocked,
  type FeeKind, type ProFeatureId, type FeeLine, type FeeSettlement, type FeeStatement, type FeeTerms, type Pricing,
} from '../../shared/billing.js';
import type { Order, User } from '../../shared/models.js';
import type { OrderStatus } from '../../shared/enums.js';
import { orderMoney, rupees } from '../../shared/payments.js';
import { STORE_KINDS, storeOf } from '../../shared/service-stores.js';
import { storeKey, type ServiceRequest } from '../../shared/service-work.js';
import type { getRepository } from './data/index.js';
import { mapLimit } from './data/lot-view.js';
import { notify } from './functions/notify.js';
import { recordLedgerEntry } from './community.js';

/**
 * Figmark's own money: the pricing document, platform fees on every sale, the
 * monthly statement each seller settles, and the lock on an account that has
 * not.
 *
 * A sale's fee is never written as it happens. It is worked out from the sale
 * itself - the order or the booking, and the fee terms copied onto it when it
 * was made - every time the statement is read. A refund or a cancellation
 * after the fact then takes the fee off with it, with nothing to reverse.
 * What is written is what cannot be recomputed: each settlement the seller
 * paid, and whether the account is locked.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

export const PRICING_ID = 'pricing';

/* ── The pricing document ────────────────────────────────────────────────── */

/**
 * Cached for half a minute: it is read on every order placed and every form a
 * seller opens, and a fee an operator changes is not urgent to the second. A
 * save on this worker clears it at once.
 */
let cached: { at: number; value: Pricing } | null = null;
const CACHE_MS = 30_000;

export function forgetPricing(): void {
  cached = null;
}

export async function loadPricing(repository: Repo): Promise<Pricing> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const saved = await repository.getSiteContent(PRICING_ID);
  let value: Pricing = { ...structuredClone(DEFAULT_PRICING), updatedAt: null, updatedBy: null };
  if (saved) {
    // A stored copy that no longer passes (a rule tightened since) falls back
    // to the defaults rather than to nothing.
    const cleaned = cleanPricing(saved.data);
    if (!('error' in cleaned)) value = { ...cleaned.pricing, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy };
  }
  cached = { at: Date.now(), value };
  return value;
}

export async function savePricing(repository: Repo, pricing: Pricing, by: string): Promise<Pricing> {
  const now = new Date().toISOString();
  const existing = await repository.getSiteContent(PRICING_ID);
  const { updatedAt: _at, updatedBy: _by, ...data } = pricing;
  await repository.saveSiteContent({ id: PRICING_ID, data, updatedBy: by, createdAt: existing?.createdAt ?? now, updatedAt: now });
  forgetPricing();
  return loadPricing(repository);
}

/** The fee terms a new sale by this account is made on. */
export async function termsFor(repository: Repo, kind: FeeKind, owner: User | null): Promise<FeeTerms> {
  // The account goes on the daily check's list with its first sale.
  if (owner) await noteFeeAccount(repository, owner.id, owner.sellerProfile?.storefrontName || owner.displayName).catch(() => null);
  return feeTermsFor(await loadPricing(repository), kind, owner?.pro ?? null);
}

/* ── Who has fees at all ─────────────────────────────────────────────────── */

/**
 * Every account that has made a sale with a fee on it, with where it stood
 * when last worked out - what the daily check walks and the console lists,
 * so neither reads every account on the marketplace.
 */
export const FEE_INDEX_ID = 'fee-accounts';

export interface FeeIndexEntry {
  name: string;
  owedMinor: number;
  overdueMinor: number;
  locked: boolean;
  nextDueAt: string | null;
  checkedAt: string;
  /** The month a "due soon" reminder went out for, so it goes once. */
  remindedFor?: string | null;
}

export async function loadFeeIndex(repository: Repo): Promise<Record<string, FeeIndexEntry>> {
  const saved = await repository.getSiteContent(FEE_INDEX_ID);
  const accounts = (saved?.data as { accounts?: Record<string, FeeIndexEntry> } | undefined)?.accounts;
  return accounts && typeof accounts === 'object' ? accounts : {};
}

async function writeIndex(repository: Repo, ownerId: string, entry: Partial<FeeIndexEntry> & { name: string }): Promise<void> {
  await repository.mutateSiteContent(FEE_INDEX_ID, (current) => {
    const now = new Date().toISOString();
    const accounts = { ...((current?.data as { accounts?: Record<string, FeeIndexEntry> } | undefined)?.accounts ?? {}) };
    const was = accounts[ownerId];
    accounts[ownerId] = {
      owedMinor: 0, overdueMinor: 0, locked: false, nextDueAt: null, checkedAt: now, remindedFor: null,
      ...was,
      ...entry,
    };
    return { id: FEE_INDEX_ID, data: { accounts }, updatedBy: 'system', createdAt: current?.createdAt ?? now, updatedAt: now };
  });
}

/** Puts an account on the list the first time it sells with a fee; a point read after that. */
export async function noteFeeAccount(repository: Repo, ownerId: string, name: string): Promise<void> {
  const index = await loadFeeIndex(repository);
  if (index[ownerId]) return;
  await writeIndex(repository, ownerId, { name });
}

/* ── The statement ───────────────────────────────────────────────────────── */

/** Orders that never turned into money kept: called off, turned down, or given back. */
const GONE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'cancelled', 'rejected', 'refunded', 'cancelled_reversed', 'payment_reversal_pending',
]);

/** The fee line for one order, or null when it owes nothing (yet). */
export function orderFeeLine(order: Order): FeeLine | null {
  if (!order.feeTerms || GONE.has(order.status) || order.placedAt === null) return null;
  const money = orderMoney(order);
  if (money.paidMinor <= 0) return null;
  const basis = order.quantity * order.unitPriceMinor;
  const fee = platformFee(order.feeTerms, { amountMinor: basis });
  if (fee.totalMinor <= 0) return null;
  const firstPaid = (order.payments ?? []).filter((payment) => payment.kind !== 'refund').map((payment) => payment.at).sort()[0];
  return {
    id: `o:${order.id}`,
    kind: 'shop',
    label: order.quantity > 1 ? `${order.itemName} ×${order.quantity}` : order.itemName,
    link: `/order/${order.id}`,
    at: firstPaid ?? order.placedAt ?? order.createdAt,
    basisMinor: basis,
    kg: null,
    ...fee,
    via: order.paymentMethod === 'protected' ? 'gateway' : 'direct',
  };
}

export function requestFeeLine(request: ServiceRequest): FeeLine | null {
  if (!request.feeTerms || !request.payment?.confirmedAt || request.status === 'cancelled' || request.status === 'declined') return null;
  const kg = request.bill?.chargeableKg ?? request.chargeableKg ?? null;
  const basis = request.payment.amountMinor;
  const fee = platformFee(request.feeTerms, { amountMinor: basis, kg });
  if (fee.totalMinor <= 0) return null;
  return {
    id: `r:${request.id}`,
    kind: request.kind,
    label: `${request.number} · ${request.subject?.label ?? request.title ?? 'Request'}${request.kind === 'forwarder' && kg ? ` · ${kg} kg` : ''}`,
    link: `/services/store/${request.kind}/${request.ownerId}?tab=requests&r=${request.id}`,
    at: request.payment.confirmedAt,
    basisMinor: basis,
    kg: request.kind === 'forwarder' ? kg : null,
    ...fee,
    // Customers pay a store direct; the fee is the store's to settle.
    via: 'direct',
  };
}

const SETTLEMENTS_PREFIX = 'fee-settlements-';

export async function loadSettlements(repository: Repo, ownerId: string): Promise<FeeSettlement[]> {
  const saved = await repository.getSiteContent(`${SETTLEMENTS_PREFIX}${ownerId}`);
  const list = (saved?.data as { settlements?: FeeSettlement[] } | undefined)?.settlements;
  return Array.isArray(list) ? list : [];
}

export async function feeLinesFor(repository: Repo, owner: User): Promise<FeeLine[]> {
  const kinds = STORE_KINDS.filter((kind) => storeOf(owner, kind));
  const [orders, ...requests] = await Promise.all([
    repository.listOrdersForSeller(owner.id),
    ...kinds.map((kind) => repository.listServiceWork<ServiceRequest>(storeKey(kind, owner.id), 'request', 5_000)),
  ]);
  return [
    ...orders.map(orderFeeLine),
    ...requests.flat().map(requestFeeLine),
  ].filter((line): line is FeeLine => line !== null);
}

export async function statementFor(repository: Repo, owner: User, now = Date.now()): Promise<FeeStatement> {
  const [lines, settlements, pricing] = await Promise.all([
    feeLinesFor(repository, owner),
    loadSettlements(repository, owner.id),
    loadPricing(repository),
  ]);
  return buildStatement(lines, settlements, pricing.graceDays, now);
}

/* ── The lock ────────────────────────────────────────────────────────────── */

/**
 * Brings the account's lock in line with its statement: locked while
 * anything is past due, open the moment it is paid. Locking hides every
 * listing and closes every store the account owns; unlocking puts them back.
 */
export async function syncFeeLock(repository: Repo, owner: User, statement: FeeStatement): Promise<User> {
  const shouldLock = statement.locked;
  const isLocked = Boolean(owner.feeLock);
  const now = new Date().toISOString();
  let account = owner;

  if (shouldLock !== isLocked || (shouldLock && owner.feeLock?.overdueMinor !== statement.overdueMinor)) {
    const fresh = (await repository.getUserById(owner.id)) ?? owner;
    const next: User = { ...fresh, feeLock: shouldLock ? { since: fresh.feeLock?.since ?? now, overdueMinor: statement.overdueMinor } : null };
    for (const kind of STORE_KINDS) {
      const store = storeOf(next, kind);
      if (!store) continue;
      const held = { ...store, feeHold: shouldLock };
      if (kind === 'forwarder') next.forwarderProfile = held as typeof next.forwarderProfile;
      else next.artistProfile = held as typeof next.artistProfile;
    }
    account = await repository.updateUser(next);
  }

  if (shouldLock !== isLocked) {
    const listings = await repository.listListings({ sellerId: owner.id, includeHidden: true, limit: 10_000 });
    const change = listings.filter((listing) => Boolean(listing.feeHold) !== shouldLock && (shouldLock ? listing.status !== 'archived' : true));
    await mapLimit(change, 8, (listing) => repository.updateListing({ ...listing, feeHold: shouldLock }));
    await notify(repository, [owner.id], shouldLock
      ? {
        kind: 'platform_fees',
        title: `Your shop is paused: ${rupees(statement.overdueMinor)} in platform fees is overdue`,
        body: 'Nobody can see your listings or book your services until it is paid. Pay it now and everything comes back at once.',
        link: '/fees',
      }
      : {
        kind: 'platform_fees',
        title: 'Platform fees paid - your shop is open again',
        body: 'Your listings and services are back where buyers can see them.',
        link: '/fees',
      });
  }

  await writeIndex(repository, owner.id, {
    name: owner.sellerProfile?.storefrontName || owner.displayName,
    owedMinor: statement.owedMinor,
    overdueMinor: statement.overdueMinor,
    locked: shouldLock,
    nextDueAt: statement.nextDueAt,
    checkedAt: now,
  });
  return account;
}

/** Works the statement out and applies its lock: what the seller's page and every payment run. */
export async function refreshFees(repository: Repo, owner: User, now = Date.now()): Promise<{ statement: FeeStatement; owner: User }> {
  const statement = await statementFor(repository, owner, now);
  const account = await syncFeeLock(repository, owner, statement);
  return { statement, owner: account };
}

/* ── Paying ──────────────────────────────────────────────────────────────── */

/**
 * The seller pays what they owe through the gateway (simulated until a live
 * one is wired, like every other charge here). Recorded twice: against the
 * account, which clears its months oldest first, and in Figmark's ledger.
 */
export async function settleFees(
  repository: Repo, owner: User, amountMinor: number, by: string, options: { waived?: boolean; note?: string | null } = {},
): Promise<FeeSettlement> {
  const now = new Date().toISOString();
  const settlement: FeeSettlement = {
    id: `fs_${randomUUID().slice(0, 12)}`,
    at: now,
    amountMinor,
    gatewayRef: options.waived ? null : `gw_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    by,
    ...(options.waived ? { waived: true } : {}),
    note: options.note ?? null,
  };
  await repository.mutateSiteContent(`${SETTLEMENTS_PREFIX}${owner.id}`, (current) => {
    const list = (current?.data as { settlements?: FeeSettlement[] } | undefined)?.settlements ?? [];
    return {
      id: `${SETTLEMENTS_PREFIX}${owner.id}`,
      data: { settlements: [...list, settlement] },
      updatedBy: by,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
  });
  if (!options.waived) {
    const pricing = await loadPricing(repository);
    // The statement already holds the GST it charged; the ledger keeps the share.
    const gst = gstFor(pricing.gst, 'platform');
    const split = gst?.mode === 'exclusive'
      ? { gstMinor: Math.round((amountMinor * gst.rateBp) / (10_000 + gst.rateBp)) }
      : gstSplit(gst, amountMinor);
    await recordEarning(repository, {
      kind: 'platform', payerId: owner.id, amountMinor, gstMinor: split.gstMinor, reference: `fees:${owner.id}`, gatewayRef: settlement.gatewayRef!,
    });
  }
  return settlement;
}

/**
 * Figmark's own earnings - a platform fee, Pro - written to the same ledger
 * as the dispute and protection fees, all of it Figmark's (no manager share).
 */
export async function recordEarning(
  repository: Repo,
  entry: { kind: 'platform' | 'pro'; payerId: string; amountMinor: number; gstMinor: number; reference: string; gatewayRef: string },
): Promise<void> {
  const paidAt = new Date().toISOString();
  await recordLedgerEntry(repository, {
    id: `fee_${randomUUID().slice(0, 12)}`,
    kind: entry.kind,
    payerId: entry.payerId,
    amountMinor: entry.amountMinor,
    currency: 'INR',
    commissionMinor: entry.amountMinor - entry.gstMinor,
    managerShareMinor: 0,
    gstMinor: entry.gstMinor,
    gatewayRef: entry.gatewayRef,
    paidAt,
    reference: entry.reference,
    managerId: null,
  });
}

/** The fee on a protected order, taken from the money as the gateway releases it. */
export async function takeFeeOnRelease(repository: Repo, order: Order): Promise<number> {
  const line = orderFeeLine(order);
  if (!line || line.via !== 'gateway') return 0;
  await recordEarning(repository, {
    kind: 'platform', payerId: order.sellerId, amountMinor: line.totalMinor, gstMinor: line.gstMinor,
    reference: order.id, gatewayRef: `gw_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
  });
  return line.totalMinor;
}

/* ── The daily check ─────────────────────────────────────────────────────── */

const DAY = 86_400_000;

/**
 * Every account with fees, once a day: lock what is overdue, open what was
 * paid, and remind anybody whose month falls due within three days.
 */
export async function sweepFees(repository: Repo, now = Date.now()): Promise<number> {
  const index = await loadFeeIndex(repository);
  let changed = 0;
  await mapLimit(Object.keys(index), 4, async (ownerId) => {
    const owner = await repository.getUserById(ownerId);
    if (!owner) return;
    const wasLocked = Boolean(owner.feeLock);
    const { statement } = await refreshFees(repository, owner, now);
    if (statement.locked !== wasLocked) changed += 1;
    const month = statement.nextDueAt;
    if (month && !statement.locked && statement.owedMinor > 0
      && Date.parse(month) - now < 3 * DAY && index[ownerId]?.remindedFor !== month) {
      await notify(repository, [ownerId], {
        kind: 'platform_fees',
        title: `${rupees(statement.owedMinor)} in platform fees is due soon`,
        body: `Pay it before ${new Date(month).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} to keep your shop open.`,
        link: '/fees',
      });
      await writeIndex(repository, ownerId, { name: index[ownerId]!.name, remindedFor: month });
    }
  });
  return changed;
}

/* ── Store credit a store gave ───────────────────────────────────────────── */

/**
 * Spends this person's credit at one store, oldest first, up to `owing`.
 * Saves the person; returns what was spent.
 */
export async function spendStoreCredit(
  repository: Repo, userId: string, storeId: string, owing: number, spend: { orderId: string; itemName: string },
): Promise<number> {
  if (owing <= 0) return 0;
  const person = await repository.getUserById(userId);
  const credits = person?.storeCredits ?? [];
  if (!person || !credits.some((credit) => credit.storeId === storeId && credit.amountMinor > credit.spentMinor)) return 0;
  const at = new Date().toISOString();
  let left = owing;
  let spent = 0;
  const next = [...credits].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((credit) => {
    if (left <= 0 || credit.storeId !== storeId) return credit;
    const take = Math.min(Math.max(0, credit.amountMinor - credit.spentMinor), left);
    if (take <= 0) return credit;
    left -= take;
    spent += take;
    return { ...credit, spentMinor: credit.spentMinor + take, spends: [...credit.spends, { ...spend, amountMinor: take, at }] };
  });
  if (spent > 0) await repository.updateUser({ ...person, storeCredits: next });
  return spent;
}

/* ── Pro, enforced ───────────────────────────────────────────────────────── */

/**
 * Why a Pro tool is shut for this shop, as an HTTP refusal, or null when it
 * is open. Checked by the server as well as hidden by the app: a locked box
 * is a request away from being opened otherwise.
 */
export async function proRefusal(
  repository: Repo, shopOwnerId: string, feature: ProFeatureId,
): Promise<{ status: number; jsonBody: { error: string; message: string } } | null> {
  const [owner, pricing] = await Promise.all([repository.getUserById(shopOwnerId), loadPricing(repository)]);
  if (!proLocked(feature, pricing.pro, owner?.pro ?? null)) return null;
  const title = PRO_FEATURES.find((entry) => entry.id === feature)?.title ?? 'This';
  return { status: 402, jsonBody: { error: 'pro_required', message: `${title} is part of Pro. Subscribe to Pro to unlock it.` } };
}
