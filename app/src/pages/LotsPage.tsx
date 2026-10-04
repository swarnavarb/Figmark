import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  WAITING_FOR_LOT, itemLeaveIndex, laneOf, lotEndIndex, renderStepText, routeJoinsLot, routeParts, sameSteps,
  type RouteStep, type TrackingRoute,
} from '@shared/routes';
import { lotIsDone, lotPhase } from '@shared/fulfilment';
import type { Lot } from '@shared/models';
import { COUNTRIES } from '@shared/countries';
import {
  ApiRequestError, api,
  type LotBoard, type LotContents, type LotDetails, type LotRouteView, type LotsResponse,
  type ProviderCard, type RoutesResponse, type CandidateItem, type LotItem,
} from '../api';
import { LotPhaseBadge, lotLabel } from '../components/LotName';
import { useUndo } from '../components/Undo';
import { Ladder } from '../components/Ladder';
import { SerialButtons } from '../components/SerialButtons';
import { serialButtons, withReceivedAs } from '@shared/buttons';
import { LotPeople } from '../components/LotPeople';
import { LotDetailFields, emptyLotDetails, lotDetailsOf } from '../components/LotFields';
import { ErrorNotice, Icon, Modal, type IconName } from '../components/ui';
import { RouteStudio } from './RouteStudioPage';
import { formatDate, formatMoney, formatWeight } from '../format';

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
/**
 * A route as a lot picker shows it: the steps the lot itself moves through,
 * in the lot's own countries, and how long the whole thing is. Every route
 * starts at Order Placed and ends at Delivered, so those say nothing about
 * which one to pick; the middle is what differs.
 */
function summarise(steps: readonly RouteStep[], vars: { origin?: string | null; destination?: string | null } = {}): string {
  if (steps.length === 0) return 'No steps yet';
  const { before, lot } = routeParts({ steps: [...steps] });
  const middle = steps.slice(before, before + lot).map((step) => renderStepText(step.name, vars));
  const count = `${steps.length} steps`;
  return middle.length > 0 ? `${middle.join(' → ')} · ${count}` : `Never joins a lot · ${count}`;
}

/**
 * The Studio, over whatever screen asked for a route, so writing one never
 * throws away the half-filled form underneath. Saved, it hands the new route
 * straight back to be picked.
 */
export function RouteSheet({ onSaved, onClose }: {
  onSaved: (route: TrackingRoute) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="New route"
      onClose={() => { if (window.confirm('Close the route builder? A route not saved yet is lost.')) onClose(); }}>
      <RouteStudio editing={null} onSaved={onSaved} onCancel={onClose}
        intro={<p className="muted" style={{ marginTop: 0 }}>
          Write it once - it is picked for this lot as soon as it is saved, and any lot after can use it.
        </p>} />
    </Modal>
  );
}

/**
 * Open a lot.
 *
 * Everything a lot needs to start travelling, on one screen: where it is
 * coming from and going to, and the route it climbs. The rest - who works it
 * at either end - is folded away and editable later.
 *
 * Nothing is asked twice: the countries and route of the shop's last lot are
 * where the next one starts, since most shops run the same lane again. The
 * name is asked for first: it is how the shop finds this lot again.
 */
