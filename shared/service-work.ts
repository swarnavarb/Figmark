import type {
  ArtistOffering, FreightLane, InfoRow, InsurancePlan, PriceBasis, PriceOption, ServiceAddon, ServiceFieldKey, ServiceFormField,
  StoreWarehouse, VolumetricRule,
} from './models.js';
import type { StoreKind } from './service-stores.js';

/**
 * The work a forwarder or artist store takes straight from customers.
 *
 * Until now a forwarder was only ever booked by a shop on a lot, and an artist
 * only commissioned from an order bought here. Both stores also serve people
 * directly: someone who bought on Taobao and needs the parcel flown, someone
 * who wants a figure repainted that never passed through a shop here. So a
 * store publishes what it charges on each route or service, the customer picks
 * one and fills in the store's own form, and the request lands with the whole
 * team at once.
 *
 * Shared by the API and the app, so the form a customer sees is the form the
 * server validates, and the estimate on the screen is the one it stores.
 */

/* ── Where the work lives ────────────────────────────────────────────── */

/** The partition a store's work, channel and followers live in. */
export function storeKey(kind: StoreKind, ownerId: string): string {
  return `${kind}:${ownerId}`;
}

export function parseStoreKey(key: string): { kind: StoreKind; ownerId: string } | null {
  const at = key.indexOf(':');
  const kind = key.slice(0, at);
  const ownerId = key.slice(at + 1);
  if ((kind !== 'forwarder' && kind !== 'artist') || !ownerId) return null;
  return { kind, ownerId };
}

/* ── The request form ────────────────────────────────────────────────── */

export const FIELD_TYPE_LABELS: Record<ServiceFormField['type'], string> = {
  text: 'Short answer',
  longtext: 'Paragraph',
  number: 'Number',
  choice: 'Pick one',
  yesno: 'Yes / no',
  date: 'Date',
  items: 'List of items',
  address: 'Delivery address',
  dimensions: 'Box size (cm)',
};

/** Types a store can add as its own custom fields. */
export const CUSTOM_FIELD_TYPES = ['text', 'longtext', 'number', 'choice', 'yesno', 'date'] as const;

/**
 * Fields a store cannot remove, because the request cannot be priced or
 * delivered without them. They can be relabelled and given help text.
 */
export const LOCKED_FIELDS: Record<StoreKind, readonly ServiceFieldKey[]> = {
  forwarder: ['weight', 'items', 'battery', 'delivery'],
  artist: ['brief', 'return_delivery'],
};

const field = (key: ServiceFieldKey, label: string, type: ServiceFormField['type'], required: boolean, help?: string): ServiceFormField => ({
  id: key, key, label, type, required, ...(help ? { help } : {}),
});

/** The form every store opens with, before it changes anything. */
export function defaultForm(kind: StoreKind): ServiceFormField[] {
  if (kind === 'forwarder') {
    return [
      field('awb', 'Tracking ID / AWB', 'text', false, 'The number on the parcel coming to our warehouse. Add it later if it has not shipped yet.'),
      field('origin_courier', 'Courier to our warehouse', 'text', false, 'SF Express, YTO, ZTO…'),
      field('items', 'What is in the parcel', 'items', true, 'One line per item, with how many and what each is worth.'),
      field('weight', 'Approximate weight (kg)', 'number', true),
      field('dimensions', 'Box size', 'dimensions', false, 'Length × width × height in cm. Used when a parcel is charged by size.'),
      field('battery', 'Anything with a battery?', 'yesno', true, 'Light-up bases, figures with LEDs, power banks.'),
      field('declared_value', 'Declared value (₹)', 'number', false, 'What the contents are worth, for customs and cover.'),
      field('delivery', 'Deliver to', 'address', true),
      field('notes', 'Anything else', 'longtext', false),
    ];
  }
  return [
    field('piece', 'Which piece', 'text', true, 'The figure, its scale and maker.'),
    field('brief', 'What you want done', 'longtext', true, 'Colours, references, what to keep as it is.'),
    field('refs', 'Reference links', 'longtext', false, 'One link per line.'),
    field('deadline', 'Needed by', 'date', false),
    field('return_delivery', 'Send it back to', 'address', true),
    field('notes', 'Anything else', 'longtext', false),
  ];
}

