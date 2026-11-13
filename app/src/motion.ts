import { useSyncExternalStore } from 'react';

/**
 * Full motion or reduced motion, for the whole app.
 *
 * Signed out, it always follows the phone's own "reduce motion" setting.
 * Signed in, it follows the phone too until that account flips the switch in
 * the profile menu; from then on the account's choice wins either way: full
 * motion even on a phone that asks for less, or reduced on one that doesn't.
 * The choice is kept per account on this device, so an account signing in
 * here for the first time starts from the phone's setting, and signing out
 * hands the device back to the phone.
 *
 * Two keys in storage:
 * - `figmark:motion:<account id>` - each account's own choice on this device.
 * - `figmark:motion` - the choice in force right now, set only while an
 *   account with a choice is signed in. public/boot/tone.js reads this one
 *   before the first paint, since the session isn't known by then.
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
const accountKey = (id: string): string => `${KEY}:${id}`;
const QUERY = '(prefers-reduced-motion: reduce)';
const listeners = new Set<() => void>();
/** The choice made this visit, for when storage is refused. */
let picked: MotionChoice | null = null;
/** The signed-in account, or null when nobody is (or before the session is known). */
let account: string | null = null;

function valid(value: string | null): MotionChoice | null {
  return value === 'full' || value === 'reduced' ? value : null;
}

function stored(): MotionChoice | null {
  if (picked) return picked;
  try {
    return valid(localStorage.getItem(KEY));
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
  // Signed out, nothing is kept: the next visit follows the phone again.
  if (account) {
    try {
      localStorage.setItem(accountKey(account), choice);
      localStorage.setItem(KEY, choice);
    } catch {
      // Private browsing and the like: it holds for this visit.
    }
  }
  apply();
}

/**
 * Called by the session once it knows who is signed in, and again on every
 * sign-in and sign-out. Puts that account's own choice in force, or the
 * phone's setting when the account hasn't picked or nobody is signed in.
 */
export function motionFollowsAccount(id: string | null): void {
  account = id;
  picked = null;
  try {
    const choice = id ? valid(localStorage.getItem(accountKey(id))) : null;
    if (choice) localStorage.setItem(KEY, choice);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage refused: the phone decides.
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
