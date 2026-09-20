import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  LOT_STAGES, LOT_STAGE_LABELS, ORDER_CHECKPOINTS, type OrderCheckpoint,
} from '@shared/enums';
import {
  TRIGGER_LABELS, WAITING_FOR_LOT, laneOf, suggestLotName, type RouteStep,
} from '@shared/routes';
import type { Lot } from '@shared/models';
import { COUNTRIES } from '@shared/countries';
import {
  ApiRequestError, api,
  type LotBoard, type LotContents, type LotDetails, type LotRouteView, type LotsResponse,
  type ProviderCard, type RoutesResponse, type CandidateItem, type LotItem,
} from '../api';
import { Ladder } from '../components/Ladder';
import { LotPeople } from '../components/LotPeople';
import { LotDetailFields, Modal, emptyLotDetails, lotDetailsOf } from '../components/LotFields';
import { EmptyState, ErrorNotice, Icon, type IconName } from '../components/ui';
import { formatDate, formatMoney, formatWeight } from '../format';

/**
 * The seller's shipment lots.
 *
 * A lot is bookkeeping, not a product: it says which of your items travel in
 * one consignment. Buyers never see one - advancing a lot's stage is what
 * writes the tracking they do see, on their own order.
 */
export function LotsPage() {
  const [data, setData] = useState<LotsResponse | null>(null);
  const [openLotId, setOpenLotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.myLots());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your lots.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (openLotId) {
    return <LotDetail lotId={openLotId} onBack={() => { setOpenLotId(null); void load(); }} />;
  }

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>My lots</h1>
          <p className="muted">
            Group the items travelling in one consignment. Moving a lot forward updates the tracking every
            buyer in it sees — they never see the lot itself.
          </p>
        </div>
        {/* Routes now live on the Sell tab's own Routes card, not here. */}
        <div className="row row--tight">
          <button className="btn" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New lot
          </button>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}
      {creating && (
        <NewLotForm
          suggestedName={suggestLotName()}
          onDone={() => { setCreating(false); void load(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {!data ? (
        error ? null : <p className="muted">Loading…</p>
      ) : (
        <>
          {data.unassigned.length > 0 && (
            <div className="card card--pad" style={{ marginBottom: 22 }}>
              <div className="row row--between">
                <div>
                  <div className="card__title">{data.unassigned.length} listings not in a lot</div>
                  <span className="faint">
                    {data.unassigned.map((l) => l.title).slice(0, 3).join(' · ')}
                    {data.unassigned.length > 3 && ` and ${data.unassigned.length - 3} more`}
                  </span>
                </div>
                <span className="badge badge--warn">Untracked</span>
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                Buyers of these see “Preparing” until you tag them into a lot. Open a lot below to add them.
              </p>
            </div>
          )}

          {data.lots.length === 0 ? (
            <EmptyState icon="◲" title="No lots yet">
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

/**
 * Who moves this lot, and how to reach them.
 *
 * Three roles and one shape for all of them: a name, optionally an account
 * here behind it, and the details. Tagging somebody is not hiring them - it
 * hands over exactly one screen for exactly this lot, which is how most of
 * this work is actually arranged: a supplier you buy one run from, a friend
 * with a warehouse who breaks up one crate.
 *
 * The name works on its own. A shop already dealing with someone off-platform
 * types it in and the lot behaves identically; the handle is what turns a name
 * into somebody who can see the lot they are working.
 */
function CrewCard({ lot, busy, onRun }: {
  lot: Lot;
  busy: boolean;
  onRun: (label: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const [handlers, setHandlers] = useState<ProviderCard[]>([]);
  const [forwarders, setForwarders] = useState<ProviderCard[]>([]);

  const [supplierName, setSupplierName] = useState(lot.supplier?.name ?? '');
  const [supplierHandle, setSupplierHandle] = useState('');
  const [supplierContact, setSupplierContact] = useState(lot.supplier?.contact ?? '');
  const [supplierReference, setSupplierReference] = useState(lot.supplier?.reference ?? '');

  const [forwarderPick, setForwarderPick] = useState(lot.forwarder?.forwarderUserId ?? '');
  const [forwarderName, setForwarderName] = useState(lot.forwarder?.name ?? '');
  const [tracking, setTracking] = useState(lot.forwarder?.trackingReference ?? '');

  const [choice, setChoice] = useState(lot.handler?.handlerUserId ?? (lot.handler ? 'manual' : ''));
  const [manualName, setManualName] = useState(lot.handler?.handlerUserId ? '' : lot.handler?.name ?? '');

  useEffect(() => {
    // The public lists only. An unlisted forwarder or handler still works - a
    // shop names them by typing - they are simply not on offer to strangers.
    void api.serviceDirectory('handler')
      .then((result) => setHandlers(result.providers)).catch(() => setHandlers([]));
    void api.serviceDirectory('forwarder')
      .then((result) => setForwarders(result.providers)).catch(() => setForwarders([]));
  }, []);

  const picked = forwarders.find((row) => row.userId === forwarderPick) ?? null;

  return (
    <div className="stack">
      <div className="card card--pad stack">
        <div>
          <h2>Supplier</h2>
          <span className="field__hint">
            Who you buy this run from, and who checks and packs it before it leaves. Buyers
            never see any of it.
          </span>
        </div>
        <label className="field">
          <span>Name</span>
          <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)}
            placeholder="Guangzhou Toys Ltd" />
        </label>
        <label className="field">
          <span>Their handle here</span>
          <input value={supplierHandle} onChange={(e) => setSupplierHandle(e.target.value)}
            placeholder={lot.supplier?.supplierUserId ? 'Tagged. Type another to change it.' : '@their_handle'} />
          <span className="field__hint">
            Optional. Tag them and they get a packing list for this lot — pieces, counts and
            weights, never your buyers or prices — and tick each one as they pack it.
          </span>
        </label>
        <div className="field-row">
          <label className="field">
            <span>Contact</span>
            <input value={supplierContact} onChange={(e) => setSupplierContact(e.target.value)}
              placeholder="WeChat, phone or email" />
          </label>
          <label className="field">
            <span>Their reference</span>
            <input value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)}
              placeholder="Invoice or order no." />
          </label>
        </div>
        <button type="button" className="btn btn--ghost btn--block" disabled={busy}
          onClick={() => void onRun('Supplier saved.', () =>
            api.updateLotDetails(lot.id, {
              name: lot.name,
              supplierName,
              supplierHandle,
              supplierContact,
              supplierReference,
            }).then(() => {}))}>
          Save supplier
        </button>
      </div>

      <div className="card card--pad stack">
        <div>
          <h2>Freight forwarder</h2>
          <span className="field__hint">
            Who moves the lot, as opposed to who you bought it from. Their tracking reference
            shows on every buyer's order in this lot.
          </span>
        </div>
        <label className="field">
          <span>From the directory</span>
          <select value={forwarderPick} onChange={(e) => {
            setForwarderPick(e.target.value);
            const row = forwarders.find((entry) => entry.userId === e.target.value);
            if (row) setForwarderName(row.name);
          }}>
            <option value="">Someone not listed — I will type their name</option>
            {forwarders.map((row) => (
              <option key={row.userId} value={row.userId}>{row.name} — {row.line}</option>
            ))}
          </select>
        </label>
        {picked?.handle && <span className="faint">@{picked.handle}</span>}
        <label className="field">
          <span>Name</span>
          <input value={forwarderName} onChange={(e) => setForwarderName(e.target.value)}
            placeholder="Lotus Freight, or your own" />
        </label>
        <label className="field">
          <span>Tracking reference</span>
          <input value={tracking} onChange={(e) => setTracking(e.target.value)}
            placeholder="SSC-2026-08-4471" />
        </label>
        <button type="button" className="btn btn--ghost btn--block" disabled={busy || !forwarderName.trim()}
          onClick={() => void onRun('Forwarder saved.', () =>
            api.setTracking(lot.id, {
              trackingReference: tracking,
              forwarderName: forwarderName.trim(),
              forwarderUserId: forwarderPick || undefined,
            }).then(() => {}))}>
          Save forwarder
        </button>
      </div>

      <div className="card card--pad stack">
        <div>
          <h2>Domestic handler</h2>
          <span className="field__hint">
            Who takes delivery when the lot lands and gets the parcels out. They see their own
            screen for this lot and nothing else of yours.
          </span>
        </div>

        <label className="field">
          <span>Handler — takes delivery in India</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Nobody — you dispatch it yourself</option>
            {handlers.map((entry) => (
              <option key={entry.userId} value={entry.userId}>{entry.name} — {entry.line}</option>
            ))}
            <option value="manual">Someone not listed…</option>
          </select>
        </label>

        {choice === 'manual' && (
          <label className="field">
            <span>Their name</span>
            <input value={manualName} onChange={(e) => setManualName(e.target.value)}
              placeholder="R. Menon" />
            <span className="field__hint">
              A name with no account behind it is a note to yourself — they get no screen.
            </span>
          </label>
        )}

        <button type="button" className="btn btn--ghost btn--block" disabled={busy}
          onClick={() => void onRun('Crew saved.', () =>
            api.setCrew(lot.id, {
              handlerUserId: choice === 'manual' || choice === '' ? null : choice,
              handlerName: choice === 'manual' ? manualName : choice === '' ? '' : undefined,
            }).then(() => {}))}>
          Save handler
        </button>
      </div>
    </div>
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

/**
 * Open a lot.
 *
 * Everything a lot needs to start travelling, on one screen: what it is
 * called, where it is coming from, who works it at either end, and the ladder
 * it climbs. The ladder is the new part and the important one - it is what the
 * buyer will read for the next six weeks, in the seller's own words rather than
 * in seven fixed ones that fit nobody's actual route.
 *
 * The number is not asked for. It is derived from the lot's own id the moment
 * it exists, which is one fewer thing to invent and one fewer thing to collide.
 */
/**
 * A route in one line: how many steps, and where it starts and ends.
 *
 * Enough to choose between two routes without opening either. The full ladder
 * is on the lot once it exists, and on the route itself in the library.
 */
function summarise(steps: readonly { name: string }[]): string {
  if (steps.length === 0) return 'No steps yet';
  const first = steps[0]!.name;
  const last = steps[steps.length - 1]!.name;
  return `${steps.length} steps · ${first} → ${last}`;
}

export function NewLotForm({ onDone, onCancel, suggestedName }: {
  onDone: () => void;
  onCancel: () => void;
  /** What to call it if the seller does not care, which is most of the time. */
  suggestedName?: string;
}) {
  const [details, setDetails] = useState<LotDetails>(
    () => ({ ...emptyLotDetails, name: suggestedName ?? '' }),
  );
  /** Everything that is not a decision, folded away until asked for. */
  const [more, setMore] = useState(false);
  const [forwarderName, setForwarderName] = useState('');
  const [supplierHandle, setSupplierHandle] = useState('');
  const [handlerId, setHandlerId] = useState('');
  const [handlers, setHandlers] = useState<ProviderCard[]>([]);

  /*
   * The route builder used to live here, behind a "write my own steps"
   * option. It is one thing now, not two: the Routes tab in Sell is where a
   * route is designed, and this screen only ever picks from what is already
   * there - so there is one place a seller learns to look, not two that can
   * disagree about which is the real one.
   */
  const [library, setLibrary] = useState<RoutesResponse | null>(null);
  const [routeId, setRouteId] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.routes().then((result) => {
      setLibrary(result);
      setRouteId(result.routes[0]?.id ?? '');
    }).catch(() => setLibrary(null));
    void api.serviceDirectory('handler')
      .then((result) => setHandlers(result.providers))
      .catch(() => setHandlers([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createLot({
        ...details,
        name: details.name.trim(),
        // Either a directory forwarder or one you already work with; the lot
        // does not care which, and neither does the buyer's tracking.
        forwarderName: forwarderName.trim() || undefined,
        supplierHandle: supplierHandle.trim() || undefined,
        handlerUserId: handlerId || undefined,
        // Left unset when nothing is picked yet: the lot still opens, on the
        // generic ladder, and can be pointed at a route once one exists.
        routeId: routeId || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create the lot.');
    } finally {
      setBusy(false);
    }
  }

  // The same fields as the popup in the sell flow, deliberately: one definition
  // of what a lot has, so the two screens cannot drift apart.
  return (
    <form className="card card--pad form" onSubmit={submit} style={{ marginBottom: 22 }}>
      <h2>New lot</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        A lot is one shipment. Name it, say how it travels, then file orders into it.
      </p>

      <label className="field">
        <span>Name it</span>
        <input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })}
          placeholder="Guangzhou run — October" required autoFocus />
        <span className="field__hint">For your own lists. Buyers see the lot number, not this.</span>
      </label>

      {/* Every step this lot's route names - "Received at 'China' Dispatch
          Center" - reads these two, so they are asked before the route is,
          not filled in as an afterthought once the words are already wrong. */}
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Origin</span>
          <select value={details.originCountry ?? ''} required
            onChange={(e) => setDetails({ ...details, originCountry: e.target.value })}>
            <option value="" disabled>Country</option>
            {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
        </label>
        <span style={{ alignSelf: 'center', marginTop: 18 }}><Icon name="right" size={14} /></span>
        <label className="field" style={{ flex: 1 }}>
          <span>Destination</span>
          <select value={details.destinationCountry ?? ''} required
            onChange={(e) => setDetails({ ...details, destinationCountry: e.target.value })}>
            <option value="" disabled>Country</option>
            {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
        </label>
      </div>

      {/* Picking, never designing: a route is written once, in the Routes
          tab, and every lot after it just points at the ladder that already
          exists. */}
      <fieldset className="pickset">
        <legend>How this lot travels</legend>
        <span className="field__hint">
          Every item in the lot follows these steps, and buyers read them as their tracking.
        </span>

        {(library?.routes ?? []).map((route) => (
          <label key={route.id} className={`pick${routeId === route.id ? ' is-on' : ''}`}>
            <input type="radio" name="route" checked={routeId === route.id}
              onChange={() => setRouteId(route.id)} />
            <span className="pick__body">
              <span className="pick__name">{route.name}</span>
              <span className="pick__steps">{summarise(route.steps)}</span>
            </span>
          </label>
        ))}

        {library && library.routes.length === 0 && (
          <p className="field__hint" style={{ margin: 0 }}>
            You have not written a route yet. Opening the lot now uses a generic ladder — write your
            own any time and point this lot (or the next one) at it.
          </p>
        )}

        <Link to="/shop?tab=routes&spotlight=new" className="silkcta">
          <span className="silkcta__label">✨ Define your Silk Route</span>
          <span className="silkcta__note">Write or pick a route in the Routes tab</span>
        </Link>
      </fieldset>

      {/* Nobody, a forwarder, an supplier and a handler are all things a lot
          may acquire later, and none of them stop it existing. They were four
          fields between "New lot" and the button that makes one. */}
      <button type="button" className="disclose" aria-expanded={more}
        onClick={() => setMore(!more)}>
        <Icon name={more ? 'down' : 'right'} size={14} />
        Who handles it, and the paperwork
        <span className="faint">optional, and editable later</span>
      </button>

      {more && (
        <div className="stack">
          <label className="field">
            <span>Forwarder</span>
            <input value={forwarderName} onChange={(e) => setForwarderName(e.target.value)}
              placeholder="Lotus Freight, or your own" />
            <span className="field__hint">Who moves the lot, as opposed to who you bought it from.</span>
          </label>

          <label className="field">
            <span>Supplier</span>
            <input value={supplierHandle} onChange={(e) => setSupplierHandle(e.target.value)}
              placeholder="@their_handle" />
            <span className="field__hint">
              Who checks the pieces before the lot leaves. They get a packing list for this lot only.
            </span>
          </label>

          <label className="field">
            <span>Domestic handler</span>
            <select value={handlerId} onChange={(e) => setHandlerId(e.target.value)}>
              <option value="">Nobody — you dispatch it yourself</option>
              {handlers.map((entry) => (
                <option key={entry.userId} value={entry.userId}>{entry.name} — {entry.line}</option>
              ))}
            </select>
            <span className="field__hint">Who takes delivery in India and gets the parcels out.</span>
          </label>
        </div>
      )}

      {error && <ErrorNotice message={error} />}
      <div className="row">
        <button type="submit" className="btn"
          disabled={busy || !details.name.trim()}>
          {busy ? 'Opening…' : 'Open the lot'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Correct a lot's details after the fact.
 *
 * Everything set when the lot was opened - including from the popup in the
 * sell flow, where a seller is in a hurry - is editable here, which is what
 * makes it reasonable to ask for only a name up front.
 */
/**
 * Put this lot on a different ladder.
 *
 * A shop picks a route when it opens a lot, which is before it knows whether
 * the forwarder will clear customs or they will. Getting it wrong meant the
 * lot travelled the wrong words to the end, because the route is copied onto
 * the lot and nothing could copy another one over it.
 *
 * Where the lot has got to comes across with it: that is a fact about the
 * shipment rather than about the list describing it.
 */
function ChangeRouteDialog({ lot, current, onSaved, onCancel }: {
  lot: Lot;
  current: LotRouteView;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [library, setLibrary] = useState<RoutesResponse | null>(null);
  const [routeId, setRouteId] = useState(current.routeId ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.routes().then((result) => {
      setLibrary(result);
      // The lot's own route when it has one, otherwise whichever this shop
      // wrote first - never the generic ladder, which is not offered here.
      setRouteId((existing) => existing || result.routes[0]?.id || '');
    }).catch(() => setLibrary(null));
  }, []);

  const picked = library?.routes.find((row) => row.id === routeId) ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setLotRoute(lot.id, routeId || null, note.trim() || undefined);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not change the route.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change route" onClose={onCancel}>
      <form className="form" onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>
          Travelling <strong>{current.name}</strong>, at step {current.currentStep + 1} of{' '}
          {current.steps.length}. Everyone in this lot reads the new steps from the equivalent
          point, not from the beginning.
        </p>

        {library && library.routes.length > 0 ? (
          <label className="field">
            <span>Route</span>
            <select value={routeId} onChange={(event) => setRouteId(event.target.value)}>
              {library.routes.map((row) => (
                <option key={row.id} value={row.id}>{row.name} — {row.steps.length} steps</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="field__hint">
            {library ? 'You have not written a route yet.' : 'Loading…'}
          </p>
        )}

        <Link to="/shop?tab=routes&spotlight=new" className="silkcta silkcta--sm"
          style={{ justifySelf: 'start' }}>
          <span className="silkcta__label">✨ Define your Silk Route</span>
        </Link>

        {picked && <Ladder steps={picked.steps} current={-1} />}

        {picked && (
          <label className="field">
            <span>Note (optional)</span>
            <textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)}
              placeholder="Forwarder is handling customs now, so the steps changed." />
            <span className="field__hint">
              Every buyer in this lot reads it, beside the change.
            </span>
          </label>
        )}

        {error && <ErrorNotice message={error} />}
        <div className="row">
          <button type="submit" className="btn" disabled={busy || !picked}>
            {busy ? 'Changing…' : 'Change the route'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function EditLotDialog({ lot, onSaved, onCancel }: {
  lot: Lot;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [details, setDetails] = useState<LotDetails>(() => lotDetailsOf(lot));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateLotDetails(lot.id, { ...details, name: details.name.trim() });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save these details.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Lot details" onClose={onCancel}>
      <form className="form" onSubmit={submit}>
        <LotDetailFields value={details} onChange={setDetails} />
        {error && <ErrorNotice message={error} />}
        <div className="row">
          <button type="submit" className="btn" disabled={busy || !details.name.trim()}>
            {busy ? 'Saving…' : 'Save details'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * One item in a lot, and the buyer waiting for it.
 *
 * Once the lot is with the seller it stops being one object: the crate is
 * open, thirty-four parcels are on the floor, and each one is finished on its
 * own. Before that the ticks would be a lie - nothing can be packed while it is
 * over the Bay of Bengal - so they are not offered.
 */
function LotItemRow({ item, steps, others, busy, onTick, onMove, onNote, onRelot }: {
  item: LotItem;
  /** The lot's route, which is the ladder this item rides. */
  steps: RouteStep[];
  /** The shop's other open lots, for an item that has to ride a different one. */
  others: { id: string; name: string; lotNumber?: string | null }[];
  busy: boolean;
  onTick: (checkpoint: OrderCheckpoint, on: boolean) => void;
  onMove: (to: number) => void | Promise<void>;
  onNote: (note: string, at: number) => void | Promise<void>;
  onRelot: (lotId: string) => void | Promise<void>;
}) {
  const gone = Boolean(item.checkpoints.dispatched);
  /** Folded away by default: thirty-four open ladders is not a manifest. */
  const [open, setOpen] = useState(false);

  return (
    <div className={`lotitem${gone ? ' lotitem--gone' : ''}`}>
      <div className="lotitem__top">
        <span className="lotitem__name">{item.itemName}</span>
        {item.ownStep && <span className="badge badge--warn">Own timeline</span>}
        <span className="badge">{item.condition}</span>
      </div>
      <span className="faint">
        {item.buyerHandle ? <Link to={`/${item.buyerHandle}`}>{item.buyerName}</Link> : item.buyerName}
        {item.quantity > 1 && ` · ×${item.quantity}`}
      </span>

      {/* The buttons that move this item's tracking.
          One press, and its buyer's timeline says the step the shop bound to
          it - which is the whole point of binding one. A button with nothing
          bound still records the fact; it simply moves no timeline, and says
          so rather than looking broken. */}
      <div className="lotitem__acts">
        {ORDER_CHECKPOINTS.map((checkpoint) => {
          const done = Boolean(item.checkpoints[checkpoint]);
          const moves = steps.find((step) => step.trigger === checkpoint);
          return (
            <button key={checkpoint} type="button" disabled={busy} aria-pressed={done}
              className={`tickbtn${done ? ' is-on' : ''}`}
              title={moves
                ? `${done ? 'Pressed' : 'Press'} when ${TRIGGER_LABELS[checkpoint].means} — moves tracking to “${moves.name}”`
                : `${TRIGGER_LABELS[checkpoint].button}: recorded, but no step is bound to it`}
              onClick={() => onTick(checkpoint, !done)}>
              {TRIGGER_LABELS[checkpoint].button}
              {moves && <span className="tickbtn__to">{moves.name}</span>}
            </button>
          );
        })}
      </div>

      {/* One item's own timeline. Almost always the lot's, which is why it is
          closed: it is opened for the exception - the piece pulled at customs
          while the rest of the crate cleared - and that exception is exactly
          what nobody could tell its buyer before. */}
      <button type="button" className="disclose disclose--sm" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <Icon name={open ? 'down' : 'right'} size={13} />
        {steps[item.currentStep]?.name ?? 'Tracking'}
        <span className="faint">{open ? 'hide' : 'note, or move this one alone'}</span>
      </button>

      {open && (
        <>
          <Ladder
            steps={steps}
            current={item.currentStep}
            history={item.history}
            waitingFor={item.waitingForLot ? WAITING_FOR_LOT : null}
            busy={busy}
            whose={`Only ${item.buyerName} reads this one.`}
            onMove={onMove}
            onNote={onNote}
          />

          {/* A piece that missed the cut-off rides the next run. It goes on the
              item rather than on the lot because that is the decision: this
              one, not this crate. */}
          {others.length > 0 && (
            <label className="field field--inline">
              <span>Move to another lot</span>
              <select value="" disabled={busy}
                onChange={(event) => event.target.value && onRelot(event.target.value)}>
                <option value="">Stays in this lot</option>
                {others.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.lotNumber ? `LOT ${lot.lotNumber} — ` : ''}{lot.name}
                  </option>
                ))}
              </select>
              <span className="field__hint">
                It starts this lot's route where the lot is, and {item.buyerName} is told.
              </span>
            </label>
          )}
        </>
      )}
    </div>
  );
}

/**
 * What can go in this lot.
 *
 * Everything the shop has sold that is bound for a lot and is not in one -
 * which, before this screen existed, was a list nobody could see. An item sold
 * three weeks before the run was opened simply sat there, and the buyer was
 * shown a domestic timeline for something that had not been bought yet.
 */
function AddItemsPanel({ lotId, onClose, onAdded }: {
  lotId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [items, setItems] = useState<CandidateItem[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .lotCandidates(lotId, query || undefined)
        .then((result) => !cancelled && setItems(result.items))
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof ApiRequestError ? err.message : 'Could not load your items.');
          }
        });
    }, 160);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [lotId, query]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.addItemsToLot(lotId, picked);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not add those.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker-panel stack">
      <div className="row row--between">
        <strong>Add items</strong>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Close</button>
      </div>

      <div className="search">
        <span className="search__icon"><Icon name="search" /></span>
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by item or customer…" aria-label="Search items" />
      </div>

      {error && <ErrorNotice message={error} />}

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          {query
            ? 'Nothing matches that.'
            : 'Nothing waiting. Items appear here when somebody buys an import that has no lot yet.'}
        </p>
      ) : (
        items.map((item) => {
          const on = picked.includes(item.id);
          return (
            <label key={item.id} className="tick">
              <input type="checkbox" checked={on}
                onChange={() =>
                  setPicked(on ? picked.filter((id) => id !== item.id) : [...picked, item.id])} />
              <span>
                {item.itemName}
                <span className="faint"> — {item.buyerName}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
              </span>
            </label>
          );
        })
      )}

      <button type="button" className="btn" disabled={busy || picked.length === 0} onClick={() => void add()}>
        {busy ? 'Adding…' : `Add selected${picked.length > 0 ? ` (${picked.length})` : ''}`}
      </button>
    </div>
  );
}

/** One lot: what's in it, how to move it, and where the tracking goes. */
/** Which face of a lot you are looking at. */
type LotSection = 'people' | 'tracking' | 'crew' | 'settings';

const LOT_SECTIONS: { id: LotSection; label: string; icon: IconName; hint: string }[] = [
  { id: 'people', label: 'People', icon: 'users', hint: 'Who is waiting for what' },
  { id: 'tracking', label: 'Tracking', icon: 'truck', hint: 'Where it is, what is in it' },
  { id: 'crew', label: 'Crew', icon: 'plane', hint: 'Who moves it' },
  { id: 'settings', label: 'Settings', icon: 'tag', hint: 'Its name and its route' },
];

/**
 * One lot, in four faces.
 *
 * It used to be one scroll with everything on it - the manifest, the ladder,
 * the forwarder, the crew, the listings - which is four jobs stacked into a
 * page nobody could find anything on. They are four questions with four
 * answers, and a lot is worked one question at a time.
 */
export function LotDetail({ lotId, onBack }: { lotId: string; onBack: () => void }) {
  const [data, setData] = useState<LotContents | null>(null);
  const [unassigned, setUnassigned] = useState<LotsResponse['unassigned']>([]);
  const [siblings, setSiblings] = useState<LotsResponse['lots']>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Whether it worked is decided where it happened, not guessed from the
     wording afterwards - which is what a growing regular expression over
     every success message had become. */
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [section, setSection] = useState<LotSection>('tracking');
  const [editing, setEditing] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [adding, setAdding] = useState(false);
  /* The customer board, fetched the first time somebody asks for it: a seller
     opening a lot to move it on should not pay for a manifest of names. */
  const [people, setPeople] = useState<LotBoard | null>(null);

  const load = useCallback(async () => {
    try {
      const [contents, lots] = await Promise.all([api.lotContents(lotId), api.myLots()]);
      setData(contents);
      setUnassigned(lots.unassigned);
      setSiblings(lots.lots);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this lot.');
    }
  }, [lotId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (section !== 'people' || people) return;
    void api.lotBoard(lotId)
      .then(setPeople)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load who is in this lot.'));
  }, [section, people, lotId]);

  if (error && !data) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const { lot, listings, totals, route, items } = data;
  /** Somewhere else an item could ride: any open lot of this shop but this one. */
  const others = siblings
    .map((entry) => entry.lot)
    .filter((entry) => entry.id !== lot.id && entry.status !== 'closed');

  /*
   * The lot's own ladder: the half of the route that happens to the whole
   * consignment. The other half happens to one item at a time, before it is
   * in here. `lotStep` is -1 while the lot is open and filling.
   */
  const lotSteps = route.steps.slice(route.offset);
  const lotStep = route.currentStep - route.offset;
  const nextStep = lotSteps[lotStep + 1] ?? null;
  const status = lotStep < 0 ? 'Filling' : lotSteps[lotStep]?.name ?? 'Not started';
  const done = lotStep >= lotSteps.length - 1;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      await load();
      // The board is a second read of the same lot, so a tick that changes one
      // must not leave the other showing what it used to say.
      setPeople(null);
      setFlash({ text: label, ok: true });
    } catch (err) {
      setFlash({
        text: err instanceof ApiRequestError ? err.message : 'Something went wrong.',
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <button className="backlink" onClick={onBack}>
        <Icon name="back" size={14} /> All lots
      </button>

      {/* The lot, said once and properly: what it is called, which one it is,
          and what it is doing. Everything else is a section below. */}
      <header className="lothero">
        <h1 className="lothero__name">{lot.name}</h1>
        <div className="lothero__ids">
          <span className="lothero__id">LOT {route.lotNumber}</span>
          <span className={`lothero__state lothero__state--${done ? 'done' : lotStep < 0 ? 'filling' : 'moving'}`}>
            {status}
          </span>
        </div>
        <p className="lothero__line">
          {[
            (lot.originCountry || lot.destinationCountry) ? laneOf(lot) : null,
            `${items.length} ${items.length === 1 ? 'item' : 'items'}`,
            totals.weightGrams > 0 ? formatWeight(totals.weightGrams) : null,
            totals.valueMinor > 0 ? formatMoney(totals.valueMinor) : null,
            route.name,
          ].filter(Boolean).join(' · ')}
        </p>
        <div className="lothero__bar" aria-hidden="true">
          <span style={{ width: `${((lotStep + 1) / Math.max(1, lotSteps.length)) * 100}%` }} />
        </div>
      </header>

      <nav className="lotnav" aria-label="This lot">
        {LOT_SECTIONS.map((entry) => (
          <button key={entry.id} type="button"
            className={`lotnav__tab${section === entry.id ? ' is-on' : ''}`}
            aria-current={section === entry.id}
            onClick={() => setSection(entry.id)}>
            <Icon name={entry.icon} size={16} />
            <span className="lotnav__label">{entry.label}</span>
            <span className="lotnav__hint">{entry.hint}</span>
          </button>
        ))}
      </nav>

      {flash && <p className={`notice notice--${flash.ok ? 'ok' : 'error'}`}>{flash.text}</p>}
      {error && data && <ErrorNotice message={error} />}

      {section === 'people' && (
        people
          ? <LotPeople board={people} onChanged={setPeople} onError={setError} />
          : <p className="muted">Loading…</p>
      )}

      {section === 'tracking' && (
        <div className="stack">
          <div className="card card--pad stack">
            <div>
              <span className="faint">Where the lot is</span>
              <div className="card__title">
                {lotStep < 0 ? 'Filling — nothing dispatched yet' : status}
              </div>
              <span className="field__hint">
                {route.name}
                {route.offset > 0 && ` · the ${route.offset} steps before this happen to each item`}
              </span>
            </div>

            {/* Sliced, and every index translated back before it leaves: the
                store keeps one position into the whole route, so nothing
                downstream has to know this screen shows half of it. */}
            <Ladder
              steps={lotSteps}
              current={lotStep}
              history={data.history}
              busy={busy}
              vars={{ origin: lot.originCountry, destination: lot.destinationCountry }}
              whose={items.length === 0
                ? 'Nothing is riding in this lot yet, so this is a note to yourself.'
                : `Every one of the ${items.length} buyers in this lot reads it.`}
              onMove={(to, details) => run(`Now: ${lotSteps[to]?.name ?? 'moved'}.`, () =>
                api.stepLot(lot.id, { to: to + route.offset, ...details }).then(() => {}))}
              onNote={(text, at) => run('Note added.', () =>
                api.noteOnLot(lot.id, text, at + route.offset).then(() => {}))}
            />

            {nextStep ? (
              <button className="btn btn--block" disabled={busy}
                onClick={() => void run(`Now: ${nextStep.name}.`, () =>
                  api.stepLot(lot.id, {}).then(() => {}))}>
                Move to {nextStep.name}
              </button>
            ) : (
              <p className="notice notice--ok">{status}. Nothing further to do.</p>
            )}
          </div>

          <div className="card card--pad stack">
            <div className="row row--between">
              <h2>In this lot ({items.length})</h2>
              <span className="faint">{totals.units} units</span>
            </div>
            <span className="field__hint">
              Every item here travels the lot's route. Move the lot and all {items.length} move
              with it.
            </span>

            {items.length === 0 ? (
              <p className="muted">
                Nothing in this lot yet. Add the items your customers have already bought.
              </p>
            ) : (
              items.map((item) => (
                <LotItemRow
                  key={item.id}
                  item={item}
                  steps={route.steps}
                  others={others}
                  busy={busy}
                  onTick={(checkpoint, on) =>
                    run('Item updated.', () => api.setCheckpoint(item.id, checkpoint, on).then(() => {}))}
                  onMove={(to) =>
                    run(`Item moved to ${route.steps[to]?.name ?? 'that step'}.`, () =>
                      api.stepItem(item.id, { to }).then(() => {}))}
                  onNote={(text, at) =>
                    run('Note added.', () => api.stepItem(item.id, { note: text, at }).then(() => {}))}
                  onRelot={(to) =>
                    run('Item moved to another lot.', () =>
                      api.assignOrderToLot(item.id, { lotId: to }).then(() => {}))}
                />
              ))
            )}
          </div>

          {/* Sold, bound for a lot, in none - which before this screen existed
              was a list nobody could see. Shut, because most of the time there
              is nothing in it. */}
          <div className="card card--pad stack">
            <button type="button" className="disclose" aria-expanded={adding}
              onClick={() => setAdding(!adding)}>
              <Icon name={adding ? 'down' : 'right'} size={14} />
              Not in any lot
              <span className="faint">{adding ? 'hide' : 'add them to this one'}</span>
            </button>
            {adding && (
              <AddItemsPanel
                lotId={lot.id}
                onClose={() => setAdding(false)}
                onAdded={() => { setAdding(false); void load(); }}
              />
            )}
          </div>
        </div>
      )}

      {section === 'crew' && (
        <CrewCard lot={lot} busy={busy} onRun={run} />
      )}

      {section === 'settings' && (
        <div className="stack">
          <div className="card card--pad stack">
            <div>
              <h2>This lot</h2>
              <span className="field__hint">
                What it is called and where it comes from. Buyers see the lot number, never
                the name.
              </span>
            </div>
            <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
              onClick={() => setEditing(true)}>
              Rename &amp; details
            </button>
            <dl className="factlist">
              <div><dt>Origin</dt><dd>{lot.originCountry || lot.origin || 'Not set'}</dd></div>
              <div><dt>Destination</dt><dd>{lot.destinationCountry || 'Not set'}</dd></div>
              <div><dt>Est. dispatch</dt>
                <dd>{lot.estimatedDispatchAt ? formatDate(lot.estimatedDispatchAt) : 'Not set'}</dd></div>
            </dl>
          </div>

          {/* The Lot's own view of its route: what it is, never how it was
              made. Designing one happens in the Routes tab - this only picks
              between what is already there, or points a seller at that tab. */}
          <div className="card card--pad stack">
            <div>
              <h2>How this lot travels</h2>
              <span className="field__hint">
                Every item in this lot follows these steps, and buyers read them as their tracking.
              </span>
            </div>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span aria-hidden="true" style={{ fontSize: 20 }}>🚚</span>
              <div style={{ minWidth: 0 }}>
                <div className="pick__name">{route.name}</div>
                <div className="pick__steps">{summarise(route.steps)}</div>
              </div>
            </div>
            <div className="row row--tight">
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setRerouting(true)}>
                Change route
              </button>
              <Link to="/shop?tab=routes&spotlight=new" className="silkcta silkcta--sm">
                <span className="silkcta__label">✨ Define your Silk Route</span>
              </Link>
            </div>
          </div>

          <div className="card card--pad stack">
            <div>
              <h2>Listings travelling in it</h2>
              <span className="field__hint">
                The catalog side: anything bought from one of these goes straight into this lot,
                rather than waiting to be added by hand.
              </span>
            </div>
            {listings.length === 0 ? (
              <p className="muted">Nothing tagged in yet.</p>
            ) : (
              listings.map((listing) => (
                <div key={listing.id} className="row row--between tagrow">
                  <span className="tagrow__name">{listing.title}</span>
                  <button className="btn btn--quiet btn--sm" disabled={busy}
                    onClick={() => void run('Removed from lot.', () =>
                      api.assignToLot(lot.id, [listing.id], true).then(() => {}))}>
                    Remove
                  </button>
                </div>
              ))
            )}

            {unassigned.length > 0 && (
              <>
                <h3 className="settings__sub">Tag one in</h3>
                {unassigned.map((listing) => (
                  <div key={listing.id} className="row row--between tagrow">
                    <span className="tagrow__name muted">{listing.title}</span>
                    <button className="btn btn--ghost btn--sm" disabled={busy}
                      onClick={() => void run('Added to lot.', () =>
                        api.assignToLot(lot.id, [listing.id]).then(() => {}))}>
                      Add
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {editing && (
        <EditLotDialog lot={lot} onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load(); }} />
      )}

      {rerouting && (
        <ChangeRouteDialog lot={lot} current={route}
          onCancel={() => setRerouting(false)}
          onSaved={() => { setRerouting(false); void load(); }} />
      )}
    </main>
  );
}
