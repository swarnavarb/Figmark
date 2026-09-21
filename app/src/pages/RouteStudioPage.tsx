import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ORDER_CHECKPOINTS } from '@shared/enums';
import {
  DEFAULT_WAIT_MESSAGES, TRIGGER_LABELS, joinIndexOf, sideOf, stepId,
  type RouteStep, type StepTrigger,
} from '@shared/routes';
import { ApiRequestError, api, type RoutesResponse } from '../api';
import { ErrorNotice, Icon } from '../components/ui';
import { SkeletonRows } from '../components/Feedback';
import { STAGE_ICON_META } from '../components/RouteBuilder';
import { Ladder } from '../components/Ladder';

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

      <div className="rschain">
        <Inserter onClick={() => insertAt(0)} />
        {sided.map((step, index) => (
          <div key={step.id}>
            {index === joinAt && (
              <div className="rsjoin">
                <span className="rsjoin__line" aria-hidden="true" />
                <span className="rsjoin__label">
                  <Icon name="box" size={12} /> Items join the lot here
                </span>
                <span className="rsjoin__acts">
                  <button type="button" className="iconbtn" aria-label="Move the join line earlier"
                    disabled={joinAt === 0} onClick={() => setJoinAt(joinAt - 1)}>
                    <Icon name="up" size={12} />
                  </button>
                  <button type="button" className="iconbtn" aria-label="Move the join line later"
                    disabled={joinAt >= steps.length} onClick={() => setJoinAt(joinAt + 1)}>
                    <Icon name="down" size={12} />
                  </button>
                </span>
              </div>
            )}
            <StepNode
              step={step} index={index} count={steps.length}
              onChange={(patch) => setAt(index, patch)}
              onRemove={() => removeAt(index)}
              onMove={(to) => moveAt(index, to)}
            />
            <Inserter onClick={() => insertAt(index + 1)} />
          </div>
        ))}
        {joinAt >= steps.length && (
          <div className="rsjoin">
            <span className="rsjoin__line" aria-hidden="true" />
            <span className="rsjoin__label"><Icon name="box" size={12} /> Items join the lot here</span>
            <span className="rsjoin__acts">
              <button type="button" className="iconbtn" aria-label="Move the join line earlier"
                disabled={joinAt === 0} onClick={() => setJoinAt(joinAt - 1)}>
                <Icon name="up" size={12} />
              </button>
            </span>
          </div>
        )}
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
            <Ladder steps={named} current={Math.min(previewAt, named.length - 1)} />
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

/** The "+" sitting on the connecting line between two nodes - or before the
 *  first, or after the last - so a step is inserted exactly where it is
 *  wanted rather than always tacked onto the end of the chain. */
function Inserter({ onClick }: { onClick: () => void }) {
  return (
    <div className="rsinsert">
      <span className="rsinsert__line" aria-hidden="true" />
      <button type="button" className="rsinsert__btn" aria-label="Insert a step here" onClick={onClick}>
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

/** One node: always-visible name and quick controls, everything else open. */
function StepNode({ step, index, count, onChange, onRemove, onMove }: {
  step: RouteStep;
  index: number;
  count: number;
  onChange: (patch: Partial<RouteStep>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const defaultWait = step.trigger ? DEFAULT_WAIT_MESSAGES[step.trigger] : undefined;

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

        <div className="rstrigs">
          <button type="button"
            className={`rstrig${!step.trigger ? ' is-on' : ''}`}
            onClick={() => onChange({ trigger: undefined })}>
            ✋ Manual
          </button>
          {ORDER_CHECKPOINTS.map((checkpoint) => (
            <button key={checkpoint} type="button"
              className={`rstrig${step.trigger === checkpoint ? ' is-on' : ''}`}
              title={TRIGGER_LABELS[checkpoint].means}
              onClick={() => onChange({ trigger: checkpoint as StepTrigger })}>
              ⚡ {TRIGGER_LABELS[checkpoint].button}
            </button>
          ))}
        </div>

        {open && (
          <div className="rsnode__more">
            <label className="field">
              <span>Description</span>
              <input value={step.description} placeholder="Say what happens here, in one line"
                aria-label={`Step ${index + 1} description`}
                onChange={(event) => onChange({ description: event.target.value })} />
            </label>

            <label className="field">
              <span>What buyers read in the gap after this step</span>
              <input value={step.waitMessage ?? ''}
                placeholder={defaultWait ?? 'Nothing — the gap stays quiet'}
                aria-label={`Wait message after step ${index + 1}`}
                onChange={(event) => onChange({ waitMessage: event.target.value })} />
              <span className="field__hint">
                Shown with a small moving icon while this is the last step reached and the next
                one has not happened yet.{defaultWait && ' Leave it blank to use the default above.'}
              </span>
            </label>

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
