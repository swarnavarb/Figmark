import type {
  ConditionTag,
  FulfilmentStage,
  DisputeOutcome,
  DisputeReason,
  DisputeStatus,
  EscrowState,
  ListingStatus,
  LotStage,
  LotStatus,
  OrderCheckpoint,
  OrderStatus,
  PaymentStatus,
  ReviewDirection,
  SellerTier,
  Sourcing,
  StorePermission,
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
   * The handle this account is addressed by, at `/<username>`.
   *
   * Shares a namespace with storefront usernames, since both are addressable
   * the same way. Optional on the type only because accounts written before
   * handles existed do not carry one; the API backfills on read.
   */
  username?: string;
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
  /**
   * Non-null once the company has granted this seller protected checkout.
   * Absent on every account that has not been granted it, which is most.
   */
  escrowRights?: EscrowRights | null;
  /** Soft-disable without deleting history. */
  suspended: boolean;
  /**
   * The person's own page, as distinct from their shop's.
   *
   * A buyer is somebody a seller decides whether to trust, so they get a page
   * with the same shape - a banner, a line about themselves, and chips - rather
   * than a name and nothing. Absent on accounts that predate it.
   */
  bio?: string;
  coverUrl?: string | null;
  tags?: string[];
  /** Last seen, so a page can say whether anybody is home. */
  lastSeenAt?: string | null;
}

export interface SellerProfile {
  /** URL slug for the public storefront. */
  storefrontSlug: string;
  /**
   * The storefront's own handle.
   *
   * A store is addressed and messaged as itself rather than as its owner -
   * which is the whole point of a storefront - so it takes a username out of
   * the same namespace instead of borrowing one.
   */
  username?: string;
  storefrontName: string;
  bio: string;
  tier: SellerTier;
  /** Max simultaneous open lots allowed at the current tier. */
  openLotCap: number;
  /** Refundable deposit held for the Pro tier, in minor units (paise). */
  depositHeldMinor: number;
  dispatchRegion: string;
  followerCount: number;
  /**
   * Storefront picture, as a URL.
   *
   * A URL rather than an upload while blob storage is still unwired: the field
   * the storefront reads is the same either way, so uploads become a change to
   * how this is filled in rather than a change to the model.
   */
  photoUrl?: string | null;
  /**
   * People who may act in this store besides its owner.
   *
   * The owner is not in this list: ownership is not a grant that could be
   * revoked, and leaving them out means the store can never end up with nobody
   * able to administer it.
   */
  managers?: StoreManager[];
  /**
   * One outbound link - Instagram, a WhatsApp group, a price list.
   *
   * Deliberately one. A row of links is a link farm; a single one is a
   * storefront's front door, and keeps the card honest about what it is.
   */
  link?: string | null;
  /**
   * Where a buyer sends the money on a direct sale.
   *
   * Shown to a buyer only once they are on the checkout of an order with this
   * seller, never on the storefront: these are the details somebody needs to
   * pay, and a shop page is not a reason to publish them to everyone who walks
   * past. Absent means this seller has not set any up, and a direct sale
   * cannot be offered at all.
   */
  payment?: SellerPaymentDetails | null;
  /**
   * The banner behind the shop's name.
   *
   * A URL for the same reason the avatar is one - blob storage is not wired,
   * and the field the page reads does not change when it is.
   */
  coverUrl?: string | null;
  /**
   * Short facts the shop wants read before anything else: what they do, where
   * they ship from, how long they have been at it. Chips rather than prose
   * because they are scanned, not read, and a paragraph gets skipped.
   */
  tags?: string[];
}

/**
 * How to pay this seller directly, in their own words.
 *
 * Free text rather than a validated bank record on purpose: the platform is not
 * moving this money and must not pretend to have checked it. What it can do is
 * carry the details accurately and make the buyer's proof of sending it part of
 * the order, which is what the two of them will argue from if it goes wrong.
 */