/** The store's form, or the default when it has never changed it. */
export function formOf(kind: StoreKind, form: ServiceFormField[] | null | undefined): ServiceFormField[] {
  if (!form || form.length === 0) return defaultForm(kind);
  // A locked field taken out by an older client is put back where the default has it.
  const present = new Set(form.map((row) => row.key).filter(Boolean));
  const missing = defaultForm(kind).filter((row) => row.key && LOCKED_FIELDS[kind].includes(row.key) && !present.has(row.key));
  return [...form, ...missing];
}

/** One line of the items list. */
export interface ItemRow {
  name: string;
  qty: number;
  /** Per item, in paise. */
  valueMinor: number;
}

export interface AddressValue {
  name: string;
  phone: string;
  line: string;
  city: string;
  state: string;
  pincode: string;
}

export interface Dimensions {
  l: number;
  w: number;
  h: number;
}

export type AnswerValue = string | number | boolean | ItemRow[] | AddressValue | Dimensions | null;
export type Answers = Record<string, AnswerValue>;

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const num = (value: unknown, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};

export const emptyAddress = (): AddressValue => ({ name: '', phone: '', line: '', city: '', state: '', pincode: '' });

/** Whether an answer is there at all, for a required field. */
function isGiven(fieldDef: ServiceFormField, value: AnswerValue): boolean {
  switch (fieldDef.type) {
    case 'yesno': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && value > 0;
    case 'items': return Array.isArray(value) && value.some((row) => (row as ItemRow).name);
    case 'address': {
      const a = value as AddressValue | null;
      return Boolean(a && a.name && a.phone && a.line && a.city && a.pincode);
    }
    case 'dimensions': {
      const d = value as Dimensions | null;
      return Boolean(d && d.l > 0 && d.w > 0 && d.h > 0);
    }
    default: return typeof value === 'string' && value.trim().length > 0;
  }
}

/** One answer, cleaned to the shape its field expects. */
function cleanAnswer(fieldDef: ServiceFormField, value: unknown): AnswerValue {
  switch (fieldDef.type) {
    case 'yesno': return typeof value === 'boolean' ? value : null;
    case 'number': return num(value, 1_000_000_000) || null;
    case 'items': return Array.isArray(value)
      ? value.slice(0, 40).map((raw) => ({
        name: str((raw as ItemRow)?.name, 120),
        qty: Math.max(1, Math.round(num((raw as ItemRow)?.qty, 999)) || 1),
        valueMinor: Math.round(num((raw as ItemRow)?.valueMinor, 100_000_000)),
      })).filter((row) => row.name)
      : [];
    case 'address': {
      const a = (value ?? {}) as Partial<AddressValue>;
      return {
        name: str(a.name, 80), phone: str(a.phone, 20), line: str(a.line, 300),
        city: str(a.city, 60), state: str(a.state, 60), pincode: str(a.pincode, 12),
      };
    }
    case 'dimensions': {
      const d = (value ?? {}) as Partial<Dimensions>;
      const out = { l: num(d.l, 500), w: num(d.w, 500), h: num(d.h, 500) };
      return out.l || out.w || out.h ? out : null;
    }
    case 'choice': {
      const picked = str(value, 120);
      return fieldDef.options?.includes(picked) ? picked : '';
    }
    case 'longtext': return str(value, 2000);
    default: return str(value, 300);
  }
}

/** The answers, cleaned, and the required fields still empty. */
export function checkAnswers(form: ServiceFormField[], raw: Record<string, unknown> | null | undefined): { answers: Answers; gaps: string[] } {
  const answers: Answers = {};
  const gaps: string[] = [];
  for (const fieldDef of form) {
    const value = cleanAnswer(fieldDef, raw?.[fieldDef.id]);
    answers[fieldDef.id] = value;
    if (fieldDef.required && !isGiven(fieldDef, value)) gaps.push(fieldDef.label);
  }
  return { answers, gaps };
}

/** An answer by the key the app reads, wherever the store put that field. */
export function answerFor<T extends AnswerValue>(form: ServiceFormField[], answers: Answers, key: ServiceFieldKey): T | null {
  const fieldDef = form.find((row) => row.key === key);
  return fieldDef ? ((answers[fieldDef.id] ?? null) as T | null) : null;
}

