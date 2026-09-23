import type {
  ApiError,
  AuthUser,
  DemoAccount,
  HealthResponse,
  LoginResponse,
  MeResponse,
} from '@shared/contracts';
import type { FulfilmentStage, OrderCheckpoint, Sourcing, StorePermission } from '@shared/enums';
import type { LotTally } from '@shared/board';
import type { BoxEstimate, LotPhase, Timings } from '@shared/insights';
import type { ServiceKind, ServiceMeta } from '@shared/services';
import type { RouteStep, StageIcon, StepSide, StepTrigger, TrackingRoute } from '@shared/routes';
import type { PostTemplate } from '@shared/templates';
import type { PreOrderView } from '@shared/preorder';
import type { StoreAccess } from '@shared/stores';
import type { OrderAction, OrderSide } from '@shared/orders';
import type { DisputeAction } from '@shared/disputes';
import type { Allocation, OrderMoney } from '@shared/payments';

/** Somebody named on a screen, and the page their name opens. */
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
  MessageParty, Order, PaymentClaim, PaymentMethod, Post, Review, SellerPaymentDetails, SellerProfile, StageEvent,
  StoreManager,
} from '@shared/models';

/**
 * Typed client for the Functions API. Response types come from the shared
 * contracts, so a server change this code does not handle fails the build.
 */

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
let onSessionRejected: (() => void) | null = null;

export function setSessionRejectedHandler(handler: (() => void) | null): void {
  onSessionRejected = handler;
}

/** Endpoints where a 401 is a normal answer rather than a lost session. */
const EXPECTS_401 = ['/auth/me', '/auth/login', '/auth/signup'];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
      onSessionRejected?.();
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
  storefrontSlug: string | null;
  /** The shop's handle: its page at `/username`, and where a message lands. */
  username: string | null;
  tier: string;
  dispatchRegion: string | null;
  followerCount: number;
  trustScore: number;
  onTimeDispatchRate: number | null;
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

export interface ListingDetail {
  listing: Listing;
  seller: SellerCard | null;
  estimatedDispatchAt: string | null;
  comments: (ListingComment & { author: PartyRef })[];
  liked: boolean;
  following: boolean;
  isOwn: boolean;
  /** Null on anything that is not being pre-ordered. */
  preOrder: PreOrderRoster | null;
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
  /** Listings not yet tagged into any lot. */
  unassigned: Listing[];
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
  trackingReference: string | null;
  estimatedDispatchAt: string | null;
  /** The item bought, as it is now - for the Details tab's product card. */
  listing: { id: string; title: string; photoUrl: string | null } | null;
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
  itemName: string;
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
  awaitingLot: boolean;
  lotId: string | null;
  lotName: string | null;
  lotNumber: string | null;
  lotStep: string | null;
  /** When the seller ticked it received at the China warehouse. */
  chinaReceivedAt: string | null;
  /** When the seller ticked it delivered, on the lot's own item list. */
  deliveredAt: string | null;
  /** The route its Quick Post template set up for the lot that will carry it. */
  lotRouteId: string | null;
  /** True once the buyer chose Book: no charge yet, waiting on acceptance. */
  bookingOnly: boolean;
  accepted: boolean;
  cancelReason: string | null;
  reversal: Order['reversal'];
  canAccept: boolean;
  canCancel: boolean;
}

/** Everything a shop's payments screen has to answer, in three piles. */
export interface SalesResponse {
  waiting: SaleRow[];
  placed: SaleRow[];
  answered: SaleRow[];
  /** Every purchase, newest first: the shop's whole book. */
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
  }[];
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
  /** True while no payment provider is wired; the hold is recorded, not taken. */
  simulatedPayment: boolean;
  myReview: Review | null;
  /** Null while it is still hidden — which is the point of writing yours. */
  theirReview: Review | null;
  theirReviewPending: boolean;
  dispute: Dispute | null;
  /** Seller-side only: whether the buyer has somewhere for a reversal to go. */
  buyerHasReversalDetails: boolean | null;
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
  title: string;
  description: string;
  category: string;
  condition: string;
  priceMinor: number;
  quantityAvailable: number;
  quantityMode?: 'fixed' | 'multiple';
  expiresAt?: string | null;
  advancePercent?: number | null;
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
  listing: { id: string; title: string; priceMinor: number; currency: string; condition: string } | null;
  /** Where the author's name goes. Resolved on read, not frozen into the post. */
  author: PartyRef;
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
}

