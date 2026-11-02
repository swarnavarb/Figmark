import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { StoreMember, StoreRight } from '@shared/models';
import {
  ARTIST_JOB_FLOW, ARTIST_JOB_LABELS, STORE_KINDS, STORE_KIND_LABELS, STORE_RIGHTS, STORE_RIGHT_LABELS,
  applicationGaps, jobDueMinor, liveLanes, livePlans, type StoreKind,
} from '@shared/service-stores';
import {
  ApiRequestError, api, type ArtistJobRow, type ForwarderLotRow, type RequestRow, type StoreConsole, type StoreDraft, type StoreInsightsView, type StoreWork, type TeamRow,
} from '../api';
import { requestIsOpen, type ServiceRequest } from '@shared/service-work';
import type { InsightRow, StoreInsights } from '@shared/service-insights';
import {
  AnswerList, RequestActions, RequestLog, RequestRowCard, StoreChannel,
} from '../components/ServiceWorkKit';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatDate, formatMoney, formatWeight, timeAgo } from '../format';
import { MoneyInput, Picture, StatTile, StatusPill, StoreCover, StoreMark, accentStyle } from '../components/StoreKit';
import {
  BasicsSection, BusinessSection, CoverSection, ExtrasSection, LanesSection, MenuSection, PaymentTermsSection, PortfolioSection,
  RequestFormSection, WarehouseSection, type SectionProps,
} from '../components/StoreForm';
import { Timeline } from './StoreApplyPage';
import { PageLoading } from '../components/Feedback';
import '../styles/StoreConsolePage.css';

/**
 * A service store, from the inside.
 *
 * Four tabs, in the order a working day needs them: what is going on, the
 * work itself, the shopfront, and the people. Each one shows only to a member
 * holding the right it needs - a packer who can press buttons should not be
 * staring at a rate card they cannot change.
 */

type Tab = 'overview' | 'requests' | 'work' | 'insights' | 'channel' | 'store' | 'team';

export function StoreConsolePage() {
  const { kind: rawKind, ownerId: rawOwner } = useParams<{ kind: string; ownerId?: string }>();
  const kind = (STORE_KINDS as readonly string[]).includes(rawKind ?? '') ? (rawKind as StoreKind) : null;
  const { user } = useSession();
  const ownerId = rawOwner || user?.id || '';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'overview';

  const [console, setConsole] = useState<StoreConsole | null>(null);
  const [work, setWork] = useState<StoreWork | null>(null);
  const [requests, setRequests] = useState<{ requests: RequestRow[]; team: TeamRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!kind || !ownerId) return;
    try {
      const view = await api.storeConsole(kind, ownerId);
      setConsole(view);
      if (view.status === 'approved' && view.rights.includes('work')) {
        // Both at once: the dashboard draws when the slower of the two arrives, not the sum.
        const [lots, direct] = await Promise.all([api.storeWork(kind, ownerId), api.storeRequests(kind, ownerId)]);
        setWork(lots);
        setRequests(direct);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the store.');
    }
  }, [kind, ownerId]);

  useEffect(() => {
    if (user) void load();
  }, [load, user]);

  if (!kind) return <main className="page"><EmptyState icon="◌" title="No such store" /></main>;
  if (!user) return <main className="page"><EmptyState icon="◍" title="Sign in to open your store"><Link to="/" className="btn">Sign in</Link></EmptyState></main>;
  if (error && !console) {
    return (
      <main className="page">
        <BackLink to="/services/mine" title="Your store" />
        <EmptyState icon={<Icon name="lock" size={26} />} title="Not your store">
          {error} <Link to={`/services/apply/${kind}`}>Apply for one</Link>
        </EmptyState>
      </main>
    );
  }
  if (!console) return <PageLoading />;

  const store = console.store;
  const live = console.status === 'approved';
  const needsYou = (requests?.requests ?? []).filter((row) => row.actions.some((action) => action !== 'assign')).length;
  const tabs: { id: Tab; label: string; show: boolean; count?: number }[] = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'requests', label: 'Requests', show: live && console.rights.includes('work'), count: needsYou },
    { id: 'work', label: kind === 'forwarder' ? 'Shop lots' : 'Order commissions', show: live && console.rights.includes('work'),
      count: kind === 'forwarder' ? work?.lots.filter((row) => row.acceptance === 'pending').length : work?.jobs.filter((row) => row.actions.length > 0).length },
    { id: 'insights', label: 'Insights', show: live },
    { id: 'channel', label: 'Channel', show: live },
    { id: 'store', label: 'Store', show: console.rights.includes('store') },
    { id: 'team', label: 'Team', show: true },
  ];
  const go = (next: Tab) => setParams((current) => { const copy = new URLSearchParams(current); copy.set('tab', next); return copy; }, { replace: true });

  return (
    <main className="page sc-page" style={accentStyle(store.accent)}>
      <BackLink to="/services/mine">{store.companyName}</BackLink>
      <section className="sc-hero">
        <StoreCover kind={kind} coverUrl={store.coverUrl} accent={store.accent}>
          <div className="sc-hero__actions">
            {live && <Link to={`/services/${kind}/${store.directorySlug}`} className="btn btn--ghost btn--sm"><Icon name="external" size={14} /> Public page</Link>}
          </div>
        </StoreCover>
        <div className="sc-hero__id">
          <StoreMark name={store.companyName} logoUrl={store.logoUrl} accent={store.accent} size={72} />
          <div className="sc-hero__text">
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h1>{store.companyName}</h1>
              <StatusPill status={console.status} />
            </div>
            <span className="muted">{store.tagline || STORE_KIND_LABELS[kind].store}</span>
            <span className="faint">
              {console.isOwner ? 'You own this store' : `Member · ${console.rights.map((right) => STORE_RIGHT_LABELS[right].label.toLowerCase()).join(', ')}`}
            </span>
          </div>
        </div>
      </section>

      <div className="tabs sc-tabs">
        {tabs.filter((entry) => entry.show).map((entry) => (
          <button key={entry.id} type="button" className={`tab${tab === entry.id ? ' is-on' : ''}`} onClick={() => go(entry.id)}>
            {entry.label}{entry.count ? <span className="sc-tabs__count">{entry.count}</span> : null}
          </button>
        ))}
      </div>

      {error && <ErrorNotice message={error} />}

      {tab === 'overview' && <Overview kind={kind} console={console} work={work} requests={requests?.requests ?? []} onGo={go} />}
      {tab === 'requests' && requests && (
        <RequestsBoard kind={kind} ownerId={ownerId} rows={requests.requests} team={requests.team} focus={params.get('r')} startLinking={params.get('link') === '1'}
          onChanged={(next) => setRequests((current) => current ? {
            ...current, requests: current.requests.some((row) => row.request.id === next.request.id)
              ? current.requests.map((row) => (row.request.id === next.request.id ? next : row))
              : [next, ...current.requests],
          } : current)} />
      )}
      {tab === 'insights' && <InsightsPanel kind={kind} ownerId={ownerId} />}
      {tab === 'channel' && (
        <StoreChannel kind={kind} ownerId={ownerId} storeName={store.companyName}
          accentLogo={<StoreMark name={store.companyName} logoUrl={store.logoUrl} accent={store.accent} size={22} />} />
      )}
      {tab === 'work' && work && (kind === 'forwarder'
        ? <ForwarderLots ownerId={ownerId} rows={work.lots} onChanged={load} />
        : <CommissionBoard ownerId={ownerId} rows={work.jobs} onChanged={load} />)}
      {tab === 'store' && <StoreEditor kind={kind} console={console} onSaved={setConsole} />}
      {tab === 'team' && <TeamPanel kind={kind} console={console} onSaved={setConsole} />}
    </main>
  );
}

