import { ProLock, useProLocked } from '../components/Billing';
import type { ProFeatureId } from '@shared/billing';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { StoreAccess } from '@shared/stores';
import { ORDER_SOURCE_LABELS, PATH_STEP_LABELS, VALUE_LABEL_NAMES } from '@shared/customers';
import { VIEW_SOURCE_LABELS, type ViewSource } from '@shared/seller-data';
import {
  ApiRequestError, api, type CustomerLabel, type CustomerListRow, type CustomerPage, type CustomersResponse,
  type DataOverview, type DataPeriodFigures,
} from '../api';
import { formatDate, formatMoney, timeAgo } from '../format';
import { EmptyState, ErrorNotice, Modal, PersonLink, Thumb } from '../components/ui';
import { Loading } from '../components/Feedback';
import { NudgeButton } from '../components/NudgeButton';
import { InsightsPanel } from './InsightsPanel';
import '../styles/DataSections.css';

/**
 * The Data tab, by job: Overview, Customers, Items, Operations (and Money,
 * which is the sales report). Each section opens on what anybody can read
 * and act on, then the deeper readings, marked PRO - open to every shop until
 * Pro is switched on with real payments.
 *
 * A customer is somebody who did something toward the shop. Views are
 * counted, never named.
 */

const money = (minor: number) => formatMoney(minor, 'INR');
const pct = (rate: number | null | undefined) => (rate == null ? '—' : `${Math.round(rate * 100)}%`);
const hours = (value: number | null) => (value == null ? '—' : value < 1 ? `${Math.round(value * 60)} min` : value < 48 ? `${Math.round(value)} h` : `${Math.round(value / 24)} d`);
const shopOf = (store: StoreAccess) => (store.isOwner ? undefined : store.ownerId);

/** 7, 30 or 90 days, kept in the address so a reload or a link keeps it. */
function usePeriod(): [number, (days: number) => void] {
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('days'));
  const days = asked === 7 || asked === 90 ? asked : 30;
  const set = (next: number) => setParams((current) => {
    const copy = new URLSearchParams(current);
    if (next === 30) copy.delete('days'); else copy.set('days', String(next));
    return copy;
  }, { replace: true });
  return [days, set];
}

function PeriodPicker({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return (
    <div className="dperiod" role="radiogroup" aria-label="Period">
      {[7, 30, 90].map((option) => (
        <button key={option} type="button" role="radio" aria-checked={days === option}
          className={`dperiod__pick${days === option ? ' is-on' : ''}`} onClick={() => onChange(option)}>
          {option} days
        </button>
      ))}
    </div>
  );
}

/** The deeper readings in a section: marked Pro, and open to everyone until Pro is switched on. */
function ProBlock({ title, note, children, feature = 'insights' }: { title: string; note?: string; children: ReactNode; feature?: ProFeatureId }) {
  const locked = useProLocked(feature);
  if (locked === null) return null;
  if (locked) return <ProLock feature={feature} title={title} />;
  return (
    <section className="card card--pad stack dpro">
      <div className="dpro__head">
        <h2>{title} <span className="probadge">PRO</span></h2>
        {note && <small className="faint">{note}</small>}
      </div>
      {children}
    </section>
  );
}

/** This period's number, with the change from the one before. */
function Figure({ label, now, before, render = String, note }: {
  label: string; now: number | null; before?: number | null; render?: (value: number) => string; note?: string;
}) {
  const change = now != null && before != null && before > 0 ? Math.round(((now - before) / before) * 100) : null;
  return (
    <div className="dfig">
      <small>{label}</small>
      <b>{now == null ? '—' : render(now)}</b>
      {change != null ? (
        <span className={`dfig__delta${change > 0 ? ' is-up' : change < 0 ? ' is-down' : ''}`}>
          {change > 0 ? '▲' : change < 0 ? '▼' : '■'} {Math.abs(change)}%
        </span>
      ) : before === 0 && now ? <span className="dfig__delta is-up">▲ new</span> : <span className="dfig__delta">{note ?? ' '}</span>}
    </div>
  );
}

/** Bars over days, the last one lit; tap one to read it. */
function DayBars({ days, label }: { days: { day: string; views: number }[]; label: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const peak = Math.max(1, ...days.map((row) => row.views));
  const shown = days.find((row) => row.day === picked);
  return (
    <div className="dbars-wrap">
      <div className="dbars" role="img" aria-label={label}>
        {days.map((row) => (
          <button key={row.day} type="button" className={`dbars__bar${picked === row.day ? ' is-on' : ''}`}
            style={{ height: `${Math.max(4, Math.round((row.views / peak) * 100))}%` }}
            onClick={() => setPicked(row.day)} aria-label={`${formatDate(row.day)}: ${row.views} views`} />
        ))}
      </div>
      <small className="faint">{shown ? `${formatDate(shown.day)}: ${shown.views} views` : 'Tap a bar for that day.'}</small>
    </div>
  );
}

/** A share of a whole, as a labelled bar. */
function ShareRow({ label, value, total, extra }: { label: string; value: number; total: number; extra?: ReactNode }) {
  const share = total > 0 ? value / total : 0;
  return (
    <div className="dshare">
      <span className="dshare__label">{label}</span>
      <span className="dshare__bar" aria-hidden="true"><span style={{ width: `${Math.max(2, share * 100)}%` }} /></span>
      <span className="dshare__value">{value}{extra}</span>
    </div>
  );
}

function useOverview(store: StoreAccess, days: number) {
  const [data, setData] = useState<DataOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    void api.dataOverview(days, shopOf(store)).then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your numbers.'));
  }, [store, days]);
  return { data, error };
}

