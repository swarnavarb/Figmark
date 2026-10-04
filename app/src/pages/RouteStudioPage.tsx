import { Fragment, createContext, useContext, useState, useEffect, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { assignButtons, checkButtons, stepChoices, type ButtonChange, type StepKind, type StepZone } from '@shared/buttons';
import {
  DEFAULT_WAIT_MESSAGES, NO_WAIT_MESSAGE, WAIT_MESSAGE_PRESETS, joinIndexOf, leaveIndexOf,
  renderStepText, routePartsLine, sideOf, stepButtonLabel, stepId, stepTickKey, waitMessageFor,
  type RouteStep, type StepAssignee, type StepTrigger, type TrackingRoute,
} from '@shared/routes';
import { ApiRequestError, api, type RoutesResponse } from '../api';
import { ErrorNotice, Icon, Modal, WaveLoader } from '../components/ui';
import { SkeletonRows } from '../components/Feedback';
import { STAGE_ICON_META } from '../components/RouteBuilder';
import { stepEmoji } from '../components/OrderTrack';
import {
  PipSays, pipAck, pipQueue, pipTips, pipTotal, routeFromAnswers, type PipAnswers, type PipFix,
} from '../components/RouteMascot';
import { RoutePreview } from '../components/RoutePreview';

/**
 * Stands in for the real lot's countries while a route is being written -
 * nothing is attached to one yet. Read off the shop's own latest lot, so a
 * shop shipping Japan to India previews in those words; with no lot yet the
 * tokens read as plain "the origin" and "the destination".
 */
type PreviewVars = { origin?: string | null; destination?: string | null };
const PreviewVarsContext = createContext<PreviewVars>({});

/**
 * The last stop, guaranteed. Every route opened here ends on a locked
 * "Delivered" node bound to the `delivered` checkpoint - upgrading one
 * already named that (most presets already end on a plain "Delivered" step)
 * rather than adding a second, and appending one for the handful of shapes
 * that do not.
 */
function ensureDelivered(steps: readonly RouteStep[]): RouteStep[] {
  const last = steps[steps.length - 1];
  if (last && last.name.trim().toLowerCase() === 'delivered') {
    return steps.map((step, index) => (index === steps.length - 1
      ? { ...step, name: 'Delivered', locked: true, trigger: 'delivered' as StepTrigger, lastMile: true }
      : step));
  }
  return [...steps, {
    id: stepId(steps.length), name: 'Delivered', description: 'It reached you.', position: 0,
    side: 'post', locked: true, trigger: 'delivered' as StepTrigger, lastMile: true,
  }];
}

/**
 * Where a route is written: a vertical chain of nodes in three lanes - before
 * the lot, in it, after it - with a "+" between any two, and a scrubbable
 * preview of what a buyer sees. The one route builder; every way into a
 * route, new or saved, opens here.
 */
export function RouteStudioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const back = () => navigate('/shop?tab=routes');
  return (
    <main className="page">
      <Link to="/shop?tab=routes" className="backlink">
        <Icon name="back" size={14} /> Routes
      </Link>
      <RouteStudio editing={id && id !== 'new' ? id : null} onSaved={back} onCancel={back} />
    </main>
  );
}

/** Dispatched and Delivered: always the last two presses, so never moved or removed. */
const isFixed = (step: RouteStep | undefined) => step?.trigger === 'dispatched' || step?.trigger === 'delivered';

const blankStep = (seed: number): RouteStep => ({
  id: stepId(seed), name: '', description: '', position: 0,
});

