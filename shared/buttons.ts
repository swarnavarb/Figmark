import type { OrderCheckpoint } from './enums.js';
import {
  itemStepOn, joinIndexOf, leaveIndexOf, lotEndIndex, lotOffset, normaliseSteps, renderStepText, sideOf,
  stepButtonLabel, stepTickKey, triggeredStep,
  type LotRoute, type RouteStep, type StepAssignee, type StepTrigger, type Ticks,
} from './routes.js';
import { preLotRouteOf } from './templates.js';

/**
 * Which button moves which step, worked out rather than chosen.
 *
 * A seller used to bind each step to one of seven checkpoints by hand, and
 * every way of getting that wrong was reachable: "Dispatched" on step two,
 * "Delivered" in the middle, the warehouse tick after the packing one, a
 * button on a step the whole lot moves anyway. Each of those makes a real
 * order's timeline jump or rewind under its buyer, and the worst of them
 * tells a buyer their parcel arrived when it was only boxed.
 *
 * So the binding is no longer the seller's to make. They write the steps and
 * draw the two lot lines; this reads the steps in order and hands out the
 * buttons in the order the checkpoints really happen. It runs on every edit
 * in the Studio, on every save, and on every copy a lot takes - so a route
 * customised anywhere ends up with its buttons assigned, and can only ever
 * have them in order.
 *
 * The rules, in the order they are applied:
 *
 * 1. The last step is always Delivered, and the one a seller presses to
 *    finish the order. A route that does not end on one gets it added.
 * 2. Dispatched is always a step after the lot has landed and before
 *    Delivered - one already called that where there is one, otherwise a
 *    "Dispatched to you" step added right before Delivered.
 * 3. The lot cannot carry an item past dispatch, and it does not receive
 *    anything: arriving at the destination warehouse happens to each item,
 *    so that step sits after the lot. If the "items leave the lot" line is
 *    later than Dispatched, or the lot's last step is an arrival, the line
 *    moves up to just before the arrival (or to Dispatched itself).
 * 4. The other five checkpoints go to steps by what the steps say, in their
 *    real order, and only where the item is on its own: the two overseas
 *    ticks before the lot, the landing, ready and packed ticks after it.
 *    Nothing inside a lot gets a button - the lot moves its items together.
 * 5. A custom button (the seller's own, beyond the seven) stays only where
 *    an item is on its own, and takes no checkpoint's place.
 */

/** The checkpoints handed out by the matcher, in the order they happen. */
const MATCHED: readonly OrderCheckpoint[] = ['china_received', 'china_packed', 'india_received', 'ready_to_dispatch', 'packed'];

/** What a step's words have to say for a checkpoint to fit it. */
const SAYS: Record<OrderCheckpoint, RegExp> = {
  china_received: /receiv|arriv|\bgot\b|counted|reached|warehouse|\bwh\b|forwarder|supplier|shipped by|sent by|collected|picked up|sourced/i,
  china_packed: /pack|box|consolidat|label|wrap/i,
  india_received: /receiv|arriv|land|reached|unpack|\bgot\b/i,
  ready_to_dispatch: /ready|check|\bqc\b|inspect|quality|sort|test/i,
  packed: /pack|box|wrap/i,
  dispatched: /dispatch|out for delivery|courier|shipped to|sent to|on (its|the) way to|handed/i,
  delivered: /\bdelivered\b|reached (you|the buyer|buyer)|in (your|their) hands|received by (you|the buyer)/i,
};

/* How much a step fits a checkpoint. Zero is "not here". */
const SAID = 10;
/**
 * A step with no telling words still gets a button where one checkpoint is
 * plainly what it is: the first thing that happens to an item overseas, and
 * the general "ready" tick after it lands. Nothing else falls back - a
 * button's tick is filed on the order as what that checkpoint means
 * ("Packed."), so handing "packed" to a step called "Customs" would write a
 * line the seller never meant.
 */
const FALLBACK: Partial<Record<OrderCheckpoint, number>> = { china_received: 2, ready_to_dispatch: 2 };
/** Where it already sits, so a route does not reshuffle while it is being typed. */
const KEPT = 3;

