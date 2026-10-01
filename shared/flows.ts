import { ORDER_CHECKPOINTS, type OrderCheckpoint } from './enums.js';
import type { BaseDocument } from './models.js';
import type { LotRoute, RouteStep } from './routes.js';

/**
 * Flows: the three pieces an item's journey is built from.
 *
 *   Items before lot  →  In a lot  →  After a lot
 *
 * The middle piece is a route, written in the route builders as it always
 * was. The two ends are button kits: the buttons a seller (or whoever is
 * holding the piece) presses on one item, before it is in a lot and after
 * the lot is unpacked. A kit is saved on its own, so "Freight forwarder
 * receives" is written once and snapped onto any number of flows; a flow is
 * just the three pieces wired together.
 *
 * Every button is still one of the shop's checkpoints underneath - that is
 * what the board counts, what starts the buyer-protection clock and what a
 * route step binds to - so a kit never invents a tick the rest of the shop
 * cannot read. What it changes is which buttons appear, what they are called,
 * who presses them and what the buyer's timeline says when they do.
 */

export type KitStage = 'before' | 'after';

export const KIT_WHO = ['me', 'supplier', 'forwarder', 'warehouse', 'handler', 'courier'] as const;
export type KitWho = (typeof KIT_WHO)[number];

export const KIT_WHO_META: Record<KitWho, { label: string; icon: string }> = {
  me: { label: 'Me', icon: '🧑' },
  supplier: { label: 'Supplier', icon: '🏭' },
  forwarder: { label: 'Freight forwarder', icon: '🚢' },
  warehouse: { label: 'Warehouse', icon: '🏬' },
  handler: { label: 'Local handler', icon: '🧰' },
  courier: { label: 'Courier', icon: '🚚' },
};

/** One button on one item. */
export interface KitButton {
  id: string;
  /** The tick it writes. */
  checkpoint: OrderCheckpoint;
  /** What the button says, short enough for a chip. */
  label: string;
  /** Who presses it, which is also who the buyer is told has the piece. */
  who: KitWho;
  icon: string;
  /** What the buyer's timeline says once it is pressed. */
  step: string;
}

/** A kit as an item or a lot carries it: a copy, like a lot's route. */
export interface KitSnapshot {
  kitId: string;
  name: string;
  buttons: KitButton[];
}

export interface ButtonKit extends BaseDocument {
  kind: 'kit';
  /** Partition key. Empty on the built-in kits, which belong to nobody. */
  sellerId: string;
  stage: KitStage;
  name: string;
  buttons: KitButton[];
  /** The one kit of its stage new items (or unpacked lots) get when nothing else is said. */
  isDefault?: boolean;
}

export interface RouteFlow extends BaseDocument {
  kind: 'flow';
  sellerId: string;
  name: string;
  beforeKitId: string | null;
  /** One of the shop's saved routes - the lot's piece. */
  routeId: string | null;
  afterKitId: string | null;
  isDefault?: boolean;
}

export type FlowDoc = ButtonKit | RouteFlow;

/**
 * The checkpoints each end may use.
 *
 * Before the lot an item can only be received and packed abroad: everything
 * after that happens to the consignment. After the lot it is the domestic
 * half, one parcel at a time.
 */
export const KIT_CHECKPOINTS: Record<KitStage, readonly OrderCheckpoint[]> = {
  before: ['china_received', 'china_packed'],
  after: ['india_received', 'ready_to_dispatch', 'packed', 'dispatched', 'delivered'],
};

/**
 * The buttons a kit cannot drop: dispatch starts the protection clock and
 * delivered puts the piece in the buyer's collection. A last mile without
 * them is a parcel nobody can finish.
 */
export const KIT_LOCKED: Record<KitStage, readonly OrderCheckpoint[]> = {
  before: [],
  after: ['dispatched', 'delivered'],
};

