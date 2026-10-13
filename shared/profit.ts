/**
 * The profit calculator (Pro): what an imported item really costs by the time
 * it is in a buyer's hands, and what is left of the selling price after that.
 *
 * A template is a shop's own cost sheet for one way of bringing stock in -
 * "Japan by air", "China by sea". Every charge an import can pick up is
 * already on it as a line, switched on or off, so the seller decides what
 * counts rather than hunting for a field that is not there. Lines can be
 * renamed, reordered, re-priced, removed, and added to.
 *
 * Everything is worked out per item, in rupees, in the order the lines are
 * listed - a percentage line can only lean on what came before it, which is
 * also the order the money is actually spent in.
 *
 * Some sellers are quoted in one currency and pay in another: a yuan price,
 * settled with the supplier in dollars at the supplier's own rate, then the
 * dollars bought with rupees. A template can say so (`payCurrency`), and the
 * item price then goes yuan → dollars → rupees, each at its own rate.
 */

export const COST_STAGES = ['buying', 'origin', 'international', 'customs', 'domestic', 'selling'] as const;
export type CostStage = (typeof COST_STAGES)[number];

export const STAGE_LABELS: Record<CostStage, string> = {
  buying: 'Buying',
  origin: 'To the warehouse',
  international: 'International shipping',
  customs: 'Customs',
  domestic: 'In India',
  selling: 'Selling',
};

/** How a line is priced. */
export type CostKind = 'per_item' | 'per_shipment' | 'per_kg' | 'percent';

export const KIND_LABELS: Record<CostKind, string> = {
  per_item: 'Fixed, per item',
  per_shipment: 'Fixed, per shipment (split across the items)',
  per_kg: 'Per kg',
  percent: 'Percent',
};

/** What a percentage is taken of. */
export type CostBasis = 'item' | 'cif' | 'cif_duty' | 'so_far' | 'selling' | 'selling_inclusive' | 'line';

export const BASIS_LABELS: Record<CostBasis, string> = {
  item: 'of the item price',
  cif: 'of item + shipping to India (CIF)',
  cif_duty: 'of CIF + customs so far',
  so_far: 'of everything so far',
  selling: 'of the selling price',
  selling_inclusive: 'already inside the selling price (GST-style)',
  line: 'of another cost line',
};

export type LineCurrency = 'foreign' | 'pay' | 'INR';

export interface CostLine {
  id: string;
  label: string;
  stage: CostStage;
  kind: CostKind;
  /** Money for fixed and per-kg lines, a percentage for percent lines. */
  amount: number;
  /**
   * Which currency a money amount is in. Ignored by percent lines. `foreign`
   * is the currency items are priced in; `pay` the one the supplier is paid
   * in, when the template has one (otherwise the same as `foreign`).
   */
  currency: LineCurrency;
  basis?: CostBasis;
  /** The line a `line` basis is taken of. Must come earlier in the list. */
  basisLineId?: string | null;
  /** Per-kg lines: the least weight a shipment is charged for. */
  minKg?: number;
  /** Per-kg lines: weight is rounded up to this step (0.5 kg for most couriers). */
  stepKg?: number;
  /** Per-kg lines: charge the larger of actual and volumetric weight. */
  volumetric?: boolean;
  enabled: boolean;
}