/* ── Overview ──────────────────────────────────────────────────────────── */

const NEED_ICONS: Record<string, string> = { overdue: '⏰', reply: '💬', eta: '🚚', soon: '📦', search: '🔎' };

export function DataOverviewSection({ store, onGo }: { store: StoreAccess; onGo: (section: 'customers' | 'itemdata' | 'operations' | 'analytics') => void }) {
  const [days, setDays] = usePeriod();
  const { data, error } = useOverview(store, days);
  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Loading />;
  const { current: now, previous: before } = data;

  const needs: { key: string; text: string; tone: 'warn' | 'hot' | 'ok'; go: Parameters<typeof onGo>[0] }[] = [];
  const overdue = data.onTime.lateOrders.filter((row) => row.state === 'overdue').length;
  if (overdue > 0) needs.push({ key: 'overdue', tone: 'hot', go: 'operations', text: `${overdue} order${overdue === 1 ? ' is' : 's are'} past the delivery time promised` });
  if (data.reply.waitingOverDay > 0) needs.push({ key: 'reply', tone: 'warn', go: 'operations', text: `${data.reply.waitingOverDay} booking${data.reply.waitingOverDay === 1 ? '' : 's'} or payment${data.reply.waitingOverDay === 1 ? '' : 's'} waiting on you over a day` });
  if (data.onTime.listingsWithoutEta.length > 0) needs.push({ key: 'eta', tone: 'warn', go: 'operations', text: `${data.onTime.listingsWithoutEta.length} live item${data.onTime.listingsWithoutEta.length === 1 ? ' has' : 's have'} no delivery time yet` });
  if (data.onTime.dueSoon.length > 0) needs.push({ key: 'soon', tone: 'ok', go: 'operations', text: `${data.onTime.dueSoon.length} order${data.onTime.dueSoon.length === 1 ? ' is' : 's are'} due to arrive within 5 days` });
  if (data.searches.unmet.length > 0) needs.push({ key: 'search', tone: 'ok', go: 'itemdata', text: `Buyers searched for "${data.searches.unmet[0]!.term}" and found nothing` });

  return (
    <div className="stack">
      <div className="data__bar">
        <h2>Overview</h2>
        <PeriodPicker days={days} onChange={setDays} />
      </div>
      <section className="dfigs" aria-label={`The last ${days} days against the ${days} before`}>
        <Figure label="Sales" now={now.revenueMinor} before={before.revenueMinor} render={money} />
        <Figure label="Orders" now={now.orders} before={before.orders} />
        <Figure label="Customers" now={now.customers} before={before.customers} />
        <Figure label="New customers" now={now.newCustomers} before={before.newCustomers} />
        <Figure label="Views" now={now.views} before={before.views} />
        <Figure label="Views to orders" now={now.conversion} before={before.conversion} render={(value) => `${value}%`} />
        <Figure label="Average order" now={now.averageOrderMinor} before={before.averageOrderMinor} render={money} />
        <Figure label="On time" now={data.onTime.rate == null ? null : Math.round(data.onTime.rate * 100)} render={(value) => `${value}%`}
          note={data.onTime.rate == null ? `${data.onTime.measured} of 5 deliveries` : `of ${data.onTime.measured} orders`} />
      </section>
      <small className="faint">The last {days} days against the {days} before.</small>

      <section className="card card--pad stack">
        <h2>Needs you</h2>
        {needs.length === 0 ? <p className="muted">All clear. Nothing waiting on you right now.</p> : (
          <div className="instodo">
            {needs.map((row) => (
              <button key={row.key} type="button" className={`instodo__row instodo__row--${row.tone}`} onClick={() => onGo(row.go)}>
                <span aria-hidden="true">{NEED_ICONS[row.key] ?? '•'}</span>
                <span>{row.text}</span>
                <span aria-hidden="true" className="instodo__go">›</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card card--pad stack">
        <div>
          <h2>Views</h2>
          <span className="field__hint">How often your items were opened each day. Views are counted, never named.</span>
        </div>
        <DayBars days={data.views.daily} label={`Views over the last ${days} days`} />
      </section>

      <div className="dgo">
        <button type="button" className="dgo__card" onClick={() => onGo('customers')}><b>👥 Customers</b><small>Who buys, who comes back, who to reach</small></button>
        <button type="button" className="dgo__card" onClick={() => onGo('itemdata')}><b>🏷️ Items</b><small>Views, where they come from, what buyers search</small></button>
        <button type="button" className="dgo__card" onClick={() => onGo('operations')}><b>🚚 Operations</b><small>On time, reply time, cancellations</small></button>
        <button type="button" className="dgo__card" onClick={() => onGo('analytics')}><b>💰 Money</b><small>Sales, what is owed, real profit</small></button>
      </div>
    </div>
  );
}

/* ── Customers ─────────────────────────────────────────────────────────── */

type Filter = 'all' | 'new' | 'returning' | 'owes' | 'follows' | CustomerLabel;

const FILTERS: { id: Filter; label: string; test: (row: CustomerListRow) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'new', label: 'New this period', test: (row) => row.isNew },
  { id: 'returning', label: 'Came back', test: (row) => row.orders > 1 },
  { id: 'vip', label: '👑 VIP', test: (row) => row.orders > 0 && row.label === 'vip' },
  { id: 'regular', label: '🔁 Regular', test: (row) => row.orders > 0 && row.label === 'regular' },
  { id: 'at_risk', label: '⚠️ At risk', test: (row) => row.orders > 0 && row.label === 'at_risk' },
  { id: 'one_time', label: '1️⃣ One-time', test: (row) => row.orders > 0 && row.label === 'one_time' },
  { id: 'owes', label: 'Owes money', test: (row) => row.owedMinor > 0 },
  { id: 'follows', label: 'Follows you', test: (row) => row.follows },
];

const PRO_FILTERS: readonly Filter[] = ['vip', 'regular', 'at_risk', 'one_time'];

export function CustomersSection({ store }: { store: StoreAccess }) {
  const [days, setDays] = usePeriod();
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [writing, setWriting] = useState(false);
  const messagingLocked = useProLocked('customers') === true;
  const [params, setParams] = useSearchParams();
  const openId = params.get('customer');
  const openCustomer = (id: string | null) => setParams((current) => {
    const copy = new URLSearchParams(current);
    if (id) copy.set('customer', id); else copy.delete('customer');
    return copy;
  });
  const shop = shopOf(store);

  useEffect(() => {
    setData(null);
    setError(null);
    void api.customers(days, shop).then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your customers.'));
  }, [days, shop]);

  const rows = useMemo(() => {
    if (!data) return [];
    const test = FILTERS.find((entry) => entry.id === filter)!.test;
    const words = query.trim().toLowerCase();
    return data.customers.filter((row) => test(row)
      && (!words || row.who.name.toLowerCase().includes(words) || (row.who.handle ?? '').toLowerCase().includes(words)
        || row.topics.some((topic) => topic.toLowerCase().includes(words))));
  }, [data, filter, query]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Loading />;
  const { summary, pro } = data;
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="stack">
      <div className="data__bar">
        <h2>Customers</h2>
        <PeriodPicker days={days} onChange={setDays} />
      </div>

      <section className="dfigs" aria-label="Your customers">
        <Figure label="Customers" now={summary.customers} note="have ever ordered" />
        <Figure label={`Active in ${days} days`} now={summary.activeInPeriod} note={`${summary.newInPeriod} new · ${summary.returningInPeriod} came back`} />
        <Figure label="Come back" now={summary.repeatRate} render={(value) => `${value}%`} note="ordered more than once" />
        <Figure label="Average order" now={summary.averageOrderMinor} render={money} note={`in ${days} days`} />
        <Figure label="Followers" now={summary.followers} note={`+${summary.followersInPeriod} in ${days} days`} />
        <Figure label="Owed to you" now={summary.owedMinor} render={money} note="across open orders" />
      </section>

      <section className="card card--pad stack">
        <div className="dlist__tools">
          <input type="search" className="dlist__search" placeholder="Search by name, handle or interest" aria-label="Search customers"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="sections dlist__filters" role="tablist" aria-label="Show">
            {FILTERS.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={filter === entry.id}
                className={`chip${filter === entry.id ? ' is-on' : ''}${PRO_FILTERS.includes(entry.id) ? ' chip--pro' : ''}`}
                onClick={() => setFilter(entry.id)}>
                {entry.label}
                {entry.id !== 'all' && <span className="dlist__count">{data.customers.filter(entry.test).length}</span>}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon="👥" title={data.customers.length ? 'Nobody here' : 'No customers yet'}>
            {data.customers.length ? 'Nobody matches that. Try another filter.' : 'Once people order, each one is listed here with what they bought and how they pay.'}
          </EmptyState>
        ) : (
          <ul className="dlist">
            {rows.map((row) => (
              <li key={row.id} className="dlist__row">
                <input type="checkbox" className="dlist__pick" checked={picked.has(row.id)} onChange={() => toggle(row.id)}
                  aria-label={`Pick ${row.who.name} for a group message`} />
                <button type="button" className="dlist__main" onClick={() => openCustomer(row.id)}>
                  <span className="dlist__name">
                    <b>{row.who.name}</b>
                    {row.orders > 0 && <span className={`dtag dtag--${row.label}`}>{VALUE_LABEL_NAMES[row.label].label}</span>}
                    {row.isNew && <span className="dtag dtag--new">New</span>}
                    {row.follows && <span className="dtag">Follows</span>}
                  </span>
                  <span className="dlist__meta">
                    {row.orders} order{row.orders === 1 ? '' : 's'} · {money(row.spentMinor)} · last {timeAgo(row.lastAt)}
                    {row.topics.length > 0 && <> · {row.topics.join(', ')}</>}
                  </span>
                  <span className="dlist__meta">
                    <span className={`dword dword--${row.reliability.tone}`}>{row.reliability.word}</span>
                    {' · '}came via {ORDER_SOURCE_LABELS[row.firstSource].toLowerCase()}
                    {row.owedMinor > 0 && <> · <b className="dowed">owes {money(row.owedMinor)}</b></>}
                    {row.saves > 0 && <> · {row.saves} saved</>}
                    {row.openCheckouts > 0 && <> · {row.openCheckouts} at checkout</>}
                  </span>
                </button>
                <span aria-hidden="true" className="dlist__go">›</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {picked.size > 0 && (
        <div className="dpicked" role="status">
          <span>{picked.size} picked</span>
          {messagingLocked
            ? <ProLock feature="customers" inline title="Message them" />
            : <button type="button" className="btn btn--sm" onClick={() => setWriting(true)}>✉️ Message them <span className="probadge">PRO</span></button>}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
      {writing && <GroupMessage ids={[...picked]} shop={shop} onClose={() => setWriting(false)} onSent={() => setPicked(new Set())} />}

      <ProBlock title="How customers found you" note="Where each customer's first order came from, and what they have spent since.">
        {pro.sources.length === 0 ? <p className="muted">No orders yet.</p> : pro.sources.map((row) => (
          <ShareRow key={row.source} label={ORDER_SOURCE_LABELS[row.source]} value={row.customers}
            total={summary.customers} extra={<small className="faint"> · {money(row.averageMinor)} each</small>} />
        ))}
      </ProBlock>

      <ProBlock title="Where people stop" note="Every person and item they touched, by the furthest step they reached.">
        <div className="dpath">
          {pro.path.map((row, at) => (
            <div key={row.step} className="dpath__step">
              <b>{row.reached}</b>
              <small>{PATH_STEP_LABELS[row.step]}</small>
              {at > 1 && pro.path[at - 1]!.reached > 0 && (
                <em>{Math.round((row.reached / pro.path[at - 1]!.reached) * 100)}% went on</em>
              )}
            </div>
          ))}
        </div>
      </ProBlock>

      <ProBlock title="Worth reaching now" note="People who showed they want something and have not bought it.">
        <Signals pro={pro} shop={shop} onOpen={openCustomer} />
      </ProBlock>

      <ProBlock title="Who would want this" note="Your live items, and the customers whose orders and saves suggest they would buy them.">
        {pro.matches.length === 0 ? <p className="muted">Not enough orders yet to match items to people.</p> : (
          <ul className="dmatch">
            {pro.matches.map((row) => (
              <li key={row.listingId} className="dmatch__row">
                <Thumb seed={row.listingId} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb dmatch__thumb" />
                <span className="dmatch__body">
                  <Link to={`/listing/${row.listingId}`}><b>{row.title}</b></Link>
                  <small>{row.fits.length} likely buyer{row.fits.length === 1 ? '' : 's'}: {row.fits.slice(0, 4).map((fit) => fit.who.name).join(', ')}{row.fits.length > 4 ? '…' : ''}</small>
                </span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setPicked(new Set(row.fits.map((fit) => fit.id))); setWriting(true); }}>
                  Tell them
                </button>
              </li>
            ))}
          </ul>
        )}
      </ProBlock>

      <ProBlock title="Engagement that sells" note="People who voted, commented, entered or reacted to your posts, and whether they bought.">
        <div className="dfigs dfigs--three">
          <Figure label="Took part" now={pro.engagement.people} />
          <Figure label="Are customers" now={pro.engagement.buyers} />
          <Figure label="Bought after taking part" now={pro.engagement.boughtAfter} />
        </div>
        {pro.engagement.kinds.filter((row) => row.people > 0).map((row) => (
          <ShareRow key={row.kind} label={{ votes: 'Voted', comments: 'Commented', entries: 'Entered a contest', guesses: 'Guessed a price', reactions: 'Reacted' }[row.kind]}
            value={row.buyers} total={row.people} extra={<small className="faint"> of {row.people} bought</small>} />
        ))}
      </ProBlock>

      <ProBlock title="Against other shops" note={`The middle of ${pro.benchmark.shops} other shop${pro.benchmark.shops === 1 ? '' : 's'} on Figmark. No shop is named.`}>
        <table className="dbench">
          <thead><tr><th scope="col"> </th><th scope="col">You</th><th scope="col">Other shops</th></tr></thead>
          <tbody>
            <tr><th scope="row">On time</th><td>{pct(pro.benchmark.onTime.you)}</td><td>{pct(pro.benchmark.onTime.median)}</td></tr>
            <tr><th scope="row">Buyers who come back</th><td>{pct(pro.benchmark.repeat.you)}</td><td>{pct(pro.benchmark.repeat.median)}</td></tr>
            <tr><th scope="row">Completed sales</th><td>{pro.benchmark.completed.you}</td><td>{pro.benchmark.completed.median ?? '—'}</td></tr>
            <tr><th scope="row">Followers</th><td>{pro.benchmark.followers.you}</td><td>{pro.benchmark.followers.median ?? '—'}</td></tr>
          </tbody>
        </table>
      </ProBlock>

      <InsightsPanel store={store} only={['customers', 'loyalty', 'saved', 'checkout', 'leads', 'reminders']} title="More on customers" />

      {openId && <CustomerSheet buyerId={openId} shop={shop} asStore={store.handle} onClose={() => openCustomer(null)} />}
    </div>
  );
}

function Signals({ pro, shop, onOpen }: { pro: CustomersResponse['pro']; shop?: string; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<'checkout' | 'saved' | 'pledged' | 'wants'>('checkout');
  const tabs = [
    { id: 'checkout' as const, label: '🛒 Stopped at Buy', count: pro.signals.checkout.length },
    { id: 'saved' as const, label: '❤️ Saved, not bought', count: pro.signals.saved.length },
    { id: 'pledged' as const, label: '🙋 Pledged', count: pro.signals.pledged.length },
    { id: 'wants' as const, label: '🔎 Wanted posts', count: pro.signals.wants.length },
  ];
  return (
    <>
      <div className="sections" role="tablist" aria-label="Signals">
        {tabs.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id}
            className={`chip${tab === entry.id ? ' is-on' : ''}`} onClick={() => setTab(entry.id)}>
            {entry.label} <span className="dlist__count">{entry.count}</span>
          </button>
        ))}
      </div>
      <ul className="dsig">
        {tab === 'checkout' && pro.signals.checkout.map((row) => (
          <li key={row.orderId} className="dsig__row">
            <button type="button" className="linkish" onClick={() => onOpen(row.id)}>{row.who.name}</button>
            <span>pressed Buy on <Link to={`/listing/${row.listingId}`}>{row.title}</Link>{row.clicks > 1 ? ` ${row.clicks} times` : ''} · {timeAgo(row.at)}</span>
            <NudgeButton request={{ kind: 'checkout', orderId: row.orderId }} shop={shop} />
          </li>
        ))}
        {tab === 'saved' && pro.signals.saved.map((row) => (
          <li key={`${row.id}:${row.listingId}`} className="dsig__row">
            <button type="button" className="linkish" onClick={() => onOpen(row.id)}>{row.who.name}</button>
            <span>saved <Link to={`/listing/${row.listingId}`}>{row.title}</Link> · {timeAgo(row.at)}</span>
            <NudgeButton request={{ kind: 'saved', listingId: row.listingId, buyerId: row.id }} shop={shop} />
          </li>
        ))}
        {tab === 'pledged' && pro.signals.pledged.map((row) => (
          <li key={`${row.id}:${row.listingId}`} className="dsig__row">
            <button type="button" className="linkish" onClick={() => onOpen(row.id)}>{row.who.name}</button>
            <span>pledged {row.units} for <Link to={`/listing/${row.listingId}`}>{row.title}</Link> · {timeAgo(row.at)}</span>
          </li>
        ))}
        {tab === 'wants' && pro.signals.wants.map((row) => (
          <li key={row.wantId} className="dsig__row">
            <PersonLink party={row.who} bare />
            <span>wants <b>{row.title}</b>{row.budgetMinor ? ` · up to ${money(row.budgetMinor)}` : ''} · {timeAgo(row.at)}</span>
            <Link className="btn btn--ghost btn--sm" to="/social?view=wanted">Offer</Link>
          </li>
        ))}
        {tabs.find((entry) => entry.id === tab)!.count === 0 && <li className="muted">Nobody here right now.</li>}
      </ul>
    </>
  );
}

/** One message to the people picked. */
function GroupMessage({ ids: picked, shop, onClose, onSent }: { ids: string[]; shop?: string; onClose: () => void; onSent: () => void }) {
  // Who it is for, as picked when the dialog opened: sending clears the list behind it.
  const [ids] = useState(picked);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const sent = await api.messageCustomers({ buyerIds: ids, text: text.trim() }, shop);
      const parts = [`Sent to ${sent.sent}.`];
      if (sent.optedOut) parts.push(`${sent.optedOut} turned shop messages off.`);
      if (sent.recent) parts.push(`${sent.recent} already heard from you today.`);
      parts.push(`${Math.max(0, sent.left)} group message${sent.left === 1 ? '' : 's'} left today.`);
      setResult(parts.join(' '));
      onSent();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Message ${ids.length} customer${ids.length === 1 ? '' : 's'}`} onClose={onClose}>
      {result ? (
        <div className="stack">
          <p className="notice notice--ok">{result}</p>
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="stack">
          <label className="field">
            <span>Message</span>
            <textarea rows={4} maxLength={300} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="A new drop is up tonight - you get first pick." />
            <span className="field__hint">{300 - text.length} characters left. It arrives in their notifications from your shop.</span>
          </label>
          <p className="field__hint">
            Up to 100 people, 3 group messages a day, and one a day to each person. People who turned shop messages off are skipped.
          </p>
          {error && <ErrorNotice message={error} />}
          <button type="button" className="btn btn--lg" disabled={busy || text.trim().length < 3} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
    </Modal>
  );
}

const PUNCTUALITY_WORDS = { on_time: 'On time', late: 'Late', overdue: 'Overdue', pending: 'On its way', none: '' } as const;

/** One customer, opened over the list. */
function CustomerSheet({ buyerId, shop, asStore, onClose }: { buyerId: string; shop?: string; asStore?: string | null; onClose: () => void }) {
  const [data, setData] = useState<CustomerPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    void api.customer(buyerId, shop).then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load this customer.'));
  }, [buyerId, shop]);
  return (
    <Modal title={data?.who.name ?? 'Customer'} onClose={onClose}>
      {error ? <ErrorNotice message={error} /> : !data ? <Loading /> : (
        <div className="stack dcust">
          <div className="dcust__head">
            <PersonLink party={data.who}>Open their profile</PersonLink>
            {data.label && <span className={`dtag dtag--${data.label}`}>{VALUE_LABEL_NAMES[data.label].label}</span>}
            {data.follows && <span className="dtag">Follows you</span>}
          </div>
          <div className="dfigs dfigs--three">
            <Figure label="Orders" now={data.orders} note={data.firstAt ? `since ${formatDate(data.firstAt)}` : 'none yet'} />
            <Figure label="Spent" now={data.spentMinor} render={money} />
            <Figure label="Owes" now={data.owedMinor} render={money} />
          </div>
          {data.who.handle && (
            <div className="dcust__acts">
              <Link className="btn btn--sm" to={`/messages/${encodeURIComponent(data.who.handle)}${asStore ? `?as=${encodeURIComponent(asStore)}` : ''}`}>
                💬 Message as your shop
              </Link>
              <small className="faint">A private deal is made from the chat.</small>
            </div>
          )}

          <section className="stack">
            <h3>How they buy</h3>
            <p className={`dword dword--${data.reliability.tone}`}>{data.reliability.word}</p>
            <ul className="dfacts">
              <li>Usually pays within <b>{hours(data.reliability.payHours)}</b> of ordering</li>
              <li><b>{data.reliability.paidUp}</b> paid in full · <b>{data.reliability.cancelled}</b> called off · <b>{data.reliability.neverPaid}</b> never paid</li>
              {(data.reliability.disputes > 0 || data.reliability.deniedClaims > 0) && (
                <li className="dword--warn">{data.reliability.disputes} dispute{data.reliability.disputes === 1 ? '' : 's'} · {data.reliability.deniedClaims} payment claim{data.reliability.deniedClaims === 1 ? '' : 's'} that did not arrive</li>
              )}
              {data.firstSource && <li>First came via <b>{ORDER_SOURCE_LABELS[data.firstSource].toLowerCase()}</b></li>}
              {data.nextDueAt && <li>Usually orders again around <b>{formatDate(data.nextDueAt)}</b></li>}
            </ul>
          </section>

          {data.interest.topics.length > 0 && (
            <section className="stack">
              <h3>Into <span className="probadge">PRO</span></h3>
              <div className="dtopics">{data.interest.topics.map((topic) => <span key={topic.name} className="chip">{topic.name}</span>)}</div>
              {data.interest.priceBand && <small className="faint">Usually spends {money(data.interest.priceBand.lowMinor)} to {money(data.interest.priceBand.highMinor)} an item.</small>}
            </section>
          )}

          {data.suggestions.length > 0 && (
            <section className="stack">
              <h3>They might want <span className="probadge">PRO</span></h3>
              <ul className="dsig">
                {data.suggestions.map((row) => (
                  <li key={row.listingId} className="dsig__row">
                    <Link to={`/listing/${row.listingId}`}>{row.title}</Link>
                    <span>{money(row.priceMinor)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="stack">
            <h3>Orders</h3>
            {data.history.length === 0 ? <p className="muted">No orders yet.</p> : (
              <ul className="dsig">
                {data.history.map((row) => (
                  <li key={row.orderId} className="dsig__row">
                    <Link to={`/order/${row.orderId}`}>{row.itemName}</Link>
                    <span>{formatDate(row.placedAt)} · {money(row.totalMinor)}{row.owedMinor > 0 ? ` · owes ${money(row.owedMinor)}` : ''}</span>
                    {PUNCTUALITY_WORDS[row.punctuality] && <span className={`dtag dtag--${row.punctuality}`}>{PUNCTUALITY_WORDS[row.punctuality]}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(data.saves.length > 0 || data.checkouts.length > 0 || data.pledges.length > 0) && (
            <section className="stack">
              <h3>Wants</h3>
              <ul className="dsig">
                {data.checkouts.map((row) => (
                  <li key={row.orderId} className="dsig__row"><span>🛒 Pressed Buy on <Link to={`/listing/${row.listingId}`}>{row.itemName}</Link></span>
                    <NudgeButton request={{ kind: 'checkout', orderId: row.orderId }} shop={shop} /></li>
                ))}
                {data.saves.filter((row) => !row.bought).map((row) => (
                  <li key={row.listingId} className="dsig__row"><span>❤️ Saved <Link to={`/listing/${row.listingId}`}>{row.title}</Link> · {timeAgo(row.at)}</span>
                    {row.live && <NudgeButton request={{ kind: 'saved', listingId: row.listingId, buyerId: data.id }} shop={shop} />}</li>
                ))}
                {data.pledges.map((row) => (
                  <li key={row.listingId} className="dsig__row"><span>🙋 Pledged {row.units} for <Link to={`/listing/${row.listingId}`}>{row.title}</Link></span></li>
                ))}
              </ul>
            </section>
          )}

          {data.engagement && (
            <section className="stack">
              <h3>Takes part <span className="probadge">PRO</span></h3>
              <p className="muted">
                {[['votes', 'votes'], ['comments', 'comments'], ['entries', 'contest entries'], ['guesses', 'guesses'], ['reactions', 'reactions']]
                  .filter(([key]) => (data.engagement as unknown as Record<string, number>)[key!]! > 0)
                  .map(([key, word]) => `${(data.engagement as unknown as Record<string, number>)[key!]} ${word}`).join(' · ')}
                {' '}on your posts since {formatDate(data.engagement.firstAt)}.
              </p>
            </section>
          )}

          {(data.reviews.aboutShop.length > 0 || data.reviews.aboutThem.length > 0) && (
            <section className="stack">
              <h3>Reviews</h3>
              {data.reviews.aboutShop.map((row) => <p key={`s${row.orderId}`}><b>{'★'.repeat(row.rating)}</b> they wrote: {row.body || '(no words)'}</p>)}
              {data.reviews.aboutThem.map((row) => <p key={`t${row.orderId}`}><b>{'★'.repeat(row.rating)}</b> you wrote: {row.body || '(no words)'}</p>)}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ── Items ─────────────────────────────────────────────────────────────── */

export function ItemsDataSection({ store }: { store: StoreAccess }) {
  const [days, setDays] = usePeriod();
  const { data, error } = useOverview(store, days);
  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Loading />;
  const totalViews = data.views.bySource.reduce((sum, row) => sum + row.views, 0);
  return (
    <div className="stack">
      <div className="data__bar">
        <h2>Items</h2>
        <PeriodPicker days={days} onChange={setDays} />
      </div>
      <section className="dfigs">
        <Figure label="Views" now={data.current.views} before={data.previous.views} />
        <Figure label="Saves" now={data.current.saves} before={data.previous.saves} />
        <Figure label="Orders" now={data.current.orders} before={data.previous.orders} />
        <Figure label="Views to orders" now={data.current.conversion} before={data.previous.conversion} render={(value) => `${value}%`} />
      </section>

      <section className="card card--pad stack">
        <div>
          <h2>Views each day</h2>
          <span className="field__hint">Counted, never named: a shop sees how many looked, not who.</span>
        </div>
        <DayBars days={data.views.daily} label={`Views over the last ${days} days`} />
      </section>

      <section className="card card--pad stack">
        <h2>Where views come from</h2>
        {totalViews === 0 ? <p className="muted">No views counted in this period yet.</p> : data.views.bySource.map((row) => (
          <ShareRow key={row.source} label={VIEW_SOURCE_LABELS[row.source as ViewSource] ?? row.source} value={row.views} total={totalViews} />
        ))}
      </section>

      <section className="card card--pad stack">
        <h2>Each item</h2>
        {data.views.items.length === 0 ? <p className="muted">Nothing looked at in this period yet.</p> : (
          <div className="dtable-wrap">
            <table className="dtable">
              <thead><tr><th scope="col">Item</th><th scope="col">Views</th><th scope="col">Saves</th><th scope="col">Orders</th><th scope="col">Views to orders</th><th scope="col">Mostly from</th></tr></thead>
              <tbody>
                {data.views.items.map((row) => (
                  <tr key={row.listingId}>
                    <th scope="row"><Link to={`/listing/${row.listingId}`}>{row.title}</Link></th>
                    <td>{row.views}</td><td>{row.saves}</td><td>{row.orders}</td>
                    <td>{row.conversion == null ? '—' : `${row.conversion}%`}</td>
                    <td>{row.topSource ? VIEW_SOURCE_LABELS[row.topSource as ViewSource] ?? row.topSource : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ProBlock title="What buyers search for" note="Catalog searches in this period. Terms only, never who searched.">
        <div className="dsearch">
          <div>
            <h3>About what you sell</h3>
            {data.searches.matching.length === 0 ? <p className="muted">No searches matching your items yet.</p> : (
              <ul className="dsearch__list">{data.searches.matching.map((row) => <li key={row.term}><b>{row.term}</b> <span className="faint">{row.n}×</span></li>)}</ul>
            )}
          </div>
          <div>
            <h3>Found nothing</h3>
            {data.searches.unmet.length === 0 ? <p className="muted">Every search found something.</p> : (
              <ul className="dsearch__list">{data.searches.unmet.map((row) => <li key={row.term}><b>{row.term}</b> <span className="faint">{row.empty}× with no results</span></li>)}</ul>
            )}
            <small className="faint">Something to stock, or a word to add to your tags.</small>
          </div>
        </div>
      </ProBlock>

      <InsightsPanel store={store} only={['trending', 'funnel', 'pricing', 'bundles', 'returns', 'market', 'tags', 'timing']} title="More on items" />
    </div>
  );
}

/* ── Operations ────────────────────────────────────────────────────────── */

export function OperationsSection({ store }: { store: StoreAccess }) {
  const [days, setDays] = usePeriod();
  const { data, error } = useOverview(store, days);
  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Loading />;
  const { onTime, reply, cancellations } = data;
  return (
    <div className="stack">
      <div className="data__bar">
        <h2>Operations</h2>
        <PeriodPicker days={days} onChange={setDays} />
      </div>

      <section className="card card--pad stack">
        <div>
          <h2>On time</h2>
          <span className="field__hint">
            Orders that reached the buyer within the longest delivery time the item promised, over the last 90 days.
            Worked out from your orders: nothing to type. An order still out after its last day counts as late.
          </span>
        </div>
        <div className="dfigs">
          <Figure label="On time" now={onTime.rate == null ? null : Math.round(onTime.rate * 100)} render={(value) => `${value}%`}
            note={onTime.rate == null ? `Shown after 5 deliveries (${onTime.measured} so far)` : 'shown on your seller card'} />
          <Figure label="Arrived on time" now={onTime.onTime} />
          <Figure label="Arrived late" now={onTime.late} />
          <Figure label="Still out, past promise" now={onTime.overdue} />
        </div>
        {onTime.lateOrders.length > 0 && (
          <>
            <h3>Late and overdue</h3>
            <ul className="dsig">
              {onTime.lateOrders.map((row) => (
                <li key={row.orderId} className="dsig__row">
                  <Link to={`/order/${row.orderId}`}>{row.itemName}</Link>
                  <span>{row.who.name} · promised by {row.dueBy ? formatDate(row.dueBy) : '—'}</span>
                  <span className={`dtag dtag--${row.state}`}>{row.state === 'overdue' ? `${row.days} days over` : `${row.days} days late`}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {onTime.dueSoon.length > 0 && (
          <>
            <h3>Due within 5 days</h3>
            <ul className="dsig">
              {onTime.dueSoon.map((row) => (
                <li key={row.orderId} className="dsig__row">
                  <Link to={`/order/${row.orderId}`}>{row.itemName}</Link>
                  <span>{row.who.name} · by {row.dueBy ? formatDate(row.dueBy) : '—'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {onTime.listingsWithoutEta.length > 0 && (
          <p className="notice notice--warn">
            {onTime.listingsWithoutEta.length} live item{onTime.listingsWithoutEta.length === 1 ? ' has' : 's have'} no delivery time:{' '}
            {onTime.listingsWithoutEta.slice(0, 5).map((row, at) => (
              <span key={row.listingId}>{at > 0 ? ', ' : ''}<Link to={`/listing/${row.listingId}`}>{row.title}</Link></span>
            ))}. Open each and add one; new orders on them are not measured until you do.
          </p>
        )}
      </section>

      <section className="card card--pad stack">
        <div>
          <h2>Reply time</h2>
          <span className="field__hint">How long buyers wait for you, from your orders. Half your answers are quicker than this.</span>
        </div>
        <div className="dfigs dfigs--three">
          <Figure label="Answering a booking" now={reply.bookingHours} render={(value) => hours(value)} note={`${reply.bookings} booking${reply.bookings === 1 ? '' : 's'}`} />
          <Figure label="Confirming a payment" now={reply.claimHours} render={(value) => hours(value)} note={`${reply.claims} payment${reply.claims === 1 ? '' : 's'}`} />
          <Figure label="Waiting over a day" now={reply.waitingOverDay} />
        </div>
      </section>

      <section className="card card--pad stack">
        <div>
          <h2>Cancellations</h2>
          <span className="field__hint">Orders placed in the last {days} days that were turned down or called off.</span>
        </div>
        <div className="dfigs dfigs--three">
          <Figure label="Called off" now={cancellations.rate} render={(value) => `${value}%`} note={`${cancellations.calledOff} of ${cancellations.orders}`} />
          <Figure label="Turned down by you" now={cancellations.turnedDown} />
          <Figure label="Orders placed" now={cancellations.orders} />
        </div>
        {cancellations.reasons.length > 0 && (
          <ul className="dsig">
            {cancellations.reasons.map((row) => <li key={row.reason} className="dsig__row"><span>{row.reason}</span><b>{row.count}</b></li>)}
          </ul>
        )}
      </section>

      <InsightsPanel store={store} only={['lots', 'packing', 'forecast']} title="Lots and packing" />
    </div>
  );
}

/** The money section's Pro half: the profit book, filed here from Insights. */
export function MoneyProBlock({ store }: { store: StoreAccess }) {
  return <InsightsPanel store={store} only={['profit']} title="Real profit" />;
}

export type { DataPeriodFigures };
