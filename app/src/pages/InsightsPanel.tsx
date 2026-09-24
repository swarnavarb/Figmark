import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { StoreAccess } from '@shared/stores';
import { PHASE_LABELS, SEGMENTS, SEGMENT_LABELS } from '@shared/insights';
import {
  ApiRequestError, api, type CostsResponse, type CustomerRow, type DeepResponse, type InsightsResponse, type InterestResponse, type MarketResponse,
  type PartyRef, type TrendingRow,
} from '../api';
import { formatDate, formatMoney, timeAgo } from '../format';
import { EmptyState, ErrorNotice, PersonLink, Thumb, Tile } from '../components/ui';
import { NudgeButton } from '../components/NudgeButton';
import { scrollToTopOf, useBack } from '../components/ScrollManager';
import { Bundles, Digest, Forecast, Loyalty, Pricing, RealProfit, Reminders, Returns } from './ProPanels';

/**
 * Insights (Pro): who wants what, before and after they buy.
 *
 * Analytics (free) says how the shop is doing and what is owed. This is the
 * layer underneath - who saved an item, who pressed Buy and stopped, how each
 * item turns a look into a payment, what is heating up, which customers keep
 * coming back or have gone quiet, and what the lots and packing need - so a
 * shop can act on interest instead of waiting for it.
 */

type Category =
  | 'saved' | 'checkout' | 'funnel' | 'trending' | 'market' | 'customers' | 'leads' | 'packing' | 'lots' | 'timing'
  | 'profit' | 'loyalty' | 'pricing' | 'forecast' | 'reminders' | 'bundles' | 'returns';

const CATEGORIES: { id: Category; icon: string; label: string; tone: string }[] = [
  { id: 'profit', icon: '💰', label: 'Real profit', tone: 'gold' },
  { id: 'trending', icon: '🔥', label: 'Trending', tone: 'hot' },
  { id: 'market', icon: '🌐', label: 'Market trends', tone: 'aqua' },
  { id: 'saved', icon: '❤️', label: 'Saved', tone: 'pink' },
  { id: 'checkout', icon: '🛒', label: 'Stopped at Buy', tone: 'warn' },
  { id: 'funnel', icon: '📈', label: 'Funnel', tone: 'violet' },
  { id: 'customers', icon: '👥', label: 'Customers', tone: 'ok' },
  { id: 'leads', icon: '💬', label: 'Worth a message', tone: 'aqua' },
  { id: 'packing', icon: '📦', label: 'Packing', tone: 'warn' },
  { id: 'lots', icon: '🚚', label: 'Lots', tone: 'violet' },
  { id: 'timing', icon: '⏰', label: 'Best time to post', tone: 'pink' },
  { id: 'loyalty', icon: '🔁', label: 'Retention & value', tone: 'ok' },
  { id: 'forecast', icon: '🔮', label: 'Next lot forecast', tone: 'violet' },
  { id: 'reminders', icon: '🔔', label: 'Wishlist reminders', tone: 'pink' },
  { id: 'pricing', icon: '🏷️', label: 'Price changes', tone: 'aqua' },
  { id: 'bundles', icon: '🧺', label: 'Bought together', tone: 'ok' },
  { id: 'returns', icon: '↩️', label: 'Returns', tone: 'warn' },
];

const DEEP_VIEWS: Category[] = ['loyalty', 'pricing', 'forecast', 'reminders', 'bundles', 'returns'];

