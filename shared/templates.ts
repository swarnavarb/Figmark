import type { ConditionTag, Sourcing } from './enums.js';
import type { BaseDocument } from './models.js';
import { BUILT_IN_ROUTE, type LotRoute, type RouteStep } from './routes.js';

/**
 * A Quick Post template: everything a shop types the same way every time.
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
  tags: string[];
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

/** A blank template, so the form and the API start from the same shape. */
export function emptyTemplate(): Omit<PostTemplate, keyof BaseDocument | 'sellerId'> {
  return {
    name: '',
    category: '',
    tags: [],
    condition: null,
    sourcing: 'in_hand',
    description: '',
    defaultLotId: null,
    preLotRoute: null,
    lotRouteId: null,
    lotRouteName: null,
  };
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
  tags: string;
  condition: ConditionTag | null;
  description: string;
  sourcing: Sourcing;
  lotId: string | null;
}

export function fillFrom(template: PostTemplate): TemplateFill {
  return {
    category: template.category,
    tags: template.tags.join(', '),
    condition: template.condition,
    description: template.description,
    sourcing: template.sourcing ?? 'in_hand',
    lotId: template.defaultLotId,
  };
}

/**
 * How the two ladders read end to end, for the line a template shows about
 * itself. Before the lot, then the lot's own - which is the whole journey
 * a buyer of this item will read.
 */
export function journeyOf(
  template: Pick<PostTemplate, 'preLotRoute' | 'lotRouteName'>,
): { before: RouteStep[]; afterName: string } {
  return {
    before: preLotRouteOf(template).steps,
    afterName: template.lotRouteName ?? BUILT_IN_ROUTE.name,
  };
}
