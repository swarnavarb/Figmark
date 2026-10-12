import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CostStage, CostStep } from '@shared/profit';
import { ApiRequestError, api, type BookLot, type BookRow, type CostsResponse } from '../api';
import { formatMoney } from '../format';
import { ErrorNotice, PersonLink, Tile } from '../components/ui';

/**
 * Real profit as a book: lots, and what was sold from hand. A lot opens to
 * its orders, one sheet per customer, a row per order and a column per cost -
 * every cost cell typed straight into, per unit, for that one order.
 */

const money = (minor: number) => formatMoney(minor, 'INR');

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
        <Tile value={money(totals.costMinor)} label="Total costs" tone="blue" />
        <Tile value={money(totals.profitMinor)}
          label={margin > 0 ? `Profit · ${Math.round((totals.profitMinor / margin) * 100)}%` : 'Profit'} tone="green" />
        <Tile value={money(totals.salesMinor)} label="Sales" />
        <Tile value={money(totals.pendingMinor)} label="Pending" />
      </div>
      {totals.uncosted > 0 && (
        <p className="faint">
          {totals.uncosted} order{totals.uncosted === 1 ? ' has' : 's have'} no costs yet, so no profit is counted on
          {totals.uncosted === 1 ? ' it' : ' them'}. Type them into the sheet.
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
              <span>Costs {money(totals.costMinor)}</span>
              <span>Sales {money(totals.salesMinor)}</span>
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

function CustomerSheets({ rows, customers, shop, onChange, onFailed, empty }: {
  rows: BookRow[];
  customers: CostsResponse['customers'];
  shop?: string;
  onChange: (row: BookRow) => void;
  onFailed: () => void;
  empty: string;
}) {
  const [extra, setExtra] = useState<Column[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const columns = useMemo(() => columnsFor(rows, extra), [rows, extra]);

  const groups = useMemo(() => {
    const byBuyer = new Map<string, BookRow[]>();
    for (const row of rows) byBuyer.set(row.buyerId, [...(byBuyer.get(row.buyerId) ?? []), row]);
    return [...byBuyer].map(([buyerId, mine]) => ({ buyerId, rows: mine, totals: bookTotals(mine) }))
      .sort((a, b) => b.totals.pendingMinor - a.totals.pendingMinor
        || (customers[a.buyerId]?.name ?? '').localeCompare(customers[b.buyerId]?.name ?? ''));
  }, [rows, customers]);

  if (rows.length === 0) return <p className="muted">{empty}</p>;

  async function save(row: BookRow, steps: CostStep[] | null) {
    setFailed(null);
    // The sums move now; the answer replaces the guess.
    if (steps) onChange({ ...row, steps, own: true });
    try {
      const saved = await api.saveOrderCosts(row.orderId, steps, shop);
      onChange({ ...row, steps: saved.steps, own: saved.own });
    } catch (err) {
      onChange(row);
      setFailed(err instanceof ApiRequestError ? err.message : 'Could not save that cost.');
      if (!(err instanceof ApiRequestError)) onFailed();
    }
  }

  function setCell(row: BookRow, column: Column, amountMinor: number | null) {
    const at = row.steps.findIndex((step) => keyOf(step.label) === column.key);
    const steps = [...row.steps];
    if (amountMinor === null) {
      if (at < 0) return;
      steps.splice(at, 1);
    } else if (at >= 0) {
      if (steps[at]!.amountMinor === amountMinor) return;
      steps[at] = { ...steps[at]!, amountMinor };
    } else {
      steps.push({ id: column.id, label: column.label, stage: column.stage, amountMinor });
    }
    void save(row, steps);
  }

  function addColumn() {
    const label = (adding ?? '').trim();
    setAdding(null);
    if (!label || columns.some((column) => column.key === keyOf(label))) return;
    setExtra((now) => [...now, { key: keyOf(label), label, stage: 'selling', id: slug(label) }]);
  }

  const owing = groups.filter((group) => group.totals.pendingMinor > 0);

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
        <span className="faint">Costs are per unit. Type in any cell; the change is for that order only.</span>
        {adding === null ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAdding('')}>＋ Cost column</button>
        ) : (
          <form className="pbook__addcol" onSubmit={(event) => { event.preventDefault(); addColumn(); }}>
            <input autoFocus value={adding} maxLength={80} placeholder="e.g. Packing" aria-label="New cost column"
              onChange={(event) => setAdding(event.target.value)} onBlur={addColumn} />
          </form>
        )}
      </div>

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
                    <th>Price</th>
                    {columns.map((column) => <th key={column.key} className="pbook__costhead">{column.label}</th>)}
                    <th>Cost</th>
                    <th>Profit</th>
                    <th>Paid</th>
                    <th>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const profit = salesOf(row) - costOf(row);
                    return (
                      <tr key={row.orderId}>
                        <td className="pbook__item">
                          <Link to={`/listing/${row.listingId}`}>{row.itemName}</Link>
                          {row.own && (
                            <button type="button" className="pbook__reset" title="Use the item’s costs again"
                              onClick={() => void save(row, null)}>↺ item costs</button>
                          )}
                        </td>
                        <td className="pbook__num">{row.quantity}</td>
                        <td className="pbook__num">{money(row.unitPriceMinor)}</td>
                        {columns.map((column) => {
                          const step = row.steps.find((entry) => keyOf(entry.label) === column.key);
                          return (
                            <td key={column.key} className="pbook__cell">
                              <CostCell value={step ? step.amountMinor : null} label={`${column.label} for ${row.itemName}`}
                                onCommit={(amount) => setCell(row, column, amount)} />
                            </td>
                          );
                        })}
                        <td className="pbook__num">{costed(row) ? money(costOf(row)) : '—'}</td>
                        <td className={`pbook__num${costed(row) && profit < 0 ? ' is-loss' : ''}`}>{costed(row) ? money(profit) : '—'}</td>
                        <td className="pbook__num">{money(row.paidMinor)}</td>
                        <td className={`pbook__num${row.pendingMinor > 0 ? ' is-owed' : ''}`}>{money(row.pendingMinor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {group.rows.length > 1 && (
                  <tfoot>
                    <tr>
                      <td className="pbook__item">Total</td>
                      <td className="pbook__num">{group.rows.reduce((sum, row) => sum + row.quantity, 0)}</td>
                      <td className="pbook__num">{money(group.totals.salesMinor)}</td>
                      {columns.map((column) => <td key={column.key} />)}
                      <td className="pbook__num">{money(group.totals.costMinor)}</td>
                      <td className="pbook__num">{money(group.totals.profitMinor)}</td>
                      <td className="pbook__num">{money(group.rows.reduce((sum, row) => sum + row.paidMinor, 0))}</td>
                      <td className="pbook__num">{money(group.totals.pendingMinor)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        );
      })}
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
