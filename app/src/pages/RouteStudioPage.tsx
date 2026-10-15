import { Fragment, createContext, useContext, useState, useEffect, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { assignButtons, checkButtons, stepChoices, type ButtonChange, type StepKind, type StepZone } from '@shared/buttons';
import {
  DEFAULT_WAIT_MESSAGES, NO_WAIT_MESSAGE, WAIT_MESSAGE_PRESETS, joinIndexOf, leaveIndexOf,
  renderStepText, routeParts, routePartsLine, sideOf, stepButtonLabel, stepId, stepTickKey, waitMessageFor,
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
import { InfoTip } from '../components/InfoTip';
import { MoreMenu } from '../components/MoreMenu';
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

/** Whether the Studio opens with every detail showing, remembered per browser. */
const DETAIL_KEY = 'figmark:route-studio-details';

/**
 * A ready-made route's steps, put in order the way the Studio would before
 * saving: Delivered last, buttons handed out, the lot's two lines placed.
 *
 * So the new-lot form can save a template as the shop's own route in one tap,
 * without opening the Studio, and get exactly what opening it there and
 * pressing Save would have given.
 */
export function routeStepsFrom(from: readonly RouteStep[]) {
  const withSides = ensureDelivered(from).map((step, index) => ({ ...step, position: index, side: sideOf(step, index) }));
  const given = assignButtons(withSides).steps;
  const join = joinIndexOf({ steps: given });
  const dispatched = given.findIndex((step) => step.trigger === 'dispatched');
  const leave = dispatched >= 0 ? Math.min(leaveIndexOf({ steps: given }), dispatched) : leaveIndexOf({ steps: given });
  const sided = given.map((step, index) => ({
    ...step,
    side: index < join ? ('pre' as const) : ('post' as const),
    lastMile: index >= leave ? true : undefined,
  }));
  return assignButtons(sided).steps
    .filter((step) => step.name.trim())
    .map((step) => ({
      id: step.id, name: step.name.trim(), description: step.description.trim(), side: step.side,
      trigger: step.trigger, forward: step.forward, waitMessage: step.waitMessage, lastMile: step.lastMile,
      button: step.button, custom: step.custom, assignee: step.assignee,
    }));
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

/**
 * A sample route the operators keep, opened in the same Studio a shop uses:
 * the words and lanes are edited here, and saving hands them back to the
 * console instead of saving a route of a shop's own.
 */
export interface StudioSample {
  name: string;
  steps: RouteStep[];
  onSave: (name: string, steps: RouteStep[]) => Promise<void>;
  onDelete?: () => void;
}

export function RouteStudio({ editing, onSaved, onCancel, intro, cancelLabel = 'Cancel', sample }: {
  editing: string | null;
  /** Editing one of the operators' sample routes rather than a shop's own. */
  sample?: StudioSample;
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
  /* Pip coaches the first route a seller opens; after that it waits behind "Ask Pip". */
  const [pip, setPip] = useState<'ask' | 'coach' | 'hidden'>(() => {
    if (sample) return 'hidden';
    try {
      if (localStorage.getItem(PIP_SEEN_KEY) === '1') return 'hidden';
      localStorage.setItem(PIP_SEEN_KEY, '1');
    } catch {
      /* Blocked storage: Pip says hello each visit, as it used to. */
    }
    return 'coach';
  });
  const [answers, setAnswers] = useState<PipAnswers>({});
  const [pipSaid, setPipSaid] = useState('');
  const [tipAt, setTipAt] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  /* Most edits are words: a step's name and its line. Buttons, who presses
     them, the waits between steps and where the lot starts and ends are all
     handed out sensibly already, so they wait behind "All details". */
  const [detailed, setDetailed] = useState(() => {
    try {
      return localStorage.getItem(DETAIL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const showDetails = (next: boolean) => {
    setDetailed(next);
    try {
      localStorage.setItem(DETAIL_KEY, next ? '1' : '0');
    } catch {
      /* A private window: it starts simple next time. */
    }
  };
  /** Where a step is being added: the index it will take, and which part of the journey. */
  const [adding, setAdding] = useState<{ at: number; zone: StepZone } | null>(null);
  /** The shop's own lane, so the preview reads in its countries rather than ours. */
  const [vars, setVars] = useState<PreviewVars>({});
  /** The chain as last opened or saved: anything else on screen is unsaved work. */
  const [savedAs, setSavedAs] = useState<string | null>(null);
  /** Saved, and some unfinished lots still read the route's older steps. */
  const [behind, setBehind] = useState<{ route: TrackingRoute; lots: number } | null>(null);

  useEffect(() => {
    if (sample) {
      // A sample is read by every shop; it is previewed on the commonest lane.
      setVars({ origin: 'China', destination: 'India' });
      return;
    }
    void api.myLots().then((result) => {
      const lane = result.lots.find((entry) => entry.lot.originCountry || entry.lot.destinationCountry)?.lot;
      if (lane) setVars({ origin: lane.originCountry, destination: lane.destinationCountry });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (sample) {
      open(sample.steps, sample.name);
      return;
    }
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
    // The route opens at its top, not wherever the list was scrolled to.
    window.scrollTo(0, 0);
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
    if (sample) {
      try {
        await sample.onSave(name.trim(), given.filter((step) => step.name.trim()).map((step) => ({
          ...step, name: step.name.trim(), description: step.description.trim(),
        })));
        setSavedAs(snapshot(name, steps, joinAt, leaveAt));
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Could not save that sample.');
      } finally {
        setBusy(false);
      }
      return;
    }
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
      /* Lots keep their own copy of a route, so an edit reaches none of them
         by itself. Asked here, once, rather than discovered later. */
      if (result.lotsBehind && result.lotsBehind > 0) setBehind({ route: result.route, lots: result.lotsBehind });
      else onSaved(result.route);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that route.');
    } finally {
      setBusy(false);
    }
  }

  async function updateLots() {
    if (!behind) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.applyRoute(behind.route.id);
      if (result.lotsFailed && result.lotsFailed > 0) {
        setError(`${result.lotsUpdated} updated, but ${result.lotsFailed} could not be - try again from the Routes list.`);
        setBehind(null);
        return;
      }
      onSaved(behind.route);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Saved, but those lots could not be updated. Try again from the Routes list.');
      setBehind(null);
    } finally {
      setBusy(false);
    }
  }

  /* Lots carry their own copy of a route, so deleting one only takes it off
     the list - every lot already on it keeps travelling exactly as before. */
  async function remove() {
    if (sample?.onDelete) { sample.onDelete(); return; }
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
  const pipDock = sample ? null : pip === 'hidden' ? (
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
          <header className="rsnew__head">
            <h1>{editing ? 'Edit route' : 'New route'}</h1>
            <InfoTip label="About routes">
              The steps your buyers read as their tracking. Pick the one closest to how you ship and change any
              words you like - you can preview exactly what a buyer sees before saving.
            </InfoTip>
          </header>
        )}

        {error && <ErrorNotice message={error} />}
        {!library && !error && <SkeletonRows count={5} />}

        {library && (
          <div className="stack">
            {/* Most shops ship one of a handful of ways, so those lead: one
                tap opens a whole route to look over. Pip and a blank chain are
                for the shop whose way is not among them. */}
            <span className="rsnew__label">Start with a sample route</span>
            <div className="rsnew__list">
              {[...library.routeTemplates, ...library.presets.map((preset) => ({ ...preset, icon: 'transit' as const }))].map((template) => {
                const parts = routeParts(template);
                const total = Math.max(1, template.steps.length);
                return (
                  <button key={template.id} type="button" className="rsnew__item"
                    onClick={() => open(template.steps, template.name)}>
                    <span className="rsnew__icon"><Icon name={STAGE_ICON_META[template.icon].icon} size={18} /></span>
                    <span className="rsnew__body">
                      <span className="rsnew__name">{template.name}</span>
                      {template.blurb && <span className="rsnew__blurb">{template.blurb}</span>}
                      {/* The three parts as one bar, in the lanes' colours. */}
                      <span className="rsnew__bar" aria-label={routePartsLine(template)} title={routePartsLine(template)}>
                        <span className="rsnew__seg rsnew__seg--pre" style={{ flexGrow: parts.before / total }} />
                        {parts.lot > 0 && <span className="rsnew__seg rsnew__seg--lot" style={{ flexGrow: parts.lot / total }} />}
                        {parts.after > 0 && <span className="rsnew__seg rsnew__seg--post" style={{ flexGrow: parts.after / total }} />}
                      </span>
                      <span className="rsnew__trail">
                        {template.steps.slice(0, 4).map((step) => renderStepText(step.name, vars)).join(' → ')}
                        {template.steps.length > 4 ? ` → +${template.steps.length - 4}` : ''}
                      </span>
                    </span>
                    <Icon name="right" size={16} />
                  </button>
                );
              })}
            </div>

            <span className="rsnew__label">Or</span>
            <div className="rsnew__other">
              <button type="button" className="rsnew__alt" onClick={startPip}>
                <span aria-hidden="true">🤖</span>
                <b>Answer a few questions</b>
                <span className="faint">Pip builds it with you</span>
              </button>
              <button type="button" className="rsnew__alt" onClick={() => open(library.suggested, '')}>
                <span aria-hidden="true">✏️</span>
                <b>Start from common steps</b>
                <span className="faint">Nine steps to edit</span>
              </button>
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
    {/* Something to fix shows everything, so the field it is about is there to fix. */}
    <form className={`rsstudio${detailed || blocking.length > 0 ? '' : ' rsstudio--simple'}`} onSubmit={save}>
      {pipDock}

      {/* The route itself: its name, and a map of its three parts at a glance. */}
      <header className="rshead">
        <div className="rshead__top">
        <input id="rs-name" className="rshead__name" value={name} onChange={(event) => setName(event.target.value)}
          placeholder="Name this route - e.g. Guangzhou air" aria-label="Route name" required />
        <span className="rshead__hint">
          <InfoTip label="About the route name">For your own lists - buyers see the steps, not this name.</InfoTip>
          {(editing || sample?.onDelete) && (
            <MoreMenu label="More for this route" items={[
              { label: 'Delete route', danger: true, disabled: busy, onClick: () => void remove() },
            ]} />
          )}
        </span>
        </div>
        <div className="rshead__modes">
          <div className="seg rshead__mode" role="tablist" aria-label="How much to show">
            <button type="button" role="tab" aria-selected={!detailed} className={detailed ? '' : 'is-on'}
              onClick={() => showDetails(false)}>Steps</button>
            <button type="button" role="tab" aria-selected={detailed} className={detailed ? 'is-on' : ''}
              onClick={() => showDetails(true)}>All details</button>
          </div>
          <InfoTip label="Steps or All details">
            <b>Steps</b> shows the route plainly: each step&apos;s name, one line about it, its button and
            who can press it. Most routes only need this.
            <br /><br />
            <b>All details</b> shows everything else you can change: your own words on a button, the
            message buyers see while they wait between two steps, where the lot starts and ends, and a
            short note on what each button does.
            <br /><br />
            Both edit the same route. Switching changes only what you see.
          </InfoTip>
        </div>
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
                const last = index === given.length - 1;
                return (
                  <div key={step.id} className={`rschain__row${last ? ' rschain__row--last' : ''}`}>
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

      {behind && (
        <Modal title="Update the lots on this route?" onClose={() => onSaved(behind.route)}>
          <div className="stack">
            <p>
              Saved. {behind.lots === 1 ? '1 lot is' : `${behind.lots} lots are`} still on the older steps
              of <strong>{behind.route.name}</strong>. Update {behind.lots === 1 ? 'it' : 'them'} and every
              item inside shows the new steps from where the lot is now; leave {behind.lots === 1 ? 'it' : 'them'} and
              only new lots use these steps.
            </p>
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void updateLots()}>
              {busy ? 'Updating…' : `Update ${behind.lots === 1 ? 'that lot' : `all ${behind.lots} lots`}`}
            </button>
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => onSaved(behind.route)}>
              Keep the old steps on {behind.lots === 1 ? 'that lot' : 'those lots'}
            </button>
          </div>
        </Modal>
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

/** Whether Pip has already coached a route on this device. */
const PIP_SEEN_KEY = 'figmark.pip.seen';

const ZONE_TEXT: Record<StepZone, { title: string; note: string; short: string }> = {
  pre: { title: '① Before the lot', note: 'Each item on its own - buttons per item', short: 'before the lot' },
  lot: { title: '② In the lot', note: 'Everything moves together - no buttons, you move the lot', short: 'in the lot' },
  post: { title: '③ After the lot', note: 'Each item on its own again - buttons per item', short: 'after the lot' },
};

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
        <b>{text.title} <InfoTip label={`About ${text.short}`}>{text.note}.</InfoTip></b>
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
      <span className="rsgap__arrow" aria-hidden="true">↓</span>
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
        <input value={step.waitMessage ?? ''} placeholder="e.g. Leaving {origin}"
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

  /* Always first, never renamed, moved or removed - "Order Placed" reads as
     a fact about every route, and it is the one place a real order's payment
     status shows without the seller writing a word about it. */
  if (index === 0 && step.locked) {
    return (
      <div className="rsnode rsnode--pre">
        <div className="rsnode__card rsnode__card--locked">
          <span className="rsnode__no is-fixed">Step 1 · always first</span>
          <div className="rsnode__top">
            <span className="rsnode__icon" aria-hidden="true">🧾</span>
            <span className="rsnode__name rsnode__name--static">{step.name}</span>
            <InfoTip label="About Order Placed">
              Always first, and never renamed or moved. It shows the order&apos;s payment status here
              automatically — paid, awaiting payment, or refunded — same as on the order itself.
            </InfoTip>
            <Icon name="lock" size={13} />
          </div>
          {step.description && <span className="rsnode__desc rsnode__desc--static">{step.description}</span>}
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
      <div className={`rsnode__card${isDelivered ? ' rsnode__card--delivered' : ''}`}>
        <span className={`rsnode__no${fixed ? ' is-fixed' : ''}`}>Step {index + 1}{fixed ? (isDelivered ? ' · always last' : ' · always before Delivered') : ''}</span>
        <div className="rsnode__top">
          <span className="rsnode__icon" aria-hidden="true">{stepEmoji(step, index)}</span>
          <input className="rsnode__name" value={step.name} placeholder="What happens here"
            aria-label={`Step ${index + 1} name`} disabled={isDelivered}
            onChange={(event) => onChange({ name: event.target.value })} />
          {fixed && <Icon name="lock" size={13} />}
          {!fixed && (
            <MoreMenu label={`More for step ${index + 1}`} items={[
              { label: 'Move up', disabled: index === 0 || lockedAbove, onClick: () => onMove(index - 1) },
              { label: 'Move down', disabled: index === count - 1 || lockedBelow, onClick: () => onMove(index + 1) },
              zone === 'lot' && {
                label: step.forward ? 'No courier hand-over here' : 'Hand-over to a courier here',
                onClick: () => onChange({ forward: !step.forward }),
              },
              step.custom && { label: 'Take its button off', onClick: () => onChange({ custom: undefined, button: undefined, assignee: undefined }) },
              { label: 'Delete step', danger: true, onClick: onRemove },
            ]} />
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
            {step.trigger !== 'delivered' && <WhoPresses step={step} zone={zone} onChange={onChange} />}
            {problems.map((text) => <span key={text} className="rsbtn__wrong">{text}</span>)}
          </div>
        ) : step.name.trim() && (
          <span className="rsbtn__none">
            <span className="rsbtn__nonetext">
              {zone === 'lot' ? '🚢 The lot moves this step - items in a lot move together' : '↪ No button - ticked off with the next one'}
            </span>
            {/* Moving the crate is the forwarder's job, so a lot step can be
                theirs to press too - every buyer in the lot is told when it is. */}
            {zone === 'lot' && !fixed && <WhoPresses step={step} zone={zone} onChange={onChange} />}
            {zone !== 'lot' && !fixed && (
              <button type="button" className="rsbtn__add" onClick={() => onChange({ custom: true })}>
                ✨ Give it its own button
              </button>
            )}
          </span>
        )}

        {zone === 'lot' && step.forward && !fixed && (
          <span className="rsnode__handover">
            📦 Courier hand-over: the tracking ID and courier are asked for when the lot moves here (both optional).
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Who presses a step: you always, and the crew member that part of the
 * journey belongs to - the supplier before the lot, the forwarder in it, the
 * handler after. Both can be on at once; one handed out elsewhere before
 * still shows, so it can be taken off.
 */
function WhoPresses({ step, zone, onChange }: {
  step: RouteStep;
  zone: StepZone;
  onChange: (patch: Partial<RouteStep>) => void;
}) {
  const crew = ZONE_CREW[zone];
  const shown = step.assignee && step.assignee !== crew.id ? [crew, CREW[step.assignee]] : [crew];
  return (
    <span className="rsbtn__who" role="group" aria-label="Who presses it">
      <span className="rsbtn__whochip is-on is-fixed" title="You can always press it">🧑‍💼 You</span>
      {shown.map((who) => {
        const on = step.assignee === who.id;
        return (
          <button key={who.id} type="button" aria-pressed={on} className={`rsbtn__whochip${on ? ' is-on' : ''}`}
            onClick={() => onChange({ assignee: on ? undefined : who.id })}>
            {on ? '✓ ' : '+ '}{who.label}
          </button>
        );
      })}
    </span>
  );
}

/** The crew who can press a step besides the seller. */
const CREW: Record<StepAssignee, { id: StepAssignee; label: string }> = {
  supplier: { id: 'supplier', label: '🏭 Supplier' },
  forwarder: { id: 'forwarder', label: '✈️ Forwarder' },
  handler: { id: 'handler', label: '🧑‍🔧 Handler' },
};

/** Whose part of the journey each zone is. */
const ZONE_CREW: Record<StepZone, { id: StepAssignee; label: string }> = {
  pre: CREW.supplier,
  lot: CREW.forwarder,
  post: CREW.handler,
};

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
