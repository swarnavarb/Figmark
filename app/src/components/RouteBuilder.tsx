import { useState } from 'react';
import { Icon, type IconName } from './Icon';
import { Modal } from './ui';
import { ORDER_CHECKPOINTS } from '@shared/enums';
import {
  STAGE_ICONS, STAGE_ICON_LABELS, TRIGGER_LABELS, groupStages, sideOf, stepId,
  type RouteStep, type StageGroup, type StageIcon, type StepSide,
} from '@shared/routes';

/**
 * The route builder: stage boxes, steps inside them, an arrow between each.
 *
 * A stage is nothing new stored - it is `stageId`/`stageName`/`stageIcon` on
 * the same `RouteStep` this app has always tracked, folded into boxes by
 * `groupStages`. A step is still the one thing that gets tracked; the box is
 * only how it is drawn, so nothing here can drift from what the buyer's
 * timeline (`Ladder`) shows, because both read the same steps and the same
 * grouping function.
 *
 * Mobile-first: one column, big tap targets, a bottom sheet to rename a stage
 * or pick its icon. The same markup reflows into a wrapping row on a wide
 * screen (see `.routebuilder` in styles.css) rather than becoming a second,
 * denser component.
 */
export function RouteBuilder({ steps, onChange, split = false }: {
  steps: RouteStep[];
  onChange: (next: RouteStep[]) => void;
  split?: boolean;
}) {
  const [editingStage, setEditingStage] = useState<string | null>(null);

  /** Positions renumbered, and - when split - the two halves kept in order. */
  const commit = (next: RouteStep[]) => {
    const ordered = split
      ? [...next.filter((step) => step.side !== 'post'), ...next.filter((step) => step.side === 'post')]
      : next;
    onChange(ordered.map((step, index) => ({ ...step, position: index })));
  };

  const setAt = (index: number, patch: Partial<RouteStep>) =>
    commit(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  const removeStep = (index: number) => commit(steps.filter((_, i) => i !== index));

  /** Reorder within a stage only - callers disable the buttons at its edges. */
  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [taken] = next.splice(from, 1);
    if (!taken) return;
    next.splice(to, 0, taken);
    commit(next);
  };

  const addStepAfter = (index: number, template: Pick<RouteStep, 'stageId' | 'stageName' | 'stageIcon' | 'side'>) => {
    const next = [...steps];
    next.splice(index + 1, 0, { id: stepId(steps.length), name: '', description: '', position: 0, ...template });
    commit(next);
  };

  /** A new box, opened for editing straight away - a stage nobody names is a stage nobody reads. */
  const addStage = () => {
    const side: StepSide = split ? 'post' : 'pre';
    const id = stepId(steps.length);
    commit([...steps, {
      id, name: 'New step', description: '', position: 0,
      side, stageId: id, stageName: 'New stage', stageIcon: 'warehouse',
    }]);
    setEditingStage(id);
  };

  const setStage = (stageId: string, patch: { stageName?: string; stageIcon?: StageIcon }) =>
    commit(steps.map((step) => ((step.stageId ?? step.id) === stageId ? { ...step, ...patch } : step)));

  const removeStage = (stageId: string) =>
    commit(steps.filter((step) => (step.stageId ?? step.id) !== stageId));

  /** Move a whole box - and every step in it - earlier or later. */
  const moveStage = (from: number, dir: -1 | 1) => {
    const groups = groupStages(steps);
    const to = from + dir;
    if (to < 0 || to >= groups.length) return;
    // Neither end of the swap may hold a locked step - "Order Placed" is
    // always first, so nothing may trade places with its stage either.
    if (groups[from]!.steps.some(({ step }) => step.locked)) return;
    if (groups[to]!.steps.some(({ step }) => step.locked)) return;
    const next = [...groups];
    const [taken] = next.splice(from, 1);
    next.splice(to, 0, taken!);
    commit(next.flatMap((group) => group.steps.map(({ step }) => step)));
  };

  const stages = groupStages(steps);
  const joinAt = split ? steps.findIndex((step, index) => sideOf(step, index) === 'post') : -1;
  const editing = stages.find((group) => group.stageId === editingStage);

  return (
    <div className="routebuilder">
      {stages.map((stage, stageIndex) => (
        <div key={stage.stageId} className="routebuilder__unit">
          {stageIndex > 0 && <Icon name="down" size={16} className="routearrow" />}
          {joinAt >= 0 && stage.steps[0]!.index === joinAt && (
            <div className="joinline"><span>usually joins a lot here</span></div>
          )}
          <StageBox
            stage={stage}
            stageIndex={stageIndex}
            stageCount={stages.length}
            onEdit={() => setEditingStage(stage.stageId)}
            onMoveStage={(dir) => moveStage(stageIndex, dir)}
            onAddStep={() => addStepAfter(stage.steps[stage.steps.length - 1]!.index, {
              stageId: stage.stageId, stageName: stage.stageName, stageIcon: stage.stageIcon,
              side: stage.steps[0]!.step.side,
            })}
            onStepChange={setAt}
            onStepRemove={removeStep}
            onStepMove={moveStep}
          />
        </div>
      ))}

      <button type="button" className="btn btn--quiet routebuilder__add" onClick={addStage}>
        <Icon name="plus" size={14} /> Add stage
      </button>

      {steps.filter((step) => step.name.trim()).length < 2 && (
        <span className="field__hint">A route needs at least two steps — one step is a status, not a journey.</span>
      )}

      {editing && (
        <Modal title="Edit stage" onClose={() => setEditingStage(null)}>
          <label className="field">
            <span>Name</span>
            <input autoFocus value={editing.stageName} placeholder="e.g. Freight forwarder"
              onChange={(event) => setStage(editing.stageId, { stageName: event.target.value })} />
          </label>

          <label className="field">
            <span>Icon</span>
            <div className="stageicons">
              {STAGE_ICONS.map((key) => (
                <button key={key} type="button"
                  className={`stageicon stageicon--${key}${editing.stageIcon === key ? ' is-active' : ''}`}
                  aria-label={STAGE_ICON_LABELS[key]}
                  onClick={() => setStage(editing.stageId, { stageIcon: key })}>
                  <Icon name={STAGE_ICON_META[key].icon} size={18} />
                </button>
              ))}
            </div>
          </label>

          <div className="row row--between">
            {!editing.steps.some(({ step }) => step.locked) && (
              <button type="button" className="btn btn--quiet btn--sm"
                onClick={() => { removeStage(editing.stageId); setEditingStage(null); }}>
                <Icon name="trash" size={13} /> Delete stage
              </button>
            )}
            <button type="button" className="btn btn--sm" onClick={() => setEditingStage(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Which drawn icon and hue each stage type gets. The six brand hues, reused. */
export const STAGE_ICON_META: Record<StageIcon, { icon: IconName }> = {
  supplier: { icon: 'truck' },
  warehouse: { icon: 'box' },
  transit: { icon: 'plane' },
  customs: { icon: 'bank' },
  delivery: { icon: 'home' },
};

/** One box: its icon and name (tap to edit), reorder arrows, and its steps. */
function StageBox({ stage, stageIndex, stageCount, onEdit, onMoveStage, onAddStep, onStepChange, onStepRemove, onStepMove }: {
  stage: StageGroup;
  stageIndex: number;
  stageCount: number;
  onEdit: () => void;
  onMoveStage: (dir: -1 | 1) => void;
  onAddStep: () => void;
  onStepChange: (index: number, patch: Partial<RouteStep>) => void;
  onStepRemove: (index: number) => void;
  onStepMove: (from: number, to: number) => void;
}) {
  const icon = stage.stageIcon ? STAGE_ICON_META[stage.stageIcon].icon : 'box';
  return (
    <div className={`stagebox${stage.stageIcon ? ` stagebox--${stage.stageIcon}` : ''}`}>
      <div className="stagebox__head">
        <button type="button" className="stagebox__title" onClick={onEdit}>
          <span className="stagebox__icon"><Icon name={icon} size={18} /></span>
          <span className="stagebox__name">{stage.stageName || 'Untitled stage'}</span>
          <Icon name="chevron" size={13} />
        </button>
        {!stage.steps.some(({ step }) => step.locked) && (
          <span className="stagebox__reorder">
            <button type="button" className="iconbtn" aria-label="Move stage earlier"
              disabled={stageIndex === 0} onClick={() => onMoveStage(-1)}><Icon name="up" size={12} /></button>
            <button type="button" className="iconbtn" aria-label="Move stage later"
              disabled={stageIndex === stageCount - 1} onClick={() => onMoveStage(1)}><Icon name="down" size={12} /></button>
          </span>
        )}
      </div>

      <div className="stagebox__steps">
        {stage.steps.map(({ step, index }, row) => (
          <StepRow key={step.id} step={step} index={index} row={row} count={stage.steps.length}
            onChange={onStepChange} onRemove={onStepRemove} onMove={onStepMove} />
        ))}
      </div>

      <button type="button" className="btn btn--quiet btn--sm stagebox__addstep" onClick={onAddStep}>
        <Icon name="plus" size={12} /> Add step
      </button>
    </div>
  );
}

/** One step: its name always showing, everything else behind a tap. */
function StepRow({ step, index, row, count, onChange, onRemove, onMove }: {
  step: RouteStep;
  index: number;
  row: number;
  count: number;
  onChange: (index: number, patch: Partial<RouteStep>) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (step.locked) {
    // Always present, never renamed, moved or removed - "Order Placed" reads
    // as a fact about every route rather than a step a seller could break.
    return (
      <div className="stagestep stagestep--locked">
        <div className="stagestep__main">
          <span className="stagestep__dot" aria-hidden="true" />
          <span className="stagestep__name stagestep__name--static">{step.name}</span>
          <Icon name="lock" size={13} />
        </div>
      </div>
    );
  }
  return (
    <div className="stagestep">
      <div className="stagestep__main">
        <span className="stagestep__dot" aria-hidden="true" />
        <input className="stagestep__name" value={step.name} placeholder="What happens here"
          aria-label={`Step ${row + 1} name`}
          onChange={(event) => onChange(index, { name: event.target.value })} />
        <button type="button" className="iconbtn" onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'Collapse step details' : 'Edit step details'}>
          <Icon name="chevron" size={13} />
        </button>
      </div>

      {open && (
        <div className="stagestep__more">
          <input className="stagestep__desc" value={step.description}
            placeholder="Say what happens here, in one line" aria-label={`Step ${row + 1} description`}
            onChange={(event) => onChange(index, { description: event.target.value })} />

          <label className="stagestep__trig">
            <span>Moved by</span>
            <select value={step.trigger ?? ''} aria-label={`What advances step ${row + 1}`}
              onChange={(event) => onChange(index, { trigger: (event.target.value || undefined) as RouteStep['trigger'] })}>
              <option value="">Me, by hand</option>
              {ORDER_CHECKPOINTS.map((checkpoint) => (
                <option key={checkpoint} value={checkpoint}>The "{TRIGGER_LABELS[checkpoint].button}" button</option>
              ))}
            </select>
          </label>

          <div className="stagestep__acts">
            <button type="button" className="iconbtn" aria-label={`Move step ${row + 1} up`}
              disabled={row === 0} onClick={() => onMove(index, index - 1)}><Icon name="up" size={12} /></button>
            <button type="button" className="iconbtn" aria-label={`Move step ${row + 1} down`}
              disabled={row === count - 1} onClick={() => onMove(index, index + 1)}><Icon name="down" size={12} /></button>
            <button type="button" className="iconbtn iconbtn--danger" aria-label={`Delete step ${row + 1}`}
              onClick={() => onRemove(index)}><Icon name="close" size={12} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
