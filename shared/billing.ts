/**
 * How Figmark earns, and what a seller owes it.
 *
 * - **Platform fee** on every sale a shop or an artist makes, and per
 *   chargeable kg on every forwarder booking. Charged whether the buyer paid
 *   through the gateway (taken there, at once) or direct to the seller (owed,
 *   settled monthly through the gateway).
 * - **GST**, optional, on what Figmark itself charges: switched on, rated and
 *   scoped by the operators, included in the price or added on top.
 * - **Pro**, a subscription for 3, 6 or 12 months, or a voucher, that unlocks
 *   the Pro tools, may lower the platform fee for a while and gives bump points.
 *
 * All of it is set in one document the operators edit (`pricing`), read by
 * the API and the app alike so a fee the seller is shown while listing is the
 * fee they are charged.
 *
 * Money in minor units, percentages in basis points (1% = 100).
 */

/* ── Platform fee ────────────────────────────────────────────────────────── */

export const FEE_MODES = ['percent', 'flat'] as const;
export type FeeMode = (typeof FEE_MODES)[number];

/**
 * One price band: up to `upToMinor` (inclusive; null for "and above") the fee
 * is a percentage (`value` in basis points) or a flat amount (`value` in minor
 * units, never more than the price itself).
 */
export interface FeeBand {
  upToMinor: number | null;
  mode: FeeMode;
  value: number;
}

/** What a sale is charged as: a shop's item, an artist's work, or a forwarder's booking. */
export const FEE_KINDS = ['shop', 'artist', 'forwarder'] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

export const FEE_KIND_LABELS: Record<FeeKind, string> = {
  shop: 'Shop sales',
  artist: 'Artist work',
  forwarder: 'Freight forwarding',
};

export interface PlatformFees {
  shop: FeeBand[];
  artist: FeeBand[];
  /** Per chargeable kg on a forwarder's booking. */
  forwarderPerKgMinor: number;
}

/* ── GST ─────────────────────────────────────────────────────────────────── */

/** What Figmark charges that GST may apply to. */
export const GST_SCOPES = ['platform', 'protection', 'disputes', 'pro'] as const;
export type GstScope = (typeof GST_SCOPES)[number];

export const GST_SCOPE_LABELS: Record<GstScope, string> = {
  platform: 'Platform fees (sales, artist work, freight per kg)',
  protection: 'Buyer protection fee',
  disputes: 'Dispute and escalation fees',
  pro: 'Pro subscriptions',
};

export type GstMode = 'inclusive' | 'exclusive';

export interface GstSettings {
  /** Off until Figmark is registered: an unregistered business must not collect GST. */
  enabled: boolean;
  /** 18% is 1800. */
  rateBp: number;
  /** `inclusive` - the price already holds the tax. `exclusive` - the tax goes on top. */
  mode: GstMode;
  /** Shown on receipts once set. */
  gstin: string;
  applyTo: Record<GstScope, boolean>;
}

/** The GST that applies to one charge, or null. */
export type GstTerms = { rateBp: number; mode: GstMode } | null;

export function gstFor(gst: GstSettings, scope: GstScope): GstTerms {
  return gst.enabled && gst.applyTo[scope] && gst.rateBp > 0 ? { rateBp: gst.rateBp, mode: gst.mode } : null;
}

/**
 * Splits a charge into what it is for and the tax on it. Inclusive keeps the
 * total and carves the tax out of it; exclusive adds the tax on top.
 */
export function gstSplit(terms: GstTerms, amountMinor: number): { baseMinor: number; gstMinor: number; totalMinor: number } {
  if (!terms || amountMinor <= 0) return { baseMinor: Math.max(0, amountMinor), gstMinor: 0, totalMinor: Math.max(0, amountMinor) };
  if (terms.mode === 'inclusive') {
    const gstMinor = Math.round((amountMinor * terms.rateBp) / (10_000 + terms.rateBp));
    return { baseMinor: amountMinor - gstMinor, gstMinor, totalMinor: amountMinor };
  }
  const gstMinor = Math.round((amountMinor * terms.rateBp) / 10_000);
  return { baseMinor: amountMinor, gstMinor, totalMinor: amountMinor + gstMinor };
}

/* ── Pro ─────────────────────────────────────────────────────────────────── */

