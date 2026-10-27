/**
 * How big the reader wants text: the whole type scale grows with it (see
 * --text-scale in styles.css). Kept on this device only; public/boot/tone.js
 * applies it before the first paint, and this applies a change at once.
 */
export const TEXT_SIZES = [
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
] as const;

export type TextSize = (typeof TEXT_SIZES)[number]['value'];

const KEY = 'figmark:text-size';

export function readTextSize(): TextSize {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'large' || stored === 'larger' ? stored : 'default';
  } catch {
    return 'default';
  }
}

export function setTextSize(size: TextSize): void {
  if (size === 'default') document.documentElement.removeAttribute('data-text-size');
  else document.documentElement.setAttribute('data-text-size', size);
  try {
    if (size === 'default') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, size);
  } catch {
    // Private browsing and the like: it holds for this visit.
  }
}
