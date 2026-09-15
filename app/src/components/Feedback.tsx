import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/* ── Skeletons ───────────────────────────────────────────────────────────── */

/**
 * A placeholder shaped like the thing that is coming.
 *
 * The app said the word "Loading" in forty-five places and then reflowed the
 * page when the data landed. A skeleton costs the same and does two things
 * that text cannot: it reserves the height, so nothing jumps, and it tells you
 * what shape to expect while you wait.
 *
 * Deliberately not a spinner. A spinner says "something is happening"; a
 * skeleton says "a list of cards is happening", which is more information for
 * the same pixels.
 */
export function Skeleton({ w, h = 12, radius, className }: {
  w?: number | string;
  h?: number | string;
  radius?: number | string;
  className?: string;
}) {
  return (
    <span
      className={`skel${className ? ` ${className}` : ''}`}
      style={{ width: w, height: h, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** A few lines of text that has not arrived. Widths vary so it reads as prose. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  const widths = ['92%', '78%', '85%', '64%', '88%'];
  return (
    <span className="skel-stack" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} w={widths[i % widths.length]} h={11} />
      ))}
    </span>
  );
}

/** The catalogue while it loads: the grid it is about to be. */
export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid" role="status" aria-label="Loading items">
      {Array.from({ length: count }, (_, i) => (
        <div className="card skel-card" key={i}>
          <Skeleton className="skel-thumb" h="" radius={0} />
          <div className="skel-card__body">
            <Skeleton w="88%" h={12} />
            <Skeleton w="42%" h={15} />
            <Skeleton w="64%" h={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A list of rows while it loads. */
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="skel-rows" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-row" key={i}>
          <Skeleton w={30} h={30} radius={999} />
          <span className="skel-stack">
            <Skeleton w="54%" h={11} />
            <Skeleton w="32%" h={9} />
          </span>
          <Skeleton w={54} h={11} />
        </div>
      ))}
    </div>
  );
}

/* ── Toasts ──────────────────────────────────────────────────────────────── */

export type ToastTone = 'ok' | 'error' | 'info';
interface Toast { id: number; tone: ToastTone; text: string }

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => {});

/** Say so when something worked. */
export function useToast() {
  return useContext(ToastContext);
}

const LIFETIME = 4200;

/**
 * Confirmations.
 *
 * Every mutation in this app succeeded silently: you pressed the button, the
 * page quietly agreed with you, and nothing said the thing had happened. The
 * toast is the smallest fix for that, and it is deliberately a portal at the
 * document root for the same reason the modal is - `.tab-view` is animated and
 * creates a stacking context, so anything fixed inside it is fixed to the tab
 * rather than to the window.
 */
export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  const push = useCallback((text: string, tone: ToastTone = 'ok') => {
    seq.current += 1;
    const id = seq.current;
    setToasts((current) => [...current, { id, tone, text }]);
    const timer = window.setTimeout(
      () => setToasts((current) => current.filter((entry) => entry.id !== id)),
      LIFETIME,
    );
    timers.current.push(timer);
  }, []);

  // Every pending timer is cleared on unmount, so a toast raised on the way
  // out cannot set state on a component that is gone.
  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast--${toast.tone}`}>
              <Icon name={toast.tone === 'error' ? 'close' : toast.tone === 'info' ? 'bell' : 'check'} size={15} />
              <span>{toast.text}</span>
              <button
                type="button"
                className="toast__x"
                aria-label="Dismiss"
                onClick={() => setToasts((current) => current.filter((e) => e.id !== toast.id))}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