export const PRO_MONTHS = [3, 6, 12] as const;
export type ProMonths = (typeof PRO_MONTHS)[number];

export interface ProPlan {
  months: ProMonths;
  priceMinor: number;
  /** Bump points added to the shop when bought. */
  bumpPoints: number;
  enabled: boolean;
}

/** Every tool Pro unlocks, as the subscribe page lists it and a locked box names it. */
export const PRO_FEATURES = [
  {
    id: 'insights', icon: '✨', title: 'Insights',
    line: 'This week against last, retention, customer value, price changes and the next-lot forecast.',
  },
  {
    id: 'calculator', icon: '🧮', title: 'Profit calculator',
    line: 'Price abroad in, profit out - with your own rates, saved calculators and the floating calculator.',
  },
  {
    id: 'costs', icon: '🧾', title: 'Item cost sheets',
    line: 'What each item really cost you, step by step, so the profit book shows real profit.',
  },
  {
    id: 'customers', icon: '🎯', title: 'Customer signals & messaging',
    line: 'Who saved, pledged or wants what, what they might buy next, and messaging the ones you pick.',
  },
  {
    id: 'powerSale', icon: '⚡', title: 'Power sales & exclusive drops',
    line: 'Timed drops for your followers, with quick fill and power templates.',
  },
] as const;
export type ProFeatureId = (typeof PRO_FEATURES)[number]['id'];
export const PRO_FEATURE_IDS = PRO_FEATURES.map((feature) => feature.id) as ProFeatureId[];

export interface ProSettings {
  /** Off: every tool is open to every shop, as before Pro was sold. */
  enabled: boolean;
  plans: ProPlan[];
  /** Off the platform fee while it lasts, in basis points of the fee (2500 = a quarter off). */
  feeDiscountBp: number;
  /** How long the lower fee lasts after each purchase; 0 for the whole subscription. */
  feeDiscountDays: number;
  /** Free Pro days a shop gets the first time it opens. 0 for none. */
  trialDays: number;
  /** Which tools are Pro. A tool switched off here is free for everybody. */
  features: Record<ProFeatureId, boolean>;
}

/** One stretch of Pro an account was given. */
export interface ProGrant {
  id: string;
  at: string;
  source: 'purchase' | 'voucher' | 'admin' | 'trial';
  days: number;
  months?: number | null;
  code?: string | null;
  amountMinor?: number;
  gstMinor?: number;
  gatewayRef?: string | null;
  bumpPoints?: number;
  by: string;
}

/** Kept on the account: every store the account owns is Pro while it lasts. */
export interface ProState {
  until: string | null;
  /** The lower platform fee lasts until this moment. */
  discountUntil?: string | null;
  /** Whether the free trial was used. */
  trialUsed?: boolean;
  history: ProGrant[];
}

export function isProActive(pro: Pick<ProState, 'until'> | null | undefined, now = Date.now()): boolean {
  return Boolean(pro?.until && Date.parse(pro.until) > now);
}

export function proDaysLeft(pro: Pick<ProState, 'until'> | null | undefined, now = Date.now()): number {
  if (!pro?.until) return 0;
  return Math.max(0, Math.ceil((Date.parse(pro.until) - now) / 86_400_000));
}

/** The discount off the platform fee this account has right now, in basis points. */
export function feeDiscountBp(pro: ProState | null | undefined, settings: ProSettings, now = Date.now()): number {
  if (!settings.enabled || settings.feeDiscountBp <= 0 || !isProActive(pro, now)) return 0;
  // Only a purchase starts the lower fee (see extendPro): days from a voucher
  // or an operator open the tools, not a cheaper fee.
  const until = pro?.discountUntil;
  return until && Date.parse(until) > now ? settings.feeDiscountBp : 0;
}

/** Whether this tool is shut for this account. */
export function proLocked(feature: ProFeatureId, settings: ProSettings, pro: ProState | null | undefined, now = Date.now()): boolean {
  return settings.enabled && settings.features[feature] !== false && !isProActive(pro, now);
}

const DAY = 86_400_000;