type Zone = 'start' | 'pre' | 'lot' | 'item' | 'solo';

/** One button that moved, for the line that says so. */
export interface ButtonChange {
  id: string;
  name: string;
  /** The button's key before and after, as `stepTickKey` gives it. */
  from: string | null;
  to: string | null;
}

export interface AssignedRoute {
  steps: RouteStep[];
  /** Steps the rules had to add: Dispatched and Delivered. */
  added: RouteStep[];
  /** Every step whose button is not the one it came in with. */
  changes: ButtonChange[];
}

const fits = (step: RouteStep, checkpoint: OrderCheckpoint) => SAYS[checkpoint].test(step.name);

/** Where items leave the lot, as the last-mile flags on the steps say. */
function markLeave(steps: RouteStep[], leave: number): RouteStep[] {
  return steps.map((step, index) => ({ ...step, lastMile: index >= leave ? true : undefined }));
}

/**
 * The route with its buttons handed out - see the comment at the top of the
 * file for the rules. Pure, and idempotent: running it on its own output
 * changes nothing.
 */
export function assignButtons(input: readonly RouteStep[]): AssignedRoute {
  const before = new Map(input.map((step) => [step.id, stepTickKey(step)]));
  let steps: RouteStep[] = input.map((step, index) => ({ ...step, side: sideOf(step, index) }));
  const added: RouteStep[] = [];
  if (steps.length === 0) return { steps, added, changes: [] };

  const lastSide = () => steps[steps.length - 1]!.side;
  const anyLeave = () => steps.some((step) => step.lastMile);

  /* 1. Delivered, last. */
  const tail = steps[steps.length - 1]!;
  if (steps.length < 2 || !(tail.trigger === 'delivered' || fits(tail, 'delivered'))) {
    const step: RouteStep = {
      id: uniqueId(steps, 'auto_delivered'), name: 'Delivered', description: 'It reached you.', position: 0,
      side: lastSide(), lastMile: anyLeave() || undefined, locked: true,
    };
    steps.push(step);
    added.push(step);
  }

  /* 2. Dispatched, after the lot has landed. */
  let delivered = steps.length - 1;
  const join = joinIndexOf({ steps });
  const hasLot = join < delivered;
  let landed = -1;
  if (hasLot) {
    for (let index = join; index < delivered; index += 1) {
      if (fits(steps[index]!, 'india_received')) landed = index;
    }
  }
  const from = Math.max(1, hasLot ? Math.max(join, landed + 1) : 1);
  const candidates = range(from, delivered);
  let dispatched = candidates.find((index) => steps[index]!.trigger === 'dispatched')
    ?? candidates.find((index) => !steps[index]!.forward && fits(steps[index]!, 'dispatched'))
    ?? -1;
  if (dispatched < 0) {
    const step: RouteStep = {
      id: uniqueId(steps, 'auto_dispatched'), name: 'Dispatched to you', description: 'Handed to the courier for the last leg.',
      position: 0, side: steps[delivered]!.side, lastMile: steps[delivered]!.lastMile,
    };
    steps.splice(delivered, 0, step);
    added.push(step);
    dispatched = delivered;
    delivered += 1;
  }

  /* 3. The lot stops before dispatch. */
  let leave = leaveIndexOf({ steps });
  if (hasLot && join < dispatched) {
    if (leave > dispatched) {
      leave = landed > join && landed < dispatched ? landed : dispatched;
    } else if (leave - 1 > join && fits(steps[leave - 1]!, 'india_received')) {
      // The lot's last step is an arrival: that happens to each item, so it
      // belongs on the far side of the line.
      leave -= 1;
    }
    steps = markLeave(steps, leave);
  } else {
    leave = steps.length;
  }

  /* 4. The rest, matched in order. */
  const zoneOf = (index: number): Zone => {
    if (index === 0) return 'start';
    if (!(hasLot && join < dispatched)) return 'solo';
    if (index < join) return 'pre';
    if (index < leave) return 'lot';
    return 'item';
  };
  /* A custom button keeps its place wherever an item is on its own. */
  const customHere = (index: number) => Boolean(steps[index]!.custom)
    && index !== dispatched && index !== delivered && ['pre', 'item', 'solo'].includes(zoneOf(index));
  const score = (index: number, checkpoint: OrderCheckpoint): number => {
    const step = steps[index]!;
    const zone = zoneOf(index);
    const allowed = (() => {
      switch (checkpoint) {
        case 'china_received': return zone === 'pre' ? 'any' : zone === 'solo' ? 'said' : null;
        case 'china_packed': return zone === 'pre' ? 'any' : zone === 'solo' ? 'said' : null;
        case 'india_received': return zone === 'item' ? 'said' : null;
        case 'ready_to_dispatch':
        case 'packed': return zone === 'item' ? 'any' : zone === 'solo' ? 'said' : null;
        default: return null;
      }
    })();
    if (!allowed) return 0;
    const said = fits(step, checkpoint);
    if (!said && allowed === 'said') return 0;
    const base = said ? SAID - (checkpoint === 'ready_to_dispatch' ? 2 : 0) : FALLBACK[checkpoint] ?? 0;
    return base > 0 ? base + (step.trigger === checkpoint ? KEPT : 0) : 0;
  };

  const slots = range(1, dispatched).filter((index) => !customHere(index));
  const picked = matchInOrder(slots, MATCHED, score);

  steps = steps.map((step, index) => {
    const trigger: StepTrigger | undefined = index === delivered ? 'delivered'
      : index === dispatched ? 'dispatched'
        : picked.get(index);
    const custom = !trigger && customHere(index) ? true : undefined;
    // Who else may press it only means something while there is a button -
    // or, inside the lot, where the forwarder may be the one moving the crate.
    const assignee = trigger || custom ? step.assignee
      : zoneOf(index) === 'lot' && step.assignee === 'forwarder' ? 'forwarder' : undefined;
    return { ...step, trigger, custom, assignee, position: index };
  });

  const changes: ButtonChange[] = steps
    .filter((step) => before.has(step.id) && (before.get(step.id) ?? null) !== stepTickKey(step))
    .map((step) => ({ id: step.id, name: step.name, from: before.get(step.id) ?? null, to: stepTickKey(step) }));

  return { steps, added, changes };
}

