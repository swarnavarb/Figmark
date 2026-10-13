import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  COMMON_CURRENCIES, SCENARIOS, amountForPaid, amountForRupees, formulaBase, formulaForLine, formulaMinor, formulaPaid,
  formulaWorking, paidCurrency, percentIds, seedAt, settleSteps, symbolOf,
  type CostFormula, type CostStage, type CostStep, type FormulaSource, type PercentOf,
} from '@shared/profit';
import { ApiRequestError, api, type BookLot, type BookRow, type CostsResponse } from '../api';
import { formatMoney } from '../format';
import { ErrorNotice, Modal, PersonLink, Tile } from '../components/ui';

/**
 * Real profit as a book: lots, and what was sold from hand. A lot opens to
 * its orders, one sheet per customer, a row per order and columns per cost -
 * each cost as its calculator line works it out (priced in yuan, paid in
 * dollars, into rupees; weight × rate; a percentage of what it is of), every
 * cell typed straight into, per unit, for that one order. Selling price less
 * cost price is the profit.
 *
 * Each change is saved as it is made (a cell when you leave it) as that
 * order's own costs, never the calculator's, and can be undone one step at a
 * time - a column added or deleted, a payment split, a reset.
 */

const money = (minor: number) => formatMoney(minor, 'INR');
/** A sheet cell: rupees without the sign, the header already says ₹. */
const cell = (minor: number) => (minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const short = (value: number, places = 2) => value.toLocaleString('en-IN', { maximumFractionDigits: places });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

type Tab = 'lots' | 'hand';

export interface BookTotals {
  salesMinor: number;
  costMinor: number;
  profitMinor: number;
  pendingMinor: number;
  /** Orders with no cost steps at all, so no profit is counted on them. */
  uncosted: number;
}

const unitCost = (row: Pick<BookRow, 'steps'>) => row.steps.reduce((sum, step) => sum + step.amountMinor, 0);
const salesOf = (row: BookRow) => row.quantity * row.unitPriceMinor;
const costOf = (row: BookRow) => unitCost(row) * row.quantity;
const costed = (row: BookRow) => row.steps.length > 0;
const sellingOf = (row: BookRow) => row.unitPriceMinor / 100;

/** Sales, costs, profit (on costed orders only) and what is still owed, across some orders. */
export function bookTotals(rows: BookRow[]): BookTotals {
  const totals: BookTotals = { salesMinor: 0, costMinor: 0, profitMinor: 0, pendingMinor: 0, uncosted: 0 };
  for (const row of rows) {
    totals.salesMinor += salesOf(row);
    totals.pendingMinor += row.pendingMinor;
    if (!costed(row)) {
      totals.uncosted += 1;
      continue;
    }
    totals.costMinor += costOf(row);
    totals.profitMinor += salesOf(row) - costOf(row);
  }
  return totals;
}

/** Profit as a share of what the costed orders sold for. */
function marginOf(rows: BookRow[], totals: BookTotals): number | null {
  const sold = rows.reduce((sum, row) => sum + (costed(row) ? salesOf(row) : 0), 0);
  return sold > 0 ? Math.round((totals.profitMinor / sold) * 100) : null;
}

export function ProfitBook({ shop, data, reload }: { shop?: string; data: CostsResponse | null; reload: () => void }) {
  const [tab, setTab] = useState<Tab>('lots');
  const [lotId, setLotId] = useState<string | null>(null);
  // Edits land here first, so a typed cell changes the sums at once.
  const [rows, setRows] = useState<BookRow[]>(data?.rows ?? []);
  useEffect(() => setRows(data?.rows ?? []), [data]);
  useEffect(() => window.scrollTo(0, 0), [lotId]);

  const { inHand, inLots } = useMemo(() => ({
    inHand: rows.filter((row) => !row.lotId),
    inLots: rows.filter((row) => row.lotId),
  }), [rows]);

  if (!data) return <p className="muted">Loading…</p>;

  const lot = lotId ? data.lots.find((entry) => entry.id === lotId) ?? null : null;
  const scope = lot ? inLots.filter((row) => row.lotId === lot.id) : tab === 'lots' ? inLots : inHand;
  const change = (next: BookRow) => setRows((now) => now.map((row) => (row.orderId === next.orderId ? next : row)));

  return (
    <div className="stack">
      {lot ? (
        <div className="pbook__lothead">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLotId(null)}>‹ All lots</button>
          <div>
            <Link to={`/lot/${lot.id}`} className="inscard__title">{lot.name}</Link>
            <small>{[lot.number, statusName(lot.status)].filter(Boolean).join(' · ')}</small>
          </div>
        </div>
      ) : (
        <div className="inssegs" role="tablist" aria-label="Lots or in hand">
          {([['lots', 'Lots', data.lots.length], ['hand', 'In hand', inHand.length]] as const).map(([id, label, count]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={`inscat${tab === id ? ' is-on' : ''}`} onClick={() => setTab(id)}>
              {label}<span className="inscat__n">{count}</span>
            </button>
          ))}
        </div>
      )}

      <Totals rows={scope} />

      {lot || tab === 'hand' ? (
        <CustomerSheets key={lot?.id ?? 'hand'} title={lot?.name ?? 'In hand'} rows={scope} customers={data.customers} shop={shop}
          onChange={change} onFailed={reload} empty={lot ? 'No orders in this lot yet.' : 'Nothing sold from hand yet.'} />
      ) : (
        <LotList lots={data.lots} rows={inLots} onOpen={setLotId} />
      )}
    </div>
  );
}

