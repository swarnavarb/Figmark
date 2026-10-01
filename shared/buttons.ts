import type { OrderCheckpoint } from './enums.js';
import {
  itemStepOn, joinIndexOf, leaveIndexOf, normaliseSteps, sideOf, stepButtonLabel, triggeredStep,
  type LotRoute, type RouteStep, type StepTrigger, type Ticks,
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
 * 3. The lot cannot carry an item past dispatch: if the "items leave the
 *    lot" line sits later than that, it is moved up to just after the lot
 *    lands (or to Dispatched itself).
 * 4. The other five checkpoints go to steps by what the steps say, in their
 *    real order, and only where the item is on its own: the two overseas
 *    ticks before the lot, the landing tick on the lot's last step or after
 *    it, ready and packed after the lot. Steps the lot moves get none.
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

type Zone = 'start' | 'pre' | 'lot' | 'landing' | 'item' | 'solo';

/** One button that moved, for the line that says so. */
export interface ButtonChange {
  id: string;
  name: string;
  from: StepTrigger | null;
  to: StepTrigger | null;
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
  const before = new Map(input.map((step) => [step.id, step.trigger ?? null]));
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
      leave = landed >= join && landed < dispatched ? landed + 1 : dispatched;
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
    if (index < leave) return index === leave - 1 ? 'landing' : 'lot';
    return 'item';
  };
  const score = (index: number, checkpoint: OrderCheckpoint): number => {
    const step = steps[index]!;
    const zone = zoneOf(index);
    const allowed = (() => {
      switch (checkpoint) {
        case 'china_received': return zone === 'pre' ? 'any' : zone === 'solo' ? 'said' : null;
        case 'china_packed': return zone === 'pre' ? 'any' : zone === 'solo' ? 'said' : null;
        case 'india_received': return zone === 'item' || zone === 'landing' ? 'said' : null;
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

  const slots = range(1, dispatched);
  const picked = matchInOrder(slots, MATCHED, score);

  steps = steps.map((step, index) => {
    const trigger: StepTrigger | undefined = index === delivered ? 'delivered'
      : index === dispatched ? 'dispatched'
        : picked.get(index);
    return { ...step, trigger, position: index };
  });

  const changes: ButtonChange[] = steps
    .filter((step) => before.has(step.id) && (before.get(step.id) ?? null) !== (step.trigger ?? null))
    .map((step) => ({ id: step.id, name: step.name, from: before.get(step.id) ?? null, to: step.trigger ?? null }));

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
    if (!step.trigger) continue;
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
  const idle = steps.filter((step, index) => index > 0 && !step.trigger && dispatched >= 0 && index < dispatched
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
  pressed: (trigger: StepTrigger) => boolean,
): { index: number; step: RouteStep } | { index: -1; waitingOnLot: true } | null {
  const join = joinIndexOf({ steps: [...steps] });
  const leave = leaveIndexOf({ steps: [...steps] });
  for (let index = current + 1; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (step.trigger && !pressed(step.trigger)) return { index, step };
    if (!step.trigger && index >= join && index < leave && join < steps.length) return { index: -1, waitingOnLot: true };
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

/** One button as an order card draws it. */
export interface CardButton { checkpoint: StepTrigger; label: string; step: string }

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
  checkpoint: step.trigger!, label: stepButtonLabel(step, vars), step: step.name,
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
  const pressed = (trigger: StepTrigger) => Boolean(ticks?.[trigger]);
  const found = nextButton(steps, current, pressed);
  const doneAt = triggeredStep(route, ticks);
  return {
    next: found && found.index >= 0 && 'step' in found ? asCard(found.step, vars) : null,
    done: doneAt >= 0 ? asCard(steps[doneAt]!, vars) : null,
    waitingOnLot: Boolean(found && found.index < 0),
  };
}
