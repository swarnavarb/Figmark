import type { ReactNode } from 'react';
import type { OpsOverview, OverviewActivity, OverviewPeople } from '@shared/overview';
import { formatMoney, timeAgo } from '../format';
import { Icon, type IconName } from '../components/Icon';
import { goOps } from './nav';
import type { Tab } from './sections';

/**
 * The console's first screen: what needs an operator now, then how many people
 * are here and how many of them are around, then the money and the plumbing.
 *
 * Everything on it comes from one request (GET /ops/overview), held by the
 * console so the menu's counts and this screen never disagree. A section whose
 * read failed says so in its own tile; the rest of the screen still draws.
 */
export function DashboardView({ data, error, busy, onRefresh }: {
  data: OpsOverview | null;
  error: string | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="opsdash">
      <header className="opsdash__head">
        <div className="opsdash__title">
          <h1>Overview</h1>
          <span className="faint" aria-live="polite">
            {busy ? 'Updating…' : data ? `Updated ${timeAgo(data.at)}` : ''}
          </span>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRefresh} disabled={busy}>
          <span className={busy ? 'opsdash__spin' : undefined} aria-hidden="true"><Icon name="repost" size={14} /></span>
          Refresh
        </button>
      </header>

      {error && <p className="notice notice--error">{error}</p>}

      {!data ? (error ? null : <DashSkeleton />) : (
        <>
          <Attention queues={data.queues} />
          <Headline people={data.people} activity={data.activity} />
          <div className="opsdash__grid">
            <Signups people={data.people} />
            <Activity activity={data.activity} />
          </div>
          <div className="opsdash__grid">
            <Money money={data.money} />
            <div className="opsdash__side">
              <Email email={data.email} />
              <Recent recent={data.recent} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const count = new Intl.NumberFormat('en-IN');
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const big = (value: number) => (value >= 100_000 ? compact.format(value) : count.format(value));
const share = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/* ── What is waiting ──────────────────────────────────────────────────── */

interface Queue {
  tab: Tab;
  label: string;
  icon: IconName;
  value: number | null;
  /** Said under the number; the most urgent fact about this queue. */
  note: string;
  tone: 'danger' | 'warn' | 'calm';
}

function Attention({ queues }: { queues: OpsOverview['queues'] }) {
  const overdue = queues.disputesOverdue ?? 0;
  const list: Queue[] = [
    {
      tab: 'disputes', label: 'Open disputes', icon: 'forum', value: queues.disputesOpen,
      note: overdue > 0 ? `${overdue} past deadline` : queues.releasesPending ? `${queues.releasesPending} awaiting release` : 'None overdue',
      tone: overdue > 0 ? 'danger' : queues.disputesOpen ? 'warn' : 'calm',
    },
    {
      tab: 'approvals', label: 'Approvals', icon: 'check', value: queues.actionsPending,
      note: 'Sanctions to decide', tone: queues.actionsPending ? 'warn' : 'calm',
    },
    {
      tab: 'reports', label: 'Reports', icon: 'megaphone', value: queues.reportsOpen,
      note: 'Reviews and comments', tone: queues.reportsOpen ? 'warn' : 'calm',
    },
    {
      tab: 'stores', label: 'Store applications', icon: 'box', value: queues.storesPending,
      note: 'Forwarders and artists', tone: queues.storesPending ? 'warn' : 'calm',
    },
  ];
  const waiting = list.reduce((sum, queue) => sum + (queue.value ?? 0), 0);

  return (
    <section className="opsdash__section" aria-labelledby="opsopsdash-attention">
      <div className="opsdash__label">
        <h2 id="opsopsdash-attention">Needs attention</h2>
        {waiting === 0 && list.every((queue) => queue.value !== null) && (
          <span className="badge badge--ok"><Icon name="check" size={12} /> All clear</span>
        )}
      </div>
      <div className="opsdash__queues">
        {list.map((queue) => (
          <button key={queue.tab} type="button" className={`opsdash__queue opsdash__queue--${queue.tone}`} onClick={() => goOps(queue.tab)}>
            <span className="opsdash__queue-icon" aria-hidden="true"><Icon name={queue.icon} size={18} /></span>
            <span className="opsdash__queue-text">
              <span className="opsdash__queue-label">{queue.label}</span>
              <strong className="opsdash__queue-value">{queue.value === null ? '—' : count.format(queue.value)}</strong>
              <span className="opsdash__queue-note">{queue.value === null ? 'Could not be counted' : queue.note}</span>
            </span>
            <span className="opsdash__queue-go" aria-hidden="true"><Icon name="right" size={16} /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ── The headline numbers ─────────────────────────────────────────────── */

function Headline({ people, activity }: { people: OverviewPeople | null; activity: OverviewActivity | null }) {
  return (
    <section className="opsdash__kpis" aria-label="Key figures">
      <Kpi label="Active today" value={activity && big(activity.day)} accent
        hint={activity && `${share(activity.day, activity.month)}% of this month's`} />
      <Kpi label="Active this week" value={activity && big(activity.week)}
        hint={activity && `${share(activity.week, activity.reporting)}% of people counted`} />
      <Kpi label="Active this month" value={activity && big(activity.month)}
        hint={activity && `of ${big(activity.reporting)} with a device on record`} />
      <Kpi label="People" value={people && big(people.total)}
        hint={people && (people.new7d > 0 ? `+${big(people.new7d)} this week` : 'No new accounts this week')}
        up={Boolean(people && people.new7d > 0)} />
    </section>
  );
}

function Kpi({ label, value, hint, accent, up }: {
  label: string; value: string | null; hint: string | null; accent?: boolean; up?: boolean;
}) {
  return (
    <div className={`card opsdash__kpi${accent ? ' opsdash__kpi--accent' : ''}`}>
      <span className="opsdash__kpi-label">{label}</span>
      <strong className="opsdash__kpi-value">{value ?? '—'}</strong>
      <span className={`opsdash__kpi-hint${up ? ' opsdash__kpi-hint--up' : ''}`}>
        {up && <Icon name="rising" size={12} />}
        {value === null ? 'Could not be counted' : hint}
      </span>
    </div>
  );
}

/* ── New accounts, a bar a day ────────────────────────────────────────── */

const dayLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Signups({ people }: { people: OverviewPeople | null }) {
  if (!people) return <Panel title="New accounts"><Unavailable /></Panel>;
  const days = people.signups;
  const max = Math.max(...days, 1);
  const today = Date.now();
  const dateOf = (index: number) => dayLabel.format(new Date(today - (days.length - 1 - index) * 86_400_000));
  const peak = Math.max(...days);

  return (
    <Panel title="New accounts" aside={<span className="faint">Last {days.length} days</span>}>
      <div className="opsdash__figures">
        <Figure value={big(people.new30d)} label="this month" />
        <Figure value={big(people.new7d)} label="this week" />
        <Figure value={big(people.new1d)} label="today" />
      </div>
      <div className="opsdash__bars" role="img"
        aria-label={`New accounts per day over the last ${days.length} days: ${people.new30d} in all, at most ${peak} in one day.`}>
        {days.map((value, index) => (
          <span key={index} className="opsdash__bar" tabIndex={0} data-tip={`${dateOf(index)} · ${value}`}
            aria-label={`${dateOf(index)}: ${value}`}>
            <span className="opsdash__bar-fill" style={{ height: value === 0 ? undefined : `${Math.max(6, (value / max) * 100)}%` }} />
          </span>
        ))}
      </div>
      <div className="opsdash__axis faint" aria-hidden="true">
        <span>{dateOf(0)}</span>
        <span>Today</span>
      </div>
    </Panel>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <span className="opsdash__figure">
      <strong>{value}</strong>
      <span className="faint">{label}</span>
    </span>
  );
}

/* ── Who is around ────────────────────────────────────────────────────── */

function Activity({ activity }: { activity: OverviewActivity | null }) {
  if (!activity) return <Panel title="Activity"><Unavailable /></Panel>;
  if (activity.reporting === 0) {
    return (
      <Panel title="Activity">
        <p className="muted opsdash__empty">Nobody has reported a device yet. Figures appear once people sign in on the new version.</p>
      </Panel>
    );
  }
  const whole = activity.reporting;
  const rows: [string, number][] = [
    ['Last 24 hours', activity.day],
    ['Last 7 days', activity.week],
    ['Last 30 days', activity.month],
    ['On the home screen', activity.installed],
    ['Notifications on', activity.pushOn],
  ];
  return (
    <Panel title="Activity" aside={<button type="button" className="opsdash__link" onClick={() => goOps('devices')}>Devices</button>}>
      <ul className="opsdash__meters">
        {rows.map(([label, value], index) => (
          <li key={label} className={index === 3 ? 'opsdash__meter opsdash__meter--split' : 'opsdash__meter'}>
            <span className="opsdash__meter-label">{label}</span>
            <span className="opsdash__meter-track" aria-hidden="true">
              <span className="opsdash__meter-fill" style={{ width: `${share(value, whole)}%` }} />
            </span>
            <span className="opsdash__meter-value">
              {big(value)} <span className="faint">{share(value, whole)}%</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="field__hint">Out of {big(whole)} people whose signed-in devices have reported in.</p>
    </Panel>
  );
}

/* ── Money ────────────────────────────────────────────────────────────── */

function Money({ money }: { money: OpsOverview['money'] }) {
  return (
    <Panel title="Fees collected" aside={<button type="button" className="opsdash__link" onClick={() => goOps('payments')}>Ledger</button>}>
      {!money ? <Unavailable /> : (
        <>
          <div className="opsdash__money">
            <strong className="opsdash__money-value">{formatMoney(money.collectedMinor)}</strong>
            <span className="faint">all time · {formatMoney(money.last30dMinor)} from {count.format(money.payments30d)} payment{money.payments30d === 1 ? '' : 's'} in the last 30 days</span>
          </div>
          <dl className="opsdash__split">
            <div><dt>Figmark commission</dt><dd>{formatMoney(money.commissionMinor)}</dd></div>
            <div><dt>To community managers</dt><dd>{formatMoney(money.managerShareMinor)}</dd></div>
          </dl>
        </>
      )}
    </Panel>
  );
}

/* ── Email quota ──────────────────────────────────────────────────────── */

function Email({ email }: { email: OpsOverview['email'] }) {
  return (
    <Panel title="Email sends today">
      {!email ? <Unavailable /> : email.length === 0 ? <p className="muted opsdash__empty">No email provider is configured.</p> : (
        <ul className="opsdash__meters">
          {email.map((provider) => {
            const used = share(provider.today, provider.dailyLimit);
            const tone = provider.exhaustedToday || used >= 90 ? ' opsdash__meter--danger' : used >= 70 ? ' opsdash__meter--warn' : '';
            return (
              <li key={provider.name} className={`opsdash__meter${tone}`}>
                <span className="opsdash__meter-label opsdash__meter-label--cap">{provider.name}</span>
                <span className="opsdash__meter-track" aria-hidden="true">
                  <span className="opsdash__meter-fill" style={{ width: `${Math.min(100, used)}%` }} />
                </span>
                <span className="opsdash__meter-value">
                  {provider.exhaustedToday ? 'Used up' : `${count.format(provider.today)} / ${count.format(provider.dailyLimit)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ── What operators did ───────────────────────────────────────────────── */

function Recent({ recent }: { recent: OpsOverview['recent'] }) {
  return (
    <Panel title="Recent operator actions" aside={<button type="button" className="opsdash__link" onClick={() => goOps('audit')}>Audit trail</button>}>
      {!recent ? <Unavailable /> : recent.length === 0 ? <p className="muted opsdash__empty">Nothing in the last three days.</p> : (
        <ul className="opsdash__feed">
          {recent.map((entry) => (
            <li key={entry.id}>
              <span className={`opsdash__dot${entry.status >= 400 ? ' opsdash__dot--bad' : ''}`} aria-hidden="true" />
              <span className="opsdash__feed-main">
                <code>{entry.action}</code>
                <span className="faint">{entry.actorEmail ?? 'system'}</span>
              </span>
              <span className="faint opsdash__feed-when">{timeAgo(entry.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card card--pad opsdash__panel">
      <div className="opsdash__label">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Unavailable() {
  return <p className="muted opsdash__empty">Could not be read just now. Refresh to try again.</p>;
}

/** The screen's shape before the numbers arrive, so nothing jumps when they do. */
function DashSkeleton() {
  return (
    <div className="opsdash" aria-busy="true" aria-label="Loading the overview">
      <div className="opsdash__queues">
        {[0, 1, 2, 3].map((key) => <span key={key} className="skel opsdash__skel-queue" />)}
      </div>
      <div className="opsdash__kpis">
        {[0, 1, 2, 3].map((key) => <span key={key} className="skel opsdash__skel-kpi" />)}
      </div>
      <div className="opsdash__grid">
        <span className="skel opsdash__skel-panel" />
        <span className="skel opsdash__skel-panel" />
      </div>
    </div>
  );
}