export function RouteStudio({ editing, onSaved, onCancel, intro, cancelLabel = 'Cancel' }: {
  editing: string | null;
  /** Handed the route as saved, for a caller that picks it straight away. */
  onSaved: (route: TrackingRoute) => void;
  onCancel: () => void;
  /** Said above the starting points, for somebody meeting routes for the first time. */
  intro?: ReactNode;
  cancelLabel?: string;
}) {
  const [library, setLibrary] = useState<RoutesResponse | null>(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<RouteStep[]>([]);
  /** Index of the first step that happens to the whole lot, not one item alone. */
  const [joinAt, setJoinAt] = useState(0);
  /** Index of the first step reached one item at a time again, after the lot. */
  const [leaveAt, setLeaveAt] = useState(0);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Pip: asking its questions, suggesting fixes, or tucked away. */
  const [pip, setPip] = useState<'ask' | 'coach' | 'hidden'>('coach');
  const [answers, setAnswers] = useState<PipAnswers>({});
  const [pipSaid, setPipSaid] = useState('');
  const [tipAt, setTipAt] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  /** Where a step is being added: the index it will take, and which part of the journey. */
  const [adding, setAdding] = useState<{ at: number; zone: StepZone } | null>(null);
  /** The shop's own lane, so the preview reads in its countries rather than ours. */
  const [vars, setVars] = useState<PreviewVars>({});
  /** The chain as last opened or saved: anything else on screen is unsaved work. */
  const [savedAs, setSavedAs] = useState<string | null>(null);

  useEffect(() => {
    void api.myLots().then((result) => {
      const lane = result.lots.find((entry) => entry.lot.originCountry || entry.lot.destinationCountry)?.lot;
      if (lane) setVars({ origin: lane.originCountry, destination: lane.destinationCountry });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    void api.routes().then((result) => {
      setLibrary(result);
      if (!editing) return;
      const found = result.routes.find((route) => route.id === editing);
      if (!found) { setError('No such route.'); return; }
      const moved = open(found.steps, found.name).filter((change) => change.to || change.from);
      if (moved.length > 0) {
        setPipSaid(`I put this route's buttons in order - ${moved.length === 1 ? '1 step changed' : `${moved.length} steps changed`}, so each button now sits on the step it really moves. Have a look, then save.`);
      }
    }).catch((err) => {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your routes.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  /**
   * Put a route on the page, with its buttons handed out.
   *
   * Every way in - a template, a saved route, Pip's answers - goes through
   * `assignButtons` here, so the chain on screen always has Dispatched and
   * Delivered last and every button in the order it really happens. What it
   * had to change on a saved route is returned, for Pip to say.
   */
  function open(from: readonly RouteStep[], called: string): ButtonChange[] {
    const withDelivered = ensureDelivered(from);
    const withSides = withDelivered.map((step, index) => ({ ...step, position: index, side: sideOf(step, index) }));
    const { steps: given, changes } = assignButtons(withSides);
    const join = joinIndexOf({ steps: given });
    const leave = Math.min(leaveIndexOf({ steps: given }), given.findIndex((step) => step.trigger === 'dispatched'));
    setName(called);
    setSteps(given);
    setJoinAt(join);
    setLeaveAt(leave);
    setStarted(true);
    /* A saved route opens clean; a starting point is already unsaved work
       the moment it is on screen, so it is never thrown away unasked. */
    setSavedAs(editing ? snapshot(called, given, join, leave) : null);
    return changes;
  }

  /** Start over with Pip asking: the chain grows one answer at a time. */
  function startPip() {
    setAnswers({});
    setPipSaid('');
    setPip('ask');
    open(routeFromAnswers({}), name);
  }

  function answer(next: PipAnswers) {
    const before = routeFromAnswers(answers);
    const after = routeFromAnswers(next);
    setAnswers(next);
    setPipSaid(pipAck(before, after, vars));
    open(after, name);
    if (pipQueue(next).length === 0) { setPip('coach'); setTipAt(0); }
  }

  function fix(action: PipFix) {
    if (action.kind === 'preview') { setPreviewing(true); return; }
    if (action.kind === 'name') { document.getElementById('rs-name')?.focus(); return; }
    const input = document.querySelector<HTMLInputElement>(`[data-step="${action.stepId}"] .rsbtn__words`);
    input?.scrollIntoView({ block: 'center' });
    input?.focus();
  }

  /** Every step's `side` and `lastMile`, recomputed from the two lines rather
   *  than carried per-step - moving a line is what moves a step between
   *  halves. */
  const sided = steps.map((step, index) => ({
    ...step,
    side: index < joinAt ? ('pre' as const) : ('post' as const),
    lastMile: index >= leaveAt ? true : undefined,
  }));

  /* The buttons, handed out from the steps as they stand - recomputed on
     every edit, never picked. Only the words on them are the seller's. */
  const given = assignButtons(sided).steps;
  const dispatchAt = given.findIndex((step) => step.trigger === 'dispatched');
  /* Should a step it had to add (Dispatched, Delivered) ever be missing,
     it becomes a real one on the page rather than a ghost in the preview. */
  useEffect(() => {
    if (!started || given.length === steps.length) return;
    setSteps(given);
    setJoinAt(joinIndexOf({ steps: given }));
    setLeaveAt(Math.min(leaveIndexOf({ steps: given }), given.findIndex((step) => step.trigger === 'dispatched')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, given.length, steps.length]);

  /** Which part of the journey a step sits in, by the two lines. */
  const zoneAt = (index: number): StepZone => (index < joinAt ? 'pre' : index < leaveAt ? 'lot' : 'post');

  /**
   * Add a step of `kind` at `index`, in `zone` - which decides which side of
   * a line it lands when it is added right at one.
   */
  function insertAt(index: number, zone: StepZone, kind?: StepKind) {
    const next = [...steps];
    const step: RouteStep = {
      ...blankStep(steps.length),
      ...(kind ? { name: kind.name, description: kind.description, trigger: kind.trigger, custom: kind.custom } : {}),
    };
    next.splice(index, 0, step);
    setSteps(next);
    if (index < joinAt || (index === joinAt && zone === 'pre')) setJoinAt(joinAt + 1);
    if (index < leaveAt || (index === leaveAt && zone !== 'post')) setLeaveAt(leaveAt + 1);
    setAdding(null);
  }

  function removeAt(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
    if (index < joinAt) setJoinAt(Math.max(0, joinAt - 1));
    if (index < leaveAt) setLeaveAt(Math.max(joinAt, leaveAt - 1));
  }

  function setAt(index: number, patch: Partial<RouteStep>) {
    setSteps(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function moveAt(from: number, to: number) {
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [taken] = next.splice(from, 1);
    next.splice(to, 0, taken!);
    setSteps(next);
    // Both lines track whichever step was on the far side of them, not a
    // raw index, so dragging a step across one moves it with the step.
    if (from < joinAt && to >= joinAt) setJoinAt(joinAt - 1);
    else if (from >= joinAt && to < joinAt) setJoinAt(joinAt + 1);
    if (from < leaveAt && to >= leaveAt) setLeaveAt(leaveAt - 1);
    else if (from >= leaveAt && to < leaveAt) setLeaveAt(leaveAt + 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    // The Studio also opens over the new-lot form; its save is never that form's submit.
    event.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveRoute({
        id: editing ?? undefined,
        name: name.trim(),
        steps: given
          .filter((step) => step.name.trim())
          .map((step) => ({
            id: step.id,
            name: step.name.trim(),
            description: step.description.trim(),
            side: step.side,
            trigger: step.trigger,
            forward: step.forward,
            waitMessage: step.waitMessage,
            lastMile: step.lastMile,
            button: step.button,
            custom: step.custom,
            assignee: step.assignee,
          })),
      });
      setSavedAs(snapshot(name, steps, joinAt, leaveAt));
      /* Saving an edit also moves every unfinished lot on this route, and the
         items in them, onto the new steps - done by the server in one go. */
      onSaved(result.route);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that route.');
    } finally {
      setBusy(false);
    }
  }

  /* Lots carry their own copy of a route, so deleting one only takes it off
     the list - every lot already on it keeps travelling exactly as before. */
  async function remove() {
    if (!editing) return;
    if (!window.confirm(`Delete "${name.trim() || 'this route'}"? Lots already on it keep their steps.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteRoute(editing);
      setSavedAs(null);
      onCancel();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete that route.');
    } finally {
      setBusy(false);
    }
  }

  /** Leaving asks first whenever there is anything on screen that was not saved. */
  function leave() {
    const dirty = started && savedAs !== snapshot(name, steps, joinAt, leaveAt);
    if (dirty && !window.confirm('Leave without saving? This route will be lost.')) return;
    onCancel();
  }

  const named = given.filter((step) => step.name.trim());
  const bound = named.filter((step) => step.trigger).length;
  const problems = checkButtons(named);
  const blocking = problems.filter((problem) => problem.level === 'error');
  /* The two lines, counted along the named steps the preview draws. */
  const namedJoin = (() => { const at = named.findIndex((step) => step.side === 'post'); return at < 0 ? named.length : at; })();
  const namedLeave = (() => { const at = named.findIndex((step) => step.lastMile); return at < 0 ? named.length : at; })();

  /* The three lanes, by the two lines. */
  const lanes: { zone: StepZone; indexes: number[] }[] = (['pre', 'lot', 'post'] as const).map((zone) => ({
    zone,
    indexes: given.map((_, index) => index).filter((index) => zoneAt(index) === zone),
  }));

  const question = pip === 'ask' ? pipQueue(answers)[0] : undefined;
  const tips = pip === 'coach' ? pipTips(named, name, problems) : [];
  const tip = tips.length ? tips[tipAt % tips.length] : undefined;
  const pipDock = pip === 'hidden' ? (
    <button type="button" className="pipcall" onClick={() => setPip('coach')}>🤖 Ask Pip</button>
  ) : question ? (
    <PipSays mood="think"
      text={`${pipSaid ? `${pipSaid} ` : ''}${question.ask(answers)}`}
      step={pipTotal(answers) - pipQueue(answers).length + 1} of={pipTotal(answers)}
      onHide={() => setPip('hidden')}
      choices={[
        ...question.choices.map((choice, index) => ({
          id: String(index), label: choice.label,
          onPick: () => answer({ ...answers, [question.key]: choice.value }),
        })),
        { id: 'self', label: "✋ I'll take it from here", onPick: () => { setPip('coach'); setPipSaid(''); } },
      ]} />
  ) : tip ? (
    <PipSays mood={tip.mood}
      text={`${pipSaid && tipAt === 0 ? `${pipSaid} ` : ''}${tip.text}`}
      onHide={() => setPip('hidden')}
      choices={[
        ...(tip.fix ? [{ id: 'fix', label: tip.fix.label, primary: true, onPick: () => { setPipSaid(''); fix(tip.fix!.action); } }] : []),
        ...(tips.length > 1 ? [{ id: 'next', label: 'Another tip →', onPick: () => { setPipSaid(''); setTipAt((at) => at + 1); } }] : []),
        { id: 'redo', label: '🔁 Ask me again', onPick: startPip },
      ]} />
  ) : null;

  if (!started) {
    return (
      <PreviewVarsContext.Provider value={vars}>
        {intro ?? (
          <div className="page__head">
            <div>
              <h1>{editing ? 'Edit route' : 'New route'}</h1>
              <p className="muted">
                One node per step, top to bottom, with a preview of what a buyer actually sees.
                Start with Pip, from a blank chain, or from a shape close to yours.
              </p>
            </div>
          </div>
        )}

        {error && <ErrorNotice message={error} />}
        {!library && !error && <SkeletonRows count={5} />}

        {library && (
          <div className="stack">
            <PipSays mood="happy"
              text="Hi, I'm Pip! 📦 I can build your tracking timeline with you - a few quick questions and every answer becomes a step. Or pick a starting point below."
              choices={[{ id: 'go', label: "🤖 Let's build it together", primary: true, onPick: startPip }]} />
            <button type="button" className="silkcta silkcta--wide"
              onClick={() => open(library.suggested, '')}>
              <span className="silkcta__label">✨ Start a blank chain</span>
              <span className="silkcta__note">
                {library.suggested.length} common steps as nodes, all editable.
              </span>
            </button>

            <div className="rsgrid">
              {library.routeTemplates.map((template) => (
                <button key={template.id} type="button" className="rscard"
                  onClick={() => open(template.steps, template.name)}>
                  <span className="rscard__icon"><Icon name={STAGE_ICON_META[template.icon].icon} size={20} /></span>
                  <span className="rscard__name">{template.name}</span>
                  <span className="rscard__note">{template.blurb}</span>
                  <span className="faint">{routePartsLine(template)}</span>
                </button>
              ))}
              {library.presets.map((preset) => (
                <button key={preset.id} type="button" className="rscard"
                  onClick={() => open(preset.steps, preset.name)}>
                  <span className="rscard__icon"><Icon name="truck" size={20} /></span>
                  <span className="rscard__name">{preset.name}</span>
                  <span className="rscard__note">{preset.blurb}</span>
                  <span className="faint">{routePartsLine(preset)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start' }} onClick={onCancel}>
          {cancelLabel}
        </button>
      </PreviewVarsContext.Provider>
    );
  }

  return (
    <PreviewVarsContext.Provider value={vars}>
    <form className="rsstudio" onSubmit={save}>
      {pipDock}

      {/* The route itself: its name, and a map of its three parts at a glance. */}
      <header className="rshead">
        <input id="rs-name" className="rshead__name" value={name} onChange={(event) => setName(event.target.value)}
          placeholder="Name this route - e.g. Guangzhou air" aria-label="Route name" required autoFocus />
        <span className="rshead__hint">For your own lists - buyers see the steps, not this name.</span>
        <div className="rsmap" aria-label="The route's three parts">
          {lanes.map((lane) => (
            <a key={lane.zone} href={`#rs-lane-${lane.zone}`} className={`rsmap__seg rsmap__seg--${lane.zone}`}
              style={{ flexGrow: Math.max(1, lane.indexes.length) }}>
              <b>{lane.indexes.length}</b> {ZONE_TEXT[lane.zone].short}
            </a>
          ))}
        </div>
        <span className="rshead__stats">
          ⚡ {bound} buttons · {named.length} steps · Dispatched and Delivered always last
        </span>
      </header>

      {/* The journey, in its three parts: each a lane in its own colour, the
          steps in it joined by a track the next step's icon travels down. */}
      <div className="rslanes">
        {lanes.map((lane) => (
          <section key={lane.zone} id={`rs-lane-${lane.zone}`} className={`rslane rslane--${lane.zone}`}>
            <ZoneLine zone={lane.zone}
              at={lane.zone === 'lot' ? joinAt : lane.zone === 'post' ? leaveAt : undefined}
              min={lane.zone === 'lot' ? 1 : joinAt}
              atEnd={lane.zone === 'lot' ? joinAt >= dispatchAt : leaveAt >= dispatchAt}
              onMove={lane.zone === 'lot' ? setJoinAt : lane.zone === 'post' ? setLeaveAt : undefined}
              onAdd={() => setAdding({ at: lane.zone === 'pre' ? joinAt : lane.zone === 'lot' ? leaveAt : dispatchAt, zone: lane.zone })} />
            {lane.indexes.length === 0 && (
              <p className="rslane__empty">
                {lane.zone === 'lot' ? 'No lot on this route - items go straight to the last mile.' : 'Nothing here yet.'}
              </p>
            )}
            <div className="rschain">
              {lane.indexes.map((index) => {
                const step = given[index]!;
                const following = given[index + 1];
                const last = index === given.length - 1;
                return (
                  <div key={step.id} className={`rschain__row${last ? ' rschain__row--last' : ''}`}>
                    {/* What happens next, travelling down the track to it. */}
                    {following && !last && (
                      <span className={`rslink__token rslink__token--${sceneOf(following, index + 1)}`} aria-hidden="true">
                        {stepEmoji(following, index + 1)}
                      </span>
                    )}
                    <StepNode
                      step={step} index={index} count={steps.length}
                      zone={zoneAt(index)}
                      problems={problems.filter((problem) => problem.stepId === step.id && problem.level === 'error').map((problem) => problem.text)}
                      lockedAbove={Boolean(given[index - 1]?.locked && index - 1 === 0)}
                      lockedBelow={isFixed(given[index + 1])}
                      onChange={(patch) => setAt(index, patch)}
                      onRemove={() => removeAt(index)}
                      onMove={(to) => moveAt(index, to)}
                    />
                    {!last && (
                      <GapRow afterStep={step} onChangeWait={(patch) => setAt(index, patch)}
                        onInsert={() => setAdding({ at: index + 1, zone: zoneAt(index) })} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {adding && (
        <StepPicker at={adding.at} zone={adding.zone} steps={given}
          onPick={(kind) => insertAt(adding.at, adding.zone, kind)} onClose={() => setAdding(null)} />
      )}

      {named.length < 2 && (
        <span className="field__hint">A route needs at least two named steps.</span>
      )}

      {error && <ErrorNotice message={error} />}

      {previewing && (
        <RoutePreview steps={named} joinAt={namedJoin} leaveAt={namedLeave} vars={vars} problems={problems}
          onChangeStep={(index, patch) => {
            const id = named[index]?.id;
            setSteps((now) => now.map((step) => (step.id === id ? { ...step, ...patch } : step)));
          }}
          onClose={() => setPreviewing(false)} />
      )}

      {blocking.length > 0 && (
        <div className="rsproblems" role="alert">
          <b>Fix before saving</b>
          {blocking.map((problem) => <span key={problem.text}>⚠️ {problem.text}</span>)}
        </div>
      )}

      {/* Always in reach, however long the chain: try it, save it. */}
      <div className="rsbar">
        <button type="button" className="rsbar__preview" disabled={named.length < 2} onClick={() => setPreviewing(true)}>
          <span aria-hidden="true">👀</span> Preview on a sample order
        </button>
        <button type="submit" className="btn rsbar__save" disabled={busy || named.length < 2 || !name.trim() || blocking.length > 0}
          title={blocking.length > 0 ? 'Fix the button words above first' : !name.trim() ? 'Give the route a name first' : undefined}>
          {busy ? 'Saving…' : blocking.length > 0 ? `⚠️ ${blocking.length} to fix` : 'Save'}
        </button>
        <button type="button" className="iconbtn" aria-label={cancelLabel} title={cancelLabel} onClick={leave}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {!name.trim() && named.length >= 2 && (
        <span className="field__hint" role="status">Name the route at the top to save it.</span>
      )}
      {lanes[1]!.indexes.length === 0 && (
        <span className="field__hint">
          Nothing is in the lot lane, so this route never joins a lot: it suits listings shipped one by
          one, and cannot be given to a lot.
        </span>
      )}
      {editing && (
        <button type="button" className="btn btn--ghost btn--danger btn--sm" style={{ justifySelf: 'start' }}
          disabled={busy} onClick={() => void remove()}>
          Delete route
        </button>
      )}

    </form>
    </PreviewVarsContext.Provider>
  );
}

/** Everything a save would store, as one comparable string. */
function snapshot(name: string, steps: readonly RouteStep[], joinAt: number, leaveAt: number): string {
  return JSON.stringify([name.trim(), joinAt, leaveAt, steps.map((step) => [
    step.name, step.description, step.trigger ?? null, step.button ?? null, step.waitMessage ?? null,
    step.forward ?? false, step.custom ?? false, step.assignee ?? null,
  ])]);
}

const ZONE_TEXT: Record<StepZone, { title: string; note: string; short: string }> = {
  pre: { title: '① Before the lot', note: 'Each item on its own - buttons per item', short: 'before the lot' },
  lot: { title: '② In the lot', note: 'Everything moves together - no buttons, you move the lot', short: 'in the lot' },
  post: { title: '③ After the lot', note: 'Each item on its own again - buttons per item', short: 'after the lot' },
};

/** The kind of scene behind a step - what it looks like happening - read off its words, then its button. */
type Scene = 'order' | 'warehouse' | 'pack' | 'fly' | 'sail' | 'road' | 'customs' | 'check' | 'land' | 'home' | 'spark';

function sceneOf(step: Pick<RouteStep, 'name' | 'trigger' | 'custom'>, index: number): Scene {
  const name = step.name.toLowerCase();
  if (index === 0 || /order placed|ordered|booked/.test(name)) return 'order';
  if (step.trigger === 'delivered' || /deliver/.test(name)) return 'home';
  if (step.trigger === 'dispatched' || /dispatch|courier|out for|truck/.test(name)) return 'road';
  if (/custom/.test(name)) return 'customs';
  if (/pack|box|wrap|consolidat/.test(name)) return 'pack';
  if (/air|flight|fly|plane/.test(name)) return 'fly';
  if (/sea|sail|ship|vessel|port|container/.test(name)) return 'sail';
  if (/land|arriv/.test(name)) return 'land';
  if (/ready|check|qc|inspect/.test(name)) return 'check';
  if (/warehouse|\bwh\b|receiv|forward|supplier/.test(name)) return 'warehouse';
  return 'spark';
}

/**
 * What a step looks like happening, drawn behind its card: a plane crossing,
 * a ship on the swell, a parcel being boxed, a truck on the road. Purely
 * decoration - it reads off the step's words, says nothing a reader needs,
 * and stands still for anyone who asks for less motion.
 */
function Scene({ step, index }: { step: Pick<RouteStep, 'name' | 'trigger' | 'custom' | 'stageIcon' | 'locked'>; index: number }) {
  const scene = sceneOf(step, index);
  return (
    <span className={`rsscene rsscene--${scene}`} aria-hidden="true">
      <span className="rsscene__lines" />
      <span className="rsscene__art">{stepEmoji(step, index)}</span>
    </span>
  );
}

/**
 * Where one part of the journey begins: before the lot, in it, after it -
 * each in its own colour, with the line between them that the seller moves.
 * The lot's own line can never pass Dispatched: a lot does not deliver.
 */
function ZoneLine({ zone, at, min = 0, atEnd, onMove, onAdd }: {
  zone: StepZone;
  /** The index the line sits at; absent for the head of the chain, which does not move. */
  at?: number;
  min?: number;
  atEnd?: boolean;
  onMove?: (next: number) => void;
  /** Add a step just this side of the line. */
  onAdd?: () => void;
}) {
  const text = ZONE_TEXT[zone];
  return (
    <div className={`rszone rszone--${zone}`}>
      <span className="rszone__text">
        <b>{text.title}</b>
        <span>{text.note}</span>
      </span>
      <span className="rsjoin__acts">
        {at !== undefined && onMove && (
          <>
            <button type="button" className="iconbtn" aria-label={`Move the ${zone === 'lot' ? 'join' : 'leave'} line earlier`}
              title={zone === 'lot' ? 'Start the lot a step earlier' : 'Items leave the lot a step earlier'}
              disabled={at <= min} onClick={() => onMove(at - 1)}>
              <Icon name="up" size={12} />
            </button>
            <button type="button" className="iconbtn" aria-label={`Move the ${zone === 'lot' ? 'join' : 'leave'} line later`}
              title={zone === 'lot' ? 'Start the lot a step later' : 'Items leave the lot a step later'}
              disabled={atEnd} onClick={() => onMove(at + 1)}>
              <Icon name="down" size={12} />
            </button>
          </>
        )}
        {onAdd && (
          <button type="button" className="rszone__add" aria-label={`Add a step ${ZONE_TEXT[zone].short}`} onClick={onAdd}>
            <Icon name="plus" size={12} /> Step
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Adding a step: every kind there is, each with the button it comes with.
 * The ones that cannot go here are shown locked with why - used already,
 * the wrong side of the lot, out of order - so the seller sees the whole set
 * and never builds one that cannot work.
 */
function StepPicker({ at, zone, steps, onPick, onClose }: {
  at: number;
  zone: StepZone;
  steps: RouteStep[];
  onPick: (kind: StepKind) => void;
  onClose: () => void;
}) {
  const vars = useContext(PreviewVarsContext);
  const choices = stepChoices(steps, at, zone);
  const group = (title: string, rows: typeof choices) => rows.length > 0 && (
    <div className="rspick__group">
      <span className="rspick__title">{title}</span>
      {rows.map(({ kind, open, why }) => (
        <button key={kind.id} type="button" className={`rspick__row${open ? '' : ' is-locked'}`} disabled={!open}
          onClick={() => onPick(kind)}>
          <span className="rspick__icon" aria-hidden="true">{open ? kind.icon : '🔒'}</span>
          <span className="rspick__body">
            <b>{kind.custom ? 'A step with your own button' : kind.trigger ? renderStepText(kind.name, vars) : 'A plain step'}</b>
            <span>{open
              ? kind.custom ? 'You name it and its button - pressed per item.'
                : kind.trigger ? `⚡ Comes with its button - ${BUTTON_NOTE[kind.trigger].toLowerCase()}`
                  : zone === 'lot' ? 'Moves when you move the lot.' : 'No button - ticked off with the next one.'
              : renderStepText(why ?? '', vars)}</span>
          </span>
        </button>
      ))}
    </div>
  );
  return (
    <Modal title="Add a step" onClose={onClose}>
      <div className="stack">
        <p className={`rspick__zone rszone--${zone}`}>
          <b>{ZONE_TEXT[zone].title}</b> · {ZONE_TEXT[zone].note}
        </p>
        {group('Steps with a button', choices.filter((choice) => choice.kind.trigger))}
        {group('Your own', choices.filter((choice) => !choice.kind.trigger))}
      </div>
    </Modal>
  );
}

/**
 * The gap between two nodes (or before the first, or after the last): the
 * "+" that inserts a step exactly here, and - when there is a step above it
 * - a click-to-add line saying what a buyer reads in this exact gap while
 * they are waiting on it. The wave that plays on the real timeline is shown
 * here too, the moment there is a message, so writing one and seeing how it
 * reads are the same action.
 */
function GapRow({ afterStep, onChangeWait, onInsert }: {
  afterStep?: RouteStep;
  onChangeWait?: (patch: Partial<RouteStep>) => void;
  onInsert: () => void;
}) {
  const vars = useContext(PreviewVarsContext);
  const [editing, setEditing] = useState(false);
  const message = afterStep ? waitMessageFor(afterStep) : null;

  return (
    <div className="rsgap">
      {afterStep && onChangeWait && (
        editing ? (
          <WaitMessageEditor step={afterStep} onChange={onChangeWait} onDone={() => setEditing(false)} />
        ) : (
          <button type="button" className="rsgap__wait" onClick={() => setEditing(true)}>
            {message ? <WaveLoader /> : <Icon name="plus" size={11} />}
            <span className={message ? undefined : 'faint'}>
              {message ? renderStepText(message, vars) : 'What buyers see in between steps'}
            </span>
          </button>
        )
      )}
      <button type="button" className="rsgap__insert" aria-label="Insert a step here" onClick={onInsert}>
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

/** Preset wait messages, plus free text for the one in a while that needs its
 *  own words - the same "pick or write your own" shape as a step's name. */
function WaitMessageEditor({ step, onChange, onDone }: {
  step: RouteStep;
  onChange: (patch: Partial<RouteStep>) => void;
  onDone: () => void;
}) {
  const vars = useContext(PreviewVarsContext);
  const defaultWait = step.trigger ? DEFAULT_WAIT_MESSAGES[step.trigger] : undefined;
  const isPreset = (WAIT_MESSAGE_PRESETS as readonly string[]).includes(step.waitMessage ?? '');
  const [customMode, setCustomMode] = useState(!isPreset && Boolean(step.waitMessage?.trim())
    && step.waitMessage !== NO_WAIT_MESSAGE);

  return (
    <div className="rsgap__editor">
      <select value={customMode ? 'Custom' : (isPreset ? step.waitMessage : (step.waitMessage ?? ''))}
        aria-label="Pick a wait message"
        onChange={(event) => {
          if (event.target.value === 'Custom') { setCustomMode(true); return; }
          setCustomMode(false);
          onChange({ waitMessage: event.target.value || undefined });
        }}>
        <option value="">{defaultWait ? `Default — ${renderStepText(defaultWait, vars)}` : 'Nothing — the gap stays quiet'}</option>
        {/* A default only ever offers "use it" or "write something else" — this
            is the third answer, explicitly saying nothing at all, which is not
            otherwise reachable once a trigger has a default of its own. */}
        {defaultWait && <option value={NO_WAIT_MESSAGE}>Nothing — the gap stays quiet</option>}
        {WAIT_MESSAGE_PRESETS.map((text) => <option key={text} value={text}>{renderStepText(text, vars)}</option>)}
        <option value="Custom">Custom…</option>
      </select>
      {customMode && (
        <input value={step.waitMessage ?? ''} placeholder="e.g. Leaving {origin}" autoFocus
          aria-label="Custom wait message"
          onChange={(event) => onChange({ waitMessage: event.target.value })} />
      )}
      <span className="field__hint">
        Shown with the moving wave above, between this step and the next. {'{origin}'} and{' '}
        {'{destination}'} fill in from the lot, same as in a step's name.
      </span>
      <button type="button" className="btn btn--sm" onClick={onDone}>Done</button>
    </div>
  );
}

/**
 * One node on the road: name and description always showing, and under them
 * the button that reaches it - handed out, never chosen, with only its words
 * to change. Reordering and delete are behind the chevron.
 */
function StepNode({ step, index, count, zone, problems, lockedAbove, lockedBelow, onChange, onRemove, onMove }: {
  step: RouteStep;
  index: number;
  count: number;
  /** Which part of the journey it is in: inside the lot there are no buttons. */
  zone: StepZone;
  /** What is wrong with this step's button words. */
  problems: string[];
  /** The step right before this one is the locked "Order Placed" - moving up would swap past it. */
  lockedAbove: boolean;
  /** The step right after this one is Dispatched or Delivered - moving down would swap past it. */
  lockedBelow: boolean;
  onChange: (patch: Partial<RouteStep>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const vars = useContext(PreviewVarsContext);
  const [open, setOpen] = useState(false);

  /* Always first, never renamed, moved or removed - "Order Placed" reads as
     a fact about every route, and it is the one place a real order's payment
     status shows without the seller writing a word about it. */
  if (index === 0 && step.locked) {
    return (
      <div className="rsnode rsnode--pre">
        <span className="rsnode__dot rsnode__dot--locked" aria-hidden="true">🧾</span>
        <div className="rsnode__card rsnode__card--locked">
          <Scene step={step} index={index} />
          <div className="rsnode__top">
            <span className="rsnode__no">Step 1 · always first</span>
          </div>
          <div className="rsnode__top">
            <span className="rsnode__name rsnode__name--static">{step.name}</span>
            <Icon name="lock" size={13} />
          </div>
          {step.description && <span className="rsnode__desc rsnode__desc--static">{step.description}</span>}
          <span className="rsnode__paymenthint">
            <Icon name="bank" size={12} />
            Shows the order's payment status here automatically — paid, awaiting payment, or refunded —
            same as it does on the order itself.
          </span>
        </div>
      </div>
    );
  }

  /* The last two presses. Their place is fixed - every route ends on them -
     and Delivered's name too; what they say on the button is still the
     seller's, inside what the checker allows. */
  const isDelivered = step.trigger === 'delivered';
  const fixed = isFixed(step);

  return (
    <div className={`rsnode rsnode--${zone}`} data-step={step.id}>
      <span className="rsnode__dot" aria-hidden="true">{stepEmoji(step, index)}</span>
      <div className={`rsnode__card${isDelivered ? ' rsnode__card--delivered' : ''}`}>
        <Scene step={step} index={index} />
        <span className="rsnode__no">Step {index + 1}{fixed ? (isDelivered ? ' · always last' : ' · always before Delivered') : ''}</span>
        <div className="rsnode__top">
          <input className="rsnode__name" value={step.name} placeholder="What happens here"
            aria-label={`Step ${index + 1} name`} disabled={isDelivered}
            onChange={(event) => onChange({ name: event.target.value })} />
          {fixed && <Icon name="lock" size={13} />}
          {!fixed && (
            <button type="button" className="iconbtn" aria-label={open ? 'Collapse node' : 'Expand node'}
              onClick={() => setOpen((value) => !value)}>
              <Icon name="chevron" size={13} />
            </button>
          )}
        </div>

        <input className="rsnode__desc" value={step.description}
          placeholder="Say what happens here, in one line — {origin} and {destination} work too"
          aria-label={`Step ${index + 1} description`}
          onChange={(event) => onChange({ description: event.target.value })} />

        {/* The button: handed out from where the step sits and what it says,
            or one of the seller's own. Never inside a lot. */}
        {stepTickKey(step) ? (
          <div className={`rsbtn${problems.length ? ' is-wrong' : ''}`}>
            <span className="rsbtn__chip">⚡ {stepButtonLabel(step, vars) || 'Button'}</span>
            <input className="rsbtn__words" value={step.button ?? ''} maxLength={28}
              placeholder="Your words (optional)"
              aria-label={`Words on the button for step ${index + 1}`}
              onChange={(event) => onChange({ button: event.target.value })} />
            <span className="rsbtn__note">
              {step.trigger ? BUTTON_NOTE[step.trigger] : 'Your own button - pressed for each item, and it moves the timeline here.'}
            </span>
            {step.trigger === 'dispatched' && (
              <span className="rsbtn__ship">
                <input disabled placeholder="Courier - e.g. Delhivery" aria-label="Example courier name" />
                <input disabled placeholder="AWB - e.g. 1234567890" aria-label="Example AWB" />
              </span>
            )}
            {step.trigger !== 'delivered' && (
              <span className="rsbtn__who" role="group" aria-label="Who else can press it">
                <span className="rsbtn__who-label">Who presses it</span>
                {WHO.map((who) => (
                  <button key={who.id} type="button" aria-pressed={(step.assignee ?? 'seller') === who.id}
                    className={`rsbtn__whochip${(step.assignee ?? 'seller') === who.id ? ' is-on' : ''}`}
                    onClick={() => onChange({ assignee: who.id === 'seller' ? undefined : who.id })}>
                    {who.label}
                  </button>
                ))}
              </span>
            )}
            {step.custom && (
              <button type="button" className="stepact__skip" onClick={() => onChange({ custom: undefined, button: undefined, assignee: undefined })}>
                Take this button off
              </button>
            )}
            {problems.map((text) => <span key={text} className="rsbtn__wrong">{text}</span>)}
          </div>
        ) : step.name.trim() && (
          <span className="rsbtn__none">
            {zone === 'lot' ? '🚢 The lot moves this step - items in a lot move together' : '↪ No button - ticked off with the next one'}
            {zone !== 'lot' && !fixed && (
              <button type="button" className="rsbtn__add" onClick={() => onChange({ custom: true })}>
                ✨ Give it its own button
              </button>
            )}
          </span>
        )}

        {open && !fixed && (
          <div className="rsnode__more">
            {zone === 'lot' && (
              <label className="row" style={{ fontSize: 'var(--t-sm)' }}>
                <input type="checkbox" checked={Boolean(step.forward)}
                  onChange={(event) => onChange({ forward: event.target.checked })} />
                <span>Hand-over to a courier — ask for a tracking ID and courier name when the lot moves here</span>
              </label>
            )}

            {zone === 'lot' && step.forward && (
              <div className="rsnode__forward">
                <span className="field__hint">
                  Asked for when the lot reaches this step. Both optional - if you leave them blank, buyers see nothing extra, not empty fields.
                </span>
                <input disabled placeholder="Tracking ID / AWB — e.g. DHL1234567890" aria-label="Example tracking ID or AWB" />
                <input disabled placeholder="Courier — e.g. DHL" aria-label="Example courier name" />
              </div>
            )}

            <div className="rsnode__acts">
              <button type="button" className="iconbtn" aria-label={`Move step ${index + 1} up`}
                disabled={index === 0 || lockedAbove} onClick={() => onMove(index - 1)}><Icon name="up" size={12} /></button>
              <button type="button" className="iconbtn" aria-label={`Move step ${index + 1} down`}
                disabled={index === count - 1 || lockedBelow} onClick={() => onMove(index + 1)}><Icon name="down" size={12} /></button>
              <button type="button" className="iconbtn iconbtn--danger" aria-label={`Delete step ${index + 1}`}
                onClick={onRemove}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Who can press a button: the seller always, and one crew member besides if handed it. */
const WHO: { id: 'seller' | StepAssignee; label: string }[] = [
  { id: 'seller', label: '🧑‍💼 Only you' },
  { id: 'supplier', label: '🏭 + Supplier' },
  { id: 'handler', label: '🧑‍🔧 + Handler' },
];

/** What pressing each button does, said under it in the Studio. */
const BUTTON_NOTE: Record<StepTrigger, string> = {
  china_received: 'You press it when the item arrives overseas.',
  china_packed: 'You press it once it is packed for the lot.',
  india_received: 'You press it when it lands with you or your warehouse.',
  ready_to_dispatch: 'You press it once it is checked and ready.',
  packed: 'You press it once it is boxed for the courier.',
  dispatched: 'Always here. Pressing it asks for the courier and AWB (both optional), and tells the buyer it is on the way.',
  delivered: 'Always last. Pressing it asks first, then tells the buyer it has arrived.',
};
