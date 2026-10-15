import { useEffect, useRef, useState } from 'react';
import { serialButtons, type SerialButton } from '@shared/buttons';
import type { StageEvent } from '@shared/models';
import { itemStepOn, renderStepText, stepButtonLabel, stepTickKey, type RouteStep } from '@shared/routes';
import { ShipmentChip } from './OrderStatus';
import { Ladder } from './Ladder';
import { TrackHero, boxesFor, stepEmoji } from './OrderTrack';
import { SerialButtons } from './SerialButtons';
import { LotMoves, StepButton, timelineButtons } from './StepActs';
import type { Shipment } from './ShipDialog';

type Vars = { origin?: string | null; destination?: string | null };

/** One thing done to the sample order: a button pressed on it, or its lot moved. */
type Action = { kind: 'item'; key: string; shipment?: Shipment } | { kind: 'lot'; to: number };

const SAMPLE_LOT = { id: 'lot_sample', name: 'October run', number: 'W4F889' };
const SAMPLE_SHIPMENT: Shipment = { courier: 'Delhivery', awb: '1234567890' };
const DAY = 24 * 60 * 60 * 1000;

/**
 * A route tried on a pretend order before it is saved.
 *
 * On top, the order card a seller works from under Sell → Orders, with the
 * same buttons and the same questions a real order asks, and the lot it
 * rides in. Below, the order's Tracking - as the seller sees it, with the
 * buttons on its steps, or as the customer reads it - with what was said
 * along the way dated between the steps. A walkthrough presses each button
 * in turn and says what it did. Nothing here is saved.
 */
