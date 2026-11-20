import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { Spinner } from './Spinner';

/**
 * A press that has to be meant: drag the knob across to say yes, drag it
 * back to take it back. Letting go short of the end springs it home and
 * nothing happens, so a thumb brushing the screen while packing never clears
 * a parcel. A deliberate flick counts too: past halfway and still moving fast
 * when it lets go, it is as good as reaching the end.
 *
 * The knob is a real switch, so a keyboard (Enter or Space) or a screen
 * reader does the same thing in one press - sliding is for fingers.
 */
export function SlideToConfirm({ on, label, onLabel, disabled = false, working = false, onChange }: {
  /** Already done: the knob sits at the far end, and sliding back undoes it. */
  on: boolean;
  /** What sliding does, shown in the track: "Ready to dispatch all 3 orders". */
  label: string;
  /** The track once done: "Ready to dispatch". */
  onLabel: string;
  disabled?: boolean;
  /** This press is saving: the knob turns into a spinner until it lands. */
  working?: boolean;
  onChange: (on: boolean) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLButtonElement>(null);
  const start = useRef<{ x: number; from: number; at: number; lastX: number; lastT: number; v: number } | null>(null);
  /** Where the knob is while a finger holds it, in px from the left; null when let go. */
  const [drag, setDrag] = useState<number | null>(null);
  /** The end it was let go at, held until the saved state catches up. */
  const [settled, setSettled] = useState<boolean | null>(null);
  const [max, setMax] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (track.current && knob.current) setMax(Math.max(0, track.current.clientWidth - knob.current.offsetWidth - 8));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (observer && track.current) observer.observe(track.current);
    return () => observer?.disconnect();
  }, []);

  // The save landed (or failed and the busy spell ended): show what is true.
  useEffect(() => {
    if (!disabled) setSettled(null);
  }, [on, disabled]);

  const shown = settled ?? on;
  const x = drag ?? (shown ? max : 0);
  const share = max > 0 ? x / max : shown ? 1 : 0;

  function commit(next: boolean) {
    setSettled(next);
    onChange(next);
  }

  function down(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || max === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, from: shown ? max : 0, at: shown ? max : 0, lastX: event.clientX, lastT: event.timeStamp, v: 0 };
    setDrag(start.current.from);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const held = start.current;
    if (!held) return;
    // Speed in px/ms, smoothed so one jittery sample does not decide it.
    const dt = event.timeStamp - held.lastT;
    if (dt > 0) {
      held.v = 0.7 * ((event.clientX - held.lastX) / dt) + 0.3 * held.v;
      held.lastX = event.clientX;
      held.lastT = event.timeStamp;
    }
    held.at = Math.min(max, Math.max(0, held.from + event.clientX - held.x));
    setDrag(held.at);
  }

  function up(event: PointerEvent<HTMLButtonElement>) {
    const held = start.current;
    if (!held) return;
    // Where the finger is now, not where the last render drew it: a fast
    // flick can let go before React has painted its final move.
    const at = held.at;
    const moved = Math.abs(at - held.from);
    // A finger that stopped before letting go is not flicking.
    const v = event.timeStamp - held.lastT > 80 ? 0 : held.v;
    start.current = null;
    setDrag(null);
    // Past most of the way is a yes, and so is a fast flick past halfway
    // (0.3 px/ms - stricter than a sheet's dismiss, since this one clears
    // parcels). Anything less goes home.
    const flickOn = v > 0.3 && at >= max * 0.5;
    const flickOff = v < -0.3 && at <= max * 0.5;
    if (!shown && (at >= max * 0.85 || flickOn)) commit(true);
    else if (shown && (at <= max * 0.15 || flickOff)) commit(false);
    else if (moved < 4) knob.current?.focus();
  }

  /* A click with no pointer behind it (detail 0) is Enter, Space or a screen
     reader activating the knob: one press does it. A finger's tap does not -
     a finger slides. */
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (disabled || event.detail !== 0) return;
    commit(!shown);
  }

  return (
    <div ref={track} aria-busy={working}
      className={`slide${shown ? ' is-on' : ''}${drag !== null ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}${working ? ' is-working' : ''}`}>
      <span className="slide__fill" aria-hidden="true" style={{ '--fill': `calc(${x}px + 44px)` } as CSSProperties} />
      <span className="slide__label" aria-hidden="true" style={{ opacity: shown || working ? 1 : Math.max(0, 1 - share * 1.6) }}>
        {working ? 'Saving…' : shown ? `✓ ${onLabel}` : label}
      </span>
      {!shown && !working && <span className="slide__hint" aria-hidden="true">›››</span>}
      <button ref={knob} type="button" className="slide__knob" disabled={disabled}
        role="switch" aria-checked={shown}
        aria-label={shown ? `${onLabel}. Press to hold it back.` : `${label}. Press to confirm.`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click}>
        {working ? <Spinner size={18} label="Saving" /> : shown ? '✓' : '→'}
      </button>
    </div>
  );
}
