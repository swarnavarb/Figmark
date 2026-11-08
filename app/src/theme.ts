/**
 * Dark, light, or whichever the device is set to. Kept on this device only,
 * like the text size; public/boot/tone.js applies it before the first paint,
 * and this applies a change at once and follows the device while on auto.
 *
 * The page always carries the resolved theme in `data-theme` ("dark" or
 * "light"), so the stylesheet needs no media query of its own.
 */
export const THEMES = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export type Theme = (typeof THEMES)[number]['value'];

const KEY = 'figmark:theme';
const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'auto') return theme;
  return query?.matches ? 'light' : 'dark';
}

/** The theme in force now: what `data-theme` says. */
export function resolvedTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolve(theme));
  root.setAttribute('data-theme-choice', theme);
  window.dispatchEvent(new Event('figmark:theme'));
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Private browsing and the like: it holds for this visit.
  }
  apply(theme);
}

/** Follow the device's own setting while on auto. Call once at start-up. */
export function watchTheme(): void {
  apply(readTheme());
  query?.addEventListener('change', () => {
    if (readTheme() === 'auto') apply('auto');
  });
}
