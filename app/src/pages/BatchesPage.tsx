import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LOT_STAGES, LOT_STAGE_LABELS } from '@shared/enums';
import { nextStage } from '@shared/fulfilment';
import type { Lot } from '@shared/models';
import { ApiRequestError, api, type LotContents, type LotsResponse } from '../api';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatDate, formatMoney, formatWeight } from '../format';

/**
 * The seller's shipment batches.
 *
 * A batch is bookkeeping, not a product: it says which of your items travel in
 * one consignment. Buyers never see one - advancing a batch's stage is what
 * writes the tracking they do see, on their own order.
 */
export function BatchesPage() {
  const [data, setData] = useState<LotsResponse | null>(null);
  const [openLotId, setOpenLotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.myLots());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your batches.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (openLotId) {
    return <BatchDetail lotId={openLotId} onBack={() => { setOpenLotId(null); void load(); }} />;
  }

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>My batches</h1>
          <p className="muted">
            Group the items travelling in one consignment. Moving a batch forward updates the tracking every
            buyer in it sees — they never see the batch itself.
          </p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} /> New batch
        </button>
      </div>

      {error && <ErrorNotice message={error} />}
      {creating && <NewBatchForm onDone={() => { setCreating(false); void load(); }} onCancel={() => setCreating(false)} />}

      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {data.unassigned.length > 0 && (
            <div className="card card--pad" style={{ marginBottom: 22 }}>
              <div className="row row--between">
                <div>
                  <div className="card__title">{data.unassigned.length} listings not in a batch</div>
                  <span className="faint">
                    {data.unassigned.map((l) => l.title).slice(0, 3).join(' · ')}
                    {data.unassigned.length > 3 && ` and ${data.unassigned.length - 3} more`}
                  </span>
                </div>
                <span className="badge badge--warn">Untracked</span>
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                Buyers of these see “Preparing” until you tag them into a batch. Open a batch below to add them.
              </p>
            </div>
          )}

          {data.lots.length === 0 ? (
            <EmptyState icon="◲" title="No batches yet">
              Open one for your next consignment, then tag the items travelling in it.
            </EmptyState>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
              {data.lots.map(({ lot, listingCount, orderCount, unitCount, weightGrams, valueMinor }) => (
                <button key={lot.id} className="card card--pad card--link stack"
                  style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
                  onClick={() => setOpenLotId(lot.id)}>
                  <div className="row row--between">
                    <div>
                      <div className="card__title">{lot.name}</div>
                      <span className="faint">{lot.description || 'No description'}</span>
                    </div>
                    <StageBadge stage={lot.stage} />
                  </div>

                  <StageTrack stage={lot.stage} />

                  <div className="spread faint">
                    <span>{listingCount} items</span>
                    <span>{orderCount} orders · {unitCount} units</span>
                    {weightGrams > 0 && <span>{formatWeight(weightGrams)}</span>}
                    {valueMinor > 0 && <span>{formatMoney(valueMinor)}</span>}
                  </div>

                  {lot.forwarder && (
                    <span className="faint">
                      {lot.forwarder.name}
                      {lot.forwarder.trackingReference && ` · ${lot.forwarder.trackingReference}`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function StageBadge({ stage }: { stage: Lot['stage'] }) {
  const done = stage === 'delivered';
  return <span className={`badge badge--${done ? 'ok' : 'warn'}`}>{LOT_STAGE_LABELS[stage]}</span>;
}

function StageTrack({ stage }: { stage: Lot['stage'] }) {
  const current = LOT_STAGES.indexOf(stage);
  return (
    <div className="meter" role="img" aria-label={`${LOT_STAGE_LABELS[stage]}`}>
      <div className="meter__fill" style={{ width: `${((current + 1) / LOT_STAGES.length) * 100}%` }} />
    </div>
  );
}

function NewBatchForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dispatchDays, setDispatchDays] = useState('21');
  const [forwarderName, setForwarderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createLot({
        name: name.trim(),
        description: description.trim(),
        estimatedDispatchAt: new Date(Date.now() + (Number(dispatchDays) || 21) * 86_400_000).toISOString(),
        // Either a directory forwarder or one you already work with; the batch
        // does not care which, and neither does the buyer's tracking.
        forwarderName: forwarderName.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create the batch.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card card--pad form" onSubmit={submit} style={{ marginBottom: 22 }}>
      <h2>New batch</h2>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guangzhou run — October" required />
        <span className="field__hint">Only you see this.</span>
      </label>
      <label className="field">
        <span>Notes</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Air freight, QC before repack" />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Est. dispatch (days out)</span>
          <input type="number" min="1" value={dispatchDays} onChange={(e) => setDispatchDays(e.target.value)} />
          <span className="field__hint">Buyers see this date on their order.</span>
        </label>
        <label className="field">
          <span>Forwarder (optional)</span>
          <input value={forwarderName} onChange={(e) => setForwarderName(e.target.value)} placeholder="Lotus Freight, or your own" />
        </label>
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="row">
        <button type="submit" className="btn" disabled={busy || !name.trim()}>Create batch</button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** One batch: what's in it, how to move it, and where the tracking goes. */
function BatchDetail({ lotId, onBack }: { lotId: string; onBack: () => void }) {
  const [data, setData] = useState<LotContents | null>(null);
  const [unassigned, setUnassigned] = useState<LotsResponse['unassigned']>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [contents, lots] = await Promise.all([api.lotContents(lotId), api.myLots()]);
      setData(contents);
      setUnassigned(lots.unassigned);
      setTracking(contents.lot.forwarder?.trackingReference ?? '');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this batch.');
    }
  }, [lotId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const { lot, listings, orders, totals } = data;
  const next = nextStage(lot.stage);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      await load();
      setFlash(label);
    } catch (err) {
      setFlash(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <button className="btn btn--quiet" onClick={onBack} style={{ marginBottom: 16 }}>
        <Icon name="back" size={14} /> All batches
      </button>

      <div className="page__head">
        <div>
          <h1>{lot.name}</h1>
          <p className="muted">{lot.description || 'No description'}</p>
        </div>
        <StageBadge stage={lot.stage} />
      </div>

      {flash && <p className={`notice notice--${flash.includes('Moved') || flash.includes('Added') || flash.includes('Tracking') ? 'ok' : 'error'}`}>{flash}</p>}

      <div className="detail" style={{ marginTop: 18 }}>
        <div className="stack">
          <div className="card card--pad stack">
            <h2>Manifest</h2>
            <p className="muted">
              {totals.lines} orders · {totals.units} units
              {totals.weightGrams > 0 && ` · ${formatWeight(totals.weightGrams)}`}
              {totals.valueMinor > 0 && ` · ${formatMoney(totals.valueMinor)}`}
            </p>
            {orders.length === 0 ? (
              <p className="muted">No orders in this batch yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr><th>Order</th><th>Item</th><th>Cond.</th><th>Qty</th><th>Payment</th><th>Escrow</th></tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="mono">{order.id.slice(0, 12)}</td>
                        <td>{order.itemName}</td>
                        <td><span className="badge">{order.condition}</span></td>
                        <td>{order.quantity}</td>
                        <td>
                          <span className={`badge badge--${order.paymentStatus === 'paid' ? 'ok' : 'warn'}`}>
                            {order.paymentStatus.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>{order.escrow.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card card--pad stack">
            <h2>Items in this batch</h2>
            {listings.length === 0 ? (
              <p className="muted">Nothing tagged in yet.</p>
            ) : (
              listings.map((listing) => (
                <div key={listing.id} className="row row--between" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 'var(--t-sm)' }}>{listing.title}</span>
                  <button className="btn btn--quiet" disabled={busy}
                    onClick={() => void run('Removed from batch.', () => api.assignToLot(lot.id, [listing.id], true).then(() => {}))}>
                    Remove
                  </button>
                </div>
              ))
            )}

            {unassigned.length > 0 && (
              <>
                <h3 style={{ marginTop: 10 }}>Add an item</h3>
                {unassigned.map((listing) => (
                  <div key={listing.id} className="row row--between">
                    <span className="muted">{listing.title}</span>
                    <button className="btn btn--ghost" disabled={busy}
                      onClick={() => void run('Added to batch.', () => api.assignToLot(lot.id, [listing.id]).then(() => {}))}>
                      Add
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <aside className="stack">
          <div className="card card--pad stack">
            <h2>Move it along</h2>
            <ol className="track" style={{ flexWrap: 'wrap' }}>
              {LOT_STAGES.map((stage, index) => {
                const current = LOT_STAGES.indexOf(lot.stage);
                return (
                  <li key={stage} className={`track__step${index < current ? ' is-done' : ''}${index === current ? ' is-current' : ''}`}>
                    <span className="track__dot" aria-hidden="true" />
                    <span>{LOT_STAGE_LABELS[stage]}</span>
                  </li>
                );
              })}
            </ol>

            {next ? (
              <>
                <label className="field">
                  <span>Note (optional)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="All units checked in" />
                </label>
                <button className="btn btn--block" disabled={busy}
                  onClick={() => void run(`Moved to ${LOT_STAGE_LABELS[next]}.`, async () => {
                    await api.advanceStage(lot.id, next, note || undefined);
                    setNote('');
                  })}>
                  Move to {LOT_STAGE_LABELS[next]}
                </button>
                <p className="faint">
                  {totals.lines === 0
                    ? 'No orders riding in this batch yet, so this only moves the batch itself.'
                    : `This updates the tracking for ${totals.lines} order${totals.lines === 1 ? '' : 's'} in the batch.`}
                </p>
              </>
            ) : (
              <p className="notice notice--ok">Delivered. Nothing further to do.</p>
            )}
          </div>

          <div className="card card--pad stack">
            <h2>Forwarder</h2>
            {lot.forwarder ? (
              <>
                <div className="card__title">{lot.forwarder.name}</div>
                {lot.forwarder.contact && <span className="faint">{lot.forwarder.contact}</span>}
              </>
            ) : (
              <p className="muted">None set. Add tracking below and name the forwarder.</p>
            )}

            <label className="field">
              <span>Tracking reference</span>
              <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="SSC-2026-08-4471" />
              <span className="field__hint">Shown on every buyer's order in this batch.</span>
            </label>
            <button className="btn btn--ghost btn--block" disabled={busy}
              onClick={() => void run('Tracking saved.', () =>
                api.setTracking(lot.id, {
                  trackingReference: tracking,
                  forwarderName: lot.forwarder?.name ?? 'Own forwarder',
                }).then(() => {}))}>
              Save tracking
            </button>
          </div>

          {lot.estimatedDispatchAt && (
            <div className="card card--pad">
              <span className="faint">Estimated dispatch</span>
              <div className="card__title">{formatDate(lot.estimatedDispatchAt)}</div>
              <p className="faint" style={{ marginTop: 6 }}>Buyers see this on their order.</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
