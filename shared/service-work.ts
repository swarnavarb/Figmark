import type { FeeTerms } from './billing.js';
import type {
  ArtistOffering, BatteryContent, BatteryRule, FreightLane, InfoRow, InsurancePlan, PriceBasis, PriceOption, ServiceAddon,
  ServiceFieldKey, ServiceFormField, StoreWarehouse, VolumetricRule,
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
  forwarder: ['awb', 'weight', 'items', 'battery', 'delivery'],
  artist: ['brief', 'return_delivery'],
};

const field = (key: ServiceFieldKey, label: string, type: ServiceFormField['type'], required: boolean, help?: string): ServiceFormField => ({
  id: key, key, label, type, required, ...(help ? { help } : {}),
});

/**
 * Locked fields a customer may still leave blank when they book.
 *
 * A forwarder's delivery address is not needed until the parcel goes out for
 * delivery: the buyer can add or change it from My Purchases until they pay
 * the bill, and paying asks for it if it is still missing (see
 * `requestActions`, `address`).
 */
export const OPTIONAL_LOCKED: Record<StoreKind, readonly ServiceFieldKey[]> = {
  forwarder: ['delivery'],
  artist: [],
};

const DELIVERY_HELP = 'Leave it for now if you like - you can add or change it from My Purchases until you pay the bill.';

