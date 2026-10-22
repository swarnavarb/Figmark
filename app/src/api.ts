import type { RouteWords } from '@shared/route-words';
import type { ButtonLibrary } from '@shared/route-buttons';
import type { ContentReport, ModerationMark, ReportTarget } from '@shared/moderation';
import type { NotificationCategory } from '@shared/notifications';
import type { NotificationPrefs, OrderPhoto, PhotoAudience } from '@shared/models';
import type { VerifiedChecks } from '@shared/verification';
import type {
  ApiError,
  AuthUser,
  DemoAccount,
  HealthResponse,
  LoginResponse,
  MeResponse,
  SignupResponse,
} from '@shared/contracts';
import type { DisputeStatus, FulfilmentStage, OrderCheckpoint, OrderStatus, Sourcing, StorePermission } from '@shared/enums';
import type { DealState } from '@shared/deals';
import type { Badge, ContestJudging, GuessView, StoreCredit } from '@shared/play';
import type { LotTally } from '@shared/board';
import type { FollowSuggestion, Leaderboard, SeenEntry, SpottedItem, TopicChip, WantRow } from '@shared/feed';
import type { BoxEstimate, LotPhase, Timings } from '@shared/insights';
import type { CrewRole, ServiceKind, ServiceMeta } from '@shared/services';
import type { ArtistJobAction, StoreKind } from '@shared/service-stores';
import type { RouteStep, StageIcon, StepAssignee, StepSide, StepTrigger, TrackingRoute } from '@shared/routes';
import type { CardButton, SerialButton } from '@shared/buttons';
import type { LevelTag, MergedRating, StoreLevel } from '@shared/storefront';
import type { GrowthView } from '@shared/store-growth';
import type { CostLine, CostStep, ItemCostSheet, ProfitTemplate, SavedCalc } from '@shared/profit';
import type { PostTemplate, TemplateTerms } from '@shared/templates';
import type { LotBuyerPhase } from '@shared/fulfilment';
import type { PreOrderView } from '@shared/preorder';
import type { PreOrderFullRule, PreOrderShortRule } from '@shared/models';
import type { StoreAccess } from '@shared/stores';
import type { DisputeSubject, OrderAction, OrderSide } from '@shared/orders';
import type {
  CommentThread, PollView, PostHotspot, PostSocial, ReactionKind, ReactionSummary, ReactorRow, Vibe, PollStyle,
} from '@shared/social';
import type { CommunityAction } from '@shared/disputes';
import type { MarketSettings } from '@shared/settings';
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
  BuyerReversalDetails, Dispute, DisputeDecision, DisputeSanction, DisputeSide, FeePayment, Forum, ForwarderProfile, Listing, ListingComment, Lot, Message,
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

/**
 * Called when the server refuses a purchase or a listing because the account
 * has not finished verifying. Every such refusal opens the same prompt, with
 * the way to fix it, rather than leaving each screen to word its own error.
 */
let onVerificationRequired: ((message: string) => void) | null = null;

export function setVerificationRequiredHandler(handler: ((message: string) => void) | null): void {
  onVerificationRequired = handler;
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
  // Startup reads still on their way stay: they answer for before the write
  // just as their own requests would have.
  for (const path of [...reads.keys()]) if (!primed.has(path)) reads.delete(path);
}

/**
 * The reads every page load starts with, asked as one request (/api/bootstrap)
 * rather than seven. Each is filed here under its own path, so whichever
 * screen asks for it gets the bootstrap's answer - or, when the bootstrap did
 * not carry it (signed out, or the request failed), its own request, sent only
 * if something actually asks.
 */
const BOOT_PATHS = ['/auth/me', '/health', '/route-words', '/push/key', '/me/items', '/invite/me', '/quest/me'];
/** Paths primed from the bootstrap and not yet answered, with whether something has asked. */
const primed = new Map<string, { asked: boolean; settle: (answer: { status: number; body: unknown } | null) => void }>();