export interface ChannelThread {
  channel: {
    id: string;
    kind: 'seller' | 'forum';
    name: string;
    description: string;
    handle?: string | null;
    photoUrl?: string | null;
    /** Whether you may post as this shop rather than as a customer. */
    mine: boolean;
  };
  /** The shop's own items, for putting one in front of followers. Empty unless it is yours. */
  shareable: { id: string; title: string; priceMinor: number; currency: string }[];
  posts: PostCard[];
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
  offers: WantOfferRow[];
}

export interface ForumsResponse {
  forums: Forum[];
  cap: number;
  remaining: number;
}

/* ── Seller dashboards ─────────────────────────────────────────────────── */

export interface DashboardResponse {
  tracking: {
    openLots: number;
    inFlightOrders: number;
    byStage: { stage: string; label: string; lots: number }[];
    lots: {
      id: string;
      name: string;
      stage: FulfilmentStage;
      origin: string;
      estimatedDispatchAt: string | null;
      orderCount: number;
    }[];
  };
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
  } | null;
  sellerName: string;
  sellerHandle: string | null;
  sellerId: string;
  items: (OrderMoney & {
    id: string;
    itemName: string;
    quantity: number;
    status: string;
    paymentStatus: string;
    currency: string;
    photo: string | null;
    method: PaymentMethod;
    canPayMore: boolean;
    checkpoints: Partial<Record<OrderCheckpoint, string | null>>;
  })[];
}

/* ── Quick Post templates and photos ───────────────────────────────────── */

/** A photo as the manager holds it: uploaded, or a link somebody pasted. */
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