/** An answer as one line of text, for lists and notifications. */
export function answerText(fieldDef: Pick<ServiceFormField, 'type'>, value: AnswerValue): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (fieldDef.type) {
    case 'yesno': return value ? 'Yes' : 'No';
    case 'items': return (value as ItemRow[]).map((row) => `${row.qty} × ${row.name}`).join(', ') || '—';
    case 'address': {
      const a = value as AddressValue;
      return [a.name, a.phone, a.line, a.city, a.state, a.pincode].filter(Boolean).join(', ') || '—';
    }
    case 'dimensions': {
      const d = value as Dimensions;
      return `${d.l} × ${d.w} × ${d.h} cm`;
    }
    default: return String(value);
  }
}

/** A store's own form, read in from the editor: ids kept, locked fields kept. */
export function readForm(kind: StoreKind, input: unknown): ServiceFormField[] | null {
  if (!Array.isArray(input)) return null;
  const known = new Map(defaultForm(kind).map((row) => [row.key!, row]));
  const seen = new Set<string>();
  const out: ServiceFormField[] = [];
  for (const raw of input.slice(0, 30) as Partial<ServiceFormField>[]) {
    const key = raw.key && known.has(raw.key) ? raw.key : undefined;
    const base = key ? known.get(key)! : null;
    const id = key ?? (str(raw.id, 40) || `f_${Math.random().toString(36).slice(2, 8)}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const type = base ? base.type : ((CUSTOM_FIELD_TYPES as readonly string[]).includes(raw.type as string) ? raw.type! : 'text');
    const options = type === 'choice'
      ? [...new Set((Array.isArray(raw.options) ? raw.options : []).map((option) => str(option, 60)).filter(Boolean))].slice(0, 12)
      : undefined;
    const locked = key ? LOCKED_FIELDS[kind].includes(key) : false;
    out.push({
      id,
      ...(key ? { key } : {}),
      label: str(raw.label, 80) || base?.label || 'Question',
      type,
      required: locked ? true : raw.required === true,
      ...(str(raw.help, 200) ? { help: str(raw.help, 200) } : {}),
      ...(options ? { options } : {}),
    });
  }
  return formOf(kind, out);
}

/* ── Pricing a route or a service ────────────────────────────────────── */

export const BASIS_LABELS: Record<PriceBasis, string> = { kg: 'per kg', piece: 'per piece', flat: 'flat' };

/** The lowest price a route or service is offered at: its "from". */
export function fromPriceMinor(base: number, options: readonly PriceOption[] | undefined): number {
  const all = [base, ...(options ?? []).map((row) => row.priceMinor)].filter((value) => value > 0);
  return all.length > 0 ? Math.min(...all) : 0;
}

/**
 * A route's "from" price per kg. Only per-kg prices compete: a ₹180 per-piece
 * card price is not cheaper freight than ₹450 a kilo, just a different unit.
 */
export function laneFromMinor(lane: Pick<FreightLane, 'ratePerKgMinor' | 'products'>): number {
  return fromPriceMinor(lane.ratePerKgMinor, (lane.products ?? []).filter((row) => row.basis === 'kg'));
}

/** Volumetric weight in kg for a box, by the route's divisor. */
export function volumetricKg(rule: Pick<VolumetricRule, 'divisor'>, box: Dimensions | null | undefined): number {
  if (!box || !rule.divisor) return 0;
  return (box.l * box.w * box.h) / rule.divisor;
}

/** The weight a forwarder bills, and which rule decided it. */
export function chargeableKg(
  lane: Pick<FreightLane, 'minChargeKg' | 'volumetric'>,
  actualKg: number,
  box: Dimensions | null | undefined,
): { kg: number; by: 'actual' | 'volumetric' | 'minimum'; volumetricKg: number } {
  const rule = lane.volumetric ?? null;
  const vol = rule ? volumetricKg(rule, box) : 0;
  let kg = actualKg;
  let by: 'actual' | 'volumetric' | 'minimum' = 'actual';
  if (rule && vol > 0) {
    const switches = rule.mode === 'greater' ? vol > actualKg : vol > actualKg * (rule.overFactor || 1);
    if (switches) { kg = vol; by = 'volumetric'; }
  }
  if ((lane.minChargeKg || 0) > kg) { kg = lane.minChargeKg; by = 'minimum'; }
  return { kg: Math.round(kg * 100) / 100, by, volumetricKg: Math.round(vol * 100) / 100 };
}

export interface Estimate {
  /** Freight or the service, before cover. */
  baseMinor: number;
  /** The extras ticked - door-to-door delivery and the like. */
  addonsMinor: number;
  premiumMinor: number;
  totalMinor: number;
  /** For a forwarder: what was billed by. */
  chargeable: ReturnType<typeof chargeableKg> | null;
  /** Lines to show, in order. */
  lines: { label: string; minor: number }[];
}

/**
 * What a request should come to, as the store's own prices say.
 *
 * An estimate, always: the forwarder weighs the parcel when it lands and the
 * artist sees the piece before quoting. It is what the customer agrees to ask
 * for, and the figure the team starts its quote from.
 */
export function estimate(input: {
  kind: StoreKind;
  lane?: Pick<FreightLane, 'ratePerKgMinor' | 'minChargeKg' | 'volumetric'> | null;
  offering?: Pick<ArtistOffering, 'priceFromMinor'> | null;
  option?: PriceOption | null;
  weightKg?: number;
  box?: Dimensions | null;
  pieces?: number;
  plan?: Pick<InsurancePlan, 'premiumBasisPoints' | 'minPremiumMinor'> | null;
  declaredMinor?: number;
  addons?: readonly Pick<ServiceAddon, 'name' | 'priceMinor'>[];
}): Estimate {
  const lines: Estimate['lines'] = [];
  let baseMinor = 0;
  let chargeable: Estimate['chargeable'] = null;
  const pieces = Math.max(1, input.pieces ?? 1);

  if (input.kind === 'forwarder' && input.lane) {
    chargeable = chargeableKg(input.lane, input.weightKg ?? 0, input.box);
    const option = input.option;
    if (option?.basis === 'piece') baseMinor = option.priceMinor * pieces;
    else if (option?.basis === 'flat') baseMinor = option.priceMinor;
    else baseMinor = Math.round(chargeable.kg * (option?.priceMinor || input.lane.ratePerKgMinor));
    const how = option?.basis === 'piece' ? `${pieces} × ${option.name}`
      : option?.basis === 'flat' ? option.name
        : `${chargeable.kg} kg${chargeable.by === 'volumetric' ? ' (volumetric)' : chargeable.by === 'minimum' ? ' (minimum)' : ''}${option ? ` · ${option.name}` : ''}`;
    lines.push({ label: `Freight · ${how}`, minor: baseMinor });
  } else if (input.kind === 'artist') {
    const option = input.option;
    baseMinor = option
      ? (option.basis === 'piece' ? option.priceMinor * pieces : option.priceMinor)
      : (input.offering?.priceFromMinor ?? 0);
    lines.push({ label: option ? option.name : 'From', minor: baseMinor });
  }

  let addonsMinor = 0;
  for (const addon of input.addons ?? []) {
    addonsMinor += addon.priceMinor;
    lines.push({ label: addon.name, minor: addon.priceMinor });
  }

  let premiumMinor = 0;
  if (input.plan && planIsFree(input.plan)) {
    lines.push({ label: 'Transit cover', minor: 0 });
  } else if (input.plan && (input.declaredMinor ?? 0) > 0) {
    premiumMinor = Math.max(input.plan.minPremiumMinor || 0, Math.round(((input.declaredMinor ?? 0) * input.plan.premiumBasisPoints) / 10_000));
    lines.push({ label: 'Transit cover', minor: premiumMinor });
  }
  return { baseMinor, addonsMinor, premiumMinor, totalMinor: baseMinor + addonsMinor + premiumMinor, chargeable, lines };
}

/** Cover the forwarder includes at no charge. */
export function planIsFree(plan: Pick<InsurancePlan, 'premiumBasisPoints' | 'minPremiumMinor'>): boolean {
  return !plan.premiumBasisPoints && !plan.minPremiumMinor;
}

/** Read a store's extras from a form. Free ones are kept. */
export function readAddons(input: unknown): ServiceAddon[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).map((raw: Partial<ServiceAddon>) => ({
    id: str(raw.id, 40) || `add_${Math.random().toString(36).slice(2, 9)}`,
    name: str(raw.name, 80),
    priceMinor: Math.max(0, Math.round(num(raw.priceMinor, 100_000_000))),
    note: str(raw.note, 160),
  })).filter((row) => row.name);
}

/** Every origin address a customer may send to on a route, falling back to the store's main one. */
export function warehousesOf(
  lane: Pick<FreightLane, 'warehouse' | 'warehouses'> | null | undefined,
  storeWarehouse: StoreWarehouse | null | undefined,
): StoreWarehouse[] {
  if (lane?.warehouses?.length) return lane.warehouses;
  if (lane?.warehouse) return [lane.warehouse];
  return storeWarehouse ? [storeWarehouse] : [];
}

/** Read a list of warehouses from a form. */
export function readWarehouses(input: unknown): StoreWarehouse[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map(readWarehouse).filter((row): row is StoreWarehouse => row !== null);
}

/** A form link a store may send customers to: https only. */
export function readFormUrl(input: unknown): string | null {
  const raw = str(input, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Read price options from a form. */
export function readOptions(input: unknown, prefix = 'opt'): PriceOption[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).map((raw: Partial<PriceOption>) => ({
    id: str(raw.id, 40) || `${prefix}_${Math.random().toString(36).slice(2, 9)}`,
    name: str(raw.name, 80),
    basis: (['kg', 'piece', 'flat'] as const).includes(raw.basis as PriceBasis) ? raw.basis as PriceBasis : 'kg',
    priceMinor: Math.round(num(raw.priceMinor, 1_000_000_000)),
    note: str(raw.note, 160),
  })).filter((row) => row.name && row.priceMinor > 0);
}

export function readVolumetric(input: unknown): VolumetricRule | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<VolumetricRule>;
  const divisor = Math.round(num(raw.divisor, 20_000));
  if (!divisor) return null;
  return {
    divisor,
    mode: raw.mode === 'over' ? 'over' : 'greater',
    ...(raw.mode === 'over' ? { overFactor: Math.max(1, Math.min(10, Number(raw.overFactor) || 1.5)) } : {}),
    note: str(raw.note, 200),
  };
}

export function readInfoRows(input: unknown): InfoRow[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).map((raw: Partial<InfoRow>) => ({ label: str(raw.label, 60), value: str(raw.value, 400) }))
    .filter((row) => row.label && row.value);
}

export function readWarehouse(input: unknown): StoreWarehouse | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<StoreWarehouse>;
  const address = str(raw.address, 400);
  const name = str(raw.name, 80);
  return address ? { ...(name ? { name } : {}), address, contact: str(raw.contact, 120), hours: str(raw.hours, 120) } : null;
}

/** A plain-words line for a volumetric rule. */
export function volumetricLabel(rule: VolumetricRule): string {
  const base = `L × W × H (cm) ÷ ${rule.divisor}`;
  return rule.mode === 'greater'
    ? `Charged on the greater of actual and volumetric weight (${base}).`
    : `Charged by volumetric weight (${base}) once it is over ${rule.overFactor ?? 1.5}× the actual weight.`;
}

/* ── A request, start to finish ──────────────────────────────────────── */

export const REQUEST_STATUSES = [
  'submitted', 'quoted', 'accepted', 'paid', 'received', 'in_progress', 'shipped', 'delivered', 'declined', 'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** The steps a request moves through, for the progress strip. */
export const REQUEST_FLOW: readonly RequestStatus[] = ['submitted', 'quoted', 'accepted', 'paid', 'received', 'in_progress', 'shipped', 'delivered'];

type Tone = 'ok' | 'warn' | 'quiet' | 'accent' | 'danger';

export const REQUEST_LABELS: Record<StoreKind, Record<RequestStatus, { label: string; tone: Tone }>> = {
  forwarder: {
    submitted: { label: 'New request', tone: 'warn' },
    quoted: { label: 'Quote sent', tone: 'accent' },
    accepted: { label: 'Waiting for payment', tone: 'warn' },
    paid: { label: 'Paid — send the parcel', tone: 'accent' },
    received: { label: 'At the warehouse', tone: 'accent' },
    in_progress: { label: 'In transit', tone: 'accent' },
    shipped: { label: 'Out for delivery', tone: 'ok' },
    delivered: { label: 'Delivered', tone: 'ok' },
    declined: { label: 'Declined', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'quiet' },
  },
  artist: {
    submitted: { label: 'New request', tone: 'warn' },
    quoted: { label: 'Quote sent', tone: 'accent' },
    accepted: { label: 'Waiting for payment', tone: 'warn' },
    paid: { label: 'Paid — send the piece', tone: 'accent' },
    received: { label: 'Piece received', tone: 'accent' },
    in_progress: { label: 'In the studio', tone: 'accent' },
    shipped: { label: 'Shipped back', tone: 'ok' },
    delivered: { label: 'Complete', tone: 'ok' },
    declined: { label: 'Declined', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'quiet' },
  },
};

export type RequestAction =
  | 'quote' | 'decline' | 'confirm_payment' | 'receive' | 'start' | 'ship' | 'deliver' | 'assign'
  | 'accept' | 'pay' | 'cancel' | 'complete' | 'review';

export const REQUEST_MOVES: Record<RequestAction, { by: 'store' | 'customer'; from: readonly RequestStatus[] }> = {
  quote: { by: 'store', from: ['submitted', 'quoted'] },
  decline: { by: 'store', from: ['submitted', 'quoted'] },
  confirm_payment: { by: 'store', from: ['accepted'] },
  receive: { by: 'store', from: ['paid'] },
  start: { by: 'store', from: ['received'] },
  ship: { by: 'store', from: ['in_progress'] },
  deliver: { by: 'store', from: ['shipped'] },
  assign: { by: 'store', from: ['submitted', 'quoted', 'accepted', 'paid', 'received', 'in_progress', 'shipped'] },
  accept: { by: 'customer', from: ['quoted'] },
  pay: { by: 'customer', from: ['accepted'] },
  cancel: { by: 'customer', from: ['submitted', 'quoted', 'accepted'] },
  complete: { by: 'customer', from: ['shipped'] },
  review: { by: 'customer', from: ['delivered'] },
};

/** The words on each button, by kind where they differ. */
export const ACTION_LABELS: Record<StoreKind, Partial<Record<RequestAction, string>>> = {
  forwarder: {
    quote: 'Send quote', decline: 'Decline', confirm_payment: 'The money arrived', receive: 'Parcel reached the warehouse',
    start: 'Shipped out — in transit', ship: 'Handed to domestic courier', deliver: 'Mark delivered',
    accept: 'Accept quote', pay: 'I have paid', cancel: 'Cancel request', complete: 'I got it', review: 'Rate this',
  },
  artist: {
    quote: 'Send quote', decline: 'Decline', confirm_payment: 'The money arrived', receive: 'The piece is here',
    start: 'Start work', ship: 'Shipped back', deliver: 'Mark complete',
    accept: 'Accept quote', pay: 'I have paid', cancel: 'Cancel request', complete: 'I got it back', review: 'Rate this',
  },
};

export interface RequestPayment {
  amountMinor: number;
  reference: string | null;
  claimedAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export interface RequestEvent {
  at: string;
  by: string;
  byName: string;
  note: string;
}

export interface RequestReview {
  stars: number;
  text: string;
  at: string;
}

/**
 * One request from a customer, or one payment link a store sent out.
 *
 * Kept whole in the store's partition of `serviceWork`: the console reads all
 * of a store's requests at once, and a customer reads their own across stores.
 */
export interface ServiceRequest {
  id: string;
  type: 'request';
  /** Partition key: `kind:ownerId`. */
  storeId: string;
  kind: StoreKind;
  ownerId: string;
  storeName: string;
  storeSlug: string;
  /** A short reference both sides can quote. */
  number: string;
  /** `form` - a customer asked. `link` - the store wrote it and sent a link to pay. */
  origin: 'form' | 'link';
  /** The route or service it is for. */
  subject: { id: string; label: string } | null;
  option: PriceOption | null;
  /** Null on a payment link nobody has opened yet. */
  customerId: string | null;
  customerName: string;
  customerHandle: string | null;
  /** The form as it was when they filled it in, so a later edit cannot change what they said. */
  fields: ServiceFormField[];
  answers: Answers;
  /** For a payment link: what it is for. */
  title: string;
  description: string;
  plan: { id: string; name: string; premiumMinor: number; coverMinor: number } | null;
  /** The extras ticked, as priced when they were. */
  addons?: { id: string; name: string; priceMinor: number }[];
  /** Details went in on the store's own form (`formUrl`), not here. */
  external?: boolean;
  estimateMinor: number;
  chargeableKg: number | null;
  quoteMinor: number | null;
  quoteNote: string;
  turnaroundDays: number | null;
  status: RequestStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  payment: RequestPayment | null;
  tracking: { courier: string; awb: string; at: string } | null;
  review: RequestReview | null;
  history: RequestEvent[];
  createdAt: string;
  updatedAt: string;
}

/** The moves one side may make now. */
export function requestActions(request: Pick<ServiceRequest, 'status' | 'payment' | 'review' | 'customerId'>, side: 'store' | 'customer'): RequestAction[] {
  return (Object.keys(REQUEST_MOVES) as RequestAction[]).filter((action) => {
    const move = REQUEST_MOVES[action];
    if (move.by !== side || !move.from.includes(request.status)) return false;
    const claimed = Boolean(request.payment && !request.payment.confirmedAt);
    if (action === 'pay') return !claimed;
    if (action === 'confirm_payment') return claimed;
    if (action === 'review') return !request.review;
    return true;
  });
}

/** What the customer owes once they accept: the quote, or the estimate if no quote was needed. */
export function requestDueMinor(request: Pick<ServiceRequest, 'quoteMinor' | 'estimateMinor' | 'plan'>): number {
  return (request.quoteMinor ?? request.estimateMinor) + (request.quoteMinor === null ? 0 : (request.plan?.premiumMinor ?? 0));
}

export function requestIsOpen(request: Pick<ServiceRequest, 'status'>): boolean {
  return !['delivered', 'declined', 'cancelled'].includes(request.status);
}

/** A short reference, readable down a phone line. */
export function requestNumber(kind: StoreKind): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 5; index += 1) code += letters[Math.floor(Math.random() * letters.length)];
  return `${kind === 'forwarder' ? 'FR' : 'AR'}-${code}`;
}

/* ── Standing: level, rating, reliability ────────────────────────────── */

export const SERVICE_LEVELS = [
  { level: 1, title: 'New', at: 0 },
  { level: 2, title: 'Rising', at: 3 },
  { level: 3, title: 'Trusted', at: 10 },
  { level: 4, title: 'Pro', at: 25 },
  { level: 5, title: 'Elite', at: 60 },
] as const;

export interface Standing {
  level: number;
  title: string;
  /** Points towards the next level, and what it takes. */
  points: number;
  next: number | null;
  rating: number | null;
  reviews: number;
  completed: number;
  /** Share of accepted work that reached the customer, 0-100. Null before there is any. */
  reliability: number | null;
}

/**
 * Where a store stands, from the work it finished here.
 *
 * Points are finished requests, plus a bonus for each four- or five-star
 * review and a penalty for each one- or two-star: a store levels up by doing
 * the work well, never by anything it writes about itself. Reliability is how
 * much of what it took on - paid work - reached the customer.
 */
export function standingOf(rows: readonly Pick<ServiceRequest, 'status' | 'review' | 'payment'>[], extraCompleted = 0): Standing {
  const completed = rows.filter((row) => row.status === 'delivered').length + extraCompleted;
  const reviews = rows.map((row) => row.review).filter((review): review is RequestReview => Boolean(review));
  const good = reviews.filter((review) => review.stars >= 4).length;
  const bad = reviews.filter((review) => review.stars <= 2).length;
  const points = Math.max(0, completed + good - bad * 2);
  const reached = [...SERVICE_LEVELS].reverse().find((row) => points >= row.at) ?? SERVICE_LEVELS[0];
  const next = SERVICE_LEVELS.find((row) => row.at > points) ?? null;
  const taken = rows.filter((row) => row.payment?.confirmedAt).length;
  const dropped = rows.filter((row) => row.payment?.confirmedAt && (row.status === 'cancelled' || row.status === 'declined')).length;
  return {
    level: reached.level,
    title: reached.title,
    points,
    next: next ? next.at : null,
    rating: reviews.length ? Math.round((reviews.reduce((sum, review) => sum + review.stars, 0) / reviews.length) * 10) / 10 : null,
    reviews: reviews.length,
    completed,
    reliability: taken > 0 ? Math.round(((taken - dropped) / taken) * 100) : null,
  };
}

/* ── The company channel ─────────────────────────────────────────────── */

/**
 * Who is talking: the company itself, somebody on its team as themselves (with
 * the tag the owner gave them), or a customer.
 */
export type ChannelVoice = 'company' | 'member' | 'visitor';

export interface ChannelMessage {
  id: string;
  type: 'chat';
  storeId: string;
  authorId: string;
  authorName: string;
  authorHandle: string | null;
  voice: ChannelVoice;
  /** The member's tag, as it was when they wrote. */
  tag: string | null;
  body: string;
  /** Company posts marked for every follower, which also rings their bell. */
  announcement: boolean;
  /** Shared to Social as well: the post there, as `channelId/id`'s id. */
  postId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreFollow {
  id: string;
  type: 'follow';
  storeId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export type ServiceWorkDoc = ServiceRequest | ChannelMessage | StoreFollow;

export const CHANNEL_MAX_CHARS = 1000;
export const followId = (userId: string) => `follow:${userId}`;
