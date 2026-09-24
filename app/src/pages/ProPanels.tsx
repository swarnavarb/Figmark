import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { COST_STAGES, STAGE_LABELS, type CostStage } from '@shared/profit';
import {
  ApiRequestError, api, type CostsResponse, type DeepResponse, type InterestResponse, type ProfitRow,
  type SheetItem, type ValueLabel,
} from '../api';
import { formatDate, formatMoney, timeAgo } from '../format';
import { NudgeButton } from '../components/NudgeButton';
import { CostSheetField, type CostSheetDraft } from '../components/CostSheetField';
import { scrollToTopOf } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, PersonLink, Thumb, Tile } from '../components/ui';
import { STAGE_TONES, StageBar } from './ProfitCalculator';

/**
 * The deeper Insights (Pro) views: real profit from each item's own costs,
 * retention and customer value, price changes, the next-lot forecast, wishlist
 * reminders, what sells together, returns, and the weekly digest.
 */

const money = (minor: number) => formatMoney(minor, 'INR');

/* ── Real profit ─────────────────────────────────────────────────────────── */

type ProfitView = 'lots' | 'items' | 'customers' | 'costs';
type Status = 'active' | 'closed';

const PROFIT_TABS: { id: ProfitView; label: string; hint: Record<Status, string> }[] = [
  { id: 'lots', label: 'Per lot', hint: {
    active: 'Lots still open or on their way.',
    closed: 'Lots closed, or with everything delivered.' } },
  { id: 'items', label: 'Per item', hint: {
    active: 'Items still on sale.',
    closed: 'Items sold out, expired or taken down.' } },
  { id: 'customers', label: 'Per customer', hint: {
    active: 'Customers with something still on its way.',
    closed: 'Customers whose orders have all been delivered.' } },
  { id: 'costs', label: 'Item costs', hint: { active: '', closed: '' } },
];