export interface LotsBoard {
  lots: { lot: BoardLot; tally: LotTally }[];
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
}

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
  tier: string | null;
  ownerHandle: string | null;
  sellerId: string;
  memberSince: string;
  lastSeenAt: string | null;
  counts: { listings: number; onSale: number; sold: number };
  listings: {
    id: string; title: string; priceMinor: number; currency: string; condition: string;
    lotId: string | null; sourcing?: string; quantityAvailable: number; likeCount: number;
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

  listing: (id: string) => request<ListingDetail>(`/listings/${encodeURIComponent(id)}`),
  createListing: (body: NewListing) => post<{ listing: Listing }>('/listings', body),
  like: (id: string) => post<{ liked: boolean }>(`/listings/${encodeURIComponent(id)}/like`),
  editListing: (id: string, body: Partial<NewListing>) =>
    post<{ listing: Listing }>(`/listings/${encodeURIComponent(id)}/edit`, body),
  expireListing: (id: string) =>
    post<{ expired: boolean }>(`/listings/${encodeURIComponent(id)}/delete`),
  payMore: (body: { orderIds: string[]; amountMinor: number; reference?: string }) =>
    post<{ allocation: Allocation; method: PaymentMethod; orders: Order[] }>('/me/purchases/pay', body),
  refundCredit: (id: string, creditId?: string) =>
    post<{ order: Order; refundedMinor: number }>(`/orders/${encodeURIComponent(id)}/refund-credit`, { creditId }),
  myPosts: () => request<{ posts: PostCard[] }>('/me/posts'),
  bump: (id: string) => post<{ bumped: boolean }>(`/listings/${encodeURIComponent(id)}/bump`),
  comment: (id: string, body: string, replyToId?: string) =>
    post<{ comment: ListingComment & { author: PartyRef } }>(`/listings/${encodeURIComponent(id)}/comments`, { body, replyToId }),
  follow: (sellerId: string) =>
    post<{ following: boolean }>(`/sellers/${encodeURIComponent(sellerId)}/follow`),
  order: (listingId: string, quantity = 1, via?: string | null) =>
    post<{ order: Order }>('/orders', { listingId, quantity, via: via ?? undefined }),

  preOrder: (id: string) => request<PreOrderRoster>(`/listings/${encodeURIComponent(id)}/preorder`),
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
  advanceStage: (id: string, stage: string, note?: string) =>
    post<{ lot: Lot; ordersUpdated: number }>(`/lots/${encodeURIComponent(id)}/stage`, { stage, note }),
  setTracking: (id: string, body: { trackingReference?: string; forwarderName?: string; forwarderContact?: string; forwarderUserId?: string }) =>
    post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/tracking`, body),

  services: () => request<ServicesHub>('/services'),
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
      waitMessage?: string; lastMile?: boolean;
    }[];
  }) =>
    post<{ route: TrackingRoute }>('/routes/new', body),
  deleteRoute: (id: string) => post<{ deleted: string }>(`/routes/${encodeURIComponent(id)}/delete`, {}),
  lotCandidates: (id: string, q?: string) =>
    request<{ items: CandidateItem[] }>(
      `/lots/${encodeURIComponent(id)}/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
  addItemsToLot: (id: string, orderIds: string[]) =>
    post<{ added: number; orderIds: string[] }>(`/lots/${encodeURIComponent(id)}/items`, { orderIds }),
  /** Move the lot along its route. Omit `to` for the next step. */
  stepLot: (id: string, body: { to?: number; note?: string; trackingId?: string; shipper?: string } = {}) =>
    post<{ lot: Lot; ordersUpdated: number }>(`/lots/${encodeURIComponent(id)}/step`, body),
  /** Put the lot on a different ladder, carrying its position across. */
  setLotRoute: (id: string, routeId: string | null, note?: string) =>
    post<{ lot: Lot; ordersUpdated: number }>(`/lots/${encodeURIComponent(id)}/route`, { routeId, note }),
  /** Say something about the lot, at a step, without moving it. Every buyer in it reads it. */
  noteOnLot: (id: string, note: string, at?: number) =>
    post<{ lot: Lot; ordersUpdated: number }>(`/lots/${encodeURIComponent(id)}/note`, { note, at }),
  /** Move one item on its own, or note something about it. Omit `to` to just note. */
  stepItem: (id: string, body: { to?: number; note?: string; at?: number; trackingId?: string; shipper?: string }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/step`, body),
  myItems: () => request<{ groups: ItemGroup[] }>('/me/items'),

  templates: () => request<{ templates: PostTemplate[] }>('/templates'),
  saveTemplate: (body: {
    id?: string; name: string; category?: string; tags?: string[];
    condition?: string | null; sourcing?: string; description?: string; defaultLotId?: string | null;
    preLotSteps?: { name: string; description?: string }[]; preLotName?: string;
    lotRouteId?: string | null;
  }) => post<{ template: PostTemplate }>('/templates/new', body),
  deleteTemplate: (id: string) =>
    post<{ deleted: string }>(`/templates/${encodeURIComponent(id)}/delete`, {}),
  /** A picture in, a URL out. The browser shrinks it before it gets here. */
  uploadPhoto: (dataUrl: string) => post<StoredPhoto>('/uploads', { dataUrl }),
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
  }) => post<{ reversalDetails: BuyerReversalDetails | null }>('/me/reversal-details/save', body),

  powerSales: (storeId?: string) =>
    request<{ sales: PowerSaleView[] }>(
      `/power-sales${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
    ),
  createPowerSale: (draft: PowerSaleDraft) =>
    post<{ sale: PowerSaleView }>('/power-sales/new', draft),
  powerSale: (id: string, storeId?: string) =>
    request<{ sale: PowerSaleView }>(
      `/power-sales/${encodeURIComponent(id)}${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
    ),
  stopPowerSale: (id: string, storeId?: string) =>
    post<{ sale: PowerSaleView }>(
      `/power-sales/${encodeURIComponent(id)}/stop${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
      {},
    ),
  payOrder: (id: string, protection: boolean, escrowAgentId?: string) =>
    post<{ order: Order; simulatedPayment: boolean }>(
      `/orders/${encodeURIComponent(id)}/pay`,
      { protection, escrowAgentId },
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
  reviewsAbout: (userId: string) =>
    request<ReviewsAbout>(`/users/${encodeURIComponent(userId)}/reviews`),

  stores: () => request<{ stores: StoreAccess[] }>('/me/stores'),
  updateManager: (body: {
    storeId?: string;
    identifier: string;
    permissions?: StorePermission[];
    remove?: boolean;
  }) => post<{ managers: StoreManager[] }>('/me/storefront/managers', body),

  lotsBoard: (storeId?: string) =>
    request<LotsBoard>(`/me/lots/board${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  lotBoard: (id: string, storeId?: string) =>
    request<LotBoard>(
      `/lots/${encodeURIComponent(id)}/board${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
    ),
  setCheckpoint: (orderId: string, checkpoint: OrderCheckpoint, on: boolean) =>
    post<{ order: { id: string; checkpoints: BoardOrder['checkpoints'] }; tally: LotTally }>(
      `/orders/${encodeURIComponent(orderId)}/checkpoint`,
      { checkpoint, on },
    ),

  inbox: () => request<Inbox>('/messages'),
  thread: (handle: string, as?: string) =>
    request<Thread>(`/messages/${encodeURIComponent(handle)}${as ? `?as=${encodeURIComponent(as)}` : ''}`),
  sendMessage: (handle: string, body: string, as?: string) =>
    post<{ message: Message }>(`/messages/${encodeURIComponent(handle)}/send`, { body, as }),
  profile: (handle: string) => request<PublicProfile>(`/u/${encodeURIComponent(handle)}`),
  credit: (userId: string) => request<Credit>(`/users/${encodeURIComponent(userId)}/credit`),
  pageReviews: (userId: string) => request<PageReviews>(`/users/${encodeURIComponent(userId)}/page-reviews`),
  writePageReview: (userId: string, body: { rating: number; body: string }) =>
    post<{ review: PageReview }>(`/users/${encodeURIComponent(userId)}/page-reviews/new`, body),
  saveProfile: (body: { bio?: string; coverUrl?: string; tags?: string[] }) =>
    post<{ profile: { bio: string; coverUrl: string | null; tags: string[] } }>('/me/profile', body),
  setUsername: (username: string) => post<{ username: string }>('/me/username', { username }),

  supplierLots: () =>
    request<{ lots: { store: SupplierStore; lot: SupplierLot['lot']; tally: LotTally }[] }>(
      '/supplier/lots',
    ),
  supplierLot: (id: string) => request<SupplierLot>(`/supplier/lots/${encodeURIComponent(id)}`),

  storefront: () =>
    request<{ storefront: SellerProfile | null; displayName: string }>('/me/storefront'),
  saveStorefront: (body: StorefrontDraft) =>
    post<{ storefront: SellerProfile }>('/me/storefront/save', body),
  dashboard: () => request<DashboardResponse>('/me/dashboard'),
  insights: (storeId?: string) =>
    request<InsightsResponse>(`/me/insights${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),

  socialFeed: () => request<{ posts: PostCard[] }>('/social/feed'),
  channels: () => request<{ channels: ChannelRow[] }>('/social/channels'),
  channelThread: (id: string) => request<ChannelThread>(`/social/channels/${encodeURIComponent(id)}`),
  createPost: (body: {
    body: string; forumId?: string; listingId?: string; storeId?: string;
    channelId?: string; announcement?: boolean;
  }) =>
    post<{ post: Post }>('/social/posts', body),
  forums: () => request<ForumsResponse>('/social/forums'),

  wants: (options: { category?: string; q?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.category) query.set('category', options.category);
    if (options.q) query.set('q', options.q);
    const suffix = query.toString();
    return request<{ wants: WantCard[]; mine: WantCard[] }>(`/wants${suffix ? `?${suffix}` : ''}`);
  },
  postWant: (body: {
    title: string; details: string; category: string;
    budgetMinor: number | null; condition: string | null;
  }) => post<{ want: WantCard }>('/wants/new', body),
  // The buyer is on the path because a want is stored under whoever posted it.
  want: (id: string, buyerId: string) =>
    request<WantDetail>(`/wants/${encodeURIComponent(id)}?buyer=${encodeURIComponent(buyerId)}`),
  offerOnWant: (id: string, buyerId: string, body: {
    message: string; listingId?: string | null; priceMinor?: number | null;
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
  closeWant: (id: string, buyerId: string) =>
    post<{ want: WantCard }>(`/wants/${encodeURIComponent(id)}/close?buyer=${encodeURIComponent(buyerId)}`),
  createForum: (body: { name: string; description?: string }) =>
    post<{ forum: Forum }>('/social/forums/new', body),
  forwarders: (route?: string) =>
    request<{ forwarders: DirectoryForwarder[] }>(`/forwarders${route ? `?route=${encodeURIComponent(route)}` : ''}`),
};

export type { AuthUser, DemoAccount, Listing, Lot, Order, ListingComment };
