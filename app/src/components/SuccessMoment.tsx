import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../haptics';
import { useDialog } from './ui';
import { Confetti } from './Confetti';

/**
 * The beat after something that mattered went through: an order placed, an
 * item live, a delivery confirmed.
 *
 * Those moments used to end in a quiet reload - the page changed and nothing
 * said the thing had happened, at exactly the point a buyer or seller most
 * wants to hear it. This is one large, drawn tick, what happens next in one
 * line, and one thing to do now.
 *
 * `pending` is for something sent but not yet confirmed - a payment the
 * buyer says they made directly. It draws an hourglass, never the tick: the
 * tick would say a payment had been confirmed when nobody has confirmed it.
 *
 * With reduced motion the finished mark is shown at once and nothing moves.
 */
export type MomentTone = 'success' | 'pending';

export interface MomentAction {
  label: string;
  onClick: () => void;
}

export function SuccessMoment({ tone = 'success', title, body, detail, primary, secondary, confetti = false, onClose }: {
  tone?: MomentTone;
  title: string;
  body?: ReactNode;
  /** A short highlighted line under the title: an amount, an item name. */
  detail?: ReactNode;
  primary?: MomentAction;
  secondary?: MomentAction;
  /** Confetti too - kept for firsts, so it stays worth something. */
  confetti?: boolean;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);

  // The confetti goes off as the tick lands, not before it is drawn.
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    haptic(tone === 'success' ? 'success' : 'tap');
    if (!confetti) return;
    const timer = window.setTimeout(() => setBurst(true), 760);
    return () => window.clearTimeout(timer);
  }, [tone, confetti]);

  return createPortal(
    <div className="smo" role="dialog" aria-modal="true" aria-label={title}
      onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`smo__card smo__card--${tone}`} ref={box} tabIndex={-1}>
        {burst && <Confetti run={1} />}
        <MomentMark tone={tone} />
        <h2 className="smo__title">{title}</h2>
        {detail && <p className="smo__detail">{detail}</p>}
        {body && <p className="smo__body">{body}</p>}
        <div className="smo__actions">
          <button type="button" className="btn btn--lg btn--block"
            onClick={() => { (primary?.onClick ?? onClose)(); if (primary) onClose(); }}>
            {primary?.label ?? 'Done'}
          </button>
          {secondary && (
            <button type="button" className="btn btn--quiet btn--block"
              onClick={() => { secondary.onClick(); onClose(); }}>
              {secondary.label}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The drawn mark: a ring that closes, then a tick (or an hourglass) drawn in. */
export function MomentMark({ tone = 'success', size = 112 }: { tone?: MomentTone; size?: number }) {
  return (
    <span className={`smark smark--${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="smark__burst" />
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle className="smark__disc" cx="50" cy="50" r="44" />
        <circle className="smark__ring" cx="50" cy="50" r="44" pathLength={100} />
        {tone === 'success' ? (
          <path className="smark__tick" d="M30 52 l14 14 l27 -30" pathLength={100} />
        ) : (
          <g>
            <path className="smark__tick" d="M36 28 h28 M36 72 h28 M39 28 c0 14 22 16 22 22 c0 6 -22 8 -22 22 M61 28 c0 14 -22 16 -22 22 c0 6 22 8 22 22" pathLength={100} />
            <path className="smark__sand" d="M44 66 h12 l-6 -6 z" />
          </g>
        )}
      </svg>
    </span>
  );
}

/**
 * True the first time `key` is asked about on this device, false after.
 * For "your first sale" and the like, where confetti is earned once.
 */
export function firstTime(key: string): boolean {
  try {
    const name = `fm:first:${key}`;
    if (localStorage.getItem(name)) return false;
    localStorage.setItem(name, '1');
    return true;
  } catch {
    return false;
  }
}
