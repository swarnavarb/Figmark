/**
 * Which street the "Shops for you" band draws.
 *
 * - 'lite': the street that spares the battery. People, the dog and the gulls
 *   flip between drawn poses (work the graphics chip does) instead of swinging
 *   every limb on every frame, the sky moves a few times a second, the whole
 *   street rests a little while after it comes into view, and weaker phones,
 *   data savers and low batteries get a calmer street.
 * - 'classic': the street as it was first drawn, every limb animated.
 *
 * To swap for everybody, change STREET_DEFAULT. To compare on one device,
 * open any page with ?street=classic or ?street=lite: the choice is kept on
 * that device until another is picked.
 */
export type StreetMode = 'lite' | 'classic';

export const STREET_DEFAULT: StreetMode = 'lite';

const KEY = 'figmark.street';

function isMode(value: unknown): value is StreetMode {
  return value === 'lite' || value === 'classic';
}

let chosen: StreetMode | null = null;

export function streetMode(): StreetMode {
  if (chosen) return chosen;
  let mode: StreetMode = STREET_DEFAULT;
  try {
    const asked = new URLSearchParams(window.location.search).get('street');
    if (isMode(asked)) {
      localStorage.setItem(KEY, asked);
      mode = asked;
    } else {
      const kept = localStorage.getItem(KEY);
      if (isMode(kept)) mode = kept;
    }
  } catch {
    // No storage (a private window, blocked site data): the default it is.
  }
  chosen = mode;
  return mode;
}