/**
 * Steps as they arrive from anywhere - a request, a template, a lot's copy -
 * cleaned and given their buttons: the one door every stored route goes
 * through, so none is ever kept with its buttons out of order.
 */
export function withButtons(steps: readonly Partial<RouteStep>[]): RouteStep[] {
  return normaliseSteps(assignButtons(normaliseSteps(steps, { keepButtons: true })).steps);
}

/**
 * The best way to hand out `checkpoints`, in order, to `slots`, in order:
 * each step gets at most one, each checkpoint goes at most once, and a later
 * checkpoint never lands on an earlier step. The classic alignment table,
 * small enough here (a dozen steps, five checkpoints) to fill in full.
 */
function matchInOrder(
  slots: number[],
  checkpoints: readonly OrderCheckpoint[],
  score: (index: number, checkpoint: OrderCheckpoint) => number,
): Map<number, OrderCheckpoint> {
  const rows = slots.length;
  const cols = checkpoints.length;
  const best: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let a = 1; a <= rows; a += 1) {
    for (let b = 1; b <= cols; b += 1) {
      const here = score(slots[a - 1]!, checkpoints[b - 1]!);
      best[a]![b] = Math.max(best[a - 1]![b]!, best[a]![b - 1]!, here > 0 ? best[a - 1]![b - 1]! + here : 0);
    }
  }
  const out = new Map<number, OrderCheckpoint>();
  let a = rows;
  let b = cols;
  while (a > 0 && b > 0) {
    const here = score(slots[a - 1]!, checkpoints[b - 1]!);
    if (here > 0 && best[a]![b] === best[a - 1]![b - 1]! + here) {
      out.set(slots[a - 1]!, checkpoints[b - 1]!);
      a -= 1;
      b -= 1;
    } else if (best[a]![b] === best[a - 1]![b]) {
      a -= 1;
    } else {
      b -= 1;
    }
  }
  return out;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let index = from; index < to; index += 1) out.push(index);
  return out;
}

