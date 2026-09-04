import type {
  ConditionTag,
  DisputeStatus,
  EscrowState,
  ListingKind,
  ListingStatus,
  LotStage,
  LotStatus,
  OrderStatus,
  PaymentStatus,
  ReviewDirection,
  SellerTier,
  UserRole,
  VerificationStatus,
} from './enums.js';

/** Fields every persisted document carries. `id` is the Cosmos item id. */
export interface BaseDocument {
  id: string;
  /** ISO-8601. Set on insert, never mutated. */
  createdAt: string;
  /** ISO-8601. Bumped on every write. */
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Verification state for a user. Every field exists from day one so the trust
 * tier and review-gating logic has a stable shape to read; nothing here is
 * populated or enforced until real auth replaces the mock provider.
 */
export interface VerificationState {
  phone: VerificationStatus;
  email: VerificationStatus;
  /** Government ID document review (admin queue). */
  governmentId: VerificationStatus;
  address: VerificationStatus;
  /** Buyer-side: a payment method is on file and has been charged successfully. */
  paymentMethod: VerificationStatus;
  /** Seller-side: payout bank/UPI account holder name matches the ID holder. */
  bankAccountMatch: VerificationStatus;
  /** Pro tier evidence: business registration + buying-agent proof. */
  businessRegistration: VerificationStatus;
  /** ISO-8601 of the last admin decision, or null if never reviewed. */
  lastReviewedAt: string | null;
  /** Admin user id that last actioned this record. */
  lastReviewedBy: string | null;
}

/**
 * Weighted trust score, deliberately not a raw average.
 * `score` is the published 0-100 number; the components are kept so the
 * algorithm can be tuned without recomputing from scratch and so the fraud
 * checks can flag sudden drops or clustered new-account reviews.
 */
export interface TrustSignals {
  score: number;
  /** Completed, non-disputed transactions. Drives confidence weighting. */
  completedTransactions: number;
  /** Disputes resolved against this user. */
  disputesLost: number;
  /** Seller-side public stat: fraction of lots dispatched by promised date. */
  onTimeDispatchRate: number | null;
  /** Fraction of buyers who ordered more than once. */
  repeatCustomerRate: number | null;
  /** ISO-8601 of last recompute, or null if never computed. */
  computedAt: string | null;
}

export interface User extends BaseDocument {
  /** Login handle for the mock auth provider; unique, lowercase. */
  username: string;
  email: string;
  displayName: string;
  /**
   * Authorisation role. Present from day one because trust tiers, review
   * gating and the admin console all branch on it; retrofitting is painful.
   */
  role: UserRole;
  /**
   * scrypt hash of the mock password, `<saltHex>:<hashHex>`.
   * Only ever set by the mock auth provider - the real provider owns
   * credentials externally and leaves this null.
   */
  passwordHash: string | null;
  verification: VerificationState;
  trust: TrustSignals;
  /** Seller-only. `null` for buyers and admins. */
  sellerProfile: SellerProfile | null;
  /** Soft-disable without deleting history. */
  suspended: boolean;
}

export interface SellerProfile {
  /** URL slug for the public storefront. */
  storefrontSlug: string;
  storefrontName: string;
  bio: string;
  tier: SellerTier;
  /** Max simultaneous open lots allowed at the current tier. */
  openLotCap: number;
  /** Refundable deposit held for the Pro tier, in minor units (paise). */
  depositHeldMinor: number;
  dispatchRegion: string;
}

/* -------------------------------------------------------------------------- */
/* Listings                                                                   */
/* -------------------------------------------------------------------------- */

export interface ListingPhoto {
  /** Blob name within the storage container; not a full URL. */
  blobName: string;
  /** Perceptual hash, reserved for reverse-image search. */
  imageHash: string | null;
  isPrimary: boolean;
}

export interface Listing extends BaseDocument {
  /** Partition key. */
  sellerId: string;
  title: string;
  description: string;
  category: string;
  condition: ConditionTag;
  kind: ListingKind;
  status: ListingStatus;
  /** Price in minor units (paise) to avoid float drift. */
  priceMinor: number;
  currency: string;
  quantityAvailable: number;
  /** Set when `kind === 'lot_slot'`; ties the listing to its group-buy. */
  lotId: string | null;
  photos: ListingPhoto[];
  /** Free-text search terms, denormalised for query simplicity. */
  tags: string[];
}

/* -------------------------------------------------------------------------- */
/* Lots (group-buys)                                                          */
/* -------------------------------------------------------------------------- */

/** One recorded stage transition, powering the buyer-visible timeline. */
export interface StageEvent {
  stage: LotStage;
  enteredAt: string;
  note: string | null;
  /** User id that recorded the transition. */
  recordedBy: string;
}

export interface Lot extends BaseDocument {
  /** Partition key. Keeps a seller's whole book in one partition. */
  sellerId: string;
  name: string;
  description: string;
  status: LotStatus;
  stage: LotStage;
  stageHistory: StageEvent[];
  /** Units needed before the lot is viable and the seller places the order. */
  fillThreshold: number;
  /** Units pre-booked so far. Denormalised from orders for cheap list reads. */
  filledCount: number;
  /** ISO-8601 after which no further pre-bookings are accepted. */
  cutoffAt: string;
  /** Seller's promised dispatch date, shown to buyers as an estimate. */
  estimatedDispatchAt: string | null;
  /** Per-lot cost model, feeding the landed-cost calculator. */
  costModel: LotCostModel;
}

/** Inputs to the landed-cost / profit calculator. All amounts in minor units. */
export interface LotCostModel {
  currency: string;
  /** Agent/supplier invoice total for the batch. */
  goodsCostMinor: number;
  /** China -> India freight. */
  freightMinor: number;
  customsDutyMinor: number;
  packagingMinor: number;
  /** Domestic last-mile, estimated across the whole lot. */
  localShippingMinor: number;
  /** Total shipment weight in grams, for the packing/box estimator. */
  totalWeightGrams: number;
}

/* -------------------------------------------------------------------------- */
/* Orders (manifest lines)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An order is one line of a lot's manifest: buyer, item, condition, quantity,
 * weight, payment status - the AxisTwelve manifest columns, promoted to a
 * first-class document.
 */
export interface Order extends BaseDocument {
  /** Partition key. Generating a lot manifest is then a single-partition read. */
  lotId: string;
  sellerId: string;
  buyerId: string;
  listingId: string;
  /** Snapshot of the item name at order time; listings can be edited later. */
  itemName: string;
  condition: ConditionTag;
  quantity: number;
  unitWeightGrams: number;
  unitPriceMinor: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  escrow: EscrowRecord;
  /** Set once the order reaches `delivered`; unlocks reviews. */
  completedAt: string | null;
}

/** Escrow hold attached to an order. */
export interface EscrowRecord {
  state: EscrowState;
  amountMinor: number;
  heldAt: string | null;
  releasedAt: string | null;
  /** Auto-release deadline when the buyer neither confirms nor disputes. */
  autoReleaseAt: string | null;
  disputeId: string | null;
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Two-sided and blind. A review is written against a completed order and stays
 * hidden until the counterparty submits theirs or `revealAt` passes, which is
 * what stops retaliatory rating.
 */
export interface Review extends BaseDocument {
  /** Partition key: the user being reviewed. */
  subjectId: string;
  authorId: string;
  /** The completed order that unlocked this review. Enforced, not advisory. */
  orderId: string;
  direction: ReviewDirection;
  rating: number;
  body: string;
  /** Hidden until both sides submit or the reveal window expires. */
  revealed: boolean;
  revealAt: string;
}

/* -------------------------------------------------------------------------- */
/* Disputes                                                                   */
/* -------------------------------------------------------------------------- */

export interface DisputeEvidence {
  blobName: string;
  caption: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Dispute extends BaseDocument {
  /** Partition key. */
  orderId: string;
  raisedBy: string;
  againstUserId: string;
  reason: string;
  status: DisputeStatus;
  evidence: DisputeEvidence[];
  /** Seller response SLA deadline. */
  sellerResponseDueAt: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
}
