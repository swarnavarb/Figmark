import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COST_STAGES, STAGE_LABELS, calculateProfit, stepsFromResult,
  type CostStage, type CostStep, type ProfitTemplate,
} from '@shared/profit';
import {
  ApiRequestError, api, type CostsResponse, type DeepResponse, type InterestResponse, type ProfitRow,
  type SheetItem, type ValueLabel,
} from '../api';
import { formatDate, formatMoney, timeAgo } from '../format';
import { NudgeButton } from '../components/NudgeButton';
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
  { id: 'lots', label: '🚚 Per lot', hint: {
    active: 'Lots still open or on their way.',
    closed: 'Lots closed, or with everything delivered.' } },
  { id: 'items', label: '🏷️ Per item', hint: {
    active: 'Items still on sale.',
    closed: 'Items sold out, expired or taken down.' } },
  { id: 'customers', label: '👥 Per customer', hint: {
    active: 'Customers with something still on its way.',
    closed: 'Customers whose orders have all been delivered.' } },
  { id: 'costs', label: '🧾 Item costs', hint: { active: '', closed: '' } },
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
        <ItemCosts sheets={data.sheets} onEdit={setEditing} />
      ) : (
        <>
          <div className="inssegs" role="tablist" aria-label="Active or closed">
            {(['active', 'closed'] as const).map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={status === entry}
                className={`inscat${status === entry ? ' is-on' : ''}`} onClick={() => setStatus(entry)}>
                {entry === 'active' ? '🟢 Active' : '✅ Closed'}
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
function ItemCosts({ sheets, onEdit }: { sheets: SheetItem[]; onEdit: (item: SheetItem) => void }) {
  const [filter, setFilter] = useState<'all' | 'missing'>('missing');
  const shown = sheets.filter((row) => filter === 'all' || !row.sheet);
  return (
    <div className="stack">
      <p className="faint">
        What one unit of each item really cost, step by step. Fill it from a calculator, then change any step.
        Only the steps you keep are counted.
      </p>
      <div className="inssegs" role="tablist" aria-label="Which items">
        <button type="button" role="tab" aria-selected={filter === 'missing'} className={`inscat${filter === 'missing' ? ' is-on' : ''}`}
          onClick={() => setFilter('missing')}>Not costed <span className="inscat__n">{sheets.filter((row) => !row.sheet).length}</span></button>
        <button type="button" role="tab" aria-selected={filter === 'all'} className={`inscat${filter === 'all' ? ' is-on' : ''}`}
          onClick={() => setFilter('all')}>All items <span className="inscat__n">{sheets.length}</span></button>
      </div>
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
                <button type="button" className="btn btn--sm" onClick={() => onEdit(row)}>{row.sheet ? 'Edit' : 'Add costs'}</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

let stepCounter = 0;
const newStepId = () => `own_${Date.now().toString(36)}_${(stepCounter += 1)}`;

/**
 * One item's costs, step by step. Filled from a calculator (only the lines
 * switched on there come across) and then every step can be changed, removed,
 * or added to.
 */
function SheetEditor({ item, shop, onDone }: { item: SheetItem; shop?: string; onDone: (changed: boolean) => void }) {
  const [steps, setSteps] = useState<CostStep[]>(item.sheet?.steps ?? []);
  const [source, setSource] = useState<{ id: string | null; name: string | null }>({
    id: item.sheet?.templateId ?? null, name: item.sheet?.templateName ?? null,
  });
  const [templates, setTemplates] = useState<ProfitTemplate[]>([]);
  const [pick, setPick] = useState('');
  const [abroad, setAbroad] = useState(0);
  const [weight, setWeight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.profitTemplates(shop).then((result) => {
      setTemplates(result.templates);
      const first = result.templates.find((entry) => entry.id === item.sheet?.templateId)
        ?? result.templates.find((entry) => entry.isDefault) ?? result.templates[0];
      if (first) setPick(first.id);
    }).catch(() => setTemplates([]));
  }, [shop, item.sheet?.templateId]);

  const template = templates.find((entry) => entry.id === pick);
  const total = steps.reduce((sum, step) => sum + step.amountMinor, 0);
  const profit = item.priceMinor - total;

  function fill() {
    if (!template) return;
    const result = calculateProfit(template, { itemPrice: abroad, quantity: 1, weightKg: weight, sellingPrice: item.priceMinor / 100 });
    setSteps(stepsFromResult(result));
    setSource({ id: template.id, name: template.name });
  }
  const change = (at: number, patch: Partial<CostStep>) =>
    setSteps((current) => current.map((step, index) => (index === at ? { ...step, ...patch } : step)));

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    try {
      await api.saveCostSheet(item.listingId, clear ? null : { templateId: source.id, templateName: source.name, steps }, shop);
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save those costs.');
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button type="button" className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => onDone(false)}>← Back</button>
      <section className="card card--pad stack">
        <h2>Costs for {item.title}</h2>
        <span className="field__hint">Per unit. Selling at {formatMoney(item.priceMinor, item.currency)}.</span>
        {templates.length > 0 ? (
          <div className="stack pc__fill">
            <b>Fill from a calculator</b>
            <div className="pc__fields">
              <label className="field">
                <span>Calculator</span>
                <select value={pick} onChange={(e) => setPick(e.target.value)}>
                  {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Price abroad ({template?.currency ?? ''})</span>
                <input type="number" inputMode="decimal" min={0} value={abroad || ''} placeholder="0"
                  onChange={(e) => setAbroad(Number(e.target.value) || 0)} />
              </label>
              <label className="field">
                <span>Weight per item (kg)</span>
                <input type="number" inputMode="decimal" min={0} step={0.01} value={weight || ''} placeholder="0"
                  onChange={(e) => setWeight(Number(e.target.value) || 0)} />
              </label>
            </div>
            <button type="button" className="btn btn--sm" disabled={!template} onClick={fill}>
              {steps.length ? 'Refill the steps' : 'Fill the steps'}
            </button>
          </div>
        ) : (
          <p className="faint">
            No calculators yet. <Link to="/shop?tab=calculator">Set one up</Link>, or type the steps in below.
          </p>
        )}
      </section>

      <section className="card card--pad stack">
        <h2>Steps</h2>
        {source.name && <span className="field__hint">From “{source.name}”. Change any amount - it is this item's own copy.</span>}
        {steps.length === 0 && <p className="muted">No steps yet.</p>}
        {steps.map((step, at) => (
          <div key={step.id} className="pc__steprow">
            <span className={`pc__dot pc__dot--${STAGE_TONES[step.stage]}`} />
            <input aria-label="Step" value={step.label} onChange={(e) => change(at, { label: e.target.value })} />
            <select aria-label="Stage" value={step.stage} onChange={(e) => change(at, { stage: e.target.value as CostStage })}>
              {COST_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
            </select>
            <label className="pc__stepamt">
              <span>₹</span>
              <input type="number" inputMode="decimal" min={0} step={0.01} aria-label="Amount per unit"
                value={step.amountMinor ? step.amountMinor / 100 : ''} placeholder="0"
                onChange={(e) => change(at, { amountMinor: Math.round((Number(e.target.value) || 0) * 100) })} />
            </label>
            <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove ${step.label}`}
              onClick={() => setSteps((current) => current.filter((_, index) => index !== at))}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }}
          onClick={() => setSteps((current) => [...current, { id: newStepId(), label: 'Other cost', stage: 'selling', amountMinor: 0 }])}>
          ＋ Add a step
        </button>
        <div className="pc__line pc__line--total"><span>Cost per unit</span><span>{money(total)}</span></div>
        <div className={`pc__line pc__line--total${profit < 0 ? ' is-loss' : ''}`}>
          <span>Profit per unit at {formatMoney(item.priceMinor, item.currency)}</span>
          <span>{money(profit)}{item.priceMinor > 0 ? ` · ${Math.round((profit / item.priceMinor) * 100)}%` : ''}</span>
        </div>
        {error && <ErrorNotice message={error} />}
        <div className="pc__actions pc__actions--sticky">
          <button type="button" className="btn" disabled={busy || steps.length === 0} onClick={() => void save()}>Save costs</button>
          {item.sheet && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
              onClick={() => { if (window.confirm('Clear the costs for this item?')) void save(true); }}>Clear costs</button>
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
