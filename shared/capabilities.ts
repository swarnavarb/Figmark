import type { Capability } from './enums.js';
import type { User } from './models.js';
import { buyerVerified, fullyVerified } from './verification.js';

/**
 * What an account may currently do.
 *
 * Derived, never stored (except `isAdmin`, which is a real assigned role). One
 * account is both buyer and seller, so these are independent switches rather
 * than mutually exclusive states: a user can be able to buy but not yet to
 * sell, or both at once.
 */
export interface UserCapabilities {
  /** Browsing is always open; buying needs email and WhatsApp verified. */
  canBuy: boolean;
  /** Listing, private deals and power sales: email, WhatsApp and Aadhaar. */
  canSell: boolean;
  /** Quoting on lots and appearing in the directory. */
  canForward: boolean;
  isAdmin: boolean;
}

/**
 * Whether one side of trading is open to this account.
 *
 * Verification decides, unless an operator has said otherwise: `grant` opens
 * it for an account that has not finished verifying, `block` closes it for
 * one that has. Suspension closes everything, whatever was granted.
 */
function allowed(user: User, side: 'buy' | 'sell', verified: boolean): boolean {
  if (user.suspended) return false;
  const right = user.tradeOverride?.[side] ?? 'auto';
  if (right === 'grant') return true;
  if (right === 'block') return false;
  return verified;
}

export function deriveCapabilities(user: User): UserCapabilities {
  // Buying needs email and a WhatsApp-verified phone; selling also needs an
  // Aadhaar that matches that phone (see buyerVerified for why not buyers).
  const canSell = allowed(user, 'sell', fullyVerified(user));
  return {
    canBuy: allowed(user, 'buy', buyerVerified(user)),
    // Note this is not gated on sellerProfile: an account with no profile yet
    // is one listing away from having one.
    canSell,
    canForward: canSell && user.forwarderProfile !== null,
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
