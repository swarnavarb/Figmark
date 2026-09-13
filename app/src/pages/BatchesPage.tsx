import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CHECKPOINT_COUNT_LABELS, LOT_STAGES, LOT_STAGE_LABELS, type OrderCheckpoint } from '@shared/enums';
import { stepStateAt, type RouteStep } from '@shared/routes';
import type { Lot } from '@shared/models';
import {
  ApiRequestError, api,
  type LotContents, type LotDetails, type LotsResponse, type ProviderCard,
  type RoutesResponse, type CandidateItem, type LotItem,
} from '../api';
import { RouteBuilder } from '../components/RouteBuilder';
import { LotDetailFields, Modal, emptyLotDetails, lotDetailsOf } from '../components/LotFields';
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
        error ? null : <p className="muted">Loading…</p>
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

/**
 * Who else is working this batch.
 *
 * Naming somebody is not hiring them. It hands over exactly one screen for
 * exactly this batch - the packing list in China, or the parcel list in India -
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
          Who checks this batch before it leaves, and who gets it out when it lands. Each one sees
          their own screen for this batch and nothing else of yours.
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
 * Open a batch.
 *
 * Everything a batch needs to start travelling, on one screen: what it is
 * called, where it is coming from, who works it at either end, and the ladder
 * it climbs. The ladder is the new part and the important one - it is what the
 * buyer will read for the next six weeks, in the seller's own words rather than
 * in seven fixed ones that fit nobody's actual route.
 *
 * The number is not asked for. It is derived from the batch's own id the moment
 * it exists, which is one fewer thing to invent and one fewer thing to collide.
 */
