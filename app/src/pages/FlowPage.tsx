import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { OrderCheckpoint } from '@shared/enums';
import {
  KIT_BUTTON_DEFAULTS, KIT_CHECKPOINTS, KIT_LOCKED, KIT_WHO, KIT_WHO_META, isBuiltInKit, kitToPreLotRoute,
  type ButtonKit, type KitButton, type KitStage,
} from '@shared/flows';
import { TRIGGER_LABELS, itemLeaveIndex, joinIndexOf, type TrackingRoute } from '@shared/routes';
import { ApiRequestError, api, type FlowsResponse } from '../api';
import { KitButtons } from '../components/KitButtons';
import { Ladder } from '../components/Ladder';
import { ErrorNotice, Icon } from '../components/ui';

/**
 * Flows: an item's whole journey as three snap-together pieces.
 *
 *   📍 Before lot  →  🛳️ In a lot  →  🏠 After lot
 *
 * The ends are button kits (what an item shows, who presses it, what the
 * buyer reads); the middle is a route from the existing builders. Each piece
 * is saved on its own and a flow only wires them together, so one
 * "Freight forwarder" kit serves every flow that starts at a forwarder.
 */

/** The three pieces, in the order an item meets them. */
const PIECES = [
  { key: 'before', icon: '📍', title: 'Before lot', blurb: 'The buttons an item shows until it joins a lot' },
  { key: 'lot', icon: '🛳️', title: 'In a lot', blurb: 'The route the whole lot travels together' },
  { key: 'after', icon: '🏠', title: 'After lot', blurb: 'The last mile, one parcel at a time' },
] as const;

/* ── The shelf on the Routes page ─────────────────────────────────────── */