function uniqueId(steps: readonly RouteStep[], base: string): string {
  let id = base;
  let n = 2;
  while (steps.some((step) => step.id === id)) id = `${base}_${n++}`;
  return id;
}

/* ── Checking a route's buttons ─────────────────────────────────────── */

export interface RouteProblem {
  /** `error` stops a save; `warning` is said and allowed. */
  level: 'error' | 'warning';
  /** The step it is about, when it is about one. */
  stepId?: string;
  text: string;
}

/** Words a button may only say when it is that button. */
const SERIOUS: { checkpoint: OrderCheckpoint; words: RegExp; plain: string }[] = [
  { checkpoint: 'delivered', words: /\bdeliver/i, plain: 'delivered' },
  { checkpoint: 'dispatched', words: /\bdispatch/i, plain: 'dispatched' },
];

/** Words the two buttons a buyer is told about may not say instead. */
const NOT_THE_LAST_MILE = /pack|ready|warehouse|\bwh\b|landed|forwarder|supplier/i;

/**
 * What is wrong with a route's buttons, in words a seller can act on.
 *
 * Read after `assignButtons`, so the order is never what is wrong - only what
 * the seller can still get wrong: the words. Two buttons saying the same
 * thing cannot be told apart on an order card; a "Delivered" on the packing
 * step would be pressed by somebody believing they were telling the buyer it
 * arrived; and a step the item reaches on its own with nothing to press is
 * passed over in silence.
 */
export function checkButtons(steps: readonly RouteStep[]): RouteProblem[] {
  const problems: RouteProblem[] = [];
  const seen = new Map<string, RouteStep>();
  for (const step of steps) {
    if (!stepTickKey(step)) continue;
    const label = stepButtonLabel(step).toLowerCase();
    const twin = seen.get(label);
    if (twin) {
      problems.push({
        level: 'error', stepId: step.id,
        text: `"${twin.name}" and "${step.name}" both have a button saying "${stepButtonLabel(step)}". Give one of them different words.`,
      });
    } else {
      seen.set(label, step);
    }
    const own = step.button?.trim();
    if (!own) continue;
    for (const serious of SERIOUS) {
      if (step.trigger !== serious.checkpoint && serious.words.test(own)) {
        problems.push({
          level: 'error', stepId: step.id,
          text: `The button on "${step.name}" says "${own}", but pressing it does not mark the order ${serious.plain}. Change its words.`,
        });
      }
    }
    if ((step.trigger === 'dispatched' || step.trigger === 'delivered') && NOT_THE_LAST_MILE.test(own)) {
      problems.push({
        level: 'error', stepId: step.id,
        text: `"${own}" is the ${step.trigger} button - pressing it tells the buyer their parcel is ${step.trigger === 'delivered' ? 'with them' : 'on its way'}. Use words that say so.`,
      });
    }
  }

  const join = joinIndexOf({ steps: [...steps] });
  const leave = leaveIndexOf({ steps: [...steps] });
  const dispatched = steps.findIndex((step) => step.trigger === 'dispatched');
  const idle = steps.filter((step, index) => index > 0 && !stepTickKey(step) && dispatched >= 0 && index < dispatched
    && (index < join || index >= leave));
  if (idle.length > 0) {
    const names = idle.map((step) => `"${step.name}"`).join(', ');
    problems.push({
      level: 'warning', stepId: idle[0]!.id,
      text: `${names} ${idle.length === 1 ? 'has' : 'have'} no button, so ${idle.length === 1 ? 'it is' : 'they are'} ticked off when the next button is pressed. Fine if that is how it goes - or merge ${idle.length === 1 ? 'it' : 'them'} into the step next door.`,
    });
  }
  return problems;
}

/* ── An order's next button ─────────────────────────────────────────── */

/**
 * The one button an order is waiting on: the first one past where it is,
 * not yet pressed. `null` while the lot still has to move it - a button
 * further on is no use to press until the crate has got there - and once
 * everything is done.
 */
