/**
 * Canonical enumerations for the Figmark domain.
 *
 * These are plain `const` objects rather than TS `enum`s so the same values are
 * usable from the API (compiled by tsc) and the browser app (bundled by Vite)
 * without duplicating literals or pulling in a runtime shim.
 */

/**
 * What an account may do.
 *
 * Deliberately not a role enum. Every account is both buyer and seller - a
 * seller is just someone who has listed something - so a single mutually
 * exclusive role cannot describe a real user. Capabilities are derived from
 * verification state (see `deriveCapabilities`), except `admin`, which is a
 * genuine assigned role stored on the record.
 */
export const CAPABILITIES = ['buy', 'sell', 'forward', 'admin'] as const;
export type Capability = (typeof CAPABILITIES)[number];

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
 * Where the item comes from, chosen when it is listed.
 *
 * The two differ in what a buyer is waiting for, not in what the item is: an
 * in-hand item ships from the seller's shelf, an imported one has to arrive
 * first. An item travelling in an import lot is always `import`; a single item
 * can be either.
 */
export const SOURCING = ['in_hand', 'import'] as const;
export type Sourcing = (typeof SOURCING)[number];

export const SOURCING_LABELS: Record<Sourcing, string> = {
  in_hand: 'In hand',
  import: 'Import',
};

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

/**
 * Tracking for an item the seller ships themselves - no China leg, no
 * consolidation. Most domestic resales take this path, and showing them the
 * seven-stage import pipeline would be nonsense.
 */
export const DIRECT_STAGES = ['preparing', 'dispatched', 'delivered'] as const;
export type DirectStage = (typeof DIRECT_STAGES)[number];

export const DIRECT_STAGE_LABELS: Record<DirectStage, string> = {
  preparing: 'Preparing',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
};

/** Either vocabulary, as stored on an order's stage history. */
export type FulfilmentStage = LotStage | DirectStage;

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

/**
 * Review directions, all gated on a completed transaction.
 *
 * Buyer and seller rate each other on an order; a seller rates a forwarder on a
 * lot that forwarder actually shipped. Same rule throughout: no completed
 * transaction, no review.
 */
export const REVIEW_DIRECTIONS = [
  'buyer_to_seller',
  'seller_to_buyer',
  'seller_to_forwarder',
] as const;
export type ReviewDirection = (typeof REVIEW_DIRECTIONS)[number];

/**
 * How many forums may exist at once.
 *
 * Small on purpose: a forum nobody is in reads as a dead room, so the feature
 * starts scarce and grows once there is traffic to justify it.
 */
export const FORUM_CAP = 6;

/**
 * What someone may do in a store they do not own.
 *
 * Separate rights rather than one "manager" flag, because the jobs are
 * genuinely different: the person who lists items is often not the person who
 * should see the revenue, and neither of them should be able to hand out
 * access. `admin` implies the rest.
 */
export const STORE_PERMISSIONS = ['listings', 'lots', 'posts', 'analytics', 'export', 'admin'] as const;
export type StorePermission = (typeof STORE_PERMISSIONS)[number];

export const STORE_PERMISSION_LABELS: Record<StorePermission, string> = {
  listings: 'List and edit items',
  lots: 'Open and move lots',
  posts: 'Post as the store',
  analytics: 'See the numbers',
  export: 'Pack the lots (exporter)',
  admin: 'Manage the store and its people',
};

/* -------------------------------------------------------------------------- */
/* Per-order checkpoints                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where one item has physically got to, ticked off one order at a time.
 *
 * Distinct from `LOT_STAGES`, which is the consignment as a whole. A crate does
 * not arrive all at once: thirty-three of thirty-four pieces reach the China
 * warehouse and one is still with the supplier, and the seller needs to see
 * exactly that. So the checkpoints live on the order and the lot's headline
 * numbers are counts of them, not a state of its own.
 *
 * Order matters: it is the sequence a piece travels, and progress is read from
 * the index.
 */
export const ORDER_CHECKPOINTS = [
  'china_received',
  'china_packed',
  'india_received',
  'ready_to_dispatch',
  'packed',
  'dispatched',
] as const;
export type OrderCheckpoint = (typeof ORDER_CHECKPOINTS)[number];

/** Short forms, as they appear on an order row. */
export const CHECKPOINT_LABELS: Record<OrderCheckpoint, string> = {
  china_received: 'China WH',
  china_packed: 'Packed CH',
  india_received: 'India WH',
  ready_to_dispatch: 'Ready',
  packed: 'Packed',
  dispatched: 'Dispatched',
};

/** Long forms, for the counts on a lot card. */
export const CHECKPOINT_COUNT_LABELS: Record<OrderCheckpoint, string> = {
  china_received: 'China WH rcvd',
  china_packed: 'Packed in China',
  india_received: 'India received',
  ready_to_dispatch: 'Ready to dispatch',
  packed: 'Packed',
  dispatched: 'Dispatched',
};

/** Which side of the water a checkpoint sits on, for the two status bands. */
export const CHECKPOINT_SIDE: Record<OrderCheckpoint, 'china' | 'india'> = {
  china_received: 'china',
  china_packed: 'china',
  india_received: 'india',
  ready_to_dispatch: 'india',
  packed: 'india',
  dispatched: 'india',
};

/**
 * The three the lot card charts.
 *
 * Not all six: the card is a glance, and these are the ones that move while a
 * lot is being filled and shipped. The rest are counted as tiles instead.
 */
export const LOT_PROGRESS_CHECKPOINTS: OrderCheckpoint[] = [
  'china_received',
  'china_packed',
  'india_received',
];

/** How a lot's own stage reads on its card, in the seller's words. */
export const LOT_CARD_LABELS: Record<LotStage, string> = {
  ordering: 'Lot getting filled',
  china_wh_received: 'Arriving at China WH',
  dispatched_from_china: 'Dispatched from China',
  india_received: 'Received in India',
  qc_repack: 'QC and repack',
  local_dispatch: 'Out for local dispatch',
  delivered: 'Delivered',
};
