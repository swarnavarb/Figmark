import type {
  ConditionTag,
  FulfilmentStage,
  DisputeStatus,
  EscrowState,
  ListingStatus,
  LotStage,
  LotStatus,
  OrderStatus,
  PaymentStatus,
  ReviewDirection,
  SellerTier,
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
  /** ISO-8601 of last recompute, or null if never computed. */
  computedAt: string | null;
}

/**
 * Seller-side trust, kept separate from buyer-side because the two genuinely
 * diverge: a long-standing reliable buyer can be brand new at selling, and
 * collapsing them into one number would lend unearned credibility to a first
 * listing.
 */
export interface SellerTrustSignals extends TrustSignals {
  /** Public stat: fraction of lots dispatched by the promised date. */
  onTimeDispatchRate: number | null;
  /** Fraction of buyers who ordered more than once. */
  repeatCustomerRate: number | null;
}

/**
 * One account, both sides of the trade.
 *
 * There is no buyer account and no seller account: everyone can browse and buy,
 * and "seller" is simply what an account becomes the moment it lists something.
 * What an account may do is derived from its verification state by
 * `deriveCapabilities`, never read off a role field. `isAdmin` is the one
 * genuine assigned role.
 */
export interface User extends BaseDocument {
  /** Unique, lowercased. One of the two sign-in identifiers. */
  email: string;
  /** E.164, unique where present. The other sign-in identifier. */
  phone: string | null;
  displayName: string;
  /**
   * Platform administration: verification queue, dispute console, payouts.
   * A real assigned role, not a capability derived from verification, so it is
   * stored rather than computed.
   */
  isAdmin: boolean;
  /**
   * scrypt hash of the mock password, `<saltHex>:<hashHex>`.
   * Only ever set by the mock auth provider - the real provider owns
   * credentials externally and leaves this null.
   */
  passwordHash: string | null;
  verification: VerificationState;
  /** Trust as a buyer. Independent of the seller score below. */
  buyerTrust: TrustSignals;
  /** Trust as a seller. Independent of the buyer score above. */
  sellerTrust: SellerTrustSignals;
  /**
   * Populated the first time the account lists something. Its presence is what
   * makes an account a seller - not a role, not a separate signup.
   */
  sellerProfile: SellerProfile | null;
  /**
   * Freight forwarders share the same account base rather than living in a
   * separate system; this extension is what puts one in the directory.
   */
  forwarderProfile: ForwarderProfile | null;
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
  followerCount: number;
}

/** One China-origin to India-destination lane a forwarder claims to serve. */
export interface ForwarderRoute {
  originCity: string;
  destinationCity: string;
  /** Door-to-door turnaround the forwarder claims. Unverified. */
  claimedTurnaroundDays: number;
  /** Indicative rate in minor units per kilogram. */
  ratePerKgMinor: number;
  currency: string;
}

/**
 * A freight forwarder's directory entry. Forwarders sign themselves up and
 * sellers choose them; nothing here is admin-entered.
 */
export interface ForwarderProfile {
  companyName: string;
  /** URL slug for the public directory entry. */
  directorySlug: string;
  description: string;
  routes: ForwarderRoute[];
  contactEmail: string;
  contactPhone: string;
  /** Monthly volume in kg the forwarder claims to handle. Unverified. */
  claimedMonthlyCapacityKg: number | null;
  /**
   * Ratings from sellers, gated on lots this forwarder actually shipped - the
   * same completed-transaction rule as buyer and seller reviews, so a rating
   * cannot exist without a shipment behind it.
   */
  trust: TrustSignals;
  /** Withdrawn entries keep their history but stop appearing in search. */
  listedInDirectory: boolean;
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
  status: ListingStatus;
  /** Price in minor units (paise) to avoid float drift. */
  priceMinor: number;
  currency: string;
  quantityAvailable: number;
  /**
   * Demand pooling, opt-in per listing.
   *
   * Lives here rather than on the lot because a shipment batch can carry five
   * unrelated items, each with its own demand: "twenty people must want *this*
   * figure before I commit the cash" is a fact about the item, not the crate.
   * Null for an ordinary listing.
   */
  preOrder: PreOrder | null;
  /**
   * The shipment batch this item travels in. Seller-side bookkeeping: buyers
   * never see the lot itself, only the tracking it produces.
   */
  lotId: string | null;
  photos: ListingPhoto[];
  /** Free-text search terms, denormalised for query simplicity. */
  tags: string[];
  /** Bookmark count. Cheap signal, feeds the relevance ranking later. */
  likeCount: number;
  viewCount: number;
  /**
   * Last time the seller pushed this back up the feed. Rate-limited server-side
   * so bumping cannot be used to camp the top of the catalog.
   */
  bumpedAt: string | null;
}

