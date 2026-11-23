import type { PhotoBox } from './api';

import { MAX_THINGS, insideOf, readingOrder, sameness } from '@shared/photo-things';

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

/**
 * The things an AI scan found laid over the reading already made: the scan's
 * first, then any earlier find that is neither one of them nor a part of one -
 * a figure seen through a package's window, half a box - so what the AI
 * missed is kept and what it saw better is replaced.
 */
export function overlayScan<T extends { boxes: PhotoBox[] }>(scanned: T[], earlier: T[]): T[] {
  const covered = (boxes: PhotoBox[]) => boxes.some((box) => scanned.some((thing) => thing.boxes.some((known) =>
    sameness(known, box) >= 0.45 || insideOf(box, known) >= 0.6)));
  return [...scanned, ...earlier.filter((thing) => !covered(thing.boxes))];
}
