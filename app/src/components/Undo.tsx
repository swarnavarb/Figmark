import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/**
 * The bar that lets a step forward be taken back.
 *
 * Every move of a lot, move of an item and button press can be undone for
 * three minutes; until then it is not on any timeline and its buyers have not
 * been told. This is the seller's side of that: one bar above the tab bar,
 * counting down, with one button. It lives above the routes so it survives
 * moving between screens, and a newer action replaces an older one - only the
 * last thing done is offered, which is the one a slip of the thumb was.
 */
export interface UndoRequest {
  /** What was done, in a few words: "Lot 24 moved to Customs". */
  label: string;
  /** When the server stops accepting the undo. */
  until: string;
  /** Takes it back. Throwing keeps the bar and shows why. */
  undo: () => Promise<void>;
  /** Called once it has been taken back, to refresh whatever showed it. */
  onUndone?: () => void;
}

const UndoContext = createContext<(request: UndoRequest) => void>(() => {});

/** Offer the last thing done for undoing. */
export function useUndo() {
  return useContext(UndoContext);
}

export function UndoHost({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<UndoRequest | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const offer = useCallback((request: UndoRequest) => {
    setFailed(null);
    setNow(Date.now());
    setCurrent(request);
  }, []);

  const left = current ? Date.parse(current.until) - now : 0;
  useEffect(() => {
    if (!current) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [current]);
  // Gone once the window closes: from then on it is on the timeline.
  useEffect(() => {
    if (current && left <= 0) setCurrent(null);
  }, [current, left]);

  async function run() {
    if (!current) return;
    setBusy(true);
    setFailed(null);
    try {
      await current.undo();
      current.onUndone?.();
      setCurrent(null);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not undo that.');
    } finally {
      setBusy(false);
    }
  }

  const value = useMemo(() => offer, [offer]);
  const seconds = Math.max(0, Math.ceil(left / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <UndoContext.Provider value={value}>
      {children}
      {current && createPortal(
        <div className="undobar" role="status" aria-live="polite">
          <span className="undobar__ring" aria-hidden="true"
            style={{ ['--left' as string]: `${Math.max(0, Math.min(1, left / (3 * 60 * 1000))) * 360}deg` }} />
          <span className="undobar__text">
            <b>{current.label}</b>
            <span>{failed ?? `Buyers see it in ${clock} — until then you can take it back.`}</span>
          </span>
          <button type="button" className="undobar__btn" disabled={busy} onClick={() => void run()}>
            {busy ? 'Undoing…' : 'Undo'}
          </button>
          <button type="button" className="undobar__x" aria-label="Keep it" onClick={() => setCurrent(null)}>
            <Icon name="close" size={13} />
          </button>
        </div>,
        document.body,
      )}
    </UndoContext.Provider>
  );
}
