/**
 * Whether this browser has been through the welcome slides.
 *
 * A first-time visitor lands on /welcome: the slides, then Google, WhatsApp,
 * Aadhaar and the profile. Once they have seen the slides, coming back to sign
 * in shows only the sign-in step - nobody wants the pitch twice. Kept in
 * localStorage so it outlives the tab; a private window that refuses storage
 * simply sees the slides again.
 */
const SEEN_KEY = 'figmark.onboarded';
const DRAFT_KEY = 'figmark.welcome.draft';

export function hasOnboarded(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboarded(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage refused: the slides come back next visit, nothing breaks */
  }
}

/** Where somebody got to in the sign-up steps, so leaving halfway resumes there. */
export function readWelcomeDraft<T>(): T | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveWelcomeDraft(draft: unknown): void {
  try {
    if (draft === null) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* best effort */
  }
}
