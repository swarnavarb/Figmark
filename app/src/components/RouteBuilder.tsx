import { useState, type DragEvent } from 'react';
import { stepId, type RouteStep } from '@shared/routes';

/**
 * The step list, editable.
 *
 * Drag to reorder on a pointer, arrows to reorder on a phone. Both, not one:
 * HTML5 drag and drop does not fire on touch at all, and this app is read on a
 * phone first - a builder that only worked with a mouse would be a builder
 * most sellers could never use. The arrows are the mechanism; dragging is the
 * shortcut for whoever has a mouse in their hand.
 *
 * A step is a name, an optional line of explanation, and a position. Nothing
 * else: the moment a step carries a state machine or a rule about who may tick
 * it, sellers stop writing routes and start asking support to write them.
 */
export function RouteBuilder({ steps, onChange }: {
  steps: RouteStep[];
  onChange: (next: RouteStep[]) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  /** Positions are renumbered on every change, so they are never stale. */
  const commit = (next: RouteStep[]) =>
    onChange(next.map((step, index) => ({ ...step, position: index })));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const next = [...steps];
    const [taken] = next.splice(from, 1);
    next.splice(to, 0, taken!);
    commit(next);
  };

  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (dragging !== null) move(dragging, index);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="steps">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={`step${dragging === index ? ' is-dragging' : ''}${over === index && dragging !== null && dragging !== index ? ' is-over' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setOver(index); }}
          onDrop={(event) => onDrop(event, index)}
        >
          {/* Only the handle starts a drag, so a tap into the field to rename a
              step does not become a drag of the row it is in. */}
          <span
            className="step__grip"
            draggable
            onDragStart={() => setDragging(index)}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            aria-hidden="true"
          >
            ☰
          </span>

          <span className="step__no">{index + 1}</span>

          <input
            className="step__name"
            value={step.name}
            aria-label={`Step ${index + 1} name`}
            placeholder="What happens here"
            onChange={(event) =>
              commit(steps.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)))}
          />

          <span className="step__acts">
            <button type="button" className="iconbtn" aria-label={`Move step ${index + 1} up`}
              disabled={index === 0} onClick={() => move(index, index - 1)}>▲</button>
            <button type="button" className="iconbtn" aria-label={`Move step ${index + 1} down`}
              disabled={index === steps.length - 1} onClick={() => move(index, index + 1)}>▼</button>
            <button type="button" className="iconbtn iconbtn--danger"
              aria-label={`Delete step ${index + 1}`}
              onClick={() => commit(steps.filter((_, i) => i !== index))}>✕</button>
          </span>
        </div>
      ))}

      <button
        type="button"
        className="btn btn--quiet btn--sm"
        style={{ justifySelf: 'start' }}
        onClick={() =>
          commit([...steps, { id: stepId(steps.length), name: '', description: '', position: steps.length }])}
      >
        + Add step
      </button>

      {steps.filter((step) => step.name.trim()).length < 2 && (
        <span className="field__hint">
          A route needs at least two steps — one step is a status, not a journey.
        </span>
      )}
    </div>
  );
}
