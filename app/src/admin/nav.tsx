import { useEffect, useState } from 'react';

/**
 * Where the console is: the tab, and any screen opened inside it, kept in the
 * address's hash ("#routes/common") so the phone's own back button, the
 * browser's, and the console's ← Back all step back the same way.
 */

const CHANGED = 'figmark:ops-nav';

function read(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  } catch {
    return '';
  }
}

/** How many screens deep this visit is, as the history entries say. */
function depth(): number {
  const state = window.history.state as { opsDepth?: number } | null;
  return typeof state?.opsDepth === 'number' ? state.opsDepth : 0;
}

export function useOpsPath(): { path: string; depth: number } {
  const [now, setNow] = useState(() => ({ path: read(), depth: depth() }));
  useEffect(() => {
    const on = () => setNow({ path: read(), depth: depth() });
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    window.addEventListener(CHANGED, on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
      window.removeEventListener(CHANGED, on);
    };
  }, []);
  return now;
}

/** Open a screen, one step deeper. */
export function goOps(path: string): void {
  if (read() === path) return;
  window.history.pushState({ opsDepth: depth() + 1 }, '', `#${path}`);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(CHANGED));
}

/** One step back: the screen before, or `fallback` when this visit started here. */
export function backOps(fallback: string): void {
  if (depth() > 0) {
    window.history.back();
    return;
  }
  window.history.replaceState({ opsDepth: 0 }, '', `#${fallback}`);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(CHANGED));
}

/** The ← Back at the top of every screen inside the console. */
export function BackButton({ to, label = 'Back' }: { to: string; label?: string }) {
  return (
    <button type="button" className="opsback" onClick={() => backOps(to)}>
      <span aria-hidden="true">←</span> {label}
    </button>
  );
}
