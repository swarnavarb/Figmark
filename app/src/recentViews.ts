import { useEffect, useState } from 'react';

/**
 * What this device looked at and searched for lately.
 *
 * Kept on the device only: it is a convenience for picking up where somebody
 * left off, not a record anybody else reads. Storage can be missing (a private
 * window, blocked site data), so every read and write is allowed to fail and
 * the page simply shows nothing.
 */

export interface Viewed {
  id: string;
  title: string;
  priceMinor: number;
  currency: string;
  photo: string | null;
  at: number;
}

const VIEWED_KEY = 'figmark.viewed.v1';
const SEARCHES_KEY = 'figmark.searches.v1';
const VIEWED_MAX = 12;
const SEARCHES_MAX = 6;
const CHANGED = 'figmark:recent';

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(list) ? list as T[] : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* No storage: nothing is remembered, and nothing breaks. */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** An item opened: first in the list, once. */
export function rememberViewed(item: Omit<Viewed, 'at'>) {
  const rest = read<Viewed>(VIEWED_KEY).filter((entry) => entry.id !== item.id);
  write(VIEWED_KEY, [{ ...item, at: Date.now() }, ...rest].slice(0, VIEWED_MAX));
}

export function forgetViewed() {
  write<Viewed>(VIEWED_KEY, []);
}

/** A search run: first in the list, once, whatever its letter case was. */
export function rememberSearch(term: string) {
  const clean = term.trim();
  if (clean.length < 2) return;
  const rest = read<string>(SEARCHES_KEY).filter((entry) => entry.toLowerCase() !== clean.toLowerCase());
  write(SEARCHES_KEY, [clean, ...rest].slice(0, SEARCHES_MAX));
}

export function forgetSearch(term?: string) {
  write(SEARCHES_KEY, term === undefined ? [] : read<string>(SEARCHES_KEY).filter((entry) => entry !== term));
}

/** A list kept in step with storage: this tab's writes and other tabs' alike. */
function useStored<T>(key: string): T[] {
  const [list, setList] = useState<T[]>(() => read<T>(key));
  useEffect(() => {
    const reload = () => setList(read<T>(key));
    window.addEventListener(CHANGED, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(CHANGED, reload);
      window.removeEventListener('storage', reload);
    };
  }, [key]);
  return list;
}

export const useRecentlyViewed = () => useStored<Viewed>(VIEWED_KEY);
export const useRecentSearches = () => useStored<string>(SEARCHES_KEY);