export function nextButton(
  steps: readonly RouteStep[],
  current: number,
  pressed: (key: string) => boolean,
): { index: number; step: RouteStep } | { index: -1; waitingOnLot: true } | null {
  const join = joinIndexOf({ steps: [...steps] });
  const leave = leaveIndexOf({ steps: [...steps] });
  for (let index = current + 1; index < steps.length; index += 1) {
    const step = steps[index]!;
    const key = stepTickKey(step);
    if (key && !pressed(key)) return { index, step };
    if (!key && index >= join && index < leave && join < steps.length) return { index: -1, waitingOnLot: true };
  }
  return null;
}

/**
 * A route with its last mile on it, for drawing.
 *
 * Every route saved through `assignButtons` already ends on Dispatched and
 * Delivered. A lot's copy taken before that may not, and is never rewritten
 * (a buyer has been reading it), so the two are added here for the screen
 * only; `at` carries a stored position over to the drawn list.
 */
export function withLastMile(steps: readonly RouteStep[]): { steps: RouteStep[]; at: (index: number) => number; added: number } {
  const out = steps.map((step, index) => (index === steps.length - 1 && !step.trigger && /^delivered$/i.test(step.name.trim())
    ? { ...step, trigger: 'delivered' as const }
    : step));
  let insertedAt = -1;
  let added = 0;
  if (!out.some((step) => step.trigger === 'dispatched')) {
    const before = out.findIndex((step) => step.trigger === 'delivered');
    insertedAt = before >= 0 ? before : out.length;
    out.splice(insertedAt, 0, {
      id: 'lastmile_dispatched', name: 'Dispatched to you', description: 'On its way with the courier.',
      position: 0, trigger: 'dispatched', lastMile: true,
    });
    added += 1;
  }
  if (!out.some((step) => step.trigger === 'delivered')) {
    out.push({ id: 'lastmile_delivered', name: 'Delivered', description: 'It reached you.', position: 0, trigger: 'delivered', lastMile: true });
    added += 1;
  }
  return {
    steps: out.map((step, index) => ({ ...step, position: index })),
    at: (index) => (insertedAt >= 0 && index >= insertedAt ? index + 1 : index),
    added,
  };
}

/* ── The ladder an order is on, and the button it is waiting for ────── */

/**
 * The steps an item walks before it has a lot.
 *
 * The before-lot half of the route its listing chose, when it chose one - the
 * same buttons, in the same words, the seller set up in the Route Studio.
 * Failing that the order's own before-lot copy, whose last step has always
 * been the warehouse tick even where nothing says so.
 */
export function ladderBeforeLot(
  order: { preLotRoute?: LotRoute | null },
  template?: { id: string; name: string; steps: RouteStep[] } | null,
): LotRoute {
  if (template) {
    const half = withButtons(template.steps).filter((step) => step.side === 'pre');
    if (half.length >= 2 && half.some((step) => step.trigger)) {
      return { routeId: template.id, name: template.name, steps: half };
    }
  }
  const own = preLotRouteOf(order);
  if (own.steps.length < 2 || own.steps.some((step) => step.trigger)) return own;
  return {
    ...own,
    steps: own.steps.map((step, index) => (index === own.steps.length - 1 ? { ...step, trigger: 'china_received' as const } : step)),
  };
}

/**
 * One button as an order card draws it. `checkpoint` is the key it is
 * pressed under - one of the seven, or `custom:<step id>`.
 */
export interface CardButton { checkpoint: string; label: string; step: string; assignee?: StepAssignee }

/** What an order card needs to offer the seller its next press. */
export interface CardButtons {
  /** The press it is waiting on, or null when there is none to make yet. */
  next: CardButton | null;
  /** The furthest press made, for undoing it. */
  done: CardButton | null;
  /** Nothing to press because the lot has to move it first. */
  waitingOnLot: boolean;
}

const asCard = (step: RouteStep, vars?: { origin?: string | null; destination?: string | null }): CardButton => ({
  checkpoint: stepTickKey(step)!, label: stepButtonLabel(step, vars), step: step.name,
  ...(step.assignee ? { assignee: step.assignee } : {}),
});

