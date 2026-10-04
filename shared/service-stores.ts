import type {
  ArtistJob, ArtistJobStatus, ArtistProfile, ForwarderProfile, FreightLane, InsurancePlan, Order, OrderAddOn,
  StoreCore, StoreMember, StoreRight, StoreStatus, User,
} from './models.js';

/**
 * Service stores: the shopfront a forwarder or an artist runs here.
 *
 * Until now a forwarder was a directory line anyone could write about
 * themselves. That was fine while the line was all there was. A store is more
 * than a line - it quotes rates a shop will plan a lot around, sells transit
 * cover to buyers, and takes other people's figures away to repaint them - so
 * it opens the way escrow does: somebody applies with their details, an
 * operator reads them, and the store goes live when it is approved.
 *
 * Both kinds share one core (name, links, contacts, team, review history) and
 * keep it on the owner's account, beside the profile the directory already
 * reads, because the database is at its container ceiling and a store is read
 * whole by the few people working it.
 *
 * Shared by the API and the app, so a button is never offered for a move the
 * server would refuse.
 */

export const STORE_KINDS = ['forwarder', 'artist'] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

export const STORE_KIND_LABELS: Record<StoreKind, { one: string; store: string; many: string }> = {
  forwarder: { one: 'Freight forwarder', store: 'Forwarding company', many: 'Freight forwarders' },
  artist: { one: 'Artist', store: 'Artist studio', many: 'Artists' },
};

/* ── Status ──────────────────────────────────────────────────────────── */

export const STORE_STATUS_LABELS: Record<StoreStatus, string> = {
  pending: 'Under review',
  changes: 'Changes requested',
  approved: 'Live',
  rejected: 'Not approved',
  suspended: 'Suspended',
};

/**
 * A store's standing. Absent means approved: every forwarder entry written
 * before stores existed was already public, and quietly taking them off the
 * directory would break lots that name them.
 */
export function statusOf(store: Pick<StoreCore, 'status'> | null | undefined): StoreStatus | null {
  if (!store) return null;
  return store.status ?? 'approved';
}

/** Open for business: listed, bookable, and able to work lots. */
export function isLive(store: Pick<StoreCore, 'status'> | null | undefined): boolean {
  return statusOf(store) === 'approved';
}

/** The owner may still edit and resubmit. */
export function canResubmit(store: Pick<StoreCore, 'status'> | null | undefined): boolean {
  const status = statusOf(store);
  return status === 'changes' || status === 'rejected' || status === 'pending';
}

/** The store of one kind on an account, whatever its state. */
export function storeOf(user: Pick<User, 'forwarderProfile' | 'artistProfile'>, kind: StoreKind): StoreCore | null {
  return (kind === 'forwarder' ? user.forwarderProfile : user.artistProfile) ?? null;
}

/* ── The team ────────────────────────────────────────────────────────── */

export const STORE_RIGHTS = ['work', 'store', 'team'] as const satisfies readonly StoreRight[];

export const STORE_RIGHT_LABELS: Record<StoreRight, { label: string; hint: string }> = {
  work: { label: 'Work the jobs', hint: 'Press the buttons on lots, accept consignments, run commissions.' },
  store: { label: 'Edit the store', hint: 'Rates, insurance, menu, photos and links.' },
  team: { label: 'Manage people', hint: 'Add and remove members. Implies the other two.' },
};

/**
 * What this viewer may do in a store. The owner holds everything, always -
 * ownership is not a grant that could be withdrawn - and `team` implies the
 * rest, the same rule `admin` follows in a seller's store.
 */
export function rightsIn(
  owner: Pick<User, 'id' | 'forwarderProfile' | 'artistProfile'>,
  kind: StoreKind,
  viewerId: string,
): StoreRight[] {
  const store = storeOf(owner, kind);
  if (!store) return [];
  if (owner.id === viewerId) return [...STORE_RIGHTS];
  const member = (store.team ?? []).find((entry) => entry.userId === viewerId);
  if (!member) return [];
  return member.rights.includes('team') ? [...STORE_RIGHTS] : [...new Set(member.rights)];
}

export function hasRight(
  owner: Pick<User, 'id' | 'forwarderProfile' | 'artistProfile'>,
  kind: StoreKind,
  viewerId: string,
  right: StoreRight,
): boolean {
  return rightsIn(owner, kind, viewerId).includes(right);
}

export function memberEntry(userId: string, displayName: string, rights: readonly StoreRight[], addedBy: string): StoreMember {
  return {
    userId,
    displayName,
    rights: [...new Set(rights.filter((right) => (STORE_RIGHTS as readonly string[]).includes(right)))],
    addedAt: new Date().toISOString(),
    addedBy,
  };
}

/* ── Freight: lanes and cover ────────────────────────────────────────── */

export const FREIGHT_MODES = ['air', 'express', 'sea', 'rail', 'road'] as const;
export type FreightMode = (typeof FREIGHT_MODES)[number];

