import { useEffect, useRef, useState } from 'react';

/**
 * A slim bar when the connection drops, and a short "back online" when it
 * returns.
 *
 * On a phone moving between towers a request can fail for no reason the
 * screen shows; this says why before anyone presses a button and wonders.
 */
export function OfflineBar() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [back, setBack] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const down = () => {
      setOnline(false);
      setBack(false);
      if (timer.current) window.clearTimeout(timer.current);
    };
    const up = () => {
      setOnline(true);
      setBack(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setBack(false), 2600);
    };
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    return () => {
      window.removeEventListener('offline', down);
      window.removeEventListener('online', up);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  if (online && !back) return null;
  return (
    <div className={`offbar${online ? ' offbar--back' : ''}`} role="status" aria-live="polite">
      <span className="offbar__dot" aria-hidden="true" />
      {online ? 'Back online' : "You're offline · changes won't send yet"}
    </div>
  );
}
