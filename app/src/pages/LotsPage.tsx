import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CHECKPOINT_COUNT_LABELS, LOT_STAGES, LOT_STAGE_LABELS, type OrderCheckpoint } from '@shared/enums';
import { sideOf, suggestLotName, type RouteStep } from '@shared/routes';
import type { Lot } from '@shared/models';
import {
  ApiRequestError, api,
  type LotContents, type LotDetails, type LotRouteView, type LotsResponse, type ProviderCard,
  type RoutesResponse, type CandidateItem, type LotItem,
} from '../api';
import { RouteBuilder } from '../components/RouteBuilder';
import { Ladder } from '../components/Ladder';
import { LotDetailFields, Modal, emptyLotDetails, lotDetailsOf } from '../components/LotFields';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
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
        {/* Two decisions, and the second is the rarer one: a lot is opened
            weekly, a route is written once and then reused by every lot after
            it. So routes sit beside the button rather than inside it. */}
        <div className="row row--tight">
          <Link to="/routes" className="btn btn--quiet">
            <Icon name="truck" size={15} /> Routes
          </Link>
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
 * Who else is working this lot.
 *
 * Naming somebody is not hiring them. It hands over exactly one screen for
 * exactly this lot - the packing list in China, or the parcel list in India -
 * which is how most of this work is actually arranged: a supplier who checks
 * one run, a friend with a warehouse who breaks up one crate.
 *
 * The forwarder is set with the tracking, one card up, because a tracking
 * number without a forwarder means nothing. These two have no such field to
 * ride along with.
 */