export function NewBatchForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [details, setDetails] = useState<LotDetails>(emptyLotDetails);
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
          steps: named.map((step) => ({ name: step.name, description: step.description })),
        });
        chosenId = saved.route.id;
      }

      await api.createLot({
        ...details,
        name: details.name.trim(),
        // Either a directory forwarder or one you already work with; the batch
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
                routeSteps: named.map((step) => ({ name: step.name, description: step.description })),
              }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create the batch.');
    } finally {
      setBusy(false);
    }
  }

  // The same fields as the popup in the sell flow, deliberately: one definition
  // of what a batch has, so the two screens cannot drift apart.
  return (
    <form className="card card--pad form" onSubmit={submit} style={{ marginBottom: 22 }}>
      <h2>Create lot</h2>
      <LotDetailFields value={details} onChange={setDetails} compact />

      <label className="field">
        <span>Forwarder (optional)</span>
        <input value={forwarderName} onChange={(e) => setForwarderName(e.target.value)}
          placeholder="Lotus Freight, or your own" />
        <span className="field__hint">Who moves the batch, as opposed to who you bought it from.</span>
      </label>

      <label className="field">
        <span>Exporter (optional)</span>
        <input value={exporterHandle} onChange={(e) => setExporterHandle(e.target.value)}
          placeholder="@their_handle" />
        <span className="field__hint">
          Who checks the pieces before the batch leaves. They get a packing list for this batch only.
        </span>
      </label>

      <label className="field">
        <span>Domestic handler (optional)</span>
        <select value={handlerId} onChange={(e) => setHandlerId(e.target.value)}>
          <option value="">Nobody — you dispatch it yourself</option>
          {handlers.map((entry) => (
            <option key={entry.userId} value={entry.userId}>{entry.name} — {entry.line}</option>
          ))}
        </select>
        <span className="field__hint">Who takes delivery in India and gets the parcels out.</span>
      </label>

      {/* The ladder. Two doors, because a shop that has run this route before
          should never see the builder again. */}
      <div className="card card--pad stack" style={{ background: 'var(--surface-2)' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Route</div>
          <span className="field__hint">
            The steps this batch travels. Every item in it inherits them, and buyers read these
            words — so write them the way you would say them.
          </span>
        </div>

        <div className="seg" role="radiogroup" aria-label="Route">
          <button type="button" role="radio" aria-checked={mode === 'existing'}
            className={mode === 'existing' ? 'is-on' : ''} onClick={() => setMode('existing')}>
            Select existing
          </button>
          <button type="button" role="radio" aria-checked={mode === 'new'}
            className={mode === 'new' ? 'is-on' : ''} onClick={() => setMode('new')}>
            Create new
          </button>
        </div>

        {mode === 'existing' ? (
          <>
            <label className="field">
              <span>Route</span>
              <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                <option value="">
                  {library ? `${library.builtIn.name} — ${library.builtIn.steps.length} steps` : 'Loading…'}
                </option>
                {(library?.routes ?? []).map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name} — {route.steps.length} steps
                  </option>
                ))}
              </select>
            </label>
            <ol className="ladder ladder--preview">
              {(routeId
                ? library?.routes.find((route) => route.id === routeId)?.steps
                : library?.builtIn.steps
              )?.map((step) => (
                <li key={step.id} className="ladder__row">
                  <span className="ladder__dot" aria-hidden="true" />
                  <span>{step.name}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <label className="field">
              <span>Route name</span>
              <input value={routeName} onChange={(e) => setRouteName(e.target.value)}
                placeholder="China → India" />
            </label>
            <RouteBuilder steps={steps} onChange={setSteps} />
            <label className="tick">
              <input type="checkbox" checked={saveTemplate}
                onChange={(e) => setSaveTemplate(e.target.checked)} />
              <span>
                Save this route
                <span className="faint"> — so the next batch can pick it instead of retyping it.</span>
              </span>
            </label>
          </>
        )}
      </div>

      {error && <ErrorNotice message={error} />}
      <div className="row">
        <button type="submit" className="btn"
          disabled={busy || !details.name.trim() || (mode === 'new' && named.length < 2)}>
          {busy ? 'Creating…' : 'Create lot'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Correct a batch's details after the fact.
 *
 * Everything set when the batch was opened - including from the popup in the
 * sell flow, where a seller is in a hurry - is editable here, which is what
 * makes it reasonable to ask for only a name up front.
 */
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
    <Modal title="Batch details" onClose={onCancel}>
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
 * A route, drawn.
 *
 * Done, here, still to come - three states and no more, because a timeline that
 * needs a key is a timeline nobody reads. The same ladder is drawn for the
 * seller working it and the buyer watching it, from the same steps, so the two
 * cannot describe the batch differently.
 */
export function Ladder({ steps, current }: { steps: RouteStep[]; current: number }) {
  return (
    <ol className="ladder">
      {steps.map((step, index) => {
        const state = stepStateAt(index, current);
        return (
          <li key={step.id} className={`ladder__row is-${state}`}>
            <span className="ladder__dot" aria-hidden="true">
              {state === 'done' ? '✓' : state === 'current' ? '●' : ''}
            </span>
            <span className="ladder__name">{step.name}</span>
            {step.description && <span className="faint">{step.description}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One item in a batch, and the buyer waiting for it.
 *
 * Once the batch is with the seller it stops being one object: the crate is
 * open, thirty-four parcels are on the floor, and each one is finished on its
 * own. Before that the ticks would be a lie - nothing can be packed while it is
 * over the Bay of Bengal - so they are not offered.
 */
function LotItemRow({ item, atSeller, busy, onTick }: {
  item: LotItem;
  atSeller: boolean;
  busy: boolean;
  onTick: (checkpoint: OrderCheckpoint, on: boolean) => void;
}) {
  const gone = Boolean(item.checkpoints.dispatched);
  return (
    <div className={`lotitem${gone ? ' lotitem--gone' : ''}`}>
      <div className="lotitem__top">
        <span className="lotitem__name">{item.itemName}</span>
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
    </div>
  );
}

/**
 * What can go in this batch.
 *
 * Everything the shop has sold that is bound for a batch and is not in one -
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
            : 'Nothing waiting. Items appear here when somebody buys an import that has no batch yet.'}
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

/** One batch: what's in it, how to move it, and where the tracking goes. */
export function BatchDetail({ lotId, onBack }: { lotId: string; onBack: () => void }) {
  const [data, setData] = useState<LotContents | null>(null);
  const [unassigned, setUnassigned] = useState<LotsResponse['unassigned']>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

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

  const { lot, listings, orders, totals, route, items } = data;
  const nextStep = route.steps[route.currentStep + 1] ?? null;

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
        <div className="row">
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditing(true)}>Edit details</button>
          <StageBadge stage={lot.stage} />
        </div>
      </div>

      {editing && (
        <EditLotDialog lot={lot} onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load(); }} />
      )}

      {flash && (
        <p className={`notice notice--${/^(Now|Added|Tracking|Item|Stepped|Saved)/.test(flash) ? 'ok' : 'error'}`}>
          {flash}
        </p>
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
              Every item here travels the batch's route. Move the batch and all {items.length} move
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
                Nothing in this batch yet. Add the items your customers have already bought.
              </p>
            ) : (
              items.map((item) => (
                <LotItemRow
                  key={item.id}
                  item={item}
                  atSeller={route.atSeller}
                  busy={busy}
                  onTick={(checkpoint, on) =>
                    run('Item updated.', () => api.setCheckpoint(item.id, checkpoint, on).then(() => {}))}
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
                The catalog side: anything bought from one of these goes straight into this batch,
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
            <div>
              <span className="faint">Current status</span>
              <div className="card__title">{route.steps[route.currentStep]?.name ?? 'Not started'}</div>
              <span className="field__hint">{route.name}</span>
            </div>

            <Ladder steps={route.steps} current={route.currentStep} />

            {nextStep ? (
              <>
                <label className="field">
                  <span>Note (optional)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="All units checked in" />
                </label>
                <button className="btn btn--block" disabled={busy}
                  onClick={() => void run(`Now: ${nextStep.name}.`, async () => {
                    await api.stepLot(lot.id, { note: note || undefined });
                    setNote('');
                  })}>
                  Move to next step
                </button>
                <p className="faint">
                  {items.length === 0
                    ? 'Nothing riding in this batch yet, so this only moves the batch itself.'
                    : `${nextStep.name} — and ${items.length} item${items.length === 1 ? '' : 's'} move with it.`}
                </p>
              </>
            ) : (
              <p className="notice notice--ok">
                {route.steps[route.currentStep]?.name ?? 'Delivered'}. Nothing further to do.
              </p>
            )}

            {/* The commonest correction on any board is a button pressed once
                too many, and twenty buyers have already been told. */}
            {route.currentStep > 0 && (
              <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                onClick={() => void run('Stepped back.', () =>
                  api.stepLot(lot.id, { to: route.currentStep - 1 }).then(() => {}))}>
                Step back
              </button>
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
