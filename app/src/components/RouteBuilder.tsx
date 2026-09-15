import { useState, type DragEvent } from 'react';
import { Icon } from './Icon';
import { sideOf, stepId, type RouteStep, type StepSide } from '@shared/routes';

/**
 * The step list, editable.
 *
 * Drag to reorder on a pointer, arrows to reorder on a phone. Both, not one:
 * HTML5 drag and drop does not fire on touch at all, and this app is read on a
 * phone first - a builder that only worked with a mouse would be a builder
 * most sellers could never use. The arrows are the mechanism; dragging is the
 * shortcut for whoever has a mouse in their hand.
 *
 * A step is a name, a line of explanation, and a position. Nothing else: the
 * moment a step carries a state machine or a rule about who may tick it,
 * sellers stop writing routes and start asking support to write them.
 *
 * `split` turns the one list into two halves with the hand-over drawn between
 * them - what happens to an item on its own, and what happens to it once it
 * travels inside a lot. Two halves on the screen, one list underneath: a
 * step's side is a property of the step, so dragging it across the divider is
 * the same operation as dragging it up one place.
 */
export function RouteBuilder({ steps, onChange, split = false }: {
  steps: RouteStep[];
  onChange: (next: RouteStep[]) => void;
  split?: boolean;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  /**
   * Positions renumbered on every change, so they are never stale - and, when
   * the list is split, the halves kept in order.
   *
   * The partition is not cosmetic. Everything downstream reads the hand-over
   * as "the first step on the far side", so a pre-lot step sitting after a
   * lot step is a route that cannot be walked. Enforcing it here means no
   * caller has to remember it.
   */
  const commit = (next: RouteStep[]) => {
    const ordered = split
      ? [...next.filter((step) => step.side !== 'post'), ...next.filter((step) => step.side === 'post')]
      : next;
    onChange(ordered.map((step, index) => ({ ...step, position: index })));
  };

  /** Move a step, optionally landing it on the other side of the divider. */
  const move = (from: number, to: number, side?: StepSide) => {
    if (from === to && !side) return;
    if (to < 0 || to > steps.length) return;
    const next = [...steps];
    const [taken] = next.splice(from, 1);
    if (!taken) return;
    next.splice(to > from ? to - 1 : to, 0, side ? { ...taken, side } : taken);
    commit(next);
  };

  const setAt = (index: number, patch: Partial<RouteStep>) =>
    commit(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  const remove = (index: number) => commit(steps.filter((_, i) => i !== index));

  /** A new step lands at the end of its own half, which is where the eye is. */
  const add = (side?: StepSide) => {
    const at = side === 'pre'
      ? steps.filter((step) => step.side !== 'post').length
      : steps.length;
    const next = [...steps];
    next.splice(at, 0, {
      id: stepId(steps.length), name: '', description: '', position: at, side,
    });
    commit(next);
  };

  const rows = (side: StepSide) => steps
    .map((step, index) => ({ step, index }))
    .filter(({ step, index }) => sideOf(step, index) === side);

  const shared = {
    onMove: move,
    onSet: setAt,
    onRemove: remove,
    dragging,
    over,
    setDragging,
    setOver,
  };

  if (!split) {
    return (
      <div className="steps">
        <StepRows rows={steps.map((step, index) => ({ step, index }))} {...shared} side={undefined} />
        <AddStep onClick={() => add()} />
        {steps.filter((step) => step.name.trim()).length < 2 && (
          <span className="field__hint">
            A route needs at least two steps — one step is a status, not a journey.
          </span>
        )}
      </div>
    );
  }

  const post = rows('post');

  return (
    <div className="steps steps--split">
      <Half side="pre" title="Before it joins a lot"
        hint="What happens to one order on its own. The buyer reads these while they wait."
        rows={rows('pre')} onAdd={() => add('pre')} {...shared}
        onDropEnd={(from) => move(from, steps.filter((step) => step.side !== 'post').length, 'pre')} />

      <div className="joinline">
        <span>from here, pieces travel together as one lot</span>
      </div>

      <Half side="post" title="After it joins a lot"
        hint="What happens to the whole lot. Moving the lot forward moves every item in it."
        rows={post} onAdd={() => add('post')} {...shared}
        onDropEnd={(from) => move(from, steps.length, 'post')}
        empty="Nothing below the line, so this route never joins a lot — which is right for a courier run where every order travels on its own." />
    </div>
  );
}

/** The shared machinery of a list of steps, however many lists there are. */
interface RowProps {
  onMove: (from: number, to: number, side?: StepSide) => void;
  onSet: (index: number, patch: Partial<RouteStep>) => void;
  onRemove: (index: number) => void;
  dragging: number | null;
  over: number | null;
  setDragging: (index: number | null) => void;
  setOver: (index: number | null) => void;
}

/**
 * One half of a split ladder: a heading, its rows, and a way to add one.
 *
 * The whole section is a drop target, not only its rows, so a step can be
 * dragged into a half that is still empty - which is exactly the half a seller
 * is most likely to be filling.
 */
function Half({ side, title, hint, rows, onAdd, onDropEnd, empty, ...row }: RowProps & {
  side: StepSide;
  title: string;
  hint: string;
  rows: { step: RouteStep; index: number }[];
  onAdd: () => void;
  /** Where a step dropped on the empty part of this half should land. */
  onDropEnd: (from: number) => void;
  empty?: string;
}) {
  return (
    <section
      className="stepsec"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        // Dropped on the section rather than on a row: land it at the end of
        // this half, which is where the empty space it was dropped on is.
        if (row.dragging !== null) onDropEnd(row.dragging);
        row.setDragging(null);
        row.setOver(null);
      }}
    >
      <div className="stepsec__head">
        <h3>{title}</h3>
        <span className="field__hint">{hint}</span>
      </div>
      <StepRows rows={rows} side={side} {...row} />
      {empty && rows.length === 0 && <p className="stepsec__none">{empty}</p>}
      <AddStep onClick={onAdd} />
    </section>
  );
}

