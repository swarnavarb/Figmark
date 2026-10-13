import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COMMON_CURRENCIES, SCENARIOS, evalFormula, formulaMinor, formulaWorking, payCurrencyOf, solveFormula, symbolOf, templateExpr,
  type CostFormula, type CostStage, type CostStep, type ProfitTemplate,
} from '@shared/profit';
import { ApiRequestError, api, type BookLot, type BookRow, type CostsResponse } from '../api';
import { formatMoney } from '../format';
import { ErrorNotice, Modal, PersonLink, Tile } from '../components/ui';

/**
 * Real profit as a book: lots, and what was sold from hand. A lot opens to
 * its orders, one sheet per customer, a row per order and a column per cost -
 * every cost cell typed straight into, per unit, for that one order. Selling
 * price less cost price is the profit.
 *
 * Each change is saved as it is made (a cell when you leave it) as that
 * order's own costs, and can be undone - a column added or deleted, a payment
 * split, a reset - one step at a time.
 */

const money = (minor: number) => formatMoney(minor, 'INR');
/** A sheet cell: rupees without the sign, the header already says ₹. */
const cell = (minor: number) => (minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

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

export function ProfitBook({ shop, data, reload }: { shop?: string; data: CostsResponse | null; reload: () => void }) {
  const [tab, setTab] = useState<Tab>('lots');
  const [lotId, setLotId] = useState<string | null>(null);
  // Edits land here first, so a typed cell changes the sums at once.
  const [rows, setRows] = useState<BookRow[]>(data?.rows ?? []);
  useEffect(() => setRows(data?.rows ?? []), [data]);
  useEffect(() => window.scrollTo(0, 0), [lotId]);

  if (!data) return <p className="muted">Loading…</p>;

  const inHand = rows.filter((row) => !row.lotId);
  const inLots = rows.filter((row) => row.lotId);
  const lot = lotId ? data.lots.find((entry) => entry.id === lotId) ?? null : null;
  const scope = lot ? rows.filter((row) => row.lotId === lot.id) : tab === 'lots' ? inLots : inHand;
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
        <CustomerSheets key={lot?.id ?? 'hand'} rows={scope} customers={data.customers} shop={shop} onChange={change}
          onFailed={reload} empty={lot ? 'No orders in this lot yet.' : 'Nothing sold from hand yet.'} />
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
  const totals = bookTotals(rows);
  // The margin is of what the costed orders sold for, as the profit is.
  const margin = rows.filter(costed).reduce((sum, row) => sum + salesOf(row), 0);
  return (
    <>
      <div className="tiles tiles--four">
        <Tile value={money(totals.costMinor)} label="Cost price" tone="blue" />
        <Tile value={money(totals.profitMinor)}
          label={margin > 0 ? `Profit · ${Math.round((totals.profitMinor / margin) * 100)}%` : 'Profit'} tone="green" />
        <Tile value={money(totals.salesMinor)} label="Selling price" />
        <Tile value={money(totals.pendingMinor)} label="Pending" />
      </div>
      {totals.uncosted > 0 && (
        <p className="faint">
          {totals.uncosted} order{totals.uncosted === 1 ? ' has' : 's have'} no costs yet, so no profit is counted on
          {totals.uncosted === 1 ? ' it' : ' them'}. Type the cost price into the sheet.
        </p>
      )}
    </>
  );
}

function LotList({ lots, rows, onOpen }: { lots: BookLot[]; rows: BookRow[]; onOpen: (id: string) => void }) {
  if (lots.length === 0) return <p className="muted">No lots yet.</p>;
  return (
    <div className="stack">
      {lots.map((lot) => {
        const mine = rows.filter((row) => row.lotId === lot.id);
        const totals = bookTotals(mine);
        const customers = new Set(mine.map((row) => row.buyerId)).size;
        return (
          <button key={lot.id} type="button" className={`inscard pbook__lot${totals.profitMinor < 0 ? ' inscard--loss' : ''}`}
            onClick={() => onOpen(lot.id)}>
            <span className="inscard__head inscard__head--plain pbook__lotrow">
              <span>
                <span className="inscard__title">{lot.name}</span>
                <small>
                  {[lot.number, statusName(lot.status), `${mine.length} order${mine.length === 1 ? '' : 's'}`,
                    `${customers} customer${customers === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className={`inscard__big${totals.profitMinor < 0 ? ' is-loss' : ''}`}>
                {money(totals.profitMinor)}<small>profit</small>
              </span>
            </span>
            <span className="inscard__facts">
              <span>Cost price {money(totals.costMinor)}</span>
              <span>Selling price {money(totals.salesMinor)}</span>
              {totals.pendingMinor > 0 && <span className="badge badge--warn">{money(totals.pendingMinor)} pending</span>}
              {totals.uncosted > 0 && <span className="badge">{totals.uncosted} not costed</span>}
            </span>
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
 * What the sheet shows of a cost: its price abroad, or its rupees. A cost
 * with a price abroad anywhere in view gets both, side by side, in one colour.
 */
interface Part {
  column: Column;
  abroad: boolean;
  /** What hiding it remembers. */
  key: string;
  /** The currency the price abroad is in; ₹ for the rupee part. */
  currency: string;
  tone: number;
}

const TONES = 6;

function partsFor(columns: Column[], rows: BookRow[]): Part[] {
  const parts: Part[] = [];
  columns.forEach((column, at) => {
    const tone = at % TONES;
    const formula = rows.map((row) => stepIn(row, column)?.formula).find(Boolean);
    if (formula) parts.push({ column, abroad: true, key: `${column.key}·abroad`, currency: formula.currency, tone });
    parts.push({ column, abroad: false, key: column.key, currency: 'INR', tone });
  });
  return parts;
}

const partName = (part: Part) => `${part.column.label} ${sym(part.currency)}`;

/**
 * The price abroad and sum a cost starts from when it has none: the same
 * cost on another order here, else the calculator's own - a copy either way.
 */
type Seed = Pick<CostFormula, 'currency' | 'expr'>;
function seedFor(column: Column, rows: BookRow[], template: ProfitTemplate | null): Seed {
  for (const row of rows) {
    const formula = stepIn(row, column)?.formula;
    if (formula) return formula;
  }
  if (template) {
    const line = template.lines.find((entry) => keyOf(entry.label) === column.key && entry.currency !== 'INR');
    if (line) {
      const pay = line.currency === 'pay';
      return { currency: pay ? payCurrencyOf(template) : template.currency, expr: templateExpr(template, pay) };
    }
    return { currency: template.currency, expr: templateExpr(template) };
  }
  for (const row of rows) for (const step of row.steps) if (step.formula) return step.formula;
  // No calculator of the shop's own yet: the calculator's first way in.
  const starter = SCENARIOS[0]!.sheet();
  return { currency: starter.currency, expr: templateExpr(starter) };
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

/** A row's steps with one cost set - its rupees, and its price abroad or none. */
function withCost(row: BookRow, column: Column, amountMinor: number, formula: CostFormula | null): CostStep[] {
  const at = row.steps.findIndex((step) => keyOf(step.label) === column.key);
  const base = at >= 0 ? row.steps[at]! : { id: column.id, label: column.label, stage: column.stage, amountMinor: 0 };
  const { formula: _old, ...rest } = base;
  const next: CostStep = formula ? { ...rest, amountMinor, formula } : { ...rest, amountMinor };
  return at >= 0 ? row.steps.map((step, index) => (index === at ? next : step)) : [...row.steps, next];
}

/** Rupees for a cost; with a price abroad that the sum can be run back from, that moves too. */
function rupeesInto(row: BookRow, column: Column, amountMinor: number): CostStep[] {
  const formula = stepIn(row, column)?.formula;
  const x = formula ? solveFormula(formula.expr, amountMinor / 100) : null;
  if (!formula || x === null) return withCost(row, column, amountMinor, null);
  const moved = { ...formula, amount: round4(x) };
  return withCost(row, column, formulaMinor(moved), moved);
}

/** A supplier payment being shared out: over which orders, into what, how much. */
interface Split { partKey: string; amount: string; picked: string[]; base: BookRow[] }

function CustomerSheets({ rows, customers, shop, onChange, onFailed, empty }: {
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
  const [template, setTemplate] = useState<ProfitTemplate | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
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

  // The calculator's own sum, to start a price abroad from where there is none.
  useEffect(() => {
    void api.profitTemplates(shop)
      .then((result) => setTemplate(result.templates.find((entry) => entry.isDefault) ?? result.templates[0] ?? null))
      .catch(() => setTemplate(null));
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
  const splitParts = useMemo(() => (splitBase ? partsFor(columnsFor(splitBase, extra), splitBase) : []), [splitBase, extra]);

  /** A split as it stands: what each ticked order's costs become. */
  const splitChanges = useMemo((): Change[] => {
    if (!split) return [];
    const part = splitParts.find((entry) => entry.key === split.partKey);
    const paid = Number(split.amount.replace(/[,\s]/g, ''));
    if (!part || !(paid > 0) || !Number.isFinite(paid)) return [];
    const chosen = split.base.filter((row) => split.picked.includes(row.orderId));
    // Shared by what each was worth in that field; equally per unit when none has a value yet.
    const worth = (row: BookRow) => {
      const step = stepIn(row, part.column);
      return (part.abroad ? step?.formula?.amount ?? 0 : (step?.amountMinor ?? 0) / 100) * row.quantity;
    };
    const total = chosen.reduce((sum, row) => sum + worth(row), 0);
    const weight = total > 0 ? worth : (row: BookRow) => row.quantity;
    const sum = total > 0 ? total : chosen.reduce((all, row) => all + row.quantity, 0);
    const changes: Change[] = [];
    for (const row of chosen) {
      // Shared by value, an order with none in that field takes none of it.
      if (weight(row) === 0) continue;
      const each = (paid * weight(row)) / sum / row.quantity;
      let steps: CostStep[];
      if (part.abroad) {
        const seed = stepIn(row, part.column)?.formula ?? seedFor(part.column, split.base, template);
        const formula = { currency: seed.currency, amount: round4(each), expr: seed.expr };
        steps = withCost(row, part.column, formulaMinor(formula), formula);
      } else {
        steps = rupeesInto(row, part.column, Math.round(each * 100));
      }
      changes.push({ before: row, after: { ...row, steps, own: true }, steps });
    }
    return changes;
  }, [split, splitParts, template]);

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

  function save(label: string, row: BookRow, steps: CostStep[]) {
    if (JSON.stringify(steps) === JSON.stringify(row.steps)) return;
    void commit(label, [withSteps(row, steps)]);
  }

  /** Rupees typed into a cell, or cleared. */
  function typeRupees(row: BookRow, column: Column, amountMinor: number | null) {
    if (amountMinor === null) {
      if (!stepIn(row, column)) return;
      return save(`${column.label} for ${row.itemName}`, row, row.steps.filter((step) => keyOf(step.label) !== column.key));
    }
    save(`${column.label} for ${row.itemName}`, row, rupeesInto(row, column, amountMinor));
  }

  /** A price abroad typed into a cell: the rupees follow its formula. Cleared, the rupees stay as they are. */
  function typeAbroad(row: BookRow, column: Column, amount: number | null) {
    const step = stepIn(row, column);
    const label = `${column.label} abroad for ${row.itemName}`;
    if (amount === null) {
      if (step?.formula) save(label, row, withCost(row, column, step.amountMinor, null));
      return;
    }
    const seed = step?.formula ?? seedFor(column, rows, template);
    const formula = { currency: seed.currency, amount: round4(amount), expr: seed.expr };
    save(label, row, withCost(row, column, formulaMinor(formula), formula));
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
      holding.map((row) => withSteps(row, row.steps.filter((step) => keyOf(step.label) !== column.key))),
      { extra: extra.filter((entry) => entry.key !== column.key) });
  }

  function toggleColumn(key: string) {
    const next = hidden.includes(key) ? hidden.filter((entry) => entry !== key) : [...hidden, key];
    void commit(hidden.includes(key) ? 'show a column' : 'hide a column', [], { hidden: next });
  }

  function openSplit() {
    setDropping(null);
    const first = parts.find((part) => part.abroad) ?? parts.find((part) => part.column.key === ITEM_PRICE.key)!;
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

  const owing = groups.filter((group) => group.totals.pendingMinor > 0);
  const last = history[history.length - 1];
  const splitPart = split ? splitParts.find((part) => part.key === split.partKey) : undefined;
  const editRow = editing ? rows.find((row) => row.orderId === editing.orderId) : undefined;

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
              Over the {split.picked.length} ticked order{split.picked.length === 1 ? '' : 's'}, by their {partName(splitPart)}
            </span>
          </div>
        </form>
      )}

      <p className="faint pbook__hint">
        Per unit, for that order only - saved as soon as you leave a cell. Same colour, same cost: abroad and in ₹. ƒx shows how it is worked out.
      </p>

      {groups.map((group) => {
        const who = customers[group.buyerId];
        return (
          <section key={group.buyerId} id={`pbook-${group.buyerId}`} className="card pbook__sheet">
            <header className="pbook__who">
              <PersonLink party={who ? { name: who.name, handle: who.handle } : { name: 'Customer', handle: null }}
                className="inscard__title" bare />
              <span className="pbook__whofacts">
                <span>Profit <b className="pbook__num">{money(group.totals.profitMinor)}</b></span>
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
                        <span>{part.column.label} <b className="pbook__cur">{sym(part.currency)}</b></span>
                        <span className="pbook__headtools">
                          <button type="button" className="pbook__drop" aria-label={`Hide ${partName(part)}`}
                            title="Hide" onClick={() => toggleColumn(part.key)}>–</button>
                          {!part.abroad && part.column.key !== ITEM_PRICE.key && (
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
                          const label = `${partName(part)} for ${row.itemName}`;
                          if (part.abroad) {
                            const foreign = step?.formula && step.formula.currency !== part.currency ? sym(step.formula.currency) : '';
                            return (
                              <td key={part.key} className={`pbook__cell pbook__tone--${part.tone}`}>
                                <NumberCell value={step?.formula?.amount ?? null} label={label} prefix={foreign}
                                  disabled={Boolean(split)} onCommit={(amount) => typeAbroad(row, part.column, amount)} />
                              </td>
                            );
                          }
                          return (
                            <td key={part.key} className={`pbook__cell pbook__tone--${part.tone}`}>
                              <NumberCell value={step ? step.amountMinor / 100 : null} label={label} disabled={Boolean(split)}
                                onCommit={(rupees) => typeRupees(row, part.column, rupees === null ? null : Math.round(rupees * 100))} />
                              <button type="button" className={`pbook__fx${step?.formula ? ' has-formula' : ''}`}
                                title="How this is worked out" disabled={Boolean(split)}
                                onClick={() => setEditing({ orderId: row.orderId, column: part.column })}>ƒx</button>
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
                      {shown.map((part) => <td key={part.key} />)}
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
        <FormulaEditor row={editRow} column={editing.column} seed={seedFor(editing.column, rows, template)}
          onClose={() => setEditing(null)}
          onSave={(amountMinor, formula) => {
            save(formula ? `${editing.column.label} formula for ${editRow.itemName}` : `${editing.column.label} for ${editRow.itemName}`,
              editRow, withCost(editRow, editing.column, amountMinor, formula));
            setEditing(null);
          }} />
      )}
    </div>
  );
}

/** One number cell, saved when you leave it; empty clears it. */
function NumberCell({ value, label, prefix, disabled, onCommit }: {
  value: number | null; label: string; prefix?: string; disabled?: boolean; onCommit: (value: number | null) => void;
}) {
  const shown = value === null ? '' : String(round4(value));
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
  return (
    <span className="pbook__numcell">
      {prefix ? <span className="pbook__cur">{prefix}</span> : null}
      <input className="pbook__input" inputMode="decimal" value={text} aria-label={label} placeholder="—" disabled={disabled}
        onChange={(event) => setText(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
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

const SIGNS: Record<string, string> = { '*': '×', '/': '÷', '-': '−' };
const short = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * How a cost comes to its rupees: the price abroad put through its formula,
 * every number in it there to type over, and each step of the working. Or a
 * plain rupee amount instead. Only this order changes - not the calculator.
 */
function FormulaEditor({ row, column, seed, onClose, onSave }: {
  row: BookRow;
  column: Column;
  seed: Seed;
  onClose: () => void;
  onSave: (amountMinor: number, formula: CostFormula | null) => void;
}) {
  const step = stepIn(row, column);
  const start = step?.formula ?? seed;
  const [currency, setCurrency] = useState(start.currency);
  const [tokens, setTokens] = useState<Token[]>(() => tokenize(start.expr));
  const [writing, setWriting] = useState(false);
  // With no price abroad yet, what the rupees already there come back to.
  const [amount, setAmount] = useState(() => {
    if (step?.formula) return String(step.formula.amount);
    const solved = step ? solveFormula(start.expr, step.amountMinor / 100) : null;
    return solved === null ? '' : String(Math.round(solved * 100) / 100);
  });
  const [fixed, setFixed] = useState(step ? String(step.amountMinor / 100) : '');

  const expr = tokens.map((token) => token.text).join('');
  const x = Number(amount.replace(/[,\s]/g, ''));
  const known = amount.trim() !== '' && Number.isFinite(x) && x >= 0;
  const rupees = known ? evalFormula(expr, x) : null;
  const working = known ? formulaWorking(expr, x) ?? [] : [];
  const usable = rupees !== null && rupees >= 0;
  const fixedRupees = Number(fixed.replace(/[₹,\s]/g, ''));

  const setToken = (at: number, text: string) => setTokens((now) => now.map((token, index) => (index === at ? { ...token, text } : token)));

  return (
    <Modal title={`${column.label} · ${row.itemName}`} onClose={onClose}>
      <div className="stack pbook__formula">
        <div className="pbook__formularow">
          <label className="field">
            <span>Price abroad, per unit</span>
            <input inputMode="decimal" value={amount} placeholder="120" onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="field">
            <span>Currency</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {[...new Set([currency, ...COMMON_CURRENCIES])].map((code) => <option key={code} value={code}>{code} {sym(code)}</option>)}
            </select>
          </label>
        </div>

        <div className="field">
          <span>How it is worked out</span>
          <div className="pbook__sum" aria-label="The formula, with its numbers">
            {tokens.map((token, at) => {
              if (token.kind === 'x') {
                return (
                  <span key={at} className="pbook__x">
                    {sym(currency)}
                    <input inputMode="decimal" value={amount} size={Math.max(2, amount.length)} aria-label="Price abroad"
                      onChange={(event) => setAmount(event.target.value)} />
                  </span>
                );
              }
              if (token.kind === 'num') {
                return (
                  <input key={at} className="pbook__term" inputMode="decimal" value={token.text} size={Math.max(2, token.text.length)}
                    aria-label="A number in the formula" onChange={(event) => setToken(at, event.target.value)} />
                );
              }
              return token.text.trim() ? <span key={at} className="pbook__sign">{SIGNS[token.text] ?? token.text}</span> : null;
            })}
            <span className="pbook__sign">=</span>
            <b className="pbook__answer">{usable ? money(Math.round(rupees * 100)) : '?'}</b>
          </div>
          {working.length > 0 && (
            <ol className="pbook__working">
              {working.map((line, at) => (
                <li key={at}>{short(line.left)} {line.op} {short(line.right)} = <b>{short(line.value)}</b></li>
              ))}
            </ol>
          )}
          {writing ? (
            <input className="pbook__exprinput" value={expr} spellCheck={false} aria-label="Formula"
              onChange={(event) => setTokens(tokenize(event.target.value))} />
          ) : (
            <button type="button" className="btn btn--quiet btn--sm pbook__rewrite" onClick={() => setWriting(true)}>
              Change the formula itself
            </button>
          )}
          <span className="field__hint">
            {sym(currency)} is the price abroad. Only this order’s cost changes - the calculator stays as it is.
          </span>
        </div>

        <div className="row">
          <button type="button" className="btn btn--sm" disabled={!usable}
            onClick={() => {
              const formula = { currency, amount: round4(x), expr: expr.trim() };
              onSave(formulaMinor(formula), formula);
            }}>
            Save
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Cancel</button>
        </div>

        <div className="pbook__static">
          <label className="field">
            <span>Or a fixed ₹ value, no formula</span>
            <span className="pbook__money">
              <b>₹</b>
              <input inputMode="decimal" value={fixed} placeholder="0" onChange={(event) => setFixed(event.target.value)} />
            </span>
          </label>
          <button type="button" className="btn btn--ghost btn--sm" disabled={!(fixedRupees >= 0) || fixed.trim() === ''}
            onClick={() => onSave(Math.round(fixedRupees * 100), null)}>
            Use fixed ₹
          </button>
        </div>
      </div>
    </Modal>
  );
}
