import { useUndo } from '../components/Undo';
import { confirmSentence } from '../components/Ask';
import { createContext, useContext, useState, useEffect, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { readLotDraft, writeLotDraft } from '../lotDraft';
import { BackLink } from '../components/ScrollManager';
import { assignButtons, checkButtons, stepChoices, type ButtonChange, type StepKind, type StepZone } from '@shared/buttons';
import { setButtonLibrary, stepKinds } from '@shared/route-buttons';
import {
  DEFAULT_WAIT_MESSAGES, NO_WAIT_MESSAGE, WAIT_MESSAGE_PRESETS, joinIndexOf, leaveIndexOf,
  renderStepText, sideOf, stepButtonLabel, stepId, stepTickKey, tagStepPlaces, waitMessageFor,
  routeParts, routePartsLine, routeJoinsLot,
  type RouteStep, type StepAssignee, type StepTrigger, type TrackingRoute,
} from '@shared/routes';
import { ApiRequestError, api, type RoutesResponse } from '../api';
import { ErrorNotice, Icon, Modal } from '../components/ui';
import { SkelRouteCards } from '../components/PageSkeletons';
import { stepEmoji } from '../components/OrderTrack';
import {
  PipSays, pipAck, pipQueue, pipTips, pipTotal, routeFromAnswers, type PipAnswers, type PipFix,
} from '../components/RouteMascot';
import { InfoTip } from '../components/InfoTip';
import { MoreMenu } from '../components/MoreMenu';
import { RoutePreview } from '../components/RoutePreview';
import { Select } from '../components/Select';
import { COUNTRIES } from '@shared/countries';
import { useSession } from '../session';
import { useShopDays } from '../components/StepDays';

/**
 * The two countries a route's {origin} and {dest} read in while it is being
 * written. Nothing is picked beforehand: the steps say "the origin" and "the
 * destination" until the lot's own countries are chosen, and follow them
 * from then on.
 */
type PreviewVars = { origin?: string | null; destination?: string | null };
const NO_LANE: PreviewVars = {};
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
 * Where a route is written: one list of steps in three parts - before the
 * lot, in it, after it - each row opening to its details, and a preview of
 * what a buyer sees. The one route builder; every way into a
 * route, new or saved, opens here.
 */
export function RouteStudioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  /* Sent here by a new lot: its half-filled form waits to be gone back to,
     and the route saved here comes back to it already picked. */
  const [draft] = useState(() => (params.get('for') === 'lot' ? readLotDraft() : null));
  const backTo = draft?.returnTo ?? '/shop?tab=routes';
  const back = () => {
    // Back through history where it can, so the screen underneath comes back
    // as it was left rather than as a fresh visit.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (draft && idx > 0) navigate(-1);
    else navigate(backTo);
  };
  return (
    <main className="page">
      <BackLink to={backTo}>{id && id !== 'new' ? 'Edit route' : draft ? 'Back to the lot' : 'New route'}</BackLink>
      <RouteStudio editing={id && id !== 'new' ? id : null} onCancel={back}
        lane={draft ? { origin: draft.originCountry || null, destination: draft.destinationCountry || null } : undefined}
        cancelLabel={draft ? 'Back to the lot' : 'Cancel'}
        onSaved={(route) => {
          if (draft) writeLotDraft({ ...draft, routeId: routeJoinsLot(route) ? route.id : draft.routeId });
          back();
        }} />
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

export function RouteStudio({ editing, onSaved, onCancel, intro, cancelLabel = 'Cancel', sample, lane: startLane }: {
  /** The countries the preview reads in to begin with - a lot's own, when one sent the seller here. */
  lane?: PreviewVars;
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
  /* How long each step usually takes is the system's to say, from this shop's
     lots or the market's - shown in the preview, never typed here. */
  const { user } = useSession();
  const shopDays = useShopDays(user?.id ?? null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<RouteStep[]>([]);
  /** Index of the first step that happens to the whole lot, not one item alone. */
  const [joinAt, setJoinAt] = useState(0);
  /** Index of the first step reached one item at a time again, after the lot. */
  const [leaveAt, setLeaveAt] = useState(0);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Pip: asking its questions, suggesting fixes, or tucked away. It stays
     out of the way until asked for - from the ⋯ menu, or by starting a route
     with its questions. */
  const [pip, setPip] = useState<'ask' | 'coach' | 'hidden'>('hidden');
  const [answers, setAnswers] = useState<PipAnswers>({});
  const [pipSaid, setPipSaid] = useState('');
  const [tipAt, setTipAt] = useState(0);
  /* Edit builds the route; Preview runs a sample order on it, from both
     sides - the seller's buttons and the customer's tracking. */
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const showMode = (next: 'edit' | 'preview') => {
    setMode(next);
    window.scrollTo(0, 0);
  };
  /** Where a step is being added: the index it will take, and which part of the journey. */
  const [adding, setAdding] = useState<{ at: number; zone: StepZone } | null>(null);
  /** The one step whose details are open; the rest read as a plain list. */
  const [openId, setOpenId] = useState<string | null>(null);

  /* A route belongs to no country: lots carry those. The pair picked in the
     preview only shows how its steps and tracking read on a real lane, and
     is never saved. */
  const [lane, setLane] = useState({ origin: startLane?.origin ?? '', destination: startLane?.destination ?? '' });
  /** The route's id once saved, so a second Save edits it rather than saving a twin. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const vars: PreviewVars = lane.origin || lane.destination
    ? { origin: lane.origin || null, destination: lane.destination || null }
    : NO_LANE;
  /** The chain as last opened or saved: anything else on screen is unsaved work. */
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const offerUndo = useUndo();
  /** Saved, and some unfinished lots still read the route's older steps. */
  const [behind, setBehind] = useState<{ route: TrackingRoute; lots: number; finish: () => void } | null>(null);

  useEffect(() => {
    if (sample) {
      open(sample.steps, sample.name);
      return;
    }
    void api.routes().then((result) => {
      setLibrary(result);
      setButtonLibrary(result.buttonLibrary);
      if (!editing) return;
      const found = result.routes.find((route) => route.id === editing);
      if (!found) { setError('No such route.'); return; }
      const moved = open(found.steps, found.name).filter((change) => change.to || change.from);
      if (moved.length > 0) {
        setPip('coach');
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
    const withDelivered = ensureDelivered(from.map(tagStepPlaces));
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
    if (action.kind === 'preview') { showMode('preview'); return; }
    if (action.kind === 'name') { document.getElementById('rs-name')?.focus(); return; }
    setOpenId(action.stepId);
    /* The step opens on the next paint; its field is there to focus after it. */
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-step="${action.stepId}"] .rsbtn__words`);
      input?.scrollIntoView({ block: 'center' });
      input?.focus();
    }, 60);
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
      ...(kind ? {
        name: kind.name, description: kind.description, trigger: kind.trigger, custom: kind.custom,
        button: kind.button, assignee: kind.assignee,
      } : {}),
    };
    next.splice(index, 0, step);
    setSteps(next);
    if (index < joinAt || (index === joinAt && zone === 'pre')) setJoinAt(joinAt + 1);
    if (index < leaveAt || (index === leaveAt && zone !== 'post')) setLeaveAt(leaveAt + 1);
    setAdding(null);
    setOpenId(step.id);
  }

  function removeAt(index: number) {
    /* One tap deletes a step with its own words, button and wait message, so
       it can be put back for a few seconds - exactly as it was, lines too. */
    const was = { steps, joinAt, leaveAt };
    const gone = steps[index];
    offerUndo({
      label: `Step “${gone?.name.trim() || 'untitled'}” deleted`,
      until: new Date(Date.now() + 10_000).toISOString(),
      note: 'Not saved yet - you can put it back.',
      undo: async () => {
        setSteps(was.steps);
        setJoinAt(was.joinAt);
        setLeaveAt(was.leaveAt);
      },
    });
    setSteps(steps.filter((_, i) => i !== index));
    /* Both lines shift by the same rule, and the leave line is held against
       the join line as it is *after* the removal - holding it against the old
       one moved a step from after the lot into it whenever the lot was empty. */
    const nextJoin = index < joinAt ? Math.max(0, joinAt - 1) : joinAt;
    setJoinAt(nextJoin);
    setLeaveAt(Math.max(nextJoin, index < leaveAt ? leaveAt - 1 : leaveAt));
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

  /**
   * Move a step one place up or down the list. At the edge of its part it
   * crosses into the next one without changing the order - the last step
   * before the lot becomes the lot's first - so the three parts need no
   * controls of their own.
   */
  function shiftAt(index: number, by: -1 | 1) {
    if (by === 1) {
      if (index === joinAt - 1 && index >= 1) { setJoinAt(joinAt - 1); return; }
      if (index === leaveAt - 1 && index >= joinAt) { setLeaveAt(leaveAt - 1); return; }
      moveAt(index, index + 1);
      return;
    }
    if (index === leaveAt && leaveAt < dispatchAt) { setLeaveAt(leaveAt + 1); return; }
    if (index === joinAt && index < leaveAt) { setJoinAt(joinAt + 1); return; }
    moveAt(index, index - 1);
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
        id: editing ?? savedId ?? undefined,
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
      setSavedId(result.route.id);
      const finish = () => onSaved(result.route);
      /* Lots keep their own copy of a route, so an edit reaches none of them
         by itself. Asked here, once, rather than discovered later. */
      if (result.lotsBehind && result.lotsBehind > 0) setBehind({ route: result.route, lots: result.lotsBehind, finish });
      else finish();
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
      behind.finish();
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
    const onLots = library?.usage?.[editing]?.lots ?? 0;
    if (!await confirmSentence(`Delete "${name.trim() || 'this route'}"? ${onLots > 0
      ? `${onLots === 1 ? '1 lot is' : `${onLots} lots are`} on it now and keep their steps.`
      : 'Lots already on it keep their steps.'}`)) return;
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

  /* Refreshing or closing the tab loses unsaved work as surely as the back
     button does, so the browser is asked to confirm then too. */
  const unsaved = started && savedAs !== snapshot(name, steps, joinAt, leaveAt);
  useEffect(() => {
    if (!unsaved) return;
    const hold = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [unsaved]);

  /** Leaving asks first whenever there is anything on screen that was not saved. */
  async function leave() {
    const dirty = unsaved;
    if (dirty && !await confirmSentence('Leave without saving? This route will be lost.')) return;
    onCancel();
  }

  const named = given.filter((step) => step.name.trim());
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
  const pipDock = sample || pip === 'hidden' ? null : question ? (
    <PipSays mood="think"
      text={`${pipSaid ? `${pipSaid} ` : ''}${question.ask(answers)}`}
      step={pipTotal(answers) - pipQueue(answers).length + 1} of={pipTotal(answers)}
      onHide={() => setPip('hidden')}
      choices={[
        ...question.choices.map((choice, index) => ({
          id: String(index), label: choice.label,
          onPick: () => answer({ ...answers, [question.key]: choice.value }),
        })),
        { id: 'self', label: "I'll take it from here", onPick: () => { setPip('coach'); setPipSaid(''); } },
      ]} />
  ) : tip ? (
    <PipSays mood={tip.mood}
      text={`${pipSaid && tipAt === 0 ? `${pipSaid} ` : ''}${tip.text}`}
      onHide={() => setPip('hidden')}
      choices={[
        ...(tip.fix ? [{ id: 'fix', label: tip.fix.label, primary: true, onPick: () => { setPipSaid(''); fix(tip.fix!.action); } }] : []),
        ...(tips.length > 1 ? [{ id: 'next', label: 'Another tip →', onPick: () => { setPipSaid(''); setTipAt((at) => at + 1); } }] : []),
        { id: 'redo', label: 'Ask me again', onPick: startPip },
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
        {!library && !error && <SkelRouteCards n={4} />}

        {library && (
          <div className="rsnew">
            {/* Most shops ship one of a handful of ways, so those lead: one
                tap opens a whole route to look over. Pip and a blank chain are
                for the shop whose way is not among them. */}
            <span className="rsnew__label">Start from a sample</span>
            <span className="rsnew__key" aria-hidden="true">
              <span className="rsnew__keyitem rsnew__keyitem--pre">Before the lot</span>
              <span className="rsnew__keyitem rsnew__keyitem--lot">In the lot</span>
              <span className="rsnew__keyitem rsnew__keyitem--post">After the lot</span>
            </span>
            <div className="rsnew__list">
              {[...library.routeTemplates, ...library.presets].map((template) => (
                <button key={template.id} type="button" className="rsnew__item"
                  onClick={() => open(template.steps, template.name)}>
                  <span className="rsnew__body">
                    <span className="rsnew__name">{template.name}</span>
                    {template.blurb && <span className="rsnew__blurb">{template.blurb}</span>}
                    {/* Its three parts as one bar, in the colours the editor uses for them. */}
                    <PartsBar steps={template.steps} />
                  </span>
                  <span className="rsnew__count">{template.steps.length} steps</span>
                  <Icon name="right" size={16} />
                </button>
              ))}
            </div>

            <span className="rsnew__label">Or build your own</span>
            <div className="rsnew__list">
              <button type="button" className="rsnew__item" onClick={startPip}>
                <span className="rsnew__body">
                  <span className="rsnew__name">Answer a few questions</span>
                  <span className="rsnew__blurb">Pip builds the route with you.</span>
                </span>
                <Icon name="right" size={16} />
              </button>
              <button type="button" className="rsnew__item" onClick={() => open(library.suggested, '')}>
                <span className="rsnew__body">
                  <span className="rsnew__name">Start from common steps</span>
                  <span className="rsnew__blurb">{library.suggested.length} steps to rename, remove or add to.</span>
                </span>
                <Icon name="right" size={16} />
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
    <form className="rsstudio" onSubmit={save}>
      {pipDock}

      {/* The route itself: its name, and the two ways to look at it. */}
      <header className="rshead">
        <div className="rshead__top">
          <input id="rs-name" className="rshead__name" value={name} onChange={(event) => setName(event.target.value)}
            placeholder="Name this route" aria-label="Route name" required />
          <MoreMenu label="More for this route" items={[
            !sample && pip === 'hidden' && { label: 'Tips from Pip', onClick: () => { setTipAt(0); setPip('coach'); } },
            Boolean(editing || sample?.onDelete) && { label: 'Delete route', danger: true, disabled: busy, onClick: () => void remove() },
          ]} />
        </div>
        <div className="seg rshead__mode" role="tablist" aria-label="Edit the route, or try it">
          <button type="button" role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'is-on' : ''}
            onClick={() => showMode('edit')}>Edit</button>
          <button type="button" role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'is-on' : ''}
            disabled={named.length < 2} onClick={() => showMode('preview')}>Preview</button>
        </div>
      </header>

      {mode === 'preview' ? (
        /* Its own buttons ask in dialogs with forms of their own; none of them saves the route. */
        <div onSubmit={(event) => event.stopPropagation()}>
          {/* Only to see the route on a real lane: lots carry their own countries. */}
          <section className="rsgroup rsgroup--lot rspreviewlane" aria-label="Preview on a lane">
            <div className="rsgroup__lane">
              <label className="rsfield">
                <span>From</span>
                <Select value={lane.origin} aria-label="Preview from"
                  onChange={(event) => setLane({ ...lane, origin: event.target.value })}>
                  <option value="">Country</option>
                  {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
                </Select>
              </label>
              <span className="rsgroup__arrow" aria-hidden="true"><Icon name="right" size={14} /></span>
              <label className="rsfield">
                <span>To</span>
                <Select value={lane.destination} aria-label="Preview to"
                  onChange={(event) => setLane({ ...lane, destination: event.target.value })}>
                  <option value="">Country</option>
                  {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
                </Select>
              </label>
            </div>
            <span className="rsgroup__hint">
              Pick two countries to see how the steps and tracking read. Only for this preview - each lot sets its own.
            </span>
          </section>
          <RoutePreview steps={named} joinAt={namedJoin} leaveAt={namedLeave} vars={vars} days={shopDays?.steps} />
        </div>
      ) : (
      <div className="rslanes">
        {/* The journey in its three parts: a label, then its steps as one
            list. A row is a step's name and what it comes with; tapping it
            opens everything else about it. */}
        {lanes.map((lane) => (
          <section key={lane.zone} id={`rs-lane-${lane.zone}`} className={`rslane rslane--${lane.zone}`}>
            <div className="rszone">
              <span className="rszone__text">
                <span className="rszone__dot" aria-hidden="true" />
                <b>{ZONE_TEXT[lane.zone].title}</b>
                <InfoTip label={`About ${ZONE_TEXT[lane.zone].short}`}>{ZONE_TEXT[lane.zone].note}</InfoTip>
              </span>
              <button type="button" className="rszone__add" aria-label={`Add a step ${ZONE_TEXT[lane.zone].short}`}
                onClick={() => setAdding({ at: lane.zone === 'pre' ? joinAt : lane.zone === 'lot' ? leaveAt : dispatchAt, zone: lane.zone })}>
                <Icon name="plus" size={12} /> Step
              </button>
            </div>
            {lane.indexes.length === 0 ? (
              <p className="rslane__empty">
                {lane.zone === 'lot'
                  ? 'No steps here, so this route never joins a lot: it suits items shipped one by one.'
                  : 'No steps here yet.'}
              </p>
            ) : (
              <div className="rschain">
                {lane.indexes.map((index) => {
                  const step = given[index]!;
                  const first = given[0]?.locked ? 1 : 0;
                  return (
                    <StepNode key={step.id}
                      step={step} index={index} zone={lane.zone}
                      open={openId === step.id}
                      onToggle={() => setOpenId(openId === step.id ? null : step.id)}
                      problems={problems.filter((problem) => problem.stepId === step.id && problem.level === 'error').map((problem) => problem.text)}
                      canUp={!(lane.zone === 'pre' && index <= first)}
                      canDown={lane.zone === 'post' ? !isFixed(given[index + 1]) && index < given.length - 1 : !(index === 0 && joinAt === 1)}
                      hasNext={index < given.length - 1}
                      onChange={(patch) => setAt(index, patch)}
                      onRemove={() => removeAt(index)}
                      onShift={(by) => shiftAt(index, by)}
                      onAddAfter={() => setAdding({ at: index + 1, zone: lane.zone })}
                    />
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
      )}

      {adding && (
        <StepPicker at={adding.at} zone={adding.zone} steps={given}
          onPick={(kind) => insertAt(adding.at, adding.zone, kind)} onClose={() => setAdding(null)} />
      )}

      {named.length < 2 && (
        <span className="field__hint">A route needs at least two named steps.</span>
      )}

      {error && <ErrorNotice message={error} />}


      {blocking.length > 0 && (
        <div className="rsproblems" role="alert">
          <b>Fix before saving</b>
          {blocking.map((problem) => <span key={problem.text}>{problem.text}</span>)}
        </div>
      )}

      {/* Always in reach, however long the list. */}
      <div className="rsbar">
        <button type="button" className="btn btn--quiet rsbar__cancel" onClick={leave}>{cancelLabel}</button>
        <button type="submit" className="btn rsbar__save" disabled={busy || named.length < 2 || !name.trim() || blocking.length > 0}
          title={blocking.length > 0 ? 'Fix the button words above first' : !name.trim() ? 'Give the route a name first' : undefined}>
          {busy ? 'Saving…' : blocking.length > 0 ? `${blocking.length} to fix` : 'Save route'}
        </button>
      </div>
      {!name.trim() && named.length >= 2 && (
        <span className="field__hint" role="status">Name the route at the top to save it.</span>
      )}

      {behind && (
        <Modal title="Update the lots on this route?" onClose={behind.finish}>
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
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={behind.finish}>
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
    step.forward ?? false, step.custom ?? false, step.assignee ?? null, step.typicalDays ?? null,
  ])]);
}

const ZONE_TEXT: Record<StepZone, { title: string; note: string; short: string }> = {
  pre: {
    title: 'Before the lot', short: 'before the lot',
    note: 'Each item moves on its own until it joins a lot. You move it with the buttons on its order.',
  },
  lot: {
    title: 'In the lot', short: 'in the lot',
    note: 'Every item in the lot moves together, when you move the lot.',
  },
  post: {
    title: 'After the lot', short: 'after the lot',
    note: 'Each item is unpacked from the lot and sent on its own to its buyer.',
  },
};

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
  const choices = stepChoices(steps, at, zone, stepKinds());
  const group = (title: string, rows: typeof choices) => rows.length > 0 && (
    <div className="rspick__group">
      <span className="rspick__title">{title}</span>
      {rows.map(({ kind, open, why }) => (
        <button key={kind.id} type="button" className={`rspick__row${open ? '' : ' is-locked'}`} disabled={!open}
          onClick={() => onPick(kind)}>
          <span className="rspick__icon" aria-hidden="true">{open ? kind.icon : <Icon name="lock" size={14} />}</span>
          <span className="rspick__body">
            <b>{kind.library || kind.trigger ? renderStepText(kind.name, vars) : kind.custom ? 'A step with your own button' : 'A plain step'}</b>
            <span>{open
              ? kind.library ? `Button: ${kind.button || renderStepText(kind.name, vars)}${kind.assignee ? ` - you and the ${kind.assignee} press it` : ''}`
                : kind.custom ? 'You name it and its button - pressed per item.'
                : kind.trigger ? 'Comes with its button - you press it to move the item here.'
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
        <p className="rspick__zone"><b>{ZONE_TEXT[zone].title}.</b> {ZONE_TEXT[zone].note}</p>
        {group('Steps with a button', choices.filter((choice) => choice.kind.trigger))}
        {group('More buttons', choices.filter((choice) => choice.kind.library))}
        {group('Your own', choices.filter((choice) => !choice.kind.trigger && !choice.kind.library))}
      </div>
    </Modal>
  );
}

/** Preset wait messages, plus free text for the one in a while that needs its
 *  own words - the same "pick or write your own" shape as a step's name. */
function WaitMessageEditor({ step, onChange }: {
  step: RouteStep;
  onChange: (patch: Partial<RouteStep>) => void;
}) {
  const vars = useContext(PreviewVarsContext);
  const defaultWait = step.trigger ? DEFAULT_WAIT_MESSAGES[step.trigger] : undefined;
  const isPreset = (WAIT_MESSAGE_PRESETS as readonly string[]).includes(step.waitMessage ?? '');
  const [customMode, setCustomMode] = useState(!isPreset && Boolean(step.waitMessage?.trim())
    && step.waitMessage !== NO_WAIT_MESSAGE);

  return (
    <div className="rsfield">
      <span>While buyers wait for the next step</span>
      <Select value={customMode ? 'Custom' : (isPreset ? step.waitMessage : (step.waitMessage ?? ''))}
        aria-label="Pick a wait message"
        onChange={(event) => {
          if (event.target.value === 'Custom') { setCustomMode(true); return; }
          setCustomMode(false);
          onChange({ waitMessage: event.target.value || undefined });
        }}>
        <option value="">{defaultWait ? renderStepText(defaultWait, vars) : 'Show nothing'}</option>
        {/* A default only ever offers "use it" or "write something else" — this
            is the third answer, explicitly saying nothing at all, which is not
            otherwise reachable once a trigger has a default of its own. */}
        {defaultWait && <option value={NO_WAIT_MESSAGE}>Show nothing</option>}
        {WAIT_MESSAGE_PRESETS.map((text) => <option key={text} value={text}>{renderStepText(text, vars)}</option>)}
        <option value="Custom">Your own words…</option>
      </Select>
      {customMode && (
        <input value={step.waitMessage ?? ''} placeholder="e.g. Leaving {origin}"
          aria-label="Custom wait message"
          onChange={(event) => onChange({ waitMessage: event.target.value })} />
      )}
    </div>
  );
}

/**
 * One step: a row with its name and what it comes with, opening to
 * everything else about it - the line buyers read, how long it takes, its
 * button, who presses it, what shows while buyers wait, and where it sits.
 */
function StepNode({ step, index, zone, open, onToggle, problems, canUp, canDown, hasNext, onChange, onRemove, onShift, onAddAfter }: {
  step: RouteStep;
  index: number;
  /** Which part of the journey it is in: inside the lot there are no buttons. */
  zone: StepZone;
  open: boolean;
  onToggle: () => void;
  /** What is wrong with this step's button words. */
  problems: string[];
  canUp: boolean;
  canDown: boolean;
  /** A step follows it, so there is a wait after it to put words to. */
  hasNext: boolean;
  /** How long this step has really taken on the shop's own lots, when it has run before. */
  onChange: (patch: Partial<RouteStep>) => void;
  onRemove: () => void;
  onShift: (by: -1 | 1) => void;
  onAddAfter: () => void;
}) {
  const vars = useContext(PreviewVarsContext);

  /* Always first, never renamed, moved or removed - "Order Placed" reads as
     a fact about every route, and it is the one place a real order's payment
     status shows without the seller writing a word about it. */
  if (index === 0 && step.locked) {
    return (
      <div className="rsstep rsstep--fixed">
        <div className="rsstep__row">
          <span className="rsstep__icon" aria-hidden="true">🧾</span>
          <span className="rsstep__name">{step.name}</span>
          <span className="rsstep__meta">Always first</span>
          <InfoTip label="About Order Placed">
            Always first, and never renamed or moved. It shows the order&apos;s payment status
            automatically - paid, awaiting payment, or refunded.
          </InfoTip>
        </div>
      </div>
    );
  }

  /* The last two presses. Their place is fixed - every route ends on them -
     and Delivered's name too; what they say on the button is still the
     seller's, inside what the checker allows. */
  const isDelivered = step.trigger === 'delivered';
  const fixed = isFixed(step);
  const hasButton = Boolean(stepTickKey(step));
  /* The steps that take a courier name and an AWB: the item's own dispatch,
     always, and any other step the seller switches it on for. */
  const asksCourier = step.trigger === 'dispatched' || Boolean(step.forward);

  return (
    <div className={`rsstep${open ? ' is-open' : ''}${problems.length ? ' is-wrong' : ''}`} data-step={step.id}>
      <button type="button" className="rsstep__row" aria-expanded={open} onClick={onToggle}>
        <span className="rsstep__icon" aria-hidden="true">{stepEmoji(step, index)}</span>
        <span className={`rsstep__name${step.name.trim() ? '' : ' is-blank'}`}>
          {step.name.trim() ? renderStepText(step.name, vars) : 'New step'}
        </span>
        {problems.length > 0 && <span className="rsstep__pill rsstep__pill--wrong">Fix</span>}
        {asksCourier && <span className="rsstep__pill rsstep__pill--courier">Courier</span>}
        {hasButton && <span className="rsstep__pill rsstep__pill--button">Button</span>}
        <Icon name={open ? 'up' : 'down'} size={14} />
      </button>

      {open && (
        <div className="rsstep__edit">
          <label className="rsfield">
            <span>Step name</span>
            <input value={step.name} placeholder="What happens here"
              aria-label={`Step ${index + 1} name`} disabled={isDelivered} autoFocus={!step.name}
              onChange={(event) => onChange({ name: event.target.value })} />
          </label>
          <PlaceTags onAdd={(tag) => onChange({ name: `${step.name.trimEnd()} ${tag}`.trim() })} what="name" />

          <label className="rsfield">
            <span>What buyers read</span>
            <input value={step.description}
              placeholder="One line about what happens here"
              aria-label={`Step ${index + 1} description`}
              onChange={(event) => onChange({ description: event.target.value })} />
          </label>

          {/* The button: handed out from where the step sits and what it says,
              or one of the seller's own. Never inside a lot. */}
          {hasButton ? (
            <div className={`rsbtn${problems.length ? ' is-wrong' : ''}`}>
              <span className="rsbtn__label">Button</span>
              <div className="rsbtn__row">
                <span className="rsbtn__chip">{stepButtonLabel(step, vars) || 'Button'}</span>
                <input className="rsbtn__words" value={step.button ?? ''} maxLength={28}
                  placeholder="Your words (optional)"
                  aria-label={`Words on the button for step ${index + 1}`}
                  onChange={(event) => onChange({ button: event.target.value })} />
              </div>
              <PlaceTags what="button"
                onAdd={(tag) => onChange({ button: `${(step.button || step.name).trimEnd()} ${tag}`.trim() })} />
              {problems.map((text) => <span key={text} className="rsbtn__wrong">{text}</span>)}
              {isDelivered && <span className="rsbtn__note">Pressing it asks first, then tells the buyer.</span>}
              {!isDelivered && <WhoPresses step={step} zone={zone} onChange={onChange} />}
              {step.custom && (
                <button type="button" className="linkbtn rsbtn__add"
                  onClick={() => onChange({ custom: undefined, button: undefined, assignee: undefined })}>
                  Remove the button
                </button>
              )}
            </div>
          ) : step.name.trim() && (
            <div className="rsbtn">
              <span className="rsbtn__label">Button</span>
              <span className="rsbtn__note">
                {zone === 'lot' ? 'None - it moves when you move the lot.' : 'None - it is ticked off with the next step.'}
              </span>
              {/* Moving the crate is the forwarder's job, so a lot step can be
                  theirs to press too - every buyer in the lot is told when it is. */}
              {zone === 'lot' && !fixed && <WhoPresses step={step} zone={zone} onChange={onChange} />}
              {zone !== 'lot' && !fixed && (
                <button type="button" className="linkbtn rsbtn__add" onClick={() => onChange({ custom: true })}>
                  Give it a button
                </button>
              )}
            </div>
          )}

          {/* Courier name and AWB: asked for when this step is reached, and
              shown to buyers on it. Always on the item's dispatch; a switch on
              every other step but Delivered. Outside the lot it is asked when
              the step's button is pressed, so switching it on gives the step
              a button if it had none. */}
          {!isDelivered && (
            <div className={`rscourier${asksCourier ? ' is-on' : ''}`}>
              <label className="rscourier__head">
                <span className="rscourier__title"><span aria-hidden="true">🚚</span> Courier name and AWB</span>
                {step.trigger === 'dispatched'
                  ? <span className="rscourier__always">Always asked</span>
                  : (
                    <input type="checkbox" className="rscourier__switch" checked={Boolean(step.forward)}
                      aria-label={`Ask for the courier name and AWB at step ${index + 1}`}
                      onChange={(event) => onChange(event.target.checked && zone !== 'lot' && !hasButton
                        ? { forward: true, custom: true }
                        : { forward: event.target.checked || undefined })} />
                  )}
              </label>
              {asksCourier ? (
                <>
                  <span className="rscourier__fields" aria-hidden="true">
                    <span>Courier name<em>e.g. DHL, Delhivery</em></span>
                    <span>AWB / tracking ID<em>e.g. 1234567890</em></span>
                  </span>
                  <span className="rsbtn__note">
                    You are asked for these two {zone === 'lot' ? 'when you move the lot here' : 'when you press the button'}.
                    Both are optional, and buyers see what you fill in.
                  </span>
                </>
              ) : (
                <span className="rsbtn__note">
                  Turn on to add the courier name and AWB {zone === 'lot' ? 'when the lot moves here' : 'when this step is pressed'}.
                </span>
              )}
            </div>
          )}

          {hasNext && <WaitMessageEditor step={step} onChange={onChange} />}

          {!fixed && (
            <div className="rsstep__acts">
              <button type="button" className="rsstep__act" onClick={onAddAfter}><Icon name="plus" size={12} /> Step below</button>
              <span className="rsstep__gap" />
              <button type="button" className="iconbtn" aria-label="Move up" title="Move up" disabled={!canUp}
                onClick={() => onShift(-1)}><Icon name="up" size={13} /></button>
              <button type="button" className="iconbtn" aria-label="Move down" title="Move down" disabled={!canDown}
                onClick={() => onShift(1)}><Icon name="down" size={13} /></button>
              <button type="button" className="rsstep__act rsstep__act--danger" onClick={onRemove}>Delete</button>
            </div>
          )}
        </div>
      )}
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
      <span className="rsbtn__wholabel">Pressed by</span>
      <span className="rsbtn__whochip is-on is-fixed" title="You can always press it">You</span>
      {shown.map((who) => {
        const on = step.assignee === who.id;
        return (
          <button key={who.id} type="button" aria-pressed={on} className={`rsbtn__whochip rsbtn__whochip--${who.id}${on ? ' is-on' : ''}`}
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
  supplier: { id: 'supplier', label: 'Supplier' },
  forwarder: { id: 'forwarder', label: 'Forwarder' },
  handler: { id: 'handler', label: 'Handler' },
};

/** Whose part of the journey each zone is. */
const ZONE_CREW: Record<StepZone, { id: StepAssignee; label: string }> = {
  pre: CREW.supplier,
  lot: CREW.forwarder,
  post: CREW.handler,
};

/**
 * The two place tags, a tap away while a step is being written: each turns
 * into the lot's own country - "Received at {origin} WH" reads "Received at
 * 🇨🇳 WH" once the lot ships from China. Shown only on the card being edited.
 */
function PlaceTags({ what, onAdd }: { what: 'name' | 'button'; onAdd: (tag: string) => void }) {
  return (
    <span className="rstags" role="group" aria-label={`Add a place to the ${what}`}>
      {/* Pressing one keeps the field being typed in focused, so the tags stay put. */}
      <button type="button" className="rstags__tag" onPointerDown={(event) => event.preventDefault()}
        onClick={() => onAdd('{origin}')}>+ {'{origin}'}</button>
      <button type="button" className="rstags__tag" onPointerDown={(event) => event.preventDefault()}
        onClick={() => onAdd('{dest}')}>+ {'{dest}'}</button>
      <span className="rstags__hint">the lot&apos;s country</span>
    </span>
  );
}

/** A route's three parts as one bar - before the lot, in it, after it - sized by their steps. */
function PartsBar({ steps }: { steps: RouteStep[] }) {
  const parts = routeParts({ steps });
  const total = Math.max(1, steps.length);
  return (
    <span className="rsnew__bar" role="img" aria-label={routePartsLine({ steps })} title={routePartsLine({ steps })}>
      {parts.before > 0 && <span className="rsnew__seg rsnew__seg--pre" style={{ flexGrow: parts.before / total }} />}
      {parts.lot > 0 && <span className="rsnew__seg rsnew__seg--lot" style={{ flexGrow: parts.lot / total }} />}
      {parts.after > 0 && <span className="rsnew__seg rsnew__seg--post" style={{ flexGrow: parts.after / total }} />}
    </span>
  );
}