/* ── Insights ────────────────────────────────────────────────────────── */

/** "+12%" against last month, or nothing when there is nothing to compare. */
function change(now: number, before: number): string | null {
  if (!before) return null;
  const by = Math.round(((now - before) / before) * 100);
  return `${by >= 0 ? '+' : ''}${by}% on last month`;
}

const weekLabel = (start: string) => new Date(`${start}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Twelve weeks of one measure, one bar each, the value on hover and focus. */
function WeekBars({ title, weeks, value, format }: {
  title: string; weeks: StoreInsights['weeks']; value: (week: StoreInsights['weeks'][number]) => number; format: (n: number) => string;
}) {
  const most = Math.max(1, ...weeks.map(value));
  const total = weeks.reduce((sum, week) => sum + value(week), 0);
  return (
    <figure className="sc-chart">
      <figcaption><span>{title}</span><b>{format(total)}</b></figcaption>
      <div className="sc-chart__bars" role="list">
        {weeks.map((week) => {
          const n = value(week);
          return (
            <span key={week.start} role="listitem" tabIndex={0} className="sc-chart__bar" aria-label={`Week of ${weekLabel(week.start)}: ${format(n)}`}>
              <span className="sc-chart__fill" style={{ height: `${n ? Math.max(4, (n / most) * 100) : 0}%` }} />
              <span className="sc-chart__tip">{weekLabel(week.start)} · {format(n)}</span>
            </span>
          );
        })}
      </div>
      <div className="sc-chart__axis"><span>{weekLabel(weeks[0]!.start)}</span><span>This week</span></div>
    </figure>
  );
}

function RankList({ title, rows, money = true, empty }: { title: string; rows: InsightRow[]; money?: boolean; empty: string }) {
  const most = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="sc-rank">
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="faint">{empty}</p> : (
        <ol>
          {rows.map((row) => (
            <li key={row.label}>
              <span className="sc-rank__line"><span>{row.label}</span><b>{row.count}{money && row.minor ? ` · ${formatMoney(row.minor)}` : ''}</b></span>
              <span className="sc-rank__bar"><span style={{ width: `${(row.count / most) * 100}%` }} /></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The store's numbers, from its own requests: what customers ask for, what it earns, how fast it answers. */
function InsightsPanel({ kind, ownerId }: { kind: StoreKind; ownerId: string }) {
  const [data, setData] = useState<StoreInsightsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.storeInsights(kind, ownerId).then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the numbers.'));
  }, [kind, ownerId]);
  if (error) return <ErrorNotice message={error} />;
  if (!data) return <PageLoading />;
  const { insights: x, audience } = data;
  const t = x.totals;
  const funnel = [
    { label: 'Asked', n: t.requests + t.links },
    { label: 'Quoted', n: t.quoted },
    { label: 'Accepted', n: t.accepted },
    { label: 'Paid', n: t.paid },
    { label: kind === 'forwarder' ? 'Delivered' : 'Finished', n: t.delivered },
  ];
  const top = Math.max(1, funnel[0]!.n);
  const tiles = [
    { label: 'Confirmed this month', value: formatMoney(x.money.thisMonthMinor), note: change(x.money.thisMonthMinor, x.money.lastMonthMinor) ?? `${formatMoney(x.money.confirmedMinor)} in all` },
    { label: 'Requests', value: String(t.requests + t.links), note: t.links ? `${t.links} from payment links` : 'all time' },
    { label: 'Go ahead', value: funnel[0]!.n ? `${Math.round((t.paid / funnel[0]!.n) * 100)}%` : '—', note: 'asked → paid' },
    { label: 'Average order', value: x.money.averageOrderMinor ? formatMoney(x.money.averageOrderMinor) : '—', note: 'of those paid' },
    { label: 'First quote', value: x.speed.quoteHours === null ? '—' : x.speed.quoteHours < 1 ? '< 1 h' : `${Math.round(x.speed.quoteHours)} h`, note: 'on average' },
    { label: 'Rating', value: x.ratings.average === null ? '—' : `★ ${x.ratings.average}`, note: `${x.ratings.count} ${x.ratings.count === 1 ? 'review' : 'reviews'}` },
  ];
  return (
    <div className="stack sc-insights">
      <div className="sc-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="sc-tile"><span className="faint">{tile.label}</span><b>{tile.value}</b><small>{tile.note}</small></div>
        ))}
      </div>

      <div className="sc-charts">
        <WeekBars title="Requests a week" weeks={x.weeks} value={(week) => week.requests} format={(n) => String(n)} />
        <WeekBars title="Money confirmed a week" weeks={x.weeks} value={(week) => week.minor} format={(n) => formatMoney(n)} />
      </div>

      <section className="sc-funnel" aria-label="How far requests get">
        <h3>How far requests get</h3>
        {funnel.map((step) => (
          <div key={step.label} className="sc-funnel__row">
            <span>{step.label}</span>
            <span className="sc-funnel__bar"><span style={{ width: `${(step.n / top) * 100}%` }} /></span>
            <b>{step.n}</b>
          </div>
        ))}
        {(t.declined > 0 || t.cancelled > 0) && <p className="faint">{t.declined} declined · {t.cancelled} cancelled</p>}
        {kind === 'forwarder' && x.kgBilled > 0 && <p className="faint">{x.kgBilled} kg billed on accepted requests{x.speed.deliveryDays !== null ? ` · ${x.speed.deliveryDays} days to deliver on average` : ''}</p>}
      </section>

      <div className="sc-ranks">
        <RankList title={kind === 'forwarder' ? 'Top routes' : 'Top services'} rows={x.subjects} empty="No requests yet." />
        <RankList title={kind === 'forwarder' ? 'What they send' : 'Which size'} rows={x.products} empty="Nobody picked a product price yet." />
        <RankList title="Extras ticked" rows={x.extras} empty="No extras ticked yet." />
        <RankList title="Where customers are" rows={x.places} money={false} empty="No delivery addresses yet." />
      </div>

      <section className="sc-rank">
        <h3>Customers <span className="faint">· {x.customers.total} in all · {x.customers.repeat} came back · {x.customers.newThisMonth} new this month</span></h3>
        {x.customers.top.length === 0 ? <p className="faint">Nobody yet.</p> : (
          <ol>
            {x.customers.top.map((person) => (
              <li key={`${person.name}-${person.handle}`}>
                <span className="sc-rank__line">
                  <span>{person.handle ? <Link to={`/${person.handle}`}>{person.name}</Link> : person.name}</span>
                  <b>{person.count} {person.count === 1 ? 'order' : 'orders'}{person.minor ? ` · ${formatMoney(person.minor)}` : ''}</b>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="sc-rank">
        <h3>On Social <span className="faint">· {audience.followers} followers · {audience.posts} posts · {audience.reactions} reactions · {audience.comments} comments</span></h3>
        {audience.best.length === 0 ? <p className="faint">Post from the + button to reach your followers and Discover.</p> : (
          <ol>
            {audience.best.map((post) => (
              <li key={post.id}>
                <span className="sc-rank__line">
                  <Link to={`/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`}>{post.body || 'Photo post'}</Link>
                  <b>{post.reactions} ♥ · {post.comments} 💬</b>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="faint">Money counts only payments your team confirmed. Customers pay you directly, so that is the figure you can stand behind.</p>
    </div>
  );
}

/* ── Overview ────────────────────────────────────────────────────────── */

function Overview({ kind, console, work, requests, onGo }: { kind: StoreKind; console: StoreConsole; work: StoreWork | null; requests: RequestRow[]; onGo: (tab: Tab) => void }) {
  const store = console.store;
  const history = store.application?.history ?? [];
  const decision = [...history].reverse().find((event) => event.status !== 'pending');

  if (console.status !== 'approved') {
    return (
      <div className="stack">
        <div className={`sc-banner sc-banner--${console.status}`}>
          <StatusPill status={console.status} />
          <p>
            {console.status === 'pending' && 'Your application is with Figmark. Nothing is public yet — you can still edit it.'}
            {console.status === 'changes' && `Figmark asked for changes: “${decision?.note ?? ''}”`}
            {console.status === 'rejected' && `Not approved: “${decision?.note ?? ''}”`}
            {console.status === 'suspended' && `Suspended: “${decision?.note ?? ''}” Your store is hidden and cannot take work.`}
          </p>
          {console.isOwner && console.status !== 'suspended' && (
            <Link to={`/services/apply/${kind}`} className="btn btn--sm">{console.status === 'pending' ? 'View application' : 'Fix and resend'}</Link>
          )}
        </div>
        <Timeline history={history} />
      </div>
    );
  }

  const fresh = requests.filter((row) => row.request.status === 'submitted').length;
  const toConfirm = requests.filter((row) => row.actions.includes('confirm_payment')).length;
  const direct = (
    <>
      {(fresh > 0 || toConfirm > 0) && (
        <button type="button" className="sc-callout" onClick={() => onGo('requests')}>
          <span className="sc-callout__ping">{fresh + toConfirm}</span>
          <span><b>{fresh > 0 ? `${fresh} new ${fresh === 1 ? 'request' : 'requests'}` : ''}{fresh > 0 && toConfirm > 0 ? ' · ' : ''}
            {toConfirm > 0 ? `${toConfirm} ${toConfirm === 1 ? 'payment' : 'payments'} to confirm` : ''}</b> from customers.</span>
          <Icon name="right" size={16} />
        </button>
      )}
      <div className="sc-stats">
        <StatTile value={requests.filter((row) => requestIsOpen(row.request) && row.request.status !== 'submitted').length} label="Requests on" tone="accent" />
        <StatTile value={requests.filter((row) => row.request.status === 'delivered').length} label="Delivered" tone="ok" />
        <StatTile value={formatMoney(requests.filter((row) => row.request.payment?.confirmedAt).reduce((sum, row) => sum + row.request.payment!.amountMinor, 0))} label="Taken direct" />
        <StatTile value={(() => {
          const rated = requests.map((row) => row.request.review?.stars).filter((stars): stars is number => Boolean(stars));
          return rated.length ? `★ ${(rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1)}` : '—';
        })()} label="Rating" />
      </div>
    </>
  );

  if (kind === 'forwarder') {
    const lots = work?.lots ?? [];
    const taken = lots.filter((row) => row.acceptance === 'accepted');
    const pending = lots.filter((row) => row.acceptance === 'pending');
    return (
      <div className="stack">
        {direct}
        <h3 className="sc-sub">Lots from shops</h3>
        <div className="sc-stats">
          <StatTile value={pending.length} label="Lot requests" tone={pending.length ? 'warn' : undefined} />
          <StatTile value={taken.filter((row) => row.lot.status !== 'closed').length} label="Lots on" tone="accent" />
          <StatTile value={formatWeight(taken.reduce((sum, row) => sum + row.weightGrams, 0))} label="Booked weight" />
          <StatTile value={formatMoney(lots.reduce((sum, row) => sum + row.premiumsMinor, 0))} label="Cover sold" tone="ok" />
        </div>
        {pending.length > 0 && (
          <button type="button" className="sc-callout" onClick={() => onGo('work')}>
            <span className="sc-callout__ping">{pending.length}</span>
            <span><b>{pending.length === 1 ? 'A shop wants' : `${pending.length} shops want`} you on a lot.</b> Accept or decline to start.</span>
            <Icon name="right" size={16} />
          </button>
        )}
        <div className="sc-glance">
          <Glance title="Lanes on sale" value={liveLanes(store).length} onClick={() => onGo('store')} />
          <Glance title="Cover plans" value={livePlans(store).length} onClick={() => onGo('store')} />
          <Glance title="Bookings" value={store.autoAccept === false ? 'You approve each' : 'Auto-accepted'} onClick={() => onGo('store')} />
          <Glance title="Team" value={`${1 + (store.team?.length ?? 0)} people`} onClick={() => onGo('team')} />
        </div>
      </div>
    );
  }

  const jobs = work?.jobs ?? [];
  const live = jobs.filter((row) => !['completed', 'declined', 'cancelled'].includes(row.job.status));
  return (
    <div className="stack">
      {direct}
      <h3 className="sc-sub">Commissions on orders</h3>
      <div className="sc-stats">
        <StatTile value={jobs.filter((row) => row.actions.length > 0).length} label="Need you" tone={jobs.some((row) => row.actions.length) ? 'warn' : undefined} />
        <StatTile value={live.length} label="In progress" tone="accent" />
        <StatTile value={jobs.filter((row) => row.job.status === 'completed').length} label="Completed" tone="ok" />
        <StatTile value={formatMoney(jobs.filter((row) => row.job.payments.some((p) => p.confirmedAt)).reduce((sum, row) => sum + (row.job.quoteMinor ?? 0), 0))} label="Booked" />
      </div>
      <div className="sc-glance">
        <Glance title="On the menu" value={(store.offerings ?? []).filter((row) => row.active).length} onClick={() => onGo('store')} />
        <Glance title="Portfolio" value={`${(store.portfolio ?? []).length} pieces`} onClick={() => onGo('store')} />
        <Glance title="Commissions" value={store.acceptingWork === false ? 'Closed' : 'Open'} onClick={() => onGo('store')} />
        <Glance title="Team" value={`${1 + (store.team?.length ?? 0)} people`} onClick={() => onGo('team')} />
      </div>
    </div>
  );
}

function Glance({ title, value, onClick }: { title: string; value: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="sc-glance__cell" onClick={onClick}>
      <span className="faint">{title}</span>
      <b>{value}</b>
    </button>
  );
}

/* ── Direct requests ─────────────────────────────────────────────────── */

/**
 * Every request customers sent, and every payment link the team made - one
 * board the whole team works from. Grouped by who has to move next, so the
 * top of the list is always the work.
 */
function RequestsBoard({ kind, ownerId, rows, team, focus, startLinking, onChanged }: {
  kind: StoreKind; ownerId: string; rows: RequestRow[]; team: TeamRow[]; focus: string | null; startLinking: boolean; onChanged: (row: RequestRow) => void;
}) {
  const [open, setOpen] = useState<string | null>(focus);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [linking, setLinking] = useState(startLinking);
  const { user } = useSession();
  const visible = rows.filter((row) => filter === 'all' || row.request.assigneeId === user?.id);
  const groups: { title: string; rows: RequestRow[] }[] = [
    { title: 'Needs you', rows: visible.filter((row) => row.actions.some((action) => action !== 'assign')) },
    { title: 'Waiting on the customer', rows: visible.filter((row) => requestIsOpen(row.request) && !row.actions.some((action) => action !== 'assign')) },
    { title: 'Finished', rows: visible.filter((row) => !requestIsOpen(row.request)) },
  ];

  return (
    <div className="stack">
      <div className="sc-reqbar">
        <div className="sc-filter" role="radiogroup" aria-label="Show">
          <button type="button" className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>Everyone’s</button>
          <button type="button" className={filter === 'mine' ? 'is-on' : ''} onClick={() => setFilter('mine')}>Assigned to me</button>
        </div>
        <button type="button" className="btn btn--sm" onClick={() => setLinking(!linking)}><Icon name="link" size={14} /> {linking ? 'Close' : 'New payment link'}</button>
      </div>
      {linking && <PaymentLinkForm kind={kind} ownerId={ownerId} onMade={(row) => { onChanged(row); setLinking(false); setOpen(row.request.id); }} />}
      {rows.length === 0 && !linking && (
        <EmptyState icon={<Icon name={kind === 'forwarder' ? 'plane' : 'spark'} size={26} />} title="No requests yet">
          Customers send one from a {kind === 'forwarder' ? 'route' : 'service'} on your page. Or make a payment link for a custom job and send it to them.
        </EmptyState>
      )}
      {groups.filter((group) => group.rows.length > 0).map((group) => (
        <section key={group.title} className="stack">
          <h3 className="sc-sub">{group.title} <span className="faint">{group.rows.length}</span></h3>
          {group.rows.map((row) => (
            <div key={row.request.id} className={`sc-req${open === row.request.id ? ' is-open' : ''}`}>
              <button type="button" className="sc-req__toggle" onClick={() => setOpen(open === row.request.id ? null : row.request.id)} aria-expanded={open === row.request.id}>
                <RequestRowCard request={row.request} due={row.due} side="store" actions={row.actions} />
              </button>
              {open === row.request.id && <RequestDetail kind={kind} row={row} team={team} onChanged={onChanged} />}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function RequestDetail({ kind, row, team, onChanged }: { kind: StoreKind; row: RequestRow; team: TeamRow[]; onChanged: (row: RequestRow) => void }) {
  const { request } = row;
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/services/requests/${kind}/${request.ownerId}/${request.id}`;
  return (
    <div className="sc-req__body stack">
      {request.origin === 'link' && (
        <div className="sc-req__link">
          <span className="faint">Payment link — send it to the customer</span>
          <span className="sc-req__url">{link}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); }}>
            <Icon name="copy" size={13} /> {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
      {request.description && <p className="sc-req__desc">{request.description}</p>}
      {request.customerHandle && <Link to={`/messages/${request.customerHandle}`} className="btn btn--ghost btn--sm sc-req__msg"><Icon name="message" size={13} /> Message {request.customerName}</Link>}
      {request.option && <p className="faint">Price picked: {request.option.name}</p>}
      {request.plan && <p className="faint">Cover: {request.plan.name} · {request.plan.premiumMinor ? `premium ${formatMoney(request.plan.premiumMinor)}` : 'free'}{request.plan.coverMinor ? ` · covers ${formatMoney(request.plan.coverMinor)}` : ''}</p>}
      {(request.addons?.length ?? 0) > 0 && <p className="faint">Extras: {request.addons!.map((row) => `${row.name} (${row.priceMinor ? formatMoney(row.priceMinor) : 'free'})`).join(', ')}</p>}
      {request.external && <p className="faint">They filled in your own form — check it there.</p>}
      <AnswerList fields={request.fields} answers={request.answers} />
      {request.payment && (
        <p className={`sc-req__pay${request.payment.confirmedAt ? ' is-ok' : ''}`}>
          {request.payment.confirmedAt ? '✓ Payment confirmed' : 'Customer says they paid'} {formatMoney(request.payment.amountMinor)}
          {request.payment.reference ? ` · ref ${request.payment.reference}` : ''}
        </p>
      )}
      <RequestActions view={{ ...row, side: 'store', payTo: null, sendTo: [] }} team={team}
        onChanged={(next) => onChanged({ request: next.request, actions: next.actions, due: next.due })} />
      <RequestLog request={request} />
    </div>
  );
}

