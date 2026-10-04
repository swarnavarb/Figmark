import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Lot } from '@shared/models';
import { laneQuoteMinor } from '@shared/service-stores';
import { api, type PublicStore } from '../api';
import { formatMoney, formatWeight } from '../format';
import { Icon, TrustBadge } from './ui';
import { LaneTicket, PlanCard, StoreMark, accentStyle } from './StoreKit';

/**
 * Who flies this lot.
 *
 * Booking is instant: pick a forwarder's store, a lane, and which of their
 * cover plans the buyers in this lot may add. A store on auto-accept takes it
 * there and then; any other sees it as a request, and its team can work the
 * lot - press the buttons the route hands the forwarder - once they accept.
 *
 * Someone off Figmark still works the old way: a name and a tracking
 * reference, typed in, with no screen on their side.
 */
export function ForwarderBooking({ lot, busy, onRun }: {
  lot: Lot;
  busy: boolean;
  onRun: (label: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const [stores, setStores] = useState<PublicStore[] | null>(null);
  const [weight, setWeight] = useState(0);
  const current = lot.forwarder;
  const [ownerId, setOwnerId] = useState<string | null>(current?.forwarderUserId ?? null);
  const [laneId, setLaneId] = useState<string | null>(current?.laneId ?? null);
  const [plans, setPlans] = useState<string[]>(current?.insurancePlanIds ?? []);
  const [tracking, setTracking] = useState(current?.trackingReference ?? '');
  const [manual, setManual] = useState(Boolean(current && !current.forwarderUserId));
  const [manualName, setManualName] = useState(current && !current.forwarderUserId ? current.name : '');
  const [picking, setPicking] = useState(!current);

  useEffect(() => {
    void api.lotForwarders(lot.id)
      .then((result) => { setStores(result.stores); setWeight(result.weightGrams); })
      .catch(() => setStores([]));
  }, [lot.id]);

  const store = stores?.find((row) => row.ownerId === ownerId) ?? null;
  const bookedStore = stores?.find((row) => row.ownerId === current?.forwarderUserId) ?? null;
  const cheapest = (row: PublicStore) => row.lanes.length ? Math.min(...row.lanes.map((lane) => laneQuoteMinor(lane, weight))) : null;

  const book = () => onRun(
    current?.forwarderUserId === ownerId ? 'Booking updated.' : store?.autoAccept === false ? 'Request sent to the forwarder.' : 'Forwarder booked.',
    () => api.bookForwarder(lot.id, { storeOwnerId: ownerId, laneId, insurancePlanIds: plans, trackingReference: tracking }).then(() => setPicking(false)),
  );

  return (
    <div className="card card--pad stack fb">
      <div className="fb__head">
        <div>
          <h2>Freight forwarder</h2>
          <span className="field__hint">
            Who flies or ships the lot. Book a store and its team works the steps your route hands the forwarder;
            its cover plans can be offered to your buyers.
          </span>
        </div>
        {weight > 0 && <span className="fb__weight"><Icon name="box" size={13} /> {formatWeight(weight)}</span>}
      </div>

      {/* The booking as it stands. */}
      {current && !picking && (
        <div className="fb-booked" style={accentStyle(bookedStore?.accent)}>
          <StoreMark name={current.name} logoUrl={bookedStore?.logoUrl} accent={bookedStore?.accent} size={46} />
          <span className="fb-booked__body">
            <span className="fb-booked__name">
              {bookedStore ? <Link to={`/services/forwarder/${bookedStore.slug}`}>{current.name}</Link> : current.name}
              {current.forwarderUserId && current.acceptance && (
                <span className={`badge badge--${current.acceptance === 'accepted' ? 'ok' : current.acceptance === 'pending' ? 'warn' : 'danger'}`}>
                  {current.acceptance === 'accepted' ? 'Accepted' : current.acceptance === 'pending' ? 'Waiting for them' : 'Declined'}
                </span>
              )}
            </span>
            <span className="faint">
              {current.laneLabel ?? (current.forwarderUserId ? 'No lane picked' : 'Not on Figmark')}
              {current.trackingReference ? ` · ${current.trackingReference}` : ''}
            </span>
            {(current.insurancePlanIds ?? []).length > 0 && bookedStore && (
              <span className="fb-booked__cover">
                🛡 Buyers can add: {bookedStore.insurance.filter((plan) => current.insurancePlanIds!.includes(plan.id)).map((plan) => plan.name).join(', ')}
              </span>
            )}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicking(true)}>Change</button>
        </div>
      )}
      {current?.acceptance === 'declined' && !picking && (
        <p className="notice notice--warn">They turned this lot down. Pick another forwarder.</p>
      )}

      {picking && (
        <>
          <div className="seg" role="radiogroup" aria-label="Forwarder source">
            <button type="button" role="radio" aria-checked={!manual} className={!manual ? 'is-on' : ''} onClick={() => setManual(false)}>On Figmark</button>
            <button type="button" role="radio" aria-checked={manual} className={manual ? 'is-on' : ''} onClick={() => setManual(true)}>Someone else</button>
          </div>

          {manual ? (
            <div className="stack">
              <label className="field"><span>Their name</span>
                <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Shenzhen Star Cargo" /></label>
              <label className="field"><span>Tracking reference</span>
                <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="SSC-2026-08-4471" /></label>
              <span className="field__hint">A name with no store behind it is a note for your buyers’ tracking — they get no screen, and no cover can be offered.</span>
              <button type="button" className="btn btn--block" disabled={busy || !manualName.trim()} onClick={() => void onRun('Forwarder saved.', async () => {
                if (current?.forwarderUserId) await api.bookForwarder(lot.id, { storeOwnerId: null });
                await api.setTracking(lot.id, { trackingReference: tracking, forwarderName: manualName.trim() });
                setPicking(false);
              })}>Save forwarder</button>
            </div>
          ) : stores === null ? <p className="muted">Loading forwarders…</p> : stores.length === 0 ? (
            <p className="muted">No forwarders are taking bookings yet.</p>
          ) : (
            <div className="stack">
              <div className="fb-stores" role="radiogroup" aria-label="Forwarder">
                {stores.map((row) => {
                  const from = cheapest(row);
                  return (
                    <button key={row.ownerId} type="button" role="radio" aria-checked={row.ownerId === ownerId}
                      className={`fb-store${row.ownerId === ownerId ? ' is-on' : ''}`} style={accentStyle(row.accent)}
                      onClick={() => { setOwnerId(row.ownerId); setLaneId(row.lanes[0]?.id ?? null); setPlans(row.insurance.map((plan) => plan.id)); }}>
                      <StoreMark name={row.name} logoUrl={row.logoUrl} accent={row.accent} size={40} />
                      <span className="fb-store__body">
                        <span className="fb-store__name">{row.name}</span>
                        <span className="faint">{row.tagline || `${row.lanes.length} lanes`}</span>
                        <span className="fb-store__meta">
                          {row.trust.completedTransactions > 0 && <TrustBadge score={row.trust.score} />}
                          {row.autoAccept ? <span className="fb-tag fb-tag--ok">Instant</span> : <span className="fb-tag">Accepts each lot</span>}
                          {row.insurance.length > 0 && <span className="fb-tag fb-tag--cover">🛡 Cover</span>}
                        </span>
                      </span>
                      {from !== null && weight > 0 && <span className="fb-store__price"><small>from</small>{formatMoney(from)}</span>}
                    </button>
                  );
                })}
              </div>

              {store && (
                <>
                  <div className="fb-sub">
                    <h3>Lane</h3>
                    <Link to={`/services/forwarder/${store.slug}`} className="faint">See their store <Icon name="external" size={12} /></Link>
                  </div>
                  <div className="stack">
                    {store.lanes.map((lane) => (
                      <LaneTicket key={lane.id} lane={lane} weightGrams={weight} accent={store.accent}
                        selected={laneId === lane.id} onSelect={() => setLaneId(lane.id)} />
                    ))}
                  </div>

                  {store.insurance.length > 0 && (
                    <>
                      <div className="fb-sub">
                        <h3>Cover your buyers can add</h3>
                        <span className="faint">Each buyer decides for their own item, and pays it with their order.</span>
                      </div>
                      <div className="fb-plans">
                        {store.insurance.map((plan) => (
                          <PlanCard key={plan.id} plan={plan} selected={plans.includes(plan.id)}
                            onSelect={() => setPlans(plans.includes(plan.id) ? plans.filter((id) => id !== plan.id) : [...plans, plan.id])}
                            footer={<span className={`fb-offer${plans.includes(plan.id) ? ' is-on' : ''}`}>{plans.includes(plan.id) ? '✓ Offered to buyers' : 'Not offered'}</span>} />
                        ))}
                      </div>
                    </>
                  )}

                  <label className="field"><span>Tracking reference</span>
                    <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Once they give you one" /></label>

                  <div className="fb-confirm">
                    <span>
                      {store.autoAccept
                        ? <><b>{store.name}</b> takes bookings instantly. Their team can start on the lot straight away.</>
                        : <><b>{store.name}</b> accepts each lot. They get a request now; their team works it once accepted.</>}
                    </span>
                    <div className="row">
                      <button type="button" className="btn" disabled={busy} onClick={() => void book()}>
                        {current?.forwarderUserId === ownerId ? 'Update booking' : `Book ${store.name}`}
                      </button>
                      {current && <button type="button" className="btn btn--quiet" onClick={() => setPicking(false)}>Cancel</button>}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
