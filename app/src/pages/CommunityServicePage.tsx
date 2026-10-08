import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DISPUTE_STATUS_LABELS } from '@shared/enums';
import { ApiRequestError, api, type CommunityDesk, type EscrowHolding } from '../api';
import { EmptyState, ErrorNotice, PersonLink } from '../components/ui';
import { formatDateOrdinal, formatMoney, timeAgo } from '../format';

type Tab = 'waiting' | 'all' | 'held' | 'earnings';

/** What happened to a payment, in words rather than the state's name. */
const HELD_LABELS: Record<string, string> = {
  held: 'Holding',
  disputed: 'Frozen - disputed',
  released: 'Released to the seller',
  refunded: 'Refunded to the buyer',
  none: 'Not held',
};

/**
 * Services → My Job → Community Service.
 *
 * Only community managers - the people Figmark appointed - reach it. Their
 * whole job on one screen: the disputes waiting on their decision (oldest
 * deadline first), every case they have held a round of, the payments they
 * hold under buyer protection (with the ones ready to release), and what
 * they have earned. And one switch: whether they are taking new disputes.
 */
export function CommunityServicePage() {
  const [desk, setDesk] = useState<CommunityDesk | null>(null);
  const [held, setHeld] = useState<{ heldMinor: number; holdings: EscrowHolding[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('waiting');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cases, holdings] = await Promise.all([api.communityCases(), api.escrowHoldings()]);
      setDesk(cases);
      setHeld(holdings);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your desk.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !desk) return <main className="page tab-view"><ErrorNotice message={error} /></main>;
  if (!desk || !held) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  const waiting = desk.cases.filter((row) => row.waitingOnMe)
    .sort((a, b) => (a.decideBy ?? '').localeCompare(b.decideBy ?? ''));
  const releasable = held.holdings.filter((row) => row.releasable);
  const currency = held.holdings[0]?.order.currency ?? 'INR';

  async function toggle() {
    setBusy(true);
    try {
      await api.communityAvailability(!desk!.manager.available);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page tab-view">
      <div className="page__head">
        <div>
          <h1>Community Service</h1>
          <p className="muted">{desk.manager.name} · community manager since {formatDateOrdinal(desk.manager.since)}</p>
        </div>
        <button type="button" className={`btn btn--sm ${desk.manager.available ? 'btn--ghost' : ''}`} disabled={busy}
          onClick={() => void toggle()}>
          {desk.manager.available ? '● Taking new disputes' : '○ Not taking new disputes'}
        </button>
      </div>

      <div className="card card--pad" style={{ marginBottom: 18 }}>
        <div className="tiles tiles--big">
          <Tile value={String(waiting.length)} label="Need your decision" />
          <Tile value={String(desk.openCases)} label="Open cases" />
          <Tile value={formatMoney(held.heldMinor, currency)} label="Holding" />
          <Tile value={formatMoney(desk.earnings.totalMinor, 'INR')} label="Earned" />
        </div>
        <p className="faint" style={{ margin: '12px 0 0' }}>
          {desk.stats.decided} decided
          {desk.stats.averageHoursToDecide !== null && ` · ${desk.stats.averageHoursToDecide < 1 ? 'under an hour' : `${desk.stats.averageHoursToDecide}h`} to decide on average`}
          {' '}· {desk.stats.overturned} overturned on escalation
        </p>
      </div>

      <div className="tabs tabs--vivid" style={{ marginBottom: 14 }}>
        <button type="button" className={`tab${tab === 'waiting' ? ' is-on' : ''}`} onClick={() => setTab('waiting')}>
          Waiting {waiting.length}
        </button>
        <button type="button" className={`tab${tab === 'all' ? ' is-on' : ''}`} onClick={() => setTab('all')}>
          All {desk.cases.length}
        </button>
        <button type="button" className={`tab${tab === 'held' ? ' is-on' : ''}`} onClick={() => setTab('held')}>
          Held {releasable.length > 0 ? `· ${releasable.length} to release` : held.holdings.length}
        </button>
        <button type="button" className={`tab${tab === 'earnings' ? ' is-on' : ''}`} onClick={() => setTab('earnings')}>
          Earnings
        </button>
      </div>

      {error && <ErrorNotice message={error} />}

      {(tab === 'waiting' || tab === 'all') && (() => {
        const rows = tab === 'waiting' ? waiting : desk.cases;
        if (rows.length === 0) {
          return (
            <EmptyState title={tab === 'waiting' ? 'Nothing waiting on you' : 'No cases yet'}>
              Disputes reach you when a member picks you, when a purchase you hold is disputed, or when the system
              assigns you an escalation because you are available.
            </EmptyState>
          );
        }
        return (
          <ul className="rfhist">
            {rows.map((row) => (
              <li key={row.id} className={`rfhist__row rfhist__row--${row.waitingOnMe ? 'not_received' : 'received'}`}>
                <span className="rfhist__icon" aria-hidden="true">⚖️</span>
                <span className="rfhist__body">
                  <b><Link to={`/dispute/${row.id}`}>{row.about}{row.protected ? ' · protected' : ''}</Link></b>
                  <small>{row.raiser} vs {row.respondent} · round {row.round}{row.myRounds.length > 0 && ` (you: ${row.myRounds.join(', ')})`}</small>
                  <small>“{row.reason}”</small>
                  {row.decideBy && <small className={row.overdue ? 'is-danger' : ''}>Decide by {formatDateOrdinal(row.decideBy)}{row.overdue ? ' - overdue' : ''}</small>}
                </span>
                <span className="rfhist__side">
                  <span className={`badge ${row.waitingOnMe ? 'badge--danger' : row.result ? 'badge--ok' : ''}`}>
                    {row.waitingOnMe ? 'Your decision' : row.result?.how === 'settled' ? 'Settled' : DISPUTE_STATUS_LABELS[row.status]}
                  </span>
                  {row.releasable && <span className="badge badge--accent">Release due</span>}
                </span>
              </li>
            ))}
          </ul>
        );
      })()}

      {tab === 'held' && (held.holdings.length === 0 ? (
        <EmptyState title="Nothing in your name">
          Buyers choose who holds their buyer protection at checkout. Anything they pick you for lands here.
        </EmptyState>
      ) : (
        <div className="stack">
          {held.holdings.map((row) => (
            <article key={row.order.id} className="card card--pad stack">
              <div className="row row--between">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>{row.order.itemName}</div>
                  <span className="faint"><PersonLink party={row.buyer} /> → <PersonLink party={row.seller} /></span>
                </div>
                <span className="badge badge--accent">{formatMoney(row.order.escrow.amountMinor, row.order.currency)}</span>
              </div>
              <span className={`badge badge--${row.order.escrow.state === 'disputed' ? 'warn' : row.order.escrow.state === 'held' ? 'accent' : ''}`} style={{ justifySelf: 'start' }}>
                {HELD_LABELS[row.order.escrow.state] ?? row.order.escrow.state}
              </span>
              {row.dispute && (
                <>
                  <p className="muted" style={{ margin: 0 }}>
                    Disputed {timeAgo(row.dispute.createdAt)} ·{' '}
                    {row.releasable ? 'final - release it as decided' : row.decidable ? 'waiting on your decision' : DISPUTE_STATUS_LABELS[row.dispute.status]}
                  </p>
                  <Link to={`/dispute/${row.dispute.id}`} className={`btn btn--sm ${row.releasable || row.decidable ? '' : 'btn--quiet'}`}
                    style={{ justifySelf: 'start' }}>
                    {row.releasable ? 'Release the payment' : row.decidable ? 'Decide it' : 'Read the thread'}
                  </Link>
                </>
              )}
            </article>
          ))}
        </div>
      ))}

      {tab === 'earnings' && (desk.earnings.payments.length === 0 ? (
        <EmptyState title="Nothing earned yet">
          You earn a share of every dispute, escalation and protection fee paid on cases you hold, after Figmark's
          commission. Fees are set by Figmark and paid through the payment gateway.
        </EmptyState>
      ) : (
        <ul className="rfhist">
          {desk.earnings.payments.map((entry) => (
            <li key={entry.id} className="rfhist__row rfhist__row--received">
              <span className="rfhist__icon" aria-hidden="true">₹</span>
              <span className="rfhist__body">
                <b>{entry.kind === 'protection' ? 'Buyer protection' : entry.kind === 'escalation' ? 'Escalation' : 'Dispute'} fee</b>
                <small>{formatDateOrdinal(entry.paidAt)} · paid {formatMoney(entry.amountMinor, entry.currency)}</small>
              </span>
              <span className="rfhist__side"><b>{formatMoney(entry.shareMinor, entry.currency)}</b></span>
            </li>
          ))}
        </ul>
      ))}
    </main>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="tile">
      <div className="tile__value" style={{ fontSize: 'var(--t-lg)' }}>{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}