/** A flow drawn as three boxes joined by arrows - the same shape everywhere it appears. */
function FlowStrip({ before, lot, after }: { before: string | null; lot: string | null; after: string | null }) {
  const names = [before, lot, after];
  return (
    <span className="fstrip">
      {PIECES.map((piece, index) => (
        <span key={piece.key} className="fstrip__cell">
          {index > 0 && <span className="fstrip__arrow" aria-hidden="true" />}
          <span className={`fstrip__box${names[index] ? '' : ' is-empty'}`}>
            <span className="fstrip__icon" aria-hidden="true">{piece.icon}</span>
            <span className="fstrip__name">{names[index] ?? 'Not set'}</span>
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * The top of the Routes page: build a flow, the ones built, and samples.
 *
 * Read-only of everything but its own links, so it can sit above the route
 * list without the list knowing it is there.
 */
export function FlowShelf() {
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [routes, setRoutes] = useState<TrackingRoute[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api.flows(), api.routes()])
      .then(([flows, library]) => {
        setData(flows);
        setRoutes(library.routes);
      })
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your flows.'));
  }, []);

  const kitName = (id: string | null) => (id
    ? [...(data?.kits ?? []), ...(data?.builtInKits ?? [])].find((kit) => kit.id === id)?.name ?? 'Missing kit'
    : null);
  const routeName = (id: string | null) => (id ? routes.find((route) => route.id === id)?.name ?? 'Missing route' : null);

  return (
    <section className="fshelf" aria-label="Flows">
      <div className="fshelf__head">
        <span>
          <span className="fshelf__eyebrow">🧩 Flows</span>
          <h2 className="fshelf__title">Items before lot → in a lot → after a lot</h2>
        </span>
      </div>

      <Link to="/routes/flow/new" className="fshelf__create">
        <span className="fshelf__plus" aria-hidden="true">＋</span>
        <span>
          <b>Create a flow</b>
          <small>Snap the three pieces together, like building a level</small>
        </span>
      </Link>

      {error && <ErrorNotice message={error} />}

      {data && data.flows.length > 0 && (
        <div className="fshelf__list">
          <span className="rlist__label">My flows</span>
          {data.flows.map((flow) => (
            <Link key={flow.id} to={`/routes/flow/${flow.id}`} className="fshelf__row">
              <span className="fshelf__rowhead">
                <b>{flow.name}</b>
                {flow.isDefault && <span className="badge badge--ok">⭐ Default</span>}
              </span>
              <FlowStrip before={kitName(flow.beforeKitId)} lot={routeName(flow.routeId)} after={kitName(flow.afterKitId)} />
            </Link>
          ))}
        </div>
      )}

      {data && (
        <div className="fshelf__list">
          <span className="rlist__label">Samples to start from</span>
          {data.samples.map((sample) => (
            <Link key={sample.id} to={`/routes/flow/new?sample=${encodeURIComponent(sample.id)}`} className="fshelf__row">
              <span className="fshelf__rowhead">
                <b>{sample.name}</b>
                <span className="faint">{sample.blurb}</span>
              </span>
              <FlowStrip before={kitName(sample.beforeKitId)} lot={sample.routeName} after={kitName(sample.afterKitId)} />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── The builder ──────────────────────────────────────────────────────── */

/** One end of the flow being worked on: a copy of a kit, free to change. */
interface Piece {
  /** The kit it was picked from, to tell an edit from a reuse. */
  sourceId: string | null;
  name: string;
  buttons: KitButton[];
  isDefault: boolean;
}

interface Draft {
  name: string;
  before: Piece | null;
  routeId: string | null;
  after: Piece | null;
  isDefault: boolean;
  tab: 0 | 1 | 2;
}

const BLANK: Draft = { name: '', before: null, routeId: null, after: null, isDefault: false, tab: 0 };

const pieceOf = (kit: ButtonKit): Piece => ({
  sourceId: kit.id, name: kit.name, buttons: kit.buttons.map((entry) => ({ ...entry })), isDefault: Boolean(kit.isDefault),
});

/** Kept in the tab while the seller pops out to the Route Studio and back. */
const draftKey = (id: string | null) => `figmark.flowDraft:${id ?? 'new'}`;
function readDraft(id: string | null): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(id));
    return raw ? { ...BLANK, ...(JSON.parse(raw) as Draft) } : null;
  } catch {
    return null;
  }
}
function writeDraft(id: string | null, draft: Draft | null) {
  try {
    if (draft) window.sessionStorage.setItem(draftKey(id), JSON.stringify(draft));
    else window.sessionStorage.removeItem(draftKey(id));
  } catch { /* private mode: the draft lives as long as the screen */ }
}

/** Filled into `{origin}`/`{destination}` in the previews, as on a real lot. */
const PREVIEW_VARS = { origin: 'China', destination: 'India' };

/** Icons a block can wear; tapping a block's icon steps through them. */
const BLOCK_ICONS = ['📥', '📦', '🏬', '🚢', '🏭', '📤', '✋', '🔍', '🎁', '🚚', '✅', '📬', '🧰', '✈️'];

interface Burst { id: number; x: number; y: number }
interface Pop { id: number; amount: number }

export function FlowBuilderPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const editing = rawId && rawId !== 'new' ? rawId : null;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const [data, setData] = useState<FlowsResponse | null>(null);
  const [routes, setRoutes] = useState<TrackingRoute[]>([]);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** A sample whose route the shop has not written yet: offered, not assumed. */
  const [suggest, setSuggest] = useState<string | null>(null);

  /* The game layer: XP for building, a burst on every tap, a cheer at the end. */
  const [xp, setXp] = useState(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [cheer, setCheer] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const seq = useRef(0);

  const award = useCallback((amount: number) => {
    setXp((current) => current + amount);
    const id = ++seq.current;
    setPops((current) => [...current, { id, amount }]);
    window.setTimeout(() => setPops((current) => current.filter((pop) => pop.id !== id)), 900);
  }, []);

  function onTap(event: PointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (!target.closest('button, a, [role="radio"], label')) return;
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    const id = ++seq.current;
    setBursts((current) => [...current.slice(-5), { id, x: event.clientX - box.left, y: event.clientY - box.top }]);
    window.setTimeout(() => setBursts((current) => current.filter((burst) => burst.id !== id)), 650);
  }

  /* Load, then work out what to open with: the saved flow, a sample, a draft
     left mid-build, or nothing - and a route handed back from the Studio. */
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.flows(), api.routes()])
      .then(([flows, library]) => {
        if (cancelled) return;
        setData(flows);
        setRoutes(library.routes);
        const all = [...flows.kits, ...flows.builtInKits];
        const kit = (kitId: string | null) => all.find((entry) => entry.id === kitId);

        let next: Draft = readDraft(editing) ?? BLANK;
        const sampleId = params.get('sample');
        const sample = flows.samples.find((entry) => entry.id === sampleId);
        if (editing && !readDraft(editing)) {
          const flow = flows.flows.find((entry) => entry.id === editing);
          if (!flow) {
            setError('No such flow.');
          } else {
            const before = kit(flow.beforeKitId);
            const after = kit(flow.afterKitId);
            next = {
              ...BLANK, name: flow.name, routeId: flow.routeId, isDefault: Boolean(flow.isDefault),
              before: before ? pieceOf(before) : null, after: after ? pieceOf(after) : null,
            };
          }
        } else if (sample) {
          const before = kit(sample.beforeKitId);
          const after = kit(sample.afterKitId);
          const route = library.routes.find((entry) => entry.name === sample.routeName);
          next = {
            ...BLANK, name: sample.name, routeId: route?.id ?? null,
            before: before ? pieceOf(before) : null, after: after ? pieceOf(after) : null,
          };
          if (!route) setSuggest(sample.routeName);
        }
        const handedBack = params.get('route');
        if (handedBack && library.routes.some((entry) => entry.id === handedBack)) {
          next = { ...next, routeId: handedBack, tab: 1 };
        }
        setDraft(next);
        setReady(true);
        if (sampleId || handedBack) {
          const copy = new URLSearchParams(params);
          copy.delete('sample');
          copy.delete('route');
          setParams(copy, { replace: true });
        }
      })
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your flows.'));
    return () => { cancelled = true; };
    // Read once, on the way in: the params are consumed and cleared above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (ready) writeDraft(editing, draft);
  }, [ready, editing, draft]);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const route = routes.find((entry) => entry.id === draft.routeId) ?? null;
  const placed = [draft.before, draft.routeId, draft.after].filter(Boolean).length;

  /* All three in: the one moment worth a cheer. */
  const wasComplete = useRef(false);
  useEffect(() => {
    const complete = placed === 3;
    if (ready && complete && !wasComplete.current) setCheer((current) => current + 1);
    wasComplete.current = complete;
  }, [placed, ready]);

  const kitsFor = (stage: KitStage) => [
    ...(data?.kits ?? []).filter((kit) => kit.stage === stage),
    ...(data?.builtInKits ?? []).filter((kit) => kit.stage === stage),
  ];
  const kitById = (kitId: string | null) => [...(data?.kits ?? []), ...(data?.builtInKits ?? [])]
    .find((kit) => kit.id === kitId);

  /**
   * A piece as a saved kit id: the kit it came from when nothing changed,
   * otherwise saved - over the shop's own kit, or as a new one when it
   * started as a built-in.
   */
  async function kitIdFor(stage: KitStage, piece: Piece | null): Promise<string | null> {
    if (!piece) return null;
    const source = kitById(piece.sourceId);
    const unchanged = source
      && source.name === piece.name
      && JSON.stringify(source.buttons) === JSON.stringify(piece.buttons)
      && Boolean(source.isDefault) === piece.isDefault;
    if (source && (unchanged || (isBuiltInKit(source.id) && JSON.stringify(source.buttons) === JSON.stringify(piece.buttons) && !piece.isDefault))) {
      return source.id;
    }
    const builtIn = isBuiltInKit(source?.id);
    const name = piece.name.trim() || (stage === 'before' ? 'My before-lot kit' : 'My last-mile kit');
    const saved = await api.saveKit({
      id: source && !builtIn ? source.id : undefined,
      stage,
      name: builtIn && name === source?.name ? `My ${name}` : name,
      buttons: piece.buttons,
      isDefault: piece.isDefault,
    });
    return saved.kit.id;
  }

  async function saveKit(stage: KitStage) {
    const piece = stage === 'before' ? draft.before : draft.after;
    if (!piece) return;
    setBusy(true);
    setError(null);
    try {
      const kitId = await kitIdFor(stage, piece);
      const fresh = await api.flows();
      setData(fresh);
      const kit = [...fresh.kits, ...fresh.builtInKits].find((entry) => entry.id === kitId);
      if (kit) update(stage === 'before' ? { before: pieceOf(kit) } : { after: pieceOf(kit) });
      setNotice(`💾 Kit saved — snap “${kit?.name ?? piece.name}” into any flow.`);
      award(50);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that kit.');
    } finally {
      setBusy(false);
    }
  }

  async function saveFlow() {
    setBusy(true);
    setError(null);
    try {
      const beforeKitId = await kitIdFor('before', draft.before);
      const afterKitId = await kitIdFor('after', draft.after);
      await api.saveFlow({
        id: editing ?? undefined,
        name: draft.name.trim(),
        beforeKitId,
        routeId: draft.routeId,
        afterKitId,
        isDefault: draft.isDefault,
      });
      writeDraft(editing, null);
      navigate('/routes');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save this flow.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || !window.confirm(`Take “${draft.name || 'this flow'}” apart? Its kits and route stay.`)) return;
    setBusy(true);
    try {
      await api.deleteFlowDoc(editing);
      writeDraft(editing, null);
      navigate('/routes');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete this flow.');
      setBusy(false);
    }
  }

  const here = editing ? `/routes/flow/${editing}` : '/routes/flow/new';
  const names = [draft.before?.name ?? null, route?.name ?? null, draft.after?.name ?? null];
  const canSave = Boolean(draft.name.trim()) && placed > 0 && !busy;

  return (
    <main className="page fb" ref={rootRef} onPointerDown={onTap}>
      <div className="fb__sky" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ '--n': index } as CSSProperties} />)}
      </div>
      {bursts.map((burst) => (
        <span key={burst.id} className="fb__burst" style={{ left: burst.x, top: burst.y }} aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <i key={index} style={{ '--n': index } as CSSProperties} />)}
        </span>
      ))}

      <Link to="/routes" className="backlink">
        <Icon name="back" size={14} /> Routes
      </Link>

      <header className="fb__head">
        <span>
          <span className="fb__eyebrow">🏗️ Flow builder</span>
          <h1 className="fb__title">{editing ? 'Rebuild your flow' : 'Build a flow'}</h1>
        </span>
        <span className="fb__xp" aria-live="polite">
          ⚡ <b>{xp}</b> XP
          {pops.map((pop) => <span key={pop.id} className="fb__pop" aria-hidden="true">+{pop.amount}</span>)}
        </span>
      </header>

      <div className="fb__meter" role="img" aria-label={`${placed} of 3 pieces placed`}>
        {PIECES.map((piece, index) => (
          <span key={piece.key} className={`fb__meter-seg${names[index] ? ' is-on' : ''}`} />
        ))}
        <span className="fb__meter-text">{placed}/3 pieces</span>
      </div>

      <label className="fb__plate">
        <span>Flow name</span>
        <input value={draft.name} maxLength={60} placeholder="e.g. Forwarder run, Sept"
          onChange={(event) => update({ name: event.target.value })} />
      </label>

      {error && <ErrorNotice message={error} />}
      {!ready && !error && <p className="muted">Loading the workshop…</p>}

      {ready && (
        <>
          {/* The three pieces as tabs joined by arrows; the open one runs
              straight into the workshop below it, like a folder tab. */}
          <div className="fb__tabs" role="tablist" aria-label="Flow pieces">
            {PIECES.map((piece, index) => (
              <span key={piece.key} className="fb__tabcell">
                {index > 0 && (
                  <span className={`fb__link${names[index - 1] && names[index] ? ' is-live' : ''}`} aria-hidden="true" />
                )}
                <button type="button" role="tab" aria-selected={draft.tab === index}
                  className={`fb__tab${draft.tab === index ? ' is-on' : ''}${names[index] ? ' is-set' : ''}`}
                  onClick={() => update({ tab: index as 0 | 1 | 2 })}>
                  <span className="fb__tab-icon" aria-hidden="true">{piece.icon}</span>
                  <span className="fb__tab-title">{piece.title}</span>
                  <span className="fb__tab-sub">{names[index] ?? 'Tap to build'}</span>
                  {names[index] && <span className="fb__tab-check" aria-hidden="true">✓</span>}
                </button>
              </span>
            ))}
          </div>

          <section className="fb__panel" data-tab={draft.tab} role="tabpanel">
            <p className="fb__panel-blurb">{PIECES[draft.tab].blurb}</p>

            {draft.tab === 0 && (
              <KitWorkshop stage="before" piece={draft.before} kits={kitsFor('before')}
                defaultId={data?.defaults.before ?? null} busy={busy} award={award}
                onChange={(before) => update({ before })} onSave={() => void saveKit('before')} />
            )}

            {draft.tab === 1 && (
              <LotPiece routes={routes} routeId={draft.routeId} here={here} suggest={suggest}
                before={draft.before} after={draft.after}
                onPick={(routeId) => { update({ routeId }); award(40); }} />
            )}

            {draft.tab === 2 && (
              <KitWorkshop stage="after" piece={draft.after} kits={kitsFor('after')}
                defaultId={data?.defaults.after ?? null} busy={busy} award={award} route={route}
                onChange={(after) => update({ after })} onSave={() => void saveKit('after')} />
            )}

            {draft.tab < 2 && (
              <button type="button" className="fb__next" onClick={() => update({ tab: (draft.tab + 1) as 1 | 2 })}>
                Next piece: {PIECES[draft.tab + 1]!.icon} {PIECES[draft.tab + 1]!.title} <Icon name="right" size={13} />
              </button>
            )}
          </section>

          {placed === 3 && (
            <div className="fb__done" key={cheer} role="status">
              <span className="fb__confetti" aria-hidden="true">
                {Array.from({ length: 14 }, (_, index) => <i key={index} style={{ '--n': index } as CSSProperties} />)}
              </span>
              🏆 <b>Flow complete!</b> Save it and every new item can ride it.
            </div>
          )}

          {notice && <p className="fb__notice" role="status">{notice}</p>}

          <div className="fb__dock">
            <label className="fb__toggle">
              <input type="checkbox" checked={draft.isDefault} onChange={(event) => update({ isDefault: event.target.checked })} />
              <span>⭐ My default flow — new items get its before-lot buttons</span>
            </label>
            <div className="row">
              <button type="button" className="btn fb__save" disabled={!canSave} onClick={() => void saveFlow()}>
                {busy ? 'Saving…' : editing ? '💾 Save flow' : '🚀 Save flow'}
              </button>
              {editing && (
                <button type="button" className="btn btn--ghost btn--danger" disabled={busy} onClick={() => void remove()}>
                  Delete
                </button>
              )}
            </div>
            {!draft.name.trim() && <span className="field__hint">Name the flow to save it.</span>}
          </div>
        </>
      )}
    </main>
  );
}

