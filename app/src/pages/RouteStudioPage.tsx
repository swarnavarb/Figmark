import { Fragment, useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { assignButtons, checkButtons, stepChoices, type ButtonChange, type StepKind, type StepZone } from '@shared/buttons';
import {
  DEFAULT_WAIT_MESSAGES, NO_WAIT_MESSAGE, WAIT_MESSAGE_PRESETS, joinIndexOf, leaveIndexOf,
  renderStepText, sideOf, stepButtonLabel, stepId, stepTickKey, waitMessageFor,
  type RouteStep, type StepAssignee, type StepTrigger,
} from '@shared/routes';
import { ApiRequestError, api, type RoutesResponse } from '../api';
import { ErrorNotice, Icon, Modal, WaveLoader } from '../components/ui';
import { SkeletonRows } from '../components/Feedback';
import { STAGE_ICON_META } from '../components/RouteBuilder';
import { Ladder } from '../components/Ladder';
import {
  PipSays, pipAck, pipQueue, pipTips, pipTotal, routeFromAnswers, type PipAnswers, type PipFix,
} from '../components/RouteMascot';
import { RoutePreview } from '../components/RoutePreview';

/** Stands in for the real lot's countries while a route is being written -
 *  nothing is attached to one yet, and the tokens have to show as something
 *  rather than the literal word "origin". */
const PREVIEW_VARS = { origin: 'China', destination: 'India' };

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
 * The other route builder: a vertical chain of nodes instead of stage boxes,
 * a step inserted exactly where the "+" between two nodes is tapped instead
 * of only appended to a box, and a scrubbable preview instead of a static
 * one. It exists to be compared against the original, not to replace it -
 * see RouteEditor in RoutesPage.tsx for that one. Whichever wins, this one
 * goes; nothing here is meant to survive both.
 */
export function RouteStudioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  return (
    <main className="page">
      <Link to="/routes" className="backlink">
        <Icon name="back" size={14} /> Routes
      </Link>
      <RouteStudio
        editing={id && id !== 'new' ? id : null}
        onSaved={() => navigate('/routes')}
        onCancel={() => navigate('/routes')}
      />
    </main>
  );
}

/** Dispatched and Delivered: always the last two presses, so never moved or removed. */
const isFixed = (step: RouteStep | undefined) => step?.trigger === 'dispatched' || step?.trigger === 'delivered';

const blankStep = (seed: number): RouteStep => ({
  id: stepId(seed), name: '', description: '', position: 0,
});

