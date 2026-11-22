import type { PhotoBox, PhotoItem } from './api';

import { MAX_THINGS as SHARED_MAX, sameness, insideOf } from '@shared/photo-things';

/** At most this many things are offered for a search photo. */
export const MAX_THINGS = Math.min(20, SHARED_MAX);
const inside = insideOf;

/**
 * The things the phone found, then those the server found that the phone did
 * not - it sees what stands off a plain backdrop, which is how a shoe, a watch
 * or a ring is photographed, and the detector has no name for those. A thing
 * both found keeps the phone's box and takes the server's name for it.
 */
export function mergeItems(phone: PhotoItem[], server: PhotoItem[]): PhotoItem[] {
  if (server.length === 0) return phone;
  const same = (a: PhotoBox, b: PhotoBox) => sameness(a, b) >= 0.5 || inside(a, b) >= 0.8 || inside(b, a) >= 0.8;
  const named = phone.map((item) => ({
    ...item, label: item.label ?? server.find((other) => sameness(item.box, other.box) >= 0.8)?.label ?? null,
  }));
  const more = server.filter((item) => !phone.some((seen) => same(seen.box, item.box)));
  return [...named, ...more].slice(0, MAX_THINGS);
}
