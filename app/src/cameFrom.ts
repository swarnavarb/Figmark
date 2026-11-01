import type { ViewSource } from '@shared/seller-data';

/**
 * Where the reader was before this screen, for counting where an item's views
 * come from. The shell writes the path after each screen has drawn - React
 * runs a child's effects before its parent's - so while a new screen loads,
 * `previous()` is still the screen they left.
 */
let last: { path: string; search: string } | null = null;

export function notePath(path: string, search: string): void {
  last = { path, search };
}

/** Where a view of an item came from, said in the words the API counts. */
export function viewSourceFor(params: URLSearchParams): ViewSource {
  if (params.get('ref')) return 'affiliate';
  if (params.get('via') || params.get('post')) return params.get('post') ? 'channel' : 'share';
  if (!last) {
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      return referrer && referrer.host !== window.location.host ? 'external' : 'direct';
    } catch {
      return 'direct';
    }
  }
  const { path, search } = last;
  if (path === '/') return new URLSearchParams(search).get('q') ? 'search' : 'feed';
  if (path.startsWith('/discover') || path.startsWith('/tags/')) return 'discover';
  if (path.startsWith('/listing/')) return 'similar';
  if (path.startsWith('/social') || path.startsWith('/s/x/')) return 'channel';
  if (path.startsWith('/s/') || path.startsWith('/r/') || path.startsWith('/i/')) return 'share';
  if (path.startsWith('/messages')) return 'messages';
  if (path.startsWith('/me') || path.startsWith('/cart')) return 'saved';
  if (path.startsWith('/purchases') || path.startsWith('/order/')) return 'orders';
  if (path.startsWith('/wanted')) return 'wanted';
  // A shop's page lives at its handle: one segment that is not a known screen.
  const known = /^\/(sell|shop|lot|lots|batches|routes|services|community-service|forwarders|verify|buyer-settings|wallet|refunds|disputes|quests|learn|legal|dispute)(\/|$)/;
  if (/^\/[^/]+\/?$/.test(path) && !known.test(path)) return 'shop';
  return 'other';
}