function RouteStudio({ editing, onSaved, onCancel }: {
  editing: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [library, setLibrary] = useState<RoutesResponse | null>(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<RouteStep[]>([]);
  /** Index of the first step that happens to the whole lot, not one item alone. */
  const [joinAt, setJoinAt] = useState(0);
  /** Index of the first step reached one item at a time again, after the lot. */
  const [leaveAt, setLeaveAt] = useState(0);
  const [started, setStarted] = useState(false);
  const [previewAt, setPreviewAt] = useState(0);
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
    setName(called);
    setSteps(given);
    setJoinAt(joinIndexOf({ steps: given }));
    setLeaveAt(Math.min(leaveIndexOf({ steps: given }), given.findIndex((step) => step.trigger === 'dispatched')));
    setStarted(true);
    setPreviewAt(0);
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
    setPipSaid(pipAck(before, after));
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
    setBusy(true);
    setError(null);
    try {
      await api.saveRoute({
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
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that route.');
    } finally {
      setBusy(false);
    }
  }

  const named = given.filter((step) => step.name.trim());
  const bound = named.filter((step) => step.trigger).length;
  const problems = checkButtons(named);
  const blocking = problems.filter((problem) => problem.level === 'error');
  /* The two lines, counted along the named steps the preview draws. */
  const namedJoin = (() => { const at = named.findIndex((step) => step.side === 'post'); return at < 0 ? named.length : at; })();
  const namedLeave = (() => { const at = named.findIndex((step) => step.lastMile); return at < 0 ? named.length : at; })();

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
      <>
        <div className="page__head">
          <div>
            <h1>Route Studio <span className="badge badge--accent">Experimental</span></h1>
            <p className="muted">
              The same routes, a different way to write them: one node per step, top to bottom,
              with a scrubbable preview of what a buyer actually sees.
            </p>
          </div>
        </div>

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
                  <span className="faint">{template.steps.length} steps</span>
                </button>
              ))}
              {library.presets.map((preset) => (
                <button key={preset.id} type="button" className="rscard"
                  onClick={() => open(preset.steps, preset.name)}>
                  <span className="rscard__icon"><Icon name="truck" size={20} /></span>
                  <span className="rscard__name">{preset.name}</span>
                  <span className="rscard__note">{preset.blurb}</span>
                  <span className="faint">{preset.steps.length} steps</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start' }} onClick={onCancel}>
          Cancel
        </button>
      </>
    );
  }

  return (
    <form className="stack" onSubmit={save}>
      {pipDock}

      <label className="field">
        <span>Call it *</span>
        <input id="rs-name" value={name} onChange={(event) => setName(event.target.value)}
          placeholder="Guangzhou air express" required autoFocus />
        <span className="field__hint">For your own lists. Buyers see the nodes below, not this.</span>
      </label>

      {/* The road: every node a green stop along it, every gap a place the
          journey itself can say something while nothing else has happened. */}
      <div className="rschain">
        {/* No shoulder and no on-ramp before the first stop: the road starts
            at Order Placed, it does not lead up to it. */}
        <ZoneLine zone="pre" />
        {!sided[0]?.locked && <GapRow onInsert={() => setAdding({ at: 0, zone: 'pre' })} />}
        {given.map((step, index) => (
          <Fragment key={step.id}>
            {index === joinAt && (
              <ZoneLine zone="lot" at={joinAt} min={1} atEnd={joinAt >= dispatchAt} onMove={setJoinAt}
                onAdd={() => setAdding({ at: joinAt, zone: 'lot' })} />
            )}
            {index === leaveAt && (
              <ZoneLine zone="post" at={leaveAt} min={joinAt} atEnd={leaveAt >= dispatchAt} onMove={setLeaveAt}
                onAdd={() => setAdding({ at: leaveAt, zone: 'post' })} />
            )}
            {/* The line lives on this wrapper alone, sized to its own content -
                which is what lets it reach exactly to the next dot however
                tall a description or an open wait-editor makes this one, and
                why the very last wrapper (Delivered) gets none: nothing
                follows it for a line to reach. */}
            <div className={`rschain__row${index === given.length - 1 ? ' rschain__row--last' : ''}`}>
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
              {/* Nothing follows the locked last stop - no shoulder, no
                  on-ramp, no "what buyers see" gap for a wait that cannot
                  happen. */}
              {!(step.locked && index === given.length - 1) && (
                <GapRow afterStep={step} onChangeWait={(patch) => setAt(index, patch)}
                  onInsert={() => setAdding({ at: index + 1, zone: zoneAt(index) })} />
              )}
            </div>
          </Fragment>
        ))}
      </div>

      {adding && (
        <StepPicker at={adding.at} zone={adding.zone} steps={given}
          onPick={(kind) => insertAt(adding.at, adding.zone, kind)} onClose={() => setAdding(null)} />
      )}

      {named.length < 2 && (
        <span className="field__hint">A route needs at least two named steps.</span>
      )}

      <div className="preview">
        <div className="preview__head">
          <div className="row row--between" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>What your buyer will see</h3>
            <button type="button" className="ladder__act ladder__act--move" disabled={named.length < 2}
              onClick={() => setPreviewing(true)}>
              👀 Try it on a sample order
            </button>
          </div>
          <span className="field__hint">
            {bound} buttons, handed out in order - the rest move with the lot or along with the next button.
            {' '}Shown with example countries — a real lot fills {'{origin}'}/{'{destination}'} in on its own.
          </span>
        </div>

        {named.length > 0 ? (
          <>
            <div className="rsscrub">
              <button type="button" className="iconbtn" aria-label="Preview the step before"
                disabled={previewAt <= 0} onClick={() => setPreviewAt((at) => at - 1)}>
                <Icon name="left" size={13} />
              </button>
              <span className="faint">
                Previewing step {Math.min(previewAt, named.length - 1) + 1} of {named.length}
              </span>
              <button type="button" className="iconbtn" aria-label="Preview the step after"
                disabled={previewAt >= named.length - 1} onClick={() => setPreviewAt((at) => at + 1)}>
                <Icon name="right" size={13} />
              </button>
            </div>
            <Ladder steps={named} current={Math.min(previewAt, named.length - 1)} vars={PREVIEW_VARS} forwardExample
              zones={{ join: namedJoin, leave: namedLeave }} />
          </>
        ) : (
          <p className="muted">Name a node and it appears here.</p>
        )}
      </div>

      {error && <ErrorNotice message={error} />}

      {previewing && (
        <RoutePreview steps={named} joinAt={namedJoin} leaveAt={namedLeave} vars={PREVIEW_VARS} problems={problems}
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

      <div className="row rsdock">
        <button type="button" className="btn btn--quiet" disabled={named.length < 2} onClick={() => setPreviewing(true)}>
          👀 Preview
        </button>
        <button type="submit" className="btn" disabled={busy || named.length < 2 || !name.trim() || blocking.length > 0}>
          {busy ? 'Saving…' : 'Save route'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const ZONE_TEXT: Record<StepZone, { title: string; note: string }> = {
  pre: { title: '① Before the lot', note: 'Each item on its own - buttons per item' },
  lot: { title: '② In the lot', note: 'Everything moves together - no buttons, you move the lot' },
  post: { title: '③ After the lot', note: 'Each item on its own again - buttons per item' },
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
        <b>{text.title}</b>
        <span>{text.note}</span>
      </span>
      {at !== undefined && onMove && (
        <span className="rsjoin__acts">
          <button type="button" className="iconbtn" aria-label={`Move the ${zone === 'lot' ? 'join' : 'leave'} line earlier`}
            disabled={at <= min} onClick={() => onMove(at - 1)}>
            <Icon name="up" size={12} />
          </button>
          <button type="button" className="iconbtn" aria-label={`Move the ${zone === 'lot' ? 'join' : 'leave'} line later`}
            disabled={atEnd} onClick={() => onMove(at + 1)}>
            <Icon name="down" size={12} />
          </button>
          {onAdd && (
            <button type="button" className="iconbtn" aria-label={`Add a step ${zone === 'lot' ? 'to the start of the lot' : 'just after the lot'}`}
              onClick={onAdd}>
              <Icon name="plus" size={12} />
            </button>
          )}
        </span>
      )}
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
  const choices = stepChoices(steps, at, zone);
  const group = (title: string, rows: typeof choices) => rows.length > 0 && (
    <div className="rspick__group">
      <span className="rspick__title">{title}</span>
      {rows.map(({ kind, open, why }) => (
        <button key={kind.id} type="button" className={`rspick__row${open ? '' : ' is-locked'}`} disabled={!open}
          onClick={() => onPick(kind)}>
          <span className="rspick__icon" aria-hidden="true">{open ? kind.icon : '🔒'}</span>
          <span className="rspick__body">
            <b>{kind.custom ? 'A step with your own button' : kind.trigger ? renderStepText(kind.name, PREVIEW_VARS) : 'A plain step'}</b>
            <span>{open
              ? kind.custom ? 'You name it and its button - pressed per item.'
                : kind.trigger ? `⚡ Comes with its button - ${BUTTON_NOTE[kind.trigger].toLowerCase()}`
                  : zone === 'lot' ? 'Moves when you move the lot.' : 'No button - ticked off with the next one.'
              : renderStepText(why ?? '', PREVIEW_VARS)}</span>
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
              {message ? renderStepText(message, PREVIEW_VARS) : 'What buyers see in between steps'}
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
        <option value="">{defaultWait ? `Default — ${renderStepText(defaultWait, PREVIEW_VARS)}` : 'Nothing — the gap stays quiet'}</option>
        {/* A default only ever offers "use it" or "write something else" — this
            is the third answer, explicitly saying nothing at all, which is not
            otherwise reachable once a trigger has a default of its own. */}
        {defaultWait && <option value={NO_WAIT_MESSAGE}>Nothing — the gap stays quiet</option>}
        {WAIT_MESSAGE_PRESETS.map((text) => <option key={text} value={text}>{renderStepText(text, PREVIEW_VARS)}</option>)}
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
  const [open, setOpen] = useState(false);

  /* Always first, never renamed, moved or removed - "Order Placed" reads as
     a fact about every route, and it is the one place a real order's payment
     status shows without the seller writing a word about it. */
  if (index === 0 && step.locked) {
    return (
      <div className="rsnode rsnode--pre">
        <span className="rsnode__dot rsnode__dot--locked" aria-hidden="true"><Icon name="lock" size={12} /></span>
        <div className="rsnode__card rsnode__card--locked">
          <div className="rsnode__top">
            <span className="rsnode__name rsnode__name--static">{step.name}</span>
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
      <span className="rsnode__dot" aria-hidden="true">{index + 1}</span>
      <div className={`rsnode__card${step.stageIcon ? ` rsnode__card--${step.stageIcon}` : ''}${isDelivered ? ' rsnode__card--delivered' : ''}`}>
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
            <span className="rsbtn__chip">⚡ {stepButtonLabel(step, PREVIEW_VARS) || 'Button'}</span>
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