export interface ProfitTemplate {
  id: string;
  name: string;
  /** The currency items are priced in - USD, JPY, CNY... */
  currency: string;
  /**
   * The currency the supplier is actually paid in, when it is not `currency`
   * - a yuan price paid in dollars. Null or absent: paid in `currency`.
   */
  payCurrency?: string | null;
  /** Units of `currency` for one unit of `payCurrency` - 6.7 yuan to the dollar. */
  payRate?: number;
  /**
   * Rupees for one unit of the currency the supplier is paid in (`payCurrency`
   * when set, else `currency`), at whatever rate this seller actually gets.
   */
  rate: number;
  /** Divisor for volumetric weight: L × W × H (cm) ÷ this. 5000 for most air couriers. */
  volumetricDivisor: number;
  /** The margin the "suggested price" aims for, as a percentage of the selling price. */
  targetMarginPercent: number;
  isDefault: boolean;
  lines: CostLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ProfitInput {
  /** Price of one item, in the template's currency. */
  itemPrice: number;
  quantity: number;
  /** Weight of one item, packed, in kg. */
  weightKg: number;
  /** One item's packed size in cm, for volumetric weight. Optional. */
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  /** Selling price of one item, in rupees. */
  sellingPrice: number;
}

export interface ProfitLineResult {
  id: string;
  label: string;
  stage: CostStage;
  enabled: boolean;
  /** Rupees per item. Zero for a line that is switched off. */
  perItem: number;
}

export interface ProfitResult {
  itemCost: number;
  lines: ProfitLineResult[];
  stages: Record<CostStage, number>;
  landed: number;
  profit: number;
  totalProfit: number;
  totalCost: number;
  totalRevenue: number;
  /** Profit as a share of the selling price. Null with no selling price. */
  marginPercent: number | null;
  /** Profit as a share of the landed cost. Null with no cost. */
  markupPercent: number | null;
  /** The selling price at which profit is zero. Null when no price can reach it. */
  breakEven: number | null;
  /** The selling price that makes the template's target margin. */
  suggested: number | null;
  actualKg: number;
  volumetricKg: number;
  /**
   * Everything in the buying stage - the item and what the supplier adds to
   * it - in the currency the supplier is paid in. What is sent to them per item.
   */
  supplierPay: number;
  /** The currency `supplierPay` is in. */
  supplierCurrency: string;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Whether the supplier is paid in a currency other than the price's. */
export const paysVia = (template: Pick<ProfitTemplate, 'currency' | 'payCurrency' | 'payRate'>): boolean =>
  Boolean(template.payCurrency) && template.payCurrency !== template.currency && num(template.payRate) > 0;

/** The currency the supplier is paid in. */
export const payCurrencyOf = (template: Pick<ProfitTemplate, 'currency' | 'payCurrency' | 'payRate'>): string =>
  (paysVia(template) ? template.payCurrency! : template.currency);

/** Rupees for one unit of the price currency, through the pay currency when there is one. */
export function inrPerUnit(template: Pick<ProfitTemplate, 'currency' | 'payCurrency' | 'payRate' | 'rate'>): number {
  const rate = Math.max(0, num(template.rate));
  return paysVia(template) ? rate / num(template.payRate) : rate;
}

const CIF_STAGES: readonly CostStage[] = ['origin', 'international'];

/** Costs for one selling price. */
function costsAt(template: ProfitTemplate, input: ProfitInput, selling: number) {
  const rate = inrPerUnit(template);
  const inrPerPay = Math.max(0, num(template.rate));
  const quantity = Math.max(1, Math.floor(num(input.quantity)) || 1);
  const itemCost = Math.max(0, num(input.itemPrice)) * rate;
  const actualKg = Math.max(0, num(input.weightKg)) * quantity;
  const divisor = num(template.volumetricDivisor) > 0 ? template.volumetricDivisor : 5000;
  const volumetricKg =
    (Math.max(0, num(input.lengthCm)) * Math.max(0, num(input.widthCm)) * Math.max(0, num(input.heightCm)) / divisor)
    * quantity;

  const values = new Map<string, number>();
  const lines: ProfitLineResult[] = [];
  let soFar = 0;
  let cif = 0;
  let customs = 0;

  for (const line of template.lines) {
    let perItem = 0;
    if (line.enabled) {
      const money = num(line.amount) * (line.currency === 'foreign' ? rate : line.currency === 'pay' ? inrPerPay : 1);
      switch (line.kind) {
        case 'per_item':
          perItem = money;
          break;
        case 'per_shipment':
          perItem = money / quantity;
          break;
        case 'per_kg': {
          let kg = line.volumetric ? Math.max(actualKg, volumetricKg) : actualKg;
          const step = num(line.stepKg);
          if (step > 0 && kg > 0) kg = Math.ceil(kg / step - 1e-9) * step;
          kg = Math.max(kg, num(line.minKg));
          perItem = (money * kg) / quantity;
          break;
        }
        case 'percent': {
          const rateOf = num(line.amount) / 100;
          const basis = line.basis ?? 'item';
          if (basis === 'selling_inclusive') {
            perItem = rateOf > -1 ? (selling * rateOf) / (1 + rateOf) : 0;
          } else {
            const base =
              basis === 'item' ? itemCost
              : basis === 'cif' ? itemCost + cif
              : basis === 'cif_duty' ? itemCost + cif + customs
              : basis === 'so_far' ? itemCost + soFar
              : basis === 'selling' ? selling
              : values.get(line.basisLineId ?? '') ?? 0;
            perItem = base * rateOf;
          }
          break;
        }
      }
    }
    values.set(line.id, perItem);
    lines.push({ id: line.id, label: line.label, stage: line.stage, enabled: line.enabled, perItem });
    soFar += perItem;
    if (CIF_STAGES.includes(line.stage)) cif += perItem;
    if (line.stage === 'customs') customs += perItem;
  }

  return { itemCost, lines, landed: itemCost + soFar, quantity, actualKg, volumetricKg };
}


/**
 * The whole sum for one set of inputs.
 *
 * Every line is linear in the selling price (a fee on it, GST inside it, a
 * buffer on everything so far), so profit is a straight line in it too. Two
 * evaluations give that line, and break-even and the target price fall out of
 * it exactly rather than by searching.
 */
export function calculateProfit(template: ProfitTemplate, input: ProfitInput): ProfitResult {
  const selling = Math.max(0, num(input.sellingPrice));
  const at = costsAt(template, input, selling);

  const stages = Object.fromEntries(COST_STAGES.map((stage) => [stage, 0])) as Record<CostStage, number>;
  stages.buying += at.itemCost;
  for (const line of at.lines) stages[line.stage] += line.perItem;

  const profit = selling - at.landed;
  const probe = 10_000;
  const zero = -costsAt(template, input, 0).landed;
  const slope = (probe - costsAt(template, input, probe).landed - zero) / probe;
  const breakEven = slope > 0 ? Math.max(0, -zero / slope) : null;
  const target = num(template.targetMarginPercent) / 100;
  const suggested = slope > target ? Math.max(0, -zero / (slope - target)) : null;

  return {
    itemCost: at.itemCost,
    lines: at.lines,
    stages,
    landed: at.landed,
    profit,
    totalProfit: profit * at.quantity,
    totalCost: at.landed * at.quantity,
    totalRevenue: selling * at.quantity,
    marginPercent: selling > 0 ? (profit / selling) * 100 : null,
    markupPercent: at.landed > 0 ? (profit / at.landed) * 100 : null,
    breakEven,
    suggested,
    actualKg: at.actualKg,
    volumetricKg: at.volumetricKg,
    supplierPay: num(template.rate) > 0 ? stages.buying / num(template.rate) : 0,
    supplierCurrency: payCurrencyOf(template),
  };
}

type Seed = Omit<CostLine, 'id' | 'enabled' | 'amount' | 'currency'> & {
  key: string; on?: boolean; amount?: number; currency?: LineCurrency;
};

/**
 * Every charge an import can pick up, in the order it is paid. The common ones
 * start switched on at zero, so a new sheet is a form to fill in rather than
 * a list to build; the rest wait, off, for the seller who needs them.
 */
const PROVISIONS: Seed[] = [
  { key: 'origin_ship', label: "Seller's shipping to the warehouse", stage: 'buying', kind: 'per_shipment', currency: 'foreign', on: true },
  { key: 'agent', label: 'Agent / proxy buying fee', stage: 'buying', kind: 'percent', basis: 'item' },
  { key: 'card', label: 'Card / PayPal fee', stage: 'buying', kind: 'percent', basis: 'item' },
  { key: 'forex', label: 'Bank forex charges', stage: 'buying', kind: 'percent', basis: 'item' },
  { key: 'foreign_tax', label: 'Sales tax abroad', stage: 'buying', kind: 'percent', basis: 'item' },
  { key: 'warehouse', label: 'Shipping to the forwarder warehouse', stage: 'origin', kind: 'per_kg', currency: 'foreign' },
  { key: 'wh_handling', label: 'Warehouse handling / storage', stage: 'origin', kind: 'per_item', currency: 'foreign' },
  { key: 'consolidate', label: 'Consolidation / repacking', stage: 'origin', kind: 'per_shipment', currency: 'foreign' },
  { key: 'freight', label: 'International shipping', stage: 'international', kind: 'per_kg', currency: 'foreign', on: true, minKg: 0, stepKg: 0.5, volumetric: true },
  { key: 'fuel', label: 'Fuel surcharge', stage: 'international', kind: 'percent', basis: 'line', basisLineId: 'freight' },
  { key: 'insurance', label: 'Shipping insurance', stage: 'international', kind: 'percent', basis: 'item' },
  { key: 'duty', label: 'Basic customs duty', stage: 'customs', kind: 'percent', basis: 'cif', on: true },
  { key: 'sws', label: 'Social welfare surcharge', stage: 'customs', kind: 'percent', basis: 'line', basisLineId: 'duty', amount: 10 },
  { key: 'igst', label: 'IGST on import', stage: 'customs', kind: 'percent', basis: 'cif_duty', on: true },
  { key: 'clearance', label: 'Customs clearance / broker', stage: 'customs', kind: 'per_shipment', currency: 'INR' },
  { key: 'courier_duty', label: 'Courier duty-handling fee', stage: 'customs', kind: 'per_shipment', currency: 'INR' },
  { key: 'domestic', label: 'Domestic transport to you', stage: 'domestic', kind: 'per_kg', currency: 'INR', on: true },
  { key: 'delivery', label: 'Delivery to the buyer', stage: 'domestic', kind: 'per_item', currency: 'INR' },
  { key: 'packing', label: 'Packing', stage: 'domestic', kind: 'per_item', currency: 'INR', on: true },
  { key: 'handling', label: 'Handling', stage: 'domestic', kind: 'per_item', currency: 'INR', on: true },
  { key: 'platform', label: 'Marketplace / platform fee', stage: 'selling', kind: 'percent', basis: 'selling' },
  { key: 'gateway', label: 'Payment gateway fee', stage: 'selling', kind: 'percent', basis: 'selling' },
  { key: 'gst', label: 'GST on the sale (inside the price)', stage: 'selling', kind: 'percent', basis: 'selling_inclusive' },
  { key: 'buffer', label: 'Damage / returns buffer', stage: 'selling', kind: 'percent', basis: 'so_far' },
  { key: 'other', label: 'Anything else', stage: 'selling', kind: 'per_item', currency: 'INR' },
];

/** A fresh cost sheet with every provision on it. */
export function starterLines(): CostLine[] {
  return PROVISIONS.map(({ key, on, amount, currency, ...rest }) => ({
    ...rest,
    id: key,
    amount: amount ?? 0,
    currency: currency ?? 'INR',
    enabled: Boolean(on),
  }));
}

export const COMMON_CURRENCIES = ['USD', 'JPY', 'CNY', 'EUR', 'GBP', 'HKD', 'KRW', 'SGD', 'AED', 'THB'] as const;

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', JPY: '¥', CNY: '¥', EUR: '€', GBP: '£', HKD: 'HK$', KRW: '₩', SGD: 'S$', AED: 'AED ', THB: '฿', INR: '₹',
};

/** "¥" for CNY, "$" for USD; the code itself, with a space, for anything else. */
export const symbolOf = (code: string) => CURRENCY_SYMBOLS[code] ?? `${code} `;

/* ── Scenarios ─────────────────────────────────────────────────────────── */

/** The parts of a template a scenario fills in. */
export type ScenarioSheet = Pick<ProfitTemplate,
  'name' | 'currency' | 'payCurrency' | 'payRate' | 'rate' | 'volumetricDivisor' | 'targetMarginPercent' | 'lines'>;

export interface Scenario {
  id: string;
  icon: string;
  name: string;
  /** One line: how the money moves. */
  blurb: string;
  sheet: () => ScenarioSheet;
}

/** The starter sheet with some lines switched on, priced, or renamed. */
function linesWith(changes: Record<string, Partial<CostLine>>, onlyThese = false): CostLine[] {
  return starterLines().map((line) => {
    const change = changes[line.id];
    if (change) return { ...line, enabled: true, ...change };
    return onlyThese ? { ...line, enabled: false } : line;
  });
}

/** The agent's markup moved to the top, ahead of what the supplier charges to ship. */
const markupFirst = (lines: CostLine[]) => [...lines.filter((line) => line.id === 'agent'), ...lines.filter((line) => line.id !== 'agent')];

/**
 * Ways stock comes in, as a starting sheet each. The rates are a starting
 * point, not a quote: every one is the seller's to change, and the sheet
 * keeps whatever they set.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'cny_usd',
    icon: '🇨🇳',
    name: 'China, paid in USD',
    blurb: 'Yuan price → dollars at the supplier\'s rate, + markup, + shipping per item → rupees',
    sheet: () => ({
      name: 'China, paid in USD',
      currency: 'CNY',
      payCurrency: 'USD',
      payRate: 6.7,
      rate: 88,
      volumetricDivisor: 5000,
      targetMarginPercent: 25,
      // The markup is on the converted price, then the shipping is added:
      // (yuan ÷ 6.7) × 1.1 + 2, in that order.
      lines: markupFirst(linesWith({
        agent: { label: 'Supplier markup', amount: 10 },
        origin_ship: { label: 'Supplier shipping, per item', kind: 'per_item', currency: 'pay', amount: 2 },
      }, true)),
    }),
  },
  {
    id: 'cny',
    icon: '🏮',
    name: 'China, paid in yuan',
    blurb: 'Yuan straight to rupees, an agent fee, freight by the kg, duty and IGST',
    sheet: () => ({
      name: 'China, paid in yuan',
      currency: 'CNY',
      payCurrency: null,
      rate: 12.3,
      volumetricDivisor: 6000,
      targetMarginPercent: 25,
      lines: linesWith({
        agent: { label: 'Agent fee', amount: 5 },
        freight: { amount: 45 },
      }),
    }),
  },
  {
    id: 'jpy_air',
    icon: '🇯🇵',
    name: 'Japan by air',
    blurb: 'Yen to rupees, a proxy fee, air freight on volumetric weight, duty and IGST',
    sheet: () => ({
      name: 'Japan by air',
      currency: 'JPY',
      payCurrency: null,
      rate: 0.59,
      volumetricDivisor: 5000,
      targetMarginPercent: 30,
      lines: linesWith({
        agent: { label: 'Proxy fee', amount: 5 },
        freight: { amount: 1800 },
      }),
    }),
  },
  {
    id: 'usd_fwd',
    icon: '🇺🇸',
    name: 'USA via a forwarder',
    blurb: 'Dollars to rupees, sales tax, a forwarder by the kg, duty and IGST',
    sheet: () => ({
      name: 'USA via a forwarder',
      currency: 'USD',
      payCurrency: null,
      rate: 88,
      volumetricDivisor: 5000,
      targetMarginPercent: 25,
      lines: linesWith({
        foreign_tax: { amount: 8 },
        freight: { amount: 12 },
      }),
    }),
  },
];

/* ── An item's own costs ───────────────────────────────────────────────── */

/**
 * One step of what a single unit of an item cost to bring in, in paise.
 *
 * Fixed amounts rather than formulas: once the seller has saved an item's
 * costs, those are what that stock actually cost, and editing the template
 * later - a new forex rate, a new forwarder - must not rewrite what an item
 * already on the shelf was bought at.
 */
export interface CostStep {
  id: string;
  label: string;
  stage: CostStage;
  amountMinor: number;
  /** How the rupees came from a price abroad, when they did. */
  formula?: CostFormula | null;
}

/**
 * A cost as its calculator line works it out, kept with the cost: the
 * `amount` in the currency it is priced in - per unit, or a rate per kg
 * (`perKg`), or one charge for a shipment shared over `shared` units - then
 * `via` into the currency it is paid in when that is another, then `expr`
 * into rupees. A yuan item price paid in dollars: ¥120, via "x / 6.7", then
 * "x * 88". Freight: $10 a kg × 0.5 kg, then "x * 88".
 *
 * A percentage line is `percentOf` other costs on the same order (the item
 * price, a line, CIF, everything before it) or of the selling price, and
 * follows them when they change.
 *
 * A copy: editing it never touches the calculator it came from, and changing
 * the calculator never rewrites it.
 */
export interface CostFormula {
  /** The currency `amount` is in. */
  currency: string;
  /** Per unit, per kg with `perKg`, or for the whole shipment with `shared`. */
  amount: number;
  /** Weight: `amount` is a rate per kg, and this is the kg one unit is charged for. */
  perKg?: number | null;
  /** A charge for a whole shipment, shared over this many units. */
  shared?: number | null;
  /** When it is paid in another currency: that currency, and the sum into it. */
  via?: { currency: string; expr: string } | null;
  /** Rupees per unit from what is paid. Numbers, x, + - * / and brackets. */
  expr: string;
  /** A percentage cost: of these costs on the order (by step id), or of the selling price. */
  percentOf?: PercentOf | null;
}

export interface PercentOf {
  percent: number;
  /** The costs it is a percentage of, summed. */
  ids?: string[];
  /** Older formulas: one cost. */
  id?: string;
  /** Of the selling price - `inside` for a tax already inside it (GST). */
  selling?: 'on' | 'inside' | null;
}

/** A formula without its amount: what a cost with none starts from. */
export type FormulaSeed = Omit<CostFormula, 'amount'>;

/** The costs a percentage is of. */
export const percentIds = (of: PercentOf): string[] => of.ids ?? (of.id ? [of.id] : []);

type FormulaOp = '+' | '-' | '*' | '/';
type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'x' }
  | { kind: 'neg'; of: FormulaNode }
  | { kind: 'op'; op: FormulaOp; left: FormulaNode; right: FormulaNode };

