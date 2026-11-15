import type { ConditionTag, Sourcing } from './enums.js';
import type { BaseDocument } from './models.js';
import type { LotRoute } from './routes.js';
import type { ListingOffer } from './offers.js';

/**
 * A Quick Fill template: everything a shop types the same way every time.
 *
 * A shop that sells Marvel Legends lists forty of them a month, and every one
 * of those listings has the same category, the same three tags, the same two
 * lines about condition and shipping, and the same journey. Typing it forty
 * times is how a listing screen becomes a chore, and a chore is how a shop ends
 * up with forty listings that describe themselves differently.
 *
 * The template holds listing defaults and the two routes the item will travel.
 * It is not a new kind of listing and it is not attached to one: it fills the
 * form in and then gets out of the way, and every field stays editable, which
 * is the difference between a template and a straitjacket.
 */
export interface PostTemplate extends BaseDocument {
  /** Partition key. A template belongs to one shop. */
  sellerId: string;
  name: string;
  category: string;
  /**
   * The category's own answers - kind, condition in its own words, original
   * or copy, size - as the sell form asks them. Absent on older templates,
   * which only knew a grade (`condition`).
   */
  attributes?: Record<string, string>;
  tags: string[];
  /** The grade, derived from `attributes` where the category has a condition. */
  condition: ConditionTag | null;
  /**
   * Whether items listed this way ship from the shelf or arrive in a lot.
   *
   * The template knows: a shop's Marvel Legends template is an import
   * template, and its clearance template is not. Without it a shop that lists
   * forty imports has to remember to say so forty times, and the one time they
   * forget, the item is filed as a domestic sale and the buyer is shown a
   * three-step timeline for something crossing an ocean.
   */
  sourcing: Sourcing;
  /** The two lines about condition and shipping nobody wants to retype. */
  description: string;
  /**
   * Where an item listed from this template goes.
   *
   * `null` - and the common case - is no lot: the item is sold first and
   * filed into a run later, which is what the Orders screen is for. A lot id
   * here is a shop that opens the run before it lists the items in it.
   */
  defaultLotId: string | null;
  /** The ladder before it is in a lot. Null means the built-in two steps. */
  preLotRoute: LotRoute | null;
  /** The template a lot created from one of these items should travel. */
  lotRouteId: string | null;
  lotRouteName: string | null;
  /**
   * Where it was first saved from. Every quick fill now works for both a
   * listing and a live drop; kept only so older documents still read.
   */
  kind?: 'post' | 'power';
  /** A power quick fill's stock and payment terms. */
  terms?: TemplateTerms | null;
}

/** Stock, payment and timing a quick fill hands to each item it fills. */
export interface TemplateTerms {
  quantityMode: 'fixed' | 'multiple';
  quantity: number;
  advancePercent: number | null;
  /** A limited time deal's length in days; null when it is not one. */
  limitedDays: number | null;
  /** Days from order to delivery the filled items promise; absent on older quick fills. */
  deliveryEta?: { minDays: number; maxDays: number } | null;
  allowMultiple: boolean;
  /**
   * The rest of a listing's options, so a template can carry all of them:
   * shipping per item (0 is free, null says nothing), the shop's offers, and
   * the affiliate commission and link discount. Absent on older templates.
   */
  shippingMinor?: number | null;
  offers?: ListingOffer[];
  affiliateMinor?: number | null;
  affiliateOffMinor?: number | null;
}

/**
 * What a buyer sees before their item is in a lot.
 *
 * Two steps and then a wall, because everything after the warehouse is a fact
 * about a consignment and this item is not in one. Kept as a route like every
 * other ladder so the timeline is drawn by the same component, from the same
 * shape, whichever side of the wall it is on.
 */
export const BUILT_IN_PRE_LOT_ROUTE: LotRoute = {
  routeId: null,
  name: 'Before the lot',
  steps: [
    { id: 'pre_placed', name: 'Order placed', description: '', position: 0 },
    {
      id: 'pre_warehouse',
      name: 'Received at China / international warehouse',
      description: '',
      position: 1,
    },
  ],
};

/** The route an item travels before its lot: its own, or the built-in one. */
export function preLotRouteOf(source: { preLotRoute?: LotRoute | null } | null | undefined): LotRoute {
  const route = source?.preLotRoute;
  return route && route.steps.length > 0 ? route : BUILT_IN_PRE_LOT_ROUTE;
}

/**
 * The listing fields a template fills in.
 *
 * Deliberately only the fields that are the same every time. Not the title, not
 * the price, not the quantity: those are what makes one listing different from
 * the next, and a template that guessed at them would be filling the form in
 * wrong rather than filling it in fast.
 */
export interface TemplateFill {
  category: string;
  attributes: Record<string, string>;
  tags: string;
  condition: ConditionTag | null;
  description: string;
  sourcing: Sourcing;
  lotId: string | null;
  /** Stock, advance, expiry, shipping, offers and commission, when the template set them. */
  terms: TemplateTerms | null;
}

export function fillFrom(template: PostTemplate): TemplateFill {
  return {
    category: template.category,
    attributes: template.attributes ?? {},
    tags: template.tags.join(', '),
    condition: template.condition,
    description: template.description,
    sourcing: template.sourcing ?? 'in_hand',
    lotId: template.defaultLotId,
    terms: template.terms ?? null,
  };
}

/**
 * A listing started and not yet published, kept with the shop.
 *
 * The form used to be kept only in the browser it was typed in, so a draft
 * begun on a phone was not there on the laptop, and the Sell tab's "Drafts"
 * count had nothing to count. The form itself is stored as the sell screen
 * wrote it - this is the screen's own unfinished work, not a listing - with
 * the few fields a shelf needs to draw it lifted out beside it.
 */
export interface ListingDraft extends BaseDocument {
  /** Partition key: the shop the draft will be listed in. */
  sellerId: string;
  /** Tells a draft from a Quick Fill template, which shares its container. */
  docType: 'listingDraft';
  title: string;
  priceMinor: number | null;
  category: string | null;
  /** The lead photo, for the shelf card. */
  photoUrl: string | null;
  /** The sell form as it was left. Opaque to the server. */
  form: Record<string, unknown>;
  /** Who was typing: the owner, or a manager with the listings right. */
  savedBy: string;
}

/** How many drafts one shop keeps, and how big one may be. */
export const MAX_LISTING_DRAFTS = 50;
export const MAX_DRAFT_BYTES = 60_000;