/** Adds days onto what is left, or onto now when nothing is. */
export function extendPro(pro: ProState | null | undefined, days: number, grant: ProGrant, settings: ProSettings, now = Date.now()): ProState {
  const from = Math.max(now, pro?.until ? Date.parse(pro.until) : 0);
  const until = new Date(from + days * DAY).toISOString();
  // A purchase starts (or extends) the lower fee; a voucher or a gift of days
  // carries whatever lower fee there was, without starting one.
  let discountUntil = pro?.discountUntil ?? null;
  if (grant.source === 'purchase') {
    discountUntil = settings.feeDiscountDays > 0
      ? new Date(Math.max(now, discountUntil ? Date.parse(discountUntil) : 0) + settings.feeDiscountDays * DAY).toISOString()
      : until;
  }
  return {
    until,
    discountUntil,
    trialUsed: pro?.trialUsed || grant.source === 'trial',
    history: [...(pro?.history ?? []), grant].slice(-50),
  };
}

export const daysForMonths = (months: number) => Math.round(months * 30.44);

/** A code an operator made, good for some days of Pro. */
export interface ProVoucher {
  code: string;
  days: number;
  /** How many accounts may use it. */
  maxUses: number;
  expiresAt: string | null;
  disabled: boolean;
  note: string;
  createdAt: string;
  createdBy: string;
  redeemed: { userId: string; name: string; at: string }[];
}

export function voucherProblem(voucher: ProVoucher | undefined, userId: string, now = Date.now()): string | null {
  if (!voucher) return 'That code does not exist.';
  if (voucher.disabled) return 'That code has been switched off.';
  if (voucher.expiresAt && Date.parse(voucher.expiresAt) <= now) return 'That code has expired.';
  if (voucher.redeemed.some((entry) => entry.userId === userId)) return 'You have already used that code.';
  if (voucher.redeemed.length >= voucher.maxUses) return 'That code has been used up.';
  return null;
}

export const cleanVoucherCode = (raw: unknown) =>
  typeof raw === 'string' ? raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32) : '';

/* ── The document ────────────────────────────────────────────────────────── */

export interface Pricing {
  fees: PlatformFees;
  /** Days into the next month a month's direct-sale fees may still be paid before the account locks. */
  graceDays: number;
  gst: GstSettings;
  pro: ProSettings;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export const DEFAULT_PRICING: Pricing = {
  fees: {
    shop: [
      { upToMinor: 50_000, mode: 'flat', value: 1_000 },
      { upToMinor: null, mode: 'percent', value: 300 },
    ],
    artist: [{ upToMinor: null, mode: 'percent', value: 500 }],
    forwarderPerKgMinor: 1_000,
  },
  graceDays: 7,
  gst: {
    enabled: false,
    rateBp: 1_800,
    mode: 'exclusive',
    gstin: '',
    applyTo: { platform: true, protection: true, disputes: true, pro: true },
  },
  pro: {
    enabled: true,
    plans: [
      { months: 3, priceMinor: 49_900, bumpPoints: 5, enabled: true },
      { months: 6, priceMinor: 89_900, bumpPoints: 12, enabled: true },
      { months: 12, priceMinor: 1_59_900, bumpPoints: 30, enabled: true },
    ],
    feeDiscountBp: 2_500,
    feeDiscountDays: 30,
    trialDays: 0,
    features: { insights: true, calculator: true, costs: true, customers: true, powerSale: true },
  },
};

export const PRICE_MAX_MINOR = 1_00_00_000;
const int = (value: unknown): number | null => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) ? number : null;
};

function cleanBands(raw: unknown, label: string): { feeBands: FeeBand[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: `${label}: add at least one band.` };
  if (raw.length > 8) return { error: `${label}: eight price tiers at most.` };
  const feeBands: FeeBand[] = [];
  for (const [index, entry] of raw.entries()) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const last = index === raw.length - 1;
    const mode = row.mode === 'flat' ? 'flat' : row.mode === 'percent' ? 'percent' : null;
    const value = int(row.value);
    const upTo = last ? null : int(row.upToMinor);
    if (!mode) return { error: `${label}: each band is a percentage or a flat fee.` };
    if (value === null || value < 0) return { error: `${label}: each fee is a whole number, zero or more.` };
    if (mode === 'percent' && value > 5_000) return { error: `${label}: a percentage fee is 50% at most.` };
    if (mode === 'flat' && value > PRICE_MAX_MINOR) return { error: `${label}: that flat fee is too large.` };
    if (!last) {
      if (upTo === null || upTo <= 0) return { error: `${label}: every band but the last needs an upper price.` };
      const previous = feeBands[feeBands.length - 1]?.upToMinor ?? 0;
      if (upTo <= previous) return { error: `${label}: each price band starts above the one before it.` };
    }
    feeBands.push({ upToMinor: upTo, mode, value });
  }
  return { feeBands };
}