export function RoutePreview({ steps, joinAt, leaveAt, vars }: {
  steps: RouteStep[];
  joinAt: number;
  leaveAt: number;
  vars: Vars;
}) {
  const [done, setDone] = useState<Action[]>([]);
  const [view, setView] = useState<'seller' | 'customer'>('seller');
  const [said, setSaid] = useState<string | null>(null);
  /** The walkthrough: which of its cards is showing, or null when it is closed. */
  const [tour, setTour] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const hasLot = joinAt < leaveAt;
  const { ticks, lotStep, shipment } = replay(done);
  const current = Math.max(0, itemStepOn({ steps }, lotStep >= joinAt ? lotStep : 0, undefined, ticks));
  const here = steps[current];
  const buttons = serialButtons(steps, hasLot ? Math.max(lotStep, 0) : 0, ticks, vars);
  const lotAt = lotStep >= joinAt ? lotStep : -1;
  const lotNext = hasLot && lotAt < leaveAt - 1 ? Math.max(lotAt + 1, joinAt) : -1;
  const pressed = (key: string) => Boolean(ticks[key]);
  const at = timelineButtons(steps, current, pressed);
  const history = sampleHistory(steps, joinAt, done, ticks, shipment);

  /** Everything this route asks of the seller, in order: the walkthrough's script. */
  const script = serialButtons(steps, -1, {}, vars);

  function act(action: Action) {
    if (action.kind === 'item') {
      const on = !pressed(action.key);
      setDone((now) => (on ? [...now, action] : now.filter((entry) => !(entry.kind === 'item' && entry.key === action.key))));
      const step = steps.find((entry) => stepTickKey(entry) === action.key);
      setSaid(step ? `${on ? '✓' : '↩'} ${renderStepText(step.name, vars)} - your customer's tracking ${on ? 'moved' : 'went back'}.` : null);
      return;
    }
    setDone((now) => [...now, action]);
    setSaid(`🚢 The lot moved to “${renderStepText(steps[action.to]!.name, vars)}” - every order in it moves together.`);
  }

  const moveLot = () => { if (lotNext >= 0) act({ kind: 'lot', to: lotNext }); };

  function reset() {
    setDone([]);
    setSaid(null);
  }

  /* The walkthrough: card k explains the k-th press and lights up its button;
     its Next presses it. Going back replays everything before it. */
  function startTour() {
    reset();
    setView('seller');
    setTour(0);
  }
  function tourTo(index: number) {
    setDone(script.slice(0, Math.max(0, index - 1)).map(toAction));
    setSaid(null);
    setView('seller');
    setTour(index);
  }
  function tourNext() {
    if (tour === null) return;
    const entry = tour >= 1 ? script[tour - 1] : undefined;
    if (entry) act(toAction(entry));
    setView('seller');
    setTour(tour + 1);
  }

  /* Light up what the current card is about, and bring it into view. */
  const spot = tour !== null && tour >= 1 && tour <= script.length ? script[tour - 1]! : null;
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    root.querySelectorAll('.is-spot').forEach((node) => node.classList.remove('is-spot'));
    if (!spot) return;
    const target = spot.kind === 'lot'
      ? root.querySelector('.rsprev__lot .btn')
      : root.querySelector('.ladder .stepact__btn.is-next') ?? root.querySelector('.serial__btn--next');
    if (!target) return;
    target.classList.add('is-spot');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  return (
    <div className="rsprev" ref={box}>
      <div className="rsprev__lead">
        <p>
          A sample order on this route{vars.origin && vars.destination ? `, on a ${vars.origin} → ${vars.destination} lot` : ''}.
          Press its buttons the way you would on a real order. Nothing is saved.
        </p>
        <button type="button" className="btn btn--sm" onClick={startTour}>▶ Walk me through it</button>
      </div>

      {/* The order as it sits under Sell → Orders, with its real buttons. */}
      <section className="rsprev__side">
        <div className="rsprev__title">
          <b>🧾 The order</b>
          <span className="faint">Sell → Orders</span>
          <button type="button" className="rsprev__reset" onClick={reset}>↺ Start over</button>
        </div>
        <div className="rsprev__order">
          <div className="rsprev__head">
            <span className="rsprev__photo" aria-hidden="true">🧸</span>
            <span className="rsprev__who">
              <b>Labubu Big Into Energy</b>
              <span className="faint">Sold to Asha · ₹2,499 · Paid</span>
            </span>
            <span className="badge badge--accent">Sample</span>
          </div>
          <SerialButtons fold shipHere buttons={buttons} busy={false}
            who={{ itemName: 'Labubu Big Into Energy', buyerName: 'Asha' }}
            stepOf={{ at: current, of: steps.length }}
            onItem={(key, _on, ship) => act({ kind: 'item', key, shipment: ship })}
            onLot={moveLot} />
        </div>
        {hasLot && (
          <div className="rsprev__lot">
            <span>
              📦 <b>{SAMPLE_LOT.name}</b>
              <span className="faint"> · {lotAt >= 0 ? renderStepText(steps[lotAt]!.name, vars) : 'not moved yet'}</span>
            </span>
            <button type="button" className="btn btn--sm" disabled={lotNext < 0} onClick={moveLot}>
              {lotNext < 0 ? 'Lot done' : `Move to ${renderStepText(steps[lotNext]!.name, vars)} →`}
            </button>
          </div>
        )}
        {said && <span className="rsprev__said" role="status">{said}</span>}
      </section>

      {/* The order's Tracking: the seller's, with its buttons, or the customer's. */}
      <section className="rsprev__side">
        <div className="seg rsprev__views" role="tablist" aria-label="Whose tracking">
          <button type="button" role="tab" aria-selected={view === 'seller'} className={view === 'seller' ? 'is-on' : ''}
            onClick={() => setView('seller')}>🧑‍💼 What you see</button>
          <button type="button" role="tab" aria-selected={view === 'customer'} className={view === 'customer' ? 'is-on' : ''}
            onClick={() => setView('customer')}>🛍️ What your customer sees</button>
        </div>
        <TrackHero icon={here ? stepEmoji(here, current) : '🧾'}
          now={here ? renderStepText(here.name, vars) : 'Order placed'}
          sub={lotAt >= 0
            ? <>📦 {SAMPLE_LOT.name} <span className="lotname__no">LOT W4-F889</span></>
            : steps[current + 1] ? `Next: ${renderStepText(steps[current + 1]!.name, vars)}` : 'Delivered 🎉'}
          boxes={boxesFor(steps, current, vars)}
          done={current + 1} total={steps.length}>
          {shipment && (shipment.courier || shipment.awb) && ticks.dispatched && (
            <ShipmentChip shipment={{ courier: shipment.courier ?? '', awb: shipment.awb ?? '', at: '' }} linked={false} />
          )}
          <div className="trk__ladder">
            {view === 'seller' ? (
              <Ladder brief steps={steps} current={current} vars={vars} history={history}
                leaveAt={leaveAt < steps.length ? leaveAt : undefined}
                leaveNote={<span className="faint">Press its buttons below as it goes</span>}
                lockFrom={leaveAt}
                lotAction={() => (
                  <span className="ladder__lot-acts">
                    <button type="button" className="ladder__act"
                      onClick={() => setSaid('On a real order, Change lot moves it into another lot - its tracking follows.')}>
                      Change lot
                    </button>
                  </span>
                )}
                actFor={(step, index) => {
                  const key = stepTickKey(step);
                  if (!key) return at.waitingOnLot && index === current + 1 ? <LotMoves /> : null;
                  const isDone = pressed(key);
                  if (!isDone && index !== at.next) return null;
                  return (
                    <StepButton step={step} vars={vars} state={isDone ? 'done' : 'next'}
                      onPress={() => act({ kind: 'item', key, shipment: key === 'dispatched' ? SAMPLE_SHIPMENT : undefined })} />
                  );
                }} />
            ) : (
              <Ladder brief steps={steps} current={current} vars={vars} history={history} />
            )}
          </div>
        </TrackHero>
      </section>

      {tour !== null && (
        <TourCard index={tour} script={script} steps={steps} vars={vars} viewing={view}
          reached={here ? renderStepText(here.name, vars) : ''}
          onNext={tourNext} onBack={() => tourTo(Math.max(0, tour - 1))} onClose={() => setTour(null)}
          onCustomer={() => setView(view === 'customer' ? 'seller' : 'customer')} />
      )}
    </div>
  );
}