export interface SellerPaymentDetails {
  /** A UPI handle, which is how most of these are actually settled. */
  upiId?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  /** Anything the buyer needs to do besides send it - a reference to quote. */
  instructions?: string | null;
}

/**
 * Someone granted rights in a store they do not own.
 *
 * The display name is a snapshot so a member list renders without a lookup per
 * row; the id is what any permission check actually uses.
 */
/**
 * The company's grant that this person may hold other people's money.
 *
 * An escrow is a party, not a mechanism: a vetted individual who holds a
 * buyer's payment until the goods land and who settles it if the two sides
 * disagree. Buyers choose one at checkout, so the grant is what puts somebody
 * on that list — and the rate is theirs, because it is their fee for the work.
 *
 * Held rather than derived, because it is a commercial decision about a named
 * person and the marketplace has to be able to point at when it made it.
 */
export interface EscrowRights {
  grantedAt: string;
  grantedBy: string;
  /** Charged to the buyer on top of the order, in basis points of the total. */
  feeBasisPoints: number;
  /** How they are listed to buyers choosing one. */
  displayName: string;
  /** Why the company granted it. Read by operators, never by buyers. */
  note: string;
}

export interface StoreManager {
  userId: string;
  displayName: string;
  permissions: StorePermission[];
  addedAt: string;
  addedBy: string;
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
  /**
   * In hand or imported.
   *
   * Determined by `lotId` rather than chosen alongside it: an import is a
   * consignment, and the batch is what carries the stages a buyer waits on, so
   * an imported item outside a batch has nowhere for its tracking to come from.
   * A batch means import; no batch means it ships from the seller's shelf.
   *
   * Optional on the type because listings written before this field existed do
   * not carry it; `sourcingOf` resolves those rather than showing a blank.
   */
  sourcing?: Sourcing;
  /**
   * Sold as one assorted lot rather than as a single item.
   *
   * A job lot - twelve blind-box figures, a shelf clearance, a box of loose
   * parts - is a different thing to buy from one named item, and buyers who
   * want one rarely want the other. Optional because listings written before
   * this existed are all single items.
   */
  bundle?: boolean;
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

/**
 * A buyer-facing pre-order campaign attached to one listing.
 *
 * Two counters rather than one, because a group-buy has two kinds of member.
 * `filledCount` is money: units somebody has actually ordered. `pledgedCount`
 * is intent: units somebody said they would take if enough others did, which
 * costs nothing and is called in for payment the moment the two together reach
 * the threshold. The cheap first click is what gets a bar off zero, and a bar
 * at zero recruits nobody - but a pledge is not a sale and is never counted as
 * one, which is why they are stored and displayed apart.
 */
export interface PreOrder {
  /** Units that must be committed before the seller places the order. */
  fillThreshold: number;
  /** Units booked so far. Denormalised from orders for cheap list reads. */
  filledCount: number;
  /**
   * Units pledged but not yet paid for. Denormalised from the `pledges`
   * container the same way, and optional because campaigns written before
   * pledges existed carry no such field.
   */
  pledgedCount?: number;
  /** ISO-8601 after which no further pre-bookings are accepted. */
  cutoffAt: string;
  /**
   * When the "nearly there" notice went out, so it goes out once.
   *
   * The one moment the app is allowed to ask everybody for something. Sending
   * it on a timer instead would be a countdown, and manufactured urgency would
   * cost more trust than the extra unit is worth.
   */
  nearlyNotifiedAt?: string | null;
  /** When booked + pledged first reached the threshold. */
  filledAt?: string | null;
  /**
   * The deadline for pledges to become bookings, set when the meter fills.
   *
   * A pledge that is never called in is a promise nobody has to keep, which
   * makes the hatched half of the bar a lie. After this passes the place is
   * offered to whoever is behind it.
   */
  pledgeDueAt?: string | null;
  /** When the cutoff passed without the meter filling. */
  closedAt?: string | null;
}

/**
 * "I am in, if enough others are."
 *
 * A soft commitment on one pre-order: no money moves, nothing is reserved, and
 * it converts into a real order when the campaign fills. It exists because the
 * first person to pay into a group-buy is taking the whole risk of it never
 * happening, and most people will not - so the bar stays at zero and the item
 * never gets imported, which is a worse outcome for everybody than a softer
 * first step.
 */
export interface Pledge extends BaseDocument {
  /** Partition key: a campaign and everyone in it are read together. */
  listingId: string;
  userId: string;
  /** Denormalised so the seller can find what was pledged in their shop. */
  sellerId: string;
  units: number;
  /**
   * Whether this person may be named in the roster.
   *
   * Off by default. Being one of twenty is a fact about a group; being named
   * tells strangers what you buy and roughly what you spend, and that is the
   * person's call to make rather than a side effect of joining.
   */
  listed: boolean;
  /** Who brought them in, when they arrived through somebody's share link. */
  broughtBy: string | null;
  /** The order this became, once the pledge was called in and paid. */
  convertedOrderId: string | null;
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
  /** Where the batch is coming from, e.g. "Guangzhou, CN". Seller-facing. */
  origin: string;
  /** Who the batch is bought from. Null until the seller fills it in. */
  supplier: LotSupplier | null;
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
 * The overseas seller or agent a lot is bought from.
 *
 * Distinct from the forwarder, which moves the batch, and from the Figmark
 * account listing the items - this is the counterparty at the origin end, kept
 * so a batch can be reconciled against their invoice months later.
 */
export interface LotSupplier {
  name: string;
  contact: string | null;
  /** Their order or invoice reference. */
  reference: string | null;
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
   * What the buyer bought alongside the item.
   *
   * Null means they declined protection, or the seller was never granted it -
   * and then there is no escrow to hold and no dispute for the company to
   * settle. Recorded on the order rather than looked up later, because the fee
   * and the rate are terms of that transaction and must not move when the
   * seller's grant is changed afterwards.
   */
  protection?: OrderProtection | null;
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
  /**
   * Who brought this buyer in, when they arrived through a share link.
   *
   * Credit for filling a group-buy, and the only thing that makes sharing one
   * worth a person's reputation: recruiting for a batch that never ships is
   * how you lose friends, so whoever did it is recorded next to whether it
   * shipped.
   */
  broughtBy?: string | null;
  /** Set once the order reaches `delivered`; unlocks reviews. */
  completedAt: string | null;
  /**
   * When each physical checkpoint was ticked for this one item.
   *
   * A timestamp rather than a boolean, so "is it in the China warehouse" and
   * "when did it get there" are the same field and ticking one keeps its own
   * history without a second structure to maintain. Absent or null means not
   * yet; orders written before checkpoints existed simply have none.
   */
  checkpoints?: Partial<Record<OrderCheckpoint, string | null>>;
  /**
   * The buyer's claim that they have paid, and what the seller made of it.
   *
   * A direct sale is settled outside this app, so nothing here observes the
   * money moving. What the order can hold is each side's account of it: the
   * buyer's reference and screenshot, then the seller's decision. Both are
   * kept even after a denial, because a denied claim is the beginning of an
   * argument and deleting the evidence would leave only one side of it.
   */
  paymentClaim?: PaymentClaim | null;
}

/** One buyer's assertion that they sent the money, and the seller's answer. */
export interface PaymentClaim {
  claimedAt: string;
  /** The transaction reference the buyer typed - a UTR, or whatever their app gave them. */
  reference: string | null;
  /**
   * Their screenshot of it.
   *
   * Held on the order as a downscaled image rather than a link, because a link
   * to somebody's photo host is evidence that can be taken away later, and
   * this is the only proof the buyer has. It moves behind the photo store when
   * blob storage is wired; the field the order reads stays the same.
   */
  screenshot: string | null;
  /** Null while the seller has not answered yet. */
  decision: 'accepted' | 'denied' | null;
  decidedAt: string | null;
  /** Why they denied it. Read by the buyer, so it has to say something. */
  decidedReason: string | null;
}

/** Buyer protection, as bought: who holds it, and on what terms. */
export interface OrderProtection {
  /** The escrow holding this payment, and who will settle a dispute over it. */
  escrowAgentId: string;
  /** Their name as it was at purchase, so a later rename cannot rewrite it. */
  escrowName: string;
  /** The fee paid, on top of the item total. */
  feeMinor: number;
  feeBasisPoints: number;
  boughtAt: string;
  /**
   * Set when the fee is handed back. The fee buys the service, so it is kept
   * whatever the outcome - except when the company finds fully for the buyer,
   * which means the service was needed and the seller was at fault.
   */
  refundedAt: string | null;
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

/**
 * A review of somebody's page rather than of a trade with them.
 *
 * Deliberately a different record from `Review`, and never mixed into the same
 * average. A transaction review is earned - it exists because money changed
 * hands and both sides had to write blind. This one is an opinion anybody may
 * leave, which is worth having and is not the same claim, so it is counted,
 * shown and labelled separately. Folding the two together would let a shop be
 * talked up or shouted down by people who never bought anything, and the
 * verified number is the whole reason the verified number is worth reading.
 *
 * One per author per subject, enforced by a unique key on the container.
 */
export interface StoreReview extends BaseDocument {
  /** Partition key: whose page this is about. */
  subjectId: string;
  authorId: string;
  /** Their name as it was when they wrote it. */
  authorName: string;
  authorHandle: string | null;
  rating: number;
  body: string;
}

/* -------------------------------------------------------------------------- */
/* Disputes                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A photograph, or whatever else backs up a claim.
 *
 * A link for now, the same way a storefront photo is a link: uploads fill
 * `blobName` when blob storage is wired, and the field a reader renders is the
 * same either way. In a dispute about a physical object this is most of the
 * argument, so it attaches to a message rather than sitting in a pile — who
 * said what, with what to show for it.
 */
export interface DisputeEvidence {
  url: string | null;
  blobName: string | null;
  caption: string;
  uploadedBy: string;
  uploadedAt: string;
}

/**
 * One turn in the argument.
 *
 * Both sides read the whole thread, and so does the mediator. A dispute settled
 * on evidence one party could not see is not settled, it is imposed - so
 * nothing here is private, and the screens say so before anyone writes.
 */
export interface DisputeMessage {
  id: string;
  authorId: string;
  /** 'company' marks a message from whoever is mediating. */
  authorRole: 'buyer' | 'seller' | 'company';
  body: string;
  evidence: DisputeEvidence[];
  createdAt: string;
}

/**
 * A settlement one side proposes and the other accepts.
 *
 * Most disputes are not really contested: the seller knows the box was
 * damaged and would rather refund half than argue. An offer the other side can
 * accept in one tap resolves those without the company being involved at all,
 * which is the outcome a marketplace should want most.
 */
export interface DisputeOffer {
  fromUserId: string;
  /** What goes back to the buyer. Zero is "release it all to the seller". */
  refundMinor: number;
  note: string;
  createdAt: string;
}

/** How a dispute ended, and what happened to the money. */
export interface DisputeResolution {
  outcome: DisputeOutcome;
  refundMinor: number;
  note: string;
  /** The account that decided: one of the parties, or the company. */
  decidedBy: string;
  byCompany: boolean;
  decidedAt: string;
}

export interface Dispute extends BaseDocument {
  /** Partition key. */
  orderId: string;
  raisedBy: string;
  againstUserId: string;
  /** Which side opened it. Either may: a seller has grievances too. */
  raisedSide: 'buyer' | 'seller';
  /** Structured, so the queue can be triaged and the form can ask the right thing. */
  reasonCode: DisputeReason;
  reason: string;
  status: DisputeStatus;
  messages: DisputeMessage[];
  /** The offer currently on the table, if either side has made one. */
  offer: DisputeOffer | null;
  /** The other side's SLA. Missing it escalates to the company, never auto-decides. */
  respondByAt: string | null;
  escalatedAt: string | null;
  resolution: DisputeResolution | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Social                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a post lives.
 *
 * A seller channel is one seller broadcasting to the people who follow them; a
 * forum is a shared room. Both are just an id to partition by, which is why one
 * container holds both: the reads are identical in shape, and the difference is
 * only who may write.
 */
export type PostChannel = 'seller' | 'forum';

/** What a post is, which decides how it renders rather than where it lives. */
export type PostKind = 'update' | 'sale' | 'thread';

/** Who is speaking in a shop's channel: the shop, or somebody who follows it. */
export type PostVoice = 'store' | 'visitor';

/** Whether a post broadcasts to followers' feeds or stays in the channel. */
export type PostReach = 'feed' | 'channel';

export interface Post extends BaseDocument {
  /**
   * Partition key: the seller id for a channel post, the forum id for a forum
   * post. Both a channel thread and a forum read one partition.
   */
  channelId: string;
  channel: PostChannel;
  kind: PostKind;
  authorId: string;
  /** Snapshot: a post keeps the name it was written under. */
  authorName: string;
  body: string;
  /** Set on a sale post, so the item can be shown and opened inline. */
  listingId: string | null;
  photoUrl: string | null;
  likeCount: number;
  replyCount: number;
  /**
   * Who is speaking in a shop's channel.
   *
   * A channel belongs to one shop and everybody else in it is a customer, so
   * the two read differently and are filtered apart. Stored rather than derived
   * from the author id, because a manager posting for the shop is the shop
   * speaking, and their own id would say otherwise. Absent on posts written
   * before channels had two voices - those were all the shop's.
   */
  voice?: PostVoice;
  /**
   * How far this goes.
   *
   * 'feed' reaches everyone who follows, on their feed. 'channel' stays in the
   * channel for whoever opens it. The distinction is the point of having a
   * channel at all: a shop needs somewhere to say "customs cleared, dispatching
   * Tuesday" without it being an announcement in the same breath as a new
   * listing. Absent means 'feed' - everything written before this existed was
   * a broadcast.
   */
  reach?: PostReach;
  /**
   * Marked by the shop as something its followers should not miss.
   *
   * Not every message from a shop is one. A shop answering a question in its
   * own room is talking, not announcing, and a filter that treated the two
   * alike would fill the announcement list with conversation and make it worth
   * nothing to open. So it is a choice made per message, and only by whoever
   * speaks for the shop.
   *
   * Absent on posts written before the distinction existed. Those were made in
   * the shop's voice when that was the only kind there was, so `isAnnouncement`
   * reads them as announcements rather than hiding them.
   */
  announcement?: boolean;
}

/**
 * Somebody hunting for something nobody has listed.
 *
 * The other half of a marketplace, and the half that is usually silent. A
 * buyer who cannot find what they want leaves, and takes with them the one
 * piece of information a seller most needs: that there was demand. This turns
 * that into something a seller can read and answer - which is why it lives in
 * the social side rather than in search. Search tells you what exists; this
 * tells you what people wish existed.
 *
 * It expires on purpose. A board of hunts nobody is still hunting is a board
 * sellers stop opening.
 */
export interface Want extends BaseDocument {
  /** Partition key: their own hunts read as one partition. */
  buyerId: string;
  /** Their name and address as they were when they posted it. */
  buyerName: string;
  buyerHandle: string | null;
  title: string;
  details: string;
  category: string;
  /**
   * What they will pay, in minor units. Null means they have not said - which
   * is a real answer for a rare piece and not the same as zero.
   */
  budgetMinor: number | null;
  currency: string;
  /** Null means any condition will do. */
  condition: ConditionTag | null;
  status: WantStatus;
  /** Denormalised so the board can say how much interest there is. */
  offerCount: number;
  /**
   * How many people have said they want the same thing, the poster included.
   *
   * Counted on the hunt so the board can sort and show it without reading
   * every row behind every card.
   */
  seekerCount?: number;
  expiresAt: string;
  /** Set when the buyer says they are done, and why. */
  closedAt: string | null;
}

export type WantStatus = 'open' | 'closed';

/**
 * Somebody else looking for the same thing.
 *
 * A hunt with one name on it is a request; a hunt with nine is a reason to
 * fill a crate. On an import marketplace that difference is the whole
 * economics, so it is worth one tap to say "me too" - and worth counting where
 * a seller can see it.
 *
 * A row per person rather than a number on the hunt, because the count has to
 * be reversible, has to be exactly one per person, and because everybody who
 * put their name to it is who gets told when somebody answers.
 */
export interface WantSeeker extends BaseDocument {
  /** Partition key: a hunt and everyone waiting on it are read together. */
  wantId: string;
  userId: string;
}

/**
 * A seller's answer to a hunt.
 *
 * Either something they already have, or an offer to source it - the second is
 * the whole point on an import marketplace, where most of what is wanted has
 * not been bought yet by anybody.
 *
 * One per seller per hunt, replaced rather than added to. A board where a
 * seller can answer ten times is a board that describes whoever had the most
 * time.
 */
export interface WantOffer extends BaseDocument {
  /** Partition key: a hunt and its answers are read together. */
  wantId: string;
  sellerId: string;
  sellerName: string;
  sellerHandle: string | null;
  /** Something they already list, or null for "I can get this". */
  listingId: string | null;
  /** What they would charge. Null when they have only offered to look. */
  priceMinor: number | null;
  message: string;
}

/**
 * Something that happened which somebody asked to hear about.
 *
 * Deliberately thin: a line of text and somewhere to go. A notification that
 * cannot be acted on is an interruption, so every one of these carries the
 * route that answers it - tapping the news about an answer opens the hunt it
 * answered.
 *
 * Written at the moment the thing happens rather than assembled by asking
 * "what is new since you last looked". The second needs a read cursor per
 * person per kind and gets slower as the app grows; this is a row.
 */
export interface Notification extends BaseDocument {
  /** Partition key: your notifications are read as one list, which is yours. */
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where tapping it goes, as an in-app route. */
  link: string;
  readAt: string | null;
}

export type NotificationKind =
  | 'want_answered'
  | 'payment_claimed'
  | 'payment_settled'
  | 'dispute_opened'
  | 'dispute_replied'
  | 'dispute_settled'
  | 'lot_moved'
  | 'preorder_nearly'
  | 'preorder_filled'
  | 'preorder_due'
  | 'preorder_closed';

/**
 * A shared room.
 *
 * Capped for now - see FORUM_CAP. The cap is the feature being deliberately
 * small rather than a limit of the model: forums are a room with posts in it,
 * and the rest (moderation, membership, ranking) is later work.
 */
export interface Forum extends BaseDocument {
  name: string;
  description: string;
  createdBy: string;
  postCount: number;
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Who is speaking.
 *
 * A person and a storefront are separate voices even when one person is behind
 * both: an owner writing as their shop is not the same as writing as
 * themselves, and the person reading needs to be able to tell. So a party is
 * always a handle plus the account that actually typed it.
 */
export interface MessageParty {
  /** Username, without the `@`. */
  handle: string;
  /** The account this handle resolves to; a store's is its owner. */
  userId: string;
  /** True when the handle is a storefront rather than a person. */
  isStore: boolean;
  /** Snapshot of the name shown, so a thread renders without a lookup. */
  displayName: string;
}

export interface Message extends BaseDocument {
  /**
   * Partition key: the two handles, lowercased and sorted, joined by `|`.
   *
   * Deterministic from the pair, so either side computes the same thread id
   * without one having to be created first, and a whole conversation is a
   * single-partition read.
   */
  threadId: string;
  from: MessageParty;
  to: MessageParty;
  body: string;
  readAt: string | null;
}
