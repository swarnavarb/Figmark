import { useState } from 'react';
import { ORDER_CHECKPOINTS, type OrderCheckpoint } from '@shared/enums';
import { TRIGGER_LABELS, itemStepOn, renderStepText, stepButtonLabel, type RouteStep, type StepTrigger } from '@shared/routes';
import { Ladder } from './Ladder';
import { TrackHero, boxesFor, stepEmoji } from './OrderTrack';
import { StepButton, stepButtonState } from './StepActs';
import { Pip } from './RouteMascot';
import { Modal } from './ui';

type Vars = { origin?: string | null; destination?: string | null };

/**
 * A route tried on a pretend order before it is saved.
 *
 * The order card a seller works from under Items, with this route's buttons
 * on it - which can be renamed, re-bound or taken off right there - and the
 * timeline its buyer would read under it, moving as the buttons are pressed.
 * Every edit is the route's own: closing the preview keeps it.
 */
export function RoutePreview({ steps, joinAt, leaveAt, vars, onChangeStep, onClose }: {
  steps: RouteStep[];
  joinAt: number;
  leaveAt: number;
  vars: Vars;
  onChangeStep: (index: number, patch: Partial<RouteStep>) => void;
  onClose: () => void;
}) {
  const [ticks, setTicks] = useState<Partial<Record<OrderCheckpoint, string>>>({});
  /** Where the pretend lot has got to; below `joinAt` it has not moved. */
  const [lotStep, setLotStep] = useState(-1);
  const [setup, setSetup] = useState(true);
  const [pressed, setPressed] = useState<string | null>(null);

  const hasLot = joinAt < leaveAt && joinAt < steps.length;
  const current = itemStepOn({ steps }, lotStep >= joinAt ? lotStep : 0, undefined, ticks);
  const lotNext = Math.max(lotStep, joinAt - 1, current) + 1;
  const canMoveLot = hasLot && lotNext < leaveAt;
  const used = new Set(steps.map((step) => step.trigger).filter(Boolean) as StepTrigger[]);
  const buttons = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.trigger);

  function press(step: RouteStep) {
    const checkpoint = step.trigger!;
    setPressed(step.id);
    setTicks((now) => {
      const next = { ...now };
      if (next[checkpoint]) delete next[checkpoint];
      else next[checkpoint] = new Date().toISOString();
      return next;
    });
  }

  const at = Math.max(0, Math.min(current, steps.length - 1));
  const here = steps[at];
  const reached = steps[at + 1] ? `Next: ${renderStepText(steps[at + 1]!.name, vars)}` : 'Delivered - all done! 🎉';

  return (
    <Modal title="👀 Preview" onClose={onClose}>
      <div className="stack">
        <div className="rsprev__intro">
          <Pip mood={current >= steps.length - 1 ? 'cheer' : 'happy'} size={44} />
          <p>
            This is how a sale on this route shows up under <b>Items → Orders</b>. Press its buttons and watch
            the buyer's timeline move. Rename or re-bind a button below - it changes the route itself.
          </p>
        </div>

        {/* The order card, as the seller sees it in their list. */}
        <div className="rsprev__order">
          <div className="rsprev__head">
            <span className="rsprev__photo" aria-hidden="true">🧸</span>
            <span className="rsprev__who">
              <b>Sample · Labubu Big Into Energy</b>
              <span className="faint">Sold to Asha · ₹2,499 · 📦 Import</span>
            </span>
            <span className="badge badge--accent">Example</span>
          </div>
          <div className="rsprev__chips">
            {buttons.map(({ step, index }) => {
              const on = Boolean(ticks[step.trigger!]);
              const state = stepButtonState(index, current, on);
              return (
                <button key={step.id} type="button" aria-pressed={on}
                  className={`orow__toggle rsprev__chip is-${state}${on ? ' is-on' : ''}${pressed === step.id ? ' is-pop' : ''}`}
                  onAnimationEnd={() => setPressed(null)}
                  onClick={() => press(step)}>
                  <span aria-hidden="true">{on ? '✓' : state === 'locked' ? '🔒' : '⚡'}</span>
                  <span>{stepButtonLabel(step)}</span>
                </button>
              );
            })}
            {canMoveLot && (
              <button type="button" className="orow__toggle rsprev__lot" onClick={() => setLotStep(lotNext)}
                title="On a real lot this is the lot page's button, and it moves every item in it at once.">
                🚢 Move the lot on
              </button>
            )}
          </div>
          <div className="rsprev__bar">
            <button type="button" className="ladder__act" onClick={() => setSetup((open) => !open)}>
              ⚙️ {setup ? 'Hide button setup' : 'Set up buttons'}
            </button>
            <button type="button" className="ladder__act" onClick={() => { setTicks({}); setLotStep(-1); }}>
              ↺ Start the order over
            </button>
          </div>

          {setup && (
            <div className="rsprev__setup">
              {steps.map((step, index) => {
                if (index === 0 || (step.locked && step.trigger === 'delivered')) return null;
                return (
                  <div key={step.id} className={`rsprev__cfg${step.trigger ? ' is-bound' : ''}`}>
                    <span className="rsprev__cfg-step">
                      <span aria-hidden="true">{stepEmoji(step, index)}</span> {renderStepText(step.name, vars)}
                    </span>
                    <select value={step.trigger ?? ''} aria-label={`Button for ${step.name}`}
                      onChange={(event) => onChangeStep(index, {
                        trigger: (event.target.value || undefined) as StepTrigger | undefined,
                        button: undefined,
                      })}>
                      <option value="">No button - moved with the lot</option>
                      {ORDER_CHECKPOINTS.filter((checkpoint) => checkpoint !== 'delivered').map((checkpoint) => (
                        <option key={checkpoint} value={checkpoint}
                          disabled={used.has(checkpoint as StepTrigger) && step.trigger !== checkpoint}>
                          ⚡ {TRIGGER_LABELS[checkpoint as StepTrigger].button} - {TRIGGER_LABELS[checkpoint as StepTrigger].means}
                        </option>
                      ))}
                    </select>
                    {step.trigger && (
                      <input value={step.button ?? ''} maxLength={28}
                        placeholder={`Button text, e.g. ${TRIGGER_LABELS[step.trigger].button}`}
                        aria-label={`Button text for ${step.name}`}
                        onChange={(event) => onChangeStep(index, { button: event.target.value })} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* What the buyer reads - and the seller, with the same buttons on it. */}
        <TrackHero icon={here ? stepEmoji(here, at) : '🧾'}
          now={here ? renderStepText(here.name, vars) : 'Order placed'}
          sub={reached}
          boxes={boxesFor(steps, at, vars)}
          done={at + 1} total={steps.length}>
          <div className="trk__ladder">
            <Ladder steps={steps} current={at} vars={vars}
              leaveAt={leaveAt < steps.length ? leaveAt : undefined}
              lockFrom={leaveAt}
              actFor={(step, index) => (step.trigger ? (
                <StepButton step={step} state={stepButtonState(index, at, Boolean(ticks[step.trigger]))}
                  onPress={() => press(step)} />
              ) : null)} />
          </div>
        </TrackHero>

        <button type="button" className="btn btn--block" onClick={onClose}>Back to the route</button>
      </div>
    </Modal>
  );
}
