import { useEffect, useRef, useState } from 'react';
import { isInstalled } from '../device';
import { haptic } from '../haptics';

/**
 * Pull down at the top of the page to reload it, with a tick when it catches.
 *
 * Only on the home-screen copy: a browser tab already has its own pull to
 * refresh, and two would fight. The home-screen copy has none, so without
 * this the only way to see something new was to close the app.
 *
 * It only starts on the page itself, at the very top. A pull that begins in
 * something that scrolls on its own - a chat, a sheet, a carousel - belongs to
 * that thing, and an open dialog is left alone.
 */

/** How far the finger travels for each pixel the indicator moves. */
const RESISTANCE = 0.5;
/** Indicator travel at which letting go refreshes. */
const THRESHOLD = 64;
const MAX_PULL = 110;

function scrollsOnItsOwn(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.matches('input, textarea, select, [contenteditable="true"], [data-no-pull]')) return true;
    const style = getComputedStyle(node);
    const scrollable = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if (scrollable) return true;
    node = node.parentElement;
  }
  return false;
}

function dialogOpen(): boolean {
  return document.querySelector('[aria-modal="true"], .pushguide') !== null;
}

export function PullToRefresh() {
  const [enabled] = useState(() => isInstalled());
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ y: number; x: number } | null>(null);
  const caught = useRef(false);
  const current = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    // No rubber band at the top of the home-screen copy: the indicator is the bounce.
    document.documentElement.classList.add('is-installed');

    const onStart = (event: TouchEvent) => {
      if (refreshing || event.touches.length !== 1 || window.scrollY > 0) return;
      if (dialogOpen() || scrollsOnItsOwn(event.target)) return;
      const touch = event.touches[0]!;
      start.current = { y: touch.clientY, x: touch.clientX };
      caught.current = false;
    };

    const onMove = (event: TouchEvent) => {
      if (!start.current) return;
      const touch = event.touches[0]!;
      const dy = touch.clientY - start.current.y;
      const dx = Math.abs(touch.clientX - start.current.x);
      // Sideways or upwards is somebody scrolling or swiping, not pulling.
      if (dy <= 0 || (current.current === 0 && dx > dy)) {
        if (current.current !== 0) { current.current = 0; setPull(0); }
        if (dy < 0) start.current = null;
        return;
      }
      if (window.scrollY > 0) { start.current = null; current.current = 0; setPull(0); return; }
      const distance = Math.min(MAX_PULL, dy * RESISTANCE);
      current.current = distance;
      setPull(distance);
      if (!caught.current && distance >= THRESHOLD) {
        caught.current = true;
        haptic();
      } else if (caught.current && distance < THRESHOLD) {
        caught.current = false;
      }
    };

    const onEnd = () => {
      if (!start.current) return;
      start.current = null;
      if (current.current >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        // Long enough to see it catch, then the page comes back fresh.
        window.setTimeout(() => window.location.reload(), 250);
      } else {
        setPull(0);
      }
      current.current = 0;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, refreshing]);

  if (!enabled || (pull === 0 && !refreshing)) return null;

  const progress = Math.min(1, pull / THRESHOLD);
  return (
    <div className={`ptr${refreshing ? ' is-refreshing' : ''}${progress >= 1 ? ' is-caught' : ''}`}
      style={{ transform: `translate(-50%, ${pull}px)` }} role="status" aria-live="polite">
      <svg viewBox="0 0 24 24" className="ptr__icon" style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
        aria-hidden="true">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="ptr__label">{refreshing ? 'Refreshing' : progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}</span>
    </div>
  );
}
