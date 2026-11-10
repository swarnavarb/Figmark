import { useSyncExternalStore } from 'react';

/**
 * Full motion or reduced motion, for the whole app.
 *
 * Until the reader picks, it follows the phone's own "reduce motion" setting.
 * Once they flip the switch in the profile menu, their choice wins either way:
 * full motion even on a phone that asks for less, or reduced on one that
 * doesn't. Kept on this device only.
 *
 * The answer lives on <html data-motion="reduced|full">:
 * - Every `@media (prefers-reduced-motion: …)` block in the stylesheets is
 *   rewritten at build time to follow that attribute (vite.config.ts,
 *   motionFollowsChoice), so the stylesheets keep their usual shape.
 * - Script asks reducedMotion() instead of matchMedia.
 * - public/boot/tone.js sets it before the first paint. Keep the key in step.
 *
 * Reduced is also the lighter mode: besides stopping animations it turns off
 * the blurred glass behind bars and sheets (styles.css, "Reduced motion"),
 * which is some of the heaviest drawing a phone does while scrolling.
 */
export type MotionChoice = 'full' | 'reduced';

const KEY = 'figmark:motion';
const QUERY = '(prefers-reduced-motion: reduce)';
const listeners = new Set<() => void>();
/** The choice made this visit, for when storage is refused. */
let picked: MotionChoice | null = null;

function stored(): MotionChoice | null {
  if (picked) return picked;
  try {
    const value = localStorage.getItem(KEY);
    return value === 'full' || value === 'reduced' ? value : null;
  } catch {
    return null;
  }
}

function systemReduced(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(QUERY).matches);
}

function apply(): void {
  const reduced = (stored() ?? (systemReduced() ? 'reduced' : 'full')) === 'reduced';
  document.documentElement.setAttribute('data-motion', reduced ? 'reduced' : 'full');
  for (const listener of listeners) listener();
}

/** Is motion reduced right now: the reader's choice, or else the phone's. */
export function reducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  const set = document.documentElement.getAttribute('data-motion');
  if (set) return set === 'reduced';
  return (stored() ?? (systemReduced() ? 'reduced' : 'full')) === 'reduced';
}

export function setMotion(choice: MotionChoice): void {
  picked = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Private browsing and the like: it holds for this visit.
  }
  apply();
}

/** Called once at start: sets the attribute and follows the phone until the reader picks. */
export function watchMotion(): void {
  apply();
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener?.('change', () => { if (!stored()) apply(); });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** reducedMotion() for components that must change at once when the switch is flipped. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedMotion, () => false);
}