/** The rows of one list, or of one half of a split one. */
function StepRows({ rows, onMove, onSet, onRemove, dragging, over, setDragging, setOver, side }: RowProps & {
  rows: { step: RouteStep; index: number }[];
  side: StepSide | undefined;
}) {
  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    // Stopped here so the surrounding half does not also handle the drop and
    // send the step to the end of the list the seller just aimed past.
    event.stopPropagation();
    if (dragging !== null) onMove(dragging, index, side);
    setDragging(null);
    setOver(null);
  };

  return (
    <>
      {rows.map(({ step, index }, row) => (
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
            <Icon name="grip" size={15} />
          </span>

          <span className="step__no">{row + 1}</span>

          <input
            className="step__name"
            value={step.name}
            aria-label={`Step ${row + 1} name`}
            placeholder="What happens here"
            onChange={(event) => onSet(index, { name: event.target.value })}
          />

          {/* The sentence the buyer reads under the step name on their
              timeline. Written here, beside the step it explains, because a
              seller who has to open a second screen to describe a step
              describes none of them. */}
          <input
            className="step__desc"
            value={step.description}
            aria-label={`Step ${row + 1} description`}
            placeholder="Say what happens here, in one line"
            onChange={(event) => onSet(index, { description: event.target.value })}
          />

          <span className="step__acts">
            <button type="button" className="iconbtn" aria-label={`Move step ${row + 1} up`}
              disabled={row === 0} onClick={() => onMove(index, index - 1)}>
              <Icon name="up" size={13} />
            </button>
            <button type="button" className="iconbtn" aria-label={`Move step ${row + 1} down`}
              disabled={row === rows.length - 1} onClick={() => onMove(index, index + 2)}>
              <Icon name="down" size={13} />
            </button>
            {side && (
              <button type="button" className="iconbtn"
                aria-label={side === 'pre'
                  ? `Move step ${row + 1} below the line`
                  : `Move step ${row + 1} above the line`}
                title={side === 'pre' ? 'Move below the line' : 'Move above the line'}
                onClick={() => onSet(index, { side: side === 'pre' ? 'post' : 'pre' })}>
                <Icon name="sort" size={13} />
              </button>
            )}
            <button type="button" className="iconbtn iconbtn--danger"
              aria-label={`Delete step ${row + 1}`}
              onClick={() => onRemove(index)}><Icon name="close" size={13} /></button>
          </span>
        </div>
      ))}
    </>
  );
}

function AddStep({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
      onClick={onClick}>
      <Icon name="plus" size={13} /> Add a step
    </button>
  );
}