function CrewCard({ lot, onSaved }: { lot: Lot; onSaved: () => void }) {
  const [handlers, setHandlers] = useState<ProviderCard[]>([]);
  const [choice, setChoice] = useState(lot.handler?.handlerUserId ?? (lot.handler ? 'manual' : ''));
  const [manualName, setManualName] = useState(lot.handler?.handlerUserId ? '' : lot.handler?.name ?? '');
  const [exporter, setExporter] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    // The public list only. An unlisted handler is named by typing their name,
    // which is exactly how their shops already reach them.
    void api
      .serviceDirectory('handler')
      .then((result) => setHandlers(result.providers))
      .catch(() => setHandlers([]));
  }, []);

  async function save() {
    setBusy(true);
    setFlash(null);
    try {
      await api.setCrew(lot.id, {
        handlerUserId: choice === 'manual' || choice === '' ? null : choice,
        handlerName: choice === 'manual' ? manualName : choice === '' ? '' : undefined,
        exporterHandle: exporter.trim() ? exporter.trim() : undefined,
      });
      setFlash('Saved.');
      onSaved();
    } catch (err) {
      setFlash(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card--pad stack">
      <div>
        <h2>Crew</h2>
        <span className="field__hint">
          Who checks this lot before it leaves, and who gets it out when it lands. Each one sees
          their own screen for this lot and nothing else of yours.
        </span>
      </div>

      <label className="field">
        <span>Exporter — checks the pieces in China</span>
        <input value={exporter} onChange={(e) => setExporter(e.target.value)}
          placeholder={lot.exporterUserId ? 'Named. Type another @handle to change it.' : '@their_handle'} />
        <span className="field__hint">
          They get a packing list: pieces, counts and weights, never your buyers or prices.
        </span>
      </label>

      <label className="field">
        <span>Handler — takes delivery in India</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Nobody — you dispatch it yourself</option>
          {handlers.map((entry) => (
            <option key={entry.userId} value={entry.userId}>
              {entry.name} — {entry.line}
            </option>
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

      {flash && <p className={`notice notice--${flash === 'Saved.' ? 'ok' : 'error'}`}>{flash}</p>}
      <button type="button" className="btn btn--ghost btn--block" disabled={busy}
        onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save crew'}
      </button>
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
  const [exporterHandle, setExporterHandle] = useState('');
  const [handlerId, setHandlerId] = useState('');
  const [handlers, setHandlers] = useState<ProviderCard[]>([]);

  const [library, setLibrary] = useState<RoutesResponse | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [routeId, setRouteId] = useState('');
  const [routeName, setRouteName] = useState('');
  const [steps, setSteps] = useState<RouteStep[]>([]);
  const [saveTemplate, setSaveTemplate] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.routes().then((result) => {
      setLibrary(result);
      // Their own first, then the one that has always been here.
      setRouteId(result.routes[0]?.id ?? '');
      setSteps(result.suggested);
      setRouteName(result.builtIn.name);
    }).catch(() => setLibrary(null));
    void api.serviceDirectory('handler')
      .then((result) => setHandlers(result.providers))
      .catch(() => setHandlers([]));
  }, []);

  const named = steps.filter((step) => step.name.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let chosenId = routeId || undefined;
      // Saving the ladder as a template is the default, because a shop that
      // runs one route runs it every month and retyping nine steps each time
      // is how a system stops being used.
      if (mode === 'new' && saveTemplate) {
        const saved = await api.saveRoute({
          name: routeName.trim() || 'My route',
          steps: named.map((step, index) => ({
            name: step.name, description: step.description, side: sideOf(step, index),
          })),
        });
        chosenId = saved.route.id;
      }

      await api.createLot({
        ...details,
        name: details.name.trim(),
        // Either a directory forwarder or one you already work with; the lot
        // does not care which, and neither does the buyer's tracking.
        forwarderName: forwarderName.trim() || undefined,
        exporterHandle: exporterHandle.trim() || undefined,
        handlerUserId: handlerId || undefined,
        ...(mode === 'existing'
          ? { routeId: chosenId }
          : chosenId
            ? { routeId: chosenId }
            : {
                routeName: routeName.trim() || 'My route',
                routeSteps: named.map((step, index) => ({
                  name: step.name, description: step.description, side: sideOf(step, index),
                })),
              }),
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

      {/* The one decision worth making here. Presented as things you can
          read rather than as a picker plus a preview plus a mode toggle: a
          seller choosing a route wants to see the route. */}
      <fieldset className="pickset">
        <legend>How this lot travels</legend>
        <span className="field__hint">
          Every item in the lot follows these steps, and buyers read them as their tracking.
        </span>

        {library && (
          <label className={`pick${mode === 'existing' && !routeId ? ' is-on' : ''}`}>
            <input type="radio" name="route" checked={mode === 'existing' && !routeId}
              onChange={() => { setMode('existing'); setRouteId(''); }} />
            <span className="pick__body">
              <span className="pick__name">{library.builtIn.name}</span>
              <span className="pick__steps">{summarise(library.builtIn.steps)}</span>
            </span>
          </label>
        )}

        {(library?.routes ?? []).map((route) => (
          <label key={route.id} className={`pick${mode === 'existing' && routeId === route.id ? ' is-on' : ''}`}>
            <input type="radio" name="route" checked={mode === 'existing' && routeId === route.id}
              onChange={() => { setMode('existing'); setRouteId(route.id); }} />
            <span className="pick__body">
              <span className="pick__name">{route.name}</span>
              <span className="pick__steps">{summarise(route.steps)}</span>
            </span>
          </label>
        ))}

        <label className={`pick${mode === 'new' ? ' is-on' : ''}`}>
          <input type="radio" name="route" checked={mode === 'new'}
            onChange={() => setMode('new')} />
          <span className="pick__body">
            <span className="pick__name">Write my own steps</span>
            <span className="pick__steps">For a journey none of the above describes</span>
          </span>
        </label>

        {mode === 'new' && (
          <div className="pick__open">
            <label className="field">
              <span>Call it</span>
              <input value={routeName} onChange={(e) => setRouteName(e.target.value)}
                placeholder="Guangzhou air express" />
            </label>
            <RouteBuilder steps={steps} onChange={setSteps} split />
            <label className="tick">
              <input type="checkbox" checked={saveTemplate}
                onChange={(e) => setSaveTemplate(e.target.checked)} />
              <span>
                Save it
                <span className="faint"> — so the next lot can pick it instead of retyping it.</span>
              </span>
            </label>
          </div>
        )}
      </fieldset>

      {/* Nobody, a forwarder, an exporter and a handler are all things a lot
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
            <span>Exporter</span>
            <input value={exporterHandle} onChange={(e) => setExporterHandle(e.target.value)}
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
          disabled={busy || !details.name.trim() || (mode === 'new' && named.length < 2)}>
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
    void api.routes().then(setLibrary).catch(() => setLibrary(null));
  }, []);

  const picked = routeId
    ? library?.routes.find((row) => row.id === routeId) ?? null
    : library?.builtIn ?? null;

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

        <label className="field">
          <span>Route</span>
          <select value={routeId} onChange={(event) => setRouteId(event.target.value)}>
            <option value="">
              {library ? `${library.builtIn.name} — ${library.builtIn.steps.length} steps` : 'Loading…'}
            </option>
            {(library?.routes ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.name} — {row.steps.length} steps</option>
            ))}
          </select>
          <span className="field__hint">
            <Link to="/routes">Write a route</Link> if none of these is the journey.
          </span>
        </label>

        {picked && <Ladder steps={picked.steps} current={-1} />}

        <label className="field">
          <span>Note (optional)</span>
          <textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)}
            placeholder="Forwarder is handling customs now, so the steps changed." />
          <span className="field__hint">
            Every buyer in this lot reads it, beside the change.
          </span>
        </label>

        {error && <ErrorNotice message={error} />}
        <div className="row">
          <button type="submit" className="btn" disabled={busy}>
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
function LotItemRow({ item, steps, others, atSeller, busy, onTick, onMove, onNote, onRelot }: {
  item: LotItem;
  /** The lot's route, which is the ladder this item rides. */
  steps: RouteStep[];
  /** The shop's other open lots, for an item that has to ride a different one. */
  others: { id: string; name: string; lotNumber?: string | null }[];
  atSeller: boolean;
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

      {atSeller && (
        <div className="lotitem__acts">
          {(['packed', 'dispatched'] as const).map((checkpoint) => {
            const done = Boolean(item.checkpoints[checkpoint]);
            return (
              <button key={checkpoint} type="button" disabled={busy} aria-pressed={done}
                className={`tickbtn${done ? ' is-on' : ''}`}
                onClick={() => onTick(checkpoint, !done)}>
                {CHECKPOINT_COUNT_LABELS[checkpoint]}
              </button>
            );
          })}
        </div>
      )}

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
export function LotDetail({ lotId, onBack }: { lotId: string; onBack: () => void }) {
  const [data, setData] = useState<LotContents | null>(null);
  const [unassigned, setUnassigned] = useState<LotsResponse['unassigned']>([]);
  const [siblings, setSiblings] = useState<LotsResponse['lots']>([]);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  /* Whether it worked is decided where it happened, not guessed from the
     wording afterwards - which is what a growing regular expression over
     every success message had become. */
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [contents, lots] = await Promise.all([api.lotContents(lotId), api.myLots()]);
      setData(contents);
      setUnassigned(lots.unassigned);
      setSiblings(lots.lots);
      setTracking(contents.lot.forwarder?.trackingReference ?? '');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this lot.');
    }
  }, [lotId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const { lot, listings, orders, totals, route, items } = data;
  /** Somewhere else an item could ride: any open lot of this shop but this one. */
  const others = siblings
    .map((entry) => entry.lot)
    .filter((entry) => entry.id !== lot.id && entry.status !== 'closed');
  const nextStep = route.steps[route.currentStep + 1] ?? null;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      await load();
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
      <button className="btn btn--quiet" onClick={onBack} style={{ marginBottom: 16 }}>
        <Icon name="back" size={14} /> All lots
      </button>

      <div className="page__head">
        <div style={{ minWidth: 0 }}>
          <span className="faint">LOT #{route.lotNumber}</span>
          <h1>{lot.name}</h1>
          <p className="muted">
            {[
              lot.origin,
              lot.exporterUserId ? 'Exporter named' : null,
              lot.handler?.name ? `Handler: ${lot.handler.name}` : null,
              route.name,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="row row--tight">
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditing(true)}>
            Rename &amp; details
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setRerouting(true)}>
            Change route
          </button>
          <StageBadge stage={lot.stage} />
        </div>
      </div>

      {editing && (
        <EditLotDialog lot={lot} onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load(); }} />
      )}

      {rerouting && (
        <ChangeRouteDialog
          lot={lot}
          current={route}
          onCancel={() => setRerouting(false)}
          onSaved={() => { setRerouting(false); void load(); }}
        />
      )}

      {flash && (
        <p className={`notice notice--${flash.ok ? 'ok' : 'error'}`}>{flash.text}</p>
      )}

      <div className="detail" style={{ marginTop: 18 }}>
        <div className="stack">
          <div className="card card--pad stack">
            <div className="row row--between">
              <h2>Items ({items.length})</h2>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setAdding(true)}>
                + Add items
              </button>
            </div>
            <span className="field__hint">
              Every item here travels the lot's route. Move the lot and all {items.length} move
              with it.
            </span>

            {adding && (
              <AddItemsPanel
                lotId={lot.id}
                onClose={() => setAdding(false)}
                onAdded={() => { setAdding(false); void load(); }}
              />
            )}

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
                  atSeller={route.atSeller}
                  busy={busy}
                  onTick={(checkpoint, on) =>
                    run('Item updated.', () => api.setCheckpoint(item.id, checkpoint, on).then(() => {}))}
                  onMove={(to) =>
                    run(`Item moved to ${route.steps[to]?.name ?? 'that step'}.`, () =>
                      api.stepItem(item.id, { to }).then(() => {}))}
                  onNote={(text, at) =>
                    run('Note added.', () => api.stepItem(item.id, { note: text, at }).then(() => {}))}
                  onRelot={(lotId) =>
                    run('Item moved to another lot.', () =>
                      api.assignOrderToLot(item.id, { lotId }).then(() => {}))}
                />
              ))
            )}

            <span className="faint">
              {totals.units} units
              {totals.weightGrams > 0 && ` · ${formatWeight(totals.weightGrams)}`}
              {totals.valueMinor > 0 && ` · ${formatMoney(totals.valueMinor)}`}
            </span>
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
                <div key={listing.id} className="row row--between" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 'var(--t-sm)' }}>{listing.title}</span>
                  <button className="btn btn--quiet" disabled={busy}
                    onClick={() => void run('Removed from lot.', () => api.assignToLot(lot.id, [listing.id], true).then(() => {}))}>
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
                      onClick={() => void run('Added to lot.', () => api.assignToLot(lot.id, [listing.id]).then(() => {}))}>
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
            <div>
              <span className="faint">Current status</span>
              <div className="card__title">{route.steps[route.currentStep]?.name ?? 'Not started'}</div>
              <span className="field__hint">{route.name}</span>
            </div>

            {/* The timeline, editable in place. Every rung moves the lot -
                forwards because that is the work, backwards because the
                commonest correction on any board is a button pressed once too
                many and twenty buyers have already been told. */}
            <Ladder
              steps={route.steps}
              current={route.currentStep}
              history={data.history}
              busy={busy}
              whose={items.length === 0
                ? 'Nothing is riding in this lot yet, so this is a note to yourself.'
                : `Every one of the ${items.length} buyers in this lot reads it.`}
              onMove={(to) => run(`Now: ${route.steps[to]?.name ?? 'moved'}.`, () =>
                api.stepLot(lot.id, { to }).then(() => {}))}
              onNote={(text, at) => run('Note added.', () =>
                api.noteOnLot(lot.id, text, at).then(() => {}))}
            />

            {nextStep ? (
              <button className="btn btn--block" disabled={busy}
                onClick={() => void run(`Now: ${nextStep.name}.`, () =>
                  api.stepLot(lot.id, {}).then(() => {}))}>
                Move to {nextStep.name}
              </button>
            ) : (
              <p className="notice notice--ok">
                {route.steps[route.currentStep]?.name ?? 'Delivered'}. Nothing further to do.
              </p>
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
              <span className="field__hint">Shown on every buyer's order in this lot.</span>
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

          <CrewCard lot={lot} onSaved={() => void load()} />

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
