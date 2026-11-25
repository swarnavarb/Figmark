import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, admin } from './api';
import { timeAgo } from '../format';
import { SkelRows } from '../components/PageSkeletons';

type Row = Awaited<ReturnType<typeof admin.dnaReports>>['reports'][number];

const DOUBT_WHY: Record<NonNullable<Row['doubt']>['why'], string> = {
  'same-photo': 'its photo is the same as listings still on it',
  'same-thing-in-photo': 'the same thing shows in listings still on it',
  'looks-same': 'the photos look like the same product',
  'same-name': 'it has the very same name',
};

const SELLER_SAID: Record<NonNullable<Row['sellerSaid']>, string> = {
  right: 'The shop says it is right',
  moved: 'The shop moved it',
};

/**
 * Listings people said are on the wrong Product DNA, open first.
 *
 * Each card has what it takes to settle it in one or two taps: the listing
 * and the product it is on, how many said no and yes, what the shop did.
 * "Fix on the product page" opens the product with its split and merge
 * tools; then mark it fixed - or that it was right all along.
 */
export function DnaReportsView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await admin.dnaReports()).reports);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the reports.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="notice notice--error">{error}</p>;
  if (!rows) return <SkelRows n={5} />;
  const open = rows.filter((row) => row.status === 'open');
  const done = rows.filter((row) => row.status !== 'open');
  return (
    <div className="stack">
      <p className="faint">{open.length} waiting · {done.length} settled</p>
      {open.length === 0 && <p className="muted">Nothing waiting. Nobody has said a listing is on the wrong product.</p>}
      {open.map((row) => <ReportCard key={row.id} row={row} onDone={load} />)}
      {done.length > 0 && (
        <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start' }} onClick={() => setShowDone((now) => !now)}>
          {showDone ? 'Hide settled' : `Show settled (${done.length})`}
        </button>
      )}
      {showDone && done.map((row) => <ReportCard key={row.id} row={row} onDone={load} />)}
    </div>
  );
}

function ReportCard({ row, onDone }: { row: Row; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settle = async (status: 'fixed' | 'right' | 'open') => {
    setBusy(status);
    setError(null);
    try {
      await admin.resolveDnaReport(row.id, status);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  };
  const isOpen = row.status === 'open';
  const moved = row.dnaNow && row.dnaNow.id !== row.dnaId;
  const productId = row.dnaNow?.id ?? row.dnaId;
  return (
    <div className="card card--pad stack">
      <div className="row row--between">
        <b>{row.doubt ? '🧬 Shop said “not this” - sure?' : '🧬 Wrong product?'}</b>
        <span className={`badge badge--${isOpen ? 'warn' : row.status === 'fixed' ? 'ok' : 'accent'}`}>
          {isOpen ? 'Open' : row.status === 'fixed' ? 'Fixed' : 'Was right'}
        </span>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        {row.photoUrl && <img src={row.photoUrl} alt="" width={56} height={56} style={{ borderRadius: 10, objectFit: 'cover', flex: 'none' }} />}
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span><b>Listing</b> “{row.listingTitle}”</span>
          <span><b>On product</b> “{row.dnaNow?.name ?? row.dnaName}”{moved ? ' (since merged)' : ''}</span>
        </div>
      </div>
      {row.doubt && (
        <p className="notice">
          The shop moved it {row.doubt.movedTo ? <>to “{row.doubt.movedTo.name}”</> : 'to a product of its own'}, but Figmark doubts it: {DOUBT_WHY[row.doubt.why]}.
          {' '}Keep the move with <b>Shop is right</b>, or put it back from the product page.
        </p>
      )}
      <span className="faint">
        {row.no} said no · {row.yes} said yes{row.sellerSaid ? ` · ${SELLER_SAID[row.sellerSaid]}` : ' · The shop has not answered'}
        {' · '}{timeAgo(row.updatedAt)}
      </span>
      {error && <p className="notice notice--error">{error}</p>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <a className="btn btn--sm" href={`/dna/${encodeURIComponent(productId)}`} target="_blank" rel="noreferrer">Fix on the product page</a>
        <a className="btn btn--sm btn--quiet" href={`/listing/${encodeURIComponent(row.listingId)}`} target="_blank" rel="noreferrer">See the listing</a>
        {isOpen ? (
          <>
            <button type="button" className="btn btn--sm btn--ok" disabled={busy !== null} onClick={() => void settle('fixed')}>
              {busy === 'fixed' ? 'Saving…' : row.doubt ? 'Shop is right' : 'Mark fixed'}
            </button>
            {!row.doubt && (
              <button type="button" className="btn btn--sm btn--quiet" disabled={busy !== null} onClick={() => void settle('right')}>
                {busy === 'right' ? 'Saving…' : 'It was right'}
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn btn--sm btn--quiet" disabled={busy !== null} onClick={() => void settle('open')}>Open again</button>
        )}
      </div>
    </div>
  );
}