export const FREIGHT_MODE_LABELS: Record<FreightMode, { label: string; glyph: string }> = {
  air: { label: 'Air cargo', glyph: '✈' },
  express: { label: 'Air express', glyph: '⚡' },
  sea: { label: 'Sea freight', glyph: '⚓' },
  rail: { label: 'Rail', glyph: '🚆' },
  road: { label: 'Road', glyph: '🚚' },
};

export function laneLabel(lane: Pick<FreightLane, 'originCity' | 'destinationCity'>): string {
  return `${lane.originCity || '?'} → ${lane.destinationCity || '?'}`;
}

export function transitLabel(lane: Pick<FreightLane, 'transitDaysMin' | 'transitDaysMax'>): string {
  const low = Math.max(0, lane.transitDaysMin || 0);
  const high = Math.max(low, lane.transitDaysMax || 0);
  if (!low && !high) return 'Transit on request';
  return low === high || !high ? `${low || high} days` : `${low}–${high} days`;
}

/** What a lot of this weight would cost on this lane, before customs. */
export function laneQuoteMinor(lane: Pick<FreightLane, 'ratePerKgMinor' | 'minChargeKg'>, weightGrams: number): number {
  const kg = Math.max(weightGrams / 1000, lane.minChargeKg || 0);
  return Math.round(kg * lane.ratePerKgMinor);
}

/** The live lanes, which are the ones a shop can book and the directory shows. */
export function liveLanes(profile: Pick<ForwarderProfile, 'lanes'> | null | undefined): FreightLane[] {
  return (profile?.lanes ?? []).filter((lane) => lane.active !== false);
}

export function livePlans(profile: Pick<ForwarderProfile, 'insurance'> | null | undefined): InsurancePlan[] {
  return (profile?.insurance ?? []).filter((plan) => plan.active !== false);
}

/**
 * What cover costs on an item of this value, and what it pays out.
 *
 * The premium is the plan's rate with its floor; the cover is the plan's
 * share of the value with its ceiling. Both are fixed onto the order when the
 * buyer opts in, so a plan repriced later does not move a premium already paid.
 */
export function insuranceQuote(plan: Pick<InsurancePlan, 'premiumBasisPoints' | 'minPremiumMinor' | 'coverPercent' | 'maxCoverMinor'>, valueMinor: number) {
  const value = Math.max(0, Math.round(valueMinor));
  const premiumMinor = Math.max(plan.minPremiumMinor || 0, Math.round((value * plan.premiumBasisPoints) / 10_000));
  const raw = Math.round((value * Math.min(100, Math.max(0, plan.coverPercent))) / 100);
  const coverMinor = plan.maxCoverMinor ? Math.min(plan.maxCoverMinor, raw) : raw;
  return { premiumMinor, coverMinor };
}

/* ── Money on an order, add-ons included ─────────────────────────────── */

/** Add-ons still on the order: one taken off is history, not money owed. */
export function liveAddOns(order: Pick<Order, 'addOns'>): OrderAddOn[] {
  return (order.addOns ?? []).filter((addOn) => !addOn.removedAt);
}

/** The goods alone, as the seller priced them. */
export function goodsMinor(order: Pick<Order, 'unitPriceMinor' | 'quantity'>): number {
  return order.unitPriceMinor * order.quantity;
}

/**
 * What the buyer owes on this order: the goods and any cover they opted into.
 *
 * Cover is collected with the order, through whichever way the order is paid -
 * held by an escrow or sent direct - so it rides every rule the order already
 * has (advance, balance, refund) instead of starting a second ledger. The shop
 * settles it with the forwarder alongside the freight bill.
 */
export function orderTotalMinor(order: Pick<Order, 'unitPriceMinor' | 'quantity' | 'addOns'>): number {
  return goodsMinor(order) + liveAddOns(order).reduce((sum, addOn) => sum + addOn.premiumMinor, 0);
}

/**
 * Whether cover can still be bought or dropped.
 *
 * Only before the goods have left the origin warehouse: insuring a crate once
 * it is already in the air is buying cover for a loss you may know about.
 */
export function coverIsOpen(order: Pick<Order, 'checkpoints' | 'status' | 'stage'>): boolean {
  if (!['pending_payment', 'confirmed', 'in_fulfilment'].includes(order.status)) return false;
  const ticks = order.checkpoints ?? {};
  if (ticks.china_packed || ticks.india_received || ticks.dispatched || ticks.delivered) return false;
  return order.stage === 'ordering' || order.stage === 'china_wh_received';
}

/* ── Artist commissions ─────────────────────────────────────────────── */

