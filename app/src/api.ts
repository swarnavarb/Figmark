import type { ContentReport, ModerationMark, ReportTarget } from '@shared/moderation';
import type {
  ApiError,
  AuthUser,
  DemoAccount,
  HealthResponse,
  LoginResponse,
  MeResponse,
} from '@shared/contracts';
import type { DisputeStatus, FulfilmentStage, OrderCheckpoint, Sourcing, StorePermission } from '@shared/enums';
import type { DealState } from '@shared/deals';
import type { LotTally } from '@shared/board';
import type { BoxEstimate, LotPhase, Timings } from '@shared/insights';
import type { CrewRole, ServiceKind, ServiceMeta } from '@shared/services';
import type { ArtistJobAction, StoreKind } from '@shared/service-stores';
import type { RouteStep, StageIcon, StepAssignee, StepSide, StepTrigger, TrackingRoute } from '@shared/routes';
import type { CardButton, SerialButton } from '@shared/buttons';
import type { LevelTag, MergedRating, StoreLevel } from '@shared/storefront';
import type { GrowthView } from '@shared/store-growth';
import type { CostLine, CostStage, CostStep, ItemCostSheet, ProfitTemplate, SavedCalc } from '@shared/profit';
import type { PostTemplate, TemplateTerms } from '@shared/templates';
import type { LotBuyerPhase } from '@shared/fulfilment';
import type { PreOrderView } from '@shared/preorder';
import type { StoreAccess } from '@shared/stores';
import type { DisputeSubject, OrderAction, OrderSide } from '@shared/orders';
import type {
  CommentThread, PollView, PostSocial, ReactionKind, ReactionSummary, ReactorRow, Vibe,
} from '@shared/social';
import type { DisputeAction } from '@shared/disputes';
import type { Allocation, OrderMoney } from '@shared/payments';
import type { CardDef, QuestView, StickerView } from '@shared/quest';
import type { CollectionGroup, CollectionItem, ShareEvent, ShareKind } from '@shared/models';
import type { LearnDoc } from '@shared/learn';
import type { AffiliateEarningStatus } from '@shared/affiliate';

/** Somebody named on a screen, and the page their name opens. */

/** A shop's quests with its level, as the Grow tab and the Quests page show them. */
export interface ShopQuestBoard {
  view: GrowthView;
  level: StoreLevel;
  handle: string | null;
  name: string;
  photoUrl: string | null;
  levelTag: LevelTag;
  followers: number;
}
export interface PartyRef {
  name: string;
  handle: string | null;
}

/** Evidence as the form collects it: a link and a caption. */
export interface EvidenceDraft {
  url: string;
  caption: string;
}
import type {
  BuyerReversalDetails, Dispute, EscrowRights, Forum, ForwarderProfile, Listing, ListingComment, Lot, Message,
  MessageDeal, MessageParty, Order, OrderShipment, PaymentClaim, PaymentMethod, Post, Review, SellerPaymentDetails, SellerProfile, StageEvent,
  StoreManager, RefundLogEntry, RefundOrigin, DisputeTopic,
  ArtistJob, ArtistOffering, ArtistProfile, FreightLane, InsurancePlan, OrderAddOn, PortfolioPiece, StoreCore, StoreLink,
  StoreMember, StoreRight, StoreStatus, StoreWarehouse,
} from '@shared/models';

/**
 * Typed client for the Functions API. Response types come from the shared
 * contracts, so a server change this code does not handle fails the build.
 */