/**
 * The buttons on an order card, read off the same ladder its timeline draws:
 * a lot's route with its last mile, or the before-lot steps while it has no
 * lot. `lotStep` is null for an item not in one.
 */
export function cardButtons(
  steps: readonly RouteStep[],
  lotStep: number | null,
  own: number | undefined,
  ticks: Ticks,
  vars?: { origin?: string | null; destination?: string | null },
): CardButtons {
  const route = { steps: [...steps] };
  const current = lotStep === null
    ? Math.max(-1, triggeredStep(route, ticks))
    : itemStepOn(route, lotStep, own, ticks);
  const pressed = (key: string) => Boolean(ticks?.[key]);
  const found = nextButton(steps, current, pressed);
  const doneAt = triggeredStep(route, ticks);
  return {
    next: found && found.index >= 0 && 'step' in found ? asCard(found.step, vars) : null,
    done: doneAt >= 0 ? asCard(steps[doneAt]!, vars) : null,
    waitingOnLot: Boolean(found && found.index < 0),
  };
}

/* ── Adding a step: what can go where ───────────────────────────────── */

/** A kind of step offered when one is added, with the button it comes with. */
export interface StepKind {
  id: string;
  /** The step as it is added - its name is what the matcher reads. */
  name: string;
  description: string;
  icon: string;
  /** The checkpoint it comes with, the seller's own button, or nothing. */
  trigger?: StepTrigger;
  custom?: boolean;
}

export const STEP_KINDS: readonly StepKind[] = [
  { id: 'china_received', icon: '🏬', name: 'Received at {origin} warehouse', description: 'Counted in overseas and waiting for a lot.', trigger: 'china_received' },
  { id: 'china_packed', icon: '📦', name: 'Packed at {origin}', description: 'Boxed up and ready for the lot.', trigger: 'china_packed' },
  { id: 'india_received', icon: '🛬', name: 'Received at {destination} warehouse', description: 'Unpacked from the lot - each item goes on alone from here.', trigger: 'india_received' },
  { id: 'ready_to_dispatch', icon: '🏷️', name: 'Checked and ready', description: 'Inspected and ready to go out.', trigger: 'ready_to_dispatch' },
  { id: 'packed', icon: '📦', name: 'Packed for you', description: 'Boxed for the courier.', trigger: 'packed' },
  { id: 'dispatched', icon: '🚚', name: 'Dispatched to you', description: 'Handed to the courier.', trigger: 'dispatched' },
  { id: 'delivered', icon: '📬', name: 'Delivered', description: 'It reached you.', trigger: 'delivered' },
  { id: 'custom', icon: '✨', name: '', description: '', custom: true },
  { id: 'plain', icon: '📍', name: '', description: '' },
];

/** One kind on the add-a-step list, and whether it can go here. */
export interface StepChoice { kind: StepKind; open: boolean; why?: string }

/** Which part of the journey a new step lands in. */
export type StepZone = 'pre' | 'lot' | 'post';

/**
 * What can be added at `at` - the index the new step will take - in `zone`.
 * Every kind is listed, so the seller sees the whole set; the ones that
 * cannot go here are locked with the reason: used already, before or after
 * the lot only, out of order, or always last.
 */
export function stepChoices(steps: readonly RouteStep[], at: number, zone: StepZone): StepChoice[] {
  const order = MATCHED as readonly string[];
  const usedAt = new Map<string, number>();
  steps.forEach((step, index) => { if (step.trigger) usedAt.set(step.trigger, index); });
  const dispatchAt = usedAt.get('dispatched') ?? steps.length;

  return STEP_KINDS.map((kind): StepChoice => {
    if (kind.trigger === 'dispatched' || kind.trigger === 'delivered') {
      return { kind, open: false, why: 'Always the last two steps' };
    }
    if (at === 0) return { kind, open: false, why: 'Order placed is always first' };
    if (!kind.trigger && !kind.custom) return { kind, open: true };
    if (zone === 'lot') return { kind, open: false, why: 'Items in a lot move together - no buttons here' };
    if (at > dispatchAt) return { kind, open: false, why: 'Not after Dispatched' };
    if (kind.custom) return { kind, open: true };
    const trigger = kind.trigger!;
    const used = usedAt.get(trigger);
    if (used !== undefined) return { kind, open: false, why: `Used on step ${used + 1}` };
    const overseas = trigger === 'china_received' || trigger === 'china_packed';
    if (overseas && zone !== 'pre') return { kind, open: false, why: 'Only before the lot' };
    if (!overseas && zone === 'pre') return { kind, open: false, why: 'Only after the lot' };
    /* In order: nothing that happens earlier may sit after it, nor later before it. */
    const rank = order.indexOf(trigger);
    for (const [other, index] of usedAt) {
      const otherRank = order.indexOf(other);
      if (otherRank < 0) continue;
      if (otherRank > rank && index < at) return { kind, open: false, why: `Must come before "${steps[index]!.name}"` };
      if (otherRank < rank && index >= at) return { kind, open: false, why: `Must come after "${steps[index]!.name}"` };
    }
    return { kind, open: true };
  });
}

