import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COMMON_CURRENCIES, evalFormula, formulaMinor, solveFormula, symbolOf,
  type CostFormula, type CostStage, type CostStep,
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

/** "¥120", "$2.5" - an amount abroad, as short as it goes. */
const abroad = (formula: Pick<CostFormula, 'currency' | 'amount'>) =>
  `${symbolOf(formula.currency).trim()}${formula.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

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

/** Where the formula editor is open. */
interface Editing { row: BookRow; column: Column }

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
  const [editing, setEditing] = useState<Editing | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const columns = useMemo(() => columnsFor(rows, extra), [rows, extra]);
  const shown = columns.filter((column) => !hidden.includes(column.key));

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
    } catch {
      // Private window: the columns fold for this visit only.
    }
  }, [hidden]);

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
    if (!last) return;
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

  /** One cell: a new amount (and price abroad), or null to clear it. */
  function setCell(row: BookRow, column: Column, amountMinor: number | null, formula?: CostFormula | null) {
    const at = row.steps.findIndex((step) => keyOf(step.label) === column.key);
    const steps = [...row.steps];
    if (amountMinor === null) {
      if (at < 0) return;
      steps.splice(at, 1);
    } else {
      const base = at >= 0 ? steps[at]! : { id: column.id, label: column.label, stage: column.stage, amountMinor: 0 };
      const { formula: _old, ...rest } = base;
      const next: CostStep = formula ? { ...rest, amountMinor, formula } : { ...rest, amountMinor };
      if (at >= 0 && JSON.stringify(next) === JSON.stringify(base)) return;
      if (at >= 0) steps[at] = next;
      else steps.push(next);
    }
    void commit(`${column.label} for ${row.itemName}`, [withSteps(row, steps)]);
  }

  /** Rupees typed over a cost with a price abroad move the price abroad too, when the sum allows. */
  function typeCell(row: BookRow, column: Column, amountMinor: number | null) {
    const formula = stepIn(row, column)?.formula;
    if (amountMinor === null || !formula) return setCell(row, column, amountMinor);
    const x = solveFormula(formula.expr, amountMinor / 100);
    if (x === null) return setCell(row, column, amountMinor);
    const moved = { ...formula, amount: Math.round(x * 1e4) / 1e4 };
    setCell(row, column, formulaMinor(moved), moved);
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

  const owing = groups.filter((group) => group.totals.pendingMinor > 0);
  const last = history[history.length - 1];

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
        <button type="button" className="btn btn--ghost btn--sm" disabled={!last} onClick={undo}
          title={last ? `Undo: ${last.label}` : 'Nothing to undo'}>
          ↶ Undo{last ? <span className="pbook__undo">{last.label}</span> : null}
        </button>
        <button type="button" className={`btn btn--ghost btn--sm${showColumns ? ' is-on' : ''}`} onClick={() => setShowColumns((now) => !now)}>
          Columns{hidden.some((key) => columns.some((column) => column.key === key))
            ? ` · ${columns.filter((column) => hidden.includes(column.key)).length} hidden` : ''}
        </button>
        <button type="button" className={`btn btn--ghost btn--sm${splitting ? ' is-on' : ''}`}
          onClick={() => { setSplitting((now) => !now); setPicked([]); }}>
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
            {columns.map((column) => (
              <button key={column.key} type="button" className={`chip${hidden.includes(column.key) ? '' : ' is-on'}`}
                aria-pressed={!hidden.includes(column.key)} onClick={() => toggleColumn(column.key)}>
                {hidden.includes(column.key) ? '○' : '●'} {column.label}
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn btn--quiet btn--sm" disabled={shown.length === columns.length}
              onClick={() => void commit('show all columns', [], { hidden: [] })}>Show all</button>
            <button type="button" className="btn btn--quiet btn--sm" disabled={shown.length === 0}
              onClick={() => void commit('hide all columns', [], { hidden: [...new Set([...hidden, ...columns.map((column) => column.key)])] })}>
              Hide all
            </button>
          </div>
        </div>
      )}

      {splitting && (
        <SplitPayment rows={rows} columns={columns} picked={picked} customers={customers} onPick={setPicked}
          onClose={() => { setSplitting(false); setPicked([]); }}
          onApply={(label, changes) => {
            void commit(label, changes);
            setSplitting(false);
            setPicked([]);
          }} />
      )}

      <p className="faint pbook__hint">
        ₹ per unit, for that order only - saved as soon as you leave a cell. Tap the line under a cost for its price abroad and formula.
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
                    {shown.map((column) => (
                      <th key={column.key} className="pbook__costhead">
                        <span>{column.label}</span>
                        <span className="pbook__headtools">
                          <button type="button" className="pbook__drop" aria-label={`Hide the ${column.label} column`}
                            title="Hide" onClick={() => toggleColumn(column.key)}>–</button>
                          {column.key !== ITEM_PRICE.key && (
                            <button type="button" className={`pbook__drop${dropping === column.key ? ' is-asking' : ''}`}
                              aria-label={`Delete the ${column.label} column`} title="Delete" onClick={() => dropColumn(column)}
                              onBlur={() => setDropping((now) => (now === column.key ? null : now))}>
                              {dropping === column.key ? 'Delete?' : '✕'}
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
                    return (
                      <tr key={row.orderId} className={picked.includes(row.orderId) ? 'is-picked' : undefined}>
                        <td className="pbook__item">
                          {splitting && (
                            <input type="checkbox" className="pbook__pick" checked={picked.includes(row.orderId)}
                              aria-label={`Include ${row.itemName}`}
                              onChange={() => setPicked((now) => (now.includes(row.orderId)
                                ? now.filter((id) => id !== row.orderId) : [...now, row.orderId]))} />
                          )}
                          <Link to={`/listing/${row.listingId}`}>{row.itemName}</Link>
                          {row.own && (
                            <button type="button" className="pbook__reset" title="Use the item’s costs again"
                              onClick={() => void commit(`reset ${row.itemName}`, [{ before: row, after: row, steps: null }])}>
                              ↺ item costs
                            </button>
                          )}
                        </td>
                        <td className="pbook__num">{row.quantity}</td>
                        <td className="pbook__num">{cell(row.unitPriceMinor)}</td>
                        {shown.map((column) => {
                          const step = stepIn(row, column);
                          return (
                            <td key={column.key} className="pbook__cell">
                              <CostCell value={step ? step.amountMinor : null} label={`${column.label} for ${row.itemName}`}
                                onCommit={(amount) => typeCell(row, column, amount)} />
                              <button type="button" className={`pbook__fx${step?.formula ? ' has-formula' : ''}`}
                                title="Price abroad and formula" onClick={() => setEditing({ row, column })}>
                                {step?.formula ? abroad(step.formula) : 'ƒx'}
                              </button>
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
                      {shown.map((column) => <td key={column.key} />)}
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

      {editing && (
        <FormulaEditor row={editing.row} column={editing.column} rows={rows} onClose={() => setEditing(null)}
          onSave={(amountMinor, formula) => {
            const row = rows.find((entry) => entry.orderId === editing.row.orderId) ?? editing.row;
            setCell(row, editing.column, amountMinor, formula);
            setEditing(null);
          }} />
      )}
    </div>
  );
}

/** One cost cell: rupees per unit, saved when you leave it; empty removes the cost. */
function CostCell({ value, label, onCommit }: { value: number | null; label: string; onCommit: (amountMinor: number | null) => void }) {
  const shown = value === null ? '' : String(value / 100);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  function commit() {
    const clean = text.replace(/[₹,\s]/g, '');
    if (clean === shown) return;
    if (clean === '') return onCommit(null);
    const rupees = Number(clean);
    if (!Number.isFinite(rupees) || rupees < 0) return setText(shown);
    onCommit(Math.round(rupees * 100));
  }
  return (
    <input className="pbook__input" inputMode="decimal" value={text} aria-label={label} placeholder="—"
      onChange={(event) => setText(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
  );
}

/** A formula to start from: this column's elsewhere in view, else any. */
function startingFormula(rows: BookRow[], column: Column): Omit<CostFormula, 'amount'> | null {
  let any: CostFormula | null = null;
  for (const row of rows) {
    for (const step of row.steps) {
      if (!step.formula) continue;
      if (keyOf(step.label) === column.key) return step.formula;
      any ??= step.formula;
    }
  }
  return any;
}

const currencyChoices = (current: string) => [...new Set([current, ...COMMON_CURRENCIES])].filter(Boolean);

/**
 * A cost's price abroad and the sum that makes it rupees, for this one order.
 * Its own copy: the calculator, its rates and other orders stay as they are.
 */
function FormulaEditor({ row, column, rows, onClose, onSave }: {
  row: BookRow;
  column: Column;
  rows: BookRow[];
  onClose: () => void;
  onSave: (amountMinor: number | null, formula: CostFormula | null) => void;
}) {
  const step = stepIn(row, column);
  const start = step?.formula ?? startingFormula(rows, column);
  const [currency, setCurrency] = useState(start?.currency ?? 'CNY');
  const [expr, setExpr] = useState(start?.expr ?? '');
  // With no price abroad yet, what the rupees already there come back to.
  const [amount, setAmount] = useState(() => {
    if (step?.formula) return String(step.formula.amount);
    const solved = step && start ? solveFormula(start.expr, step.amountMinor / 100) : null;
    return solved === null ? '' : String(Math.round(solved * 100) / 100);
  });
  const x = Number(amount.replace(/[,\s]/g, ''));
  const rupees = amount.trim() && Number.isFinite(x) && x >= 0 ? evalFormula(expr, x) : null;
  const usable = rupees !== null && rupees >= 0;

  return (
    <Modal title={`${column.label} · ${row.itemName}`} onClose={onClose}>
      <form className="stack pbook__formula" onSubmit={(event) => {
        event.preventDefault();
        if (!usable) return;
        const formula = { currency, amount: Math.round(x * 1e4) / 1e4, expr: expr.trim() };
        onSave(formulaMinor(formula), formula);
      }}>
        <div className="pbook__formularow">
          <label className="field">
            <span>Price abroad, per unit</span>
            <input inputMode="decimal" autoFocus value={amount} placeholder="120" onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="field">
            <span>Currency</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {currencyChoices(currency).map((code) => <option key={code} value={code}>{code} {symbolOf(code).trim()}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Formula to rupees</span>
          <input value={expr} placeholder="x / 6.7 * 1.1 * 88 + 176" spellCheck={false} onChange={(event) => setExpr(event.target.value)} />
          <span className="field__hint">
            x is the price abroad. Numbers, + − × ÷ and brackets. Only this order’s cost changes - not the calculator.
          </span>
        </label>
        <p className="pbook__result">
          {usable
            ? <>{abroad({ currency, amount: x })} → <b>{money(Math.round(rupees * 100))}</b> per unit</>
            : <span className="faint">{expr.trim() && amount.trim() ? 'That formula does not work out.' : 'Fill in the price and formula.'}</span>}
        </p>
        <div className="row">
          <button type="submit" className="btn btn--sm" disabled={!usable}>Save</button>
          {step?.formula && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onSave(step.amountMinor, null)}>
              Keep ₹ only
            </button>
          )}
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

type SplitBy = 'abroad' | 'rupees' | 'equal';

/**
 * One payment to a supplier covering several orders - often different
 * customers' - shared out over them by what each was worth: its price abroad,
 * its rupees, or equally per unit. Written into one cost column of each, all
 * in one change, so one undo puts it back.
 */
function SplitPayment({ rows, columns, picked, customers, onPick, onClose, onApply }: {
  rows: BookRow[];
  columns: Column[];
  picked: string[];
  customers: CostsResponse['customers'];
  onPick: (ids: string[]) => void;
  onClose: () => void;
  onApply: (label: string, changes: Change[]) => void;
}) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [rate, setRate] = useState('');
  const [intoKey, setIntoKey] = useState(ITEM_PRICE.key);
  const [byKey, setByKey] = useState(ITEM_PRICE.key);
  const [by, setBy] = useState<SplitBy>('abroad');

  const into = columns.find((column) => column.key === intoKey) ?? ITEM_PRICE;
  const basisColumn = columns.find((column) => column.key === byKey) ?? ITEM_PRICE;
  const chosen = rows.filter((row) => picked.includes(row.orderId));
  const paid = Number(amount.replace(/[,\s]/g, ''));
  const perUnit = currency === 'INR' ? 1 : Number(rate.replace(/[,\s]/g, ''));
  const ready = paid > 0 && Number.isFinite(paid) && perUnit > 0 && Number.isFinite(perUnit);

  // Each order's weight is its value per unit times how many.
  const weightOf = (row: BookRow) => {
    if (by === 'equal') return row.quantity;
    const step = stepIn(row, basisColumn);
    const each = by === 'abroad' ? step?.formula?.amount ?? 0 : (step?.amountMinor ?? 0) / 100;
    return each * row.quantity;
  };
  const weights = chosen.map(weightOf);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const unweighted = chosen.filter((_, at) => weights[at] === 0).length;
  const abroadCurrencies = new Set(chosen.map((row) => stepIn(row, basisColumn)?.formula?.currency).filter(Boolean));
  const currencies = [...new Set(['INR', 'USD', 'CNY', ...abroadCurrencies as Set<string>, ...COMMON_CURRENCIES])];

  const shares = chosen.map((row, at) => {
    const share = total > 0 ? (paid * weights[at]!) / total : 0;
    return { row, share, each: share / row.quantity };
  });

  function apply() {
    if (!ready || total <= 0) return;
    const changes = shares.map(({ row, each }) => {
      const formula: CostFormula | null = currency === 'INR'
        ? null
        : { currency, amount: Math.round(each * 1e4) / 1e4, expr: `x * ${Math.round(perUnit * 1e6) / 1e6}` };
      const amountMinor = formula ? formulaMinor(formula) : Math.round(each * 100);
      const at = row.steps.findIndex((step) => keyOf(step.label) === into.key);
      const base = at >= 0 ? row.steps[at]! : { id: into.id, label: into.label, stage: into.stage, amountMinor: 0 };
      const { formula: _old, ...rest } = base;
      const next: CostStep = formula ? { ...rest, amountMinor, formula } : { ...rest, amountMinor };
      const steps = at >= 0 ? row.steps.map((step, index) => (index === at ? next : step)) : [...row.steps, next];
      return { before: row, after: { ...row, steps, own: true }, steps };
    });
    onApply(`split ${abroad({ currency, amount: paid })} into ${into.label}`, changes);
  }

  const sym = symbolOf(currency).trim();
  return (
    <section className="card card--pad stack pbook__split">
      <div className="row row--between">
        <b>Split a supplier payment</b>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Close</button>
      </div>
      <p className="faint">
        Tick the orders it paid for below - any customers. The amount is shared by what each order was worth and written as
        the cost per unit.
      </p>
      <div className="pbook__splitrow">
        <label className="field">
          <span>Paid</span>
          <input inputMode="decimal" value={amount} placeholder="0" onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="field">
          <span>In</span>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {currencies.map((code) => <option key={code} value={code}>{code} {symbolOf(code).trim()}</option>)}
          </select>
        </label>
        {currency !== 'INR' && (
          <label className="field">
            <span>₹ per {sym}1</span>
            <input inputMode="decimal" value={rate} placeholder="88" onChange={(event) => setRate(event.target.value)} />
          </label>
        )}
      </div>
      <div className="pbook__splitrow">
        <label className="field">
          <span>Write it into</span>
          <select value={intoKey} onChange={(event) => setIntoKey(event.target.value)}>
            {columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Share it by</span>
          <select value={by} onChange={(event) => setBy(event.target.value as SplitBy)}>
            <option value="abroad">Price abroad (¥, $…)</option>
            <option value="rupees">Value in ₹</option>
            <option value="equal">Equally per unit</option>
          </select>
        </label>
        {by !== 'equal' && (
          <label className="field">
            <span>Of</span>
            <select value={byKey} onChange={(event) => setByKey(event.target.value)}>
              {columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => onPick(rows.map((row) => row.orderId))}>Tick all</button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={picked.length === 0} onClick={() => onPick([])}>Clear</button>
        <span className="faint">{chosen.length} order{chosen.length === 1 ? '' : 's'} ticked</span>
      </div>

      {chosen.length > 0 && (
        <div className="pbook__scroll">
          <table className="pbook__table">
            <thead>
              <tr>
                <th className="pbook__item">Item</th>
                <th>Qty</th>
                <th>{by === 'equal' ? 'Units' : by === 'abroad' ? 'Abroad' : '₹ value'}</th>
                <th>Share {sym}</th>
                <th>Per unit {sym}</th>
              </tr>
            </thead>
            <tbody>
              {shares.map(({ row, share, each }, at) => (
                <tr key={row.orderId}>
                  <td className="pbook__item">
                    {row.itemName}
                    <small className="pbook__whom">{customers[row.buyerId]?.name ?? 'Customer'}</small>
                  </td>
                  <td className="pbook__num">{row.quantity}</td>
                  <td className="pbook__num">{weights[at]!.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className="pbook__num">{ready ? share.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</td>
                  <td className="pbook__num">{ready ? each.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {chosen.length > 0 && total <= 0 && (
        <p className="faint">
          None of these has a {by === 'abroad' ? 'price abroad' : '₹ value'} in {basisColumn.label} to share by. Pick another
          column, or share equally.
        </p>
      )}
      {total > 0 && unweighted > 0 && (
        <p className="faint">{unweighted} ticked order{unweighted === 1 ? ' has' : 's have'} nothing in {basisColumn.label}, so {unweighted === 1 ? 'gets' : 'get'} no share.</p>
      )}
      {by === 'abroad' && abroadCurrencies.size > 1 && (
        <p className="faint">These prices abroad are in different currencies, so the shares mix them.</p>
      )}
      <div className="row">
        <button type="button" className="btn btn--sm" disabled={!ready || total <= 0} onClick={apply}>
          Split {ready ? abroad({ currency, amount: paid }) : ''} over {chosen.length} order{chosen.length === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  );
}