/**
 * A formula read into its parts, or null when it is not a sum this reads -
 * numbers, x, + - * / (× ÷ too) and brackets, nothing else. Parsed by hand
 * rather than handed to eval, as it comes from whoever typed it.
 */
function parseFormula(expr: string): FormulaNode | null {
  const text = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '').toLowerCase();
  if (!text || text.length > 200) return null;
  let at = 0;
  const peek = () => text[at];
  function sum(): FormulaNode {
    let node = product();
    while (peek() === '+' || peek() === '-') node = { kind: 'op', op: text[at++] as FormulaOp, left: node, right: product() };
    return node;
  }
  function product(): FormulaNode {
    let node = unary();
    while (peek() === '*' || peek() === '/') node = { kind: 'op', op: text[at++] as FormulaOp, left: node, right: unary() };
    return node;
  }
  function unary(): FormulaNode {
    if (peek() === '-') { at += 1; return { kind: 'neg', of: unary() }; }
    if (peek() === '+') { at += 1; return unary(); }
    return atom();
  }
  function atom(): FormulaNode {
    if (peek() === '(') {
      at += 1;
      const node = sum();
      if (peek() !== ')') throw new Error('bracket');
      at += 1;
      return node;
    }
    if (peek() === 'x') { at += 1; return { kind: 'x' }; }
    const match = /^\d*\.?\d+(e[+-]?\d+)?/.exec(text.slice(at));
    if (!match) throw new Error('number');
    at += match[0].length;
    return { kind: 'num', value: Number(match[0]) };
  }
  try {
    const node = sum();
    return at === text.length ? node : null;
  } catch {
    return null;
  }
}