/* ── Where an item was received, before it had a lot ────────────────── */

/** The places offered when the warehouse button is pressed for an item not yet in a lot. */
export const RECEIVED_AS_OPTIONS = [
  'Received at international warehouse',
  "Received at freight forwarder's warehouse",
  "Received at supplier's warehouse",
] as const;

/** The longest label a seller may type for it. */
export const RECEIVED_AS_MAX = 60;

/**
 * An order's steps with its own words for where it was received: the step
 * the warehouse button reaches takes the label chosen for this order. The
 * route is untouched - this is one order's reading of it.
 */
export function withReceivedAs<T extends Pick<RouteStep, 'trigger' | 'name'>>(steps: readonly T[], label: string | null | undefined): T[] {
  const said = label?.trim();
  if (!said) return [...steps];
  return steps.map((step) => (step.trigger === 'china_received' ? { ...step, name: said } : step));
}

/* ── Every button an item in a lot has, in the order they happen ────── */

/**
 * One button in an item's serial chain: a press of its own (`item`, under
 * the key `stepTickKey` gives it) or a move of the whole lot it rides in
 * (`lot`, to that index on the lot's stored route).
 */
export type SerialButton =
  | { kind: 'item'; key: string; label: string; step: string; done: boolean; lastMile: 'dispatched' | 'delivered' | null }
  /** `gated`: moving there would carry items past the warehouse check-in unticked. */
  | { kind: 'lot'; to: number; label: string; step: string; done: boolean; gated?: boolean };

/**
 * The route's buttons and the lot's moves, together and in route order.
 *
 * An item in a lot reaches each step one of two ways: a button pressed on the
 * item, or the crate moving. Showing the two apart made a seller hunt for the
 * second; this lays every one out on a single line, so the next thing to
 * press is simply the first one not yet done. `steps` is the lot's stored
 * route (one order's reading of it, where it has one); `lotStep` is where the
 * lot is on it.
 */
export function serialButtons(
  steps: readonly RouteStep[],
  lotStep: number,
  ticks: Ticks,
  vars?: { origin?: string | null; destination?: string | null },
): SerialButton[] {
  const route = { steps: [...steps] };
  const track = withLastMile(steps);
  const placed: { at: number; button: SerialButton }[] = [];

  track.steps.forEach((step, index) => {
    const key = stepTickKey(step);
    if (!key) return;
    placed.push({
      at: index,
      button: {
        kind: 'item', key, label: stepButtonLabel(step, vars), step: renderStepText(step.name, vars ?? {}),
        done: Boolean(ticks?.[key]),
        lastMile: step.trigger === 'dispatched' || step.trigger === 'delivered' ? step.trigger : null,
      },
    });
  });

  const end = lotEndIndex(route);
  for (let index = lotOffset(route); index <= end && index < steps.length; index += 1) {
    const step = steps[index]!;
    if (stepTickKey(step)) continue;
    const name = renderStepText(step.name, vars ?? {});
    placed.push({ at: track.at(index), button: { kind: 'lot', to: index, label: name, step: name, done: lotStep >= index } });
  }

  return placed.sort((a, b) => a.at - b.at).map((entry) => entry.button);
}