/* ── A kit's workshop: shelf, slots, preview ──────────────────────────── */

function KitWorkshop({ stage, piece, kits, defaultId, busy, award, route, onChange, onSave }: {
  stage: KitStage;
  piece: Piece | null;
  kits: ButtonKit[];
  defaultId: string | null;
  busy: boolean;
  award: (amount: number) => void;
  /** After the lot: the route its buttons move along, to show what each one moves. */
  route?: TrackingRoute | null;
  onChange: (piece: Piece | null) => void;
  onSave: () => void;
}) {
  /** Which block is open for editing. */
  const [open, setOpen] = useState<OrderCheckpoint | null>(null);
  /** The preview's own presses, so it can be played with without touching an order. */
  const [pressed, setPressed] = useState<Partial<Record<OrderCheckpoint, string | null>>>({});

  const allowed = KIT_CHECKPOINTS[stage];
  const buttons = piece?.buttons ?? [];

  function pick(kit: ButtonKit) {
    onChange(pieceOf(kit));
    setPressed({});
    award(15);
  }
  function setButtons(next: KitButton[]) {
    if (!piece) return;
    onChange({ ...piece, buttons: allowed.filter((entry) => next.some((b) => b.checkpoint === entry))
      .map((entry) => next.find((b) => b.checkpoint === entry)!) });
  }
  function snapIn(checkpoint: OrderCheckpoint) {
    const fresh: KitButton = { id: `b_${checkpoint}`, checkpoint, ...KIT_BUTTON_DEFAULTS[checkpoint] };
    if (!piece) {
      onChange({ sourceId: null, name: '', buttons: [fresh], isDefault: false });
    } else {
      setButtons([...buttons, fresh]);
    }
    setOpen(checkpoint);
    award(25);
  }
  function edit(checkpoint: OrderCheckpoint, patch: Partial<KitButton>) {
    setButtons(buttons.map((entry) => (entry.checkpoint === checkpoint ? { ...entry, ...patch } : entry)));
  }

  const preLot = useMemo(() => (piece ? kitToPreLotRoute({ name: piece.name, buttons }) : null), [piece, buttons]);
  const furthest = preLot
    ? preLot.steps.reduce((at, step, index) => (step.trigger && pressed[step.trigger] ? index : at), 0)
    : 0;
  const unbound = stage === 'after' && route
    // Delivered needs no step: it finishes the order whatever the route says.
    ? buttons.filter((entry) => entry.checkpoint !== 'delivered'
      && !route.steps.some((step) => step.trigger === entry.checkpoint))
    : [];

  return (
    <div className="stack">
      <span className="fb__label">{stage === 'before' ? 'Who gets the item first?' : 'Who finishes the last mile?'}</span>
      <div className="fb__shelf" role="radiogroup" aria-label="Starter kits">
        {kits.map((kit) => (
          <button key={kit.id} type="button" role="radio" aria-checked={piece?.sourceId === kit.id}
            className={`fb__kit${piece?.sourceId === kit.id ? ' is-on' : ''}`} onClick={() => pick(kit)}>
            <span className="fb__kit-icon" aria-hidden="true">{KIT_WHO_META[kit.buttons[0]?.who ?? 'me'].icon}</span>
            <b>{kit.name}</b>
            <small>
              {isBuiltInKit(kit.id) ? 'Starter' : 'Mine'} · {kit.buttons.length} button{kit.buttons.length === 1 ? '' : 's'}
              {kit.id === defaultId ? ' · ⭐' : ''}
            </small>
          </button>
        ))}
      </div>

      <span className="fb__label">Blocks — tap a slot to snap a button in</span>
      <ol className="fb__slots">
        {allowed.map((checkpoint) => {
          const block = buttons.find((entry) => entry.checkpoint === checkpoint);
          const locked = KIT_LOCKED[stage].includes(checkpoint);
          if (!block) {
            return (
              <li key={checkpoint}>
                <button type="button" className="fb__slot" onClick={() => snapIn(checkpoint)}>
                  <span className="fb__slot-plus" aria-hidden="true">＋</span>
                  <span>
                    Snap in <b>{KIT_BUTTON_DEFAULTS[checkpoint].label}</b>
                    <small>Press when {TRIGGER_LABELS[checkpoint].means}</small>
                  </span>
                </button>
              </li>
            );
          }
          const who = KIT_WHO_META[block.who];
          const isOpen = open === checkpoint;
          return (
            <li key={checkpoint} className={`fb__block${isOpen ? ' is-open' : ''}`}>
              <div className="fb__block-row">
                <button type="button" className="fb__block-icon" title="Change the icon"
                  onClick={() => edit(checkpoint, { icon: BLOCK_ICONS[(BLOCK_ICONS.indexOf(block.icon) + 1) % BLOCK_ICONS.length] })}>
                  {block.icon}
                </button>
                <button type="button" className="fb__block-main" aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : checkpoint)}>
                  <b>{block.label}</b>
                  <small>{who.icon} {who.label} · buyer reads “{block.step}”</small>
                </button>
                {locked
                  ? <span className="fb__lock" title="Every last mile needs this one">🔒</span>
                  : (
                    <button type="button" className="fb__block-x" aria-label={`Take out ${block.label}`}
                      onClick={() => {
                        const rest = buttons.filter((entry) => entry.checkpoint !== checkpoint);
                        if (rest.length === 0) onChange(null); else setButtons(rest);
                      }}>
                      ✕
                    </button>
                  )}
              </div>
              {isOpen && (
                <div className="fb__block-edit">
                  <label className="field">
                    <span>Button says</span>
                    <input value={block.label} maxLength={24} onChange={(event) => edit(checkpoint, { label: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Who presses it</span>
                    <select value={block.who} onChange={(event) => edit(checkpoint, { who: event.target.value as KitButton['who'] })}>
                      {KIT_WHO.map((entry) => (
                        <option key={entry} value={entry}>{KIT_WHO_META[entry].icon} {KIT_WHO_META[entry].label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>The buyer reads</span>
                    <input value={block.step} maxLength={80} onChange={(event) => edit(checkpoint, { step: event.target.value })} />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {piece && (
        <div className="fb__preview">
          <span className="fb__label">
            {stage === 'before' ? 'Live preview · the item card under Items' : 'Live preview · an item in an unpacked lot'}
          </span>
          {stage === 'before' ? (
            <div className="fb__card">
              <span className="fb__card-thumb" aria-hidden="true">🧸</span>
              <span className="fb__card-body">
                <b>Your next import</b>
                <small>A buyer · just now</small>
              </span>
              <div className="ocard__acts fb__card-acts">
                <KitButtons look="chip" buttons={buttons} checkpoints={pressed}
                  onPress={(checkpoint, on) => setPressed((current) => ({ ...current, [checkpoint]: on ? 'now' : null }))} />
              </div>
            </div>
          ) : (
            <div className="lotitem__acts">
              <KitButtons look="tile" buttons={buttons} checkpoints={pressed} steps={route?.steps} vars={PREVIEW_VARS}
                onPress={(checkpoint, on) => setPressed((current) => ({ ...current, [checkpoint]: on ? 'now' : null }))} />
            </div>
          )}
          {stage === 'before' && preLot && (
            <>
              <span className="fb__label">What the buyer's timeline says</span>
              <Ladder steps={preLot.steps} current={furthest} vars={PREVIEW_VARS} />
            </>
          )}
          {stage === 'after' && !route && (
            <span className="field__hint">Pick the lot's route in “In a lot” to see which step each button moves.</span>
          )}
          {unbound.length > 0 && (
            <span className="field__hint">
              🔌 {unbound.map((entry) => entry.label).join(', ')} record{unbound.length === 1 ? 's' : ''} the tick but
              move{unbound.length === 1 ? 's' : ''} no step on “{route?.name}” — bind {unbound.length === 1 ? 'it' : 'them'} in the route to move the buyer's timeline.
            </span>
          )}

          <div className="fb__kitbar">
            <label className="field">
              <span>Kit name</span>
              <input value={piece.name} maxLength={60} placeholder={stage === 'before' ? 'Freight forwarder' : 'Full last mile'}
                onChange={(event) => onChange({ ...piece, name: event.target.value })} />
            </label>
            {stage === 'before' && (
              <label className="fb__toggle">
                <input type="checkbox" checked={piece.isDefault}
                  onChange={(event) => onChange({ ...piece, isDefault: event.target.checked })} />
                <span>⭐ Default for new items, and asked when listing one</span>
              </label>
            )}
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy || !piece.name.trim()} onClick={onSave}>
              💾 Save this kit on its own
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The middle piece: a route ────────────────────────────────────────── */

function LotPiece({ routes, routeId, here, suggest, before, after, onPick }: {
  routes: TrackingRoute[];
  routeId: string | null;
  /** This builder's own address, for the route editors to come back to. */
  here: string;
  suggest: string | null;
  before: Piece | null;
  after: Piece | null;
  onPick: (routeId: string) => void;
}) {
  const route = routes.find((entry) => entry.id === routeId) ?? null;
  const back = `?back=${encodeURIComponent(here)}`;
  const join = route ? joinIndexOf(route) : 0;
  const leave = route ? itemLeaveIndex(route) : 0;

  return (
    <div className="stack">
      {suggest && !route && (
        <p className="fb__hint">
          This sample rides a <b>{suggest}</b> route. Write it once — the classic editor has it as a starting shape —
          and it snaps in here when you save.
        </p>
      )}

      <span className="fb__label">Pick the route the lot travels</span>
      {routes.length === 0 ? (
        <p className="muted">No routes yet. Build one — it comes straight back here.</p>
      ) : (
        <div className="fb__routes" role="radiogroup" aria-label="Routes">
          {routes.map((entry) => (
            <button key={entry.id} type="button" role="radio" aria-checked={entry.id === routeId}
              className={`fb__route${entry.id === routeId ? ' is-on' : ''}`} onClick={() => onPick(entry.id)}>
              <b>{entry.name}</b>
              <small>{entry.steps.length} steps · joins a lot at step {joinIndexOf(entry) + 1}</small>
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Link to={`/routes/studio/new${back}`} className="btn btn--sm">🛠️ New route in Studio</Link>
        {route && <Link to={`/routes/studio/${route.id}${back}`} className="btn btn--ghost btn--sm">✏️ Edit in Studio</Link>}
        <Link to={`/routes/new${back}`} className="btn btn--quiet btn--sm">Classic editor</Link>
      </div>

      {route && (
        <div className="fb__preview">
          <span className="fb__label">How the pieces plug in</span>
          <ul className="fb__plugs">
            <li>
              📍 <b>{before?.name ?? 'Before-lot buttons'}</b> run until the item joins the lot
              {route.steps[join] ? <> at “{route.steps[join]!.name}”</> : null}.
            </li>
            <li>
              🏠 <b>{after?.name ?? 'Last-mile buttons'}</b> take over
              {route.steps[leave] ? <> from “{route.steps[leave]!.name}”</> : ' once the lot is unpacked'}.
            </li>
          </ul>
          <Ladder steps={route.steps} current={-1} leaveAt={leave} vars={PREVIEW_VARS} />
        </div>
      )}
    </div>
  );
}

