import { useCallback, useEffect, useState } from 'react';
import type { StoreStatus } from '@shared/models';
import { STORE_KIND_LABELS, type StoreKind } from '@shared/service-stores';
import { ApiRequestError, admin } from './api';
import type { OpsStoreRow } from '../api';
import { formatDate, timeAgo } from '../format';
import { LaneTicket, OfferingCard, PlanCard, PortfolioGrid, StatusPill, StoreCover, StoreMark, accentStyle } from '../components/StoreKit';
import { Timeline } from '../pages/StoreApplyPage';

/**
 * Service store applications, and every store already open.
 *
 * A forwarder will quote rates shops plan whole lots around and sell cover to
 * their buyers; an artist will take somebody's figure away to repaint it. So
 * the operator reads the whole application - the business, the lanes, the
 * cover terms, the work - before anything goes live, and every decision
 * other than approval says why, because the person reading "changes
 * requested" has to know which changes.
 */

type Filter = 'waiting' | 'approved' | 'all';
const DECISIONS: { id: StoreStatus; label: string; tone: string; needsNote: boolean }[] = [
  { id: 'approved', label: 'Approve', tone: '', needsNote: false },
  { id: 'changes', label: 'Ask for changes', tone: 'btn--ghost', needsNote: true },
  { id: 'rejected', label: 'Reject', tone: 'btn--danger', needsNote: true },
];

export function StoresView() {
  const [rows, setRows] = useState<OpsStoreRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('waiting');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await admin.stores()).stores);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the stores.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!rows) return error ? <p className="notice notice--error">{error}</p> : <p className="muted">Loading…</p>;

  const waiting = rows.filter((row) => row.status === 'pending');
  const shown = rows.filter((row) =>
    filter === 'waiting' ? row.status === 'pending' || row.status === 'changes'
      : filter === 'approved' ? row.status === 'approved' : true);

  return (
    <div className="stack">
      <div className="ops-st__head">
        <div>
          <h2>Service stores</h2>
          <p className="muted">Forwarding companies and artist studios open only once an operator approves them.</p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Filter">
          {(['waiting', 'approved', 'all'] as Filter[]).map((entry) => (
            <button key={entry} type="button" role="radio" aria-checked={filter === entry} className={filter === entry ? 'is-on' : ''}
              onClick={() => setFilter(entry)}>
              {entry === 'waiting' ? `Waiting (${waiting.length})` : entry === 'approved' ? 'Live' : 'All'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      {shown.length === 0 && <p className="muted">Nothing here. {filter === 'waiting' ? 'The queue is empty.' : ''}</p>}
      {shown.map((row) => {
        const key = `${row.kind}-${row.owner.id}`;
        return (
          <StoreReview key={key} row={row} open={open === key} onToggle={() => setOpen(open === key ? null : key)} onDecided={load} />
        );
      })}
    </div>
  );
}

function StoreReview({ row, open, onToggle, onDecided }: { row: OpsStoreRow; open: boolean; onToggle: () => void; onDecided: () => Promise<void> }) {
  const { store } = row;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: StoreStatus) {
    setBusy(true);
    setError(null);
    try {
      await admin.reviewStore(row.kind as StoreKind, row.owner.id, { decision, note });
      setNote('');
      await onDecided();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`ops-st${open ? ' is-open' : ''}`} style={accentStyle(store.accent)}>
      <button type="button" className="ops-st__row" onClick={onToggle} aria-expanded={open}>
        <StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={42} />
        <span className="ops-st__id">
          <b>{store.name}</b>
          <span className="faint">{STORE_KIND_LABELS[row.kind as StoreKind].store} · {row.owner.displayName} · {row.owner.email}</span>
        </span>
        <span className="ops-st__when faint">{row.submittedAt ? `sent ${timeAgo(row.submittedAt)}` : 'no application'}</span>
        <StatusPill status={row.status} />
      </button>

      {open && (
        <div className="ops-st__body">
          <div className="ops-st__grid">
            <div className="stack">
              <StoreCover kind={row.kind as StoreKind} coverUrl={store.coverUrl} accent={store.accent} />
              <p className="ops-st__about">{store.about}</p>
              {row.kind === 'forwarder' ? (
                <>
                  <h3>Lanes</h3>
                  {store.lanes.length === 0 ? <p className="faint">None.</p> : store.lanes.map((lane) => <LaneTicket key={lane.id} lane={lane} accent={store.accent} />)}
                  <h3>Cover plans</h3>
                  {store.insurance.length === 0 ? <p className="faint">None — buyers will not be offered cover.</p>
                    : <div className="ops-st__plans">{store.insurance.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>}
                </>
              ) : (
                <>
                  <h3>Portfolio</h3>
                  {store.portfolio.length === 0 ? <p className="faint">No pictures.</p> : <PortfolioGrid pieces={store.portfolio} />}
                  <h3>Menu</h3>
                  <div className="ops-st__plans">{store.offerings.map((offering) => <OfferingCard key={offering.id} offering={offering} />)}</div>
                </>
              )}
            </div>
            <aside className="stack">
              <dl className="ops-st__facts">
                <div><dt>Registration</dt><dd>{row.businessId || <span className="faint">not given</span>}</dd></div>
                <div><dt>Based</dt><dd>{[store.city, store.country].filter(Boolean).join(', ') || '—'}</dd></div>
                <div><dt>Since</dt><dd>{store.since ?? '—'}</dd></div>
                <div><dt>Contact</dt><dd>{[store.contactEmail, store.contactPhone].filter(Boolean).join(' · ') || '—'}</dd></div>
                <div><dt>Account</dt><dd>{row.owner.username ? `@${row.owner.username}` : row.owner.id} · joined {formatDate(row.owner.createdAt)}</dd></div>
                {row.kind === 'forwarder'
                  ? <div><dt>Warehouse</dt><dd>{store.warehouse?.address || '—'}</dd></div>
                  : <div><dt>Studio</dt><dd>{row.studioAddress || '—'}</dd></div>}
                {row.kind === 'artist' && <div><dt>Direct pay</dt><dd>{row.payment ? 'Set up' : 'Protected only'}</dd></div>}
                <div><dt>Team</dt><dd>{1 + row.team.length}</dd></div>
              </dl>
              {store.links.length > 0 && (
                <div className="ops-st__links">
                  {store.links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>)}
                </div>
              )}
              <Timeline history={row.history} />
              <div className="ops-st__decide stack">
                <label className="field">
                  <span>Note to the applicant</span>
                  <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder={row.status === 'approved' ? 'Why it is being suspended' : 'Required for anything but approval'} />
                </label>
                {error && <p className="notice notice--error">{error}</p>}
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {row.status === 'approved' ? (
                    <button type="button" className="btn btn--danger" disabled={busy || !note.trim()} onClick={() => void decide('suspended')}>Suspend store</button>
                  ) : row.status === 'suspended' ? null : DECISIONS.map((decision) => (
                    <button key={decision.id} type="button" className={`btn ${decision.tone}`}
                      disabled={busy || (decision.needsNote && !note.trim())} onClick={() => void decide(decision.id)}>
                      {decision.label}
                    </button>
                  ))}
                  {row.status === 'suspended' && (
                    <button type="button" className="btn" disabled={busy} onClick={() => void decide('approved')}>Reinstate</button>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}
    </article>
  );
}
