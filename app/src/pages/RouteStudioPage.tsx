import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ORDER_CHECKPOINTS } from '@shared/enums';
import {
  DEFAULT_WAIT_MESSAGES, TRIGGER_LABELS, WAIT_MESSAGE_PRESETS, joinIndexOf, renderStepText, sideOf, stepId,
  waitMessageFor, type RouteStep, type StepTrigger,
} from '@shared/routes';
import { ApiRequestError, api, type RoutesResponse } from '../api';
import { ErrorNotice, Icon, WaveLoader } from '../components/ui';
import { SkeletonRows, useToast } from '../components/Feedback';
import { STAGE_ICON_META } from '../components/RouteBuilder';
import { Ladder } from '../components/Ladder';

/** Stands in for the real lot's countries while a route is being written -
 *  nothing is attached to one yet, and the tokens have to show as something
 *  rather than the literal word "origin". */
const PREVIEW_VARS = { origin: 'China', destination: 'India' };

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
  const [started, setStarted] = useState(false);
  const [previewAt, setPreviewAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.routes().then((result) => {
      setLibrary(result);
      if (!editing) return;
      const found = result.routes.find((route) => route.id === editing);
      if (!found) { setError('No such route.'); return; }
      open(found.steps, found.name);
    }).catch((err) => {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your routes.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function open(from: readonly RouteStep[], called: string) {
    const withSides = from.map((step, index) => ({ ...step, position: index, side: sideOf(step, index) }));
    setName(called);
    setSteps(withSides);
    setJoinAt(joinIndexOf({ steps: withSides }));
    setStarted(true);
    setPreviewAt(0);
  }

  /** Every step's `side`, recomputed from the join line rather than carried
   *  per-step - moving the line is what moves a step between the two halves. */
  const sided = steps.map((step, index) => ({
    ...step,
    side: index < joinAt ? ('pre' as const) : ('post' as const),
  }));

  function insertAt(index: number) {
    const next = [...steps];
    next.splice(index, 0, blankStep(steps.length));
    setSteps(next);
    if (index < joinAt) setJoinAt(joinAt + 1);
  }

  function removeAt(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
    if (index < joinAt) setJoinAt(Math.max(0, joinAt - 1));
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
    // The join line tracks whichever step was on the far side of it, not a
    // raw index, so dragging a step across the line moves it with the step.
    if (from < joinAt && to >= joinAt) setJoinAt(joinAt - 1);
    else if (from >= joinAt && to < joinAt) setJoinAt(joinAt + 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveRoute({
        id: editing ?? undefined,
        name: name.trim(),
        steps: sided
          .filter((step) => step.name.trim())
          .map((step) => ({
            id: step.id,
            name: step.name.trim(),
            description: step.description.trim(),
            side: step.side,
            trigger: step.trigger,
            forward: step.forward,
            waitMessage: step.waitMessage,
          })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that route.');
    } finally {
      setBusy(false);
    }
  }

  const named = sided.filter((step) => step.name.trim());
  const bound = named.filter((step) => step.trigger).length;

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
      <h2>{editing ? 'Edit route — Studio' : 'New route — Studio'}</h2>

      <label className="field">
        <span>Call it *</span>
        <input value={name} onChange={(event) => setName(event.target.value)}
          placeholder="Guangzhou air express" required autoFocus />
        <span className="field__hint">For your own lists. Buyers see the nodes below, not this.</span>
      </label>

      {/* The road: every node a green stop along it, every gap a place the
          journey itself can say something while nothing else has happened. */}
      <div className="rschain">
        <GapRow onInsert={() => insertAt(0)} />
        {sided.map((step, index) => (
          <div key={step.id}>
            {index === joinAt && <JoinDivider joinAt={joinAt} atEnd={false} onMove={setJoinAt} />}
            <StepNode
              step={step} index={index} count={steps.length}
              onChange={(patch) => setAt(index, patch)}
              onRemove={() => removeAt(index)}
              onMove={(to) => moveAt(index, to)}
            />
            <GapRow afterStep={step} onChangeWait={(patch) => setAt(index, patch)}
              onInsert={() => insertAt(index + 1)} />
          </div>
        ))}
        {joinAt >= steps.length && <JoinDivider joinAt={joinAt} atEnd onMove={setJoinAt} />}
      </div>

      {named.length < 2 && (
        <span className="field__hint">A route needs at least two named steps.</span>
      )}

      <div className="preview">
        <div className="preview__head">
          <h3>What your buyer will see</h3>
          <span className="field__hint">
            {bound === 0
              ? 'Nothing here moves on its own yet — bind a button to a node above.'
              : `${bound} of ${named.length} steps move when you press a button.`}
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
            <Ladder steps={named} current={Math.min(previewAt, named.length - 1)} vars={PREVIEW_VARS} />
          </>
        ) : (
          <p className="muted">Name a node and it appears here.</p>
        )}
      </div>

      {error && <ErrorNotice message={error} />}

      <div className="row">
        <button type="submit" className="btn" disabled={busy || named.length < 2 || !name.trim()}>
          {busy ? 'Saving…' : 'Save route'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** The line the whole chain moves the join point along - shown wherever it
 *  currently sits, whether that is between two nodes or past the last one. */
function JoinDivider({ joinAt, atEnd, onMove }: {
  joinAt: number;
  atEnd: boolean;
  onMove: (next: number) => void;
}) {
  return (
    <div className="rsjoin">
      <span className="rsjoin__label">
        <Icon name="box" size={12} /> Items join the lot here
      </span>
      <span className="rsjoin__acts">
        <button type="button" className="iconbtn" aria-label="Move the join line earlier"
          disabled={joinAt === 0} onClick={() => onMove(joinAt - 1)}>
          <Icon name="up" size={12} />
        </button>
        {!atEnd && (
          <button type="button" className="iconbtn" aria-label="Move the join line later"
            onClick={() => onMove(joinAt + 1)}>
            <Icon name="down" size={12} />
          </button>
        )}
      </span>
    </div>
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
  const [customMode, setCustomMode] = useState(!isPreset && Boolean(step.waitMessage?.trim()));

  return (
    <div className="rsgap__editor">
      <select value={customMode ? 'Custom' : (isPreset ? step.waitMessage : '')}
        aria-label="Pick a wait message"
        onChange={(event) => {
          if (event.target.value === 'Custom') { setCustomMode(true); return; }
          setCustomMode(false);
          onChange({ waitMessage: event.target.value || undefined });
        }}>
        <option value="">{defaultWait ? `Default — ${defaultWait}` : 'Nothing — the gap stays quiet'}</option>
        {WAIT_MESSAGE_PRESETS.map((text) => <option key={text} value={text}>{text}</option>)}
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

/** One node on the road: name, description and triggers always showing;
 *  reordering and the carrier hand-over tucked behind the chevron. */
function StepNode({ step, index, count, onChange, onRemove, onMove }: {
  step: RouteStep;
  index: number;
  count: number;
  onChange: (patch: Partial<RouteStep>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const push = useToast();

  function explain(checkpoint: StepTrigger | null) {
    if (!checkpoint) {
      push('Manual — nobody presses a button for this one; it only moves from the ladder itself.', 'info');
      return;
    }
    push(`"${TRIGGER_LABELS[checkpoint].button}" moves this step on its own: ${TRIGGER_LABELS[checkpoint].means}.`, 'info');
  }

  return (
    <div className="rsnode">
      <span className="rsnode__dot" aria-hidden="true">{index + 1}</span>
      <div className="rsnode__card">
        <div className="rsnode__top">
          <input className="rsnode__name" value={step.name} placeholder="What happens here"
            aria-label={`Step ${index + 1} name`}
            onChange={(event) => onChange({ name: event.target.value })} />
          <button type="button" className="iconbtn" aria-label={open ? 'Collapse node' : 'Expand node'}
            onClick={() => setOpen((value) => !value)}>
            <Icon name="chevron" size={13} />
          </button>
        </div>

        <input className="rsnode__desc" value={step.description}
          placeholder="Say what happens here, in one line — {origin} and {destination} work too"
          aria-label={`Step ${index + 1} description`}
          onChange={(event) => onChange({ description: event.target.value })} />

        <div className="rstrigs">
          <button type="button"
            className={`rstrig${!step.trigger ? ' is-on' : ''}`}
            onClick={() => { onChange({ trigger: undefined }); explain(null); }}>
            ✋ Manual
          </button>
          {ORDER_CHECKPOINTS.map((checkpoint) => (
            <button key={checkpoint} type="button"
              className={`rstrig${step.trigger === checkpoint ? ' is-on' : ''}`}
              onClick={() => { onChange({ trigger: checkpoint as StepTrigger }); explain(checkpoint as StepTrigger); }}>
              ⚡ {TRIGGER_LABELS[checkpoint].button}
            </button>
          ))}
        </div>

        {open && (
          <div className="rsnode__more">
            <label className="row" style={{ fontSize: 'var(--t-sm)' }}>
              <input type="checkbox" checked={Boolean(step.forward)}
                onChange={(event) => onChange({ forward: event.target.checked })} />
              <span>Hand-over to a carrier — ask for a tracking ID and courier when a lot moves here</span>
            </label>

            <div className="rsnode__acts">
              <button type="button" className="iconbtn" aria-label={`Move step ${index + 1} up`}
                disabled={index === 0} onClick={() => onMove(index - 1)}><Icon name="up" size={12} /></button>
              <button type="button" className="iconbtn" aria-label={`Move step ${index + 1} down`}
                disabled={index === count - 1} onClick={() => onMove(index + 1)}><Icon name="down" size={12} /></button>
              <button type="button" className="iconbtn iconbtn--danger" aria-label={`Delete step ${index + 1}`}
                onClick={onRemove}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
