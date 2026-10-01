import { useState } from 'react';
import type { RouteProblem } from '@shared/buttons';
import type { OrderCheckpoint } from '@shared/enums';
import { itemStepOn, renderStepText, stepButtonLabel, type RouteStep, type StepTrigger } from '@shared/routes';
import { Ladder } from './Ladder';
import { TrackHero, boxesFor, stepEmoji } from './OrderTrack';
import { LotMoves, SkipLink, SkipPicker, StepButton, timelineButtons } from './StepActs';
import { Pip } from './RouteMascot';
import { Modal } from './ui';

type Vars = { origin?: string | null; destination?: string | null };

/**
 * A route tried on a pretend order before it is saved.
 *
 * The order card a seller works from under Items, with this route's next
 * button on it, and the timeline its buyer would read under it, moving as
 * the button is pressed. Which button moves which step is never set here -
 * that is worked out from the steps - so the one thing to change is what the
 * buttons say, and those words are the route's own: closing keeps them.
 */
export function RoutePreview({ steps, joinAt, leaveAt, vars, problems, onChangeStep, onClose }: {
  steps: RouteStep[];
  joinAt: number;
  leaveAt: number;
  vars: Vars;
  /** What is wrong with the buttons' words, from `checkButtons`. */
  problems: RouteProblem[];
  onChangeStep: (index: number, patch: Partial<RouteStep>) => void;
  onClose: () => void;
}) {
  const [ticks, setTicks] = useState<Partial<Record<OrderCheckpoint, string>>>({});
  /** Where the pretend lot has got to; below `joinAt` it has not moved. */
  const [lotStep, setLotStep] = useState(-1);
  const [justPressed, setJustPressed] = useState<RouteStep | null>(null);
  const [picking, setPicking] = useState<{ step: RouteStep; index: number }[] | null>(null);

  const current = Math.max(0, itemStepOn({ steps }, lotStep >= joinAt ? lotStep : 0, undefined, ticks));
  const pressed = (trigger: StepTrigger) => Boolean(ticks[trigger]);
  const at = timelineButtons(steps, current, pressed);
  const next = at.next >= 0 ? steps[at.next] : undefined;

  function press(step: RouteStep, on: boolean) {
    const checkpoint = step.trigger!;
    setTicks((now) => {
      const out = { ...now };
      if (on) out[checkpoint] = new Date().toISOString();
      else delete out[checkpoint];
      return out;
    });
    setJustPressed(on ? step : null);
  }

  function moveLot() {
    setLotStep(Math.min(leaveAt - 1, Math.max(lotStep, joinAt - 1, current) + 1));
  }

  const here = steps[current];
  const reached = steps[current + 1] ? `Next: ${renderStepText(steps[current + 1]!.name, vars)}` : 'Delivered - all done! 🎉';
  const buttons = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.trigger);
  const problemFor = (id: string) => problems.filter((problem) => problem.stepId === id && problem.level === 'error');

  return (
    <Modal title="👀 Preview" onClose={onClose}>
      <div className="stack">
        <div className="rsprev__intro">
          <Pip mood={current >= steps.length - 1 ? 'cheer' : 'happy'} size={44} />
          <p>
            A sale on this route, the way it shows under <b>Items → Orders</b>. Press its button and watch the
            timeline move. The buttons are handed out for you, in order - you only choose what they say.
          </p>
        </div>

        {/* The order card, as the seller sees it in their list: one button, the next one. */}
        <div className="rsprev__order">
          <div className="rsprev__head">
            <span className="rsprev__photo" aria-hidden="true">🧸</span>
            <span className="rsprev__who">
              <b>Sample · Labubu Big Into Energy</b>
              <span className="faint">Sold to Asha · ₹2,499 · 📦 Import</span>
            </span>
            <span className="badge badge--accent">Example</span>
          </div>
          <div className="rsprev__acts">
            {next ? (
              <button type="button" className="ocard__next" key={next.id} onClick={() => press(next, true)}>
                <span aria-hidden="true">⚡</span> {stepButtonLabel(next, vars)}
              </button>
            ) : at.waitingOnLot ? (
              <>
                <span className="ocard__wait">🚢 Moves with the lot</span>
                <button type="button" className="ocard__undo" onClick={moveLot}
                  title="On a real lot this is the lot page's button, and it moves every item in it at once.">
                  Move the lot on →
                </button>
              </>
            ) : (
              <span className="ocard__wait">🎉 Delivered</span>
            )}
            {justPressed && (
              <button type="button" className="ocard__undo" onClick={() => press(justPressed, false)}>
                ✓ {stepButtonLabel(justPressed, vars)} · Undo
              </button>
            )}
            <span className="ocard__spacer" />
            <button type="button" className="ladder__act" onClick={() => { setTicks({}); setLotStep(-1); setJustPressed(null); }}>
              ↺ Start over
            </button>
          </div>
        </div>

        {/* What the buyer reads - and the seller, with the same button on it. */}
        <TrackHero icon={here ? stepEmoji(here, current) : '🧾'}
          now={here ? renderStepText(here.name, vars) : 'Order placed'}
          sub={reached}
          boxes={boxesFor(steps, current, vars)}
          done={current + 1} total={steps.length}>
          <div className="trk__ladder">
            <Ladder steps={steps} current={current} vars={vars}
              leaveAt={leaveAt < steps.length ? leaveAt : undefined}
              lockFrom={leaveAt}
              actFor={(step, index) => {
                if (!step.trigger) {
                  return at.waitingOnLot && index === current + 1
                    ? <LotMoves onSkip={at.later.length ? () => setPicking(at.later) : undefined} />
                    : null;
                }
                const done = pressed(step.trigger);
                if (!done && index !== at.next) return null;
                return (
                  <StepButton step={step} vars={vars} state={done ? 'done' : 'next'} onPress={() => press(step, !done)}>
                    {!done && at.later.length > 0 && <SkipLink onClick={() => setPicking(at.later)} />}
                  </StepButton>
                );
              }} />
          </div>
        </TrackHero>

        {/* The words, and only the words. */}
        <details className="rsprev__words" open={problems.some((problem) => problem.level === 'error')}>
          <summary>✏️ Change what the buttons say</summary>
          <div className="rsprev__setup">
            {buttons.map(({ step, index }) => (
              <label key={step.id} className={`rsprev__cfg${problemFor(step.id).length ? ' is-wrong' : ''}`}>
                <span className="rsprev__cfg-step">
                  <span aria-hidden="true">{stepEmoji(step, index)}</span> {renderStepText(step.name, vars)}
                </span>
                <input value={step.button ?? ''} maxLength={28}
                  placeholder={stepButtonLabel({ ...step, button: undefined }, vars)}
                  aria-label={`Words on the button for ${step.name}`}
                  onChange={(event) => onChangeStep(index, { button: event.target.value })} />
                {problemFor(step.id).map((problem) => (
                  <span key={problem.text} className="rsprev__wrong">{problem.text}</span>
                ))}
              </label>
            ))}
          </div>
        </details>

        <button type="button" className="btn btn--block" onClick={onClose}>Back to the route</button>
      </div>

      {picking && (
        <SkipPicker later={picking} vars={vars} onClose={() => setPicking(null)}
          onPick={(step) => { setPicking(null); press(step, true); }} />
      )}
    </Modal>
  );
}
