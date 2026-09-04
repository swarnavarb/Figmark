import type { Capability } from './enums.js';
import type { User } from './models.js';

/**
 * What an account may currently do.
 *
 * Derived, never stored (except `isAdmin`, which is a real assigned role). One
 * account is both buyer and seller, so these are independent switches rather
 * than mutually exclusive states: a user can be able to buy but not yet to
 * sell, or both at once.
 */
export interface UserCapabilities {
  /** Browsing is always open; buying needs a verified phone. */
  canBuy: boolean;
  /** Listing needs the same bar as buying - the seller tier gates the rest. */
  canSell: boolean;
  /** Quoting on lots and appearing in the directory. */
  canForward: boolean;
  isAdmin: boolean;
}

/**
 * The minimum bar to transact at all. Deliberately low: the spec's model is
 * light friction at signup, with the heavier ID and bank checks deferred to the
 * point where they actually matter (payouts, high-value listings).
 */
function isTransactable(user: User): boolean {
  return !user.suspended && user.verification.phone === 'verified';
}

export function deriveCapabilities(user: User): UserCapabilities {
  const transactable = isTransactable(user);
  return {
    canBuy: transactable,
    // Note this is not gated on sellerProfile: an account with no profile yet
    // is one listing away from having one, and blocking here would make the
    // "become a seller" prompt a hard wall rather than the intended nudge.
    canSell: transactable,
    canForward: transactable && user.forwarderProfile !== null,
    isAdmin: user.isAdmin,
  };
}

/** Whether a set of capabilities satisfies at least one of those required. */
export function hasAnyCapability(
  capabilities: UserCapabilities,
  required: readonly Capability[],
): boolean {
  return required.some((capability) => {
    switch (capability) {
      case 'buy':
        return capabilities.canBuy;
      case 'sell':
        return capabilities.canSell;
      case 'forward':
        return capabilities.canForward;
      case 'admin':
        return capabilities.isAdmin;
      default:
        return false;
    }
  });
}