function PaymentLinkForm({ kind, ownerId, onMade }: { kind: StoreKind; ownerId: string; onMade: (row: RequestRow) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(0);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function make(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { request } = await api.createPaymentLink(kind, ownerId, { title, description, amountMinor: amount, days: Number(days) || undefined });
      onMade({ request, actions: [], due: request.quoteMinor ?? 0 } as RequestRow & { request: ServiceRequest });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="sa-card stack" onSubmit={(event) => void make(event)}>
      <div className="sa-card__head"><h2>Payment link</h2>
        <span className="muted">For a custom job: say what it is and the price, then send the link. Whoever opens it accepts and pays you direct.</span></div>
      <label className="field"><span>What it is for</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'forwarder' ? 'Sea freight, 3 statue boxes, Guangzhou → Mumbai' : 'Custom head sculpt + repaint, 1/6 Batman'} /></label>
      <label className="field"><span>Details</span>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is included, what is not, how long it takes." /></label>
      <div className="field-row">
        <label className="field"><span>Price</span><MoneyInput label="Price" value={amount} onChange={setAmount} /></label>
        <label className="field"><span>Days</span><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
      </div>
      {error && <ErrorNotice message={error} />}
      <button type="submit" className="btn" disabled={busy || !title.trim() || !amount}>Create link</button>
    </form>
  );
}