/** What a Figmark link is about, for drawing it as a card. */
export interface LinkPreview {
  title: string;
  description: string;
  /** A path on this site, or an address elsewhere. */
  image: string;
  /** Where the card opens, inside the app. */
  href: string;
  wide: boolean;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Called when the server rejects our session on any authenticated call.
 *
 * A token the server will not accept is not an error to display on the page -
 * it means we are not signed in and did not notice. Left unhandled it strands
 * the user on a screen repeating "Authentication required" with no way out.
 */
let onSessionRejected: ((method: string) => void) | null = null;

/** The handler is told the method, so a guest's refused write can ask them to sign in. */
export function setSessionRejectedHandler(handler: ((method: string) => void) | null): void {
  onSessionRejected = handler;
}

/** Endpoints where a 401 is a normal answer rather than a lost session. */
const EXPECTS_401 = ['/auth/me', '/auth/login', '/auth/signup'];

/**
 * Reads, shared for a moment.
 *
 * Several panels on one screen ask for the same thing - Orders and Refunds
 * both read the sales book, Analytics and Insights both read the lot figures -
 * and flipping between them used to fetch it again every time. An identical
 * GET made while one is in flight rides the same request, and an answer is
 * reused for a few seconds. Any write empties the lot, so a screen reloading
 * after it has changed something always reads the new state.
 */
const READ_TTL_MS = 5_000;
const reads = new Map<string, { at: number; promise: Promise<unknown> }>();

function forgetReads(): void {
  reads.clear();
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    forgetReads();
    return send<T>(path, init);
  }
  const held = reads.get(path);
  if (held && Date.now() - held.at < READ_TTL_MS) return held.promise as Promise<T>;
  const promise = send<T>(path, init);
  reads.set(path, { at: Date.now(), promise });
  // A failure is not an answer worth keeping: the next ask tries again.
  promise.catch(() => {
    if (reads.get(path)?.promise === promise) reads.delete(path);
  });
  return promise;
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiRequestError(0, 'network_error', `Could not reach the API at /api${path}.`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    if (response.status === 401 && !EXPECTS_401.some((prefix) => path.startsWith(prefix))) {
      onSessionRejected?.((init?.method ?? 'GET').toUpperCase());
    }
    throw new ApiRequestError(
      response.status,
      body?.error ?? 'http_error',
      body?.message ?? `Request failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export interface SellerCard {
  id: string;
  displayName: string;
  storefrontName: string;
  /** The shop's level and title, shown beside its name. */
  level?: { level: number; title: string; shop?: boolean };
  storefrontSlug: string | null;
  /** The shop's handle: its page at `/username`, and where a message lands. */
  username: string | null;
  tier: string;
  dispatchRegion: string | null;
  followerCount: number;
  trustScore: number;
  onTimeDispatchRate: number | null;
  /** Orders delivered without being lost in a dispute. */
  completedSales: number;
  memberSince: string;
  photoUrl?: string | null;
  coverUrl?: string | null;
}

export interface FeedListing extends Listing {
  liked: boolean;
  seller: SellerCard | null;
  /** Inherited from the item's shipment lot; the lot itself stays private. */
  estimatedDispatchAt: string | null;
}

export interface FeedResponse {
  listings: FeedListing[];
  categories: string[];
  followedSellerIds: string[];
}

export type { PreOrderView };

/* ── The collector game ────────────────────────────────────────────────── */

/** What any game write answers with: the new state and what it did to the numbers. */
export interface QuestResult {
  view: QuestView;
  gained: number;
  levelBefore: number;
  levelAfter: number;
  already?: boolean;
  card?: CardDef;
  cardXp?: number;
}

export interface LeaderRow {
  rank: number;
  userId: string;
  name: string;
  handle: string | null;
  xp: number;
  level: number;
  cards: number;
}

/** An average out of 100 (null when unrated), how many, and a count per star from five down to one. */
export interface RatingSummary {
  average: number | null;
  count: number;
  stars: number[];
}

/** A delivered purchase waiting to be added to the collection. */
export interface CollectionCandidate {
  orderId: string;
  listingId: string;
  itemName: string;
  photo: string | null;
  deliveredAt: string;
}

export interface CollectionShelf {
  groups: CollectionGroup[];
  items: CollectionItem[];
}

/** Somebody's public collector page: the game's showable parts and their trade record. */
export interface CollectorPage {
  userId: string;
  level: number;
  title: string;
  xp: number;
  levelFloor: number;
  nextLevelXp: number;
  progress: number;
  streak: { current: number; best: number };
  stickers: StickerView[];
  /** One of each card owned, with how many copies. */
  cards: (QuestView['cards'][number] & { copies: number })[];
  cardCount: number;
  sets: QuestView['sets'];
  /** XP lost to low ratings and lost disputes, as a positive number. */
  penalty: number;
  ratings: { buyer: RatingSummary; seller: RatingSummary; page: RatingSummary };
  stats: {
    rating: number | null;
    ratingCount: number;
    orders: number;
    completed: number;
    reviewsWritten: number;
    preOrders: number;
    following: number;
    disputesWon: number;
    disputesLost: number;
    disputesSettled: number;
    disputesOpen: number;
    memberSince: string;
  };
}

export interface PreOrderMember {
  ref: PartyRef;
  units: number;
  /** They have an order. Whether the money arrived is `paid`. */
  booked: boolean;
  paid: boolean;
  broughtBy: string | null;
  joinedAt: string;
}

export interface PreOrderRoster {
  preOrder: PreOrderView;
  people: PreOrderMember[];
  /** In it, but not named: being named is opt in. */
  unlisted: number;
  mine: { pledged: boolean; booked: number; units: number; listed: boolean } | null;
  /** Who this reader brought in, which is the only reason sharing is worth doing. */
  brought: PartyRef[];
}

/** A post under a listing, with its reactions tallied for this reader. */
export type ListingPost = Omit<ListingComment, 'reactions'> & {
  author: PartyRef;
  moderation?: ModerationMark;
  reactionCounts: Partial<Record<ReactionKind, number>>;
  myReaction: ReactionKind | null;
};

export interface ListingDetail {
  listing: Listing;
  seller: SellerCard | null;
  estimatedDispatchAt: string | null;
  comments: ListingPost[];
  liked: boolean;
  following: boolean;
  isOwn: boolean;
  /** Null on anything that is not being pre-ordered. */
  preOrder: PreOrderRoster | null;
  /** Null unless the shop pays a commission on this item. */
  affiliate: ListingAffiliate | null;
}

export interface ListingAffiliate {
  /** What one sale through a link pays, in paise. */
  amountMinor: number;
  /** What a buyer through somebody's link saves per unit, in paise; 0 when the shop offers none. */
  buyerOffMinor?: number;
  /** Whether the reader may have a link of their own: anybody signed in but the shop. */
  canShare: boolean;
  /** Whose link brought the reader here, if anybody's. */
  referredBy: PartyRef | null;
}

/** One commission in the affiliate's wallet. */
export interface AffiliateEarning {
  orderId: string;
  listingId: string;
  itemName: string;
  sellerName: string;
  /** Commission per unit, in paise, and how many units the order was for. */
  unitMinor: number;
  quantity: number;
  saleMinor: number;
  commissionMinor: number;
  currency: string;
  status: AffiliateEarningStatus;
  placedAt: string | null;
  paidAt: string | null;
  paidReference: string | null;
}

export interface ActivityResponse {
  listings: Listing[];
  /** Orders this account placed. */
  orders: Order[];
  /** Orders placed with this account. */
  sales: Order[];
  likedListingIds: string[];
  following: SellerCard[];
}

export type DirectoryForwarder = ForwarderProfile & { id: string };

/** A lot still taking orders, as the Buy tab's "Boxes filling up" shows it. */
export interface FillingLot {
  id: string;
  name: string;
  number: string;
  sellerId: string;
  shop: { name: string; handle: string | null };
  originCountry: string | null;
  destinationCountry: string | null;
  closesAround: string | null;
  people: number;
  orders: number;
  listings: { id: string; title: string; priceMinor: number; currency: string; photoUrl: string | null }[];
}

/** A power sale announced in its channel, as the Drops shelf shows it. */
export interface DropCardData {
  id: string;
  sellerId: string;
  shop: { name: string; handle: string | null };
  name: string;
  message: string;
  openedAt: string | null;
  startsAt: string;
  live: boolean;
  nextAt: string | null;
  endsAt: string | null;
  itemCount: number;
  itemsOut: number;
  preview: { title: string; priceMinor: number; listPriceMinor: number; out: boolean }[];
  reminders: number;
  reminded: boolean;
  channel: string;
}

/** A step forward that can still be taken back, and until when. */
export interface UndoOffer {
  id: string;
  until: string;
}

export interface LotSummary {
  lot: Lot;
  listingCount: number;
  orderCount: number;
  unitCount: number;
  weightGrams: number;
  valueMinor: number;
  /** The packing tally, from the same orders the counts above came from. */
  tally: LotTally;
}

export interface LotsResponse {
  lots: LotSummary[];
  /** Import listings not yet tagged into any lot. */
  unassigned: Listing[];
  /** Orders sold, bound for a lot, and in none yet. */
  awaitingOrders: number;
}

export interface LotContents {
  lot: Lot;
  listings: Listing[];
  orders: Order[];
  /** The ladder this lot travels and where along it. */
  route: LotRouteView;
  /** The items in it, with who bought each. */
  items: LotItem[];
  /** Every step the lot took and every note written on it, oldest first. */
  history: StageEvent[];
  totals: { lines: number; units: number; weightGrams: number; valueMinor: number };
}

export interface InviteSummary {
  code: string;
  path: string;
  sellerPath: string;
  joined: number;
  sellers: number;
  opens: number;
  recent: { name: string; handle: string | null; seller: boolean; at: string }[];
}

export interface InviteOpen {
  inviter: {
    name: string;
    handle: string | null;
    shop: { name: string; handle: string | null } | null;
    levelTag: LevelTag;
  };
  asSeller: boolean;
  self: boolean;
}

export interface OrderTracking {
  order: Order;
  stages: FulfilmentStage[];
  currentStage: FulfilmentStage;
  /** The lot's ladder, in the seller's own words. Null without a lot. */
  route: {
    name: string;
    steps: RouteStep[];
    currentStep: number;
    /** The item has finished travelling alone and its lot has not moved yet. */
    waitingForLot: boolean;
    lotId: string;
    lotName: string;
    lotNumber: string;
    /** The lot as a whole: filling, closed, in transit, received. */
    lotPhase?: LotBuyerPhase;
  } | null;
  /** The ladder before any lot, in the words the shop's template used. */
  preLot: {
    name: string; steps: RouteStep[]; currentStep: number;
    /** Everything it does alone is done; the wait for a lot is what is left. */
    waitingForLot: boolean;
  };
  /** Sold, bound for a lot, not in one - so the timeline stops early. */
  awaitingLot: boolean;
  sellerName: string;
  /** The shop as a shared picture signs it. */
  sellerBadge?: { photoUrl: string | null; level: number; title: string; shop?: boolean } | null;
  trackingReference: string | null;
  estimatedDispatchAt: string | null;
  /** The item bought, as it is now - for the Details tab's product card. */
  listing: {
    id: string; title: string; photoUrl: string | null;
    preOrder?: { joined: number; threshold: number; cutoffAt: string } | null;
    affiliate?: boolean;
    /** What a friend saves through the sharer's link, in paise. */
    buyerOffMinor?: number;
  } | null;
}

/* ── The order lifecycle ───────────────────────────────────────────────── */

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  direction: string;
  author: PartyRef;
  createdAt: string;
  /** What it was written about. Null only where the order has since gone. */
  item: {
    orderId: string; listingId: string; name: string; totalMinor: number; currency: string;
  } | null;
  /** This viewer wrote it. */
  mine?: boolean;
  moderation?: ModerationMark;
}

/** An opinion left on somebody's page, which nothing had to be bought to write. */
export interface PageReview {
  id: string;
  rating: number;
  body: string;
  authorName: string;
  authorHandle: string | null;
  createdAt: string;
  mine: boolean;
  moderation?: ModerationMark;
}

export interface PageReviews {
  reviews: PageReview[];
  average: number | null;
  count: number;
  /** This viewer's own rating, if they have left one. */
  yours: number | null;
}

/** One side's record, counted from rows rather than stored. */
export interface CreditSide {
  praised: number;
  rated: number;
  goodRate: number | null;
  disputes: number;
  completed: number;
}

export interface Credit {
  memberSince: string;
  asSeller: CreditSide & { sold: number };
  asBuyer: CreditSide & { bought: number };
  seller: RatingSummary;
  buyer: RatingSummary;
  /** Opinions on the page, never mixed into the two above. */
  page: RatingSummary;
  verification: Record<string, string>;
  tier: string | null;
}

/** Someone approved to hold this payment, as the picker lists them. */
export interface EscrowOption {
  id: string;
  name: string;
  feeBasisPoints: number;
  feeMinor: number;
  heldBefore: number;
  since: string;
  /** Payments they have held, ever. */
  held: number;
  /** Of those, the ones that finished - released or refunded. */
  settled: number;
  /** What they are holding right now, including anything in dispute. */
  openNow: number;
  /** Out of five, from their own record. Null until they have settled one. */
  rating: number | null;
}

export interface Checkout {
  itemMinor: number;
  /**
   * Credit this seller kept for the buyer from an earlier order. It is spent
   * on this one the moment it is placed, so what is due now is less by it.
   */
  creditMinor?: number;
  /** Null when the seller takes no advance on this item. */
  advanceMinor: number | null;
  advancePercent: number | null;
  currency: string;
  seller: PartyRef;
  /** Where to send the money on a direct sale. Null when the seller has set none. */
  sellerPayment: SellerPaymentDetails | null;
  /** Empty when nobody approved can be neutral in this trade. */
  escrows: EscrowOption[];
  /** The one the rest of the lot already uses, and why. Never a default. */
  suggested: { agentId: string; name: string; because: string } | null;
}

/** One order waiting on the seller to say whether the money arrived. */
export interface SaleRow {
  id: string;
  /** The listing it was bought from, to see it as it was listed. */
  listingId: string;
  itemName: string;
  /** Bought from a private deal made in a chat. */
  privateDeal?: boolean;
  quantity: number;
  totalMinor: number;
  currency: string;
  buyer: PartyRef;
  paymentStatus: string;
  status: string;
  claim: PaymentClaim | null;
  createdAt: string;
  /* Everything the order card shows, so one screen answers "where is this and
     what does it need" without opening anything. */
  escrowState: string;
  inHand: boolean;
  /** The courier and AWB it went out with, once the seller gave them. */
  shipment: OrderShipment | null;
  /** When the seller ticked it dispatched. */
  dispatchedAt: string | null;
  awaitingLot: boolean;
  lotId: string | null;
  lotName: string | null;
  lotNumber: string | null;
  lotStep: string | null;
  /**
   * The lot's own next move, the same one its Tracking section offers: `to` is
   * the step index, `unchecked` how many of its items the move would carry past
   * the warehouse check-in unticked. Null when not in a lot, or the lot has
   * gone as far as a lot goes.
   */
  lotNext: { to: number; label: string; unchecked: number } | null;
  /** The route's buttons and the lot's moves, one after another, while it rides in a lot. */
  serial: SerialButton[] | null;
  /** Where it is on its lot's route, counted over every step: index and total. */
  routeStep: { at: number; of: number } | null;
  /** When the seller ticked it received at the China warehouse. */
  chinaReceivedAt: string | null;
  /** When the seller ticked it delivered, on the lot's own item list. */
  deliveredAt: string | null;
  /** The route its Quick Post template set up for the lot that will carry it. */
  lotRouteId: string | null;
  /** The seller's next press on this order, in its route's words - null when there is none to make yet. */
  next: CardButton | null;
  /** The furthest press made, for undoing it from the card. */
  done: CardButton | null;
  /** Nothing to press because its lot has to move it first. */
  waitingOnLot: boolean;
  /** True once the buyer chose Book: no charge yet, waiting on acceptance. */
  bookingOnly: boolean;
  accepted: boolean;
  cancelReason: string | null;
  reversal: Order['reversal'];
  canAccept: boolean;
  canCancel: boolean;
  photoUrl: string | null;
  paidMinor: number;
  outstandingMinor: number;
  creditMinor: number;
}

/** One buyer's extra payment, with the orders of theirs it could still go towards. */
export interface ShopCredit {
  orderId: string;
  itemName: string;
  currency: string;
  buyer: PartyRef;
  creditId: string;
  createdAt: string;
  origin: RefundOrigin;
  reason: string | null;
  amountMinor: number;
  refundedMinor: number;
  leftMinor: number;
  status: 'open' | 'held' | 'refund_pending' | 'refunded' | 'applied';
  pendingRefund: { amountMinor: number; reference: string | null; screenshotUrl?: string | null; sentAt: string } | null;
  refundDenials: number;
  disputable: DisputeSubject[];
  /** Where the buyer's money goes back to, if they have said. */
  buyerDetails: BuyerReversalDetails | null;
  /** The seller asked them to add or check those details; open until they do. */
  detailsCheck: Order['detailsCheck'];
  applications: { orderId: string; itemName: string; amountMinor: number; at: string }[];
  targets: { orderId: string; itemName: string; outstandingMinor: number }[];
}

/** Everything a shop's payments screen has to answer, in three piles. */
/** One refund sent, or one amount moved onto another order instead. */
export interface RefundHistoryEntry {
  id: string;
  kind: 'refund' | 'moved';
  orderId: string;
  itemName: string;
  currency: string;
  buyer: PartyRef;
  origin: RefundOrigin;
  reason: string | null;
  amountMinor: number;
  at: string;
  reference: string | null;
  screenshotUrl: string | null;
  status: RefundLogEntry['status'];
  answeredAt: string | null;
  movedTo: string | null;
}

/** An order a fresh refund could be started on, and how much of it could go back. */
export interface RefundableOrder {
  orderId: string;
  itemName: string;
  currency: string;
  createdAt: string;
  buyer: PartyRef;
  buyerDetails: BuyerReversalDetails | null;
  detailsCheck: Order['detailsCheck'];
  refundableMinor: number;
}

/** A buyer's own view of one refund owed to them. */
export interface MyRefund {
  orderId: string;
  itemName: string;
  currency: string;
  sellerName: string;
  creditId: string;
  origin: RefundOrigin;
  reason: string | null;
  createdAt: string;
  amountMinor: number;
  refundedMinor: number;
  leftMinor: number;
  status: ShopCredit['status'];
  pendingRefund: ShopCredit['pendingRefund'];
  log: RefundLogEntry[];
  applications: ShopCredit['applications'];
}

/** One dispute, as either side's list shows it. */
export interface DisputeRow {
  id: string;
  orderId: string;
  itemName: string;
  currency: string;
  counterpartyName: string;
  topic: DisputeTopic;
  label: string;
  amountMinor: number | null;
  reason: string;
  raisedAt: string;
  raisedByMe: boolean;
  raisedBySide: 'buyer' | 'seller';
  status: DisputeStatus;
}

export interface MyDisputesResponse {
  asBuyer: DisputeRow[];
  asStore: DisputeRow[];
  orders: { id: string; itemName: string; side: 'buyer' | 'seller'; counterpartyName: string; createdAt: string }[];
}

export interface SalesResponse {
  credits: ShopCredit[];
  refundHistory: RefundHistoryEntry[];
  refundable: RefundableOrder[];
  waiting: SaleRow[];
  placed: SaleRow[];
  /** Every purchase, newest first: the shop's whole book, cancelled and rejected ones included. */
  orders: SaleRow[];
}

/* ── Power selling ─────────────────────────────────────────────────────── */

/** One item in a scheduled run, and what has happened to it. */
export interface PowerSaleItemView {
  id: string;
  title: string;
  priceMinor: number;
  listPriceMinor: number;
  quantity: number;
  allowMultiple: boolean;
  postedAt: string | null;
  windowEndsAt: string | null;
  liftedAt: string | null;
  listingId: string | null;
  /** Minutes of members' price left, computed server-side. */
  windowLeft: number;
}

export interface PowerSaleView {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'running' | 'done' | 'cancelled';
  openingBody: string;
  openingAt: string;
  leadMinutes: number;
  everyMinutes: number;
  windowMinutes: number;
  closingBody: string;
  openedAt: string | null;
  closedAt: string | null;
  /** Where each item is announced once it goes public. */
  afterWindow: { channel: boolean; feed: boolean };
  /** When the last item hands over and the whole run is public. */
  finishesAt: string | null;
  posted: number;
  total: number;
  items: PowerSaleItemView[];
  createdAt: string;
}

/** A run as the builder submits it. */
export interface PowerSaleDraft {
  storeId?: string;
  name: string;
  openingBody: string;
  openingAt: string | null;
  leadMinutes: number;
  everyMinutes: number;
  windowMinutes: number;
  closingBody: string;
  items: {
    title: string;
    description: string;
    category: string;
    condition: string;
    priceMinor: number;
    listPriceMinor: number;
    quantity: number;
    allowMultiple: boolean;
    costSheet?: { templateId: string | null; templateName: string | null; steps: CostStep[] } | null;
    photos?: { blobName: string; url: string; isPrimary: boolean }[];
    tags?: string[];
    sourcing?: Sourcing;
    quantityMode?: 'fixed' | 'multiple';
    expiresAt?: string | null;
    advancePercent?: number | null;
    lotId?: string | null;
    limitedDays?: number | null;
  }[];
  /** Where each item is announced once its members' window closes. */
  afterWindow?: { channel: boolean; feed: boolean };
}

export interface EscrowHolding {
  order: {
    id: string; itemName: string; currency: string; lotId: string; status: string;
    escrow: Order['escrow']; protection: Order['protection'];
  };
  buyer: PartyRef;
  seller: PartyRef;
  dispute: Dispute | null;
  decidable: boolean;
}

export interface DisputeView {
  dispute: Dispute;
  order: Order;
  side: OrderSide | null;
  actions: DisputeAction[];
  overdue: boolean;
  parties: { buyer: PartyRef; seller: PartyRef };
}

export interface OrderState {
  order: Order;
  side: OrderSide | null;
  /** The other party, named from this viewer's side of the order. */
  counterparty: PartyRef;
  actions: OrderAction[];
  /** Rejections of a payment this viewer made, that they could dispute. */
  disputable: DisputeSubject[];
  /** True while no payment provider is wired; the hold is recorded, not taken. */
  simulatedPayment: boolean;
  myReview: Review | null;
  /** Null while it is still hidden — which is the point of writing yours. */
  theirReview: Review | null;
  theirReviewPending: boolean;
  dispute: Dispute | null;
  /** Seller-side only: whether the buyer has somewhere for a reversal to go. */
  buyerHasReversalDetails: boolean | null;
  /** The protection window operators have set today, in days. */
  autoReleaseDays: number;
  /** Buyer-side: already on one of their collection shelves. */
  inCollection: boolean;
}

/** Out of 100, or null when nobody has rated that side of them yet. */
export interface RatingSummary {
  average: number | null;
  count: number;
}

export interface ReviewsAbout {
  reviews: PublicReview[];
  /** Split, because being a good seller and a good buyer are different claims. */
  asSeller: RatingSummary;
  asBuyer: RatingSummary;
  count: number;
  pending: number;
}

export interface NewListing {
  /** What one unit cost (Pro), step by step. */
  costSheet?: { templateId: string | null; templateName: string | null; steps: CostStep[] } | null;
  /** A private deal for this one buyer: never in the catalog, channels or feed. */
  privateFor?: string | null;
  /** The shop's own item a private deal was made from. */
  dealFromId?: string | null;
  title: string;
  description: string;
  category: string;
  condition: string;
  priceMinor: number;
  quantityAvailable: number;
  quantityMode?: 'fixed' | 'multiple';
  expiresAt?: string | null;
  advancePercent?: number | null;
  /** Commission per unit sold, in paise; null turns it off. */
  affiliateMinor?: number | null;
  /** What a buyer through a link saves per unit, in paise; null turns it off. */
  affiliateOffMinor?: number | null;
  preOrder: { fillThreshold: number; cutoffAt: string } | null;
  /** Omitted when the item goes into a lot, which settles it. */
  sourcing?: Sourcing;
  /** The seller's own lot to file this into, chosen while listing. */
  lotId?: string | null;
  /** The store to list into; absent means your own. */
  storeId?: string;
  /** Sold as one assorted lot rather than as a single named item. */
  bundle?: boolean;
  /** Tell the shop's followers, in its own channel. */
  shareToChannel?: boolean;
  /** Tell everyone, in the feed. Implies the channel — it is the same post. */
  shareToFeed?: boolean;
  tags: string[];
  /** In the order the manager arranged them; the first leads unless told otherwise. */
  photos?: { blobName: string; url: string; isPrimary: boolean }[];
  /** The before-lot ladder a Quick Post template gave it. */
  preLotSteps?: { name: string; description?: string }[];
  preLotName?: string;
  /** The route template a lot made from this item should travel. */
  lotRouteId?: string | null;
}

/** Everything about a lot that can be set when opening it, and corrected later. */
export interface LotDetails {
  name: string;
  description?: string;
  origin?: string;
  originCountry?: string;
  destinationCountry?: string;
  estimatedDispatchAt?: string | null;
  supplierName?: string;
  /** Their account here, by handle. Empty clears the tag and keeps the name. */
  supplierHandle?: string;
  supplierContact?: string;
  supplierReference?: string;
}

/* ── Social ────────────────────────────────────────────────────────────── */

export interface PostCard {
  post: Post;
  listing: {
    id: string; title: string; priceMinor: number; currency: string; condition: string; photoUrl?: string | null;
    /** Whether it can still be bought; absent on older answers. */
    buyable?: boolean;
    /** How many are left, when few enough to say. */
    left?: number | null;
    /** A group pre-order's fill. */
    fill?: { joined: number; total: number; cutoffAt: string } | null;
  } | null;
  /** Where the author's name goes. Resolved on read, not frozen into the post. */
  author: PartyRef;
  /** Reactions, comments, shares and the poll, as this viewer sees them. */
  social: PostSocial;
  /** Whether the viewer follows the channel it was posted in. */
  following: boolean;
  /** What a repost passes on. Null when the original has been taken down. */
  original?: PostCard | null;
  /** The forum it was said in, when read anywhere but that forum. */
  forum?: { id: string; name: string } | null;
  /** Other forums the same post went to. */
  alsoIn?: { id: string; name: string }[];
  /** Said by a shop in its own name, so it has a channel to open. */
  shop?: boolean;
  /** Why the home feed shows it: trending anywhere, or new and rising past its followers. */
  badges?: PostBoost[];
}

export type PostBoost = 'trending' | 'rising';

/** One post read in full, with everything said under it. */
export interface PostDetail {
  card: PostCard;
  comments: CommentThread[];
}

export interface ChannelRow {
  sellerId: string;
  name: string;
  handle: string | null;
  photoUrl: string | null;
  tier: string | null;
  /** Whether you may speak for this shop. Yours sorts to the top. */
  mine: boolean;
  lastPost: string | null;
  lastPostAt: string | null;
  lastPostKind: string | null;
  lastPostBy?: string | null;
  bio?: string;
  followerCount?: number;
  following?: boolean;
  /** Whether it has something pinned for newcomers. */
  pinned?: boolean;
  /** When its newest messages from other people arrived, for counting what is new. */
  recent?: string[];
}

export interface ChannelThread {
  /** A shop's channel you do not follow: only the door is shown. */
  locked?: boolean;
  channel: {
    id: string;
    kind: 'seller' | 'forum';
    name: string;
    description: string;
    handle?: string | null;
    photoUrl?: string | null;
    tier?: string | null;
    followerCount?: number;
    following?: boolean;
    /** Whether you may post as this shop rather than as a customer. */
    mine: boolean;
    postCount?: number;
    /** Forums: how many are in it, and whether you are. */
    memberCount?: number;
    member?: boolean;
    /** Forums: what you are in it - its founder (admin), a moderator, a member. */
    role?: ForumRole | null;
    rules?: string;
    banned?: boolean;
  };
  /** The shop's own items, for putting one in front of followers. Empty unless it is yours. */
  shareable: { id: string; title: string; priceMinor: number; currency: string; condition?: string; photoUrl?: string | null }[];
  posts: PostCard[];
}

/** Which voice a social call speaks in: a shop's id, or nothing for the person. */
function voice(as?: string | null): string {
  return as ? `?as=${encodeURIComponent(as)}` : '';
}

/** One of a shop's items, offered for putting in a post. */
export interface ShareableListing {
  id: string;
  title: string;
  priceMinor: number;
  currency: string;
  condition: string;
  photoUrl: string | null;
}

/** Where one post lives on the API. */
function postPath(channelId: string, id: string): string {
  return `/social/posts/${encodeURIComponent(channelId)}/${encodeURIComponent(id)}`;
}

/* ── Wanted ────────────────────────────────────────────────────────────── */

export interface WantCard {
  id: string;
  buyerId: string;
  buyer: PartyRef;
  title: string;
  details: string;
  category: string;
  budgetMinor: number | null;
  currency: string;
  /** What they are in search of, if they had a photo. */
  photoUrls: string[];
  condition: string | null;
  status: 'open' | 'closed';
  offerCount: number;
  /** How many people are hunting for the same thing. */
  seekerCount: number;
  /** Whether you are one of them, so the button under the card knows. */
  joined: boolean;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
}

export interface WantOfferRow {
  id: string;
  seller: PartyRef;
  /** A collector answering, or a shop. */
  voice: 'person' | 'shop';
  message: string;
  priceMinor: number | null;
  createdAt: string;
  listing: { id: string; title: string; priceMinor: number; currency: string; condition: string } | null;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Where tapping it goes. */
  link: string;
  read: boolean;
  createdAt: string;
}

export interface WantDetail {
  want: WantCard;
  mine: boolean;
  /** Whether you have put your name to it. */
  joined: boolean;
  seekerCount: number;
  /** Your own answer, if you have already made one. */
  yours: { id: string; message: string; priceMinor: number | null; listingId: string | null } | null;
  /** Your answers by the voice you gave them in. */
  yoursBy: Partial<Record<'person' | 'shop', { id: string; message: string; priceMinor: number | null; listingId: string | null }>>;
  offers: WantOfferRow[];
}

export type ForumRole = 'admin' | 'moderator' | 'member';

/** A forum as a list shows it. */
export interface ForumRow extends Omit<Forum, 'memberIds' | 'moderatorIds' | 'bannedIds' | 'warnings'> {
  role: ForumRole | null;
  memberCount: number;
  member: boolean;
  lastPost: string | null;
  lastPostAt: string | null;
  lastPostBy: string | null;
}

export interface ForumsResponse {
  forums: ForumRow[];
  cap: number;
  remaining: number;
  /** Your own allowance: a forum at level 5, then one more at 7, 8, 9 and 10. */
  slots?: {
    level: number; opened: number; allowed: number; canCreate: boolean;
    nextLevel: number | null; unlockLevels: number[]; message: string | null;
  };
}

export interface ForumMember { id: string; name: string; handle: string | null; role: ForumRole; warnings: number }
export interface ForumMembers {
  role: ForumRole | null;
  members: ForumMember[];
  banned: { id: string; name: string; handle: string | null }[];
  warnings: { userId: string; name: string; by: string; note: string; at: string }[];
  moderatorsMax: number;
}
export type ForumModAction = 'add' | 'remove' | 'ban' | 'unban' | 'warn' | 'promote' | 'demote' | 'edit';
export interface FollowRow { id: string; name: string; handle: string | null; isStore: boolean }
export interface BlockedRow { id: string; name: string; handle: string | null; shop: { name: string; handle: string | null } | null }

/** What the social search finds. */
export interface SocialSearchResult {
  people: { id: string; name: string; handle: string | null; bio: string; following: boolean }[];
  shops: {
    id: string; name: string; handle: string | null; bio: string; photoUrl: string | null;
    followerCount: number; tier: string | null; following: boolean; mine: boolean;
  }[];
  forums: ForumRow[];
}

/* ── Seller dashboards ─────────────────────────────────────────────────── */

export interface DashboardResponse {
  analytics: {
    revenueMinor: number;
    unitsSold: number;
    orderCount: number;
    activeListings: number;
    views: number;
    saves: number;
    conversion: number;
    daily: { date: string; orders: number; revenueMinor: number }[];
    topListings: { id: string; title: string; viewCount: number; likeCount: number; unitsSold: number }[];
  };
}

/* ── Pro analytics ─────────────────────────────────────────────────────── */

export interface WeekFigures { saves: number; buys: number; orders: number; revenueMinor: number }

/** One of the shop's own items, and how it is moving. */
export interface TrendingRow {
  listingId: string; title: string; photo: string | null; category: string;
  saves: number; buys: number; orders: number; score: number;
  /** Fourteen days of weighted activity, oldest first. */
  spark: number[];
  rank: number; prevRank: number | null;
  trend: 'new' | 'up' | 'steady' | 'down';
  soldOut: boolean; stockLeft: number | null; daysLeft: number | null; perWeek: number;
}

/** One lot, item or customer's real profit, from each item's saved costs. */
export interface ProfitRow {
  key: string;
  name: string;
  sub: string | null;
  photo: string | null;
  orders: number;
  units: number;
  revenueMinor: number;
  costMinor: number;
  profitMinor: number;
  marginPercent: number | null;
  uncostedUnits: number;
  stages: Record<CostStage, number>;
  steps: { id: string; label: string; stage: CostStage; amountMinor: number }[];
}

export interface ProfitSplit { active: ProfitRow[]; closed: ProfitRow[] }

export interface SheetItem {
  listingId: string;
  title: string;
  photo: string | null;
  priceMinor: number;
  currency: string;
  lotName: string | null;
  onSale: boolean;
  sold: number;
  sheet: ItemCostSheet | null;
  costMinor: number;
  /** What Remove steps back to; null when removing clears the costs. */
  previousCostMinor: number | null;
}

/** `GET /api/me/costs` - real profit per lot, item and customer. */
export interface CostsResponse {
  totals: { active: ProfitRow; closed: ProfitRow };
  lots: ProfitSplit;
  items: ProfitSplit;
  customers: ProfitSplit;
  handles: Record<string, string | null>;
  sheets: SheetItem[];
}

export type ValueLabel = 'vip' | 'regular' | 'at_risk' | 'one_time' | 'new';

/** `GET /api/me/deep` - the deeper Pro figures. */
export interface DeepResponse {
  cohorts: { month: string; size: number; back: (number | null)[] }[];
  value: {
    counts: Record<ValueLabel, number>;
    averageMinor: number;
    rows: { who: PartyRef; orders: number; spentMinor: number; lastAt: string; label: ValueLabel }[];
  };
  pricing: {
    listingId: string; title: string; photo: string | null; currency: string;
    periods: { priceMinor: number; from: string; days: number; saves: number; units: number; perWeek: number }[];
  }[];
  forecast: {
    cycleDays: number;
    conversionPercent: number;
    rows: { listingId: string; title: string; photo: string | null; perWeek: number; waiting: number; pledged: number; inStock: number | null; next: number }[];
  };
  reminders: {
    buyerId: string; who: PartyRef; listingId: string; title: string; photo: string | null; currency: string;
    wasMinor: number; nowMinor: number; reason: 'cheaper' | 'restocked'; savedAt: string;
  }[];
  bundles: { count: number; items: { listingId: string; title: string; photo: string | null; priceMinor: number }[] }[];
  returns: {
    overall: { orders: number; cancelled: number; disputed: number; ratePercent: number };
    items: { listingId: string; title: string; orders: number; cancelled: number; disputed: number; ratePercent: number }[];
    categories: { category: string; orders: number; cancelled: number; disputed: number; ratePercent: number }[];
  };
}

export interface SalesFigures { orders: number; units: number; revenueMinor: number; customers: number }

/** `GET /api/me/sales` - the free Analytics figures. */
export interface SalesResponse {
  days: number;
  bucket: 'day' | 'week' | 'month';
  totals: SalesFigures;
  before: SalesFigures;
  series: { start: string; orders: number; revenueMinor: number }[];
  best: {
    units: { listingId: string; title: string; photo: string | null; units: number; revenueMinor: number }[];
    revenue: { listingId: string; title: string; photo: string | null; units: number; revenueMinor: number }[];
  };
  ageing: {
    fresh: { count: number; amountMinor: number };
    week: { count: number; amountMinor: number };
    old: { count: number; amountMinor: number };
    rows: { orderId: string; who: PartyRef; title: string; outstandingMinor: number; currency: string; days: number }[];
  };
  sources: ({ source: 'shared' | 'sale' | 'preorder' | 'shop' } & SalesFigures)[];
  stock: { listingId: string; title: string; photo: string | null; left: number; soldRecently: number }[];
  rows: {
    date: string; orderId: string; item: string; buyer: string; handle: string | null; quantity: number;
    unitPriceMinor: number; totalMinor: number; paidMinor: number; outstandingMinor: number;
    currency: string; status: string; payment: string; lot: string;
  }[];
}

export type NudgeRequest =
  | { kind: 'payment' | 'checkout'; orderId: string }
  | { kind: 'saved'; listingId: string; buyerId: string };

/** `GET /api/me/market` - other sellers' items in this shop's categories, as rough levels only. */
export interface MarketResponse {
  categories: {
    category: string; level: 'hot' | 'rising' | 'steady' | 'quiet';
    trend: 'up' | 'steady' | 'down'; supply: 'crowded' | 'some' | 'few';
  }[];
  items: { title: string; photo: string | null; category: string; priceMinor: number; currency: string; level: 'hot' | 'rising' | 'steady' }[];
  prices: {
    listingId: string; title: string; category: string; priceMinor: number; currency: string;
    low: number; mid: number; high: number; position: 'below' | 'within' | 'above';
  }[];
  wanted: { title: string; category: string; budgetMinor: number | null; demand: 'many' | 'several' | 'one' }[];
}

/** One customer of a shop, as Insights (Pro) reads them. */
export interface CustomerRow {
  who: PartyRef; orders: number; spentMinor: number; firstAt: string; lastAt: string;
  returning: boolean; daysSince: number;
}

/** `GET /api/me/interest` - the Insights (Pro) tab: who wants what. */
export interface InterestResponse {
  summary: {
    views: number;
    saves: number;
    buyClicks: number;
    stalled: number;
    stalledMinor: number;
    orders: number;
    paid: number;
    placedPercent: number | null;
  };
  saved: {
    listingId: string; title: string; photo: string | null; priceMinor: number; currency: string;
    people: { who: PartyRef; savedAt: string; state: 'saved' | 'checkout' | 'bought' }[];
  }[];
  checkout: {
    orderId: string; listingId: string; title: string; photo: string | null; who: PartyRef;
    firstAt: string; lastAt: string; clicks: number; amountMinor: number; currency: string;
    stillForSale: boolean; boughtElsewhere: boolean;
  }[];
  items: {
    listingId: string; title: string; photo: string | null; live: boolean; views: number; saves: number;
    buyClicks: number; orders: number; paid: number; revenueMinor: number; currency: string; expiresAt: string | null;
  }[];
  leads: { who: PartyRef; saves: number; checkouts: number; lastAt: string }[];
  customers: {
    total: number; returning: number; newcomers: number; dormant: number;
    repeatPercent: number | null; avgOrderMinor: number;
    top: CustomerRow[]; returningList: CustomerRow[]; newList: CustomerRow[]; dormantList: CustomerRow[];
  };
  trending: TrendingRow[];
  categories: { category: string; score: number; before: number }[];
  week: { now: WeekFigures; before: WeekFigures };
  /** Oldest first, today last. */
  daily: { saves: number; buys: number; orders: number }[];
  overlooked: { listingId: string; title: string; photo: string | null; views: number }[];
  expiring: { listingId: string; title: string; expiresAt: string | null; saves: number; buyClicks: number }[];
  activity: string[];
}

/**
 * What the consignments have been doing, read off the packing board.
 *
 * The shapes mirror `GET /api/me/insights`. The maths lives in
 * `@shared/insights`, so the labels a card prints and the numbers the server
 * computed come from the same file.
 */
export interface InsightsResponse {
  headline: {
    ordersInFlight: number;
    valueInFlightMinor: number;
    unpaidMinor: number;
    customers: number;
    openLots: number;
    oldestWaitingDays: number;
  };
  boxes: BoxEstimate;
  /** Average days per segment, across every order. Null where nothing has. */
  timings: Timings;
  perLot: {
    lotId: string;
    lotName: string;
    orders: number;
    customers: number;
    valueMinor: number;
    unpaidMinor: number;
    /** 0-100, weighted across the checkpoints rather than counting the last. */
    progress: number;
    phase: LotPhase;
    timings: Timings;
    doorToDoor: number | null;
  }[];
  pending: {
    buyerId: string;
    who: PartyRef;
    orders: number;
    totalMinor: number;
    waitingDays: number;
  }[];
  cohorts: { lotName: string; newCount: number; returningCount: number }[];
  top: { buyerId: string; who: PartyRef; orders: number; lots: number; totalMinor: number }[];
  /** How many customers have bought across more than one consignment. */
  repeat: number;
  dormant: { buyerId: string; who: PartyRef; lastLotName: string; lotsAgo: number }[];
  bulk: { buyerId: string; who: PartyRef; lotName: string; count: number }[];
  preOrders: {
    listingId: string;
    title: string;
    threshold: number;
    booked: number;
    pledged: number;
    filled: boolean;
    closedShort: boolean;
  }[];
  powerSales: { runs: number; posted: number; inWindow: number; handedOver: number };
  /** Balances on accepted orders, by buyer. Largest first. */
  toCollect: { who: PartyRef; outstandingMinor: number; orders: number; currency: string }[];
}

/* ── Services ──────────────────────────────────────────────────────────── */

/** Somebody offering a service, as the directory shows them. */
export interface ProviderCard {
  userId: string;
  name: string;
  handle: string | null;
  /** The route, the cities, or the fee — whatever identifies this kind. */
  line: string;
  description: string;
  contact: string | null;
  trustScore: number | null;
  completed: number | null;
  /** A store page to open, for forwarders and artists. */
  slug?: string | null;
  tagline?: string;
  logoUrl?: string | null;
  accent?: string | null;
}

export interface ServicesHub {
  /** Every category, with how many offer it where there is a list. */
  categories: (ServiceMeta & { count: number | null })[];
  /** What this account already provides, in the order the goods move. */
  mine: ServiceKind[];
}

export interface ServiceDirectory {
  service: ServiceMeta;
  providers: ProviderCard[];
}

/** A lot consigned to this forwarder. */
export interface ConsignmentRow {
  store: { ownerId: string; name: string; handle: string | null };
  lot: {
    id: string;
    name: string;
    stage: FulfilmentStage;
    origin: string;
    estimatedDispatchAt: string | null;
    trackingReference: string | null;
  };
  pieces: number;
  weightGrams: number;
}

/** A lot this handler has to get out, counted in parcels. */
export interface DistributionRow {
  store: { ownerId: string; name: string; handle: string | null };
  lot: { id: string; name: string; stage: FulfilmentStage; origin: string };
  city: string | null;
  parcels: number;
  dispatched: number;
  tally: LotTally;
}

export interface DistributionLot {
  store: { ownerId: string; name: string; handle: string | null };
  lot: { id: string; name: string; stage: FulfilmentStage; origin: string };
  city: string | null;
  tally: LotTally;
  /** One per buyer: the parcel, and what goes in it. */
  parcels: {
    buyerId: string;
    name: string;
    phone: string | null;
    items: {
      id: string;
      itemName: string;
      condition: string;
      quantity: number;
      unitWeightGrams: number;
      checkpoints: Partial<Record<OrderCheckpoint, string | null>>;
    }[];
  }[];
}

/* ── Routes and the items that ride them ───────────────────────────────── */

export interface RoutePreset {
  id: string;
  name: string;
  blurb: string;
  steps: RouteStep[];
}

export interface RoutesResponse {
  routes: TrackingRoute[];
  /** Per route: how many unfinished lots ride it, and how many carry an older copy. */
  usage: Record<string, { lots: number; behind: number }>;
  /** The seven stages this app has always had, as a route you can pick. */
  builtIn: { routeId: string | null; name: string; steps: RouteStep[] };
  /** The shapes a shop can start from, described. */
  presets: RoutePreset[];
  /** What a blank route opens with, so nobody starts at an empty list. */
  suggested: RouteStep[];
  /** The logistics-scenario cards: where an order enters the lot's journey. */
  routeTemplates: (RoutePreset & { icon: StageIcon })[];
}

/** An item that could go in a lot: sold, bound for one, not in one. */
export interface CandidateItem {
  id: string;
  /** The listing it was bought from. */
  listingId: string;
  itemName: string;
  condition: string;
  quantity: number;
  buyerId: string;
  buyerName: string;
  buyerHandle: string | null;
  unitWeightGrams: number;
  createdAt: string;
}

/** An item as the lot page lists it. */
export interface LotItem {
  id: string;
  itemName: string;
  condition: string;
  quantity: number;
  status: string;
  buyerId: string;
  buyerName: string;
  buyerHandle: string | null;
  checkpoints: Partial<Record<OrderCheckpoint, string | null>>;
  /** Every press, custom buttons included, keyed as the route's buttons are. */
  ticks: Record<string, string | null>;
  receivedAs: string | null;
  /** Where this item is on the lot's route. The lot's position unless moved alone. */
  currentStep: number;
  /** True when the seller moved this one item away from the rest of the lot. */
  ownStep: boolean;
  /** Done travelling alone, and the lot has not moved yet. */
  waitingForLot: boolean;
  /** This item's own history, which is what its buyer reads. */
  history: StageEvent[];
}

export interface LotRouteView {
  name: string;
  routeId: string | null;
  /** The whole route, both halves. Items travel all of it; the lot does not. */
  steps: RouteStep[];
  /** Where the lot is, as an index into the whole route. */
  currentStep: number;
  /**
   * Where the lot's own half starts.
   *
   * A lot never gets "received at the international warehouse" - its items do,
   * before they are in it. So the lot's screen draws `steps.slice(offset)`,
   * and a lot at `offset - 1` is open and filling, nothing dispatched.
   */
  offset: number;
  /** Once the lot is with the seller, items are finished one at a time. */
  atSeller: boolean;
  lotNumber: string;
}

/** One lot of a buyer's items, with the single timeline they share. */
export interface ItemGroup {
  key: string;
  kind: 'lot' | 'awaiting' | 'direct';
  lot: {
    id: string;
    name: string;
    number: string;
    routeName: string;
    steps: RouteStep[];
    currentStep: number;
    estimatedDispatchAt: string | null;
    trackingReference: string | null;
    phase: LotBuyerPhase;
    /** Where the lot itself is on its route. */
    lotStep: number;
    originCountry: string | null;
    destinationCountry: string | null;
    /** People with an item in this lot, the buyer included. */
    people: number;
  } | null;
  sellerName: string;
  sellerHandle: string | null;
  sellerId: string;
  items: (OrderMoney & {
    id: string;
    /** The listing it was bought from, to see it as it was listed. */
    listingId: string;
    itemName: string;
    quantity: number;
    status: string;
    paymentStatus: string;
    currency: string;
    photo: string | null;
    method: PaymentMethod;
    canPayMore: boolean;
    /** False while the buyer has pressed Buy but not yet paid or booked. */
    placed: boolean;
    /** This item's own step on its lot's route; null outside a lot. */
    stepAt: number | null;
    checkpoints: Partial<Record<OrderCheckpoint, string | null>>;
    /** When it reached the buyer, or null while it is still on its way. */
    deliveredAt: string | null;
    /** Delivered and already on a collection shelf. */
    inCollection: boolean;
    /** Payment still held under buyer protection. */
    paymentHeld: boolean;
    /** When the buyer confirmed it reached them, or null. */
    receivedAt: string | null;
    /** The buyer can tap "I received it" (or "Yes, it arrived") now. */
    canConfirm: boolean;
    /** Placed as a booking: no payment until the seller accepts. */
    bookingOnly: boolean;
    /** The seller has said yes. */
    accepted: boolean;
    /** The buyer may pay for it now. */
    canPay: boolean;
    /** The seller said a claimed payment never arrived. */
    claimDenied: boolean;
    /** Ships from the seller's shelf rather than in a lot. */
    inHand: boolean;
    shipment: OrderShipment | null;
    /** Held money under dispute. */
    disputed: boolean;
    createdAt: string;
  })[];
}

/* ── Quick Post templates and photos ───────────────────────────────────── */

/** A photo as the manager holds it: uploaded, or a link somebody pasted. */
/** One of a shop's items, as the private-deal picker lists it. */
export interface DealItem {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  priceMinor: number;
  currency: string;
  quantityAvailable: number;
  tags: string[];
  photos: PhotoDraft[];
  state: DealState;
}

export interface PhotoDraft {
  blobName: string;
  url: string;
  isPrimary: boolean;
}

export interface StoredPhoto {
  blobName: string;
  url: string;
}

export interface StorefrontDraft {
  storefrontName?: string;
  username?: string;
  bio?: string;
  dispatchRegion?: string;
  photoUrl?: string;
  coverUrl?: string;
  tags?: string[];
  link?: string;
  /** How a buyer pays this shop directly. Null clears it. */
  payment?: SellerPaymentDetails | null;
}

/* ── Lot board (tracking) ──────────────────────────────────────────────── */

export interface BoardLot {
  id: string;
  name: string;
  /** The short sayable identifier, e.g. "26-832C". */
  lotNumber?: string | null;
  stage: FulfilmentStage;
  status: string;
  origin: string;
  estimatedDispatchAt: string | null;
  updatedAt?: string;
}

export interface BoardOrder {
  id: string;
  itemName: string;
  condition: string;
  quantity: number;
  unitWeightGrams: number;
  checkpoints: Partial<Record<OrderCheckpoint, string | null>>;
}

export interface BoardCustomer {
  buyerId: string;
  name: string;
  phone: string | null;
  orders: BoardOrder[];
  trackingReference: string | null;
}

export interface LotBoard {
  lot: BoardLot;
  tally: LotTally;
  customers: BoardCustomer[];
}

/* ── Messages ──────────────────────────────────────────────────────────── */

export interface ThreadRow {
  threadId: string;
  us: MessageParty;
  them: MessageParty;
  lastMessage: string;
  lastAt: string;
  lastFromUs: boolean;
  unread: number;
  /** Kept, but its messages are not counted. */
  muted?: boolean;
}

export interface Inbox {
  handles: MessageParty[];
  threads: ThreadRow[];
}

export interface Thread {
  us: MessageParty;
  them: MessageParty;
  /** Every handle the caller speaks as, so the thread can offer a switch. */
  handles: MessageParty[];
  threadId: string;
  messages: Message[];
  /** More to page back to, before the first of `messages`. */
  more?: boolean;
  /** You blocked them: nothing goes either way until you unblock. */
  blocked?: boolean;
  /** Kept, but not counted as unread. */
  muted?: boolean;
}

/** Which of an account's two pages: its shop, or the person behind it. */
export type PageSide = 'store' | 'person';

export type ShelfState = 'active' | 'sold' | 'expired';

export interface PublicProfile {
  handle: string;
  isStore: boolean;
  displayName: string;
  bio: string;
  photoUrl: string | null;
  coverUrl: string | null;
  tags: string[];
  link: string | null;
  dispatchRegion: string;
  followerCount: number;
  /** Whether this viewer follows this page (the shop and the person apart). */
  following: boolean;
  /** Ratings after trades and ratings left on this page, as one figure. */
  rating: MergedRating;
  tier: string | null;
  ownerHandle: string | null;
  sellerId: string;
  /** A shop's seller trust, 0-100; null on a person's page. */
  trustScore: number | null;
  /** A shop's level and milestone stickers; null and empty on a person's page. */
  level: StoreLevel | null;
  stickers: StickerView[];
  /** The level and title shown beside the name. */
  levelTag: { level: number; title: string; shop?: boolean };
  memberSince: string;
  lastSeenAt: string | null;
  counts: { listings: number; onSale: number; sold: number; expired: number };
  /** Active first, then sold out, then expired. */
  listings: {
    id: string; title: string; priceMinor: number; currency: string; condition: string;
    quantityAvailable: number; likeCount: number; state: ShelfState;
    affiliate?: { amountMinor?: number; percent?: number; buyerOffMinor?: number | null } | null;
    photos?: { url?: string; isPrimary?: boolean }[];
  }[];
}

/* ── Supplier ──────────────────────────────────────────────────────────── */

export interface SupplierItem {
  id: string;
  itemName: string;
  condition: string;
  quantity: number;
  unitWeightGrams: number;
  received: boolean;
  packed: boolean;
}

export interface SupplierStore {
  ownerId: string;
  name: string;
  /** The shop's handle, so the packer can tell it a crate has landed. */
  handle: string | null;
}

export interface SupplierLot {
  store: SupplierStore;
  lot: { id: string; name: string; stage: FulfilmentStage; origin: string };
  tally: LotTally;
  items: SupplierItem[];
}


/* ── Service stores ──────────────────────────────────────────────────── */

/** A store as the person running it sees it in My services. */
export interface MyStoreRow {
  kind: StoreKind;
  ownerId: string;
  isOwner: boolean;
  rights: StoreRight[];
  name: string;
  slug: string;
  tagline: string;
  logoUrl: string | null;
  accent: string;
  status: StoreStatus | null;
  /** Lots waiting on an answer, or commissions waiting on a move. */
  waiting: number;
  active: number;
  lastNote: string | null;
}

/** A lot somebody else's shop named this person on. */
export interface CrewRow {
  role: CrewRole;
  store: { ownerId: string; name: string; handle: string | null };
  lot: CrewLotRef;
  items: number;
  parcels: number;
  /** The words on the buttons the route handed them. */
  buttons: string[];
  /** Items still waiting on one of those presses. */
  toPress: number;
}

export interface CrewLotRef {
  id: string;
  sellerId: string;
  name: string;
  number: string;
  stage: string;
  status: string;
  origin: string;
  step: string;
  stepIndex: number;
  steps: number;
}

export interface MyServicesView {
  stores: MyStoreRow[];
  crew: CrewRow[];
  own: { forwarder: StoreStatus | null; artist: StoreStatus | null };
  handler: boolean;
  escrow: boolean;
}

export interface CrewLotView {
  role: CrewRole;
  roles: CrewRole[];
  store: { ownerId: string; name: string; handle: string | null };
  forwarder: { ownerId: string; name: string } | null;
  lot: CrewLotRef & { laneLabel: string | null; trackingReference: string | null; city: string | null };
  steps: { index: number; name: string; assignee: StepAssignee | null; key: string | null }[];
  buttons: { key: string; label: string; step: string; index: number; assigned: boolean }[];
  moves: { index: number; name: string; forward: boolean }[];
  items: {
    id: string; itemName: string; condition: string; quantity: number; weightGrams: number;
    parcel: string | null; buyer: { name: string; phone: string | null } | null;
    ticks: Record<string, string | null>; covered: boolean; toStudio: boolean;
  }[];
}

/** Everything a store form edits. */
export type StoreDraft = Partial<StoreCore> & Partial<Pick<ForwarderProfile, 'lanes' | 'insurance' | 'warehouse' | 'autoAccept' | 'claimedMonthlyCapacityKg'>>
  & Partial<Pick<ArtistProfile, 'specialties' | 'offerings' | 'portfolio' | 'acceptingWork' | 'studioAddress'>>;

export interface StoreConsole {
  kind: StoreKind;
  ownerId: string;
  ownerName: string;
  handle: string | null;
  isOwner: boolean;
  rights: StoreRight[];
  status: StoreStatus | null;
  store: StoreCore & Partial<ForwarderProfile> & Partial<ArtistProfile>;
}

export interface ForwarderLotRow {
  store: { ownerId: string; name: string; handle: string | null };
  lot: CrewLotRef;
  laneLabel: string | null;
  acceptance: 'pending' | 'accepted' | 'declined';
  trackingReference: string | null;
  pieces: number;
  weightGrams: number;
  covered: number;
  premiumsMinor: number;
  coverMinor: number;
}

export interface ArtistJobRow {
  orderId: string;
  item: { name: string; condition: string; quantity: number };
  buyer: { name: string; handle: string | null };
  shop: { ownerId: string; name: string; handle: string | null } | null;
  job: ArtistJob;
  actions: ArtistJobAction[];
}

export interface StoreWork {
  kind: StoreKind;
  lots: ForwarderLotRow[];
  jobs: ArtistJobRow[];
}

/** A store's public page. */
export interface PublicStore {
  kind: StoreKind;
  ownerId: string;
  handle: string | null;
  name: string;
  slug: string;
  tagline: string;
  about: string;
  logoUrl: string | null;
  coverUrl: string | null;
  accent: string;
  city: string;
  country: string;
  registered: boolean;
  since: number | null;
  links: StoreLink[];
  contactEmail: string | null;
  contactPhone: string | null;
  trust: { score: number; completedTransactions: number };
  teamSize: number;
  status: StoreStatus | null;
  lanes: FreightLane[];
  insurance: InsurancePlan[];
  warehouse: StoreWarehouse | null;
  autoAccept: boolean;
  capacityKg: number | null;
  offerings: ArtistOffering[];
  portfolio: PortfolioPiece[];
  specialties: string[];
  acceptingWork: boolean;
}

export interface OrderServicesView {
  side: 'buyer' | 'seller';
  insurance: {
    open: boolean;
    provider: { ownerId: string; name: string; slug: string } | null;
    valueMinor: number;
    plans: (InsurancePlan & { premiumMinor: number; coverMinor: number })[];
    current: OrderAddOn | null;
  };
  commission: {
    job: ArtistJob | null;
    actions: ArtistJobAction[];
    artist: PublicStore | null;
    artistPayment: SellerPaymentDetails | null;
    studioAddress: string | null;
    artists: PublicStore[];
    escrows: { id: string; name: string; feeBasisPoints: number }[];
  };
}

export interface OpsStoreRow {
  kind: StoreKind;
  owner: { id: string; displayName: string; email: string; phone: string | null; username: string | null; createdAt: string; suspended: boolean };
  status: StoreStatus;
  submittedAt: string | null;
  store: PublicStore;
  businessId: string | null;
  history: { at: string; by: string; status: StoreStatus; note: string }[];
  team: StoreMember[];
  payment: boolean;
  studioAddress: string | null;
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  me: () => request<MeResponse>('/auth/me'),

  login: (identifier: string, password: string) =>
    post<LoginResponse>('/auth/login', { identifier, password }),

  signup: (body: { displayName: string; username?: string; email: string; phone: string; password: string }) =>
    post<LoginResponse>('/auth/signup', body),

  logout: () => post<{ ok: true }>('/auth/logout'),

  feed: (params: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    const suffix = query.toString();
    return request<FeedResponse>(`/feed${suffix ? `?${suffix}` : ''}`);
  },

  listing: (id: string, ref?: string | null) =>
    request<ListingDetail>(`/listings/${encodeURIComponent(id)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`),
  similar: (id: string) => request<{ listings: FeedListing[] }>(`/listings/${encodeURIComponent(id)}/similar`),
  affiliateLink: (listingId: string) =>
    post<{ code: string; path: string }>(`/listings/${encodeURIComponent(listingId)}/affiliate-link`, {}),
  openShortLink: (code: string) => request<{ listingId: string }>(`/r/${encodeURIComponent(code)}`),
  myAffiliate: () => request<{ earnings: AffiliateEarning[] }>('/me/affiliate'),
  /** Tell the server something went out of the app, so the share quests count it. */
  logShare: (body: { kind: ShareKind; via: ShareEvent['via']; target?: string | null; storeId?: string | null }) =>
    post<{ ok: true }>('/share/log', body),
  myInvite: () => request<InviteSummary>('/invite/me'),
  openInvite: (code: string, page?: { t: 'item' | 'shop' | 'profile'; id: string } | null, asSeller = false) => {
    const query = new URLSearchParams();
    if (page) { query.set('t', page.t); query.set('id', page.id); }
    if (asSeller) query.set('as', 'seller');
    const suffix = query.toString();
    return request<InviteOpen>(`/i/${encodeURIComponent(code)}${suffix ? `?${suffix}` : ''}`);
  },
  growth: (ownerId: string) => request<ShopQuestBoard>(`/growth/${encodeURIComponent(ownerId)}`),
  /** One quest by id, or every one that is ready with `'all'`. */
  claimGrowth: (ownerId: string, taskId: string | 'all') =>
    post<ShopQuestBoard & { gained: { bumps: number; xp: number; quests: number } }>(
      `/growth/${encodeURIComponent(ownerId)}/claim`, taskId === 'all' ? { all: true } : { taskId },
    ),
  markAffiliatePaid: (orderId: string, reference?: string) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(orderId)}/affiliate-paid`, { reference }),
  createListing: (body: NewListing) => post<{ listing: Listing }>('/listings', body),
  like: (id: string) => post<{ liked: boolean }>(`/listings/${encodeURIComponent(id)}/like`),
  editListing: (id: string, body: Partial<NewListing>) =>
    post<{ listing: Listing }>(`/listings/${encodeURIComponent(id)}/edit`, body),
  expireListing: (id: string) =>
    post<{ expired: boolean }>(`/listings/${encodeURIComponent(id)}/delete`),
  payMore: (body: { orderIds: string[]; amountMinor: number; reference?: string }) =>
    post<{ allocation: Allocation; method: PaymentMethod; orders: Order[] }>('/me/purchases/pay', body),
  refundCredit: (id: string, body: {
    creditId?: string; reference?: string; screenshotUrl?: string; message?: string; amountMinor?: number;
    /** Handed back in person: no payout account is needed. */
    inPerson?: boolean;
  } = {}) =>
    post<{ order: Order; sentMinor: number }>(`/orders/${encodeURIComponent(id)}/refund-credit`, body),
  ackCreditRefund: (id: string, received: boolean, creditId?: string) =>
    post<{ order: Order; answeredMinor: number }>(`/orders/${encodeURIComponent(id)}/credit-ack`, { received, creditId }),
  applyCredit: (id: string, body: { creditId: string; targetOrderId: string; amountMinor?: number }) =>
    post<{ source: Order; target: Order; appliedMinor: number }>(`/orders/${encodeURIComponent(id)}/credit-apply`, body),
  startRefund: (id: string, body: {
    amountMinor: number; reason: string; reference?: string; screenshotUrl?: string; message?: string;
    inPerson?: boolean;
  }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/refund-new`, body),
  myRefunds: () => request<{
    refunds: MyRefund[];
    hasDetails: boolean;
    detailsRequests: { orderId: string; itemName: string; sellerName: string; requestedAt: string }[];
  }>('/me/refunds'),
  myDisputes: () => request<MyDisputesResponse>('/me/disputes'),
  flagDispute: (id: string, body: { subject?: string; reason?: string }) =>
    post<{ order: Order; dispute: Dispute }>(`/orders/${encodeURIComponent(id)}/flag-dispute`, body),
  holdCredit: (id: string, creditId?: string) =>
    post<{ order: Order; heldMinor: number }>(`/orders/${encodeURIComponent(id)}/credit-hold`, { creditId }),
  myPosts: () => request<{ posts: PostCard[] }>('/me/posts'),
  personPosts: (userId: string) => request<{ posts: PostCard[] }>(`/users/${encodeURIComponent(userId)}/posts`),
  quest: () => request<{ view: QuestView }>('/quest/me'),
  questCheckIn: () => post<QuestResult>('/quest/checkin'),
  questClaim: (taskId: string) => post<QuestResult>('/quest/claim', { taskId }),
  questReveal: () => post<QuestResult>('/quest/reveal'),
  questOpen: (packId: string) => post<QuestResult>('/quest/open', { packId }),
  leaderboard: () => request<{ top: LeaderRow[]; me: LeaderRow | null; total: number }>('/quest/leaderboard'),
  collector: (userId: string) => request<CollectorPage>(`/users/${encodeURIComponent(userId)}/collector`),
  learn: () => request<LearnDoc & { customised: boolean }>('/learn'),
  collection: (userId: string) => request<CollectionShelf>(`/users/${encodeURIComponent(userId)}/collection`),
  myCollection: () => request<CollectionShelf & { candidates: CollectionCandidate[] }>('/me/collection'),
  collectionAdd: (orderId: string, groupId?: string | null) =>
    post<CollectionShelf & { item: CollectionItem }>('/me/collection/add', { orderId, groupId }),
  collectionEdit: (orderId: string, changes: { groupId?: string | null; cover?: string; hidden?: string[]; own?: string }) =>
    post<CollectionShelf & { item: CollectionItem }>('/me/collection/edit', { orderId, ...changes }),
  collectionRemove: (orderId: string) => post<CollectionShelf>('/me/collection/remove', { orderId }),
  collectionGroups: (action: 'create' | 'rename' | 'delete', body: { id?: string; name?: string }) =>
    post<CollectionShelf>('/me/collection/groups', { action, ...body }),
  /** Spends a bump point. Out of points, it fails with 409 `no_bumps`. */
  bump: (id: string) => post<{ bumped: boolean; bumpedAt: string; bumps: number; shop: number; own: number; spent: 'shop' | 'own' }>(`/listings/${encodeURIComponent(id)}/bump`),
  comment: (id: string, body: string, replyToId?: string) =>
    post<{ comment: ListingPost }>(`/listings/${encodeURIComponent(id)}/comments`, { body, replyToId }),
  reactToComment: (id: string, commentId: string, kind: ReactionKind | null) =>
    post<Pick<ListingPost, 'reactionCounts' | 'myReaction'>>(
      `/listings/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/react`, { kind },
    ),
  follow: (sellerId: string) =>
    post<{ following: boolean; followerCount?: number }>(`/sellers/${encodeURIComponent(sellerId)}/follow`),
  order: (listingId: string, quantity = 1, via?: string | null, ref?: string | null, fromPost?: { channelId: string; postId: string } | null) =>
    post<{ order: Order }>('/orders', {
      listingId, quantity, via: via ?? undefined, ref: ref ?? undefined, ...(fromPost ? { fromPost } : {}),
    }),

  /**
   * Join a pre-order, or leave it.
   *
   * A bare call toggles; passing units or a naming choice always joins, so
   * changing your mind about being named is not a way to leave by accident.
   */
  pledge: (id: string, body: { units?: number; listed?: boolean; via?: string | null } = {}) =>
    post<PreOrderRoster>(`/listings/${encodeURIComponent(id)}/pledge`, {
      ...body,
      via: body.via ?? undefined,
    }),

  activity: () => request<ActivityResponse>('/me/activity'),
  /** Just the seller's own stock - what the Items screen shows, without the rest of the account. */
  myListings: () => request<{ listings: Listing[] }>('/me/listings'),

  myLots: (storeId?: string) =>
    request<LotsResponse>(`/me/lots${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  createLot: (
    body: LotDetails & {
      forwarderUserId?: string; forwarderName?: string; forwarderContact?: string;
      routeId?: string; routeName?: string;
      routeSteps?: {
        id?: string; name: string; description?: string; side?: StepSide; trigger?: StepTrigger;
        stageId?: string; stageName?: string; stageIcon?: StageIcon; locked?: boolean; forward?: boolean;
      }[];
      supplierHandle?: string; handlerUserId?: string; handlerName?: string;
    },
  ) => post<{ lot: Lot }>('/lots', body),
  updateLotDetails: (id: string, body: Partial<LotDetails>) =>
    post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/details`, body),
  lotContents: (id: string) => request<LotContents>(`/lots/${encodeURIComponent(id)}/contents`),
  assignToLot: (id: string, listingIds: string[], remove = false) =>
    post<{ changed: number }>(`/lots/${encodeURIComponent(id)}/assign`, { listingIds, remove }),
  setTracking: (id: string, body: { trackingReference?: string; forwarderName?: string; forwarderContact?: string; forwarderUserId?: string }) =>
    post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/tracking`, body),

  services: () => request<ServicesHub>('/services'),
  myServices: () => request<MyServicesView>('/me/services'),
  applyStore: (kind: StoreKind, draft: StoreDraft) => post<{ kind: StoreKind; store: StoreCore }>('/me/services/apply', { ...draft, kind }),
  storeConsole: (kind: StoreKind, ownerId: string) =>
    request<StoreConsole>(`/service-stores/${kind}/${encodeURIComponent(ownerId)}`),
  saveStore: (kind: StoreKind, ownerId: string, draft: StoreDraft) =>
    post<StoreConsole>(`/service-stores/${kind}/${encodeURIComponent(ownerId)}/save`, draft),
  storeTeam: (kind: StoreKind, ownerId: string, body: { identifier?: string; rights?: StoreRight[]; remove?: string }) =>
    post<StoreConsole>(`/service-stores/${kind}/${encodeURIComponent(ownerId)}/team`, body),
  storeWork: (kind: StoreKind, ownerId: string) =>
    request<StoreWork>(`/service-stores/${kind}/${encodeURIComponent(ownerId)}/work`),
  respondToLot: (ownerId: string, body: { sellerId: string; lotId: string; accept: boolean }) =>
    post<{ acceptance: string }>(`/service-stores/forwarder/${encodeURIComponent(ownerId)}/respond`, body),
  artistAct: (ownerId: string, orderId: string, body: { action: ArtistJobAction; quoteMinor?: number; days?: number; note?: string; photos?: string[]; courier?: string; awb?: string }) =>
    post<ArtistJobRow>(`/service-stores/artist/${encodeURIComponent(ownerId)}/jobs/${encodeURIComponent(orderId)}`, body),
  storePage: (kind: StoreKind, slug: string) =>
    request<{ store: PublicStore; stats: { lotsCarried: number; commissions: number } }>(`/service-store/${kind}/${encodeURIComponent(slug)}`),
  crewLot: (sellerId: string, lotId: string, role?: string) =>
    request<CrewLotView>(`/me/crew/${encodeURIComponent(sellerId)}/${encodeURIComponent(lotId)}${role ? `?role=${role}` : ''}`),
  /** Move a lot as the forwarder booked on it. */
  forwarderStepLot: (sellerId: string, lotId: string, to: number, extra: { trackingId?: string; shipper?: string; note?: string; undoOf?: string } = {}) =>
    post<{ lot: Lot; ordersUpdated: number; undo?: { id: string; until: string; to: number } }>(
      `/lots/${encodeURIComponent(lotId)}/step?store=${encodeURIComponent(sellerId)}`, { to, ...extra }),
  lotForwarders: (lotId: string) =>
    request<{ weightGrams: number; current: Lot['forwarder']; stores: PublicStore[] }>(`/lots/${encodeURIComponent(lotId)}/forwarders`),
  bookForwarder: (lotId: string, body: { storeOwnerId: string | null; laneId?: string | null; insurancePlanIds?: string[]; trackingReference?: string }) =>
    post<{ lot: Lot }>(`/lots/${encodeURIComponent(lotId)}/forwarder-store`, body),
  orderServices: (orderId: string) => request<OrderServicesView>(`/orders/${encodeURIComponent(orderId)}/services`),
  setInsurance: (orderId: string, planId: string | null) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(orderId)}/insurance`, { planId }),
  commission: (orderId: string, body: { artistId: string; offeringId?: string | null; brief: string; refUrls?: string[] }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(orderId)}/commission`, body),
  commissionAct: (orderId: string, body: { action: ArtistJobAction; method?: 'protected' | 'direct'; escrowAgentId?: string; reference?: string }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(orderId)}/commission/act`, body),
  serviceDirectory: (kind: ServiceKind, q?: string) =>
    request<ServiceDirectory>(`/services/${encodeURIComponent(kind)}${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  offerService: (body: {
    kind: 'forwarder' | 'handler';
    companyName?: string; description?: string; places?: string[];
    contactEmail?: string; contactPhone?: string; perParcelFeeMinor?: number | null;
    listed?: boolean;
  }) => post<{ kind: ServiceKind; profile: unknown }>('/me/service', body),
  consignments: () => request<{ consignments: ConsignmentRow[] }>('/me/service/consignments'),
  distribution: () => request<{ lots: DistributionRow[] }>('/me/service/distribution'),
  distributionLot: (id: string) =>
    request<DistributionLot>(`/me/service/distribution/${encodeURIComponent(id)}`),
  /** Name the people working a lot: who checks it, and who gets it out. */
  setCrew: (id: string, body: {
    handlerUserId?: string | null; handlerName?: string; handlerContact?: string;
    handlerCity?: string; supplierUserId?: string | null; supplierHandle?: string | null;
  }) => post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/crew`, body),

  routes: () => request<RoutesResponse>('/routes'),
  saveRoute: (body: {
    id?: string;
    name: string;
    steps: {
      id?: string; name: string; description?: string; side?: StepSide; trigger?: StepTrigger;
      stageId?: string; stageName?: string; stageIcon?: StageIcon; locked?: boolean; forward?: boolean;
      waitMessage?: string; lastMile?: boolean; button?: string; custom?: boolean; assignee?: StepAssignee;
    }[];
  }) =>
    post<{ route: TrackingRoute; lotsBehind?: number }>('/routes/new', body),
  /** Give every unfinished lot on this route its latest steps. */
  applyRoute: (id: string) =>
    post<{ lotsUpdated: number; lotsFailed?: number; ordersUpdated: number }>(`/routes/${encodeURIComponent(id)}/apply`, {}),
  deleteRoute: (id: string) => post<{ deleted: string }>(`/routes/${encodeURIComponent(id)}/delete`, {}),
  lotCandidates: (id: string, q?: string) =>
    request<{ items: CandidateItem[] }>(
      `/lots/${encodeURIComponent(id)}/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
  addItemsToLot: (id: string, orderIds: string[]) =>
    post<{ added: number; orderIds: string[] }>(`/lots/${encodeURIComponent(id)}/items`, { orderIds }),
  /** Move the lot along its route. Omit `to` for the next step. */
  stepLot: (id: string, body: { to?: number; note?: string; trackingId?: string; shipper?: string; undoOf?: string } = {}) =>
    post<{ lot: Lot; ordersUpdated: number; undo?: UndoOffer & { to: number } }>(`/lots/${encodeURIComponent(id)}/step`, body),
  /** Put the lot on a different ladder, carrying its position across. */
  /** Shut a lot to new orders (prepping for dispatch), or open it again. */
  closeLot: (id: string, closed: boolean) =>
    post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/close`, { closed }),
  setLotRoute: (id: string, routeId: string | null, note?: string) =>
    post<{ lot: Lot; ordersUpdated: number }>(`/lots/${encodeURIComponent(id)}/route`, { routeId, note }),
  /** Say something about the lot, at a step, without moving it. Every buyer in it reads it. */
  noteOnLot: (id: string, note: string, at?: number) =>
    post<{ lot: Lot; ordersUpdated: number }>(`/lots/${encodeURIComponent(id)}/note`, { note, at }),
  /** Move one item on its own, or note something about it. Omit `to` to just note. */
  stepItem: (id: string, body: { to?: number; note?: string; at?: number; trackingId?: string; shipper?: string; undoOf?: string }) =>
    post<{ order: Order; undo?: UndoOffer & { to: number } }>(`/orders/${encodeURIComponent(id)}/step`, body),
  myItems: () => request<{ groups: ItemGroup[] }>('/me/items'),
  fillingLots: () => request<{ lots: FillingLot[] }>('/showcase/lots'),
  drops: () => request<{ drops: DropCardData[] }>('/showcase/drops'),
  drop: (sellerId: string, id: string) =>
    request<{ drop: DropCardData }>(`/showcase/drops/${encodeURIComponent(sellerId)}/${encodeURIComponent(id)}`),
  remindDrop: (sellerId: string, id: string, on: boolean) =>
    post<{ drop: DropCardData }>(`/showcase/drops/${encodeURIComponent(sellerId)}/${encodeURIComponent(id)}/remind`, { on }),

  templates: () => request<{ templates: PostTemplate[] }>('/templates'),
  saveTemplate: (body: {
    id?: string; name: string; category?: string; tags?: string[];
    condition?: string | null; sourcing?: string; description?: string; defaultLotId?: string | null;
    preLotSteps?: { name: string; description?: string }[]; preLotName?: string;
    lotRouteId?: string | null; kind?: 'post' | 'power'; terms?: TemplateTerms | null;
  }) => post<{ template: PostTemplate }>('/templates/new', body),
  deleteTemplate: (id: string) =>
    post<{ deleted: string }>(`/templates/${encodeURIComponent(id)}/delete`, {}),
  /** A picture in, a URL out. The browser shrinks it before it gets here. */
  uploadPhoto: (dataUrl: string) => post<StoredPhoto>('/uploads', { dataUrl }),
  /** The card for a Figmark link inside a post - the same one a chat app shows. */
  linkPreview: (path: string) => request<LinkPreview>(`/link-preview?u=${encodeURIComponent(path)}`),
  /** File one order into a lot - an existing one, or one opened here. */
  assignOrderToLot: (id: string, body: { lotId?: string; newLot?: Record<string, unknown>; note?: string }) =>
    post<{ order: Order; lot: Lot }>(`/orders/${encodeURIComponent(id)}/lot`, body),

  orderTracking: (id: string) => request<OrderTracking>(`/orders/${encodeURIComponent(id)}`),
  orderState: (id: string) => request<OrderState>(`/orders/${encodeURIComponent(id)}/state`),
  checkout: (id: string) => request<Checkout>(`/orders/${encodeURIComponent(id)}/checkout`),
  claimPayment: (id: string, body: { reference: string; screenshot: string | null; plan?: 'full' | 'advance' }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/claim-payment`, body),
  settleClaim: (id: string, body: { accept: boolean; reason?: string }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/settle-claim`, body),
  sales: (storeId?: string) =>
    request<SalesResponse>(`/me/sales${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),

  /** The seller cannot serve an order. Puts the stock and the place back. */
  rejectOrder: (id: string, reason: string) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/reject`, { reason }),

  /** The buyer chooses Book instead of paying now. */
  bookOrder: (id: string) => post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/book`, {}),
  /** The seller says yes to a fresh order or booking. */
  acceptOrder: (id: string) => post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/accept`, {}),
  /** The seller calls off an already-accepted order. */
  /** Takes a never-paid Buy out of the cart; `save` keeps the item on Saved. */
  discardCheckout: (id: string, save = false) =>
    post<{ removed: string; saved: boolean }>(`/orders/${encodeURIComponent(id)}/discard`, { save }),
  cancelOrder: (id: string, body: { reason: string; message?: string }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/cancel`, body),
  requestReversalDetails: (id: string, message?: string) =>
    post<{ sent: boolean }>(`/orders/${encodeURIComponent(id)}/reversal/request-details`, { message }),
  confirmReversalDetails: (id: string) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/reversal/confirm-details`, {}),
  submitReversal: (id: string, body: { reference?: string; screenshot?: string; amountMinor?: number }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/reversal/submit`, body),
  ackReversal: (id: string, received: boolean) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/reversal/ack`, { received }),
  raiseDispute: (id: string) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/reversal/dispute`, {}),
  reversalDetails: () => request<{ reversalDetails: BuyerReversalDetails | null }>('/me/reversal-details'),
  saveReversalDetails: (body: {
    method: string; identifier: string; accountName: string; notes?: string; qrCodeUrl?: string;
  }) => post<{ reversalDetails: BuyerReversalDetails | null; answeredRequests: number }>('/me/reversal-details/save', body),

  powerSales: (storeId?: string) =>
    request<{ sales: PowerSaleView[] }>(
      `/power-sales${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
    ),
  createPowerSale: (draft: PowerSaleDraft) =>
    post<{ sale: PowerSaleView }>('/power-sales/new', draft),
  stopPowerSale: (id: string, storeId?: string) =>
    post<{ sale: PowerSaleView }>(
      `/power-sales/${encodeURIComponent(id)}/stop${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
      {},
    ),
  confirmOrder: (id: string) => post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/confirm`),
  openDispute: (id: string, body: { reasonCode: string; reason: string; evidence: EvidenceDraft[] }) =>
    post<{ dispute: Dispute }>(`/orders/${encodeURIComponent(id)}/dispute`, body),
  dispute: (id: string) => request<DisputeView>(`/disputes/${encodeURIComponent(id)}`),
  disputeReply: (id: string, body: string, evidence: EvidenceDraft[]) =>
    post<{ dispute: Dispute }>(`/disputes/${encodeURIComponent(id)}/reply`, { body, evidence }),
  disputeOffer: (id: string, refundMinor: number, note: string) =>
    post<{ dispute: Dispute }>(`/disputes/${encodeURIComponent(id)}/offer`, { refundMinor, note }),
  disputeAccept: (id: string) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/accept`),
  disputeWithdraw: (id: string) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/withdraw`),
  disputeEscalate: (id: string) =>
    post<{ dispute: Dispute }>(`/disputes/${encodeURIComponent(id)}/escalate`),
  disputeSettle: (id: string, body: { outcome: string; refundMinor: number; note: string }) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/settle`, body),
  escrowHoldings: () =>
    request<{ rights: EscrowRights; heldMinor: number; holdings: EscrowHolding[] }>('/escrow/holdings'),
  reviewOrder: (id: string, rating: number, body: string) =>
    post<{ review: Review }>(`/orders/${encodeURIComponent(id)}/review`, { rating, body }),
  /** The buyer's photo of what arrived, posted to the shop's channel. */
  shareUnboxing: (id: string, body: string, photoUrls: string[]) =>
    post<{ post: Post }>(`/orders/${encodeURIComponent(id)}/unboxing`, { body, photoUrls }),
  reviewsAbout: (userId: string) =>
    request<ReviewsAbout>(`/users/${encodeURIComponent(userId)}/reviews`),

  stores: () => request<{ stores: StoreAccess[] }>('/me/stores'),
  updateManager: (body: {
    storeId?: string;
    identifier: string;
    permissions?: StorePermission[];
    remove?: boolean;
  }) => post<{ managers: StoreManager[] }>('/me/storefront/managers', body),

  lotBoard: (id: string, storeId?: string) =>
    request<LotBoard>(
      `/lots/${encodeURIComponent(id)}/board${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
    ),
  /** `checkpoint` is one of the seven, or `custom:<step id>` for a route's own button. */
  setCheckpoint: (orderId: string, checkpoint: OrderCheckpoint | `custom:${string}` | string, on: boolean,
    /** The courier and AWB with a dispatch; `label`, where an item with no lot was received. */
    shipment?: { courier?: string; awb?: string; label?: string }, undoOf?: string) =>
    post<{
      order: { id: string; checkpoints: BoardOrder['checkpoints'] };
      tally: LotTally;
      undo?: UndoOffer & { checkpoint: string; on: boolean };
    }>(
      `/orders/${encodeURIComponent(orderId)}/checkpoint`,
      { checkpoint, on, ...shipment, ...(undoOf ? { undoOf } : {}) },
    ),

  inbox: () => request<Inbox>('/messages'),
  thread: (handle: string, as?: string, page: { since?: string; before?: string } = {}) => {
    const query = new URLSearchParams();
    if (as) query.set('as', as);
    if (page.since) query.set('since', page.since);
    if (page.before) query.set('before', page.before);
    const tail = query.toString();
    return request<Thread>(`/messages/${encodeURIComponent(handle)}${tail ? `?${tail}` : ''}`);
  },
  blockHandle: (handle: string, block: boolean) =>
    post<{ blocked: boolean }>(`/messages/${encodeURIComponent(handle)}/block`, { block }),
  muteThread: (handle: string, mute: boolean, as?: string) =>
    post<{ muted: boolean }>(`/messages/${encodeURIComponent(handle)}/mute`, { mute, as }),
  sendMessage: (handle: string, body: string, as?: string, deal?: Partial<MessageDeal>, replyToId?: string, itemId?: string) =>
    post<{ message: Message }>(`/messages/${encodeURIComponent(handle)}/send`, {
      body, as, ...(deal ? { deal } : {}), ...(replyToId ? { replyToId } : {}), ...(itemId ? { itemId } : {}),
    }),
  /** The shop's own items, sold out and expired too, to make a private deal from. */
  dealItems: (handle: string, as: string) =>
    request<{ items: DealItem[] }>(`/messages/${encodeURIComponent(handle)}/items?as=${encodeURIComponent(as)}`),
  reactToMessage: (handle: string, messageId: string, kind: ReactionKind | null, as?: string) =>
    post<{ reactions: { handle: string; kind: ReactionKind }[] }>(
      `/messages/${encodeURIComponent(handle)}/react`, { messageId, kind, as },
    ),
  profile: (handle: string) => request<PublicProfile>(`/u/${encodeURIComponent(handle)}`),
  credit: (userId: string, side: PageSide) =>
    request<Credit>(`/users/${encodeURIComponent(userId)}/credit?side=${side}`),
  pageReviews: (userId: string, side: PageSide) =>
    request<PageReviews>(`/users/${encodeURIComponent(userId)}/page-reviews?side=${side}`),
  /** Dispute somebody else's review or comment, or ask Figmark to validate your own. */
  report: (body: { targetType: ReportTarget; targetId: string; parentId: string; reason: string }) =>
    post<{ report: ContentReport }>('/reports', body),
  /** The shop-wide rules, such as how long protected payments are held. */
  writePageReview: (userId: string, body: { rating: number; body: string; side: PageSide }) =>
    post<{ review: PageReview }>(`/users/${encodeURIComponent(userId)}/page-reviews/new`, body),
  saveProfile: (body: { bio?: string; coverUrl?: string; tags?: string[] }) =>
    post<{ profile: { bio: string; coverUrl: string | null; tags: string[] } }>('/me/profile', body),
  setUsername: (username: string) => post<{ username: string }>('/me/username', { username }),

  /** Lots to pack; one store's only when `storeId` is given, filtered on the server. */
  supplierLots: (storeId?: string) =>
    request<{ lots: { store: SupplierStore; lot: SupplierLot['lot']; tally: LotTally }[] }>(
      `/supplier/lots${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
    ),
  supplierLot: (id: string) => request<SupplierLot>(`/supplier/lots/${encodeURIComponent(id)}`),

  storefront: () =>
    request<{ storefront: SellerProfile | null; displayName: string }>('/me/storefront'),
  saveStorefront: (body: StorefrontDraft) =>
    post<{ storefront: SellerProfile }>('/me/storefront/save', body),
  dashboard: () => request<DashboardResponse>('/me/dashboard'),
  insights: (storeId?: string) =>
    request<InsightsResponse>(`/me/insights${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  interest: (storeId?: string) =>
    request<InterestResponse>(`/me/interest${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  market: (storeId?: string) =>
    request<MarketResponse>(`/me/market${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  profitTemplates: (storeId?: string) =>
    request<{ templates: ProfitTemplate[]; starter: CostLine[] }>(
      `/me/profit-templates${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  saveProfitTemplate: (template: Partial<ProfitTemplate>, storeId?: string) =>
    post<{ template: ProfitTemplate; templates: ProfitTemplate[] }>(
      `/me/profit-templates/save${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, template),
  deleteProfitTemplate: (id: string, storeId?: string) =>
    post<{ templates: ProfitTemplate[] }>(
      `/me/profit-templates/${encodeURIComponent(id)}/delete${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, {}),
  costs: (storeId?: string) =>
    request<CostsResponse>(`/me/costs${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  savedCalcs: (storeId?: string) =>
    request<{ calcs: SavedCalc[] }>(`/me/calcs${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  saveCalc: (calc: Partial<SavedCalc>, storeId?: string) =>
    post<{ calc: SavedCalc; calcs: SavedCalc[] }>(`/me/calcs/save${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, calc),
  deleteCalc: (id: string, storeId?: string) =>
    post<{ calcs: SavedCalc[] }>(`/me/calcs/${encodeURIComponent(id)}/delete${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, {}),
  restoreCostSheet: (listingId: string, storeId?: string) =>
    post<{ listingId: string; sheet: ItemCostSheet | null; costMinor: number }>(
      `/me/listings/${encodeURIComponent(listingId)}/cost-sheet${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, { restore: true }),
  saveCostSheet: (listingId: string, sheet: { templateId: string | null; templateName: string | null; steps: CostStep[] } | null, storeId?: string) =>
    post<{ listingId: string; sheet: ItemCostSheet | null; costMinor: number }>(
      `/me/listings/${encodeURIComponent(listingId)}/cost-sheet${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, { sheet }),
  deep: (storeId?: string) =>
    request<DeepResponse>(`/me/deep${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  salesReport: (days: number, storeId?: string) =>
    request<SalesResponse>(`/me/sales-report?days=${days}${storeId ? `&store=${encodeURIComponent(storeId)}` : ''}`),
  nudge: (body: NudgeRequest, storeId?: string) =>
    post<{ sent: true }>(`/me/nudge${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, body),

  socialFeed: (as?: string | null) => request<{ posts: PostCard[] }>(`/social/feed${voice(as)}`),
  trending: (as?: string | null) => request<{ posts: PostCard[] }>(`/social/trending${voice(as)}`),
  /** Who you follow, with trending and rising posts mixed in and badged. */
  socialHome: (as?: string | null, before?: string) => {
    const query = new URLSearchParams();
    if (as) query.set('as', as);
    if (before) query.set('before', before);
    const tail = query.toString();
    return request<{ posts: PostCard[]; next: string | null }>(`/social/home${tail ? `?${tail}` : ''}`);
  },
  shareable: (as: string) => request<{ listings: ShareableListing[] }>(`/social/shareable${voice(as)}`),
  channels: () => request<{ channels: ChannelRow[]; discover: ChannelRow[] }>('/social/channels'),
  /** `light` is the refresh while a room is open: the posts only, without the shop's item list. */
  channelThread: (id: string, as?: string | null, light = false) => {
    const base = `/social/channels/${encodeURIComponent(id)}${voice(as)}`;
    return request<ChannelThread>(light ? `${base}${base.includes('?') ? '&' : '?'}light=1` : base);
  },
  pinPost: (channelId: string, id: string) =>
    post<{ pinned: boolean }>(`${postPath(channelId, id)}/pin`),
  createPost: (body: {
    body: string; forumId?: string; listingId?: string; storeId?: string;
    channelId?: string; announcement?: boolean;
    photoUrls?: string[]; poll?: { options: string[]; closesInHours?: number } | null; vibe?: Vibe | null;
    replyToId?: string; toWall?: boolean; alsoForumIds?: string[];
  }) =>
    post<{ post: Post }>('/social/posts', body),
  socialPost: (channelId: string, id: string, as?: string | null) =>
    request<PostDetail>(`${postPath(channelId, id)}${voice(as)}`),
  react: (channelId: string, id: string, kind: ReactionKind | null, as?: string | null) =>
    post<{ reactions: ReactionSummary }>(`${postPath(channelId, id)}/react${voice(as)}`, { kind }),
  reactors: (channelId: string, id: string) =>
    request<{ reactors: ReactorRow[] }>(`${postPath(channelId, id)}/reactions`),
  commentOnPost: (channelId: string, id: string, body: string, parentId?: string | null, as?: string | null) =>
    post<PostDetail & { comment: string }>(
      `${postPath(channelId, id)}/comments${voice(as)}`, { body, parentId: parentId ?? null },
    ),
  likePostComment: (channelId: string, id: string, commentId: string, as?: string | null) =>
    post<{ liked: boolean; likeCount: number }>(
      `${postPath(channelId, id)}/comments/${encodeURIComponent(commentId)}/like${voice(as)}`,
    ),
  deletePostComment: (channelId: string, id: string, commentId: string, as?: string | null) =>
    post<PostDetail>(`${postPath(channelId, id)}/comments/${encodeURIComponent(commentId)}/delete${voice(as)}`),
  sharePost: (channelId: string, id: string, mode: 'repost' | 'link', body?: string, as?: string | null) =>
    post<{ shareCount: number; repost: PostCard | null }>(`${postPath(channelId, id)}/share${voice(as)}`, { mode, body }),
  votePoll: (channelId: string, id: string, optionId: string, as?: string | null) =>
    post<{ poll: PollView }>(`${postPath(channelId, id)}/vote${voice(as)}`, { optionId }),
  deletePost: (channelId: string, id: string) =>
    post<{ deleted: string }>(`${postPath(channelId, id)}/delete`),
  forums: () => request<ForumsResponse>('/social/forums'),
  joinForum: (id: string, join: boolean) =>
    post<{ forum: ForumRow }>(`/social/forums/${encodeURIComponent(id)}/join`, { join }),
  socialSearch: (q: string) => request<SocialSearchResult>(`/social/search?q=${encodeURIComponent(q)}`),

  wants: (options: { category?: string; q?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.category) query.set('category', options.category);
    if (options.q) query.set('q', options.q);
    const suffix = query.toString();
    return request<{ wants: WantCard[]; mine: WantCard[] }>(`/wants${suffix ? `?${suffix}` : ''}`);
  },
  postWant: (body: {
    title: string; details: string; category: string;
    budgetMinor: number | null; condition: string | null; photoUrls?: string[];
  }) => post<{ want: WantCard }>('/wants/new', body),
  // The buyer is on the path because a want is stored under whoever posted it.
  want: (id: string, buyerId: string) =>
    request<WantDetail>(`/wants/${encodeURIComponent(id)}?buyer=${encodeURIComponent(buyerId)}`),
  offerOnWant: (id: string, buyerId: string, body: {
    message: string; listingId?: string | null; priceMinor?: number | null; storeId?: string | null;
  }) => post<{ offerCount: number }>(
    `/wants/${encodeURIComponent(id)}/offers?buyer=${encodeURIComponent(buyerId)}`, body,
  ),
  alsoMe: (id: string, buyerId: string) =>
    post<{ joined: boolean; seekerCount: number }>(
      `/wants/${encodeURIComponent(id)}/me?buyer=${encodeURIComponent(buyerId)}`,
    ),
  notifications: () =>
    request<{ notifications: AppNotification[]; unread: number }>('/notifications'),
  markNotificationsRead: (id?: string) =>
    post<{ read: number }>('/notifications/read', id ? { id } : {}),
  pushKey: () => request<{ publicKey: string | null }>('/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    post<{ ok: true; devices: number }>('/push/subscribe', subscription),
  pushUnsubscribe: (endpoint: string) => post<{ ok: true }>('/push/unsubscribe', { endpoint }),
  pushTest: () => post<{ sent: number }>('/push/test'),
  reportDevice: (body: { id: string; platform: string; browser: string; installed: boolean; push: string }) =>
    post<{ ok: true }>('/me/device', body),
  closeWant: (id: string, buyerId: string) =>
    post<{ want: WantCard }>(`/wants/${encodeURIComponent(id)}/close?buyer=${encodeURIComponent(buyerId)}`),
  forumMembers: (id: string) => request<ForumMembers>(`/social/forums/${encodeURIComponent(id)}/members`),
  moderateForum: (id: string, body: { action: ForumModAction; user?: string; note?: string; description?: string; rules?: string }) =>
    post<{ forum: ForumRow; member?: ForumMember }>(`/social/forums/${encodeURIComponent(id)}/moderate`, body),
  shopFeed: (id: string) => request<{ posts: PostCard[] }>(`/social/shops/${encodeURIComponent(id)}/feed`),
  follows: (id: string, kind: 'person' | 'store') =>
    request<{ followers: FollowRow[]; following: FollowRow[] }>(`/users/${encodeURIComponent(id)}/follows?kind=${kind}`),
  blocked: () => request<{ blocked: BlockedRow[] }>('/me/blocked'),
  unblock: (id: string) => post<{ blocked: boolean }>(`/me/blocked/${encodeURIComponent(id)}/unblock`, {}),
  saved: () => request<{ listings: (FeedListing & { gone: boolean })[] }>('/me/saved'),
  createForum: (body: { name: string; description?: string }) =>
    post<{ forum: ForumRow }>('/social/forums/new', body),
  forwarders: (route?: string) =>
    request<{ forwarders: DirectoryForwarder[] }>(`/forwarders${route ? `?route=${encodeURIComponent(route)}` : ''}`),
};

export type { AuthUser, DemoAccount, Listing, Lot, Order, ListingComment };
