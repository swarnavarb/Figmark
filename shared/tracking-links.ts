/**
 * Where "see the current status" goes, for a courier and an AWB/tracking
 * number, until a live carrier API is connected (see
 * `api/src/tracking/provider.ts`).
 *
 * Deep-linking straight into a courier's own tracking page would need that
 * courier's exact, current URL format verified against the real site - not
 * something this environment can check, and a wrong guess is a broken link
 * shown to a buyer. A search is never wrong: every major courier's tracking
 * page ranks first for "<courier> tracking <number>", domestic or
 * international, so this works the same way for all of them without
 * assuming any one site's format.
 */
export function trackingSearchUrl(shipper: string, trackingId: string): string {
  const query = `${shipper.trim()} tracking ${trackingId.trim()}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
