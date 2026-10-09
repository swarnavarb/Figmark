import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DISPUTE_STATUS_LABELS } from '@shared/enums';
import { ApiRequestError, api, type CommunityDesk } from '../api';
import { EmptyState, ErrorNotice } from '../components/ui';
import { formatDateOrdinal, formatMoney } from '../format';

type Tab = 'waiting' | 'all' | 'earnings';

/**
 * Services → My Job → Community Service.
 *
 * Only community managers - the people Figmark appointed - reach it. Their
 * whole job on one screen: the disputes waiting on their decision (oldest
 * deadline first) and the held payments agreed and waiting for them to
 * release, every case they have held a round of, and what they have earned.
 * Managers never hold money - Figmark holds every protected payment.
 * And one switch: whether they are taking new disputes.
 */
export function CommunityServicePage() {
  const [desk, setDesk] = useState<CommunityDesk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('waiting');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDesk(await api.communityCases());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your desk.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !desk) return <main className="page tab-view"><ErrorNotice message={error} /></main>;
  if (!desk) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  const waiting = desk.cases.filter((row) => row.waitingOnMe)
    .sort((a, b) => (a.decideBy ?? '').localeCompare(b.decideBy ?? ''));

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
              Disputes reach you when a member picks you, when a purchase you were assigned to under buyer
              protection is disputed, or when the system assigns you one because you are available.
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
                  {row.decideBy && <small className={row.overdue ? 'is-danger' : ''}>{row.releaseDue ? 'Release by' : 'Decide by'} {formatDateOrdinal(row.decideBy)}{row.overdue ? ' - overdue' : ''}</small>}
                </span>
                <span className="rfhist__side">
                  <span className={`badge ${row.waitingOnMe ? 'badge--danger' : row.result ? 'badge--ok' : ''}`}>
                    {row.releaseDue ? 'Release due' : row.waitingOnMe ? 'Your decision' : row.result?.how === 'settled' ? 'Settled' : DISPUTE_STATUS_LABELS[row.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        );
      })()}


      {tab === 'earnings' && (desk.earnings.payments.length === 0 ? (
        <EmptyState title="Nothing earned yet">
          You earn a share of every buyer protection fee on purchases you are assigned to, and of every dispute
          and escalation fee paid on cases you hold, after Figmark's commission. Fees are set by Figmark and paid through the payment gateway.
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