const HOUR = (hour: number) => `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;

export function InsightsPanel({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<InterestResponse | null>(null);
  const [lots, setLots] = useState<InsightsResponse | null>(null);
  const [deep, setDeep] = useState<DeepResponse | null>(null);
  const [costs, setCosts] = useState<CostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const shop = store.isOwner ? undefined : store.ownerId;

  // The open category lives in the address, so the phone's back button
  // returns to the dashboard and a category can be linked to.
  const requested = params.get('view') as Category | null;
  const view = CATEGORIES.some((entry) => entry.id === requested) ? requested : null;
  const open = (next: Category | null) => {
    setParams((current) => {
      const copy = new URLSearchParams(current);
      if (next) copy.set('view', next);
      else copy.delete('view');
      return copy;
    });
    // A category opens with its "← Insights" bar at the top of the screen;
    // coming back is the history's job, so the dashboard reappears exactly
    // where it was left.
    jumpToBar.current = Boolean(next);
  };
  const barRef = useRef<HTMLDivElement>(null);
  const jumpToBar = useRef(false);
  useLayoutEffect(() => {
    if (!view || !jumpToBar.current || !barRef.current) return;
    jumpToBar.current = false;
    scrollToTopOf(barRef.current);
  }, [view, data]);
  const dashboard = new URLSearchParams(params);
  dashboard.delete('view');
  const back = useBack(`${pathname}${dashboard.toString() ? `?${dashboard}` : ''}`);

  useEffect(() => {
    void api.interest(shop)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load insights.'));
    // The lot figures are a second read; a shop without lots still gets the rest.
    void api.insights(shop).then(setLots).catch(() => setLots(null));
    void api.deep(shop).then(setDeep).catch(() => setDeep(null));
    void api.costs(shop).then(setCosts).catch(() => setCosts(null));
  }, [shop]);
  const reloadCosts = () => void api.costs(shop).then(setCosts).catch(() => undefined);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  if (view) {
    const entry = CATEGORIES.find((row) => row.id === view)!;
    return (
      <div className="stack ins insview royal">
        <div className="insview__bar" ref={barRef}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={back}>← Insights</button>
          <h2 className="insview__title"><span aria-hidden="true">{entry.icon}</span> {entry.label} <span className="probadge">PRO</span></h2>
        </div>
        {view === 'saved' && <Saved data={data} />}
        {view === 'checkout' && <Checkout data={data} shop={shop} />}
        {view === 'funnel' && <Funnel data={data} />}
        {view === 'trending' && <Trending data={data} />}
        {view === 'market' && <Market shop={shop} />}
        {view === 'customers' && <Customers data={data} lots={lots} />}
        {view === 'leads' && <Leads data={data} />}
        {view === 'packing' && <Packing data={lots} />}
        {view === 'lots' && <Lots data={lots} />}
        {view === 'timing' && <Timing data={data} />}
        {view === 'profit' && <RealProfit shop={shop} data={costs} reload={reloadCosts} />}
        {DEEP_VIEWS.includes(view) && !deep && <p className="muted">Loading…</p>}
        {deep && view === 'loyalty' && <Loyalty deep={deep} />}
        {deep && view === 'pricing' && <Pricing deep={deep} />}
        {deep && view === 'forecast' && <Forecast deep={deep} />}
        {deep && view === 'reminders' && <Reminders deep={deep} shop={shop} />}
        {deep && view === 'bundles' && <Bundles deep={deep} />}
        {deep && view === 'returns' && <Returns deep={deep} />}
      </div>
    );
  }

  return <Dashboard data={data} lots={lots} deep={deep} costs={costs} open={open} />;
}

/** A week's change as an arrow and a percentage. */
function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0 && now === 0) return <small className="insdelta">—</small>;
  if (before === 0) return <small className="insdelta insdelta--up">▲ new</small>;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <small className="insdelta">■ same</small>;
  return <small className={`insdelta insdelta--${change > 0 ? 'up' : 'down'}`}>{change > 0 ? '▲' : '▼'} {Math.abs(change)}%</small>;
}

/** Fourteen tiny bars, oldest first, the last seven lit. */
function Spark({ values, tone = 'violet' }: { values: number[]; tone?: string }) {
  const peak = Math.max(1, ...values);
  return (
    <span className="insspark" aria-hidden="true">
      {values.map((value, at) => (
        <span key={at} className={`insspark__bar insspark__bar--${tone}${at >= values.length - 7 ? ' is-now' : ''}`}
          style={{ height: `${Math.max(8, Math.round((value / peak) * 100))}%` }} />
      ))}
    </span>
  );
}

/**
 * The landing page: how this week compares, what needs doing, and a card per
 * category with the one thing worth knowing from it. Everything deeper is a
 * tap away rather than stacked on one long page.
 */
function Dashboard({ data, lots, deep, costs, open }: {
  data: InterestResponse; lots: InsightsResponse | null; deep: DeepResponse | null; costs: CostsResponse | null;
  open: (next: Category) => void;
}) {
  const { summary, customers, week, daily } = data;
  const series = (key: 'saves' | 'buys' | 'orders') => daily.map((day) => day[key]);
  const wentAhead = (figures: { buys: number; orders: number }) =>
    figures.buys ? Math.round((figures.orders / figures.buys) * 100) : 0;

  const hours = Array.from({ length: 24 }, () => 0);
  for (const at of data.activity) {
    const date = new Date(at);
    if (!Number.isNaN(date.getTime())) hours[date.getHours()]! += 1;
  }
  const peakHour = data.activity.length ? hours.indexOf(Math.max(...hours)) : null;

  const soldOut = data.trending.filter((row) => row.soldOut);
  const runningLow = data.trending.filter((row) => row.daysLeft !== null && row.daysLeft <= 7);
  const boxes = lots ? lots.boxes.small + lots.boxes.medium + lots.boxes.large : 0;
  const hottest = data.trending[0];

  const todo: { key: string; icon: string; text: string; go: Category; tone: string }[] = [];
  if (summary.stalled > 0) todo.push({ key: 'cart', icon: '🛒', go: 'checkout', tone: 'warn',
    text: `${summary.stalled} stopped at Buy · ${formatMoney(summary.stalledMinor, 'INR')} not yet ordered` });
  if (soldOut.length > 0) todo.push({ key: 'gone', icon: '🔥', go: 'trending', tone: 'hot',
    text: `${soldOut.length} wanted item${soldOut.length === 1 ? ' is' : 's are'} sold out — restock or relist` });
  if (runningLow.length > 0) todo.push({ key: 'low', icon: '⚡', go: 'trending', tone: 'warn',
    text: `${runningLow.length} item${runningLow.length === 1 ? '' : 's'} will sell out within a week` });
  if (data.expiring.length > 0) todo.push({ key: 'ending', icon: '⏳', go: 'trending', tone: 'pink',
    text: `${data.expiring.length} wanted item${data.expiring.length === 1 ? '' : 's'} ending in 3 days` });
  if (customers.dormant > 0) todo.push({ key: 'quiet', icon: '💤', go: 'customers', tone: 'ok',
    text: `${customers.dormant} customer${customers.dormant === 1 ? ' has' : 's have'} gone quiet — say hello` });
  if (boxes > 0) todo.push({ key: 'boxes', icon: '📦', go: 'packing', tone: 'violet',
    text: `${boxes} box${boxes === 1 ? '' : 'es'} to pack across your lots` });
  if (data.overlooked.length > 0) todo.push({ key: 'looks', icon: '👀', go: 'trending', tone: 'aqua',
    text: `${data.overlooked.length} item${data.overlooked.length === 1 ? ' gets' : 's get'} looks but no takers` });

  const preview: Record<Category, { big: string; line: string }> = {
    trending: hottest
      ? { big: `#1`, line: hottest.title }
      : { big: '—', line: 'Nothing heating up yet' },
    market: { big: '🌐', line: 'What sells in your categories elsewhere' },
    saved: { big: String(summary.saves), line: data.saved[0] ? `Most saved: ${data.saved[0].title}` : 'No saves yet' },
    checkout: { big: String(summary.stalled), line: summary.stalled ? `${formatMoney(summary.stalledMinor, 'INR')} waiting` : 'Nobody stuck' },
    funnel: { big: summary.placedPercent === null ? '—' : `${summary.placedPercent}%`, line: 'of Buy presses became orders' },
    customers: { big: String(customers.total), line: customers.repeatPercent === null ? 'No customers yet' : `${customers.repeatPercent}% come back` },
    leads: { big: String(data.leads.length), line: 'interested, never ordered' },
    packing: { big: String(boxes), line: lots && lots.boxes.openLots ? `boxes across ${lots.boxes.openLots} lot${lots.boxes.openLots === 1 ? '' : 's'}` : 'Nothing to pack' },
    lots: { big: String(lots?.headline.openLots ?? 0), line: lots ? `${formatMoney(lots.headline.valueInFlightMinor)} moving` : 'No lots yet' },
    timing: { big: peakHour === null ? '—' : HOUR(peakHour), line: 'your busiest hour' },
    profit: costs
      ? { big: formatMoney(costs.totals.active.profitMinor + costs.totals.closed.profitMinor, 'INR'),
        line: `per lot, item and customer · ${costs.sheets.filter((row) => row.sheet).length}/${costs.sheets.length} items costed` }
      : { big: '₹', line: 'per lot, item and customer' },
    loyalty: deep
      ? { big: String(deep.value.counts.vip), line: `VIPs · ${deep.value.counts.at_risk} at risk` }
      : { big: '—', line: 'who comes back, and what they are worth' },
    forecast: deep?.forecast.rows[0]
      ? { big: `≈${deep.forecast.rows[0].next}`, line: deep.forecast.rows[0].title }
      : { big: '—', line: 'how many to bring next time' },
    reminders: { big: String(deep?.reminders.length ?? 0), line: 'saved items now back or cheaper' },
    pricing: { big: String(deep?.pricing.length ?? 0), line: 'items repriced, and what it did' },
    bundles: deep?.bundles[0]
      ? { big: String(deep.bundles.length), line: `${deep.bundles[0].items.map((item) => item.title).join(' + ')}` }
      : { big: '0', line: 'items bought together' },
    returns: deep
      ? { big: `${deep.returns.overall.ratePercent}%`, line: 'of orders cancelled or disputed' }
      : { big: '—', line: 'cancellations and disputes' },
  };
  const reminders = deep?.reminders.length ?? 0;
  if (reminders > 0) todo.push({ key: 'remind', icon: '🔔', go: 'reminders', tone: 'pink',
    text: `${reminders} saved item${reminders === 1 ? ' is' : 's are'} back or cheaper — remind the people who saved them` });
  const atRisk = deep?.value.counts.at_risk ?? 0;
  if (atRisk > 0) todo.push({ key: 'risk', icon: '⚠️', go: 'loyalty', tone: 'warn',
    text: `${atRisk} regular${atRisk === 1 ? ' is' : 's are'} overdue for an order` });

  return (
    <div className="stack ins royal">
      <section className="inshero">
        <div className="inshero__title">
          <h2>✨ Insights <span className="probadge">PRO</span></h2>
          <p>This week against last, what needs you, and everything underneath - one tap each.</p>
        </div>
        <div className="inskpis">
          <Kpi label="Saves" value={String(week.now.saves)} delta={<Delta now={week.now.saves} before={week.before.saves} />}
            spark={<Spark values={series('saves')} tone="pink" />} />
          <Kpi label="Pressed Buy" value={String(week.now.buys)} delta={<Delta now={week.now.buys} before={week.before.buys} />}
            spark={<Spark values={series('buys')} tone="warn" />} />
          <Kpi label="Orders" value={String(week.now.orders)} delta={<Delta now={week.now.orders} before={week.before.orders} />}
            spark={<Spark values={series('orders')} tone="ok" />} />
          <Kpi label="Order value" value={formatMoney(week.now.revenueMinor, 'INR')}
            delta={<Delta now={week.now.revenueMinor} before={week.before.revenueMinor} />} />
          <Kpi label="Went ahead" value={`${wentAhead(week.now)}%`}
            delta={<Delta now={wentAhead(week.now)} before={wentAhead(week.before)} />} />
        </div>
        <small className="inshero__foot">Last 7 days against the 7 before.</small>
      </section>

      <Digest data={data} deep={deep} costs={costs} />

      <section className="card card--pad stack">
        <h2>Needs you</h2>
        {todo.length === 0 ? (
          <p className="muted">All clear. Nothing waiting on you right now.</p>
        ) : (
          <div className="instodo">
            {todo.map((row) => (
              <button key={row.key} type="button" className={`instodo__row instodo__row--${row.tone}`} onClick={() => open(row.go)}>
                <span aria-hidden="true">{row.icon}</span>
                <span>{row.text}</span>
                <span aria-hidden="true" className="instodo__go">›</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="insgrid">
        {CATEGORIES.map((entry) => (
          <button key={entry.id} type="button" className={`instile instile--${entry.tone}`} onClick={() => open(entry.id)}>
            <span className="instile__head"><span aria-hidden="true">{entry.icon}</span> {entry.label}</span>
            <b className="instile__big">{preview[entry.id].big}</b>
            <small className="instile__line">{preview[entry.id].line}</small>
          </button>
        ))}
        <Link to="/shop?tab=calculator" className="instile instile--gold">
          <span className="instile__head"><span aria-hidden="true">🧮</span> Profit calculator</span>
          <b className="instile__big">₹</b>
          <small className="instile__line">Landed cost and margin, your rates</small>
        </Link>
      </div>
    </div>
  );
}

function Kpi({ label, value, delta, spark }: { label: string; value: string; delta: ReactNode; spark?: ReactNode }) {
  return (
    <div className="inskpi">
      <small>{label}</small>
      <b>{value}</b>
      {delta}
      {spark}
    </div>
  );
}

function Stage({ icon, label, value, hint }: { icon: string; label: string; value: number; hint?: string }) {
  return (
    <div className="insstage">
      <span className="insstage__icon" aria-hidden="true">{icon}</span>
      <b>{value.toLocaleString('en-IN')}</b>
      <small>{label}</small>
      {hint && <em>{hint}</em>}
    </div>
  );
}

/** A button that opens a chat with them, when they have a handle to open. */
function MessageButton({ who }: { who: PartyRef }) {
  if (!who.handle) return null;
  return (
    <Link to={`/messages/${encodeURIComponent(who.handle)}`} className="btn btn--sm insmsg">💬 Message</Link>
  );
}

const SAVE_STATE: Record<'saved' | 'checkout' | 'bought', { text: string; tone: string }> = {
  saved: { text: 'Saved', tone: 'pink' },
  checkout: { text: 'Pressed Buy', tone: 'warn' },
  bought: { text: 'Bought', tone: 'ok' },
};

function Saved({ data }: { data: InterestResponse }) {
  if (data.saved.length === 0) {
    return <EmptyState icon="❤️" title="No saves yet">When someone saves one of your items, you will see who and when here.</EmptyState>;
  }
  return (
    <div className="stack">
      {data.saved.map((item) => (
        <article key={item.listingId} className="inscard">
          <header className="inscard__head">
            <Thumb seed={item.listingId} label={item.title} photo={item.photo ? { url: item.photo } : null} className="thumb insthumb" />
            <div>
              <Link to={`/listing/${item.listingId}`} className="inscard__title">{item.title}</Link>
              <small>{formatMoney(item.priceMinor, item.currency)}</small>
            </div>
            <span className="inscard__big">❤️ {item.people.length}</span>
          </header>
          <ul className="inspeople">
            {item.people.map((row) => (
              <li key={`${row.who.handle ?? row.who.name}:${row.savedAt}`}>
                <PersonLink party={row.who} />
                <span className={`badge badge--${SAVE_STATE[row.state].tone}`}>{SAVE_STATE[row.state].text}</span>
                <time className="faint" dateTime={row.savedAt}>{formatDate(row.savedAt)}</time>
                {row.state !== 'bought' && <MessageButton who={row.who} />}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function Checkout({ data, shop }: { data: InterestResponse; shop?: string }) {
  if (data.checkout.length === 0) {
    return (
      <EmptyState icon="🛒" title="Nobody stopped at Buy">
        Everyone who pressed Buy went on to pay or book. Anyone who stops at the checkout shows up here.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      <p className="faint">
        These buyers pressed Buy but did not pay, pay an advance or book, so no order reached you. A friendly
        message often gets them over the line.
      </p>
      {data.checkout.map((row) => (
        <article key={row.orderId} className="inscard inscard--cart">
          <header className="inscard__head">
            <Thumb seed={row.listingId} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb insthumb" />
            <div>
              <PersonLink party={row.who} className="inscard__title" />
              <small>
                <Link to={`/listing/${row.listingId}`}>{row.title}</Link> · {formatMoney(row.amountMinor, row.currency)}
              </small>
            </div>
            <MessageButton who={row.who} />
          </header>
          {row.stillForSale && !row.boughtElsewhere && (
            <NudgeButton request={{ kind: 'checkout', orderId: row.orderId }} shop={shop} label="🔔 Nudge to finish" />
          )}
          <div className="inscard__facts">
            <span>🕐 Pressed Buy {timeAgo(row.firstAt)}</span>
            {row.clicks > 1 && <span>🔁 {row.clicks} times, last {timeAgo(row.lastAt)}</span>}
            {!row.stillForSale && <span className="badge badge--warn">No longer for sale</span>}
            {row.boughtElsewhere && <span className="badge badge--ok">Bought it in another order</span>}
          </div>
        </article>
      ))}
    </div>
  );
}

function Funnel({ data }: { data: InterestResponse }) {
  if (data.items.length === 0) {
    return <EmptyState icon="📈" title="No activity yet">Views, saves and orders on your items show up here.</EmptyState>;
  }
  const { summary } = data;
  const top = Math.max(1, ...data.items.map((row) => row.views));
  return (
    <div className="stack">
      <article className="inscard">
        <header className="inscard__head inscard__head--plain">
          <div>
            <span className="inscard__title">Your whole shop</span>
            <small>From a look to a payment, across every item.</small>
          </div>
        </header>
        <div className="insfunnel" aria-label="From a look to a payment">
          <Stage icon="👀" label="Views" value={summary.views} />
          <Stage icon="❤️" label="Saves" value={summary.saves} />
          <Stage icon="🛒" label="Pressed Buy" value={summary.buyClicks} />
          <Stage icon="📦" label="Orders" value={summary.orders}
            hint={summary.placedPercent === null ? undefined : `${summary.placedPercent}% went ahead`} />
          <Stage icon="✅" label="Paid in full" value={summary.paid} />
        </div>
      </article>
      <p className="faint">Item by item, most-wanted first.</p>
      {data.items.map((row) => {
        const rate = row.buyClicks ? Math.round((row.orders / row.buyClicks) * 100) : null;
        return (
          <article key={row.listingId} className="inscard">
            <header className="inscard__head">
              <Thumb seed={row.listingId} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb insthumb" />
              <div>
                <Link to={`/listing/${row.listingId}`} className="inscard__title">{row.title}</Link>
                <small>
                  {row.live ? '🟢 On sale' : '⚪ Off sale'}
                  {row.revenueMinor > 0 && <> · {formatMoney(row.revenueMinor, row.currency)} received</>}
                </small>
              </div>
              {rate !== null && (
                <span className="inscard__big" title="Of people who pressed Buy, how many placed the order">
                  {rate}%<small>went ahead</small>
                </span>
              )}
            </header>
            <div className="insbars">
              <Bar label="👀 Views" value={row.views} max={top} tone="aqua" />
              <Bar label="❤️ Saves" value={row.saves} max={top} tone="pink" />
              <Bar label="🛒 Pressed Buy" value={row.buyClicks} max={top} tone="warn" />
              <Bar label="📦 Orders" value={row.orders} max={top} tone="violet" />
              <Bar label="✅ Paid" value={row.paid} max={top} tone="ok" />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const width = value > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="insbar">
      <span>{label}</span>
      <span className="insbar__track"><span className={`insbar__fill insbar__fill--${tone}`} style={{ width: `${width}%` }} /></span>
      <b>{value}</b>
    </div>
  );
}

function Leads({ data }: { data: InterestResponse }) {
  if (data.leads.length === 0) {
    return <EmptyState icon="💬" title="No one waiting on you">People who saved or pressed Buy but never ordered from you show up here.</EmptyState>;
  }
  return (
    <div className="stack">
      <p className="faint">Interested in your shop, never ordered. Most promising first.</p>
      <ul className="insleads">
        {data.leads.map((row) => (
          <li key={row.who.handle ?? row.who.name}>
            <span className="insleads__who"><PersonLink party={row.who} /><small>active {timeAgo(row.lastAt)}</small></span>
            <span className="insleads__tags">
              {row.saves > 0 && <span className="badge badge--pink">❤️ {row.saves} saved</span>}
              {row.checkouts > 0 && <span className="badge badge--warn">🛒 {row.checkouts} at Buy</span>}
            </span>
            <MessageButton who={row.who} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** When buyers act, in the viewer's own clock - the time to post and to follow up. */
function Timing({ data }: { data: InterestResponse }) {
  const { hours, days, total } = useMemo(() => {
    const hourCounts = Array.from({ length: 24 }, () => 0);
    const dayCounts = Array.from({ length: 7 }, () => 0);
    for (const at of data.activity) {
      const date = new Date(at);
      if (Number.isNaN(date.getTime())) continue;
      hourCounts[date.getHours()]! += 1;
      dayCounts[date.getDay()]! += 1;
    }
    return { hours: hourCounts, days: dayCounts, total: data.activity.length };
  }, [data.activity]);

  if (total === 0) {
    return <EmptyState icon="⏰" title="Not enough activity yet">Once people save and buy, the busiest hours show up here.</EmptyState>;
  }
  const peakHour = hours.indexOf(Math.max(...hours));
  const peakDay = days.indexOf(Math.max(...days));
  const maxHour = Math.max(1, ...hours);
  const maxDay = Math.max(1, ...days);
  const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;

  return (
    <div className="stack">
      <div className="inspeak">
        <span>🔥 Busiest hour <b>{hourLabel(peakHour)}–{hourLabel((peakHour + 1) % 24)}</b></span>
        <span>📅 Busiest day <b>{DAYS[peakDay]}</b></span>
      </div>
      <p className="faint">Saves, Buy presses and orders by hour of day. Post new items just before the peak.</p>
      <div className="inshours" role="img" aria-label={`Busiest at ${hourLabel(peakHour)}`}>
        {hours.map((value, hour) => (
          <span key={hour} className={`inshours__col${hour === peakHour ? ' is-peak' : ''}`}
            title={`${hourLabel(hour)}: ${value}`}>
            <span style={{ height: `${Math.round((value / maxHour) * 100)}%` }} />
            <small>{hour % 3 === 0 ? hourLabel(hour) : ''}</small>
          </span>
        ))}
      </div>
      <div className="insbars">
        {days.map((value, day) => (
          <Bar key={day} label={DAYS[day]!} value={value} max={maxDay} tone={day === peakDay ? 'pink' : 'violet'} />
        ))}
      </div>
    </div>
  );
}

const TREND: Record<'new' | 'up' | 'steady' | 'down', { text: string; tone: string }> = {
  new: { text: '✨ New this week', tone: 'pink' },
  up: { text: '▲ Rising', tone: 'ok' },
  steady: { text: '■ Steady', tone: 'purple' },
  down: { text: '▼ Cooling', tone: 'warn' },
};

type TrendSort = 'hot' | 'saves' | 'buys' | 'orders' | 'fast';

const TREND_SORTS: { id: TrendSort; label: string; key: (row: TrendingRow) => number; hint: string }[] = [
  { id: 'hot', label: '🔥 Hottest', key: (row) => -row.rank, hint: 'Saves, Buy presses and orders this week, weighted - an order counts three times a save.' },
  { id: 'saves', label: '❤️ Most saved', key: (row) => row.saves, hint: 'Saved in the last 7 days. The wishlist before the order.' },
  { id: 'buys', label: '🛒 Most Buy presses', key: (row) => row.buys, hint: 'Pressed Buy and stopped this week - wanted, but something held them back.' },
  { id: 'orders', label: '📦 Most ordered', key: (row) => row.orders, hint: 'Orders placed in the last 7 days.' },
  { id: 'fast', label: '⚡ Selling fastest', key: (row) => row.perWeek, hint: 'Units sold per week since it was listed.' },
];

/** The shop's own items: what is heating up, what will run out, what nobody wants. */
function Trending({ data }: { data: InterestResponse }) {
  const [sort, setSort] = useState<TrendSort>('hot');
  if (data.trending.length === 0 && data.overlooked.length === 0) {
    return <EmptyState icon="🔥" title="Nothing heating up yet">Items people save, press Buy on and order in the last two weeks show up here.</EmptyState>;
  }
  const chosen = TREND_SORTS.find((entry) => entry.id === sort)!;
  const rows = [...data.trending].filter((row) => sort === 'hot' || chosen.key(row) > 0)
    .sort((x, y) => chosen.key(y) - chosen.key(x));
  const soldOut = data.trending.filter((row) => row.soldOut);
  const runningLow = data.trending.filter((row) => row.daysLeft !== null && row.daysLeft <= 7);
  const peakCategory = Math.max(1, ...data.categories.map((row) => Math.max(row.score, row.before)));

  return (
    <div className="stack">
      {(soldOut.length > 0 || runningLow.length > 0) && (
        <div className="insgrid insgrid--two">
          {soldOut.length > 0 && (
            <div className="insnote insnote--hot">
              <b>🔥 Sold out, still wanted</b>
              {soldOut.map((row) => <Link key={row.listingId} to={`/listing/${row.listingId}`}>{row.title}</Link>)}
              <small>Restock or relist while people are looking.</small>
            </div>
          )}
          {runningLow.length > 0 && (
            <div className="insnote insnote--warn">
              <b>⚡ Running out this week</b>
              {runningLow.map((row) => (
                <span key={row.listingId}>
                  <Link to={`/listing/${row.listingId}`}>{row.title}</Link> — {row.stockLeft} left, about {row.daysLeft} day{row.daysLeft === 1 ? '' : 's'}
                </span>
              ))}
              <small>At the last fortnight's pace. Order more now.</small>
            </div>
          )}
        </div>
      )}

      {data.trending.length > 0 && (
        <>
          <div className="inssegs" role="tablist" aria-label="Sort trending items">
            {TREND_SORTS.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={sort === entry.id}
                className={`inscat${sort === entry.id ? ' is-on' : ''}`} onClick={() => setSort(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
          <p className="faint">{chosen.hint}</p>
          {rows.length === 0 && <p className="muted">Nothing here this week.</p>}
          {rows.map((row) => {
            const moved = row.prevRank === null ? null : row.prevRank - row.rank;
            return (
              <article key={row.listingId} className={`inscard${row.soldOut ? ' inscard--cart' : ''}`}>
                <header className="inscard__head">
                  <Thumb seed={row.listingId} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb insthumb" />
                  <div>
                    <Link to={`/listing/${row.listingId}`} className="inscard__title">{row.title}</Link>
                    <small>
                      #{row.rank}
                      {moved === null ? ' · new in the chart' : moved > 0 ? ` · ▲ up ${moved}` : moved < 0 ? ` · ▼ down ${-moved}` : ' · same place'}
                      {row.category && ` · ${row.category}`}
                    </small>
                  </div>
                  <span className={`badge badge--${TREND[row.trend].tone}`}>{TREND[row.trend].text}</span>
                </header>
                <div className="instrend">
                  <Spark values={row.spark} tone={row.trend === 'down' ? 'warn' : 'ok'} />
                  <div className="instrend__facts">
                    <span>❤️ {row.saves} saved</span>
                    <span>🛒 {row.buys} at Buy</span>
                    <span>📦 {row.orders} ordered</span>
                    <span>⚡ {row.perWeek} sold a week</span>
                  </div>
                </div>
                <div className="inscard__facts">
                  {row.soldOut ? (
                    <span className="badge badge--warn">Sold out or ended — still wanted</span>
                  ) : row.stockLeft !== null ? (
                    <span className={row.daysLeft !== null && row.daysLeft <= 7 ? 'ins__owed' : ''}>
                      📦 {row.stockLeft} left{row.daysLeft !== null ? ` · about ${row.daysLeft} days at this pace` : ''}
                    </span>
                  ) : (
                    <span>♾️ Made to order</span>
                  )}
                </div>
              </article>
            );
          })}
          <small className="faint">The bars are the last 14 days, this week lit.</small>
        </>
      )}

      {data.categories.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Your categories</h2>
            <span className="field__hint">This week against last, across your items.</span>
          </div>
          {data.categories.map((row) => (
            <div key={row.category} className="inscatrow">
              <span className="inscatrow__name">{row.category}</span>
              <span className="inscatrow__bars">
                <span className="insbar__track"><span className="insbar__fill insbar__fill--violet" style={{ width: `${Math.round((row.before / peakCategory) * 100)}%` }} /></span>
                <span className="insbar__track"><span className="insbar__fill insbar__fill--ok" style={{ width: `${Math.round((row.score / peakCategory) * 100)}%` }} /></span>
              </span>
              <Delta now={row.score} before={row.before} />
            </div>
          ))}
          <small className="faint">Top bar last week, bottom bar this week.</small>
        </div>
      )}

      {data.overlooked.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>👀 Getting looks, no takers</h2>
            <span className="field__hint">Plenty of views, nobody saving or pressing Buy. Try a new price, photo or title.</span>
          </div>
          {data.overlooked.map((row) => (
            <div key={row.listingId} className="ins__row">
              <Link to={`/listing/${row.listingId}`} className="ins__name">{row.title}</Link>
              <span className="badge">{row.views} views</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const LEVEL: Record<'hot' | 'rising' | 'steady' | 'quiet', { text: string; tone: string }> = {
  hot: { text: '🔥 Hot', tone: 'hot' },
  rising: { text: '📈 Rising', tone: 'ok' },
  steady: { text: '■ Steady', tone: 'purple' },
  quiet: { text: '💤 Quiet', tone: 'quiet' },
};
const SUPPLY = { crowded: 'Lots of sellers', some: 'Some sellers', few: 'Few sellers' } as const;
const DEMAND = { many: 'Many looking', several: 'A few looking', one: 'Someone looking' } as const;
const POSITION = {
  below: { text: 'Below market', tone: 'aqua' },
  within: { text: 'In range', tone: 'ok' },
  above: { text: 'Above market', tone: 'warn' },
} as const;

/**
 * What is moving in this shop's categories across Figmark. Items only, as
 * rough levels: never a seller, never a count, never a link.
 */
function Market({ shop }: { shop: string | undefined }) {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.market(shop).then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load market trends.'));
  }, [shop]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  if (data.categories.length === 0) {
    return <EmptyState icon="🌐" title="List something first">Market trends follow the categories you sell in.</EmptyState>;
  }

  return (
    <div className="stack">
      <p className="faint">
        Across Figmark, in the categories you sell in. Items only - no sellers, no exact numbers, and nothing
        shows until several different people are interested.
      </p>

      <div className="card card--pad stack">
        <h2>Your categories, market-wide</h2>
        {data.categories.map((row) => (
          <div key={row.category} className="ins__row">
            <span className="ins__name">{row.category}</span>
            <span className="insmkt__tags">
              <span className={`badge badge--${LEVEL[row.level].tone}`}>{LEVEL[row.level].text}</span>
              <span className="faint">{row.trend === 'up' ? '▲' : row.trend === 'down' ? '▼' : '■'} · {SUPPLY[row.supply]}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="stack">
        <h2>Trending elsewhere</h2>
        {data.items.length === 0 ? (
          <p className="muted">Nothing is standing out in your categories this week.</p>
        ) : (
          <div className="insmkt">
            {data.items.map((row, at) => (
              <div key={`${row.title}:${at}`} className="insmkt__item">
                <Thumb seed={`${row.title}:${at}`} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb insmkt__thumb" />
                <span className={`badge badge--${LEVEL[row.level].tone} insmkt__level`}>{LEVEL[row.level].text}</span>
                <b>{row.title}</b>
                <small>{row.category} · {formatMoney(row.priceMinor, row.currency)}</small>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.prices.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Your price against the market</h2>
            <span className="field__hint">The middle half of what the same category is listed for elsewhere, and where yours sits.</span>
          </div>
          {data.prices.map((row) => {
            const span = Math.max(1, row.high - row.low);
            const lo = row.low - span * 0.5;
            const width = span * 2;
            const at = Math.min(100, Math.max(0, ((row.priceMinor - lo) / width) * 100));
            return (
              <div key={row.listingId} className="insprice">
                <div className="ins__row">
                  <Link to={`/listing/${row.listingId}`} className="ins__name">{row.title}</Link>
                  <span className={`badge badge--${POSITION[row.position].tone}`}>{POSITION[row.position].text}</span>
                </div>
                <span className="insprice__track">
                  <span className="insprice__range" style={{ left: '25%', width: '50%' }} />
                  <span className="insprice__you" style={{ left: `${at}%` }} title={`You: ${formatMoney(row.priceMinor, row.currency)}`} />
                </span>
                <small className="faint">
                  You {formatMoney(row.priceMinor, row.currency)} · market {formatMoney(row.low, row.currency)}–{formatMoney(row.high, row.currency)}
                  {' '}(typical {formatMoney(row.mid, row.currency)})
                </small>
              </div>
            );
          })}
        </div>
      )}

      {data.wanted.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Buyers are looking for</h2>
            <span className="field__hint">Open requests on the wants board in your categories. Have one? Make an offer.</span>
          </div>
          {data.wanted.map((row, at) => (
            <div key={`${row.title}:${at}`} className="ins__row">
              <span style={{ minWidth: 0 }}>
                <span className="ins__name">{row.title}</span>
                <span className="faint"> · {row.category}{row.budgetMinor ? ` · budget ${formatMoney(row.budgetMinor, 'INR')}` : ''}</span>
              </span>
              <span className="badge">{DEMAND[row.demand]}</span>
            </div>
          ))}
          <Link to="/social?view=wanted" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}>Open the wants board →</Link>
        </div>
      )}
    </div>
  );
}

type Segment = 'top' | 'returning' | 'new' | 'dormant';

const SEGMENT_TABS: { id: Segment; label: string; hint: string }[] = [
  { id: 'top', label: '🏆 Top spenders', hint: 'By what they have ordered from you.' },
  { id: 'returning', label: '🔁 Returning', hint: 'Ordered more than once. Your regulars.' },
  { id: 'new', label: '🌱 New', hint: 'First order in the last 30 days. A thank-you goes a long way.' },
  { id: 'dormant', label: '💤 Gone quiet', hint: 'Bought before, nothing in the last 60 days. Worth a hello.' },
];

/** Customers as relationships: regulars, newcomers, and the ones drifting away. */
function Customers({ data, lots }: { data: InterestResponse; lots: InsightsResponse | null }) {
  const [segment, setSegment] = useState<Segment>('top');
  const { customers } = data;
  if (customers.total === 0) {
    return <EmptyState icon="👥" title="No customers yet">Once people order, you will see who keeps coming back here.</EmptyState>;
  }
  const rows: Record<Segment, CustomerRow[]> = {
    top: customers.top,
    returning: customers.returningList,
    new: customers.newList,
    dormant: customers.dormantList,
  };
  const tab = SEGMENT_TABS.find((entry) => entry.id === segment)!;
  return (
    <div className="stack">
      <div className="tiles">
        <Tile value={String(customers.total)} label="Customers" />
        <Tile value={customers.repeatPercent === null ? '—' : `${customers.repeatPercent}%`} label="Come back" tone="green" />
        <Tile value={formatMoney(customers.avgOrderMinor, 'INR')} label="Average order" tone="blue" />
      </div>
      <div className="inssegs" role="tablist" aria-label="Customer groups">
        {SEGMENT_TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={segment === entry.id}
            className={`inscat${segment === entry.id ? ' is-on' : ''}`} onClick={() => setSegment(entry.id)}>
            {entry.label}
            <span className="inscat__n">
              {{ top: customers.total, returning: customers.returning, new: customers.newcomers, dormant: customers.dormant }[entry.id]}
            </span>
          </button>
        ))}
      </div>
      <p className="faint">{tab.hint}</p>
      {rows[segment].length === 0 ? (
        <p className="muted">Nobody here yet.</p>
      ) : (
        <ul className="insleads">
          {rows[segment].map((row) => (
            <li key={row.who.handle ?? row.who.name}>
              <span className="insleads__who">
                <PersonLink party={row.who} />
                <small>
                  {row.orders} order{row.orders === 1 ? '' : 's'} · last {timeAgo(row.lastAt)}
                  {segment !== 'new' && !row.returning && ' · one-time'}
                </small>
              </span>
              <b className="inscollect">{formatMoney(row.spentMinor, 'INR')}</b>
              <MessageButton who={row.who} />
            </li>
          ))}
        </ul>
      )}

      {lots && lots.cohorts.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>New against returning, lot by lot</h2>
            <span className="field__hint">Customers in each lot, and whether you had seen them before.</span>
          </div>
          <div className="legs">
            {lots.cohorts.map((row, index) => (
              <div key={`${row.lotName}:${index}`} className="coh">
                <span className="coh__name">{row.lotName}</span>
                <span className="coh__count">{row.newCount} new · {row.returningCount} back</span>
                <span className="coh__track">
                  <span className="coh__new" style={{ flexGrow: row.newCount }} />
                  <span className="coh__old" style={{ flexGrow: row.returningCount }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Boxes each open lot still needs, and who to pack together. */
function Packing({ data }: { data: InsightsResponse | null }) {
  if (!data || (data.boxes.byLot.length === 0 && data.bulk.length === 0)) {
    return (
      <EmptyState icon="📦" title="Nothing to pack">
        Once orders are filed into a lot, the boxes each lot needs show up here - one parcel per customer, sized off what is in it.
      </EmptyState>
    );
  }
  const { boxes, bulk } = data;
  return (
    <div className="stack">
      {boxes.byLot.length > 0 && (
        <>
          <div className="tiles">
            <Tile value={String(boxes.small)} label="Small" />
            <Tile value={String(boxes.medium)} label="Medium" tone="blue" />
            <Tile value={String(boxes.large)} label="Large" tone="green" />
          </div>
          <p className="faint">One parcel per customer per lot. A customer drops out once theirs is packed.</p>
          {boxes.byLot.map((row) => (
            <article key={row.lotId} className="inscard">
              <header className="inscard__head inscard__head--plain">
                <div>
                  <span className="inscard__title">{row.lotName}</span>
                  <small>{row.total} box{row.total === 1 ? '' : 'es'} to pack</small>
                </div>
              </header>
              <div className="insboxes">
                <span><b>{row.small}</b> small</span>
                <span><b>{row.medium}</b> medium</span>
                <span><b>{row.large}</b> large</span>
              </div>
            </article>
          ))}
        </>
      )}
      {bulk.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Worth packing together</h2>
            <span className="field__hint">Several items in one lot, going to one person — one parcel, not three.</span>
          </div>
          {bulk.map((row) => (
            <div key={`${row.buyerId}:${row.lotName}`} className="ins__row">
              <span style={{ minWidth: 0 }}>
                <PersonLink party={row.who} />
                <span className="faint"> · {row.lotName}</span>
              </span>
              <span className="badge">{row.count} items</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A stretch of time in the unit that suits it. */
function days(value: number): string {
  if (value >= 1) return `${value.toFixed(1)}d`;
  const hours = value * 24;
  return hours >= 1 ? `${Math.round(hours)}h` : 'same day';
}

/** Where each consignment is, where time goes, and how sales and pre-orders did. */
function Lots({ data }: { data: InsightsResponse | null }) {
  if (!data || (data.perLot.length === 0 && data.preOrders.length === 0 && data.powerSales.runs === 0)) {
    return (
      <EmptyState icon="🚚" title="No lots moving yet">
        Open a lot and file some orders into it. These figures are counted off the checkpoints you tick.
      </EmptyState>
    );
  }
  const { headline, timings, perLot, preOrders } = data;
  const sales = data.powerSales;
  // Bars are drawn against the slowest leg, so the one to fix fills the row.
  const measured = SEGMENTS.filter((segment) => timings[segment] !== null);
  const slowest = Math.max(0.1, ...measured.map((segment) => timings[segment]!));
  return (
    <div className="stack">
      <div className="tiles">
        <Tile value={formatMoney(headline.valueInFlightMinor)} label="Value moving" />
        <Tile value={String(headline.openLots)} label="Lots open" tone="blue" />
        <Tile value={String(data.repeat)} label="Bought across lots" tone="green" />
      </div>

      {measured.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Time in each stage</h2>
            <span className="field__hint">Average days, across every order you have moved. The long one is where to push.</span>
          </div>
          <div className="legs">
            {measured.map((segment) => (
              <div key={segment} className="leg">
                <span className="leg__label">{SEGMENT_LABELS[segment]}</span>
                <span className="leg__days">{days(timings[segment]!)}</span>
                <span className="leg__track">
                  <span className="leg__fill" style={{ width: `${Math.max(3, (timings[segment]! / slowest) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {perLot.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Lot by lot</h2>
            <span className="field__hint">Where each consignment actually is, and what is riding on it.</span>
          </div>
          {perLot.map((row) => (
            <div key={row.lotId} className="ins__lot">
              <div className="ins__row">
                <span className="ins__name">{row.lotName}</span>
                <span className="badge">{row.progress}%</span>
              </div>
              <span className="faint">{PHASE_LABELS[row.phase]}</span>
              <span className="ins__track"><span className="ins__fill" style={{ width: `${row.progress}%` }} /></span>
              <div className="ins__meta">
                <span>{formatMoney(row.valueMinor)}</span>
                <span className="faint">
                  {row.customers} customer{row.customers === 1 ? '' : 's'} · {row.orders} order{row.orders === 1 ? '' : 's'}
                </span>
                {row.unpaidMinor > 0 && <span className="ins__owed">{formatMoney(row.unpaidMinor)} unpaid</span>}
                {row.doorToDoor !== null && <span className="faint">{days(row.doorToDoor)} door to door</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {(sales.runs > 0 || preOrders.length > 0) && (
        <div className="card card--pad stack">
          <div>
            <h2>Sales and pre-orders</h2>
            <span className="field__hint">What the channel did, and which pre-orders got there.</span>
          </div>
          {sales.runs > 0 && (
            <div className="tiles">
              <Tile value={String(sales.posted)} label="Items dropped" />
              <Tile value={String(sales.inWindow)} label="In the window" tone="blue" />
              <Tile value={String(sales.handedOver)} label="Moved to the shop" tone="green" />
            </div>
          )}
          {preOrders.map((row) => {
            const percent = Math.min(100, Math.round(((row.booked + row.pledged) / Math.max(1, row.threshold)) * 100));
            return (
              <div key={row.listingId} className="ins__lot">
                <div className="ins__row">
                  <Link to={`/listing/${row.listingId}`} className="ins__name">{row.title}</Link>
                  <span className={`badge${row.filled ? ' badge--ok' : row.closedShort ? ' badge--warn' : ''}`}>
                    {row.filled ? 'Filled' : row.closedShort ? 'Closed short' : `${percent}%`}
                  </span>
                </div>
                <span className="ins__track"><span className="ins__fill" style={{ width: `${percent}%` }} /></span>
                <span className="faint">
                  {row.booked} paid{row.pledged > 0 && ` · ${row.pledged} pledged`} of {row.threshold} needed
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