export function NewLotForm({ onDone, onCancel }: {
  /** Handed the lot just opened, for a caller that has something to put in it. */
  onDone: (lot: Lot) => void;
  onCancel: () => void;
}) {
  const [details, setDetails] = useState<LotDetails>(() => ({ ...emptyLotDetails, name: '' }));
  /** Everything that is not a decision, folded away until asked for. */
  const [more, setMore] = useState(false);
  const [forwarderName, setForwarderName] = useState('');
  const [supplierHandle, setSupplierHandle] = useState('');
  const [handlerId, setHandlerId] = useState('');
  const [handlers, setHandlers] = useState<ProviderCard[]>([]);

  /*
   * Picking, never designing: routes are written in the Studio, which opens
   * over this form when a new one is needed and hands it straight back.
   */
  const [library, setLibrary] = useState<RoutesResponse | null>(null);
  const [routeId, setRouteId] = useState('');
  /** The route the shop's last lot travelled, said beside it so the default is never silent. */
  const [lastRouteId, setLastRouteId] = useState<string | null>(null);
  const [designing, setDesigning] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoutes = useCallback(async (pick?: string) => {
    try {
      const result = await api.routes();
      setLibrary(result);
      if (pick) setRouteId(pick);
    } catch {
      setLibrary(null);
    }
  }, []);

  useEffect(() => {
    void Promise.all([api.routes(), api.myLots().catch(() => null)]).then(([routes, lots]) => {
      setLibrary(routes);
      const last = lots?.lots[0]?.lot;
      const usable = routes.routes.filter(routeJoinsLot);
      const lastRoute = last?.route?.routeId && usable.some((row) => row.id === last.route!.routeId)
        ? last.route.routeId : null;
      setLastRouteId(lastRoute);
      // Last lot's route, or the only one there is. With a choice and no
      // history, nothing is picked for the seller.
      setRouteId(lastRoute ?? (usable.length === 1 ? usable[0]!.id : ''));
      if (last?.originCountry || last?.destinationCountry) {
        setDetails((now) => ({
          ...now,
          originCountry: now.originCountry || last.originCountry || '',
          destinationCountry: now.destinationCountry || last.destinationCountry || '',
        }));
      }
    }).catch(() => setLibrary(null));
    void api.serviceDirectory('handler')
      .then((result) => setHandlers(result.providers))
      .catch(() => setHandlers([]));
  }, []);

  /* A route with nothing in its lot lane is for items shipped one by one; a
     lot put on it would have nothing of its own to move. */
  const routes = (library?.routes ?? []).filter(routeJoinsLot);
  const vars = { origin: details.originCountry, destination: details.destinationCountry };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { lot } = await api.createLot({
        ...details,
        name: details.name.trim(),
        // Either a directory forwarder or one you already work with; the lot
        // does not care which, and neither does the buyer's tracking.
        forwarderName: forwarderName.trim() || undefined,
        supplierHandle: supplierHandle.trim() || undefined,
        handlerUserId: handlerId || undefined,
        // Left unset only when the shop has no route yet: the lot opens on the
        // generic ladder and can be pointed at a route once one exists.
        routeId: routeId || undefined,
      });
      onDone(lot);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create the lot.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <form className="card card--pad form" onSubmit={submit} style={{ marginBottom: 22 }}>
      <h2>New lot</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        A lot is one shipment. Say where it goes and how it travels, then add orders to it.
      </p>

      <label className="field">
        <span>Lot name *</span>
        <input value={details.name} required onChange={(e) => setDetails({ ...details, name: e.target.value })}
          placeholder="e.g. Diwali air run" />
        <span className="field__hint">Shown first on every list; the lot number sits beside it.</span>
      </label>

      {/* Every step this lot's route names - "Received at {origin} warehouse" -
          reads these two, so they are asked before the route is. */}
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ flex: 1 }}>
          <span>From</span>
          <select value={details.originCountry ?? ''} required
            onChange={(e) => setDetails({ ...details, originCountry: e.target.value })}>
            <option value="" disabled>Country</option>
            {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
        </label>
        <span style={{ alignSelf: 'center', marginTop: 18 }}><Icon name="right" size={14} /></span>
        <label className="field" style={{ flex: 1 }}>
          <span>To</span>
          <select value={details.destinationCountry ?? ''} required
            onChange={(e) => setDetails({ ...details, destinationCountry: e.target.value })}>
            <option value="" disabled>Country</option>
            {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="pickset">
        <legend>How this lot travels</legend>
        <span className="field__hint">
          Every order in the lot follows these steps, and buyers read them as their tracking.
        </span>

        {routes.map((route) => (
          <label key={route.id} className={`pick${routeId === route.id ? ' is-on' : ''}`}>
            <input type="radio" name="route" checked={routeId === route.id}
              onChange={() => setRouteId(route.id)} />
            <span className="pick__body">
              <span className="pick__name">
                {route.name}
                {route.id === lastRouteId && <span className="badge badge--quiet" style={{ marginLeft: 6 }}>Used on your last lot</span>}
              </span>
              <span className="pick__steps">{summarise(route.steps, vars)}</span>
            </span>
          </label>
        ))}

        {library && routes.length === 0 && (
          <p className="field__hint" style={{ margin: 0 }}>
            You have no route for lots yet. Opening the lot now uses a generic ladder — write your
            own any time and point this lot (or the next one) at it.
          </p>
        )}

        <button type="button" className="silkcta" onClick={() => setDesigning(true)}>
          <span className="silkcta__label">✨ Define your Silk Route</span>
          <span className="silkcta__note">Write a new route without leaving this lot</span>
        </button>
      </fieldset>

      {/* A forwarder, a supplier and a handler are all things a lot may
          acquire later, and none of them stop it existing. */}
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
            <span className="field__hint">
              Who takes delivery in {details.destinationCountry || 'the destination country'} and gets the parcels out.
            </span>
          </label>
        </div>
      )}

      {error && <ErrorNotice message={error} />}
      <div className="row">
        <button type="submit" className="btn"
          disabled={busy || !details.name.trim() || (routes.length > 0 && !routeId)}>
          {busy ? 'Opening…' : 'Open the lot'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
        {routes.length > 0 && !routeId && <span className="field__hint">Pick how it travels first.</span>}
      </div>
    </form>

    {designing && (
      <RouteSheet onClose={() => setDesigning(false)}
        onSaved={(route) => { setDesigning(false); void loadRoutes(routeJoinsLot(route) ? route.id : undefined); }} />
    )}
    </>
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
  const [routeId, setRouteId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [designing, setDesigning] = useState(false);

  const load = useCallback(async (pick?: string) => {
    try {
      const result = await api.routes();
      setLibrary(result);
      setRouteId((existing) => pick ?? existing);
    } catch {
      setLibrary(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** Only routes a lot can travel: one with nothing in its lot lane has nothing for a lot to move. */
  const routes = (library?.routes ?? []).filter(routeJoinsLot);
  const picked = routes.find((row) => row.id === routeId) ?? null;
  /* The lot's own route is offered again only when it was edited since the
     lot was given it - picking it then is how the lot gets the new steps. */
  const isCurrent = picked !== null && picked.id === current.routeId;
  const currentBehind = routes.some((row) => row.id === current.routeId && !sameSteps(row.steps, current.steps));
  const unchanged = isCurrent && !currentBehind;
  const vars = { origin: lot.originCountry, destination: lot.destinationCountry };
  const filling = current.currentStep < current.offset;

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
    <>
    <Modal title="Change route" onClose={onCancel}>
      <form className="form" onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>
          Travelling <strong>{current.name}</strong>,{' '}
          {filling
            ? 'still filling - it has not taken any of its own steps yet.'
            : <>at step {current.currentStep + 1} of {current.steps.length}.</>}{' '}
          Everyone in this lot reads the new steps from the equivalent point, not from the beginning.
        </p>

        {library && routes.length > 0 ? (
          <label className="field">
            <span>Route</span>
            <select value={routeId} onChange={(event) => setRouteId(event.target.value)}>
              <option value="" disabled>Pick a route</option>
              {routes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.id === current.routeId
                    ? (currentBehind ? ' — this lot\'s route, edited since: update it' : ' — this lot\'s route now')
                    : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="field__hint">
            {library ? 'You have no route for lots yet.' : 'Loading…'}
          </p>
        )}

        <button type="button" className="silkcta silkcta--sm" style={{ justifySelf: 'start' }}
          onClick={() => setDesigning(true)}>
          <span className="silkcta__label">✨ Define your Silk Route</span>
        </button>

        {picked && <p className="field__hint" style={{ margin: 0 }}>{summarise(picked.steps, vars)}</p>}
        {picked && <Ladder steps={picked.steps} current={-1} vars={vars} />}

        {picked && !unchanged && (
          <label className="field">
            <span>Note (optional)</span>
            <textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)}
              placeholder="Forwarder is handling customs now, so the steps changed." />
            <span className="field__hint">
              Every buyer in this lot reads it, beside the change.
            </span>
          </label>
        )}
        {unchanged && <p className="field__hint">This lot already travels these exact steps.</p>}

        {error && <ErrorNotice message={error} />}
        <div className="row">
          <button type="submit" className="btn" disabled={busy || !picked || unchanged}>
            {busy ? 'Changing…' : isCurrent ? 'Update to the new steps' : 'Change the route'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Modal>
    {designing && (
      <RouteSheet onClose={() => setDesigning(false)}
        onSaved={(route) => { setDesigning(false); void load(routeJoinsLot(route) ? route.id : undefined); }} />
    )}
    </>
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
function LotItemRow({ item, lotId, lotStep, vars, steps, others, busy, onTick, onLot, onMove, onNote, onRelot }: {
  item: LotItem;
  lotId: string;
  /** The lot's route, which is the ladder this item rides. */
  steps: RouteStep[];
  /** The shop's other open lots, for an item that has to ride a different one. */
  others: { id: string; name: string; lotNumber?: string | null }[];
  busy: boolean;
  /** Where the lot is on its route. */
  lotStep: number;
  vars: { origin?: string | null; destination?: string | null };
  /** A press of the item's own, already confirmed. */
  onTick: (key: string, on: boolean) => void;
  /** The Lot stop on the item's line: up to where the lot itself is moved. */
  onLot: () => void;
  onMove: (to: number, details?: { trackingId?: string; shipper?: string }) => void | Promise<void>;
  onNote: (note: string, at: number) => void | Promise<void>;
  onRelot: (lotId: string) => void | Promise<void>;
}) {
  const gone = Boolean(item.checkpoints.dispatched) || Boolean(item.checkpoints.delivered);
  /* Past the crate's last rung the item is worked on its own: from its
     order, with the same dispatch card an in-hand sale uses. */
  const leaveAt = itemLeaveIndex({ steps });
  const onItsOwn = item.currentStep + 1 >= leaveAt;
  const toItem = (
    <Link className="ladder__leave-go" to={`/order/${item.id}`} state={{ from: `/shop?tab=lots&lot=${encodeURIComponent(lotId)}` }}>
      Dispatch &amp; track this order <Icon name="right" size={11} />
    </Link>
  );
  /** Folded away by default: thirty-four open ladders is not a manifest. */
  const [open, setOpen] = useState(false);

  return (
    <div className={`lotitem${gone ? ' lotitem--gone' : ''}`}>
      <div className="lotitem__top">
        <span className="lotitem__name">{item.itemName}</span>
        {item.ownStep && <span className="badge badge--warn">Own timeline</span>}
        <span className="badge">{item.condition}</span>
      </div>
      {item.quantity > 1 && <span className="faint">× {item.quantity}</span>}

      {onItsOwn && (
        <div className="lotitem__own">
          <span className="faint">Out of the lot — tracked on its own now.</span>
          {toItem}
        </div>
      )}

      {/* The buttons that move this item's tracking - its own presses and
          the lot's moves, one after another, exactly as its order card has
          them. Every one asks first. */}
      <SerialButtons
        buttons={serialButtons(withReceivedAs(steps, item.receivedAs), lotStep, item.ticks, vars)}
        busy={busy}
        who={{ itemName: item.itemName, buyerName: item.buyerName }}
        onItem={(key, on) => onTick(key, on)}
        onLot={onLot}
        orderLink={{ to: `/order/${item.id}`, state: { from: `/shop?tab=lots&lot=${encodeURIComponent(lotId)}` } }}
        stepOf={{ at: item.currentStep, of: steps.length }}
      />

      {/* One item's own timeline. Almost always the lot's, which is why it is
          closed: it is opened for the exception - the piece pulled at customs
          while the rest of the crate cleared - and that exception is exactly
          what nobody could tell its buyer before. */}
      <button type="button" className="lotitem__more" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <Icon name={open ? 'down' : 'right'} size={12} />
        {open ? 'Hide' : 'Note, or move this order alone'}
      </button>

      {open && (
        <>
          <Ladder
            steps={steps}
            current={item.currentStep}
            history={item.history}
            waitingFor={item.waitingForLot ? WAITING_FOR_LOT : null}
            leaveAt={leaveAt}
            leaveNote={toItem}
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
                    {lotLabel(lot)}
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

/** A lot's items under the customer who bought them, in the order each first appears. */
function itemsByCustomer(items: readonly LotItem[]) {
  const groups = new Map<string, { key: string; name: string; handle: string | null; rows: LotItem[] }>();
  for (const item of items) {
    const group = groups.get(item.buyerId);
    if (group) group.rows.push(item);
    else groups.set(item.buyerId, { key: item.buyerId, name: item.buyerName, handle: item.buyerHandle, rows: [item] });
  }
  return [...groups.values()];
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
        <strong>Add orders</strong>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Close</button>
      </div>

      <div className="search">
        <span className="search__icon"><Icon name="search" /></span>
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by item or customer…" aria-label="Search orders" />
      </div>

      {error && <ErrorNotice message={error} />}

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          {query
            ? 'Nothing matches that.'
            : 'Nothing waiting. Orders appear here when somebody buys an import that has no lot yet.'}
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
  { id: 'people', label: 'Customers', icon: 'users', hint: 'Customers & Orders: every order, customer by customer, and what each still owes' },
  { id: 'tracking', label: 'Tracking', icon: 'truck', hint: 'Where the whole lot is, and every item in it' },
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
export function LotDetail({ lotId, onBack, customers }: {
  lotId: string;
  onBack: () => void;
  /**
   * The Customers & Orders section: the shop's own order cards, scoped to this
   * lot and grouped by customer. Handed in by the Sell tab, which owns those
   * cards, so the two screens draw one card and not two. Without it the
   * section falls back to the packing board.
   */
  customers?: (ctx: { onChanged: () => void; onTracking: () => void }) => ReactNode;
}) {
  const [data, setData] = useState<LotContents | null>(null);
  const [unassigned, setUnassigned] = useState<LotsResponse['unassigned']>([]);
  const offerUndo = useUndo();
  const [siblings, setSiblings] = useState<LotsResponse['lots']>([]);
  const [error, setError] = useState<string | null>(null);
  /*
   * A move that would carry the lot past the checkpoint where items are
   * received at the international warehouse, while some of them are not
   * actually marked as received yet. Held here rather than fired straight
   * from the button, so the seller sees what is missing before it happens
   * instead of a buyer reading a step their piece never reached.
   */
  const [gate, setGate] = useState<{
    targetAbsolute: number;
    details?: { trackingId?: string; shipper?: string };
    label: string;
    missing: LotItem[];
  } | null>(null);
  const [confirmingBypass, setConfirmingBypass] = useState(false);
  /* Every move made from Tracking asks first - the lot's and one item's
     alike - because each one changes what a buyer reads. The gate above is a
     second question, asked only where items would pass the warehouse unticked. */
  const [asking, setAsking] = useState<{ title: string; text: ReactNode; yes: string; go: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  /* Whether it worked is decided where it happened, not guessed from the
     wording afterwards - which is what a growing regular expression over
     every success message had become. */
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  /* Customers & Orders first: it's where every item's own tracking - and
     the one tick that ends it, "Delivered" - actually happens. */
  /* `view=tracking` opens straight onto Tracking: the Lot button on an order card lands here. */
  const [params] = useSearchParams();
  const [section, setSection] = useState<LotSection>(params.get('view') === 'tracking' ? 'tracking' : 'people');
  const [editing, setEditing] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [adding, setAdding] = useState(false);
  /* The customer board, fetched the first time somebody asks for it: a seller
     opening a lot to move it on should not pay for a manifest of names. */
  const [people, setPeople] = useState<LotBoard | null>(null);
  /** Bumped when items join from below, so the order cards above read the lot again. */
  const [joined, setJoined] = useState(0);

  /*
   * The lot itself, and - only when asked - the shop's other lots and loose
   * listings beside it. Those two only change when something joins or leaves
   * this lot, so a tick or a step reads back just this lot rather than every
   * lot the shop has.
   */
  const load = useCallback(async (withLots = true) => {
    try {
      const [contents, lots] = await Promise.all([
        api.lotContents(lotId),
        withLots ? api.myLots() : Promise.resolve(null),
      ]);
      setData(contents);
      if (lots) {
        setUnassigned(lots.unassigned);
        setSiblings(lots.lots);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this lot.');
    }
  }, [lotId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (section !== 'people' || people || customers) return;
    void api.lotBoard(lotId)
      .then(setPeople)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load who is in this lot.'));
  }, [section, people, lotId, customers]);

  // A <div>, not a <main>: this is drawn inside the Sell tab's own <main>.
  if (error && !data) return <div className="page"><ErrorNotice message={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;

  const { lot, listings, totals, route, items } = data;
  /** Somewhere else an item could ride: any open lot of this shop but this one. */
  const others = siblings
    .map((entry) => entry.lot)
    .filter((entry) => entry.id !== lot.id && !lotIsDone(entry));

  /*
   * The lot's own ladder: the half of the route that happens to the whole
   * consignment. The other half happens to one item at a time, before it is
   * in here. `lotStep` is -1 while the lot is open and filling.
   */
  const lotSteps = route.steps.slice(route.offset);
  const lotStep = route.currentStep - route.offset;
  // The crate stops where it is unpacked; after that each item goes out and is
  // delivered on its own (the Items list below), and the lot closes itself.
  const crateEnd = lotEndIndex(route);
  const unpacked = route.currentStep >= crateEnd;
  /* The next step the crate can move to - never one in the half before it, so
     a lot that is still sitting further back than "filling" moves onto its own
     first step rather than offering nothing. */
  const nextAt = Math.max(route.currentStep + 1, route.offset);
  const nextStep = nextAt <= crateEnd ? route.steps[nextAt] ?? null : null;
  const lane = { origin: lot.originCountry, destination: lot.destinationCountry };
  const status = lotIsDone(lot) ? 'Delivered' : lotStep < 0 ? 'Filling' : renderStepText(lotSteps[lotStep]?.name ?? 'Filling', lane);
  const done = lotIsDone(lot) || lotStep >= lotSteps.length - 1;
  const phase = lotPhase(lot);

  /** `membership` for anything that moves an item or listing in or out of this lot. */
  async function run(label: string, fn: () => Promise<void>, membership = false) {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      await load(membership);
      // The board is a second read of the same lot, so a tick that changes one
      // must not leave the other showing what it used to say.
      setPeople(null);
      setFlash({ text: label, ok: true });
    } catch (err) {
      setFlash({
        text: err instanceof Error ? err.message : 'Something went wrong.',
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  }

  /*
   * Every lot move goes through here, whether it came from the "Move to
   * next" button or from dragging a rung on the ladder - one gate, not two,
   * so there is exactly one place that can let a lot travel past items that
   * never checked in.
   *
   * The gate only exists where the route actually has a step for it: a
   * route with no international-warehouse trigger (a courier run, say) has
   * nothing to check and moves exactly as it always did.
   */
  function requestMove(
    targetAbsolute: number,
    details: { trackingId?: string; shipper?: string } | undefined,
    label: string,
    confirmed = false,
  ) {
    if (!confirmed && targetAbsolute <= crateEnd) {
      const name = route.steps[targetAbsolute]?.name ?? 'that step';
      setAsking({
        title: 'Move the whole lot?',
        text: <><strong>{lot.name}</strong> moves to <strong>{name}</strong>. Every item in it moves with it, and
          every buyer in it reads the new step.</>,
        yes: `🚢 Move lot to ${name}`,
        go: () => requestMove(targetAbsolute, details, label, true),
      });
      return;
    }
    if (targetAbsolute > crateEnd) {
      setFlash({
        text: 'This lot is unpacked. Mark each item dispatched and delivered on its own; the lot closes when the last one arrives.',
        ok: false,
      });
      return;
    }
    const gateAt = route.steps.findIndex((step) => step.trigger === 'china_received');
    const missing = gateAt >= 0 && targetAbsolute >= gateAt
      ? items.filter((item) => !item.checkpoints.china_received)
      : [];
    if (missing.length > 0) {
      setGate({ targetAbsolute, details, label, missing });
      return;
    }
    void run(label, () => api.stepLot(lot.id, { to: targetAbsolute, ...details }).then(offerLotUndo));
  }

  /** After a move of the whole lot: three minutes to take it back. */
  function offerLotUndo(result: { undo?: { id: string; until: string; to: number } }) {
    const undo = result.undo;
    if (!undo) return;
    offerUndo({
      label: `${lot.name} moved`,
      until: undo.until,
      undo: async () => { await api.stepLot(lot.id, { to: undo.to, undoOf: undo.id }); },
      onUndone: () => { setFlash({ text: 'Move undone. Nobody was told.', ok: true }); void load(); },
    });
  }

  /** After an item's button or move: three minutes to take it back. */
  function offerItemUndo(itemName: string, undo: { id: string; until: string } | undefined, back: () => Promise<unknown>) {
    if (!undo) return;
    offerUndo({
      label: `${itemName} updated`,
      until: undo.until,
      undo: async () => { await back(); },
      onUndone: () => { setFlash({ text: 'Undone. Nobody was told.', ok: true }); void load(); },
    });
  }

  async function confirmBypass() {
    if (!gate) return;
    const { targetAbsolute, details, label, missing } = gate;
    setGate(null);
    setConfirmingBypass(false);
    await run(label, async () => {
      /* Every tick is tried, and the lot moves only if all of them landed.
         Firing them all and moving regardless left a lot past the warehouse
         with some of its items never marked as having arrived there. */
      const ticks = await Promise.allSettled(
        missing.map((item) => api.setCheckpoint(item.id, 'china_received', true)));
      const failed = ticks.filter((tick) => tick.status === 'rejected').length;
      if (failed > 0) {
        throw new Error(`${failed} of ${missing.length} items could not be marked received, so the lot has not moved. Try again.`);
      }
      offerLotUndo(await api.stepLot(lot.id, { to: targetAbsolute, ...details }));
    });
  }

  return (
    <div className="page">
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
        {/* What every buyer in this lot is shown, and the one switch that
            belongs to the seller: shutting the box to new orders. */}
        <div className="lothero__phase">
          <LotPhaseBadge phase={phase} />
          <span className="faint">what buyers see</span>
          {(phase === 'filling' || (phase === 'closed' && lotStep < 0)) && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
              onClick={() => void run(
                phase === 'filling' ? 'Lot closed. Buyers now see it is being prepped for dispatch.' : 'Lot reopened for orders.',
                async () => { await api.closeLot(lot.id, phase === 'filling'); },
              )}>
              {phase === 'filling' ? 'Close lot' : 'Reopen lot'}
            </button>
          )}
        </div>
        <p className="lothero__line">
          {[
            (lot.originCountry || lot.destinationCountry) ? laneOf(lot) : null,
            `${items.length} ${items.length === 1 ? 'order' : 'orders'}`,
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
            title={entry.hint}
            onClick={() => setSection(entry.id)}>
            <Icon name={entry.icon} size={16} />
            <span className="lotnav__label">{entry.label}</span>
          </button>
        ))}
      </nav>

      {flash && <p className={`notice notice--${flash.ok ? 'ok' : 'error'}`}>{flash.text}</p>}
      {error && data && <ErrorNotice message={error} />}

      {section === 'people' && (
        <div className="stack">
          {customers
            ? <Fragment key={joined}>
                {customers({ onChanged: () => void load(), onTracking: () => setSection('tracking') })}
              </Fragment>
            : people
              ? <LotPeople board={people} onChanged={setPeople} onError={setError} />
              : <p className="muted">Loading…</p>}

          {/* Sold, bound for a lot, in none - which before this screen existed
              was a list nobody could see. Shut, because most of the time there
              is nothing in it. */}
          <div className="card card--pad stack">
            <button type="button" className="disclose" aria-expanded={adding}
              onClick={() => setAdding(!adding)}>
              <Icon name={adding ? 'down' : 'right'} size={14} />
              Orders waiting for a lot
              <span className="faint">{adding ? 'hide' : 'add them to this one'}</span>
            </button>
            {adding && (
              <AddItemsPanel
                lotId={lot.id}
                onClose={() => setAdding(false)}
                onAdded={() => { setAdding(false); setJoined((count) => count + 1); void load(); }}
              />
            )}
          </div>
        </div>
      )}

      {section === 'tracking' && (
        <div className="stack">
          <div id="lot-tracking" className="card card--pad stack">
            <div>
              <span className="faint">Where the lot is</span>
              <div className="card__title">
                {lotStep < 0 ? 'Filling — nothing dispatched yet' : status}
              </div>
              <span className="field__hint">
                {route.name}
                {route.offset === 1 && ' · the step before this happens to each order on its own'}
                {route.offset > 1 && ` · the ${route.offset} steps before this happen to each order on its own`}
              </span>
            </div>

            {/* Sliced, and every index translated back before it leaves: the
                store keeps one position into the whole route, so nothing
                downstream has to know this screen shows half of it. */}
            <Ladder
              steps={lotSteps}
              current={lotStep}
              history={data.history}
              /* Where the crate is unpacked: from the rung after it, each item
                 is dispatched and delivered on its own, from its own order. */
              leaveAt={itemLeaveIndex(route) - route.offset}
              leaveNote={
                <button type="button" className="ladder__leave-go"
                  onClick={() => document.getElementById('lot-items')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  Update items one by one <Icon name="down" size={11} />
                </button>
              }
              busy={busy}
              vars={lane}
              /* Only the rungs the lot can actually reach: from where it is
                 back to its first step, and on to where it is unpacked. A
                 finished lot moves no further at all. */
              moveUpTo={done ? -1 : crateEnd - route.offset}
              whose={items.length === 0
                ? 'Nothing is riding in this lot yet, so this is a note to yourself.'
                : items.length === 1 ? 'The buyer in this lot reads it.' : `Every one of the ${items.length} buyers in this lot reads it.`}
              onMove={done ? undefined : (to, details) =>
                requestMove(to + route.offset, details, `Now: ${renderStepText(lotSteps[to]?.name ?? 'moved', lane)}.`)}
              onNote={(text, at) => run('Note added.', () =>
                api.noteOnLot(lot.id, text, at + route.offset).then(() => {}))}
            />

            {nextStep && !done ? (
              /* The same lot button every order riding in this lot carries on its card. */
              <button className="btn btn--block" disabled={busy}
                onClick={() => requestMove(nextAt, undefined, `Now: ${nextStep.name}.`)}>
                🚢 Move lot to {renderStepText(nextStep.name, lane)}
              </button>
            ) : done ? (
              <p className="notice notice--ok">Finished. Every order in this lot has reached its buyer.</p>
            ) : unpacked ? (
              <p className="notice notice--info">
                📦 Unpacked. Each item now goes to its own buyer: tick <b>Dispatched</b> and then <b>Delivered</b> on
                every item below. The lot closes itself once the last one arrives.
              </p>
            ) : (
              <p className="notice notice--ok">{status}. Nothing further to do.</p>
            )}
          </div>

          {asking && (
            <Modal title={asking.title} onClose={() => setAsking(null)}>
              <div className="stack">
                <p>{asking.text}</p>
                <button type="button" className="btn btn--block" disabled={busy}
                  onClick={() => { const go = asking.go; setAsking(null); go(); }}>
                  {asking.yes}
                </button>
                <button type="button" className="btn btn--quiet btn--block" onClick={() => setAsking(null)}>
                  Cancel
                </button>
              </div>
            </Modal>
          )}

          <div id="lot-items" className="card card--pad stack">
            <div className="row row--between">
              <h2>Orders, by customer</h2>
              <span className="faint">
                {items.length} {items.length === 1 ? 'order' : 'orders'} · {totals.units} {totals.units === 1 ? 'unit' : 'units'}
              </span>
            </div>
            <span className="field__hint">
              Each order's own buttons, in route order. 🚢 Lot is the part the whole lot moves
              together — that is done with the route above.
            </span>

            {items.length === 0 ? (
              <p className="muted">
                Nothing in this lot yet. Add the orders your customers have already placed.
              </p>
            ) : (
              itemsByCustomer(items).map(({ key, name, handle, rows }) => (
                <section key={key} className="lotcust">
                  <header className="lotcust__head">
                    <span className="lotcust__name">
                      {handle ? <Link to={`/${handle}`}>{name}</Link> : name}
                    </span>
                    <span className="lotcust__count">{rows.length} {rows.length === 1 ? 'item' : 'items'}</span>
                  </header>
                  {rows.map((item) => (
                <LotItemRow
                  key={item.id}
                  item={item}
                  lotId={lot.id}
                  lotStep={route.currentStep}
                  vars={{ origin: lot.originCountry, destination: lot.destinationCountry }}
                  steps={route.steps}
                  others={others}
                  busy={busy}
                  onTick={(key, on) =>
                    run('Item updated.', () => api.setCheckpoint(item.id, key, on).then((result) =>
                      offerItemUndo(item.itemName, result.undo, () =>
                        api.setCheckpoint(item.id, key, !on, undefined, result.undo!.id))))}
                  onLot={() => document.getElementById('lot-tracking')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  onMove={(to, details) => setAsking({
                    title: 'Move this one item?',
                    text: <>Only <strong>{item.itemName}</strong> moves, to <strong>{route.steps[to]?.name ?? 'that step'}</strong>.
                      {' '}{item.buyerName} reads it; the rest of the lot stays where it is.</>,
                    yes: 'Move this item',
                    go: () => void run(`Item moved to ${route.steps[to]?.name ?? 'that step'}.`, () =>
                      api.stepItem(item.id, { to, ...details }).then((result) =>
                        offerItemUndo(item.itemName, result.undo, () =>
                          api.stepItem(item.id, { to: result.undo!.to, undoOf: result.undo!.id })))),
                  })}
                  onNote={(text, at) =>
                    run('Note added.', () => api.stepItem(item.id, { note: text, at }).then(() => {}))}
                  onRelot={(to) =>
                    run('Item moved to another lot.', () =>
                      api.assignOrderToLot(item.id, { lotId: to }).then(() => {}), true)}
                />
                  ))}
                </section>
              ))
            )}
          </div>

          {gate && (
            <Modal
              title={confirmingBypass ? 'Confirm the update' : 'Not all items are checked in'}
              onClose={() => { setGate(null); setConfirmingBypass(false); }}>
              {!confirmingBypass ? (
                <div className="stack">
                  <p>
                    {gate.missing.length} of {items.length}{' '}
                    {items.length === 1 ? 'item has' : 'items have'} not been marked as received at
                    the international warehouse. Moving the lot on now would carry{' '}
                    {gate.missing.length === 1 ? 'it' : 'them'} past a checkpoint{' '}
                    {gate.missing.length === 1 ? "it hasn't" : "they haven't"} actually reached.
                  </p>
                  <ul className="stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
                    {gate.missing.map((item) => (
                      <li key={item.id} className="faint">{item.itemName} — {item.buyerName}</li>
                    ))}
                  </ul>
                  <button type="button" className="btn btn--block"
                    onClick={() => { setGate(null); setConfirmingBypass(false); }}>
                    Go check the items in
                  </button>
                  <button type="button" className="btn btn--ghost btn--block"
                    onClick={() => setConfirmingBypass(true)}>
                    Are these going straight to the freight forwarder?
                  </button>
                </div>
              ) : (
                <div className="stack">
                  <p>
                    This marks {gate.missing.length} {gate.missing.length === 1 ? 'item' : 'items'} as
                    received at the international warehouse and moves the lot to{' '}
                    <strong>{route.steps[gate.targetAbsolute]?.name}</strong>.
                  </p>
                  <button type="button" className="btn btn--block" disabled={busy}
                    onClick={() => void confirmBypass()}>
                    {busy ? 'Updating…' : 'Confirm and move the lot'}
                  </button>
                  <button type="button" className="btn btn--quiet btn--block"
                    onClick={() => setConfirmingBypass(false)}>
                    Back
                  </button>
                </div>
              )}
            </Modal>
          )}
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
                <div className="pick__steps">{summarise(route.steps, lane)}</div>
              </div>
            </div>
            <div className="row row--tight">
              {!done && (
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setRerouting(true)}>
                  Change route
                </button>
              )}
            </div>
          </div>

          <div className="card card--pad stack">
            <div>
              <h2>Listings that feed this lot</h2>
              <span className="field__hint">
                Every new order of one of these listings goes straight into this lot, rather than
                waiting to be added by hand.
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
                      api.assignToLot(lot.id, [listing.id], true).then(() => {}), true)}>
                    Remove
                  </button>
                </div>
              ))
            )}

            {unassigned.length > 0 && (
              <>
                <h3 className="settings__sub">Imports not feeding any lot</h3>
                {unassigned.map((listing) => (
                  <div key={listing.id} className="row row--between tagrow">
                    <span className="tagrow__name muted">{listing.title}</span>
                    <button className="btn btn--ghost btn--sm" disabled={busy}
                      onClick={() => void run('Added to lot.', () =>
                        api.assignToLot(lot.id, [listing.id]).then(() => {}), true)}>
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
    </div>
  );
}