export function RealProfit({ shop, data, reload }: { shop?: string; data: CostsResponse | null; reload: () => void }) {
  const [view, setView] = useState<ProfitView>('lots');
  const [status, setStatus] = useState<Status>('active');
  const [editing, setEditingState] = useState<SheetItem | null>(null);
  // The editor opens at its top, and closing it lands back on the row it was opened from.
  const listScroll = useRef<number | null>(null);
  const setEditing = (item: SheetItem | null) => {
    if (item) listScroll.current = window.scrollY;
    setEditingState(item);
  };
  useLayoutEffect(() => {
    if (editing) scrollToTopOf(document.querySelector('.insview__bar'));
    else if (listScroll.current !== null) {
      window.scrollTo(0, listScroll.current);
      listScroll.current = null;
    }
  }, [editing]);

  if (!data) return <p className="muted">Loading…</p>;
  if (editing) {
    return <SheetEditor item={editing} shop={shop} onDone={(changed) => { setEditing(null); if (changed) reload(); }} />;
  }

  const total = data.totals[status];
  const rows = view === 'costs' ? [] : data[view][status];
  const costed = data.sheets.filter((row) => row.sheet).length;
  const tab = PROFIT_TABS.find((entry) => entry.id === view)!;
  const sheetFor = (listingId: string) => data.sheets.find((row) => row.listingId === listingId);

  return (
    <div className="stack">
      <div className="inssegs" role="tablist" aria-label="Show profit">
        {PROFIT_TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={view === entry.id}
            className={`inscat${view === entry.id ? ' is-on' : ''}`} onClick={() => setView(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {view === 'costs' ? (
        <ItemCosts sheets={data.sheets} onEdit={setEditing} shop={shop} onChanged={reload} />
      ) : (
        <>
          <div className="inssegs" role="tablist" aria-label="Active or closed">
            {(['active', 'closed'] as const).map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={status === entry}
                className={`inscat${status === entry ? ' is-on' : ''}`} onClick={() => setStatus(entry)}>
                {entry === 'active' ? 'Active' : 'Closed'}
                <span className="inscat__n">{data[view][entry].length}</span>
              </button>
            ))}
          </div>
          <p className="faint">{tab.hint[status]}</p>
          <div className="tiles">
            <Tile value={money(total.revenueMinor)} label="Revenue" />
            <Tile value={money(total.costMinor)} label="Costs" tone="blue" />
            <Tile value={money(total.profitMinor)} label={total.marginPercent === null ? 'Profit' : `Profit · ${total.marginPercent}%`} tone="green" />
          </div>
          {costed < data.sheets.length && (
            <button type="button" className="insnote" onClick={() => setView('costs')}>
              🧾 {data.sheets.length - costed} item{data.sheets.length - costed === 1 ? ' has' : 's have'} no costs saved yet,
              so no profit is counted on them. Add costs ›
            </button>
          )}
          {rows.length === 0 ? (
            <p className="muted">Nothing {status === 'active' ? 'active' : 'closed'} yet.</p>
          ) : (
            rows.map((row) => (
              <ProfitCard key={row.key} row={row} view={view}
                onEdit={view === 'items' && sheetFor(row.key) ? () => setEditing(sheetFor(row.key)!) : undefined} />
            ))
          )}
        </>
      )}
    </div>
  );
}

function ProfitCard({ row, view, onEdit }: { row: ProfitRow; view: ProfitView; onEdit?: () => void }) {
  const [open, setOpen] = useState(false);
  const losing = row.profitMinor < 0;
  const title = view === 'customers'
    ? <PersonLink party={{ name: row.name, handle: row.sub }} className="inscard__title" />
    : view === 'items'
      ? <Link to={`/listing/${row.key}`} className="inscard__title">{row.name}</Link>
      : <Link to={`/lot/${row.key}`} className="inscard__title">{row.name}</Link>;
  const costedRevenue = row.costMinor + row.profitMinor;
  return (
    <article className={`inscard${losing ? ' inscard--loss' : ''}`}>
      <header className="inscard__head">
        {view === 'items' && <Thumb seed={row.key} label={row.name} photo={row.photo ? { url: row.photo } : null} className="thumb insthumb" />}
        <div>
          {title}
          <small>
            {row.units} unit{row.units === 1 ? '' : 's'} · {row.orders} order{row.orders === 1 ? '' : 's'}
            {view === 'items' && row.sub ? ` · ${row.sub}` : ''}{view === 'lots' && row.sub ? ` · ${row.sub}` : ''}
          </small>
        </div>
        <span className={`inscard__big${losing ? ' is-loss' : ''}`}>{money(row.profitMinor)}</span>
      </header>
      <div className="inscard__facts">
        <span>Revenue {money(row.revenueMinor)}</span>
        <span>Costs {money(row.costMinor)}</span>
        {row.marginPercent !== null && <span className={`badge badge--${losing ? 'danger' : 'ok'}`}>{row.marginPercent}% margin</span>}
        {row.uncostedUnits > 0 && <span className="badge badge--warn">{row.uncostedUnits} unit{row.uncostedUnits === 1 ? '' : 's'} not costed</span>}
      </div>
      {row.costMinor > 0 && (
        <StageBar stages={Object.fromEntries(COST_STAGES.map((stage) => [stage, row.stages[stage] / 100])) as Record<CostStage, number>}
          selling={costedRevenue / 100} profit={row.profitMinor / 100} />
      )}
      <div className="pc__actions">
        {row.steps.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide steps' : 'Cost steps'}
          </button>
        )}
        {onEdit && <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit}>✏️ Edit costs</button>}
      </div>
      {open && (
        <div className="stack" style={{ gap: 4 }}>
          {COST_STAGES.map((stage) => {
            const steps = row.steps.filter((step) => step.stage === stage);
            if (steps.length === 0) return null;
            return (
              <div key={stage} className="pc__stage">
                <div className="pc__stagehead">
                  <span className={`pc__dot pc__dot--${STAGE_TONES[stage]}`} />
                  <b>{STAGE_LABELS[stage]}</b>
                  <span>{money(row.stages[stage])}</span>
                </div>
                {steps.map((step) => (
                  <div key={`${step.stage}:${step.label}`} className="pc__line">
                    <span>{step.label}</span>
                    <span>{money(step.amountMinor)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

/** Every item, with what one unit cost and what that leaves at today's price. */
function ItemCosts({ sheets, onEdit, shop, onChanged }: {
  sheets: SheetItem[]; onEdit: (item: SheetItem) => void; shop?: string; onChanged: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'missing'>('missing');
  const [busy, setBusy] = useState<string | null>(null);
  // Asked on the button itself: a browser confirm box is silently blocked in
  // installed apps and some in-app browsers, which made Remove do nothing.
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  async function remove(row: SheetItem) {
    if (asking !== row.listingId) {
      setAsking(row.listingId);
      return;
    }
    setBusy(row.listingId);
    setFailed(null);
    try {
      // Steps back to the costs saved before these; clears them only when there were none.
      await api.restoreCostSheet(row.listingId, shop);
      setAsking(null);
      onChanged();
    } catch (err) {
      setFailed(err instanceof ApiRequestError ? err.message : 'Could not remove those costs.');
    } finally {
      setBusy(null);
    }
  }
  const shown = sheets.filter((row) => filter === 'all' || !row.sheet);
  return (
    <div className="stack">
      <p className="faint">
        What one unit of each item really cost, step by step. Fill it from a calculator, then change any step.
        Only the steps you keep are counted. Remove steps back to the costs saved before - nothing is lost.
      </p>
      <div className="inssegs" role="tablist" aria-label="Which items">
        <button type="button" role="tab" aria-selected={filter === 'missing'} className={`inscat${filter === 'missing' ? ' is-on' : ''}`}
          onClick={() => setFilter('missing')}>Not costed <span className="inscat__n">{sheets.filter((row) => !row.sheet).length}</span></button>
        <button type="button" role="tab" aria-selected={filter === 'all'} className={`inscat${filter === 'all' ? ' is-on' : ''}`}
          onClick={() => setFilter('all')}>All items <span className="inscat__n">{sheets.length}</span></button>
      </div>
      {failed && <ErrorNotice message={failed} />}
      {shown.length === 0 ? <p className="muted">Every item has its costs saved.</p> : (
        <ul className="insleads">
          {shown.map((row) => {
            const margin = row.sheet && row.priceMinor > 0 ? Math.round(((row.priceMinor - row.costMinor) / row.priceMinor) * 100) : null;
            return (
              <li key={row.listingId}>
                <span className="insleads__who">
                  <span>{row.title}</span>
                  <small>
                    {formatMoney(row.priceMinor, row.currency)}{row.lotName ? ` · ${row.lotName}` : ''}{row.sold ? ` · ${row.sold} sold` : ''}
                    {row.onSale ? '' : ' · closed'}
                  </small>
                </span>
                {row.sheet ? (
                  <span className="insleads__tags">
                    <span className="badge">{money(row.costMinor)} / unit</span>
                    {margin !== null && <span className={`badge badge--${margin < 0 ? 'danger' : 'ok'}`}>{margin}%</span>}
                  </span>
                ) : <span className="badge badge--warn">No costs</span>}
                <span className="insleads__tags">
                  <button type="button" className="btn btn--sm" onClick={() => onEdit(row)}>{row.sheet ? 'Edit' : 'Add costs'}</button>
                  {row.sheet && (
                    <button type="button" className={`btn btn--sm ${asking === row.listingId ? 'btn--danger' : 'btn--ghost'}`}
                      disabled={busy === row.listingId} onBlur={() => setAsking((now) => (now === row.listingId ? null : now))}
                      onClick={() => void remove(row)}>
                      {busy === row.listingId ? 'Removing…' : asking !== row.listingId ? 'Remove'
                        : row.previousCostMinor !== null ? `Back to ${money(row.previousCostMinor)}` : 'Tap to clear'}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One item's costs, in the same editor every other place costs are entered uses. */
function SheetEditor({ item, shop, onDone }: { item: SheetItem; shop?: string; onDone: (changed: boolean) => void }) {
  const [draft, setDraft] = useState<CostSheetDraft | null>(item.sheet
    ? { templateId: item.sheet.templateId, templateName: item.sheet.templateName, steps: item.sheet.steps }
    : null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await api.restoreCostSheet(item.listingId, shop);
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not remove those costs.');
      setBusy(false);
    }
  }

  async function save(sheet: CostSheetDraft | null) {
    setBusy(true);
    setError(null);
    try {
      await api.saveCostSheet(item.listingId, sheet, shop);
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save those costs.');
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} onClick={() => onDone(false)}>← Back</button>
      <section className="card card--pad stack">
        <h2>Costs for {item.title}</h2>
        <span className="field__hint">Per unit. Selling at {formatMoney(item.priceMinor, item.currency)}.</span>
        <CostSheetField value={draft} onChange={setDraft} sellingPriceMinor={item.priceMinor} shop={shop} collapsible={false} />
        {error && <ErrorNotice message={error} />}
        <div className="pc__actions">
          {draft ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void save(draft)}>Save costs</button>
          ) : item.sheet ? (
            // Every step taken out: saving now clears the item's costs.
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void save(null)}>Save - no costs</button>
          ) : null}
          {item.sheet && draft && (
            <button type="button" className={`btn btn--sm ${asking ? 'btn--danger' : 'btn--ghost'}`} disabled={busy}
              onBlur={() => setAsking(false)}
              onClick={() => { if (asking) void restore(); else setAsking(true); }}>
              {!asking ? 'Remove costs' : item.previousCostMinor !== null ? `Back to ${formatMoney(item.previousCostMinor)}` : 'Tap to clear'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/* ── Retention and value ─────────────────────────────────────────────────── */

const VALUE_TABS: { id: ValueLabel; label: string; hint: string }[] = [
  { id: 'vip', label: '👑 VIP', hint: 'Your top tenth by spend, still ordering.' },
  { id: 'regular', label: '🔁 Regular', hint: 'Order more than once, on their usual rhythm.' },
  { id: 'at_risk', label: '⚠️ At risk', hint: 'Regulars who have gone well past their usual gap.' },
  { id: 'one_time', label: '1️⃣ One-time', hint: 'One order, more than 30 days ago.' },
  { id: 'new', label: '🌱 New', hint: 'First order in the last 30 days.' },
];

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export function Loyalty({ deep }: { deep: DeepResponse }) {
  const [tab, setTab] = useState<ValueLabel>('vip');
  const { cohorts, value } = deep;
  if (cohorts.length === 0) {
    return <EmptyState icon="🔁" title="No customers yet">Once people order, you will see who comes back here.</EmptyState>;
  }
  const rows = value.rows.filter((row) => row.label === tab);
  const entry = VALUE_TABS.find((row) => row.id === tab)!;
  return (
    <div className="stack">
      <section className="card card--pad stack">
        <div>
          <h2>Who comes back</h2>
          <span className="field__hint">Of the people who first ordered in each month, the share who ordered again 1, 2 and 3 months later.</span>
        </div>
        <div className="coh__table" role="table">
          <div className="coh__tr coh__tr--head" role="row">
            <span role="columnheader">First order</span><span role="columnheader">People</span>
            <span role="columnheader">+1 mo</span><span role="columnheader">+2 mo</span><span role="columnheader">+3 mo</span>
          </div>
          {cohorts.map((row) => (
            <div key={row.month} className="coh__tr" role="row">
              <span role="cell">{monthName(row.month)}</span>
              <span role="cell">{row.size}</span>
              {row.back.map((share, at) => (
                <span key={at} role="cell" className="coh__cell"
                  style={share === null ? undefined : { background: `rgba(52, 211, 153, ${0.08 + (share / 100) * 0.6})` }}>
                  {share === null ? '·' : `${share}%`}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card card--pad stack">
        <div>
          <h2>What each customer is worth</h2>
          <span className="field__hint">Average lifetime spend {money(value.averageMinor)}.</span>
        </div>
        <div className="inssegs" role="tablist" aria-label="Customer value">
          {VALUE_TABS.map((row) => (
            <button key={row.id} type="button" role="tab" aria-selected={tab === row.id}
              className={`inscat${tab === row.id ? ' is-on' : ''}`} onClick={() => setTab(row.id)}>
              {row.label} <span className="inscat__n">{value.counts[row.id]}</span>
            </button>
          ))}
        </div>
        <p className="faint">{entry.hint}</p>
        {rows.length === 0 ? <p className="muted">Nobody here.</p> : (
          <ul className="insleads">
            {rows.map((row) => (
              <li key={row.who.handle ?? row.who.name}>
                <span className="insleads__who">
                  <PersonLink party={row.who} />
                  <small>{row.orders} order{row.orders === 1 ? '' : 's'} · last {timeAgo(row.lastAt)}</small>
                </span>
                <b className="inscollect">{money(row.spentMinor)}</b>
                {row.who.handle && <Link to={`/messages/${encodeURIComponent(row.who.handle)}`} className="btn btn--sm insmsg">💬 Message</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Price changes ───────────────────────────────────────────────────────── */

export function Pricing({ deep }: { deep: DeepResponse }) {
  if (deep.pricing.length === 0) {
    return (
      <EmptyState icon="🏷️" title="No price changes yet">
        When you change an item's price, you will see how saves and sales moved at each price here.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      <p className="faint">Each price an item has had, and how it sold while it was at that price.</p>
      {deep.pricing.map((item) => {
        const best = Math.max(...item.periods.map((period) => period.perWeek));
        return (
          <article key={item.listingId} className="inscard">
            <header className="inscard__head">
              <Thumb seed={item.listingId} label={item.title} photo={item.photo ? { url: item.photo } : null} className="thumb insthumb" />
              <div><Link to={`/listing/${item.listingId}`} className="inscard__title">{item.title}</Link></div>
            </header>
            <div className="insprices">
              {item.periods.map((period, at) => {
                const previous = item.periods[at - 1];
                const move = previous ? (period.priceMinor > previous.priceMinor ? '▲' : '▼') : '';
                return (
                  <div key={period.from} className={`insprices__row${best > 0 && period.perWeek === best ? ' is-best' : ''}`}>
                    <b>{move} {formatMoney(period.priceMinor, item.currency)}</b>
                    <small>from {formatDate(period.from)} · {period.days}d</small>
                    <span>❤️ {period.saves}</span>
                    <span>🛒 {period.units}</span>
                    <span className="badge">{period.perWeek}/wk</span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ── Forecast ────────────────────────────────────────────────────────────── */

export function Forecast({ deep }: { deep: DeepResponse }) {
  const { rows, cycleDays, conversionPercent } = deep.forecast;
  if (rows.length === 0) {
    return <EmptyState icon="🔮" title="Not enough to go on yet">Once items sell or get saved, a suggested quantity for the next lot shows here.</EmptyState>;
  }
  return (
    <div className="stack">
      <p className="faint">
        How many to bring in the next lot: the last 4 weeks' sales carried over your usual {cycleDays}-day gap between lots,
        plus {conversionPercent}% of the people who saved it and have not bought (your save-to-order rate), plus pledges.
      </p>
      <ul className="insleads">
        {rows.map((row) => (
          <li key={row.listingId}>
            <span className="insleads__who">
              <Link to={`/listing/${row.listingId}`}>{row.title}</Link>
              <small>
                {row.perWeek}/wk · {row.waiting} waiting{row.pledged ? ` · ${row.pledged} pledged` : ''}
                {row.inStock !== null ? ` · ${row.inStock} in stock` : ''}
              </small>
            </span>
            <b className="inscollect">≈ {row.next}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Wishlist reminders ──────────────────────────────────────────────────── */

export function Reminders({ deep, shop }: { deep: DeepResponse; shop?: string }) {
  if (deep.reminders.length === 0) {
    return (
      <EmptyState icon="🔔" title="Nobody to remind">
        People who saved an item that has since come back in stock or dropped in price show up here.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      <p className="faint">Saved it, never bought it - and it is back, or cheaper now. One reminder a day at most.</p>
      <ul className="insleads">
        {deep.reminders.map((row) => (
          <li key={`${row.buyerId}:${row.listingId}`}>
            <span className="insleads__who">
              <PersonLink party={row.who} />
              <small>
                <Link to={`/listing/${row.listingId}`}>{row.title}</Link> · saved {timeAgo(row.savedAt)}
              </small>
            </span>
            <span className="insleads__tags">
              {row.reason === 'cheaper' ? (
                <span className="badge badge--ok">{formatMoney(row.wasMinor, row.currency)} → {formatMoney(row.nowMinor, row.currency)}</span>
              ) : <span className="badge badge--aqua">Back in stock</span>}
            </span>
            <NudgeButton request={{ kind: 'saved', listingId: row.listingId, buyerId: row.buyerId }} shop={shop} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Bought together ─────────────────────────────────────────────────────── */

export function Bundles({ deep }: { deep: DeepResponse }) {
  if (deep.bundles.length === 0) {
    return <EmptyState icon="🧺" title="No pairs yet">Items two or more people bought within a week of each other show up here.</EmptyState>;
  }
  return (
    <div className="stack">
      <p className="faint">Bought by the same person within a week. Worth offering as a set, or listing side by side.</p>
      {deep.bundles.map((pair) => (
        <article key={pair.items.map((item) => item.listingId).join('|')} className="inscard insbundle">
          {pair.items.map((item, at) => (
            <span key={item.listingId} className="insbundle__item">
              {at > 0 && <b className="insbundle__plus" aria-hidden="true">+</b>}
              <Thumb seed={item.listingId} label={item.title} photo={item.photo ? { url: item.photo } : null} className="thumb insthumb" />
              <Link to={`/listing/${item.listingId}`}>{item.title}</Link>
            </span>
          ))}
          <span className="badge badge--accent">{pair.count} people</span>
        </article>
      ))}
    </div>
  );
}

/* ── Returns and cancellations ───────────────────────────────────────────── */

export function Returns({ deep }: { deep: DeepResponse }) {
  const { overall, items, categories } = deep.returns;
  if (overall.orders === 0) {
    return <EmptyState icon="↩️" title="No orders yet">Cancellations and disputes by item show up here.</EmptyState>;
  }
  return (
    <div className="stack">
      <div className="tiles">
        <Tile value={`${overall.ratePercent}%`} label="Problem rate" />
        <Tile value={String(overall.cancelled)} label="Cancelled or refunded" tone="blue" />
        <Tile value={String(overall.disputed)} label="Disputed" tone="green" />
      </div>
      <section className="card card--pad stack">
        <h2>By category</h2>
        {categories.map((row) => (
          <div key={row.category} className="insbar">
            <span>{row.category}</span>
            <span className="insbar__track">
              <span className={`insbar__fill insbar__fill--${row.ratePercent >= 20 ? 'warn' : 'violet'}`} style={{ width: `${Math.max(row.ratePercent ? 3 : 0, row.ratePercent)}%` }} />
            </span>
            <b>{row.ratePercent}%</b>
          </div>
        ))}
      </section>
      <section className="card card--pad stack">
        <div>
          <h2>Items with problems</h2>
          <span className="field__hint">A high rate usually means the photos or description promise something the item is not.</span>
        </div>
        {items.length === 0 ? <p className="muted">No item has been cancelled or disputed.</p> : (
          <ul className="insleads">
            {items.map((row) => (
              <li key={row.listingId}>
                <span className="insleads__who">
                  <Link to={`/listing/${row.listingId}`}>{row.title}</Link>
                  <small>{row.orders} orders · {row.cancelled} cancelled · {row.disputed} disputed</small>
                </span>
                <span className={`badge badge--${row.ratePercent >= 20 ? 'danger' : 'warn'}`}>{row.ratePercent}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Weekly digest ───────────────────────────────────────────────────────── */

/** Monday of this week, for the digest's heading. */
function weekStart(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

/**
 * The week in one card: what went well, what needs watching, and the three
 * things most worth doing - so a shop that opens Insights once a week still
 * catches what matters.
 */
export function Digest({ data, deep, costs }: { data: InterestResponse; deep: DeepResponse | null; costs: CostsResponse | null }) {
  const { week } = data;
  const wins: string[] = [];
  const risks: string[] = [];
  const actions: string[] = [];

  if (week.now.revenueMinor > week.before.revenueMinor) {
    wins.push(`Orders worth ${money(week.now.revenueMinor)}, up from ${money(week.before.revenueMinor)}`);
  } else if (week.now.revenueMinor < week.before.revenueMinor) {
    risks.push(`Orders worth ${money(week.now.revenueMinor)}, down from ${money(week.before.revenueMinor)}`);
  }
  const top = data.trending[0];
  if (top) wins.push(`${top.title} is your hottest item`);
  if (data.customers.newcomers > 0) wins.push(`${data.customers.newcomers} new customer${data.customers.newcomers === 1 ? '' : 's'} this month`);
  const profit = costs ? costs.totals.active.profitMinor + costs.totals.closed.profitMinor : 0;
  if (profit > 0) wins.push(`${money(profit)} profit on costed items so far`);

  const soldOut = data.trending.filter((row) => row.soldOut).length;
  if (soldOut) risks.push(`${soldOut} wanted item${soldOut === 1 ? ' is' : 's are'} sold out`);
  const atRisk = deep?.value.counts.at_risk ?? 0;
  if (atRisk) risks.push(`${atRisk} regular${atRisk === 1 ? ' is' : 's are'} overdue for an order`);
  const badReturns = deep?.returns.items.filter((row) => row.ratePercent >= 20).length ?? 0;
  if (badReturns) risks.push(`${badReturns} item${badReturns === 1 ? ' has' : 's have'} a high cancel rate`);

  if (data.summary.stalled) actions.push(`Nudge ${data.summary.stalled} ${data.summary.stalled === 1 ? 'person' : 'people'} who stopped at Buy`);
  if (deep?.reminders.length) actions.push(`Remind ${deep.reminders.length} who saved something now back or cheaper`);
  const nextBuy = deep?.forecast.rows[0];
  if (nextBuy) actions.push(`Plan about ${nextBuy.next} of ${nextBuy.title} for the next lot`);
  const uncosted = costs?.sheets.filter((row) => !row.sheet && row.sold > 0).length ?? 0;
  if (uncosted) actions.push(`Add costs to ${uncosted} item${uncosted === 1 ? '' : 's'} that sold, to see real profit`);

  const monday = weekStart();
  return (
    <section className="card card--pad stack insdigest">
      <div>
        <h2>🗞️ Weekly digest</h2>
        <span className="field__hint">Week of {monday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · last 7 days against the 7 before</span>
      </div>
      <div className="insdigest__cols">
        <div>
          <b className="insdigest__head insdigest__head--ok">Wins</b>
          {wins.length ? <ul>{wins.slice(0, 3).map((line) => <li key={line}>{line}</li>)}</ul> : <p className="faint">A quiet week.</p>}
        </div>
        <div>
          <b className="insdigest__head insdigest__head--warn">Watch</b>
          {risks.length ? <ul>{risks.slice(0, 3).map((line) => <li key={line}>{line}</li>)}</ul> : <p className="faint">Nothing worrying.</p>}
        </div>
        <div>
          <b className="insdigest__head insdigest__head--violet">Do next</b>
          {actions.length ? <ol>{actions.slice(0, 3).map((line) => <li key={line}>{line}</li>)}</ol> : <p className="faint">All caught up.</p>}
        </div>
      </div>
    </section>
  );
}