/** One step of working a formula out: 120 ÷ 6.7 = 17.91. */
export interface FormulaWorking { left: number; op: '+' | '−' | '×' | '÷'; right: number; value: number }

const OP_SIGNS: Record<FormulaOp, FormulaWorking['op']> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function evalNode(node: FormulaNode, x: number, steps?: FormulaWorking[]): number {
  switch (node.kind) {
    case 'num': return node.value;
    case 'x': return x;
    case 'neg': return -evalNode(node.of, x, steps);
    case 'op': {
      const left = evalNode(node.left, x, steps);
      const right = evalNode(node.right, x, steps);
      const value = node.op === '+' ? left + right : node.op === '-' ? left - right : node.op === '*' ? left * right : left / right;
      steps?.push({ left, op: OP_SIGNS[node.op], right, value });
      return value;
    }
  }
}

/** `expr` worked out for one `x`, or null when it is not a sum this reads. */
export function evalFormula(expr: string, x: number): number | null {
  const node = parseFormula(expr);
  if (!node) return null;
  const value = evalNode(node, x);
  return Number.isFinite(value) ? value : null;
}

/** How `expr` comes to its answer for one `x`, a step at a time, in the order it is worked. */
export function formulaWorking(expr: string, x: number): FormulaWorking[] | null {
  const node = parseFormula(expr);
  if (!node) return null;
  const steps: FormulaWorking[] = [];
  return Number.isFinite(evalNode(node, x, steps)) ? steps : null;
}

