import { Fragment, useState, type ReactNode } from 'react';
import { isLotEvent, kindOf } from '@shared/fulfilment';
import type { LotStage } from '@shared/enums';
import type { StageEvent } from '@shared/models';
import {
  groupStages, renderStepText, stepForStage, stepStateAt, waitMessageFor, type RouteStep,
} from '@shared/routes';
import { trackingSearchUrl } from '@shared/tracking-links';
import { Icon } from './Icon';
import { StepMark, WaveLoader } from './ui';
import { STAGE_ICON_META } from './RouteBuilder';

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
export function Ladder({ steps, current, history, onMove, onNote, busy, whose, waitingFor, lotAction, vars }: {
  steps: RouteStep[];
  current: number;
  /** Everything recorded against this journey, oldest first. */
  history?: StageEvent[];
  /**
   * The lot's own origin/destination, filled into any `{origin}`/
   * `{destination}` a step's text carries. Absent renders the tokens as the
   * plain words "origin"/"destination" - readable, if not the exact country.
   */
  vars?: { origin?: string | null; destination?: string | null };
  /** Seller-side: move to a step. Absent means the ladder is read-only. */
  onMove?: (to: number, details?: { trackingId?: string; shipper?: string }) => void | Promise<void>;
  /** Seller-side: say something without moving. */
  onNote?: (note: string, at: number) => void | Promise<void>;
  busy?: boolean;
  /** What a note here reaches, said plainly under the box. */
  whose?: string;
  /**
   * The item is done travelling alone and its lot has not moved yet.
   *
   * A real place to be, and the ladder had nowhere to put it: the rung above
   * is finished and the rung below has not happened, so one of the two was
   * being drawn as the present and lying about it. This draws the wait.
   */
  waitingFor?: string | null;
  /** Rendered inside the lot marker, for whoever may change which lot it is. */
  lotAction?: (event: StageEvent) => ReactNode;
}) {
  /** Which rung has its note box open. One at a time: this is a list, not a form. */
  const [noting, setNoting] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  /** A hand-over to a carrier: which forward step is being moved to, if any. */
  const [forwarding, setForwarding] = useState<number | null>(null);
  const [trackingId, setTrackingId] = useState('');
  const [shipper, setShipper] = useState('');

  function moveTo(index: number) {
    if (!onMove) return;
    void onMove(index, { trackingId: trackingId.trim() || undefined, shipper: shipper.trim() || undefined });
    setForwarding(null);
    setTrackingId('');
    setShipper('');
  }

  const notes = notesByStep(steps, history ?? []);
  const editable = Boolean(onMove || onNote);

  /*
   * Stage headers, drawn only where the seller actually grouped steps.
   *
   * `groupStages` folds every step with no `stageId` into a box of one, which
   * is right for the builder (nothing to group, nothing missing) and wrong
   * here: heading every rung with its own name would repeat what is already
   * on it. So only a step that starts an explicitly-named stage gets one.
   */
  const stageStarts = new Map(
    groupStages(steps)
      .filter((group) => group.steps[0]!.step.stageId)
      .map((group) => [group.steps[0]!.index, group] as const),
  );

  async function send(at: number) {
    const text = draft.trim();
    if (!text || !onNote) return;
    await onNote(text, at);
    setDraft('');
    setNoting(null);
  }

  /*
   * The gap after the current rung, if anything is said in it: the explicit
   * wait a caller hands in (the pre-lot/lot boundary), or failing that
   * whatever this route says happens after its current step - a custom
   * message the seller wrote, or the default for the checkpoint it is bound
   * to. Nothing, most of the time: only a handful of steps are places a
   * buyer actually waits.
   */
  const gapMessage = waitingFor || (current >= 0 ? waitMessageFor(steps[current]) : null);

  return (
    <ol className={`ladder${editable ? ' ladder--live' : ''}`}>
      {steps.map((step, index) => {
        // Reaching a step is what ticks it - the present is the gap after
        // it, drawn as its own row below, not a mark on the rung itself.
        const state = stepStateAt(index, current);
        const said = notes.get(index) ?? [];
        const stage = stageStarts.get(index);
        return (
          <Fragment key={step.id}>
          {stage && (
            <li className="ladder__stage" aria-hidden="true">
              <Icon name={STAGE_ICON_META[stage.stageIcon ?? 'warehouse'].icon} size={14} />
              <span>{renderStepText(stage.stageName, vars ?? {})}</span>
            </li>
          )}
          <li className={`ladder__row is-${state}`}>
            <span className="ladder__dot" aria-hidden="true">
              <StepMark state={state} size={11} />
            </span>

            <span className="ladder__body">
              <span className="ladder__name">{renderStepText(step.name, vars ?? {})}</span>
              {step.description && <span className="faint">{renderStepText(step.description, vars ?? {})}</span>}

              {said.map((event, at) => (
                isLotEvent(event)
                  /* Joining a lot is not a rung, so it is not drawn as one: it
                     is a hand-over, marked where it actually happened - which
                     may be before the item was listed, at the moment it sold,
                     or halfway down the ladder. */
                  ? (
                    <span key={`${event.enteredAt}-${at}`} className="ladder__lot">
                      <Icon name="box" size={13} />
                      <span className="ladder__lot-text">
                        {kindOf(event) === 'moved' && event.from
                          ? <>Moved to <strong>{event.lot?.name}</strong> from {event.from.name}</>
                          /* Tense from where the journey actually is, so an
                             item still waiting reads as a promise and one
                             already moving reads as a fact. */
                          : index >= current
                            ? <>Will be shipped with <strong>{event.lot?.name}</strong></>
                            : <>Travelling with <strong>{event.lot?.name}</strong></>}
                        {event.lot?.number && <span className="faint"> · LOT {event.lot.number}</span>}
                      </span>
                      <span className="ladder__note-when">{when(event.enteredAt)}</span>
                      {lotAction?.(event)}
                    </span>
                  )
                  : (
                    <span key={`${event.enteredAt}-${at}`} className="ladder__note">
                      {event.note && <span className="ladder__note-text">{event.note}</span>}
                      {(event.trackingId || event.shipper) && (
                        <span className="ladder__note-text">
                          {event.shipper && <>Shipper: <strong>{event.shipper}</strong></>}
                          {event.shipper && event.trackingId && ' · '}
                          {event.trackingId && <>Tracking ID: <strong>{event.trackingId}</strong></>}
                          {/* No carrier API is connected yet (see
                              api/src/tracking/provider.ts), so this looks the
                              current status up rather than showing it inline. */}
                          {event.trackingId && (
                            <a href={trackingSearchUrl(event.shipper ?? '', event.trackingId)}
                              target="_blank" rel="noopener noreferrer" className="ladder__track-link">
                              Check status <Icon name="external" size={11} />
                            </a>
                          )}
                        </span>
                      )}
                      <span className="ladder__note-when">{when(event.enteredAt)}</span>
                    </span>
                  )
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
                  {onMove && index !== current && forwarding !== index && (
                    <button type="button" className="ladder__act ladder__act--move" disabled={busy}
                      onClick={() => step.forward ? setForwarding(index) : void onMove(index)}>
                      {index < current ? 'Move back here' : 'Move here'}
                    </button>
                  )}
                </span>
              )}

              {/* A hand-over to a carrier gets its two fields here, on the step
                  it actually happened at - not one global "tracking" field
                  that a second forward on the same lot would overwrite. The
                  courier is required: a tracking ID with nobody to ask it of
                  is not a lookup anybody can make, live or by hand. */}
              {editable && forwarding === index && (
                <span className="ladder__write">
                  <input value={trackingId} onChange={(event) => setTrackingId(event.target.value)}
                    placeholder="Tracking ID / AWB" aria-label="Tracking ID or AWB number" />
                  <input value={shipper} onChange={(event) => setShipper(event.target.value)}
                    placeholder="Courier, e.g. DHL, Bluedart" aria-label="Courier or shipper" required />
                  <span className="ladder__write-acts">
                    <button type="button" className="btn btn--sm" disabled={busy || !shipper.trim()}
                      onClick={() => moveTo(index)}>
                      Move here
                    </button>
                    <button type="button" className="btn btn--quiet btn--sm" onClick={() => setForwarding(null)}>
                      Cancel
                    </button>
                  </span>
                  {!shipper.trim() && (
                    <span className="field__hint">The courier's name is required to move here.</span>
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

          {/* The gap after the current rung, drawn as its own row rather than
              folded into either neighbour: it is neither done nor todo, it is
              what is happening right now, between the two. */}
          {gapMessage && index === current && (
            <li className="ladder__row ladder__row--wait is-current">
              <span className="ladder__dot" aria-hidden="true">
                <WaveLoader />
              </span>
              <span className="ladder__body">
                <span className="ladder__name">{gapMessage}</span>
                {waitingFor && (
                  <span className="faint">
                    Everything from here happens to the whole lot, not to this piece alone.
                  </span>
                )}
              </span>
            </li>
          )}
          </Fragment>
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
 * history.
 *
 * An event whose step is not on this ladder still happened, and there are two
 * ordinary ways to have one: an item that joined a lot after reading a
 * different ladder first, and history from before routes existed. Those fall
 * back to the rung their coarse stage implies, which is roughly where they
 * belong rather than bunched at the top pretending to be the beginning.
 */
function notesByStep(steps: RouteStep[], history: StageEvent[]): Map<number, StageEvent[]> {
  const index = new Map<string, number>();
  steps.forEach((step, at) => { if (!index.has(step.name)) index.set(step.name, at); });

  const out = new Map<number, StageEvent[]>();
  for (const event of history) {
    if (!event.note && !event.trackingId && !event.shipper && !isLotEvent(event)) continue;
    const named = event.step ? index.get(event.step) : undefined;
    const at = named ?? stepForStage({ steps }, event.stage as LotStage);
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