/* ── Forwarder: lots ─────────────────────────────────────────────────── */

function ForwarderLots({ ownerId, rows, onChanged }: { ownerId: string; rows: ForwarderLotRow[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = rows.filter((row) => row.acceptance === 'pending');
  const taken = rows.filter((row) => row.acceptance === 'accepted');
  const declined = rows.filter((row) => row.acceptance === 'declined');

  async function respond(row: ForwarderLotRow, accept: boolean) {
    setBusy(row.lot.id);
    setError(null);
    try {
      await api.respondToLot(ownerId, { sellerId: row.lot.sellerId, lotId: row.lot.id, accept });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={<Icon name="plane" size={26} />} title="No lots yet">
        When a shop books you on a lot it lands here, with its weight and the lane it picked.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {error && <ErrorNotice message={error} />}
      {pending.length > 0 && <h3 className="sc-sub">Waiting for your answer</h3>}
      {pending.map((row) => (
        <article key={row.lot.id} className="sc-lot sc-lot--pending">
          <LotHead row={row} />
          <div className="sc-lot__acts">
            <button type="button" className="btn" disabled={busy === row.lot.id} onClick={() => void respond(row, true)}>
              <Icon name="check" size={14} /> Accept lot
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy === row.lot.id} onClick={() => void respond(row, false)}>Decline</button>
          </div>
        </article>
      ))}
      {taken.length > 0 && <h3 className="sc-sub">On the move</h3>}
      {taken.map((row) => (
        <Link key={row.lot.id} to={`/services/crew/${row.lot.sellerId}/${row.lot.id}?role=forwarder`} className="sc-lot sc-lot--tap">
          <LotHead row={row} />
          <span className="sc-lot__go">Work this lot <Icon name="right" size={14} /></span>
        </Link>
      ))}
      {declined.length > 0 && (
        <details className="sc-declined">
          <summary>{declined.length} declined</summary>
          {declined.map((row) => <div key={row.lot.id} className="sc-lot sc-lot--off"><LotHead row={row} /></div>)}
        </details>
      )}
    </div>
  );
}

function LotHead({ row }: { row: ForwarderLotRow }) {
  const progress = row.lot.steps > 1 ? Math.max(0, row.lot.stepIndex) / (row.lot.steps - 1) : 0;
  return (
    <>
      <span className="sc-lot__top">
        <span className="sc-lot__name">{row.lot.name} <span className="faint">{row.lot.number}</span></span>
        <span className="faint">{row.store.name}</span>
      </span>
      {row.laneLabel && <span className="sc-lot__lane"><Icon name="plane" size={13} /> {row.laneLabel}</span>}
      <span className="ms-crew__bar" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>
      <span className="sc-lot__stats">
        <span><b>{row.pieces}</b> orders</span>
        <span><b>{formatWeight(row.weightGrams)}</b></span>
        <span className={row.covered ? 'sc-lot__cov' : ''}>🛡 <b>{row.covered}</b> insured{row.premiumsMinor ? ` · ${formatMoney(row.premiumsMinor)}` : ''}</span>
        <span className="faint">{row.lot.step}</span>
      </span>
    </>
  );
}

/* ── Artist: commissions ─────────────────────────────────────────────── */

function CommissionBoard({ ownerId, rows, onChanged }: { ownerId: string; rows: ArtistJobRow[]; onChanged: () => Promise<void> }) {
  const groups: { title: string; rows: ArtistJobRow[] }[] = [
    { title: 'Needs you', rows: rows.filter((row) => row.actions.length > 0) },
    { title: 'Waiting on the buyer', rows: rows.filter((row) => row.actions.length === 0 && ['quoted', 'accepted', 'shipped', 'ready'].includes(row.job.status)) },
    { title: 'Finished', rows: rows.filter((row) => ['completed', 'declined', 'cancelled'].includes(row.job.status)) },
  ];
  if (rows.length === 0) {
    return (
      <EmptyState icon={<Icon name="spark" size={26} />} title="No commissions yet">
        Buyers commission you from an order. Each one lands here to quote.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      {groups.filter((group) => group.rows.length > 0).map((group) => (
        <section key={group.title} className="stack">
          <h3 className="sc-sub">{group.title} <span className="faint">{group.rows.length}</span></h3>
          {group.rows.map((row) => <JobCard key={row.orderId} ownerId={ownerId} row={row} onChanged={onChanged} />)}
        </section>
      ))}
    </div>
  );
}

function JobProgress({ status }: { status: string }) {
  const at = ARTIST_JOB_FLOW.indexOf(status as typeof ARTIST_JOB_FLOW[number]);
  return (
    <span className="sc-flow" aria-hidden="true">
      {ARTIST_JOB_FLOW.map((step, index) => <span key={step} className={index <= at ? 'is-on' : ''} />)}
    </span>
  );
}

function JobCard({ ownerId, row, onChanged }: { ownerId: string; row: ArtistJobRow; onChanged: () => Promise<void> }) {
  const { job } = row;
  const [open, setOpen] = useState(row.actions.length > 0);
  const [quote, setQuote] = useState(job.quoteMinor ?? 0);
  const [days, setDays] = useState(String(job.turnaroundDays ?? ''));
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = ARTIST_JOB_LABELS[job.status];

  async function act(event: FormEvent | null, action: ArtistJobRow['actions'][number]) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.artistAct(ownerId, row.orderId, {
        action, quoteMinor: quote, days: Number(days) || undefined, note: note || undefined,
        photos: photo ? [photo] : undefined, courier, awb,
      });
      setNote('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`sc-job sc-job--${label.tone}`}>
      <button type="button" className="sc-job__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="sc-job__title">
          <span className="sc-job__item">{row.item.name}</span>
          <span className="faint">{job.offeringName} · for {row.buyer.name}{row.shop ? ` · bought from ${row.shop.name}` : ''}</span>
        </span>
        <span className={`badge badge--${label.tone === 'quiet' ? 'quiet' : label.tone}`}>{label.label}</span>
      </button>
      <JobProgress status={job.status} />
      {open && (
        <div className="sc-job__body stack">
          <blockquote className="sc-job__brief">{job.brief}</blockquote>
          {job.refUrls.length > 0 && (
            <div className="sc-job__refs">
              {job.refUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><Icon name="image" size={14} /> Reference</a>)}
            </div>
          )}
          <div className="sc-job__facts">
            {job.quoteMinor !== null && <span>Quote <b>{formatMoney(job.quoteMinor)}</b>{job.turnaroundDays ? ` · ${job.turnaroundDays} days` : ''}</span>}
            {job.method && <span>{job.method === 'protected' ? `🔒 Held by Figmark${job.managerName ? ` · ${job.managerName}` : ''}` : '↗ Paid direct'} · {formatMoney(jobDueMinor(job))}</span>}
            {job.payments.some((payment) => !payment.confirmedAt) && (
              <span className="sc-job__claim">Buyer says they paid {formatMoney(job.payments.find((p) => !p.confirmedAt)!.amountMinor)}
                {job.payments.find((p) => !p.confirmedAt)!.reference ? ` · ref ${job.payments.find((p) => !p.confirmedAt)!.reference}` : ''}</span>
            )}
          </div>

          {row.actions.includes('quote') && (
            <form className="sc-job__form" onSubmit={(event) => void act(event, 'quote')}>
              <label className="field"><span>Your price</span><MoneyInput label="Quote" value={quote} onChange={setQuote} /></label>
              <label className="field"><span>Days</span><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
              <label className="field sc-job__wide"><span>Note to the buyer</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Includes priming and gloss coat. Ship it to me once paid." /></label>
              <div className="row sc-job__wide">
                <button type="submit" className="btn" disabled={busy || !quote}>{job.status === 'quoted' ? 'Update quote' : 'Send quote'}</button>
                {row.actions.includes('decline') && (
                  <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void act(null, 'decline')}>Decline</button>
                )}
              </div>
            </form>
          )}
          {row.actions.includes('confirm_payment') && (
            <button type="button" className="btn" disabled={busy} onClick={() => void act(null, 'confirm_payment')}>
              <Icon name="check" size={14} /> The money arrived
            </button>
          )}
          {row.actions.includes('start') && (
            <button type="button" className="btn" disabled={busy} onClick={() => void act(null, 'start')}>Piece is here — start work</button>
          )}
          {row.actions.includes('ready') && (
            <div className="sc-job__form">
              <label className="field sc-job__wide"><span>Photo of the finished piece (link)</span>
                <input value={photo} onChange={(e) => setPhoto(e.target.value)} placeholder="https://…" /></label>
              <button type="button" className="btn sc-job__wide" disabled={busy} onClick={() => void act(null, 'ready')}>Mark finished</button>
            </div>
          )}
          {row.actions.includes('ship') && (
            <div className="sc-job__form">
              <label className="field"><span>Courier</span><input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Delhivery" /></label>
              <label className="field"><span>AWB</span><input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="1234567890" /></label>
              <button type="button" className="btn sc-job__wide" disabled={busy} onClick={() => void act(null, 'ship')}>Shipped back to the buyer</button>
            </div>
          )}
          {job.photos.length > 0 && (
            <div className="sc-job__photos">{job.photos.map((url) => <Picture key={url} url={url} label="Finished" className="sk-pic" />)}</div>
          )}
          {error && <ErrorNotice message={error} />}
          <ol className="sc-job__log">
            {[...job.history].reverse().map((event, index) => (
              <li key={`${event.at}-${index}`}><span>{event.note}</span><span className="faint">{timeAgo(event.at)}</span></li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}

/* ── Store editor ────────────────────────────────────────────────────── */

const SECTIONS: Record<StoreKind, { id: string; label: string; render: (props: SectionProps) => ReactNode }[]> = {
  forwarder: [
    { id: 'lanes', label: 'Routes & prices', render: (p) => <LanesSection {...p} /> },
    { id: 'cover', label: 'Transit cover', render: (p) => <CoverSection {...p} /> },
    { id: 'extras', label: 'Extras', render: (p) => <ExtrasSection {...p} /> },
    { id: 'warehouse', label: 'Warehouse & bookings', render: (p) => <WarehouseSection {...p} /> },
    { id: 'form', label: 'Shipping form', render: (p) => <RequestFormSection {...p} /> },
    { id: 'terms', label: 'Payments & terms', render: (p) => <PaymentTermsSection {...p} /> },
    { id: 'basics', label: 'Look & about', render: (p) => <BasicsSection {...p} /> },
    { id: 'business', label: 'Contact & links', render: (p) => <BusinessSection {...p} /> },
  ],
  artist: [
    { id: 'menu', label: 'Menu', render: (p) => <MenuSection {...p} /> },
    { id: 'portfolio', label: 'Portfolio & studio', render: (p) => <PortfolioSection {...p} /> },
    { id: 'extras', label: 'Extras', render: (p) => <ExtrasSection {...p} /> },
    { id: 'form', label: 'Request form', render: (p) => <RequestFormSection {...p} /> },
    { id: 'terms', label: 'Payments & terms', render: (p) => <PaymentTermsSection {...p} /> },
    { id: 'basics', label: 'Look & about', render: (p) => <BasicsSection {...p} /> },
    { id: 'business', label: 'Contact & links', render: (p) => <BusinessSection {...p} /> },
  ],
};

function StoreEditor({ kind, console, onSaved }: { kind: StoreKind; console: StoreConsole; onSaved: (next: StoreConsole) => void }) {
  const [section, setSection] = useState(SECTIONS[kind][0]!.id);
  const [draft, setDraft] = useState<StoreDraft>({ ...console.store });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<StoreDraft>) => { setDraft((current) => ({ ...current, ...patch })); setDirty(true); setSaved(false); };
  const gaps = applicationGaps(kind, draft);
  const current = SECTIONS[kind].find((entry) => entry.id === section)!;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveStore(kind, console.ownerId, draft);
      onSaved(next);
      setDraft({ ...next.store });
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sc-editor">
      <nav className="sc-editor__nav" aria-label="Store sections">
        {SECTIONS[kind].map((entry) => (
          <button key={entry.id} type="button" className={`sc-editor__link${entry.id === section ? ' is-on' : ''}`} onClick={() => setSection(entry.id)}>
            {entry.label}
          </button>
        ))}
      </nav>
      <section className="sa-card">
        <div className="sa-card__head"><h2>{current.label}</h2>
          {console.status === 'approved' && <span className="muted">Changes go live the moment you save.</span>}
        </div>
        {current.render({ kind, draft, set })}
        {error && <ErrorNotice message={error} />}
        {console.status === 'approved' && gaps.length > 0 && <p className="faint">A live store still needs: {gaps.join(', ')}.</p>}
        <div className="sc-savebar">
          <span className="faint">{saved ? '✓ Saved' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
          <button type="button" className="btn" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </section>
    </div>
  );
}

/* ── Team ────────────────────────────────────────────────────────────── */

function TeamPanel({ kind, console, onSaved }: { kind: StoreKind; console: StoreConsole; onSaved: (next: StoreConsole) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [rights, setRights] = useState<StoreRight[]>(['work']);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manages = console.rights.includes('team');
  const team = console.store.team ?? [];

  async function run(body: Parameters<typeof api.storeTeam>[2]) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.storeTeam(kind, console.ownerId, body));
      setIdentifier('');
      setTag('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="sc-people">
        <div className="sc-person">
          <StoreMark name={console.ownerName} accent={console.store.accent} size={40} />
          <span className="sc-person__body">
            <b>{console.ownerName}</b>
            <span className="faint">Owner · everything</span>
          </span>
        </div>
        {team.map((member) => (
          <div key={member.userId} className="sc-person">
            <StoreMark name={member.displayName} accent={console.store.accent} size={40} />
            <span className="sc-person__body">
              <b>{member.displayName}</b>
              <span className="sc-person__rights">
                {member.tag && <span className="ms-btnchip sc-person__tag">{member.tag}</span>}
                {member.rights.map((right) => <span key={right} className="ms-btnchip">{STORE_RIGHT_LABELS[right].label}</span>)}
              </span>
              <span className="faint">Added {formatDate(member.addedAt)}</span>
              {manages && <MemberEditor key={`${member.userId}-${member.tag ?? ''}-${member.rights.join()}`} member={member} busy={busy}
                onSave={(patch) => void run({ member: member.userId, ...patch })} />}
            </span>
            {manages && (
              <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void run({ remove: member.userId })}>Remove</button>
            )}
          </div>
        ))}
      </div>
      {manages ? (
        <form className="sa-card stack" onSubmit={(event) => { event.preventDefault(); void run({ identifier, rights, tag }); }}>
          <div className="sa-card__head">
            <h2>Add someone</h2>
            <span className="muted">They get this store under My services, with only what you tick.</span>
          </div>
          <div className="field-row">
            <label className="field"><span>Their @handle, email or phone</span>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="@chen_ops" /></label>
            <label className="field"><span>Tag <span className="faint">(optional)</span></span>
              <input value={tag} maxLength={24} onChange={(e) => setTag(e.target.value)} placeholder="Admin, Ops lead, Painter" /></label>
          </div>
          <div className="sc-rights">
            {STORE_RIGHTS.map((right) => (
              <label key={right} className={`sc-right${rights.includes(right) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={rights.includes(right)}
                  onChange={(e) => setRights(e.target.checked ? [...rights, right] : rights.filter((row) => row !== right))} />
                <span><b>{STORE_RIGHT_LABELS[right].label}</b><span className="faint">{STORE_RIGHT_LABELS[right].hint}</span></span>
              </label>
            ))}
          </div>
          {error && <ErrorNotice message={error} />}
          <p className="faint">The tag shows beside their name when they talk in the channel as themselves. “Speak as the company” lets them post under {console.store.companyName}.</p>
          <button type="submit" className="btn" disabled={busy || !identifier.trim() || rights.length === 0}>Add to the team</button>
        </form>
      ) : (
        <p className="faint">Only someone who can manage people adds or removes members.</p>
      )}
    </div>
  );
}

/** A member's tag and rights, changed in place. */
function MemberEditor({ member, busy, onSave }: { member: StoreMember; busy: boolean; onSave: (patch: { tag: string; rights: StoreRight[] }) => void }) {
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState(member.tag ?? '');
  const [rights, setRights] = useState<StoreRight[]>(member.rights);
  if (!open) return <button type="button" className="btn btn--quiet btn--sm sc-person__edit" onClick={() => setOpen(true)}>Tag & rights</button>;
  return (
    <span className="sc-person__editor">
      <input value={tag} maxLength={24} onChange={(e) => setTag(e.target.value)} placeholder="Tag — Admin, Ops lead…" aria-label="Tag" />
      <span className="sc-person__ticks">
        {STORE_RIGHTS.map((right) => (
          <label key={right} className="tick">
            <input type="checkbox" checked={rights.includes(right)} onChange={(e) => setRights(e.target.checked ? [...rights, right] : rights.filter((row) => row !== right))} />
            <span>{STORE_RIGHT_LABELS[right].label}</span>
          </label>
        ))}
      </span>
      <span className="row">
        <button type="button" className="btn btn--sm" disabled={busy || rights.length === 0} onClick={() => onSave({ tag, rights })}>Save</button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(false)}>Cancel</button>
      </span>
    </span>
  );
}