function toAction(entry: SerialButton): Action {
  return entry.kind === 'lot'
    ? { kind: 'lot', to: entry.to }
    : { kind: 'item', key: entry.key, shipment: entry.lastMile === 'dispatched' ? SAMPLE_SHIPMENT : undefined };
}

/** Where the sample order stands after everything done to it so far. */
function replay(done: readonly Action[]): { ticks: Record<string, string>; lotStep: number; shipment: Shipment | null } {
  const ticks: Record<string, string> = {};
  let lotStep = -1;
  let shipment: Shipment | null = null;
  done.forEach((action, index) => {
    if (action.kind === 'lot') {
      lotStep = Math.max(lotStep, action.to);
      return;
    }
    ticks[action.key] = String(index);
    if (action.key === 'dispatched') shipment = action.shipment ?? null;
  });
  return { ticks, lotStep, shipment };
}

/**
 * What a real order has said by this point, dated between its steps: the
 * order and its payment at the start, the lot it rides in, the courier on a
 * hand-over, and a line where some buttons were pressed.
 */
function sampleHistory(
  steps: readonly RouteStep[], joinAt: number, done: readonly Action[], ticks: Record<string, string>, shipment: Shipment | null,
): StageEvent[] {
  const start = Date.now() - 20 * DAY;
  const event = (day: number, step: string | undefined, rest: Partial<StageEvent>): StageEvent => ({
    stage: 'ordering', enteredAt: new Date(start + day * DAY).toISOString(), note: null, recordedBy: 'sample', step, ...rest,
  });
  const first = steps[0]?.name;
  const out: StageEvent[] = [
    event(0, first, { note: 'Order placed.' }),
    event(0, first, { note: 'Order accepted by you.' }),
    event(0, first, { note: '💳 Advance received - ₹840 (reference 1234).' }),
    event(0, first, { note: 'You confirmed the payment arrived.' }),
  ];
  /* The lot it will travel in, filed under the last step it takes alone. */
  if (joinAt > 0 && joinAt < steps.length) out.push(event(2, steps[joinAt - 1]?.name, { kind: 'joined', lot: SAMPLE_LOT }));
  done.forEach((action, index) => {
    const day = 3 + index * 2;
    if (action.kind === 'lot') {
      const step = steps[action.to];
      if (step?.forward) out.push(event(day, step.name, { kind: 'step', shipper: 'DHL', trackingId: 'DHL4821937650' }));
      return;
    }
    if (!ticks[action.key]) return;
    const step = steps.find((entry) => stepTickKey(entry) === action.key);
    if (!step) return;
    if (action.key === 'dispatched' && shipment) {
      out.push(event(day, step.name, { kind: 'step', shipper: shipment.courier, trackingId: shipment.awb }));
    } else if (action.key === 'delivered') {
      out.push(event(day, step.name, { note: 'Delivered. Asha can leave a review now.' }));
    } else if (action.key === 'china_received') {
      out.push(event(day, step.name, { note: 'Checked in at the warehouse - 1 piece, no damage.' }));
    }
  });
  return out;
}