/**
 * The `x` that makes `expr` come to `rupees`, so typing rupees over a cost
 * that has a price abroad moves the price abroad with it. Only for sums that
 * are a straight line in x (all the usual ones); null for anything else.
 */
export function solveFormula(expr: string, rupees: number): number | null {
  const at0 = evalFormula(expr, 0);
  const at1 = evalFormula(expr, 1);
  const at2 = evalFormula(expr, 2);
  if (at0 === null || at1 === null || at2 === null) return null;
  const slope = at1 - at0;
  if (Math.abs(slope) < 1e-12 || Math.abs((at2 - at1) - slope) > 1e-9 * Math.max(1, Math.abs(slope))) return null;
  const x = (rupees - at0) / slope;
  return Number.isFinite(x) && x >= 0 ? x : null;
}

const CODE = /^[A-Z]{3}$/;
const ID = /^[\w-]{1,40}$/;
const cleanExpr = (raw: unknown) => (typeof raw === 'string' && evalFormula(raw.trim(), 1) !== null ? raw.trim().slice(0, 200) : null);
const round4 = (value: number) => Math.round(value * 1e4) / 1e4;
const positive = (raw: unknown, max: number) =>
  (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= max ? round4(raw) : null);

/** A formula as a client sent it, made safe to keep - or null. */
export function cleanFormula(raw: unknown): CostFormula | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Partial<CostFormula>;
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  const expr = cleanExpr(body.expr);
  const amount = typeof body.amount === 'number' && Number.isFinite(body.amount) ? body.amount : NaN;
  if (!CODE.test(currency) || !(amount >= 0) || amount > 1e9 || !expr) return null;
  const formula: CostFormula = { currency, amount: round4(amount), expr };
  const perKg = positive(body.perKg, 100_000);
  if (perKg) formula.perKg = perKg;
  const shared = positive(body.shared, 1_000_000);
  if (shared) formula.shared = shared;
  const via = body.via as Partial<NonNullable<CostFormula['via']>> | null | undefined;
  if (via && typeof via === 'object') {
    const viaCurrency = typeof via.currency === 'string' ? via.currency.trim().toUpperCase() : '';
    const viaExpr = cleanExpr(via.expr);
    if (CODE.test(viaCurrency) && viaExpr) formula.via = { currency: viaCurrency, expr: viaExpr };
  }
  const of = body.percentOf as Partial<PercentOf> | null | undefined;
  if (of && typeof of === 'object' && typeof of.percent === 'number' && Number.isFinite(of.percent) && of.percent >= 0 && of.percent <= 1000) {
    const ids = [...new Set([...(Array.isArray(of.ids) ? of.ids : []), ...(of.id ? [of.id] : [])])]
      .filter((id): id is string => typeof id === 'string' && ID.test(id)).slice(0, 40);
    const selling = of.selling === 'on' || of.selling === 'inside' ? of.selling : null;
    if (ids.length > 0 || selling) formula.percentOf = { percent: round4(of.percent), ...(selling ? { selling } : { ids }) };
  }
  return formulaRupees(formula) === null ? null : formula;
}