export function primeStartupReads(): void {
  const at = Date.now();
  for (const path of BOOT_PATHS) {
    let settle!: (answer: { status: number; body: unknown } | null) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
      settle = (answer) => {
        primed.delete(path);
        if (answer && answer.status >= 200 && answer.status < 300) return resolve(answer.body);
        if (answer) {
          const body = answer.body as ApiError | null;
          return reject(new ApiRequestError(answer.status, body?.error ?? 'http_error', body?.message ?? `Request failed with status ${answer.status}.`));
        }
        // Not carried: ask for it now, but only for whoever is waiting.
        reads.delete(path);
        send(path).then(resolve, reject);
      };
    });
    promise.catch(() => {
      if (reads.get(path)?.promise === promise) reads.delete(path);
    });
    reads.set(path, { at, promise });
    primed.set(path, { asked: false, settle });
  }
  const finish = (answers: Record<string, { status: number; body: unknown }>) => {
    for (const [path, entry] of [...primed]) {
      const answer = answers[path] ?? null;
      if (answer || entry.asked) entry.settle(answer);
      else {
        // Nobody wanted it and it was not carried: forget it unanswered.
        primed.delete(path);
        if (reads.get(path)) reads.delete(path);
      }
    }
  };
  void fetch('/api/bootstrap', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : { answers: {} }))
    .then((body: { answers?: Record<string, { status: number; body: unknown }> }) => finish(body.answers ?? {}))
    .catch(() => finish({}));
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    forgetReads();
    return send<T>(path, init);
  }
  const waiting = primed.get(path);
  if (waiting) waiting.asked = true;
  const held = reads.get(path);
  if (held && (waiting || Date.now() - held.at < READ_TTL_MS)) return held.promise as Promise<T>;
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
    // Only for something they pressed: a screen's own reads refusing would
    // otherwise pop this up just for looking. Those screens say it inline.
    if (response.status === 403 && body?.error === 'verification_required' && (init?.method ?? 'GET').toUpperCase() !== 'GET') {
      onVerificationRequired?.(body.message);
    }
    throw new ApiRequestError(
      response.status,
      body?.error ?? 'http_error',
      body?.message ?? `Request failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

/**
 * Waits until the browser holds its visitor cookie, before opening a shared link.
 *
 * Opening a link can set one cookie only (see `json` in the API): the referral
 * or the invite. The visitor cookie, which stops a second tap counting twice,
 * comes from /api/auth/me - the request every page load already makes, so this
 * shares it rather than adding one.
 */
const visitorKnown = () => request<unknown>('/auth/me').catch(() => undefined);

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/** A data URL's bytes, as the Blob it describes. */
function blobOf(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new ApiRequestError(400, 'invalid_photo', 'That photo could not be read.');
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

/**
 * A photo upload, sent as the picture's own bytes rather than as base64 in
 * JSON: a third smaller on the wire, with nothing for the server to decode.
 */
const postPhoto = <T>(path: string, dataUrl: string) => {
  const blob = blobOf(dataUrl);
  return request<T>(path, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
};

/**
 * A question sent as a POST because it carries a body - a photo, a list of
 * photos - but changes nothing anybody can see: the reads kept above stay
 * kept. A feed asks one of these per screenful of photos.
 */
const ask = <T>(path: string, body: unknown) => send<T>(path, { method: 'POST', body: JSON.stringify(body) });

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
  /** Every match there is, not the first page of them. */
  complete?: boolean;
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
  mine: {
    pledged: boolean; booked: number; units: number; listed: boolean;
    /** Their place on the waitlist, from 1, or null when not waiting. */
    waitlisted: number | null;
    /** When their called-in place or waitlist offer must be booked by. */
    dueAt: string | null;
  } | null;
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
    /** The lot's countries, filled into {origin} and {destination}. */
    originCountry?: string | null;
    destinationCountry?: string | null;
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

/** A cart item's total when Buy was pressed, and now. */
export interface PriceChange {
  fromMinor: number;
  toMinor: number;
}

export interface Checkout {
  itemMinor: number;
  /** Why this cannot be bought right now - sold out, too few left, withdrawn - or null. */
  unavailable?: string | null;
  /** Set when the price moved since Buy was pressed; the checkout is already at the new one. */
  priceChange?: PriceChange | null;
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
  /** Buyer Protection: Figmark holds the payment until the buyer has the item, for this fee. */
  protectionFeeMinor: number;
  /** False when no community manager can be assigned to it right now. */
  protectionAvailable: boolean;
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
  holdState: string;
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
  /** When the seller said this customer's parcel can ship. */
  readyAt: string | null;
  /** Reached the destination: it can be marked Ready to dispatch. */
  arrived: boolean;
  /** Its lot's crew: the ready gate, and who is tagged to see photos. Null outside a lot. */
  lotCrew: { readyGate: boolean; supplier: boolean; handler: boolean; handlerName: string | null } | null;
  /** The grade it was sold as: MISB, MIB, BIB or LOOSE. */
  condition: string;
  /** Photos of the piece on its way. */
  photos: OrderPhoto[];
  /** When the seller ticked it received at the China warehouse. */
  chinaReceivedAt: string | null;
  /** When the seller ticked it delivered, on the lot's own item list. */
  deliveredAt: string | null;
  /** The route its Quick Fill template set up for the lot that will carry it. */
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
  /** Null on a dispute about a review, comment, post or person. */
  orderId: string | null;
  itemName: string;
  currency: string;
  counterpartyName: string;
  topic: DisputeTopic;
  label: string;
  amountMinor: number | null;
  reason: string;
  raisedAt: string;
  raisedByMe: boolean;
  raisedBySide: DisputeSide;
  status: DisputeStatus;
  round: number | null;
  managerName: string | null;
  result: Dispute['result'] | null;
}

export interface MyDisputesResponse {
  asBuyer: DisputeRow[];
  asStore: DisputeRow[];
  /** Disputes about reviews, comments, posts and people. */
  community: DisputeRow[];
  orders: {
    id: string; itemName: string; side: 'buyer' | 'seller'; counterpartyName: string; counterpartyId: string;
    /** Bought with protection and Figmark is still holding the payment: raising is free, and its manager hears it. */
    protectedNow: boolean;
    createdAt: string;
  }[];
}

/** A community manager someone could pick to hear a dispute. */
export interface CommunityTeamMember {
  id: string;
  /** Their own handle and their shop's. */
  handles: string[];
  since: string;
}

export interface ManagerOption {
  id: string;
  name: string;
  since: string;
  openCases: number;
}

/** What a dispute is about, as the raise popup names it. */
export interface DisputeTarget {
  type: 'order' | 'review' | 'store_review' | 'comment' | 'post_comment' | 'post' | 'forum_post' | 'user';
  id: string;
  parentId?: string;
  /** Who it would be against, so the picker can leave them out. */
  againstId?: string;
  /** How the popup describes it: "Kaiju Imports' review", "Dragon Knight statue". */
  label: string;
}

export interface CommunityCase {
  id: string;
  reason: string;
  status: DisputeStatus;
  about: string;
  protected: boolean;
  raiser: string;
  respondent: string;
  round: number;
  myRounds: number[];
  waitingOnMe: boolean;
  decideBy: string | null;
  overdue: boolean;
  result: Dispute['result'] | null;
  /** Agreed by all, waiting for this manager to release the held payment. */
  releaseDue: boolean;
  updatedAt: string;
}

export interface CommunityDesk {
  manager: { id: string; name: string; available: boolean; since: string };
  openCases: number;
  cases: CommunityCase[];
  stats: { decided: number; overturned: number; averageHoursToDecide: number | null };
  earnings: {
    totalMinor: number;
    payments: { id: string; kind: FeePayment['kind']; amountMinor: number; shareMinor: number; reference: string; paidAt: string; currency: string }[];
  };
}

export interface CommunityNotice {
  id: string;
  disputeId: string;
  targetUserId: string;
  targetName: string;
  message: string;
  forumId: string | null;
  managerName: string;
  createdAt: string;
  until: string;
}

export interface CommunityStanding {
  alert: { message: string; until: string; disputeId: string } | null;
  flags: { disputeId: string; message: string; at: string }[];
  disputes: { won: number; lost: number; settled: number };
}

export type PublicSettings = Omit<MarketSettings, 'updatedAt' | 'updatedBy'>;

export interface SalesResponse {
  credits: ShopCredit[];
  refundHistory: RefundHistoryEntry[];
  refundable: RefundableOrder[];
  waiting: SaleRow[];
  placed: SaleRow[];
  /** Every purchase, newest first: the shop's whole book, cancelled and rejected ones included. */
  orders: SaleRow[];
  /** Finished orders older than the window, left out until asked for with `history: 'all'`. */
  olderCount?: number;
  /** An answer for a few orders only: its rows replace their own, and nothing else changed. */
  partial?: boolean;
}

/**
 * A partial sales answer laid over the book already on screen.
 *
 * Its rows replace their own where they are and join the top where they are
 * new; an order asked for and not returned has gone. Each answer pile
 * (`waiting`, `placed`) keeps its place for orders still in it. The money
 * lists are left as they were: a partial answer only covers a press.
 */
export function mergeSales(current: SalesResponse, update: SalesResponse, asked: readonly string[]): SalesResponse {
  const fresh = new Map(update.orders.map((row) => [row.id, row]));
  const gone = new Set(asked.filter((id) => !fresh.has(id)));
  const touched = new Set([...fresh.keys(), ...gone]);
  const pile = (rows: SaleRow[], next: SaleRow[]) => {
    const still = new Map(next.map((row) => [row.id, row]));
    const kept = rows.filter((row) => !touched.has(row.id) || still.has(row.id)).map((row) => still.get(row.id) ?? row);
    return [...kept, ...next.filter((row) => !rows.some((existing) => existing.id === row.id))];
  };
  const known = new Set(current.orders.map((row) => row.id));
  return {
    ...current,
    waiting: pile(current.waiting, update.waiting),
    placed: pile(current.placed, update.placed),
    orders: [
      ...update.orders.filter((row) => !known.has(row.id)),
      ...current.orders.filter((row) => !gone.has(row.id)).map((row) => fresh.get(row.id) ?? row),
    ],
  };
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

export interface DisputeView {
  dispute: Dispute;
  /** Null on a dispute about a review, comment, post or person. */
  order: Order | null;
  side: OrderSide | null;
  role: 'raiser' | 'respondent' | 'manager' | 'past_manager';
  actions: CommunityAction[];
  /** The manager on the current round is past their deadline. */
  overdue: boolean;
  standing: { favour: DisputeDecision['favour']; finalRound: number; decision: DisputeDecision } | null;
  escalation: { open: boolean; nextRound: number | null; feeMinor: number | null; by: string | null };
  holdsMoney: boolean;
  heldMinor: number | null;
  currency: string;
  parties: {
    raiser: { id: string; name: string };
    respondent: { id: string; name: string };
    buyer?: PartyRef;
    seller?: PartyRef;
  };
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
  /** What this category asks: kind, condition in its own words, original or copy, size. */
  attributes?: Record<string, string>;
  priceMinor: number;
  quantityAvailable: number;
  quantityMode?: 'fixed' | 'multiple';
  expiresAt?: string | null;
  advancePercent?: number | null;
  /** Commission per unit sold, in paise; null turns it off. */
  affiliateMinor?: number | null;
  /** What a buyer through a link saves per unit, in paise; null turns it off. */
  affiliateOffMinor?: number | null;
  preOrder: { fillThreshold: number; cutoffAt: string; whenShort?: PreOrderShortRule; whenFull?: PreOrderFullRule } | null;
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
  /** The before-lot ladder a Quick Fill template gave it. */
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
  /** Saved by this viewer to read again. */
  saved?: boolean;
  /** People the viewer follows who took part: up to three names, and how many in all. */
  followedActed?: { count: number; names: string[] } | null;
}

export type PostBoost = 'trending' | 'rising' | 'result';

/** One answer as the composer sends it: words, and on a photo poll its picture and item. */
export interface NewPollOption {
  label: string;
  photoUrl?: string | null;
  listingId?: string | null;
}

/** Everything a post can be made with. The server decides which combinations make sense. */
export interface NewPost {
  body: string; forumId?: string; listingId?: string; storeId?: string;
  channelId?: string; announcement?: boolean;
  photoUrls?: string[];
  poll?: {
    options: (string | NewPollOption)[]; closesInHours?: number; style?: PollStyle;
    stock?: boolean; reward?: { amountMinor: number; maxVoters: number } | null;
  } | null;
  vibe?: Vibe | null;
  replyToId?: string; toWall?: boolean; alsoForumIds?: string[];
  flex?: { hotspots: PostHotspot[] } | null;
  debate?: { listingIds?: [string | null, string | null]; prize?: { amountMinor: number; judge: 'store' | 'likes' } | null } | null;
  guess?: { answerMinor: number; revealInHours: number; listingId?: string | null } | null;
  contest?: {
    title: string; rules: string; entriesHours: number; votingHours: number; judging: ContestJudging;
    prizes: { amountMinor: number; note: string }[]; host?: 'store' | 'figmark';
  } | null;
}

/** What Discover is made of, each list already ranked. The rails come on the first page only. */
export interface DiscoverResponse {
  /** Open to take part in and not yet joined: polls, guesses, competitions. First page only. */
  live?: PostCard[];
  /** Competitions running or just finished. First page only. */
  contests?: PostCard[];
  debates: PostCard[];
  threads: PostCard[];
  flexes: PostCard[];
  rising?: PostCard[];
  topics?: TopicChip[];
  wants?: WantRow[];
  spotted?: SpottedItem[];
  /** The page after this one, or null at the end. */
  next?: number | null;
}

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
  /** Sent back as `since` on a refresh, which is answered in a line if nothing in the room changed. */
  stamp?: string;
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
  /** Items already listed that look like what is being hunted. */
  matchCount?: number;
}

/** An item already on Figmark that looks like what a hunt is after. */
export interface WantMatch {
  id: string;
  title: string;
  priceMinor: number;
  currency: string;
  condition: string;
  sellerId: string;
  photoUrl: string | null;
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
  category: NotificationCategory;
  title: string;
  body: string;
  /** Where tapping it goes. */
  link: string;
  read: boolean;
  /** How many events this row stands for: "Sana sent you 3 messages" is 3. */
  count: number;
  /** What a run of events is about: the bell shows one line per group. */
  group?: string | null;
  createdAt: string;
}

export interface NotificationPage {
  notifications: AppNotification[];
  unread: number;
  unreadByCategory: Partial<Record<NotificationCategory, number>>;
  /** Where the next page starts; null at the end. */
  nextBefore: string | null;
  /** On a first page: sent back as `since`, the next poll is answered in a line if nothing changed. */
  version?: string;
}

/** What a poll with `since` hears when nothing has been written since. */
export interface NotificationsUnchanged {
  unchanged: true;
  version: string;
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
  /** What is already listed that looks like it. */
  matches?: WantMatch[];
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

/** The card over the Sell tab: a few figures for each tab, read in one go. Null where this person may not see one. */
export interface SellDashboard {
  currency: string;
  listings: {
    onSale: number; drafts: number; soldOut: number; endingSoon: number; views: number; saves: number;
    best: { id: string; title: string; units: number } | null;
  } | null;
  orders: { open: number; unpaid: number; claimed: number; inTransit: number; delivered30: number; cancelled30: number } | null;
  shipments: { open: number; moving: number; done: number; ordersNoLot: number; listingsNoLot: number } | null;
  money: {
    revenue30Minor: number; revenuePrev30Minor: number; orders30: number; units30: number; averageMinor: number;
    conversion: number; daily: { date: string; revenueMinor: number }[];
  } | null;
  shop: {
    followers: number; team: number; tier: string;
    setup: { photo: boolean; cover: boolean; bio: boolean; payment: boolean };
  } | null;
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
}

/** One order in the profit book. Money in paise; `steps` are per unit. */
export interface BookRow {
  orderId: string;
  listingId: string;
  /** Null when sold from hand. */
  lotId: string | null;
  itemName: string;
  photo: string | null;
  buyerId: string;
  status: OrderStatus;
  placedAt: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  paidMinor: number;
  pendingMinor: number;
  steps: CostStep[];
  /** The steps are this order's own rather than the item's. */
  own: boolean;
  /** The calculator the item's costs came from, if any. */
  templateId: string | null;
  templateName: string | null;
}

export interface BookLot {
  id: string;
  name: string;
  number: string | null;
  status: string;
  createdAt: string;
  orders: number;
}

/** `GET /api/me/costs` - the profit book: every order, its costs and what is owed. */
export interface CostsResponse {
  lots: BookLot[];
  rows: BookRow[];
  customers: Record<string, { name: string; handle: string | null }>;
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
  /** City and country, as the store gives them. */
  place?: string | null;
  /** Forwarders: their routes, as a shop chooses by them. */
  lanes?: {
    from: string;
    to: string;
    mode: FreightLane['mode'] | null;
    days: string;
    ratePerKgMinor: number;
  }[];
  /** Artists: what they do, where prices start, a few pieces of work. */
  specialties?: string[];
  fromMinor?: number | null;
  portfolio?: string[];
  acceptingWork?: boolean;
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
  /** The buttons "+ Step" offers, as the operators keep them. */
  buttonLibrary?: ButtonLibrary;
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
    /** A cart item that can no longer be bought as it stands, and why. */
    unavailable?: string | null;
    /** A cart item whose price moved since Buy: the item total then and now. */
    priceChange?: PriceChange | null;
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

/* ── Quick Fill templates and photos ───────────────────────────────────── */

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

/** A photo search: what matches the photo, best first, then what is related to it - one list. */
export interface PhotoSearchResponse {
  listings: FeedListing[];
  /** Whether this deployment reads photos at all, or only matches the picture. */
  vision: boolean;
}

/** One item read in a photo, and the listings it is or was for sale under. */
export interface PhotoSalesItem {
  /** What the item was read as, or null for listings found by the picture alone. */
  label: string | null;
  /** On sale first, then those sold out or taken down. */
  listings: (FeedListing & { onSale: boolean })[];
}

export interface PhotoSalesResponse {
  items: PhotoSalesItem[];
  /** Shops that have sold the matching items, most sold first. */
  sellers: { seller: SellerCard; unitsSold: number; items: number }[];
  /**
   * Shops likely to get the items: by keyword first (a brand, a name), then by
   * category. `listings` is how many of theirs carry it, past or present.
   */
  likely: { seller: SellerCard; because: string; kind: 'keyword' | 'similar' | 'category'; listings: number }[];
  /**
   * Listings that may be the thing in the photo - a guess from its colours,
   * the words with it, and who posted it - likeliest first, none of those in
   * `items`. `chance` is 0 to 1.
   */
  probable: (FeedListing & { onSale: boolean; chance: number })[];
  vision: boolean;
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
  photos?: OrderPhoto[];
  /** Reached the destination, so it can be marked Ready to dispatch. */
  arrived?: boolean;
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
  /** Only on a single lot's board: what the seller has set up for its crew. */
  crew?: { readyGate: boolean; supplier: boolean; handler: boolean; handlerName: string | null };
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
  /** The oldest message to you that was unread when the chat opened, and how many. */
  firstUnreadId?: string | null;
  unread?: number;
}

/** Which of an account's two pages: its shop, or the person behind it. */
export type PageSide = 'store' | 'person';

export type ShelfState = 'active' | 'sold' | 'expired';

/** Where each check stands for the signed-in account, and what this server can run. */
export interface VerificationStatus {
  checks: VerifiedChecks;
  email: string;
  phone: string | null;
  phoneChallenge: { expiresAt: string; error: string | null } | null;
  emailCodePending: boolean;
  aadhaar: { name: string; last4: string; at: string } | null;
  ready: { email: boolean; whatsapp: boolean; aadhaar: boolean };
}

/** A shop as search and suggestions show it. */
export interface ShopCard {
  id: string;
  name: string;
  handle: string | null;
  photoUrl: string | null;
  followerCount: number;
  tier: string;
  dispatchRegion: string;
  /** The few tags that say most about it. */
  tags: string[];
  /** The tags that matched what was searched or liked. */
  matched: string[];
}

/** How each of a shop's tags does, for the Data tab. */
export interface TagInsights {
  tags: {
    key: string; label: string; own: boolean;
    yourItems: number; yourLikesPerItem: number; sold: number;
    marketItems: number; marketLikesPerItem: number; shopsSharing: number;
    verdict: 'none_live' | 'open' | 'ahead' | 'behind' | 'level';
  }[];
  ideas: { key: string; label: string; items: number; likesPerItem: number }[];
}

export interface PublicProfile {
  /** What a person won in competitions, debates and guesses. Empty for a shop. */
  gameBadges?: Badge[];
  handle: string;
  isStore: boolean;
  displayName: string;
  bio: string;
  photoUrl: string | null;
  coverUrl: string | null;
  tags: string[];
  /** The shop's identity: its own tags and what it lists, most telling first. */
  identity: { key: string; label: string; own: boolean }[];
  /** Badges the shop earned from its orders. */
  earned: { id: string; label: string }[];
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
  /** Which checks the account behind the page passed; a shop's are its owner's. */
  verified?: VerifiedChecks;
  counts: { listings: number; onSale: number; sold: number; expired: number };
  /** Active first, then sold out, then expired. */
  listings: {
    id: string; title: string; priceMinor: number; currency: string; condition: string;
    quantityAvailable: number; likeCount: number; state: ShelfState;
    affiliate?: { amountMinor?: number; percent?: number; buyerOffMinor?: number | null } | null;
    photos?: { url?: string; isPrimary?: boolean }[];
  }[];
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
  communityManager: boolean;
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
    /** The listing's lead photo, for the tiles. */
    photoUrl: string | null;
    /** Photos of this piece the shop shared with this role, and the ones they took. */
    photos: OrderPhoto[];
    /** Cleared by the shop to go out; null when the shop does not gate dispatch. */
    cleared: boolean | null;
    payment: { status: string; totalMinor: number; paidMinor: number; outstandingMinor: number; currency: string } | null;
  }[];
  settings: { readyGate: boolean; seesPayment: boolean };
  /** Every lot they work in this role, for the switcher. */
  lots: { sellerId: string; lotId: string; name: string; number: string }[];
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
    /** What Buyer Protection on this commission costs; null when it cannot be paid yet. */
    protectionFeeMinor: number | null;
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

  login: (identifier: string, password: string, otp?: string) =>
    post<LoginResponse>('/auth/login', { identifier, password, ...(otp ? { otp } : {}) }),

  signup: (body: { displayName: string; username?: string; usernameSuggested?: boolean; email: string; phone: string; password: string; acceptTerms: boolean; captchaToken?: string }) =>
    post<SignupResponse>('/auth/signup', body),

  /** Emails a reset code when the account has a confirmed email; answers alike either way. */
  startPasswordReset: (identifier: string) =>
    post<{ sent: boolean; message: string; devCode?: string }>('/auth/reset/start', { identifier }),

  /** Sets a new password with the emailed code, ends every other session, and signs in. */
  confirmPasswordReset: (body: { identifier: string; code: string; password: string; otp?: string }) =>
    post<LoginResponse>('/auth/reset/confirm', body),

  /** Whether a username is still free, asked while it is typed on the sign-up form. */
  usernameAvailable: (name: string, signal?: AbortSignal) =>
    request<{ username: string; available: boolean; reason: string | null }>(
      `/auth/username/${encodeURIComponent(name)}`, { signal }),

  /* Verification: email code, WhatsApp number, Aadhaar Secure QR. */
  verifyStatus: () => send<VerificationStatus>('/verify/status'),
  sendEmailCode: () => post<{ sentTo: string; devCode?: string; status: VerificationStatus }>('/verify/email/send'),
  confirmEmailCode: (code: string) => post<{ status: VerificationStatus }>('/verify/email/confirm', { code }),
  /** Sends a code to a new address; the password is asked again. */
  startEmailChange: (email: string, password: string) =>
    post<{ sentTo: string; devCode?: string; status: VerificationStatus }>('/verify/email/change', { email, password }),
  confirmEmailChange: (code: string) => post<{ status: VerificationStatus }>('/verify/email/change/confirm', { code }),
  startWhatsApp: () =>
    post<{ link: string; message: string; businessNumber: string; expiresAt: string; status: VerificationStatus }>('/verify/phone/start'),
  changePhone: (phone: string) => post<{ status: VerificationStatus }>('/verify/phone/number', { phone }),
  verifyAadhaar: (qr: string) => post<{ status: VerificationStatus }>('/verify/aadhaar', { qr, consent: true }),

  logout: () => post<{ ok: true }>('/auth/logout'),
  /** Ends every session this account has, on every device - this one too. */
  logoutAll: () => post<{ ok: true }>('/auth/logout-all'),

  /** Two-factor sign-in: a new key to add to an authenticator app (password asked again). */
  startMfaSetup: (password: string) => post<{ secret: string; uri: string }>('/me/mfa/setup', { password }),
  /** The first code from the new key turns it on; the recovery codes come back once. */
  enableMfa: (code: string) => post<{ recoveryCodes: string[] }>('/me/mfa/enable', { code }),
  disableMfa: (password: string, code: string) => post<{ ok: true }>('/me/mfa/disable', { password, code }),

  /** The address that downloads everything this account holds, as one JSON file. */
  exportUrl: '/api/me/export',

  /** Deletes this account and what it made, asked with its password. Refused while money or a dispute is open. */
  deleteAccount: (password: string) =>
    post<{ deleted: { user: string; listings: number; lots: number; posts: number } }>('/me/delete', { password }),

  feed: (params: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    const suffix = query.toString();
    return request<FeedResponse>(`/feed${suffix ? `?${suffix}` : ''}`);
  },

  listing: (id: string, ref?: string | null) =>
    request<ListingDetail>(`/listings/${encodeURIComponent(id)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`),
  /** Items like the one in the photo. The photo is read and dropped, never stored. */
  photoSearch: (dataUrl: string) => ask<PhotoSearchResponse>('/search/photo', { dataUrl }),
  /** Where the items in a photo already on Figmark are, or were, for sale. */
  photoSales: (url: string, about?: string, by?: string) =>
    ask<PhotoSalesResponse>('/search/photo/sales', { url, about, by }),
  /** The same for several photos at once, answered in order: up to ten. */
  photoSalesMany: (photos: { url: string; about?: string; by?: string }[]) =>
    ask<{ answers: PhotoSalesResponse[] }>('/search/photo/sales', { photos }),
  similar: (id: string) => request<{ listings: FeedListing[] }>(`/listings/${encodeURIComponent(id)}/similar`),
  affiliateLink: (listingId: string) =>
    post<{ code: string; path: string }>(`/listings/${encodeURIComponent(listingId)}/affiliate-link`, {}),
  openShortLink: async (code: string) => {
    await visitorKnown();
    return request<{ listingId: string }>(`/r/${encodeURIComponent(code)}`);
  },
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
    return visitorKnown().then(() => request<InviteOpen>(`/i/${encodeURIComponent(code)}${suffix ? `?${suffix}` : ''}`));
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
  /** `quantityWas` is the stock the form showed: the server applies the difference, not the number. */
  editListing: (id: string, body: Partial<NewListing> & { quantityWas?: number }) =>
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
  flagDispute: (id: string, body: { subject?: string; reason?: string; managerId?: string; evidence?: EvidenceDraft[] }) =>
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
  /** The seller changes a pre-order's number, date, or what happens when it is short or full. */
  editPreOrder: (id: string, body: { fillThreshold?: number; cutoffAt?: string; whenShort?: PreOrderShortRule; whenFull?: PreOrderFullRule }) =>
    post<PreOrderRoster>(`/listings/${encodeURIComponent(id)}/preorder/edit`, body),
  /** The seller's call: go ahead, cancel, extend, or admit / let go the waitlist. */
  decidePreOrder: (id: string, body:
    | { action: 'proceed' | 'cancel' | 'dismiss' }
    | { action: 'extend'; cutoffAt: string }
    | { action: 'admit'; units?: number }) =>
    post<PreOrderRoster>(`/listings/${encodeURIComponent(id)}/preorder/decide`, body),

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
      supplierHandle?: string; handlerUserId?: string; handlerHandle?: string; handlerName?: string;
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
  commissionAct: (orderId: string, body: { action: ArtistJobAction; method?: 'protected' | 'direct'; reference?: string }) =>
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
    handlerUserId?: string | null; handlerHandle?: string | null; handlerName?: string; handlerContact?: string;
    handlerCity?: string; supplierUserId?: string | null; supplierHandle?: string | null;
    /** Tick keys the seller hands each role, or null for the stock buttons. */
    supplierButtons?: string[] | null; handlerButtons?: string[] | null;
    handlerSeesPayment?: boolean; readyGate?: boolean;
  }) => post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/crew`, body),
  /** People to tag on a lot, by name or handle. Never shops. */
  suggestPeople: (q: string) =>
    request<{ people: { id: string; name: string; handle: string }[] }>(`/people/suggest?q=${encodeURIComponent(q)}`),
  addOrderPhoto: (orderId: string, dataUrl: string) =>
    post<{ photo: OrderPhoto; photos: OrderPhoto[] }>(`/orders/${encodeURIComponent(orderId)}/photos`, { dataUrl }),
  showOrderPhoto: (orderId: string, photoId: string, showTo: PhotoAudience[]) =>
    post<{ photos: OrderPhoto[] }>(`/orders/${encodeURIComponent(orderId)}/photos/${encodeURIComponent(photoId)}`, { showTo }),
  removeOrderPhoto: (orderId: string, photoId: string) =>
    post<{ photos: OrderPhoto[] }>(`/orders/${encodeURIComponent(orderId)}/photos/${encodeURIComponent(photoId)}`, { remove: true }),

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
  uploadPhoto: (dataUrl: string) => postPhoto<StoredPhoto>('/uploads', dataUrl),
  /** The shop's photo or banner: open to any signed-in account, unlike listing photos. */
  uploadStorefrontPhoto: (dataUrl: string) => post<StoredPhoto>('/me/storefront/photo', { dataUrl }),
  /** Shops whose name or tags match a search. */
  searchShops: (q: string, signal?: AbortSignal) =>
    request<{ shops: ShopCard[] }>(`/shops/search?q=${encodeURIComponent(q)}`, { signal }),
  /** Every shop carrying one tag. */
  shopsByTag: (slug: string) =>
    request<{ tag: { key: string; label: string }; shops: ShopCard[] }>(`/shop-tags/${encodeURIComponent(slug)}`),
  similarShops: (id: string) => request<{ shops: ShopCard[] }>(`/shops/${encodeURIComponent(id)}/similar`),
  /** Shops to follow, from what this buyer likes and buys. */
  shopsForYou: () => request<{ shops: ShopCard[]; basis: string[] }>('/shops/for-you'),
  /** A shop's tags, most used first, for filling in a listing. */
  shopTags: (id: string) => request<{ tags: string[] }>(`/shops/${encodeURIComponent(id)}/tags`),
  tagInsights: (store?: string) =>
    request<TagInsights>(`/me/tag-insights${store ? `?store=${encodeURIComponent(store)}` : ''}`),
  /** A dispatch region guessed from the connection on the server; null when it cannot tell. */
  regionGuess: () => request<{ region: string | null }>('/me/region-guess'),
  /**
   * Throw away a photo that was picked and then taken out again before saving.
   * Quiet on purpose: the server refuses anything that is not a draft of yours,
   * and a failure only leaves the photo for the operator's scan.
   */
  discardPhoto: (url: string) => post<{ discarded: boolean }>('/uploads/discard', { url }).catch(() => null),
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
  /**
   * The shop's sales book. `ids` asks for just those orders and the rest of
   * their lots (a `partial` answer, merged with `mergeSales`); `history: 'all'`
   * includes finished orders older than the window.
   */
  sales: (storeId?: string, options: { ids?: readonly string[]; history?: 'all' } = {}) => {
    const query = new URLSearchParams();
    if (storeId) query.set('store', storeId);
    if (options.ids?.length) query.set('ids', options.ids.join(','));
    if (options.history) query.set('history', options.history);
    const search = query.toString();
    return request<SalesResponse>(`/me/sales${search ? `?${search}` : ''}`);
  },
  /** The operators' short forms for route buttons. */
  routeWords: () => request<RouteWords>('/route-words'),
  /** The Sell tab's three counts; null where this person may not see one. */
  sellDashboard: (storeId?: string) =>
    request<SellDashboard>(`/me/sell/dashboard${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  sellTodo: (storeId?: string) =>
    request<{
      answer: number | null; answerSince?: string[] | null; noLot: number | null; noLotListings?: number | null; lots: number | null;
    }>(
      `/me/sell/todo${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),

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
  disputeOffer: (id: string, refundMinor: number, terms: string) =>
    post<{ dispute: Dispute }>(`/disputes/${encodeURIComponent(id)}/offer`, { refundMinor, terms }),
  disputeAccept: (id: string, offerId?: string) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/accept`, { offerId }),
  disputeWithdraw: (id: string) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/withdraw`),
  disputeEscalate: (id: string) =>
    post<{ dispute: Dispute; payment: FeePayment }>(`/disputes/${encodeURIComponent(id)}/escalate`),
  disputeAgree: (id: string) =>
    post<{ dispute: Dispute; order: Order | null }>(`/disputes/${encodeURIComponent(id)}/agree`),
  disputeRelease: (id: string) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/release`),
  disputeDecide: (id: string, body: { favour: 'raiser' | 'respondent'; reasoning: string; refundMinor?: number | null; sanctions: DisputeSanction[] }) =>
    post<{ dispute: Dispute; order: Order | null }>(`/disputes/${encodeURIComponent(id)}/decide`, body),
  /** Raise a dispute about a review, comment, post or person - paid through the gateway. */
  raiseCommunityDispute: (body: { subject: { type: string; id: string; parentId?: string }; reason: string; managerId: string; evidence: EvidenceDraft[] }) =>
    post<{ dispute: Dispute; payment: FeePayment }>('/disputes', body),
  communityManagers: (against?: string) =>
    request<{ feeMinor: number; currency: string; managers: ManagerOption[] }>(`/community/managers${against ? `?against=${encodeURIComponent(against)}` : ''}`),
  communityCases: () => request<CommunityDesk>('/community/cases'),
  communityAvailability: (available: boolean) => post<{ available: boolean }>('/community/availability', { available }),
  communityNotices: (forumId?: string | null) =>
    request<{ notices: CommunityNotice[] }>(`/community/notices${forumId ? `?forum=${encodeURIComponent(forumId)}` : ''}`),
  /** Every appointed community manager, for the badge beside their name. Public. */
  communityTeam: () => request<{ managers: CommunityTeamMember[] }>('/community/team'),
  communityStanding: (userId: string) => request<CommunityStanding>(`/community/standing/${encodeURIComponent(userId)}`),
  marketSettings: () => request<PublicSettings>('/settings'),
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
  /** A message from the shop: these orders are ready to go out once the balance is paid. */
  paymentReminder: (orderIds: string[]) =>
    post<{ sent: true; via: 'message' | 'bell'; thread: string | null }>('/orders/payment-reminder', { orderIds }),
  /** The same tick on several orders in one request; each one refused is listed with why. */
  setCheckpoints: (orderIds: readonly string[], checkpoint: OrderCheckpoint | string, on: boolean) =>
    post<{
      results: ({ id: string; ok: true; order: { id: string; checkpoints: BoardOrder['checkpoints']; status: string } }
        | { id: string; ok: false; error: string; message: string })[];
      done: number;
      failed: number;
    }>('/orders/checkpoints', { orderIds, checkpoint, on }),
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
  sendMessage: (
    handle: string, body: string, as?: string, deal?: Partial<MessageDeal>, replyToId?: string, itemId?: string,
    photos?: string[],
  ) =>
    post<{ message: Message }>(`/messages/${encodeURIComponent(handle)}/send`, {
      body, as, ...(deal ? { deal } : {}), ...(replyToId ? { replyToId } : {}), ...(itemId ? { itemId } : {}),
      ...(photos?.length ? { photos } : {}),
    }),
  /** A picture for a chat, in: a private name out, with no address of its own. */
  uploadChatPhoto: (dataUrl: string) => postPhoto<{ blobName: string }>('/message-photos', dataUrl),
  discardChatPhoto: (blobName: string) => post<{ discarded: boolean }>('/message-photos/discard', { blobName }).catch(() => null),
  /** Take back a message you sent; its photos are deleted with it. */
  deleteMessage: (handle: string, messageId: string, as?: string) =>
    post<{ deleted: string }>(`/messages/${encodeURIComponent(handle)}/delete`, { messageId, as }),
  /** Where a chat photo is read: through the thread, so only its two ends can. */
  chatPhotoUrl: (handle: string, name: string, as?: string) =>
    `/api/messages/${encodeURIComponent(handle)}/photos/${encodeURIComponent(name)}${as ? `?as=${encodeURIComponent(as)}` : ''}`,
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
  saveOrderCosts: (orderId: string, steps: CostStep[] | null, storeId?: string) =>
    post<{ orderId: string; own: boolean; steps: CostStep[] }>(
      `/me/orders/${encodeURIComponent(orderId)}/costs${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, { steps }),
  /** Several orders' costs at once - a split supplier payment, an undo. `steps: null` is back to the item's. */
  saveOrderCostsBatch: (changes: { orderId: string; steps: CostStep[] | null }[], storeId?: string) =>
    post<{ rows: { orderId: string; own: boolean; steps: CostStep[] }[] }>(
      `/me/order-costs${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, { changes }),
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
  /**
   * Who you follow, with trending and rising posts mixed in and badged - or,
   * with `following`, who you follow and nobody else, newest first.
   */
  /** How many followed posts arrived after `since`, for the "new posts" pill. */
  socialHomeNew: (since: string) =>
    request<{ count: number; names: string[] }>(`/social/home/new?since=${encodeURIComponent(since)}`),
  savePost: (channelId: string, postId: string) =>
    post<{ saved: boolean; count: number }>(`/social/posts/${encodeURIComponent(channelId)}/${encodeURIComponent(postId)}/save`),
  savedPosts: (as?: string | null) => request<{ posts: PostCard[] }>(`/social/saved${voice(as)}`),
  hidePost: (channelId: string, postId: string, options: { notInterested?: boolean; undo?: boolean } = {}) =>
    post<{ hidden: boolean }>(`/social/posts/${encodeURIComponent(channelId)}/${encodeURIComponent(postId)}/hide`, options),
  muteFeed: (id: string, on: boolean) => post<{ muted: boolean; count: number }>('/social/mute', { id, on }),
  feedMutes: () => request<{ muted: { id: string; name: string; handle: string | null; shop: boolean }[] }>('/social/mutes'),
  /** What was on screen, in a batch. Fire and forget: a lost batch only means a post counts one view short. */
  seenPosts: (items: SeenEntry[]) => post<{ counted: number }>('/social/seen', { items }),
  followSuggestions: () => request<{ suggestions: FollowSuggestion[] }>('/social/suggestions'),
  weeklyBest: () => request<Leaderboard>('/social/leaderboard'),
  topicPosts: (slug: string) =>
    request<{ topic: { key: string; label: string }; posts: PostCard[] }>(`/social/topics/${encodeURIComponent(slug)}`),
  socialHome: (as?: string | null, before?: string, following = false) => {
    const query = new URLSearchParams();
    if (as) query.set('as', as);
    if (before) query.set('before', before);
    if (following) query.set('following', '1');
    const tail = query.toString();
    return request<{ posts: PostCard[]; next: string | null; lastVisit?: string | null; live?: PostCard[] }>(`/social/home${tail ? `?${tail}` : ''}`);
  },
  /** The public side, ranked: debates, conversations that took off, and collection flexes. */
  discover: (page = 0) => request<DiscoverResponse>(`/social/discover${page ? `?page=${page}` : ''}`),
  shareable: (as: string) => request<{ listings: ShareableListing[] }>(`/social/shareable${voice(as)}`),
  channels: () => request<{ channels: ChannelRow[]; discover: ChannelRow[] }>('/social/channels'),
  /** `light` is the refresh while a room is open: the posts only, without the shop's item list. */
  channelThread: (id: string, as?: string | null, light = false) => {
    const base = `/social/channels/${encodeURIComponent(id)}${voice(as)}`;
    return request<ChannelThread>(light ? `${base}${base.includes('?') ? '&' : '?'}light=1` : base);
  },
  /** The light refresh, answered in a line when nothing in the room changed since `since` (a thread's `stamp`). */
  channelSince: (id: string, as: string | null | undefined, since: string) => {
    const base = `/social/channels/${encodeURIComponent(id)}${voice(as)}`;
    return request<ChannelThread | { unchanged: true; stamp: string }>(
      `${base}${base.includes('?') ? '&' : '?'}light=1&since=${encodeURIComponent(since)}`,
    );
  },
  pinPost: (channelId: string, id: string) =>
    post<{ pinned: boolean }>(`${postPath(channelId, id)}/pin`),
  createPost: (body: NewPost) => post<{ post: Post }>('/social/posts', body),
  /** Put a photo into a competition: one each, while entries are open. */
  enterContest: (channelId: string, id: string, photoUrl: string, caption: string) =>
    post<{ entryId: string; card: PostCard }>(`${postPath(channelId, id)}/enter`, { photoUrl, caption }),
  guessPrice: (channelId: string, id: string, amountMinor: number) =>
    post<{ guess: GuessView }>(`${postPath(channelId, id)}/guess`, { amountMinor }),
  /** The host's decisions: a shortlist, the winners, a debate's best argument, a prize handed over. */
  judge: (channelId: string, id: string, body: { action: 'shortlist' | 'winners'; entryIds: string[] } | { action: 'best'; commentId: string } | { action: 'sent'; place: number }) =>
    post<{ card: PostCard }>(`${postPath(channelId, id)}/judge`, body),
  myRewards: () => request<{ credits: StoreCredit[]; badges: Badge[] }>('/me/rewards'),
  /** A shop's polls, debates, guesses and competitions, for its Engage screen. */
  shopGames: (storeId: string) => request<{ posts: PostCard[] }>(`/social/shops/${encodeURIComponent(storeId)}/games`),
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
  notifications: (options: { before?: string | null; category?: NotificationCategory | null } = {}) => {
    const query = new URLSearchParams();
    if (options.before) query.set('before', options.before);
    if (options.category) query.set('category', options.category);
    const qs = query.toString();
    return request<NotificationPage>(`/notifications${qs ? `?${qs}` : ''}`);
  },
  /** The first page again, or word that nothing changed since `since` (a page's `version`). */
  notificationsSince: (since: string | null, category?: NotificationCategory | null) => {
    const query = new URLSearchParams();
    if (category) query.set('category', category);
    if (since) query.set('since', since);
    const qs = query.toString();
    return request<NotificationPage | NotificationsUnchanged>(`/notifications${qs ? `?${qs}` : ''}`);
  },
  /** One by id, several by ids, a whole category, or (nothing given) everything. */
  markNotificationsRead: (which?: string | { ids?: string[]; category?: NotificationCategory }) =>
    post<{ read: number }>('/notifications/read', typeof which === 'string' ? { id: which } : which ?? {}),
  notificationSettings: () => request<{ prefs: NotificationPrefs }>('/notifications/settings'),
  saveNotificationSettings: (prefs: Partial<NotificationPrefs>) =>
    post<{ prefs: NotificationPrefs }>('/notifications/settings/save', prefs),
  pushKey: () => request<{ publicKey: string | null }>('/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    post<{ ok: true; devices: number }>('/push/subscribe', subscription),
  pushUnsubscribe: (endpoint: string) => post<{ ok: true }>('/push/unsubscribe', { endpoint }),
  pushTest: () => post<{ sent: number }>('/push/test'),
  reportDevice: (body: { id: string; platform: string; browser: string; installed: boolean; push: string }) =>
    post<{ ok: true; onHomeScreen?: boolean }>('/me/device', body),
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