/** A buyer-facing pre-order campaign attached to one listing. */
export interface PreOrder {
  /** Units that must be booked before the seller places the order. */
  fillThreshold: number;
  /** Units booked so far. Denormalised from orders for cheap list reads. */
  filledCount: number;
  /** ISO-8601 after which no further pre-bookings are accepted. */
  cutoffAt: string;
}

/** Public Q&A on a listing, visible to everyone - distinct from private chat. */
export interface ListingComment extends BaseDocument {
  /** Partition key. */
  listingId: string;
  authorId: string;
  authorName: string;
  body: string;
  /** Set when the seller answers, so replies can be grouped under a question. */
  replyToId: string | null;
}

/** A viewer's bookmark. Kept separate so listings stay cheap to write. */
export interface Like extends BaseDocument {
  /** Partition key: the user doing the liking. */
  userId: string;
  listingId: string;
}

/** A follow edge, powering the personalised feed. */
export interface Follow extends BaseDocument {
  /** Partition key: the follower. */
  followerId: string;
  sellerId: string;
}

/* -------------------------------------------------------------------------- */
/* Lots (group-buys)                                                          */
/* -------------------------------------------------------------------------- */

/** One recorded stage transition, powering the buyer-visible timeline. */
export interface StageEvent {
  stage: FulfilmentStage;
  enteredAt: string;
  note: string | null;
  /** User id that recorded the transition. */
  recordedBy: string;
}

/**
 * A shipment batch: the items a seller is moving in one consignment.
 *
 * Purely seller-side bookkeeping. Buyers never see a lot, its name, or how many
 * other people's items share the crate - they see the tracking it produces,
 * attributed to their own order. A seller typically has several open at once
 * (one per consolidation window, or per forwarder), and tags items into
 * whichever one they will actually travel in.
 */
export interface Lot extends BaseDocument {
  /** Partition key. Keeps a seller's whole book in one partition. */
  sellerId: string;
  /** Seller's own label, e.g. "Guangzhou run - September". Never shown to buyers. */
  name: string;
  description: string;
  status: LotStatus;
  stage: LotStage;
  stageHistory: StageEvent[];
  /** Promised dispatch date. The one lot fact buyers see, via their order. */
  estimatedDispatchAt: string | null;
  /** Per-lot cost model, feeding the landed-cost calculator. */
  costModel: LotCostModel;
  /** Null until the seller picks a forwarder or enters one manually. */
  forwarder: LotForwarder | null;
}

/**
 * The forwarder moving a lot.
 *
 * Picking from the directory is optional by design: a seller already working
 * with someone off-platform types their details in instead, and the lot behaves
 * identically. Directory adoption then grows because sellers find it useful,
 * not because the schema forces it.
 */
export interface LotForwarder {
  /** Set when chosen from the directory; null when typed in manually. */
  forwarderUserId: string | null;
  /** Display name, whether it came from the directory or was entered by hand. */
  name: string;
  contact: string | null;
  /**
   * Entered by the seller and shown on the buyer-facing stage timeline. There
   * is no live carrier API pull yet; this is the tracking reference as given.
   */
  trackingReference: string | null;
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
  /**
   * Partition key. Null once meant "impossible"; a direct domestic sale has no
   * shipment batch, so it is stored under the sentinel below rather than left
   * unpartitioned.
   */
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
  /**
   * The order's own fulfilment record, not a view onto the lot's.
   *
   * Advancing a lot appends an event to every order in it. Keeping the history
   * here rather than deriving it means re-tagging an item into a later
   * shipment appends "moved to a later consignment" instead of rewinding the
   * buyer's timeline to the start - and lets one item diverge when it is held
   * at customs while the rest of the crate clears.
   */
  stage: FulfilmentStage;
  stageHistory: StageEvent[];
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
