import { DEFAULT_AUTO_RELEASE_DAYS } from './orders.js';

/**
 * Marketplace-wide numbers the operators can change from the console.
 *
 * Stored as one site-content document under a fixed id, the same way the Learn
 * guide is, so a fresh deployment reads the defaults below until an operator
 * saves something - there is nothing to seed and nothing to migrate.
 *
 * Every fee the marketplace charges lives here, and only here: buyer
 * protection, raising a dispute, and each escalation. Community managers do
 * not set their own rates; they are paid a share of what is collected, after
 * Figmark's commission. All of it is paid through the gateway - never person
 * to person.
 */
export interface MarketSettings {
  /**
   * Days after an item leaves for the buyer before a payment held under buyer
   * protection is released to the seller on its own, if the buyer has not
   * confirmed delivery or opened a dispute in the meantime.
   */
  autoReleaseDays: number;
  /** Buyer protection, a flat amount in minor units paid on top of the order. */
  protectionFeeMinor: number;
  /** Raising a dispute (round one), in minor units. Not charged on a protected purchase. */
  disputeFeeMinor: number;
  /** The first escalation (round two), in minor units. */
  escalationFeeMinor: number;
  /** The second escalation (round three), in minor units. */
  secondEscalationFeeMinor: number;
  /** Figmark's cut of every fee above, in basis points. The rest goes to the community manager. */
  commissionBasisPoints: number;
  /** Days the other party has to answer a new dispute. */
  responseDays: number;
  /** Days a community manager has to decide a round once it is theirs. */
  decisionDays: number;
  /** Days the losing side has to escalate a decision before it is final. */
  escalationWindowDays: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export const AUTO_RELEASE_MIN_DAYS = 1;
export const AUTO_RELEASE_MAX_DAYS = 60;

/** Fees are flat amounts in minor units; the ceiling keeps a typo from charging somebody ₹1,00,000. */
export const FEE_MAX_MINOR = 10_00_000;
export const BASIS_POINTS_MAX = 5_000;
export const DAYS_MIN = 1;
export const DAYS_MAX = 30;

export const DEFAULT_SETTINGS: MarketSettings = {
  autoReleaseDays: DEFAULT_AUTO_RELEASE_DAYS,
  protectionFeeMinor: 4_900,
  disputeFeeMinor: 9_900,
  escalationFeeMinor: 19_900,
  secondEscalationFeeMinor: 29_900,
  commissionBasisPoints: 2_000,
  responseDays: 3,
  decisionDays: 5,
  escalationWindowDays: 3,
};

type Numeric = Exclude<keyof MarketSettings, 'updatedAt' | 'updatedBy'>;

/** Each number an operator may set: its range, and how the console names it. */
export const SETTING_RULES: Record<Numeric, { min: number; max: number; label: string }> = {
  autoReleaseDays: { min: AUTO_RELEASE_MIN_DAYS, max: AUTO_RELEASE_MAX_DAYS, label: 'Auto-release' },
  protectionFeeMinor: { min: 0, max: FEE_MAX_MINOR, label: 'Buyer protection fee' },
  disputeFeeMinor: { min: 0, max: FEE_MAX_MINOR, label: 'Dispute fee' },
  escalationFeeMinor: { min: 0, max: FEE_MAX_MINOR, label: 'First escalation fee' },
  secondEscalationFeeMinor: { min: 0, max: FEE_MAX_MINOR, label: 'Second escalation fee' },
  commissionBasisPoints: { min: 0, max: 10_000, label: 'Figmark commission' },
  responseDays: { min: DAYS_MIN, max: DAYS_MAX, label: 'Response window' },
  decisionDays: { min: DAYS_MIN, max: DAYS_MAX, label: 'Decision window' },
  escalationWindowDays: { min: DAYS_MIN, max: DAYS_MAX, label: 'Escalation window' },
};

/**
 * Validates settings an operator sent, or a stored copy on its way out.
 *
 * A field left out keeps its default, so a copy saved before a setting existed
 * still reads. Whole numbers only, each inside its range: a zero-day window is
 * no protection, and months of held money is no sale.
 */
export function cleanSettings(input: unknown): { settings: MarketSettings } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Settings must be an object.' };
  const raw = input as Record<string, unknown>;
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(SETTING_RULES) as Numeric[]) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
    const value = typeof raw[key] === 'string' ? Number(raw[key]) : raw[key];
    const rule = SETTING_RULES[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return { error: key === 'autoReleaseDays' ? 'Auto-release is a whole number of days.' : `${rule.label} must be a whole number.` };
    }
    if (value < rule.min || value > rule.max) {
      return {
        error: key === 'autoReleaseDays'
          ? `Auto-release must be between ${AUTO_RELEASE_MIN_DAYS} and ${AUTO_RELEASE_MAX_DAYS} days.`
          : `${rule.label} must be between ${rule.min} and ${rule.max}.`,
      };
    }
    settings[key] = value;
  }
  return { settings };
}

/** The fee for a round: raising it, or one of the two escalations. */
export function roundFeeMinor(settings: MarketSettings, round: number): number {
  if (round <= 1) return settings.disputeFeeMinor;
  if (round === 2) return settings.escalationFeeMinor;
  return settings.secondEscalationFeeMinor;
}

/** Figmark's commission out of a fee, and what is left for the community manager. */
export function splitFee(amountMinor: number, commissionBasisPoints: number): { commissionMinor: number; managerShareMinor: number } {
  const commissionMinor = Math.min(amountMinor, Math.round((amountMinor * commissionBasisPoints) / 10_000));
  return { commissionMinor, managerShareMinor: amountMinor - commissionMinor };
}