/** Checks a pricing document an operator sent, or a stored one on its way out. */
export function cleanPricing(input: unknown): { pricing: Pricing } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Pricing must be an object.' };
  const raw = input as Record<string, unknown>;
  const pricing: Pricing = JSON.parse(JSON.stringify(DEFAULT_PRICING)) as Pricing;

  const fees = (raw.fees ?? {}) as Record<string, unknown>;
  for (const kind of ['shop', 'artist'] as const) {
    if (fees[kind] === undefined) continue;
    const cleaned = cleanBands(fees[kind], FEE_KIND_LABELS[kind]);
    if ('error' in cleaned) return cleaned;
    pricing.fees[kind] = cleaned.feeBands;
  }
  if (fees.forwarderPerKgMinor !== undefined) {
    const value = int(fees.forwarderPerKgMinor);
    if (value === null || value < 0 || value > 1_00_000) return { error: 'The per-kg fee must be between ₹0 and ₹1,000.' };
    pricing.fees.forwarderPerKgMinor = value;
  }
  if (raw.graceDays !== undefined) {
    const value = int(raw.graceDays);
    if (value === null || value < 0 || value > 28) return { error: 'The grace period is 0 to 28 days.' };
    pricing.graceDays = value;
  }

  const gst = (raw.gst ?? {}) as Record<string, unknown>;
  if (gst.enabled !== undefined) pricing.gst.enabled = gst.enabled === true;
  if (gst.rateBp !== undefined) {
    const value = int(gst.rateBp);
    if (value === null || value < 0 || value > 4_000) return { error: 'GST is 0% to 40%.' };
    pricing.gst.rateBp = value;
  }
  if (gst.mode !== undefined) pricing.gst.mode = gst.mode === 'inclusive' ? 'inclusive' : 'exclusive';
  if (gst.gstin !== undefined) {
    const gstin = typeof gst.gstin === 'string' ? gst.gstin.trim().toUpperCase() : '';
    if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) return { error: 'A GSTIN is 15 characters: two digits, then letters and numbers.' };
    pricing.gst.gstin = gstin;
  }
  const scopes = (gst.applyTo ?? {}) as Record<string, unknown>;
  for (const scope of GST_SCOPES) if (scopes[scope] !== undefined) pricing.gst.applyTo[scope] = scopes[scope] === true;

  const pro = (raw.pro ?? {}) as Record<string, unknown>;
  if (pro.enabled !== undefined) pricing.pro.enabled = pro.enabled === true;
  if (pro.plans !== undefined) {
    if (!Array.isArray(pro.plans)) return { error: 'Plans must be a list.' };
    const plans: ProPlan[] = [];
    for (const months of PRO_MONTHS) {
      const row = (pro.plans as Record<string, unknown>[]).find((entry) => int(entry?.months) === months);
      const fallback = DEFAULT_PRICING.pro.plans.find((plan) => plan.months === months)!;
      if (!row) {
        plans.push({ ...fallback });
        continue;
      }
      const price = int(row.priceMinor);
      const bumps = int(row.bumpPoints);
      if (price === null || price < 0 || price > PRICE_MAX_MINOR) return { error: `The ${months}-month price is not a valid amount.` };
      if (bumps === null || bumps < 0 || bumps > 1_000) return { error: `Bump points for ${months} months are 0 to 1,000.` };
      plans.push({ months, priceMinor: price, bumpPoints: bumps, enabled: row.enabled !== false });
    }
    pricing.pro.plans = plans;
  }
  if (pro.feeDiscountBp !== undefined) {
    const value = int(pro.feeDiscountBp);
    if (value === null || value < 0 || value > 10_000) return { error: 'The Pro fee discount is 0% to 100% of the fee.' };
    pricing.pro.feeDiscountBp = value;
  }
  if (pro.feeDiscountDays !== undefined) {
    const value = int(pro.feeDiscountDays);
    if (value === null || value < 0 || value > 366) return { error: 'The lower fee lasts 0 to 366 days.' };
    pricing.pro.feeDiscountDays = value;
  }
  if (pro.trialDays !== undefined) {
    const value = int(pro.trialDays);
    if (value === null || value < 0 || value > 90) return { error: 'The free trial is 0 to 90 days.' };
    pricing.pro.trialDays = value;
  }
  const features = (pro.features ?? {}) as Record<string, unknown>;
  for (const id of PRO_FEATURE_IDS) if (features[id] !== undefined) pricing.pro.features[id] = features[id] !== false;

  return { pricing };
}

