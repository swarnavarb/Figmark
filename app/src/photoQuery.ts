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
  /**
   * The picture as it was taken, as a blob: URL on this device only, for
   * finding the things in it at full quality. Never sent anywhere; released
   * when the photo is replaced or cleared.
   */
  original?: string;
}

let current: PhotoQuery | null = null;
const listeners = new Set<() => void>();

export function setPhotoQuery(dataUrl: string, original?: Blob): PhotoQuery {
  release();
  current = { id: Math.random().toString(36).slice(2, 10), dataUrl, original: original ? URL.createObjectURL(original) : undefined };
  listeners.forEach((listener) => listener());
  return current;
}

/** Let go of the full-quality copy held for the photo searched with. */
function release(): void {
  if (current?.original) URL.revokeObjectURL(current.original);
}

export function clearPhotoQuery(): void {
  release();
  current = null;
  listeners.forEach((listener) => listener());
}

/** Whether any photo is held at all: none after a reload. */
export function holdsPhotoQuery(): boolean {
  return current !== null;
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