/** How many of `amount` one unit takes: its kg, or its share of a shipment. */
const factorOf = (formula: Pick<CostFormula, 'perKg' | 'shared'>) => (formula.perKg ?? 1) / (formula.shared ?? 1);

/** One unit's cost in the currency it is priced in: the amount, times its kg or its share of a shipment. */
export const formulaBase = (formula: Pick<CostFormula, 'amount' | 'perKg' | 'shared'>): number => formula.amount * factorOf(formula);

/** What is paid, per unit, in the currency it is paid in: through `via` when there is one. */
export const formulaPaid = (formula: Pick<CostFormula, 'amount' | 'perKg' | 'shared' | 'via'>): number | null =>
  (formula.via ? evalFormula(formula.via.expr, formulaBase(formula)) : formulaBase(formula));

/** The currency a cost is paid in. */
export const paidCurrency = (formula: Pick<CostFormula, 'currency' | 'via'>): string => formula.via?.currency ?? formula.currency;

/** Rupees per unit from a formula, or null when its sums do not work out. */
export function formulaRupees(formula: Pick<CostFormula, 'amount' | 'perKg' | 'shared' | 'via' | 'expr'>): number | null {
  const paid = formulaPaid(formula);
  return paid === null ? null : evalFormula(formula.expr, paid);
}

/** Rupees in paise from a formula; what a step with one is always worth. */
export const formulaMinor = (formula: Pick<CostFormula, 'amount' | 'perKg' | 'shared' | 'via' | 'expr'>): number =>
  Math.min(1e11, Math.max(0, Math.round((formulaRupees(formula) ?? 0) * 100)));

/** The `amount` that is paid as `paid`, per unit - run back through `via`, and its kg or share. */
export function amountForPaid(formula: Pick<CostFormula, 'via' | 'perKg' | 'shared'>, paid: number): number | null {
  const base = formula.via ? solveFormula(formula.via.expr, paid) : paid;
  return base === null ? null : base / factorOf(formula);
}

/** The `amount` that comes to `rupees`, run back through every sum. */
export function amountForRupees(formula: Pick<CostFormula, 'via' | 'perKg' | 'shared' | 'expr'>, rupees: number): number | null {
  const paid = solveFormula(formula.expr, rupees);
  return paid === null ? null : amountForPaid(formula, paid);
}

/**
 * Every percentage cost worked out again from what it is a percentage of, so
 * the agent's 10% follows the item price and duty follows CIF - in rupees,
 * as the calculator works them. Of the selling price only when `sellingRupees` is
 * known; left as it is when not. One whose costs are all gone keeps the
 * rupees it last came to, without a formula.
 */
export function settleSteps(steps: CostStep[], sellingRupees?: number): CostStep[] {
  let out = steps;
  // A percentage of a percentage settles in as many passes as it is deep.
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    out = out.map((step) => {
      const of = step.formula?.percentOf;
      if (!of) return step;
      let formula: CostFormula;
      if (of.selling) {
        if (sellingRupees === undefined) return step;
        const rate = of.percent / 100;
        const base = of.selling === 'inside' ? (rate > -1 ? sellingRupees / (1 + rate) : 0) : sellingRupees;
        formula = { currency: 'INR', amount: round4((base * of.percent) / 100), expr: 'x', percentOf: of };
      } else {
        const sources = percentIds(of).map((id) => out.find((entry) => entry.id === id && entry !== step))
          .filter((entry): entry is CostStep => Boolean(entry));
        if (sources.length === 0) {
          const { formula: _gone, ...rest } = step;
          moved = true;
          return rest;
        }
        // In rupees, as the calculator takes a percentage: of what the costs come to here.
        const base = sources.reduce((sum, entry) => sum + entry.amountMinor / 100, 0);
        formula = { currency: 'INR', amount: round4((base * of.percent) / 100), expr: 'x', percentOf: of };
      }
      const amountMinor = formulaMinor(formula);
      if (amountMinor === step.amountMinor && JSON.stringify(formula) === JSON.stringify(step.formula)) return step;
      moved = true;
      return { ...step, amountMinor, formula };
    });
    if (!moved) break;
  }
  return out;
}

/** Plain numbers in a sum: 6.7, 88, 0.59 - never 6.700000001. */
const term = (value: number) => String(Math.round(value * 1e6) / 1e6);

/** The parts of a calculator a formula is read from. */
export type FormulaSource = Pick<ProfitTemplate, 'currency' | 'payCurrency' | 'payRate' | 'rate' | 'lines'>;