/* ── Fee terms, fixed on each sale ───────────────────────────────────────── */

/**
 * The fee as agreed when a sale was made: copied onto the order or the
 * booking, so a later change of rate never moves what a past sale owes.
 */
export interface FeeTerms {
  kind: FeeKind;
  feeBands?: FeeBand[];
  perKgMinor?: number;
  /** Pro's lower fee, in basis points off the fee. */
  discountBp: number;
  gst: GstTerms;
  at: string;
}

export function feeTermsFor(pricing: Pricing, kind: FeeKind, pro: ProState | null | undefined, now = Date.now()): FeeTerms {
  return {
    kind,
    ...(kind === 'forwarder' ? { perKgMinor: pricing.fees.forwarderPerKgMinor } : { feeBands: pricing.fees[kind] }),
    discountBp: feeDiscountBp(pro, pricing.pro, now),
    gst: gstFor(pricing.gst, 'platform'),
    at: new Date(now).toISOString(),
  };
}

export function bandFor(feeBands: readonly FeeBand[], amountMinor: number): FeeBand | null {
  return feeBands.find((band) => band.upToMinor === null || amountMinor <= band.upToMinor) ?? feeBands[feeBands.length - 1] ?? null;
}

/** The platform fee on one sale, after any Pro discount, and the GST on it. */
export function platformFee(
  terms: FeeTerms,
  basis: { amountMinor: number; kg?: number | null },
): { feeMinor: number; gstMinor: number; totalMinor: number; beforeDiscountMinor: number } {
  let fee = 0;
  if (terms.kind === 'forwarder') {
    fee = Math.round((terms.perKgMinor ?? 0) * Math.max(0, basis.kg ?? 0));
  } else {
    const band = bandFor(terms.feeBands ?? [], basis.amountMinor);
    if (band) fee = band.mode === 'percent' ? Math.round((basis.amountMinor * band.value) / 10_000) : Math.min(band.value, basis.amountMinor);
  }
  const beforeDiscountMinor = Math.max(0, fee);
  const discounted = Math.max(0, Math.round(beforeDiscountMinor * (1 - terms.discountBp / 10_000)));
  const split = gstSplit(terms.gst, discounted);
  return { feeMinor: split.baseMinor, gstMinor: split.gstMinor, totalMinor: split.totalMinor, beforeDiscountMinor };
}

/** "3%", "₹10 flat", "₹10 per kg" - a band in words, for a hint under a price. */
export function bandWords(band: FeeBand, money: (minor: number) => string): string {
  return band.mode === 'percent' ? `${(band.value / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%` : `${money(band.value)} flat`;
}

/* ── The monthly statement ───────────────────────────────────────────────── */

/** One sale's fee, as the statement lists it. */
export interface FeeLine {
  id: string;
  kind: FeeKind;
  /** What it was for: an item, a booking. */
  label: string;
  link: string;
  /** When the money for it arrived: the month it belongs to. */
  at: string;
  basisMinor: number;
  kg: number | null;
  feeMinor: number;
  gstMinor: number;
  totalMinor: number;
  /** `gateway` - taken from the payment as it passed through. `direct` - owed by the seller. */
  via: 'gateway' | 'direct';
}

export interface FeeSettlement {
  id: string;
  at: string;
  amountMinor: number;
  gatewayRef: string | null;
  by: string;
  /** An operator wrote the amount off instead of it being paid. */
  waived?: boolean;
  note?: string | null;
}

export interface FeeMonth {
  month: string;
  dueAt: string;
  directMinor: number;
  gatewayMinor: number;
  gstMinor: number;
  sales: number;
}

