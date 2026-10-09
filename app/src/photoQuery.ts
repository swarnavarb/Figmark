import { useSyncExternalStore } from 'react';

/**
 * The photo being searched with, held in memory and nowhere else.
 *
 * Not in the URL (it is far too big), and deliberately not in sessionStorage,
 * IndexedDB or the photo store: a search photo is the shopper's, used for one
 * search and gone when they clear it or close the tab. The catalogue's URL
 * carries only `?photo=<id>`, so back and forward still work, and a reload -
 * which forgets the photo - falls back to the ordinary catalogue.
 */
export interface PhotoQuery {
  id: string;
  /** The picture as compressed for sending, also used for the thumbnail. */
  dataUrl: string;
}

let current: PhotoQuery | null = null;
const listeners = new Set<() => void>();

export function setPhotoQuery(dataUrl: string): PhotoQuery {
  current = { id: Math.random().toString(36).slice(2, 10), dataUrl };
  listeners.forEach((listener) => listener());
  return current;
}

export function clearPhotoQuery(): void {
  current = null;
  listeners.forEach((listener) => listener());
}

/** The photo for this id, or null once it has been replaced, cleared or lost to a reload. */
export function usePhotoQuery(id: string): PhotoQuery | null {
  const photo = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return id && photo?.id === id ? photo : null;
}
