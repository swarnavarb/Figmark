/**
 * Canonical enumerations for the Figmark domain.
 *
 * These are plain `const` objects rather than TS `enum`s so the same values are
 * usable from the API (compiled by tsc) and the browser app (bundled by Vite)
 * without duplicating literals or pulling in a runtime shim.
 */

export const USER_ROLES = ['buyer', 'seller', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Status of a single verification artefact (ID document, bank/UPI match, phone,
 * email, payment method). Designed now, enforced once real auth lands.
 */
export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Seller trust tiers. Gates listing ability, lot caps and search placement.
 *  - unverified: cannot list
 *  - verified:   phone + govt ID + address confirmed, bank/UPI matched to ID holder
 *  - pro:        business registration + buying-agent proof + refundable deposit
 */
export const SELLER_TIERS = ['unverified', 'verified', 'pro'] as const;
export type SellerTier = (typeof SELLER_TIERS)[number];

/** Condition grading, carried over from the AxisTwelve manifest model. */
export const CONDITION_TAGS = ['MISB', 'MIB', 'BIB', 'LOOSE'] as const;
export type ConditionTag = (typeof CONDITION_TAGS)[number];

/**
 * Fulfilment stages for a lot. Order is significant: this array *is* the
 * pipeline, and progress is computed from the index. Buyers see the same
 * timeline the seller works, which is the point of the whole feature.
 */
export const LOT_STAGES = [
  'ordering',
  'china_wh_received',
  'dispatched_from_china',
  'india_received',
  'qc_repack',
  'local_dispatch',
  'delivered',
] as const;
export type LotStage = (typeof LOT_STAGES)[number];

export const LOT_STAGE_LABELS: Record<LotStage, string> = {
  ordering: 'Ordering',
  china_wh_received: 'China WH received',
  dispatched_from_china: 'Dispatched from China',
  india_received: 'India received / customs',
  qc_repack: 'QC & repack',
  local_dispatch: 'Local dispatch',
  delivered: 'Delivered',
};

/** Lifecycle of the group-buy itself, independent of physical fulfilment stage. */
export const LOT_STATUSES = ['draft', 'open', 'filled', 'closed', 'cancelled'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const LISTING_STATUSES = ['draft', 'active', 'sold_out', 'archived'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Whether a listing is stock on hand or a slot in an open group-buy. */
export const LISTING_KINDS = ['in_stock', 'lot_slot'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const ORDER_STATUSES = [
  'pending_payment',
  'confirmed',
  'in_fulfilment',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Escrow state machine. Funds are held by the platform and released on buyer
 * confirmation, or automatically after `autoReleaseAt` when no dispute exists.
 */
export const ESCROW_STATES = ['none', 'held', 'released', 'refunded', 'disputed'] as const;
export type EscrowState = (typeof ESCROW_STATES)[number];

export const DISPUTE_STATUSES = [
  'open',
  'awaiting_seller',
  'under_mediation',
  'resolved_buyer',
  'resolved_seller',
  'withdrawn',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** Two-sided reviews: each completed order can produce one of each direction. */
export const REVIEW_DIRECTIONS = ['buyer_to_seller', 'seller_to_buyer'] as const;
export type ReviewDirection = (typeof REVIEW_DIRECTIONS)[number];
