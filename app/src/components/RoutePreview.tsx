import { useState } from 'react';
import { serialButtons } from '@shared/buttons';
import { itemStepOn, renderStepText, stepTickKey, type RouteStep } from '@shared/routes';
import { ShipmentChip } from './OrderStatus';
import { Ladder } from './Ladder';
import { TrackHero, boxesFor, stepEmoji } from './OrderTrack';
import { SerialButtons } from './SerialButtons';
import type { Shipment } from './ShipDialog';

type Vars = { origin?: string | null; destination?: string | null };

/**
 * A route tried on a pretend order before it is saved, shown twice: the
 * order card a seller works from under Sell → Orders, with the same buttons
 * and the same questions a real order asks, and the tracking its customer
 * reads, moving as those buttons are pressed. Nothing here is saved.
 */
export function RoutePreview({ steps, joinAt, leaveAt, vars }: {
  steps: RouteStep[];
  joinAt: number;
  leaveAt: number;
  vars: Vars;
}) {
  const [ticks, setTicks] = useState<Record<string, string>>({});
  const [shipment, setShipment] = useState<Shipment | null>(null);
  /** Where the pretend lot has got to; below `joinAt` it has not moved. */
  const [lotStep, setLotStep] = useState(-1);
  const [said, setSaid] = useState<string | null>(null);

  const hasLot = joinAt < leaveAt;
  const current = Math.max(0, itemStepOn({ steps }, lotStep >= joinAt ? lotStep : 0, undefined, ticks));
  const here = steps[current];
  const buttons = serialButtons(steps, hasLot ? Math.max(lotStep, 0) : 0, ticks, vars);
  const lotAt = lotStep >= joinAt ? lotStep : -1;
  const lotNext = hasLot && lotAt < leaveAt - 1 ? Math.max(lotAt + 1, joinAt) : -1;

  function press(key: string, on: boolean, ship?: Shipment) {
    setTicks((now) => {
      const out = { ...now };
      if (on) out[key] = new Date().toISOString();
      else delete out[key];
      return out;
    });
    if (key === 'dispatched') setShipment(on ? ship ?? null : null);
    const step = steps.find((entry) => stepTickKey(entry) === key);
    setSaid(step ? `${on ? '✓' : '↩'} ${renderStepText(step.name, vars)} - your customer's tracking ${on ? 'moved' : 'went back'}.` : null);
  }

  function moveLot() {
    if (lotNext < 0) return;
    setLotStep(lotNext);
    setSaid(`🚢 The lot moved to ${renderStepText(steps[lotNext]!.name, vars)} - every order in it moves together.`);
  }

  function reset() {
    setTicks({});
    setShipment(null);
    setLotStep(-1);
    setSaid(null);
  }

  return (
    <div className="rsprev">
      <p className="rsprev__lead">
        A sample order on this route{vars.origin && vars.destination ? `, on a ${vars.origin} → ${vars.destination} lot` : ''}. Press
        its buttons the way you would on a real order and watch what your customer sees change below. Nothing is saved.
      </p>

      {/* The seller's side: the order card under Sell → Orders, with its real buttons. */}
      <section className="rsprev__side">
        <div className="rsprev__title">
          <b>🧑‍💼 What you see</b>
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
            onItem={(key, on, ship) => press(key, on, ship)}
            onLot={moveLot} />
        </div>
        {hasLot && (
          <div className="rsprev__lot">
            <span>
              📦 <b>Your lot</b>
              <span className="faint"> · {lotAt >= 0 ? renderStepText(steps[lotAt]!.name, vars) : 'not moved yet'}</span>
            </span>
            <button type="button" className="btn btn--sm" disabled={lotNext < 0} onClick={moveLot}>
              {lotNext < 0 ? 'Lot done' : `Move to ${renderStepText(steps[lotNext]!.name, vars)} →`}
            </button>
          </div>
        )}
        {said && <span className="rsprev__said" role="status">{said}</span>}
      </section>

      {/* The customer's side: their order's tracking, as they read it. */}
      <section className="rsprev__side">
        <div className="rsprev__title">
          <b>🛍️ What your customer sees</b>
          <span className="faint">Their order → Tracking</span>
        </div>
        <TrackHero icon={here ? stepEmoji(here, current) : '🧾'}
          now={here ? renderStepText(here.name, vars) : 'Order placed'}
          sub={steps[current + 1] ? `Next: ${renderStepText(steps[current + 1]!.name, vars)}` : 'Delivered 🎉'}
          boxes={boxesFor(steps, current, vars)}
          done={current + 1} total={steps.length}>
          {shipment && (shipment.courier || shipment.awb) && ticks.dispatched && (
            <ShipmentChip shipment={{ courier: shipment.courier ?? '', awb: shipment.awb ?? '', at: '' }} linked={false} />
          )}
          <div className="trk__ladder">
            <Ladder brief steps={steps} current={current} vars={vars} />
          </div>
        </TrackHero>
      </section>
    </div>
  );
}
