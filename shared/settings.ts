import { DEFAULT_AUTO_RELEASE_DAYS } from './orders.js';

/**
 * Marketplace-wide numbers the operators can change from the console.
 *
 * Stored as one site-content document under a fixed id, the same way the Learn
 * guide is, so a fresh deployment reads the defaults below until an operator
 * saves something - there is nothing to seed and nothing to migrate.
 */
export interface MarketSettings {
  /**
   * Days after an item leaves for the buyer before a payment held under buyer
   * protection is released to the seller on its own, if the buyer has not
   * confirmed delivery or opened a dispute in the meantime.
   */
  autoReleaseDays: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export const AUTO_RELEASE_MIN_DAYS = 1;
export const AUTO_RELEASE_MAX_DAYS = 60;

export const DEFAULT_SETTINGS: MarketSettings = {
  autoReleaseDays: DEFAULT_AUTO_RELEASE_DAYS,
};

/**
 * Validates settings an operator sent, or a stored copy on its way out.
 *
 * Whole days only, inside a range that keeps protection meaningful: a
 * zero-day window is no protection, and months of held money is no sale.
 */
export function cleanSettings(input: unknown): { settings: MarketSettings } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Settings must be an object.' };
  const raw = (input as { autoReleaseDays?: unknown }).autoReleaseDays;
  const days = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof days !== 'number' || !Number.isInteger(days)) {
    return { error: 'Auto-release is a whole number of days.' };
  }
  if (days < AUTO_RELEASE_MIN_DAYS || days > AUTO_RELEASE_MAX_DAYS) {
    return { error: `Auto-release must be between ${AUTO_RELEASE_MIN_DAYS} and ${AUTO_RELEASE_MAX_DAYS} days.` };
  }
  return { settings: { autoReleaseDays: days } };
}
