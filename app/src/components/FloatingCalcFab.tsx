import { Suspense, lazy, useEffect, useState } from 'react';
import { CalcIcon } from './CalcIcon';

/**
 * The floating calculator button, mounted on every screen.
 *
 * Only the button lives here. The calculator itself - the profit engine and
 * the cost sheet - is fetched the first time it is opened, so a screen that
 * never opens it does not wait for it to download.
 */
const QuickCalc = lazy(() => import('./FloatingCalc').then((module) => ({ default: module.QuickCalc })));

const FLOAT_KEY = 'figmark:float-calc';
const FLOAT_EVENT = 'figmark:float-calc';

function readFloating() {
  try {
    return localStorage.getItem(FLOAT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the floating button is on, on this device. */
export function useFloatingCalc(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readFloating);
  useEffect(() => {
    const sync = () => setOn(readFloating());
    window.addEventListener(FLOAT_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(FLOAT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const set = (next: boolean) => {
    try {
      localStorage.setItem(FLOAT_KEY, next ? '1' : '0');
    } catch {
      /* A private window: it lasts for this page only. */
    }
    setOn(next);
    window.dispatchEvent(new Event(FLOAT_EVENT));
  };
  return [on, set];
}

/** The button and the calculator it opens. Mounted once, in the app shell. */
export function FloatingCalc() {
  const [on] = useFloatingCalc();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    // The sheet folds back into the button before it goes.
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, 220);
  }

  if (!on) return null;
  return (
    <>
      <button type="button" className={`fcalc__fab${open ? ' is-open' : ''}`} aria-label={open ? 'Close the calculator' : 'Open the calculator'}
        aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <CalcIcon size={22} open={open} />
      </button>
      {open && (
        <div className={`fcalc${closing ? ' is-closing' : ''}`}>
          <button type="button" className="fcalc__scrim" aria-label="Close the calculator" onClick={close} />
          <section className="fcalc__sheet prozone" role="dialog" aria-modal="true" aria-label="Profit calculator">
            <Suspense fallback={<p className="muted">Loading…</p>}>
              <QuickCalc onLeave={close} />
            </Suspense>
          </section>
        </div>
      )}
    </>
  );
}