/** What a template has of an item, when the formula is made with the calculation itself. */
export interface LineContext {
  /** Units in the shipment - what a per-shipment charge is shared over. */
  quantity: number;
}

const CIF_FROM: readonly CostStage[] = ['origin', 'international'];

/**
 * The costs a calculator percentage is of, as the step ids they become:
 * the item price, and the lines before it its basis takes in.
 */
function percentFor(template: FormulaSource, line: CostLine): PercentOf | null {
  const percent = num(line.amount);
  // Lines switched off have no cost on the order, and are passed over there.
  const before = template.lines.slice(0, template.lines.indexOf(line));
  switch (line.basis ?? 'item') {
    case 'item': return { percent, ids: ['item'] };
    case 'line': return line.basisLineId ? { percent, ids: [line.basisLineId] } : null;
    case 'cif': return { percent, ids: ['item', ...before.filter((entry) => CIF_FROM.includes(entry.stage)).map((entry) => entry.id)] };
    case 'cif_duty':
      return { percent, ids: ['item', ...before.filter((entry) => CIF_FROM.includes(entry.stage) || entry.stage === 'customs').map((entry) => entry.id)] };
    case 'so_far': return { percent, ids: ['item', ...before.map((entry) => entry.id)] };
    case 'selling': return { percent, selling: 'on' };
    case 'selling_inclusive': return { percent, selling: 'inside' };
  }
}

/**
 * How a calculator takes the item price (`lineId` null) or one of its lines
 * to rupees, as a formula without its amount: priced abroad through the paid
 * currency when there is one, priced in the paid currency straight from it,
 * by weight as a rate per kg, a shipment charge shared, a percentage of what
 * its basis takes in. Null for a fixed rupee amount, or a line not there.
 */
export function seedFromTemplate(template: FormulaSource, lineId: string | null, context?: LineContext): FormulaSeed | null {
  const rate = Math.max(0, num(template.rate));
  if (rate <= 0) return null;
  const toInr = `x * ${term(rate)}`;
  const via = paysVia(template) ? { currency: template.payCurrency!, expr: `x / ${term(num(template.payRate))}` } : null;
  const priced = (inr: LineCurrency): FormulaSeed | null =>
    inr === 'INR' ? { currency: 'INR', expr: 'x' }
    : inr === 'pay' ? { currency: payCurrencyOf(template), expr: toInr }
    : { currency: template.currency, ...(via ? { via } : {}), expr: toInr };
  if (lineId === null) return priced('foreign');
  const line = template.lines.find((entry) => entry.id === lineId);
  if (!line) return null;
  switch (line.kind) {
    case 'percent': {
      const of = percentFor(template, line);
      return of ? { currency: 'INR', expr: 'x', percentOf: of } : null;
    }
    case 'per_kg': return { ...priced(line.currency)!, perKg: 1 };
    case 'per_shipment':
      return context && context.quantity > 1 ? { ...priced(line.currency)!, shared: context.quantity }
        : line.currency === 'INR' ? null : priced(line.currency);
    case 'per_item': return line.currency === 'INR' ? null : priced(line.currency);
  }
}

/**
 * A seed given its numbers, from the rupees it comes to: the amount run back
 * through its sums - or, by weight, the rate kept as the calculator has it
 * and the kg worked out.
 */
export function seedAt(seed: FormulaSeed, rupees: number, rate?: number): CostFormula | null {
  if (seed.percentOf) return { ...seed, amount: 0 };
  if (seed.perKg && rate && rate > 0) {
    const perUnit = amountForRupees({ ...seed, perKg: 1 }, rupees);
    return perUnit === null ? null : { ...seed, amount: round4(rate), perKg: round4(perUnit / rate) };
  }
  if (seed.shared && rate && rate > 0) return { ...seed, amount: round4(rate) };
  const amount = amountForRupees(seed, rupees);
  return amount === null ? null : { ...seed, ...(seed.perKg ? { perKg: 1 } : {}), amount: round4(amount) };
}

/** A calculator line's own number - its rate per kg, its shipment charge - for `seedAt`. */
export const lineRate = (template: FormulaSource, lineId: string | null): number | undefined =>
  (lineId === null ? undefined : num(template.lines.find((entry) => entry.id === lineId)?.amount) || undefined);

/** A calculator's line as a book cost: its formula, from the rupees it came to. */
export function formulaForLine(template: FormulaSource, lineId: string | null, rupees: number, context?: LineContext): CostFormula | null {
  const seed = seedFromTemplate(template, lineId, context);
  return seed ? seedAt(seed, rupees, lineRate(template, lineId)) : null;
}

/** The costs saved against a listing. Only the steps the seller kept. */
export interface ItemCostSheet {
  /** The calculator it came from, if any, as it was named then. */
  templateId: string | null;
  templateName: string | null;
  steps: CostStep[];
  savedAt: string;
}

/** Everything one unit cost, in paise. */
export const sheetTotal = (sheet: ItemCostSheet | null | undefined): number =>
  (sheet?.steps ?? []).reduce((sum, step) => sum + step.amountMinor, 0);

/**
 * A calculator result as the steps to save against an item: the item price
 * first, then each line that is switched on and came to something. Given the
 * template and the item's price abroad, the item price - and every fixed
 * per-item line priced abroad - keeps its foreign amount and the sum that
 * made it rupees, as a copy.
 */
