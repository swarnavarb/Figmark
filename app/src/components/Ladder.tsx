import { useState } from 'react';
import type { StageEvent } from '@shared/models';
import { stepStateAt, type RouteStep } from '@shared/routes';
import { Icon } from './Icon';

/**
 * A route, drawn.
 *
 * Done, here, still to come - three states and no more, because a timeline that
 * needs a key is a timeline nobody reads. The same ladder is drawn for the
 * seller working a lot and the buyer watching it, from the same steps, so the
 * two cannot describe the journey differently.
 *
 * Give it `history` and it also shows what was actually said along the way.
 * Give it `onMove` and `onNote` as well and it becomes the seller's editor:
 * the rungs move the lot, and a note can be written at any of them - including
 * between two, which is where most of what a seller has to say actually
 * belongs ("still waiting on the airline, booked for Thursday" is not a step).
 */
export function Ladder({ steps, current, history, onMove, onNote, busy, whose }: {
  steps: RouteStep[];
  current: number;
  /** Everything recorded against this journey, oldest first. */
  history?: StageEvent[];
  /** Seller-side: move to a step. Absent means the ladder is read-only. */
  onMove?: (to: number) => void | Promise<void>;
  /** Seller-side: say something without moving. */
  onNote?: (note: string, at: number) => void | Promise<void>;
  busy?: boolean;
  /** What a note here reaches, said plainly under the box. */
  whose?: string;
}) {
  /** Which rung has its note box open. One at a time: this is a list, not a form. */
  const [noting, setNoting] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const notes = notesByStep(steps, history ?? []);
  const editable = Boolean(onMove || onNote);

  async function send(at: number) {
    const text = draft.trim();
    if (!text || !onNote) return;
    await onNote(text, at);
    setDraft('');
    setNoting(null);
  }

  return (
    <ol className={`ladder${editable ? ' ladder--live' : ''}`}>
      {steps.map((step, index) => {
        const state = stepStateAt(index, current);
        const said = notes.get(index) ?? [];
        return (
          <li key={step.id} className={`ladder__row is-${state}`}>
            <span className="ladder__dot" aria-hidden="true">
              {state === 'done' ? '✓' : state === 'current' ? '●' : ''}
            </span>

            <span className="ladder__body">
              <span className="ladder__name">{step.name}</span>
              {step.description && <span className="faint">{step.description}</span>}

              {said.map((event, at) => (
                <span key={`${event.enteredAt}-${at}`} className="ladder__note">
                  <span className="ladder__note-text">{event.note}</span>
                  <span className="ladder__note-when">{when(event.enteredAt)}</span>
                </span>
              ))}

              {/* The affordance that makes "between the steps" a place you can
                  write: it hangs under the rung the note will be filed at. */}
              {editable && noting !== index && (
                <span className="ladder__acts">
                  {onNote && (
                    <button type="button" className="ladder__act" disabled={busy}
                      onClick={() => { setNoting(index); setDraft(''); }}>
                      <Icon name="plus" size={11} /> Note
                    </button>
                  )}
                  {onMove && index !== current && (
                    <button type="button" className="ladder__act ladder__act--move" disabled={busy}
                      onClick={() => void onMove(index)}>
                      {index < current ? 'Move back here' : 'Move here'}
                    </button>
                  )}
                </span>
              )}

              {editable && noting === index && (
                <span className="ladder__write">
                  <textarea
                    value={draft}
                    rows={2}
                    autoFocus
                    aria-label={`Note at ${step.name}`}
                    placeholder="Still waiting on the airline — booked for Thursday."
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send(index);
                      if (event.key === 'Escape') setNoting(null);
                    }}
                  />
                  <span className="ladder__write-acts">
                    <button type="button" className="btn btn--sm" disabled={busy || !draft.trim()}
                      onClick={() => void send(index)}>
                      Add note
                    </button>
                    <button type="button" className="btn btn--quiet btn--sm"
                      onClick={() => setNoting(null)}>
                      Cancel
                    </button>
                    {whose && <span className="field__hint">{whose}</span>}
                  </span>
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Which rung each recorded event belongs under.
 *
 * By the step name it was recorded against, because that is what was written
 * at the time - a route renamed since should not silently re-file six weeks of
 * history. Events from before routes existed carry no step name and land on
 * the first rung, which is where they read least wrongly.
 */
function notesByStep(steps: RouteStep[], history: StageEvent[]): Map<number, StageEvent[]> {
  const index = new Map<string, number>();
  steps.forEach((step, at) => { if (!index.has(step.name)) index.set(step.name, at); });

  const out = new Map<number, StageEvent[]>();
  for (const event of history) {
    if (!event.note) continue;
    const at = (event.step ? index.get(event.step) : undefined) ?? 0;
    const existing = out.get(at);
    if (existing) existing.push(event);
    else out.set(at, [event]);
  }
  return out;
}

/** A date a person reads at a glance, not a timestamp. */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