/** What a fresh button for each checkpoint says, before anyone renames it. */
export const KIT_BUTTON_DEFAULTS: Record<OrderCheckpoint, Omit<KitButton, 'id' | 'checkpoint'>> = {
  china_received: { label: 'Received', who: 'warehouse', icon: '📥', step: 'Received at the overseas warehouse' },
  china_packed: { label: 'Packed', who: 'warehouse', icon: '📦', step: 'Packed and waiting for the lot' },
  india_received: { label: 'Unpacked', who: 'me', icon: '📬', step: 'Unpacked at our warehouse' },
  ready_to_dispatch: { label: 'Checked', who: 'me', icon: '🔍', step: 'Checked and ready to go out' },
  packed: { label: 'Packed', who: 'me', icon: '🎁', step: 'Packed for you' },
  dispatched: { label: 'Dispatched', who: 'courier', icon: '🚚', step: 'Handed to the courier' },
  delivered: { label: 'Delivered', who: 'courier', icon: '✅', step: 'Delivered' },
};

const button = (checkpoint: OrderCheckpoint, over: Partial<KitButton> = {}): KitButton => ({
  id: `b_${checkpoint}`,
  checkpoint,
  ...KIT_BUTTON_DEFAULTS[checkpoint],
  ...over,
});

const builtIn = (id: string, stage: KitStage, name: string, buttons: KitButton[], isDefault = false): ButtonKit => ({
  id, kind: 'kit', sellerId: '', stage, name, buttons, isDefault,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

/**
 * The kits every shop starts with.
 *
 * Who gets the piece first is the whole difference between them: a warehouse,
 * a freight forwarder, or the supplier holding it until the run fills.
 */
export const BUILT_IN_KITS: readonly ButtonKit[] = [
  builtIn('kit_bi_warehouse', 'before', 'China warehouse', [
    button('china_received', { label: 'China WH', who: 'warehouse', icon: '🏬', step: 'Received at the China warehouse' }),
    button('china_packed', { label: 'Packed CH', who: 'warehouse', icon: '📦', step: 'Packed at the warehouse' }),
  ]),
  builtIn('kit_bi_forwarder', 'before', 'Freight forwarder', [
    button('china_received', { label: 'Forwarder got it', who: 'forwarder', icon: '🚢', step: 'Received by the freight forwarder' }),
    button('china_packed', { label: 'Forwarder packed', who: 'forwarder', icon: '📦', step: 'Packed by the freight forwarder' }),
  ]),
  builtIn('kit_bi_supplier', 'before', 'Supplier holds it', [
    button('china_received', { label: 'With supplier', who: 'supplier', icon: '🏭', step: 'Secured at the supplier' }),
    button('china_packed', { label: 'Sent on', who: 'supplier', icon: '📤', step: 'Sent on by the supplier' }),
  ]),
  builtIn('kit_bi_one', 'before', 'One tick', [
    button('china_received', { label: 'Received', who: 'me', icon: '✋', step: 'Received abroad' }),
  ]),
  builtIn('kit_bi_full', 'after', 'Full last mile', [
    button('india_received'), button('ready_to_dispatch'), button('packed'),
    button('dispatched'), button('delivered'),
  ]),
  builtIn('kit_bi_quick', 'after', 'Straight to courier', [
    button('dispatched'), button('delivered'),
  ]),
  builtIn('kit_bi_handler', 'after', 'Local handler', [
    button('india_received', { label: 'Handler got it', who: 'handler', icon: '🧰', step: 'With our local handler' }),
    button('packed', { label: 'Handler packed', who: 'handler', icon: '🎁', step: 'Packed by our handler' }),
    button('dispatched', { who: 'handler' }),
    button('delivered'),
  ]),
];

export const DEFAULT_KIT_IDS: Record<KitStage, string> = {
  before: 'kit_bi_warehouse',
  after: 'kit_bi_full',
};

export function isBuiltInKit(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith('kit_bi_'));
}

export function builtInKit(id: string | null | undefined): ButtonKit | undefined {
  return BUILT_IN_KITS.find((kit) => kit.id === id);
}

/** Flows to start from, shown under "Create" so the empty page is never empty. */
export interface SampleFlow {
  id: string;
  name: string;
  blurb: string;
  beforeKitId: string;
  /** A route template a fresh route can be written from - see ROUTE_TEMPLATES. */
  routeTemplateId: string;
  routeName: string;
  afterKitId: string;
}

export const SAMPLE_FLOWS: readonly SampleFlow[] = [
  {
    id: 'sample_forwarder',
    name: 'Forwarder run',
    blurb: 'The supplier ships to your forwarder, the lot flies, you courier each piece.',
    beforeKitId: 'kit_bi_forwarder',
    routeTemplateId: 'direct_to_forwarder',
    routeName: 'Direct to Freight Forwarder',
    afterKitId: 'kit_bi_full',
  },
  {
    id: 'sample_supplier',
    name: 'Supplier fills the run',
    blurb: 'The supplier holds pieces until the run is full, then it all moves at once.',
    beforeKitId: 'kit_bi_supplier',
    routeTemplateId: 'supplier_accumulates',
    routeName: 'Supplier Accumulates',
    afterKitId: 'kit_bi_quick',
  },
  {
    id: 'sample_handler',
    name: 'Warehouse to handler',
    blurb: 'Counted into a China warehouse; a local handler finishes the last mile.',
    beforeKitId: 'kit_bi_warehouse',
    routeTemplateId: 'direct_to_forwarder',
    routeName: 'Direct to Freight Forwarder',
    afterKitId: 'kit_bi_handler',
  },
];

const clip = (text: unknown, max: number) => (typeof text === 'string' ? text.trim().slice(0, max) : '');

/**
 * A kit's buttons as the server will keep them.
 *
 * Only checkpoints its stage may use, each at most once, in the order a piece
 * actually travels - and, after the lot, always with dispatch and delivery,
 * added back if they were taken out.
 */
export function normaliseKitButtons(stage: KitStage, raw: readonly Partial<KitButton>[] | undefined): KitButton[] {
  const allowed = KIT_CHECKPOINTS[stage];
  const seen = new Map<OrderCheckpoint, KitButton>();
  for (const entry of raw ?? []) {
    const checkpoint = entry.checkpoint;
    if (!checkpoint || !allowed.includes(checkpoint) || seen.has(checkpoint)) continue;
    const fallback = KIT_BUTTON_DEFAULTS[checkpoint];
    seen.set(checkpoint, {
      id: `b_${checkpoint}`,
      checkpoint,
      label: clip(entry.label, 24) || fallback.label,
      who: entry.who && (KIT_WHO as readonly string[]).includes(entry.who) ? entry.who : fallback.who,
      icon: clip(entry.icon, 8) || fallback.icon,
      step: clip(entry.step, 80) || fallback.step,
    });
  }
  for (const locked of KIT_LOCKED[stage]) {
    if (!seen.has(locked)) seen.set(locked, button(locked));
  }
  return ORDER_CHECKPOINTS.filter((checkpoint) => seen.has(checkpoint)).map((checkpoint) => seen.get(checkpoint)!);
}

export function snapshotOf(kit: Pick<ButtonKit, 'id' | 'name' | 'buttons'>): KitSnapshot {
  return { kitId: kit.id, name: kit.name, buttons: kit.buttons.map((entry) => ({ ...entry })) };
}

/** The buttons an item shows for one end: its own kit, or the built-in default. */
export function kitButtons(kit: KitSnapshot | null | undefined, stage: KitStage): KitButton[] {
  if (kit && kit.buttons.length > 0) return kit.buttons;
  return builtInKit(DEFAULT_KIT_IDS[stage])!.buttons;
}

/** The button a checkpoint is pressed as, on either end. */
export function buttonFor(
  checkpoint: OrderCheckpoint,
  ...kits: (KitSnapshot | null | undefined)[]
): KitButton | undefined {
  for (const kit of kits) {
    const found = kit?.buttons.find((entry) => entry.checkpoint === checkpoint);
    if (found) return found;
  }
  return undefined;
}

/**
 * The before-lot ladder a kit describes.
 *
 * "Order placed", then one rung per button, each bound to its button - so
 * pressing "Forwarder got it" on the item moves its buyer's timeline to
 * "Received by the freight forwarder", exactly as a route's bound step does.
 */
export function kitToPreLotRoute(kit: Pick<ButtonKit, 'name' | 'buttons'>): LotRoute {
  const steps: RouteStep[] = [
    { id: 'pre_placed', name: 'Order placed', description: '', position: 0, side: 'pre' },
    ...kit.buttons.map((entry, index) => ({
      id: `pre_${entry.checkpoint}`,
      name: entry.step,
      description: `${KIT_WHO_META[entry.who].label}: ${entry.label}.`,
      position: index + 1,
      side: 'pre' as const,
      trigger: entry.checkpoint,
    })),
  ];
  return { routeId: null, name: kit.name, steps };
}