export function stepsFromResult(result: ProfitResult, template?: ProfitTemplate, itemPrice?: number, input?: Pick<ProfitInput, 'quantity' | 'sellingPrice'>): CostStep[] {
  const context = { quantity: Math.max(1, Math.floor(num(input?.quantity)) || 1) };
  const formulaFor = (lineId: string | null, rupees: number): CostFormula | null => {
    if (!template) return null;
    if (lineId === null && num(itemPrice) > 0) {
      const seed = seedFromTemplate(template, null);
      return seed ? { ...seed, amount: num(itemPrice) } : null;
    }
    return formulaForLine(template, lineId, rupees, context);
  };
  const steps: CostStep[] = [];
  if (result.itemCost > 0) {
    const formula = formulaFor(null, result.itemCost);
    steps.push({ id: 'item', label: 'Item price', stage: 'buying', amountMinor: Math.round(result.itemCost * 100), ...(formula ? { formula } : {}) });
  }
  for (const line of result.lines) {
    if (line.enabled && line.perItem > 0) {
      const formula = formulaFor(line.id, line.perItem);
      steps.push({ id: line.id, label: line.label, stage: line.stage, amountMinor: Math.round(line.perItem * 100), ...(formula ? { formula } : {}) });
    }
  }
  // Rupees as the formulas say, and percentages from what they are of.
  return settleSteps(
    steps.map((step) => (step.formula && !step.formula.percentOf ? { ...step, amountMinor: formulaMinor(step.formula) } : step)),
    input ? num(input.sellingPrice) : undefined,
  );
}

const MAX_SHEET_STEPS = 40;

/** A step with its formula, if it has a good one - and then the rupees are what the formula says. */
function withFormula(step: CostStep, raw: unknown): CostStep {
  const formula = cleanFormula(raw);
  return formula ? { ...step, amountMinor: formulaMinor(formula), formula } : step;
}

/**
 * Whatever a client sent as an item's costs, made safe to keep - or null when
 * there is nothing worth keeping. The one reader every place that takes costs
 * uses: the item cost editor, listing an item, a power sale item, a private
 * deal. Throws a message a person can read when the sheet is malformed.
 */
export function cleanCostSheet(raw: unknown, now: string, sellingRupees?: number): ItemCostSheet | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Partial<ItemCostSheet>;
  const rows = Array.isArray(body.steps) ? body.steps : [];
  if (rows.length === 0) return null;
  if (rows.length > MAX_SHEET_STEPS) throw new Error(`An item holds up to ${MAX_SHEET_STEPS} cost steps.`);
  const steps: CostStep[] = rows.map((step: Partial<CostStep>, at) => withFormula({
    id: typeof step.id === 'string' && /^[\w-]{1,40}$/.test(step.id) ? step.id : `step_${at}`,
    label: (typeof step.label === 'string' ? step.label.trim() : '').slice(0, 80) || 'Cost',
    stage: COST_STAGES.includes(step.stage as CostStage) ? (step.stage as CostStage) : 'selling',
    amountMinor: typeof step.amountMinor === 'number' && Number.isFinite(step.amountMinor)
      ? Math.min(1e11, Math.max(0, Math.round(step.amountMinor)))
      : 0,
  }, step.formula));
  return {
    templateId: typeof body.templateId === 'string' ? body.templateId.slice(0, 40) : null,
    templateName: typeof body.templateName === 'string' ? body.templateName.slice(0, 60) : null,
    steps: settleSteps(steps, sellingRupees),
    savedAt: now,
  };
}

/**
 * A calculation kept for later (Pro): an item worked out in the calculator
 * but not listed yet. Listed from here, sent to a channel or the feed, or
 * added to a power sale - each through the usual listing route - and marked
 * with the item it became once it has one.
 */
export interface SavedCalc {
  id: string;
  title: string;
  templateId: string | null;
  templateName: string | null;
  input: ProfitInput;
  /** The costs as they came out, fixed then - what the item is saved with. */
  steps: CostStep[];
  sellingPriceMinor: number;
  listingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const MAX_SAVED_CALCS = 60;

const calcNumber = (value: unknown, max: number) =>
  (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0);

/** A saved calculation as a client sent it, made safe to keep. Throws a readable message. */
export function cleanSavedCalc(raw: unknown, id: string, now: string, existing?: SavedCalc): SavedCalc {
  if (!raw || typeof raw !== 'object') throw new Error('Send the calculation to save.');
  const body = raw as Partial<SavedCalc>;
  const title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, 120);
  if (!title) throw new Error('Say what the item is.');
  const sheet = cleanCostSheet({ ...body, steps: body.steps ?? [] }, now);
  const input = (body.input ?? {}) as Partial<ProfitInput>;
  return {
    id,
    title,
    templateId: sheet?.templateId ?? (typeof body.templateId === 'string' ? body.templateId.slice(0, 40) : null),
    templateName: sheet?.templateName ?? (typeof body.templateName === 'string' ? body.templateName.slice(0, 60) : null),
    input: {
      itemPrice: calcNumber(input.itemPrice, 1e9),
      quantity: Math.max(1, Math.round(calcNumber(input.quantity, 100_000))),
      weightKg: calcNumber(input.weightKg, 10_000),
      lengthCm: calcNumber(input.lengthCm, 10_000),
      widthCm: calcNumber(input.widthCm, 10_000),
      heightCm: calcNumber(input.heightCm, 10_000),
      sellingPrice: calcNumber(input.sellingPrice, 1e9),
    },
    steps: sheet?.steps ?? [],
    sellingPriceMinor: Math.round(calcNumber(body.sellingPriceMinor, 1e11)),
    listingId: typeof body.listingId === 'string' ? body.listingId.slice(0, 80) : existing?.listingId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
