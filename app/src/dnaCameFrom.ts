/**
 * The listing a reader was just on - its page, or the Product DNA button on
 * its photo - so that product's page asks about that item first.
 */
const CAME_FROM = 'figmark.dnaCameFrom';

export function cameFromListing(listingId: string): void {
  try { sessionStorage.setItem(CAME_FROM, listingId); } catch { /* asked about another */ }
}

export function listingCameFrom(): string | null {
  try { return sessionStorage.getItem(CAME_FROM); } catch { return null; }
}