function statusName(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function Totals({ rows }: { rows: BookRow[] }) {
  const totals = useMemo(() => bookTotals(rows), [rows]);
  const margin = marginOf(rows, totals);
  return (
    <>
      <div className="tiles tiles--four">
        <Tile value={money(totals.costMinor)} label="Cost price" tone="blue" />
        <Tile value={money(totals.profitMinor)} label={margin !== null ? `Profit · ${margin}%` : 'Profit'} tone="green" />
        <Tile value={money(totals.salesMinor)} label="Selling price" />
        <Tile value={money(totals.pendingMinor)} label="Pending" />
      </div>
      {totals.uncosted > 0 && (
        <p className="faint">
          {plural(totals.uncosted, 'order')} {totals.uncosted === 1 ? 'has' : 'have'} no costs yet, so no profit is counted on
          {totals.uncosted === 1 ? ' it' : ' them'}. Type the cost price into the sheet.
        </p>
      )}
    </>
  );
}

function LotList({ lots, rows, onOpen }: { lots: BookLot[]; rows: BookRow[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  // Every lot's sums in one pass over the orders.
  const byLot = useMemo(() => {
    const mine = new Map<string, BookRow[]>();
    for (const row of rows) if (row.lotId) mine.set(row.lotId, [...(mine.get(row.lotId) ?? []), row]);
    return new Map([...mine].map(([id, list]) => {
      const totals = bookTotals(list);
      return [id, { list, totals, margin: marginOf(list, totals), customers: new Set(list.map((row) => row.buyerId)).size }];
    }));
  }, [rows]);

  if (lots.length === 0) return <p className="muted">No lots yet.</p>;
  const needle = query.trim().toLowerCase();
  const shown = needle ? lots.filter((lot) => `${lot.name} ${lot.number ?? ''}`.toLowerCase().includes(needle)) : lots;

  return (
    <div className="stack">
      {lots.length > 5 && (
        <input className="pbook__find" type="search" value={query} placeholder="Find a lot" aria-label="Find a lot"
          onChange={(event) => setQuery(event.target.value)} />
      )}
      {shown.length === 0 && <p className="muted">No lot called that.</p>}
      {shown.map((lot) => {
        const entry = byLot.get(lot.id);
        const totals = entry?.totals ?? bookTotals([]);
        const count = entry?.list.length ?? 0;
        const costedShare = count > 0 ? (count - totals.uncosted) / count : 0;
        return (
          <button key={lot.id} type="button" className={`inscard pbook__lot${totals.profitMinor < 0 ? ' inscard--loss' : ''}`}
            onClick={() => onOpen(lot.id)}>
            <span className="inscard__head inscard__head--plain pbook__lotrow">
              <span>
                <span className="inscard__title">{lot.name}</span>
                <small>
                  {[lot.number, statusName(lot.status), plural(count, 'order'), plural(entry?.customers ?? 0, 'customer')]
                    .filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className={`inscard__big${totals.profitMinor < 0 ? ' is-loss' : ''}`}>
                {money(totals.profitMinor)}<small>{entry && entry.margin !== null ? `profit · ${entry.margin}%` : 'profit'}</small>
              </span>
            </span>
            <span className="inscard__facts">
              <span>Cost price {money(totals.costMinor)}</span>
              <span>Selling price {money(totals.salesMinor)}</span>
              {totals.pendingMinor > 0 && <span className="badge badge--warn">{money(totals.pendingMinor)} pending</span>}
              {totals.uncosted > 0 && <span className="badge">{totals.uncosted} not costed</span>}
            </span>
            {count > 0 && (
              <span className="pbook__meter" title={`${Math.round(costedShare * 100)}% of orders costed`}>
                <span style={{ width: `${costedShare * 100}%` }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A cost column: one label, the same across every order in view. */
interface Column { key: string; label: string; stage: CostStage; id: string }

const keyOf = (label: string) => label.trim().toLowerCase();
const slug = (label: string) => keyOf(label).replace(/[^\w-]+/g, '_').slice(0, 40) || 'cost';
const stepIn = (row: BookRow, column: Column) => row.steps.find((step) => keyOf(step.label) === column.key);
const round4 = (value: number) => Math.round(value * 1e4) / 1e4;
const sym = (currency: string) => symbolOf(currency).trim();

/** Always there, so a sheet with no costs yet still has a cell to type the first into. */
const ITEM_PRICE: Column = { key: 'item price', label: 'Item price', stage: 'buying', id: 'item' };

function columnsFor(rows: BookRow[], extra: Column[]): Column[] {
  const found = new Map<string, Column>([[ITEM_PRICE.key, ITEM_PRICE]]);
  for (const row of rows) {
    for (const step of row.steps) {
      const key = keyOf(step.label);
      if (!found.has(key)) found.set(key, { key, label: step.label, stage: step.stage, id: step.id });
    }
  }
  for (const column of extra) if (!found.has(column.key)) found.set(column.key, column);
  return [...found.values()];
}

/**
 * What the sheet shows of a cost, as its calculator line has it: the kg (or
 * units a shipment is shared over), the price in the currency it is priced
 * in, what is paid in the currency it is paid in, and the rupees. All in the
 * cost's own colour.
 */
type PartKind = 'count' | 'amount' | 'paid' | 'inr';
interface Part {
  column: Column;
  kind: PartKind;
  /** What hiding it remembers. */
  key: string;
  currency: string;
  tone: number;
  /** The unit its number is in, for the header: "kg", "$/kg", "¥". */
  unit: string;
  /** A percentage cost: how much, on the first of its parts. */
  percent: number | null;
  /** A count part: what it counts. */
  counts?: 'kg' | 'shared';
}

const TONES = 6;

function partsFor(columns: Column[], rows: BookRow[]): Part[] {
  const parts: Part[] = [];
  columns.forEach((column, at) => {
    const tone = at % TONES;
    const formulas = rows.map((row) => stepIn(row, column)?.formula).filter((entry): entry is CostFormula => Boolean(entry));
    const first = formulas.find((entry) => !entry.percentOf) ?? formulas[0];
    let percent = formulas.find((entry) => entry.percentOf)?.percentOf?.percent ?? null;
    const take = () => {
      const value = percent;
      percent = null;
      return value;
    };
    const kg = formulas.some((entry) => entry.perKg);
    const shared = !kg && formulas.some((entry) => entry.shared);
    if (kg || shared) {
      parts.push({ column, kind: 'count', key: `${column.key}·count`, currency: '', tone, unit: kg ? 'kg' : 'units', percent: take(), counts: kg ? 'kg' : 'shared' });
    }
    if (first && (first.currency !== 'INR' || first.via || kg || shared)) {
      const per = kg ? '/kg' : shared ? '/shipment' : '';
      parts.push({ column, kind: 'amount', key: `${column.key}·abroad`, currency: first.currency, tone, unit: `${sym(first.currency)}${per}`, percent: take() });
    }
    const paying = formulas.find((entry) => entry.via) ?? (kg || shared ? first : undefined);
    if (paying && (paying.via || ((kg || shared) && paidCurrency(paying) !== 'INR'))) {
      const currency = paidCurrency(paying);
      parts.push({ column, kind: 'paid', key: `${column.key}·paid`, currency, tone, unit: sym(currency), percent: null });
    }
    parts.push({ column, kind: 'inr', key: column.key, currency: 'INR', tone, unit: '₹', percent: take() });
  });
  return parts;
}

const partName = (part: Part) => `${part.column.label}${part.percent !== null ? ` ${short(part.percent)}%` : ''} ${part.unit}`;

/** A cost's value as one part shows it. */
function partValue(step: CostStep | undefined, kind: PartKind): number | null {
  if (!step) return null;
  if (kind === 'inr') return step.amountMinor / 100;
  const formula = step.formula;
  if (!formula) return null;
  if (kind === 'count') return formula.perKg ?? formula.shared ?? null;
  if (kind === 'amount') return formula.amount;
  return formulaPaid(formula);
}

/** The calculator a cost's sums come from: the shop's default, else the calculator's first way in. */
type Source = FormulaSource & { name: string };
const STARTER: Source = SCENARIOS[0]!.sheet();

/** The calculator line a column is, by its label or its id: null for the item price, undefined for none. */
function lineIdFor(column: Column | undefined, source: Source): string | null | undefined {
  if (!column) return undefined;
  if (column.key === ITEM_PRICE.key) return null;
  return source.lines.find((line) => keyOf(line.label) === column.key || line.id === column.id)?.id;
}

/**
 * A cost's formula, or the one it would have: its calculator line's, worked
 * back from the rupees it already is - else the same cost's on another order
 * here. A copy either way. Null for a cost the calculator keeps in rupees.
 */
function formulaOf(row: BookRow, column: Column, rows: BookRow[], source: Source): CostFormula | null {
  const step = stepIn(row, column);
  if (step?.formula) return step.formula;
  const rupees = (step?.amountMinor ?? 0) / 100;
  const lineId = lineIdFor(column, source);
  if (lineId !== undefined) {
    const formula = formulaForLine(source, lineId, rupees);
    return formula ? fitPercent(row, column, formula, rupees) : null;
  }
  for (const other of rows) {
    const formula = stepIn(other, column)?.formula;
    if (formula && !formula.percentOf) return seedAt(formula, rupees, formula.perKg || formula.shared ? formula.amount : undefined);
  }
  return null;
}

/**
 * A percentage cost given the share that makes it what it already costs, so
 * taking on the calculator's sums never moves the rupees. The calculator's
 * own share when there is nothing to keep, or nothing to take it of.
 */
function fitPercent(row: BookRow, column: Column, formula: CostFormula, rupees: number): CostFormula {
  const of = formula.percentOf;
  if (!of || rupees <= 0) return formula;
  const whole = { ...formula, percentOf: { ...of, percent: 100 } };
  const base = stepIn({ ...row, steps: withFormula(row, column, whole) }, column)?.amountMinor ?? 0;
  return base > 0 ? { ...formula, percentOf: { ...of, percent: round4((rupees * 100 * 100) / base) } } : formula;
}

const columnOf = (step: CostStep): Column => ({ key: keyOf(step.label), label: step.label, stage: step.stage, id: step.id });

/**
 * An order as the sheet shows it: a cost saved with only its rupees takes on
 * its calculator line's sums, worked back from those rupees - so the item
 * price shows in its own currency too. Nothing moves and nothing is saved
 * until a cell is typed into.
 */
function derive(row: BookRow, source: Source): BookRow {
  if (row.steps.every((step) => step.formula)) return row;
  let steps = row.steps;
  for (const step of row.steps) {
    if (step.formula) continue;
    const column = columnOf(step);
    const lineId = lineIdFor(column, source);
    const rupees = step.amountMinor / 100;
    const found = lineId === undefined ? null : formulaForLine(source, lineId, rupees);
    if (!found) continue;
    const formula = found.percentOf ? { ...fitPercent({ ...row, steps }, column, found, rupees), amount: rupees } : found;
    steps = steps.map((entry) => (entry === step ? { ...entry, formula } : entry));
  }
  return steps === row.steps ? row : { ...row, steps };
}

/** Which columns are folded away, kept in this browser only. */
const HIDDEN_KEY = 'figmark.pbook.hidden';
function readHidden(): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** One order's costs changing: as it was, as it shows until saved, and what to save. */
interface Change { before: BookRow; after: BookRow; steps: CostStep[] | null }

/** How to put a change back: the orders as they were, and the columns. */
interface Undo { label: string; rows: BookRow[]; extra: Column[]; hidden: string[] }

/** A row's steps with one cost set, and every percentage that leans on it worked out again. */
function withCost(row: BookRow, column: Column, amountMinor: number, formula: CostFormula | null): CostStep[] {
  const at = row.steps.findIndex((step) => keyOf(step.label) === column.key);
  const base = at >= 0 ? row.steps[at]! : { id: column.id, label: column.label, stage: column.stage, amountMinor: 0 };
  const { formula: _old, ...rest } = base;
  const next: CostStep = formula ? { ...rest, amountMinor, formula } : { ...rest, amountMinor };
  return settleSteps(at >= 0 ? row.steps.map((step, index) => (index === at ? next : step)) : [...row.steps, next], sellingOf(row));
}

const withFormula = (row: BookRow, column: Column, formula: CostFormula) => withCost(row, column, formulaMinor(formula), formula);

/** A formula without its percentage: typed over, a percentage cost becomes a fixed one. */
function fixed(formula: CostFormula): CostFormula {
  const { percentOf: _of, ...rest } = formula;
  return rest;
}

/**
 * One part of a cost typed in, or cleared: the other parts follow through its
 * sums, and so does every percentage of it. Null when nothing changes.
 */
function setPart(row: BookRow, part: Part, value: number | null, guess: CostFormula | null): CostStep[] | null {
  const { column, kind } = part;
  const step = stepIn(row, column);
  if (value === null) {
    if (!step || kind === 'count') return null;
    if (kind === 'inr') return settleSteps(row.steps.filter((entry) => entry !== step), sellingOf(row));
    // A price abroad cleared: the rupees stay, as a fixed amount.
    return step.formula ? withCost(row, column, step.amountMinor, null) : null;
  }
  const formula = step?.formula ? fixed(step.formula) : guess ? fixed(guess) : null;
  if (kind === 'inr') {
    const amount = formula ? amountForRupees(formula, value) : null;
    return formula && amount !== null
      ? withFormula(row, column, { ...formula, amount: round4(amount) })
      : withCost(row, column, Math.round(value * 100), null);
  }
  if (!formula) return null;
  if (kind === 'count') {
    if (!(value > 0)) return null;
    return withFormula(row, column, part.counts === 'kg' ? { ...formula, perKg: round4(value) } : { ...formula, shared: round4(value) });
  }
  const amount = kind === 'amount' ? value : amountForPaid(formula, value);
  return amount === null ? null : withFormula(row, column, { ...formula, amount: round4(amount) });
}

/** A supplier payment being shared out: over which orders, into what, how much. */
interface Split { partKey: string; amount: string; picked: string[]; base: BookRow[] }

function CustomerSheets({ title, rows: given, customers, shop, onChange, onFailed, empty }: {
  title: string;
  rows: BookRow[];
  customers: CostsResponse['customers'];
  shop?: string;
  onChange: (row: BookRow) => void;
  onFailed: () => void;
  empty: string;
}) {
  const [extra, setExtra] = useState<Column[]>([]);
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [history, setHistory] = useState<Undo[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  // Deleting a column with costs in it asks once, on the button itself.
  const [dropping, setDropping] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [editing, setEditing] = useState<{ orderId: string; column: Column } | null>(null);
  const [split, setSplit] = useState<Split | null>(null);
  const [templates, setTemplates] = useState<{ list: Source[]; main: Source }>({ list: [], main: STARTER });
  const [failed, setFailed] = useState<string | null>(null);
  // Each order's sums from the calculator its item was costed with; the shop's default for the rest.
  const sourceFor = (row: BookRow): Source => templates.list.find((entry) => 'id' in entry && entry.id === row.templateId) ?? templates.main;
  const rows = useMemo(() => given.map((row) => derive(row, sourceFor(row))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [given, templates]);
  const columns = useMemo(() => columnsFor(split?.base ?? rows, extra), [rows, split, extra]);
  const parts = useMemo(() => partsFor(columns, rows), [columns, rows]);
  const shown = parts.filter((part) => !hidden.includes(part.key));

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
    } catch {
      // Private window: the columns fold for this visit only.
    }
  }, [hidden]);

  // The calculator's own sums, for a cost that has none yet.
  useEffect(() => {
    void api.profitTemplates(shop)
      .then((result) => {
        const main = result.templates.find((entry) => entry.isDefault) ?? result.templates[0] ?? STARTER;
        setTemplates({ list: result.templates, main });
      })
      .catch(() => undefined);
  }, [shop]);

  const groups = useMemo(() => {
    const byBuyer = new Map<string, BookRow[]>();
    for (const row of rows) byBuyer.set(row.buyerId, [...(byBuyer.get(row.buyerId) ?? []), row]);
    return [...byBuyer].map(([buyerId, mine]) => ({ buyerId, rows: mine, totals: bookTotals(mine) }))
      .sort((a, b) => b.totals.pendingMinor - a.totals.pendingMinor
        || (customers[a.buyerId]?.name ?? '').localeCompare(customers[b.buyerId]?.name ?? ''));
  }, [rows, customers]);

  // Ctrl/⌘+Z outside a cell undoes the last change; inside one, the browser's own undo.
  const undoRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The fields a split can go into, from the orders as they were when it opened -
  // not as it is showing them, or every keystroke would feed on its own result.
  const splitBase = split?.base;
  const splitParts = useMemo(
    () => (splitBase ? partsFor(columnsFor(splitBase, extra), splitBase).filter((part) => part.kind !== 'count') : []),
    [splitBase, extra],
  );

  /** A split as it stands: what each ticked order's costs become. */
  const splitChanges = useMemo((): Change[] => {
    if (!split) return [];
    const part = splitParts.find((entry) => entry.key === split.partKey);
    const paid = Number(split.amount.replace(/[,\s]/g, ''));
    if (!part || !(paid > 0) || !Number.isFinite(paid)) return [];
    const chosen = split.base.filter((row) => split.picked.includes(row.orderId));
    // Shared by what each was worth in that field; equally per unit when none has a value yet.
    const worth = (row: BookRow) => (partValue(stepIn(row, part.column), part.kind) ?? 0) * row.quantity;
    const total = chosen.reduce((sum, row) => sum + worth(row), 0);
    const weight = total > 0 ? worth : (row: BookRow) => row.quantity;
    const sum = total > 0 ? total : chosen.reduce((all, row) => all + row.quantity, 0);
    const changes: Change[] = [];
    for (const row of chosen) {
      // Shared by value, an order with none in that field takes none of it.
      if (weight(row) === 0) continue;
      const steps = setPart(row, part, (paid * weight(row)) / sum / row.quantity, formulaOf(row, part.column, split.base, sourceFor(row)));
      if (steps) changes.push({ before: row, after: { ...row, steps, own: true }, steps });
    }
    return changes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split, splitParts, templates]);

  // As the amount is typed, the sheet and every sum on it follow - saved on Done.
  useEffect(() => {
    if (!split) return;
    const after = new Map(splitChanges.map((change) => [change.after.orderId, change.after]));
    for (const row of split.base) onChange(after.get(row.orderId) ?? row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitChanges]);

  if (rows.length === 0) return <p className="muted">{empty}</p>;

  /** Saves some orders' costs in one call. The sums move now; the answer replaces the guess. */
  async function push(changes: Change[]) {
    if (changes.length === 0) return;
    for (const change of changes) onChange(change.after);
    try {
      const saved = await api.saveOrderCostsBatch(changes.map((change) => ({ orderId: change.before.orderId, steps: change.steps })), shop);
      const byId = new Map(saved.rows.map((row) => [row.orderId, row]));
      for (const { after } of changes) {
        const answer = byId.get(after.orderId);
        if (answer) onChange({ ...after, steps: answer.steps, own: answer.own });
      }
    } catch (err) {
      for (const { before } of changes) onChange(before);
      setFailed(err instanceof ApiRequestError ? err.message : 'Could not save that change.');
      if (!(err instanceof ApiRequestError)) onFailed();
    }
  }

  /** A change worth undoing: remembered first, then made. */
  function commit(label: string, changes: Change[], view: { extra?: Column[]; hidden?: string[] } = {}) {
    setFailed(null);
    setHistory((now) => [...now.slice(-49), { label, rows: changes.map((change) => change.before), extra, hidden }]);
    if (view.extra) setExtra(view.extra);
    if (view.hidden) setHidden(view.hidden);
    return push(changes);
  }

  const withSteps = (row: BookRow, steps: CostStep[]): Change => ({ before: row, after: { ...row, steps, own: true }, steps });

  function undo() {
    const last = history[history.length - 1];
    if (!last || split) return;
    setFailed(null);
    setHistory((now) => now.slice(0, -1));
    setExtra(last.extra);
    setHidden(last.hidden);
    setDropping(null);
    void push(last.rows.map((was) => ({
      before: rows.find((row) => row.orderId === was.orderId) ?? was,
      after: was,
      // An order that had the item's costs goes back to them, not to a copy.
      steps: was.own ? was.steps : null,
    })));
  }
  undoRef.current = undo;

  function save(label: string, row: BookRow, steps: CostStep[] | null) {
    if (!steps || JSON.stringify(steps) === JSON.stringify(row.steps)) return;
    void commit(label, [withSteps(row, steps)]);
  }

  function typePart(row: BookRow, part: Part, value: number | null) {
    save(`${partName(part)} for ${row.itemName}`, row, setPart(row, part, value, formulaOf(row, part.column, rows, sourceFor(row))));
  }

  function addColumn() {
    const label = (adding ?? '').trim();
    setAdding(null);
    if (!label || columns.some((column) => column.key === keyOf(label))) return;
    void commit(`add ${label}`, [], { extra: [...extra, { key: keyOf(label), label, stage: 'selling', id: slug(label) }] });
  }

  function dropColumn(column: Column) {
    const holding = rows.filter((row) => stepIn(row, column));
    if (holding.length > 0 && dropping !== column.key) {
      setDropping(column.key);
      return;
    }
    setDropping(null);
    void commit(`delete ${column.label}`,
      holding.map((row) => withSteps(row, settleSteps(row.steps.filter((step) => keyOf(step.label) !== column.key), sellingOf(row)))),
      { extra: extra.filter((entry) => entry.key !== column.key) });
  }

  function toggleColumn(key: string) {
    const next = hidden.includes(key) ? hidden.filter((entry) => entry !== key) : [...hidden, key];
    void commit(hidden.includes(key) ? 'show a column' : 'hide a column', [], { hidden: next });
  }

  function openSplit() {
    setDropping(null);
    const first = parts.find((part) => part.kind === 'paid') ?? parts.find((part) => part.kind === 'amount')
      ?? parts.find((part) => part.column.key === ITEM_PRICE.key)!;
    setSplit({ partKey: first.key, amount: '', picked: rows.map((row) => row.orderId), base: rows });
  }

  function closeSplit(keep: boolean) {
    if (!split) return;
    const part = splitParts.find((entry) => entry.key === split.partKey);
    if (keep && splitChanges.length > 0 && part) {
      void commit(`split ${sym(part.currency)}${split.amount} into ${partName(part)}`, splitChanges);
    } else {
      for (const row of split.base) onChange(row);
    }
    setSplit(null);
  }

  /** The sheet as a spreadsheet file: every order, the columns in view. */
  function download() {
    const quote = (value: string | number) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
    const head = ['Customer', 'Item', 'Qty', 'Selling price ₹', ...shown.map(partName), 'Cost price ₹', 'Profit ₹', 'Paid ₹', 'Pending ₹'];
    const lines = groups.flatMap((group) => group.rows.map((row) => [
      customers[row.buyerId]?.name ?? 'Customer', row.itemName, row.quantity, row.unitPriceMinor / 100,
      ...shown.map((part) => {
        const value = partValue(stepIn(row, part.column), part.kind);
        return value === null ? '' : round4(value);
      }),
      costed(row) ? unitCost(row) / 100 : '', costed(row) ? (salesOf(row) - costOf(row)) / 100 : '', row.paidMinor / 100, row.pendingMinor / 100,
    ]));
    const csv = [head, ...lines].map((line) => line.map(quote).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.download = `${slug(title) || 'profit'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const owing = groups.filter((group) => group.totals.pendingMinor > 0);
  const last = history[history.length - 1];
  const splitPart = split ? splitParts.find((part) => part.key === split.partKey) : undefined;
  const editRow = editing ? rows.find((row) => row.orderId === editing.orderId) : undefined;
  // The rupees of costs shown abroad: what "only what is paid" folds away.
  const conversions = parts.filter((part) => part.kind === 'inr' && parts.some((other) => other.column === part.column && other.kind !== 'inr'));

  /** A column's total over some orders, when its numbers add up: rupees always, a currency when all are in it. */
  const columnTotal = (list: BookRow[], part: Part): string => {
    if (part.kind === 'count') return '';
    let sum = 0;
    for (const row of list) {
      const step = stepIn(row, part.column);
      const value = partValue(step, part.kind);
      if (value === null) continue;
      const own = part.kind === 'amount' ? step?.formula?.currency : part.kind === 'paid' && step?.formula ? paidCurrency(step.formula) : 'INR';
      if (own !== part.currency || (part.kind === 'amount' && (step?.formula?.perKg || step?.formula?.shared))) return '';
      sum += value * row.quantity;
    }
    return sum ? short(sum) : '';
  };

  return (
    <div className="stack">
      {failed && <ErrorNotice message={failed} />}

      {owing.length > 0 && (
        <section className="card card--pad stack pbook__owed">
          <b>Pending by customer</b>
          <ul>
            {owing.map((group) => (
              <li key={group.buyerId}>
                <a href={`#pbook-${group.buyerId}`}>{customers[group.buyerId]?.name ?? 'Customer'}</a>
                <span className="pbook__num">{money(group.totals.pendingMinor)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="pbook__tools">
        <button type="button" className="btn btn--ghost btn--sm" disabled={!last || Boolean(split)} onClick={undo}
          title={last ? `Undo: ${last.label}` : 'Nothing to undo'}>
          ↶ Undo{last ? <span className="pbook__undo">{last.label}</span> : null}
        </button>
        <button type="button" className={`btn btn--ghost btn--sm${showColumns ? ' is-on' : ''}`} onClick={() => setShowColumns((now) => !now)}>
          Columns{parts.some((part) => hidden.includes(part.key))
            ? ` · ${parts.filter((part) => hidden.includes(part.key)).length} hidden` : ''}
        </button>
        <button type="button" className={`btn btn--ghost btn--sm${split ? ' is-on' : ''}`}
          onClick={() => (split ? closeSplit(false) : openSplit())}>
          ⇄ Split a payment
        </button>
        {adding === null ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAdding('')}>＋ Cost column</button>
        ) : (
          <form className="pbook__addcol" onSubmit={(event) => { event.preventDefault(); addColumn(); }}>
            <input autoFocus value={adding} maxLength={80} placeholder="e.g. Packing" aria-label="New cost column"
              onChange={(event) => setAdding(event.target.value)} onBlur={addColumn} />
          </form>
        )}
        <button type="button" className="btn btn--quiet btn--sm" onClick={download}>⬇ CSV</button>
      </div>

      {showColumns && (
        <div className="card card--pad pbook__cols">
          <span className="faint">What makes up the cost price. A hidden column still counts in it.</span>
          <div className="chips">
            {parts.map((part) => (
              <button key={part.key} type="button"
                className={`chip pbook__chip pbook__tone--${part.tone}${hidden.includes(part.key) ? '' : ' is-on'}`}
                aria-pressed={!hidden.includes(part.key)} onClick={() => toggleColumn(part.key)}>
                {hidden.includes(part.key) ? '○' : '●'} {partName(part)}
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn btn--quiet btn--sm" disabled={shown.length === parts.length}
              onClick={() => void commit('show all columns', [], { hidden: [] })}>Show all</button>
            <button type="button" className="btn btn--quiet btn--sm" disabled={conversions.every((part) => hidden.includes(part.key))}
              onClick={() => void commit('only what is paid', [], { hidden: [...new Set([...hidden, ...conversions.map((part) => part.key)])] })}>
              Only what is paid
            </button>
            <button type="button" className="btn btn--quiet btn--sm" disabled={shown.length === 0}
              onClick={() => void commit('hide all columns', [], { hidden: [...new Set([...hidden, ...parts.map((part) => part.key)])] })}>
              Hide all
            </button>
          </div>
        </div>
      )}

      {split && splitPart && (
        <form className="card card--pad pbook__split" onSubmit={(event) => { event.preventDefault(); closeSplit(true); }}>
          <div className="pbook__splitrow">
            <label className="field">
              <span>Field</span>
              <select value={split.partKey} onChange={(event) => setSplit({ ...split, partKey: event.target.value })}>
                {splitParts.map((part) => <option key={part.key} value={part.key}>{partName(part)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Paid</span>
              <span className={`pbook__money pbook__tone--${splitPart.tone}`}>
                <b>{sym(splitPart.currency)}</b>
                <input inputMode="decimal" autoFocus value={split.amount} placeholder="0"
                  onChange={(event) => setSplit({ ...split, amount: event.target.value })} />
              </span>
            </label>
          </div>
          <div className="row">
            <button type="submit" className="btn btn--sm" disabled={splitChanges.length === 0}>Done</button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => closeSplit(false)}>Cancel</button>
            <span className="faint">
              Over the {plural(split.picked.length, 'ticked order')}, by their {partName(splitPart)}
            </span>
          </div>
        </form>
      )}

      <p className="faint pbook__hint">
        Per unit, for that order only - saved as you leave a cell, Enter moves down. Each cost as its calculator line works it
        out, in its own colour; ƒx shows the sums. The calculator itself never changes.
      </p>

      {groups.map((group) => {
        const who = customers[group.buyerId];
        return (
          <section key={group.buyerId} id={`pbook-${group.buyerId}`} className="card pbook__sheet">
            <header className="pbook__who">
              <span className="pbook__name">
                <PersonLink party={who ? { name: who.name, handle: who.handle } : { name: 'Customer', handle: null }}
                  className="inscard__title" bare />
              </span>
              <span className="pbook__whofacts">
                <span>Profit <b className={`pbook__num${group.totals.profitMinor < 0 ? ' is-loss' : ''}`}>{money(group.totals.profitMinor)}</b></span>
                <span className={group.totals.pendingMinor > 0 ? 'badge badge--warn' : 'badge badge--ok'}>
                  {group.totals.pendingMinor > 0 ? `${money(group.totals.pendingMinor)} pending` : 'Paid up'}
                </span>
              </span>
            </header>
            <div className="pbook__scroll">
              <table className="pbook__table">
                <thead>
                  <tr>
                    <th className="pbook__item">Item</th>
                    <th>Qty</th>
                    <th>Selling price</th>
                    {shown.map((part) => (
                      <th key={part.key} className={`pbook__costhead pbook__tone--${part.tone}`}>
                        <span>
                          {part.column.label}{part.percent !== null ? ` ${short(part.percent)}%` : ''}{' '}
                          <b className="pbook__cur">{part.unit}</b>
                        </span>
                        <span className="pbook__headtools">
                          <button type="button" className="pbook__drop" aria-label={`Hide ${partName(part)}`}
                            title="Hide" onClick={() => toggleColumn(part.key)}>–</button>
                          {part.kind === 'inr' && part.column.key !== ITEM_PRICE.key && (
                            <button type="button" className={`pbook__drop${dropping === part.column.key ? ' is-asking' : ''}`}
                              aria-label={`Delete the ${part.column.label} column`} title="Delete" onClick={() => dropColumn(part.column)}
                              onBlur={() => setDropping((now) => (now === part.column.key ? null : now))}>
                              {dropping === part.column.key ? 'Delete?' : '✕'}
                            </button>
                          )}
                        </span>
                      </th>
                    ))}
                    <th>Cost price</th>
                    <th>Profit</th>
                    <th>Paid</th>
                    <th>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const profit = salesOf(row) - costOf(row);
                    const picked = split?.picked.includes(row.orderId) ?? false;
                    return (
                      <tr key={row.orderId} className={picked ? 'is-picked' : undefined}>
                        <td className="pbook__item">
                          {split && (
                            <input type="checkbox" className="pbook__pick" checked={picked} aria-label={`Include ${row.itemName}`}
                              onChange={() => setSplit({
                                ...split,
                                picked: picked ? split.picked.filter((id) => id !== row.orderId) : [...split.picked, row.orderId],
                              })} />
                          )}
                          <Link to={`/listing/${row.listingId}`}>{row.itemName}</Link>
                          {row.own && !split && (
                            <button type="button" className="pbook__reset" title="Use the item’s costs again"
                              onClick={() => void commit(`reset ${row.itemName}`, [{ before: row, after: row, steps: null }])}>
                              ↺ item costs
                            </button>
                          )}
                        </td>
                        <td className="pbook__num">{row.quantity}</td>
                        <td className="pbook__num">{cell(row.unitPriceMinor)}</td>
                        {shown.map((part) => {
                          const step = stepIn(row, part.column);
                          const own = part.kind === 'amount' ? step?.formula?.currency
                            : part.kind === 'paid' && step?.formula ? paidCurrency(step.formula) : undefined;
                          return (
                            <td key={part.key} className={`pbook__cell pbook__tone--${part.tone}`}>
                              <NumberCell value={partValue(step, part.kind)} label={`${partName(part)} for ${row.itemName}`}
                                column={part.key} places={part.kind === 'count' ? 3 : 2}
                                prefix={own && own !== part.currency ? sym(own) : ''} disabled={Boolean(split)}
                                onCommit={(value) => typePart(row, part, value)} />
                              {part.kind === 'inr' && (
                                <button type="button" className={`pbook__fx${step?.formula ? ' has-formula' : ''}`}
                                  title="How this is worked out" disabled={Boolean(split)}
                                  onClick={() => setEditing({ orderId: row.orderId, column: part.column })}>ƒx</button>
                              )}
                            </td>
                          );
                        })}
                        <td className="pbook__num">{costed(row) ? cell(unitCost(row)) : '—'}</td>
                        <td className={`pbook__num${costed(row) && profit < 0 ? ' is-loss' : ''}`}>{costed(row) ? cell(profit) : '—'}</td>
                        <td className="pbook__num">{cell(row.paidMinor)}</td>
                        <td className={`pbook__num${row.pendingMinor > 0 ? ' is-owed' : ''}`}>{cell(row.pendingMinor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {group.rows.length > 1 && (
                  <tfoot>
                    <tr>
                      <td className="pbook__item">Total</td>
                      <td className="pbook__num">{group.rows.reduce((sum, row) => sum + row.quantity, 0)}</td>
                      <td className="pbook__num">{cell(group.totals.salesMinor)}</td>
                      {shown.map((part) => <td key={part.key} className="pbook__num">{columnTotal(group.rows, part)}</td>)}
                      <td className="pbook__num">{cell(group.totals.costMinor)}</td>
                      <td className="pbook__num">{cell(group.totals.profitMinor)}</td>
                      <td className="pbook__num">{cell(group.rows.reduce((sum, row) => sum + row.paidMinor, 0))}</td>
                      <td className="pbook__num">{cell(group.totals.pendingMinor)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        );
      })}

      {editing && editRow && (
        <FormulaEditor row={editRow} column={editing.column} start={formulaOf(editRow, editing.column, rows, sourceFor(editRow))}
          onClose={() => setEditing(null)}
          onSave={(steps, label) => {
            save(`${editing.column.label} ${label} for ${editRow.itemName}`, editRow, steps);
            setEditing(null);
          }} />
      )}
    </div>
  );
}

/** One number cell, saved when you leave it; empty clears it. Enter goes to the same cell a row down. */
function NumberCell({ value, label, column, places = 2, prefix, disabled, onCommit }: {
  value: number | null;
  label: string;
  /** Cells of one column share it, for Enter to find the next. */
  column?: string;
  places?: number;
  prefix?: string;
  disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  // Rounded to read; what is kept underneath stays exact unless the cell is typed over.
  const shown = value === null ? '' : String(Math.round(value * 10 ** places) / 10 ** places);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  function commit() {
    const clean = text.replace(/[₹¥$€£,\s]/g, '');
    if (clean === shown) return;
    if (clean === '') return onCommit(null);
    const number = Number(clean);
    if (!Number.isFinite(number) || number < 0) return setText(shown);
    onCommit(number);
  }
  function next(input: HTMLInputElement) {
    input.blur();
    if (!column) return;
    const all = [...document.querySelectorAll<HTMLInputElement>(`input[data-col="${CSS.escape(column)}"]`)];
    all[all.indexOf(input) + 1]?.focus();
  }
  return (
    <span className="pbook__numcell">
      {prefix ? <span className="pbook__cur">{prefix}</span> : null}
      <input className="pbook__input" inputMode="decimal" value={text} aria-label={label} placeholder="—" disabled={disabled}
        data-col={column} onChange={(event) => setText(event.target.value)} onBlur={commit}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') next(event.target as HTMLInputElement);
          if (event.key === 'Escape') { setText(shown); (event.target as HTMLInputElement).blur(); }
        }} />
    </span>
  );
}

/** A formula in pieces: numbers to type over, x, and the signs between. */
interface Token { text: string; kind: 'num' | 'x' | 'sign' }

function tokenize(expr: string): Token[] {
  return (expr.match(/\d*\.?\d+(?:e[+-]?\d+)?|x|X|\s+|./g) ?? []).map((text) => ({
    text,
    kind: /^\d*\.?\d+/.test(text) ? 'num' : /^x$/i.test(text) ? 'x' : 'sign',
  }));
}

const joined = (tokens: Token[]) => tokens.map((token) => token.text).join('').trim();
const SIGNS: Record<string, string> = { '*': '×', '/': '÷', '-': '−' };

/** A number typed inline in a sum, as wide as it is. */
function Term({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  return (
    <input className="pbook__term" inputMode="decimal" value={value} size={Math.max(2, value.length)} aria-label={label}
      onChange={(event) => onChange(event.target.value)} />
  );
}

/** One sum, laid out with its numbers to type over, x in its place, and what it comes to - then each step. */
function Sum({ tokens, onTokens, x, value, answer }: {
  tokens: Token[];
  onTokens: (tokens: Token[]) => void;
  /** What stands for x: the price as a box, or what came before. */
  x: ReactNode;
  /** x's value, for the working. */
  value: number | null;
  answer: ReactNode;
}) {
  const working = value === null ? [] : formulaWorking(joined(tokens), value) ?? [];
  return (
    <>
      <div className="pbook__sum">
        {tokens.map((token, at) => {
          if (token.kind === 'x') return <span key={at} className="pbook__x">{x}</span>;
          if (token.kind === 'num') {
            return (
              <Term key={at} value={token.text} label="A number in the formula"
                onChange={(text) => onTokens(tokens.map((entry, index) => (index === at ? { ...entry, text } : entry)))} />
            );
          }
          return token.text.trim() ? <span key={at} className="pbook__sign">{SIGNS[token.text] ?? token.text}</span> : null;
        })}
        <span className="pbook__sign">=</span>
        <b className="pbook__answer">{answer}</b>
      </div>
      {working.length > 1 && (
        <ol className="pbook__working">
          {working.map((line, at) => <li key={at}>{short(line.left)} {line.op} {short(line.right)} = <b>{short(line.value)}</b></li>)}
        </ol>
      )}
    </>
  );
}

const CURRENCIES = (current: string) => [...new Set([current, 'INR', ...COMMON_CURRENCIES])];
type Per = 'unit' | 'kg' | 'shipment';
const parse = (text: string) => {
  const value = Number(text.replace(/[,\s]/g, ''));
  return text.trim() !== '' && Number.isFinite(value) ? value : null;
};

/**
 * How a cost comes to its rupees, as its calculator line does it: the price
 * in the currency it is priced in - per unit, a rate × weight, or a shipment
 * charge shared - into the currency it is paid in, into rupees; or a
 * percentage of other costs or of the selling price. Every number there to
 * type over, each step worked out. Or a plain rupee amount instead. Only this
 * order changes - not the calculator.
 */
function FormulaEditor({ row, column, start, onClose, onSave }: {
  row: BookRow;
  column: Column;
  start: CostFormula | null;
  onClose: () => void;
  onSave: (steps: CostStep[], label: string) => void;
}) {
  const step = stepIn(row, column);
  const others = row.steps.filter((entry) => entry !== step);
  const [currency, setCurrency] = useState(start?.currency ?? 'INR');
  const [amount, setAmount] = useState(start ? String(round4(start.amount)) : step ? String(step.amountMinor / 100) : '');
  const [per, setPer] = useState<Per>(start?.perKg ? 'kg' : start?.shared ? 'shipment' : 'unit');
  const [count, setCount] = useState(String(start?.perKg ?? start?.shared ?? 1));
  const [via, setVia] = useState<{ currency: string; tokens: Token[] } | null>(
    start?.via ? { currency: start.via.currency, tokens: tokenize(start.via.expr) } : null);
  const [tokens, setTokens] = useState<Token[]>(() => tokenize(start?.expr ?? 'x'));
  const [percent, setPercent] = useState<{ text: string; ids: string[]; selling: PercentOf['selling'] } | null>(
    start?.percentOf ? { text: String(start.percentOf.percent), ids: percentIds(start.percentOf), selling: start.percentOf.selling ?? null } : null);
  const [writing, setWriting] = useState(false);
  const [fixedText, setFixedText] = useState(step ? String(step.amountMinor / 100) : '');

  const x = parse(amount);
  const howMany = parse(count);
  const share = parse(percent?.text ?? '');

  // The formula as it stands, put through the order's other costs so a percentage comes out.
  let draft: CostFormula | null = null;
  if (percent) {
    if (share !== null && share >= 0 && (percent.selling || percent.ids.length > 0)) {
      draft = { currency: 'INR', amount: 0, expr: 'x', percentOf: { percent: share, ...(percent.selling ? { selling: percent.selling } : { ids: percent.ids }) } };
    }
  } else if (x !== null && x >= 0 && (per === 'unit' || (howMany !== null && howMany > 0))) {
    draft = {
      currency, amount: round4(x),
      ...(per === 'kg' ? { perKg: howMany! } : per === 'shipment' ? { shared: howMany! } : {}),
      ...(via ? { via: { currency: via.currency, expr: joined(via.tokens) } } : {}),
      expr: joined(tokens),
    };
  }
  const settled = draft ? stepIn({ ...row, steps: withFormula(row, column, draft) }, column) : undefined;
  const result = settled?.formula ?? null;
  const base = result ? formulaBase(result) : null;
  const paid = result ? formulaPaid(result) : null;
  const works = Boolean(settled && result && paid !== null);
  const paidIn = result ? paidCurrency(result) : via?.currency ?? currency;
  const fixedRupees = parse(fixedText);
  const percentBase = percent && !percent.selling
    ? others.filter((entry) => percent.ids.includes(entry.id)).reduce((sum, entry) => sum + entry.amountMinor, 0) : 0;

  const priceBox = (
    <>
      {sym(currency)}
      <Term value={amount} label="Price" onChange={setAmount} />
    </>
  );

  return (
    <Modal title={`${column.label} · ${row.itemName}`} onClose={onClose}>
      <div className="stack pbook__formula">
        <div className="inssegs" role="tablist" aria-label="How this cost is worked out">
          <button type="button" role="tab" aria-selected={!percent} className={`inscat${!percent ? ' is-on' : ''}`}
            onClick={() => {
              if (!percent) return;
              setPercent(null);
              if (result) { setAmount(String(round4(result.amount))); setCurrency(result.currency); setTokens(tokenize(result.expr)); }
            }}>
            A price
          </button>
          <button type="button" role="tab" aria-selected={Boolean(percent)} className={`inscat${percent ? ' is-on' : ''}`}
            onClick={() => !percent && setPercent({ text: '10', ids: others.some((entry) => entry.id === 'item') ? ['item'] : [], selling: null })}>
            A percentage
          </button>
        </div>

        {percent ? (
          <div className="field">
            <span>Of</span>
            <div className="chips">
              {others.map((entry) => (
                <button key={entry.id} type="button" className={`chip${!percent.selling && percent.ids.includes(entry.id) ? ' is-on' : ''}`}
                  onClick={() => setPercent({
                    ...percent, selling: null,
                    ids: percent.ids.includes(entry.id) ? percent.ids.filter((id) => id !== entry.id) : [...percent.ids, entry.id],
                  })}>
                  {entry.label}
                </button>
              ))}
              <button type="button" className={`chip${percent.selling === 'on' ? ' is-on' : ''}`}
                onClick={() => setPercent({ ...percent, selling: percent.selling === 'on' ? null : 'on' })}>Selling price</button>
              <button type="button" className={`chip${percent.selling === 'inside' ? ' is-on' : ''}`}
                onClick={() => setPercent({ ...percent, selling: percent.selling === 'inside' ? null : 'inside' })}>
                Inside the selling price (GST)
              </button>
            </div>
            <div className="pbook__sum">
              <Term value={percent.text} label="Percent" onChange={(text) => setPercent({ ...percent, text })} />
              <span className="pbook__sign">% of</span>
              <span className="pbook__x">
                {percent.selling
                  ? `${money(row.unitPriceMinor)}${percent.selling === 'inside' ? ', tax inside' : ''}`
                  : result && result.currency !== 'INR' && share
                    ? `${sym(result.currency)}${short((result.amount * 100) / share)}`
                    : money(percentBase)}
              </span>
              <span className="pbook__sign">=</span>
              <b className="pbook__answer">{result ? `${sym(result.currency)}${short(result.amount)}` : '?'}</b>
            </div>
            {result && result.currency !== 'INR' && (
              <div className="pbook__sum">
                <span className="pbook__x">{sym(result.currency)}{short(result.amount)}</span>
                {tokenize(result.expr).filter((token) => token.kind !== 'x' && token.text.trim()).map((token, at) => (
                  <span key={at} className="pbook__sign">{SIGNS[token.text] ?? token.text}</span>
                ))}
                <span className="pbook__sign">=</span>
                <b className="pbook__answer">{settled ? money(settled.amountMinor) : '?'}</b>
              </div>
            )}
            <span className="field__hint">
              Follows what it is a percentage of{result && result.currency !== 'INR' ? `, in ${result.currency} like them` : ''}.
            </span>
          </div>
        ) : (
          <>
            <div className="pbook__formularow">
              <label className="field">
                <span>Priced in</span>
                <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                  {CURRENCIES(currency).map((code) => <option key={code} value={code}>{code} {sym(code)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Charged</span>
                <select value={per} onChange={(event) => setPer(event.target.value as Per)}>
                  <option value="unit">Per unit</option>
                  <option value="kg">By weight - rate × kg</option>
                  <option value="shipment">Per shipment - shared</option>
                </select>
              </label>
            </div>

            {per !== 'unit' && (
              <div className="field">
                <span>{per === 'kg' ? 'Rate × weight' : 'Shipment charge, shared'}</span>
                <div className="pbook__sum">
                  <span className="pbook__x">{priceBox}</span>
                  <span className="pbook__sign">{per === 'kg' ? '/kg ×' : '÷'}</span>
                  <Term value={count} label={per === 'kg' ? 'Kg for one unit' : 'Units sharing it'} onChange={setCount} />
                  <span className="pbook__sign">{per === 'kg' ? 'kg' : 'units'} =</span>
                  <b className="pbook__answer">{base !== null ? `${sym(currency)}${short(base)}` : '?'}</b>
                </div>
              </div>
            )}

            {via && (
              <div className="field">
                <span className="pbook__step">
                  Paid in
                  <select value={via.currency} aria-label="Paid in" onChange={(event) => setVia({ ...via, currency: event.target.value })}>
                    {CURRENCIES(via.currency).map((code) => <option key={code} value={code}>{code} {sym(code)}</option>)}
                  </select>
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => setVia(null)}>Remove this step</button>
                </span>
                <Sum tokens={via.tokens} onTokens={(next) => setVia({ ...via, tokens: next })}
                  x={per === 'unit' ? priceBox : <>{sym(currency)}{base !== null ? short(base) : '?'}</>}
                  value={per === 'unit' ? x : base}
                  answer={paid !== null ? `${sym(via.currency)}${short(paid)}` : '?'} />
                {writing && (
                  <input className="pbook__exprinput" value={joined(via.tokens)} spellCheck={false} aria-label="Formula to the paid currency"
                    onChange={(event) => setVia({ ...via, tokens: tokenize(event.target.value) })} />
                )}
              </div>
            )}

            <div className="field">
              <span className="pbook__step">
                Into ₹
                {!via && (
                  <button type="button" className="btn btn--quiet btn--sm"
                    onClick={() => setVia({ currency: currency === 'USD' ? 'CNY' : 'USD', tokens: tokenize('x / 6.7') })}>
                    ＋ Paid in another currency
                  </button>
                )}
              </span>
              <Sum tokens={tokens} onTokens={setTokens}
                x={!via && per === 'unit' ? priceBox : <>{sym(paidIn)}{paid !== null ? short(paid) : '?'}</>}
                value={!via && per === 'unit' ? x : paid} answer={works && settled ? money(settled.amountMinor) : '?'} />
              {writing ? (
                <input className="pbook__exprinput" value={joined(tokens)} spellCheck={false} aria-label="Formula to rupees"
                  onChange={(event) => setTokens(tokenize(event.target.value))} />
              ) : (
                <button type="button" className="btn btn--quiet btn--sm pbook__rewrite" onClick={() => setWriting(true)}>
                  Change the formulas themselves
                </button>
              )}
            </div>
          </>
        )}

        <span className="field__hint">Only this order changes - the calculator stays as it is.</span>

        <div className="row">
          <button type="button" className="btn btn--sm" disabled={!draft || !works}
            onClick={() => draft && onSave(withFormula(row, column, draft), 'formula')}>
            Save
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Cancel</button>
        </div>

        <div className="pbook__static">
          <label className="field">
            <span>Or a fixed ₹ value, no formula</span>
            <span className="pbook__money">
              <b>₹</b>
              <input inputMode="decimal" value={fixedText} placeholder="0" onChange={(event) => setFixedText(event.target.value)} />
            </span>
          </label>
          <button type="button" className="btn btn--ghost btn--sm" disabled={fixedRupees === null || fixedRupees < 0}
            onClick={() => fixedRupees !== null && onSave(withCost(row, column, Math.round(fixedRupees * 100), null), 'fixed')}>
            Use fixed ₹
          </button>
        </div>
      </div>
    </Modal>
  );
}