/** One card of the walkthrough, over the preview. */
function TourCard({ index, script, steps, vars, reached, viewing, onNext, onBack, onClose, onCustomer }: {
  index: number;
  script: SerialButton[];
  steps: readonly RouteStep[];
  vars: Vars;
  /** Where the customer's tracking is now. */
  reached: string;
  viewing: 'seller' | 'customer';
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  onCustomer: () => void;
}) {
  const total = script.length + 2;
  const entry = index >= 1 && index <= script.length ? script[index - 1]! : null;
  const last = index > script.length;
  const step = entry && entry.kind === 'item' ? steps.find((each) => stepTickKey(each) === entry.key) : undefined;
  const who = step?.assignee ? `You or your ${step.assignee} can press it. ` : '';

  let title: string;
  let body: string;
  if (!entry) {
    title = last ? '🎉 That is the whole journey' : '👋 Here is how this route works';
    body = last
      ? 'Every order on this route moves this way. Press Start over to try the buttons yourself.'
      : 'This is a sample order. I will press each button in turn, the way you would on a real order, and show you what your customer sees after each one.';
  } else if (entry.kind === 'lot') {
    title = `🚢 Move the lot to “${entry.step}”`;
    body = `Steps in the lot have no button on the order. Open Lots → your lot → Tracking and move the lot - every order in it moves to “${entry.step}” at once.`;
  } else if (entry.lastMile === 'dispatched') {
    title = `⚡ Tap “${entry.label}”`;
    body = `${who}It asks for the courier and AWB (both optional). Your customer then gets a link to track the parcel.`;
  } else if (entry.lastMile === 'delivered') {
    title = `⚡ Tap “${entry.label}”`;
    body = 'Once it reaches your customer. They are told it arrived and can leave a review.';
  } else {
    title = `⚡ Tap “${entry.label}”`;
    body = `${who}Tap it when “${entry.step}” happens - on the order card or on its Tracking. Your customer's tracking moves to “${entry.step}”.`;
  }

  return (
    <div className="rstour" role="dialog" aria-label="Walkthrough">
      <div className="rstour__top">
        <span className="rstour__count">{index + 1} of {total}</span>
        <button type="button" className="iconbtn" aria-label="Close the walkthrough" onClick={onClose}>✕</button>
      </div>
      {index >= 2 && <span className="rstour__now">✓ Your customer now sees: <b>{reached}</b></span>}
      <b className="rstour__title">{title}</b>
      <p className="rstour__body">{body}</p>
      <div className="rstour__acts">
        {index > 0 && <button type="button" className="btn btn--quiet btn--sm" onClick={onBack}>Back</button>}
        {index >= 2 && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={onCustomer}>
            {viewing === 'customer' ? '🧑‍💼 Your view' : '🛍️ Customer view'}
          </button>
        )}
        <span className="rstour__gap" />
        {last
          ? <button type="button" className="btn btn--sm" onClick={onClose}>Done</button>
          : <button type="button" className="btn btn--sm" onClick={onNext}>
            {!entry ? 'Start' : entry.kind === 'lot' ? 'Move it →' : `Tap ${shortLabel(entry, vars, steps)} →`}
          </button>}
      </div>
    </div>
  );
}

function shortLabel(entry: SerialButton, vars: Vars, steps: readonly RouteStep[]): string {
  if (entry.kind !== 'item') return 'it';
  const step = steps.find((each) => stepTickKey(each) === entry.key);
  const label = step ? stepButtonLabel(step, vars) : entry.label;
  return label.length > 18 ? 'it' : label;
}
