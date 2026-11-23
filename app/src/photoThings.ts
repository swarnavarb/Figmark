import type { PhotoBox } from './api';

import { MAX_THINGS, readingOrder, sameness } from '@shared/photo-things';

export { MAX_THINGS };

/** A thing found in a photo: every place it appears, and its name when the server read one. */
export interface FoundThing {
  label: string | null;
  boxes: PhotoBox[];
}

/**
 * The one way the server's reading of a photo and the phone's are put
 * together, for photo search and the sell form alike, so the same photo shows
 * the same things in both. The server's come first - it knows names and
 * which boxes are one thing - then whatever the phone found where the server
 * found nothing; read top row first, left to right.
 */
export function mergeThings(server: FoundThing[], phone: PhotoBox[], max = MAX_THINGS): FoundThing[] {
  const found: FoundThing[] = server.filter((thing) => thing.boxes.length > 0).map((thing) => ({ label: thing.label, boxes: thing.boxes }));
  for (const box of phone) {
    if (!found.some((thing) => thing.boxes.some((known) => sameness(known, box) >= 0.45))) found.push({ label: null, boxes: [box] });
  }
  return found.sort(readingOrder).slice(0, max);
}