/** The form every store opens with, before it changes anything. */
export function defaultForm(kind: StoreKind): ServiceFormField[] {
  if (kind === 'forwarder') {
    return [
      field('awb', 'Tracking number / AWB', 'text', true, 'The tracking number on the box coming to our warehouse. We match your parcel to you by it.'),
      field('origin_courier', 'Courier to our warehouse', 'text', false, 'SF Express, YTO, ZTO…'),
      field('items', 'What is in the parcel', 'items', true, 'One line per item, with how many and what each is worth.'),
      field('weight', 'Approximate weight (kg)', 'number', true),
      field('dimensions', 'Box size', 'dimensions', false, 'Length × width × height in cm. Used when a parcel is charged by size.'),
      { ...field('battery', 'Batteries', 'choice', true, 'Light-up bases and figures with LEDs have one inside. Power banks and spare cells are loose.'), options: [...BATTERY_CHOICES] },
      field('declared_value', 'Declared value (₹)', 'number', false, 'What the contents are worth, for customs and cover.'),
      field('delivery', 'Deliver to', 'address', false, DELIVERY_HELP),
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

/* ── Batteries ───────────────────────────────────────────────────────── */

/** The answers on the form's battery question, in `BatteryContent` order. */
export const BATTERY_CHOICES = ['No battery', 'Battery inside an item', 'Loose battery or power bank'] as const;

export const BATTERY_RULE_LABELS: Record<BatteryRule, string> = {
  all: 'All batteries',
  in_device: 'Only batteries in devices',
  none: 'No batteries',
};

/** A route's battery rule, reading routes saved before there were categories. */
export function batteryRuleOf(lane: Pick<FreightLane, 'batteries' | 'batteryAllowed'>): BatteryRule {
  if (lane.batteries === 'all' || lane.batteries === 'in_device' || lane.batteries === 'none') return lane.batteries;
  return lane.batteryAllowed === false ? 'none' : 'all';
}

/** What the form's battery answer means. A yes from an older yes/no form is read as loose, the strict case. */
export function batteryContentOf(answer: unknown): BatteryContent {
  if (answer === true) return 'loose';
  if (answer === BATTERY_CHOICES[1]) return 'in_device';
  if (answer === BATTERY_CHOICES[2]) return 'loose';
  return 'none';
}

/** Whether a route takes a parcel holding this. */
export function batteryFits(rule: BatteryRule, content: BatteryContent): boolean {
  if (content === 'none') return true;
  if (rule === 'none') return false;
  return rule === 'all' || content === 'in_device';
}

/** The store's form, or the default when it has never changed it. */
export function formOf(kind: StoreKind, form: ServiceFormField[] | null | undefined): ServiceFormField[] {
  if (!form || form.length === 0) return defaultForm(kind);
  // A locked field taken out by an older client is put back where the default has it.
  const present = new Set(form.map((row) => row.key).filter(Boolean));
  const missing = defaultForm(kind).filter((row) => row.key && LOCKED_FIELDS[kind].includes(row.key) && !present.has(row.key));
  // The battery question became three choices; a form saved as yes / no asks the new way.
  const batteryField = defaultForm(kind).find((row) => row.key === 'battery');
  const upgraded = form.map((row) => (row.key === 'battery' && batteryField && row.type !== 'choice'
    ? { ...batteryField, ...(row.help ? { help: row.help } : {}), label: row.label === 'Anything with a battery?' ? batteryField.label : row.label }
    : row));
  // Locked fields are always required, whatever an older save said - the tracking number most of all.
  // The few a customer may fill in later (a forwarder's delivery address) are never required.
  const locked = upgraded.map((row) => {
    if (!row.key || !LOCKED_FIELDS[kind].includes(row.key)) return row;
    const required = !OPTIONAL_LOCKED[kind].includes(row.key);
    return row.required === required ? row : { ...row, required };
  });
  return [...locked, ...missing];
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

/** Whether an address has everything a courier needs. */
export function addressComplete(a: AddressValue | null | undefined): a is AddressValue {
  return Boolean(a && a.name && a.phone && a.line && a.city && a.pincode);
}

/** Whether an answer is there at all, for a required field. */
function isGiven(fieldDef: ServiceFormField, value: AnswerValue): boolean {
  switch (fieldDef.type) {
    case 'yesno': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && value > 0;
    case 'items': return Array.isArray(value) && value.some((row) => (row as ItemRow).name);
    case 'address': return addressComplete(value as AddressValue | null);
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
    const options = base?.options ? [...base.options] : type === 'choice'
      ? [...new Set((Array.isArray(raw.options) ? raw.options : []).map((option) => str(option, 60)).filter(Boolean))].slice(0, 12)
      : undefined;
    const locked = key ? LOCKED_FIELDS[kind].includes(key) : false;
    out.push({
      id,
      ...(key ? { key } : {}),
      label: str(raw.label, 80) || base?.label || 'Question',
      type,
      required: locked ? !OPTIONAL_LOCKED[kind].includes(key!) : raw.required === true,
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
  'submitted', 'quoted', 'accepted', 'booked', 'sent_in', 'paid', 'received', 'in_progress', 'billed', 'shipped', 'delivered', 'declined', 'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * How a request is paid for.
 *
 * `quote` - the store prices it first and the customer pays before the work:
 * every artist commission and payment link, and forwarder requests sent before
 * pay-on-arrival existed.
 *
 * `arrival` - a forwarder's listed (or custom-quoted) route: no quote, the
 * customer sends the parcel to the origin warehouse, the team weighs it when it
 * lands at the destination, sends the bill with a photo of the scale, and
 * delivers once paid.
 */
export type RequestBilling = 'quote' | 'arrival';

/** The steps a request moves through, for the progress strip. */
export const REQUEST_FLOW: readonly RequestStatus[] = ['submitted', 'quoted', 'accepted', 'paid', 'received', 'in_progress', 'shipped', 'delivered'];
export const ARRIVAL_FLOW: readonly RequestStatus[] = ['booked', 'sent_in', 'received', 'in_progress', 'billed', 'paid', 'shipped', 'delivered'];

export const flowOf = (request: Pick<ServiceRequest, 'billing'>): readonly RequestStatus[] =>
  request.billing === 'arrival' ? ARRIVAL_FLOW : REQUEST_FLOW;

type Tone = 'ok' | 'warn' | 'quiet' | 'accent' | 'danger';

export const REQUEST_LABELS: Record<StoreKind, Record<RequestStatus, { label: string; tone: Tone }>> = {
  forwarder: {
    submitted: { label: 'New request', tone: 'warn' },
    quoted: { label: 'Quote sent', tone: 'accent' },
    accepted: { label: 'Waiting for payment', tone: 'warn' },
    booked: { label: 'Waiting for the parcel', tone: 'warn' },
    sent_in: { label: 'On its way to the warehouse', tone: 'accent' },
    paid: { label: 'Paid — send the parcel', tone: 'accent' },
    received: { label: 'At the warehouse', tone: 'accent' },
    in_progress: { label: 'In transit', tone: 'accent' },
    billed: { label: 'Arrived — bill sent', tone: 'warn' },
    shipped: { label: 'Out for delivery', tone: 'ok' },
    delivered: { label: 'Delivered', tone: 'ok' },
    declined: { label: 'Declined', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'quiet' },
  },
  artist: {
    submitted: { label: 'New request', tone: 'warn' },
    quoted: { label: 'Quote sent', tone: 'accent' },
    accepted: { label: 'Waiting for payment', tone: 'warn' },
    booked: { label: 'Booked', tone: 'warn' },
    sent_in: { label: 'On its way to the studio', tone: 'accent' },
    paid: { label: 'Paid — send the piece', tone: 'accent' },
    received: { label: 'Piece received', tone: 'accent' },
    in_progress: { label: 'In the studio', tone: 'accent' },
    billed: { label: 'Bill sent', tone: 'warn' },
    shipped: { label: 'Shipped back', tone: 'ok' },
    delivered: { label: 'Complete', tone: 'ok' },
    declined: { label: 'Declined', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'quiet' },
  },
};

/** A request's label, with the pay-on-arrival words where they differ. */
export function statusLabel(request: Pick<ServiceRequest, 'kind' | 'status' | 'billing'>): { label: string; tone: Tone } {
  if (request.billing === 'arrival') {
    if (request.status === 'paid') return { label: 'Paid — delivering soon', tone: 'accent' };
    if (request.status === 'received') return { label: 'At the origin warehouse', tone: 'accent' };
  }
  return REQUEST_LABELS[request.kind][request.status];
}

export type RequestAction =
  | 'quote' | 'decline' | 'confirm_payment' | 'receive' | 'start' | 'ship' | 'deliver' | 'assign'
  | 'accept' | 'pay' | 'cancel' | 'complete' | 'review'
  | 'send_in' | 'bill' | 'pay_cover' | 'confirm_cover' | 'address';

type Moves = Partial<Record<RequestAction, { by: 'store' | 'customer'; from: readonly RequestStatus[] }>>;

const OPEN_ARRIVAL: readonly RequestStatus[] = ['booked', 'sent_in', 'received', 'in_progress', 'billed', 'paid', 'shipped'];

/** Pay on arrival: no quote, the bill comes once the parcel is weighed at the destination. */
export const ARRIVAL_MOVES: Moves = {
  send_in: { by: 'customer', from: ['booked'] },
  receive: { by: 'store', from: ['booked', 'sent_in'] },
  start: { by: 'store', from: ['received'] },
  bill: { by: 'store', from: ['received', 'in_progress', 'billed'] },
  pay: { by: 'customer', from: ['billed'] },
  confirm_payment: { by: 'store', from: ['billed'] },
  ship: { by: 'store', from: ['paid'] },
  deliver: { by: 'store', from: ['shipped'] },
  complete: { by: 'customer', from: ['shipped'] },
  review: { by: 'customer', from: ['delivered'] },
  cancel: { by: 'customer', from: ['booked', 'sent_in'] },
  decline: { by: 'store', from: ['booked', 'sent_in'] },
  assign: { by: 'store', from: OPEN_ARRIVAL },
  pay_cover: { by: 'customer', from: ['booked', 'sent_in', 'received', 'in_progress'] },
  // Where it is delivered can change until the bill is paid: the bill itself asks the buyer to check it.
  address: { by: 'customer', from: ['booked', 'sent_in', 'received', 'in_progress', 'billed'] },
  confirm_cover: { by: 'store', from: ['booked', 'sent_in', 'received', 'in_progress', 'billed'] },
};

export const REQUEST_MOVES: Moves = {
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
    send_in: 'I’ve sent it to the warehouse', bill: 'Send the bill', pay_cover: 'I paid for the cover', confirm_cover: 'Cover payment arrived',
    address: 'Save delivery address',
  },
  artist: {
    quote: 'Send quote', decline: 'Decline', confirm_payment: 'The money arrived', receive: 'The piece is here',
    start: 'Start work', ship: 'Shipped back', deliver: 'Mark complete',
    accept: 'Accept quote', pay: 'I have paid', cancel: 'Cancel request', complete: 'I got it back', review: 'Rate this',
  },
};

export interface RequestPayment {
  amountMinor: number;
  /** Paid out of store credit the store gave the customer: part of `amountMinor`. */
  creditMinor?: number;
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
  /** The status it moved to, when it moved: what the insights time things by. */
  status?: RequestStatus;
}

export interface RequestBill {
  weightKg: number;
  box: Dimensions | null;
  chargeableKg: number;
  by: 'actual' | 'volumetric' | 'minimum';
  photoUrls: string[];
  lines: { label: string; minor: number }[];
  totalMinor: number;
  note: string;
  at: string;
  byName: string;
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
  /** Absent on requests from before pay-on-arrival: those are `quote`. */
  billing?: RequestBilling;
  /** The custom quote it was booked on, if any. */
  quoteId?: string | null;
  /** The rate it was booked at, kept so a later price change cannot move the bill. */
  rate?: { ratePerKgMinor: number; minChargeKg: number; volumetric: VolumetricRule | null } | null;
  /** Where the parcel goes, as it was when booked. */
  sendTo?: StoreWarehouse[];
  /** For paid cover on a pay-on-arrival request: paid before sending, or on the bill. */
  coverDue?: 'upfront' | 'with_bill' | null;
  coverPayment?: RequestPayment | null;
  /** The customer's parcel on its way to the origin warehouse. */
  inbound?: { courier: string; awb: string; at: string } | null;
  /** Weighed at the destination: what is owed, and the photo of the scale. */
  bill?: RequestBill | null;
  /** Figmark's platform fee as agreed when the request was made. */
  feeTerms?: FeeTerms | null;
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

type ActionInput = Pick<ServiceRequest, 'status' | 'payment' | 'review' | 'customerId' | 'billing' | 'coverDue' | 'coverPayment' | 'plan'>;

/** Paid cover the customer pays before sending the parcel, and has not yet. */
export function coverOwedMinor(request: Pick<ServiceRequest, 'billing' | 'coverDue' | 'coverPayment' | 'plan'>): number {
  if (request.billing !== 'arrival' || request.coverDue !== 'upfront' || request.coverPayment) return 0;
  return request.plan?.premiumMinor ?? 0;
}

/** The moves one side may make now. */
export function requestActions(request: ActionInput, side: 'store' | 'customer'): RequestAction[] {
  const table = request.billing === 'arrival' ? ARRIVAL_MOVES : REQUEST_MOVES;
  return (Object.keys(table) as RequestAction[]).filter((action) => {
    const move = table[action]!;
    if (move.by !== side || !move.from.includes(request.status)) return false;
    const claimed = Boolean(request.payment && !request.payment.confirmedAt);
    if (action === 'pay') return !claimed;
    if (action === 'confirm_payment') return claimed;
    if (action === 'review') return !request.review;
    if (action === 'pay_cover') return coverOwedMinor(request) > 0;
    if (action === 'confirm_cover') return Boolean(request.coverPayment && !request.coverPayment.confirmedAt);
    if (action === 'bill') return !claimed;
    if (action === 'address') return !claimed;
    return true;
  });
}

/**
 * What the customer owes. On a quote: the quote (with any cover), or the
 * estimate if none was needed. Pay on arrival: the bill once weighed, and the
 * estimate until then - a guide, never charged.
 */
export function requestDueMinor(request: Pick<ServiceRequest, 'quoteMinor' | 'estimateMinor' | 'plan' | 'billing' | 'bill'>): number {
  if (request.billing === 'arrival') return request.bill?.totalMinor ?? request.estimateMinor;
  return (request.quoteMinor ?? request.estimateMinor) + (request.quoteMinor === null ? 0 : (request.plan?.premiumMinor ?? 0));
}

/**
 * The bill for a parcel weighed at the destination: the booked rate on the
 * weight the scale shows (or its box, by the route's volumetric rule), the
 * extras ticked, cover unless it was paid upfront, and whatever the team adds
 * by hand - duty at actuals, say.
 */
export function billFor(
  request: Pick<ServiceRequest, 'rate' | 'option' | 'answers' | 'fields' | 'addons' | 'plan' | 'coverDue' | 'coverPayment'>,
  weightKg: number,
  box: Dimensions | null,
  added: readonly { label: string; minor: number }[],
): Pick<RequestBill, 'chargeableKg' | 'by' | 'lines' | 'totalMinor'> {
  const rate = request.rate ?? { ratePerKgMinor: 0, minChargeKg: 0, volumetric: null };
  const items = answerFor<ItemRow[]>(request.fields, request.answers, 'items') ?? [];
  const priced = estimate({
    kind: 'forwarder', lane: rate, option: request.option, weightKg, box,
    pieces: items.reduce((sum, row) => sum + row.qty, 0), addons: request.addons ?? [],
  });
  const lines = [...priced.lines];
  const coverPaid = request.coverDue === 'upfront' && request.coverPayment;
  if (request.plan && !coverPaid) lines.push({ label: `Cover · ${request.plan.name}`, minor: request.plan.premiumMinor });
  for (const row of added) lines.push(row);
  return {
    chargeableKg: priced.chargeable?.kg ?? weightKg,
    by: priced.chargeable?.by ?? 'actual',
    lines,
    totalMinor: Math.max(0, lines.reduce((sum, row) => sum + row.minor, 0)),
  };
}

/** An address on one line, for a notification or a list. */
export function addressLine(a: AddressValue): string {
  return [a.name, a.phone, a.line, a.city, a.state, a.pincode].filter(Boolean).join(', ');
}

/** The delivery address on a request, when one has been given in full. */
export function deliveryOf(request: Pick<ServiceRequest, 'fields' | 'answers'>): AddressValue | null {
  const address = answerFor<AddressValue>(request.fields, request.answers, 'delivery');
  return addressComplete(address) ? address : null;
}

/**
 * Whether paying needs a delivery address first: a forwarder's parcel billed
 * on arrival goes out for delivery once paid, so it must know where to.
 */
export function needsDelivery(request: Pick<ServiceRequest, 'kind' | 'billing' | 'fields' | 'answers'>): boolean {
  return request.kind === 'forwarder' && request.billing === 'arrival' && !deliveryOf(request);
}

/**
 * The request with this delivery address on it. A request booked on the
 * store's own form has no delivery field yet, so it gains one.
 */
export function withDelivery<T extends Pick<ServiceRequest, 'kind' | 'fields' | 'answers'>>(request: T, raw: unknown): { ok: true; fields: ServiceFormField[]; answers: Answers } | { ok: false } {
  const base = defaultForm(request.kind).find((row) => row.key === 'delivery');
  const existing = request.fields.find((row) => row.key === 'delivery');
  const fieldDef = existing ?? base;
  if (!fieldDef) return { ok: false };
  const { answers } = checkAnswers([fieldDef], { [fieldDef.id]: raw });
  if (!addressComplete(answers[fieldDef.id] as AddressValue | null)) return { ok: false };
  return {
    ok: true,
    fields: existing ? request.fields : [...request.fields, fieldDef],
    answers: { ...request.answers, [fieldDef.id]: answers[fieldDef.id] ?? null },
  };
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

/* ── Custom quotes ───────────────────────────────────────────────────── */

/** The longest a custom quote may stand. After it, the quote is deleted. */
export const QUOTE_MAX_DAYS = 90;

/**
 * A customer asking a forwarder for their own price - a route the store does
 * not list, a regular volume, odd goods - and the forwarder's answer.
 *
 * Once quoted it is a price block the customer can ship on, a parcel at a
 * time, until it expires. Every block expires: the forwarder sets the date, no
 * more than `QUOTE_MAX_DAYS` out, and an expired block is deleted. Parcels
 * already booked on it keep the rate they were booked at.
 */
export interface CustomQuote {
  id: string;
  type: 'quote';
  storeId: string;
  kind: StoreKind;
  ownerId: string;
  storeName: string;
  storeSlug: string;
  number: string;
  customerId: string;
  customerName: string;
  customerHandle: string | null;
  route: { laneId: string | null; originCountry: string; destinationCountry: string; mode: FreightLane['mode'] };
  ask: { what: string; weightKg: number | null; battery: BatteryContent; notes: string };
  status: 'asked' | 'quoted' | 'declined';
  offer: QuoteOffer | null;
  /** Unanswered asks expire too, `QUOTE_MAX_DAYS` after they were sent. */
  expiresAt: string;
  /** Parcels booked on it. */
  used: number;
  history: RequestEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface QuoteOffer {
  ratePerKgMinor: number;
  minChargeKg: number;
  transitDaysMin: number;
  transitDaysMax: number;
  batteries: BatteryRule;
  note: string;
  /** Where to send parcels on it. Empty means the route's, or the store's main warehouse. */
  warehouses: StoreWarehouse[];
  sentAt: string;
  sentByName: string;
}

export function quoteIsExpired(quote: Pick<CustomQuote, 'expiresAt'>, now = Date.now()): boolean {
  return Date.parse(quote.expiresAt) <= now;
}

/** Whether a customer can book a parcel on it now. */
export function quoteIsUsable(quote: Pick<CustomQuote, 'status' | 'expiresAt' | 'offer'>, now = Date.now()): boolean {
  return quote.status === 'quoted' && Boolean(quote.offer) && !quoteIsExpired(quote, now);
}

/** The latest expiry a forwarder may set, from now. */
export function latestExpiry(now = Date.now()): string {
  return new Date(now + QUOTE_MAX_DAYS * 86_400_000).toISOString();
}

export function quoteNumber(): string {
  return requestNumber('forwarder').replace(/^FR-/, 'QT-');
}

export type ServiceWorkDoc = ServiceRequest | ChannelMessage | StoreFollow | CustomQuote;

export const CHANNEL_MAX_CHARS = 1000;
export const followId = (userId: string) => `follow:${userId}`;
