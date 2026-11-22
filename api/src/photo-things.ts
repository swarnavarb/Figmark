import type { RegionBox } from '../../shared/models.js';
import { MAX_THINGS, backdropBlobs, combineThings, sameness, shrinkPixels, type Thing } from '../../shared/photo-things.js';
import { detectItems, isolatedFingerprints, likeness, regionFingerprint } from './image-hash.js';
import type { Raw } from './storage/compress.js';
import { describeItems, visionAvailable, type PhotoDescription } from './vision.js';

/**
 * The things in a photo, on the server: the one place photo search and the
 * sell form both ask. See shared/photo-things.ts for the method; this adds
 * the server's own readers to what the phone found:
 *
 * - Claude, when it is on, naming each thing and every place it appears;
 * - whatever stands off the photo's backdrop, read from its pixels.
 */
export interface ServerThing extends Thing {
  /** What Claude read for it, for search; null when Claude did not name it. */
  description: PhotoDescription | null;
}

export async function thingsInPhoto(
  bytes: Uint8Array, contentType: string, raw: Raw | null, found: readonly RegionBox[] = [],
): Promise<{ things: ServerThing[]; descriptions: PhotoDescription[] | null }> {
  const read = visionAvailable() ? await describeItems(bytes, contentType) : null;
  const named = (read ?? []).filter((item) => (item.boxes?.length ?? 0) > 0 || item.box)
    .map((item) => ({ label: item.query || null, boxes: item.boxes?.length ? item.boxes : [item.box!], description: item }));
  const blobs: RegionBox[] = [];
  if (raw) {
    const small = shrinkPixels(raw.data, raw.width, raw.height);
    blobs.push(...backdropBlobs(small.data, small.width, small.height), ...detectItems(raw, MAX_THINGS));
  }
  const things = combineThings({ named, detected: [...found], blobs });
  return {
    things: things.map((thing) => ({
      ...thing,
      description: thing.source === 'named' ? named.find((entry) => entry.boxes[0] === thing.boxes[0])?.description ?? null : null,
    })),
    descriptions: read,
  };
}

/* ── Telling things apart ─────────────────────────────────────────────── */

/**
 * Whether two places in one photo show the same thing: nearly the same
 * place, or pictures so alike they are the same item seen twice. Strict, so
 * two different figures on one shelf - which share a backdrop, a scale and
 * often a colour - are never taken for one: on a shelf of fifty different
 * figures the closest two score 0.84, the same figure cropped twice 0.93.
 */
const SAME_SCORE = 0.88;
const SAME_LOOK = 0.8;

function printOf(raw: Raw, box: RegionBox): string | null {
  return isolatedFingerprints(raw, box, false)[0] ?? regionFingerprint(raw, box);
}

export function sameThing(raw: Raw, a: RegionBox, b: RegionBox, prints = new Map<RegionBox, string | null>()): boolean {
  if (sameness(a, b) >= 0.5) return true;
  const pa = prints.get(a) ?? printOf(raw, a); prints.set(a, pa);
  const pb = prints.get(b) ?? printOf(raw, b); prints.set(b, pb);
  if (!pa || !pb) return false;
  const alike = likeness(pa, pb);
  return Boolean(alike && alike.score >= SAME_SCORE && (alike.look ?? 0) >= SAME_LOOK);
}

/**
 * How many different things a set of places shows: places that are the same
 * thing are counted once. Used for the platform fee, so it decides from the
 * picture, never from what the seller grouped.
 */
export function distinctCount(raw: Raw | null, boxes: readonly RegionBox[]): number {
  if (!raw) {
    // Without the picture, only places that are plainly the same place merge.
    const kept: RegionBox[] = [];
    for (const box of boxes) if (!kept.some((other) => sameness(other, box) >= 0.5)) kept.push(box);
    return kept.length;
  }
  const prints = new Map<RegionBox, string | null>();
  const groups: RegionBox[][] = [];
  for (const box of boxes) {
    const home = groups.find((group) => group.some((other) => sameThing(raw, other, box, prints)));
    if (home) home.push(box); else groups.push([box]);
  }
  return groups.length;
}