export const ARTIST_JOB_LABELS: Record<ArtistJobStatus, { label: string; tone: 'ok' | 'warn' | 'quiet' | 'accent' | 'danger' }> = {
  requested: { label: 'Waiting for a quote', tone: 'warn' },
  quoted: { label: 'Quote ready', tone: 'accent' },
  accepted: { label: 'Waiting for payment', tone: 'warn' },
  paid: { label: 'Paid — queued', tone: 'accent' },
  working: { label: 'In the studio', tone: 'accent' },
  ready: { label: 'Finished', tone: 'ok' },
  shipped: { label: 'On its way', tone: 'ok' },
  completed: { label: 'Complete', tone: 'ok' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'quiet' },
};

/** The order a commission moves through, for the progress strip. */
export const ARTIST_JOB_FLOW: readonly ArtistJobStatus[] = ['requested', 'quoted', 'accepted', 'paid', 'working', 'ready', 'shipped', 'completed'];

export type ArtistJobAction =
  | 'quote' | 'decline' | 'confirm_payment' | 'start' | 'ready' | 'ship'
  | 'accept' | 'pay' | 'cancel' | 'complete';

/** Which side of a commission may press which move, and from where. */
export const ARTIST_JOB_MOVES: Record<ArtistJobAction, { by: 'artist' | 'buyer'; from: readonly ArtistJobStatus[] }> = {
  quote: { by: 'artist', from: ['requested', 'quoted'] },
  decline: { by: 'artist', from: ['requested', 'quoted'] },
  confirm_payment: { by: 'artist', from: ['accepted'] },
  start: { by: 'artist', from: ['paid'] },
  ready: { by: 'artist', from: ['working'] },
  ship: { by: 'artist', from: ['ready'] },
  accept: { by: 'buyer', from: ['quoted'] },
  pay: { by: 'buyer', from: ['accepted'] },
  cancel: { by: 'buyer', from: ['requested', 'quoted', 'accepted'] },
  complete: { by: 'buyer', from: ['ready', 'shipped'] },
};

export function jobActionsFor(job: Pick<ArtistJob, 'status' | 'payments' | 'method'>, side: 'artist' | 'buyer'): ArtistJobAction[] {
  const claimed = (job.payments ?? []).some((payment) => !payment.confirmedAt);
  return (Object.keys(ARTIST_JOB_MOVES) as ArtistJobAction[]).filter((action) => {
    const move = ARTIST_JOB_MOVES[action];
    if (move.by !== side || !move.from.includes(job.status)) return false;
    // A direct payment the buyer says they sent is the artist's to confirm;
    // until then the buyer has nothing more to press, and the artist has
    // nothing to confirm without one.
    if (action === 'pay') return !claimed;
    if (action === 'confirm_payment') return claimed;
    return true;
  });
}

/** The commission's own total: the agreed price and, if held, the escrow's fee. */
export function jobDueMinor(job: Pick<ArtistJob, 'quoteMinor' | 'protectionFeeMinor'>): number {
  return (job.quoteMinor ?? 0) + (job.protectionFeeMinor ?? 0);
}

/** A live commission is one still moving - the order shows it, the item may be going to the studio. */
export function jobIsLive(job: Pick<ArtistJob, 'status'> | null | undefined): boolean {
  return Boolean(job && !['completed', 'declined', 'cancelled'].includes(job.status));
}

export function liveOfferings(profile: Pick<ArtistProfile, 'offerings'> | null | undefined) {
  return (profile?.offerings ?? []).filter((offering) => offering.active !== false);
}

/* ── Applying ────────────────────────────────────────────────────────── */

/**
 * What an application must carry before an operator will read it. Said once
 * here so the wizard's "Submit" lights up exactly when the server would take it.
 */
export function applicationGaps(kind: StoreKind, draft: Partial<StoreCore> & Partial<ForwarderProfile> & Partial<ArtistProfile>): string[] {
  const gaps: string[] = [];
  if (!draft.companyName?.trim()) gaps.push('A store name');
  if ((draft.description ?? '').trim().length < 30) gaps.push('A few lines about what you do (30+ characters)');
  if (!draft.contactPhone?.trim() && !draft.contactEmail?.trim()) gaps.push('A phone or an email');
  if (!draft.city?.trim()) gaps.push('Where you are based');
  if (kind === 'forwarder' && (draft.lanes ?? []).filter((lane) => lane.originCity && lane.destinationCity && lane.ratePerKgMinor > 0).length === 0) {
    gaps.push('At least one lane with a rate');
  }
  if (kind === 'artist' && (draft.offerings ?? []).filter((offering) => offering.name.trim()).length === 0) {
    gaps.push('At least one service on your menu');
  }
  return gaps;
}

/** A readable slug that cannot collide with another account's. */
export function storeSlug(name: string, userId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';
  return `${base}-${userId.slice(-5).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/** A short id for a lane, plan, offering or portfolio piece. */
export function partId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Accents a store can wear on its page, as the app's own hues. */
export const STORE_ACCENTS = ['violet', 'aqua', 'coral', 'lime', 'blue', 'pink'] as const;
export type StoreAccent = (typeof STORE_ACCENTS)[number];