export interface FeeStatement {
  lines: FeeLine[];
  months: FeeMonth[];
  settlements: FeeSettlement[];
  /** Everything owed on direct sales, less what was paid. */
  owedMinor: number;
  /** The part of it past its due date: the account is locked while this is above zero. */
  overdueMinor: number;
  /** When the oldest unpaid month falls due. */
  nextDueAt: string | null;
  locked: boolean;
  graceDays: number;
}

/** Months are India's: a sale at 1 am on the 1st belongs to that month, not the last. */
const IST = 330 * 60_000;
export const feeMonthOf = (at: string) => new Date(Date.parse(at) + IST).toISOString().slice(0, 7);

/** A month's fees fall due on day `graceDays` of the next month (India time). */
export function monthDueAt(month: string, graceDays: number): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, mon, 1 + graceDays) - IST).toISOString();
}

export function buildStatement(lines: FeeLine[], settlements: FeeSettlement[], graceDays: number, now = Date.now()): FeeStatement {
  const byMonth = new Map<string, FeeMonth>();
  for (const line of lines) {
    const month = feeMonthOf(line.at);
    const row = byMonth.get(month) ?? { month, dueAt: monthDueAt(month, graceDays), directMinor: 0, gatewayMinor: 0, gstMinor: 0, sales: 0 };
    if (line.via === 'direct') row.directMinor += line.totalMinor;
    else row.gatewayMinor += line.totalMinor;
    row.gstMinor += line.gstMinor;
    row.sales += 1;
    byMonth.set(month, row);
  }
  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  const paid = settlements.reduce((sum, entry) => sum + entry.amountMinor, 0);
  const owedTotal = months.reduce((sum, month) => sum + month.directMinor, 0);
  // Payments go to the oldest month first.
  let left = paid;
  let overdue = 0;
  let nextDueAt: string | null = null;
  for (const month of [...months].reverse()) {
    const take = Math.min(left, month.directMinor);
    left -= take;
    const unpaid = month.directMinor - take;
    if (unpaid <= 0) continue;
    if (Date.parse(month.dueAt) <= now) overdue += unpaid;
    else if (!nextDueAt) nextDueAt = month.dueAt;
  }
  return {
    lines: [...lines].sort((a, b) => b.at.localeCompare(a.at)),
    months,
    settlements: [...settlements].sort((a, b) => b.at.localeCompare(a.at)),
    owedMinor: Math.max(0, owedTotal - paid),
    overdueMinor: overdue,
    nextDueAt,
    locked: overdue > 0,
    graceDays,
  };
}

/* ── Paying or crediting anybody ─────────────────────────────────────────── */

/** A shop, a forwarder or an artist: whoever gives the money. */
export const GIVER_KINDS = ['shop', 'forwarder', 'artist'] as const;
export type GiverKind = (typeof GIVER_KINDS)[number];

/**
 * Where store credit can be spent: the shop's own id for a shop (as credit
 * won in games always was), `kind:ownerId` for a forwarder or an artist.
 */
export const creditStoreId = (kind: GiverKind, ownerId: string) => (kind === 'shop' ? ownerId : `${kind}:${ownerId}`);

export const GIFT_METHODS = ['direct', 'gateway', 'credit'] as const;
export type GiftMethod = (typeof GIFT_METHODS)[number];

export const GIFT_METHOD_LABELS: Record<GiftMethod, string> = {
  direct: 'Paid directly (UPI, bank)',
  gateway: 'Through the payment gateway',
  credit: 'As store credit',
};

/** Money a store sent or credited to somebody, refund or goodwill. */
export interface StoreGift {
  id: string;
  at: string;
  giverKind: GiverKind;
  ownerId: string;
  storeName: string;
  recipientId: string;
  recipientName: string;
  amountMinor: number;
  method: GiftMethod;
  /** Refund, goodwill, compensation… in the store's words. */
  reason: string;
  /** The UPI or bank reference for a direct payment. */
  reference: string | null;
  gatewayRef: string | null;
  orderId: string | null;
  by: string;
  byName: string;
  /** Direct payments wait on the person saying it arrived. */
  status: 'sent' | 'received' | 'not_received' | 'credited';
  answeredAt: string | null;
}
