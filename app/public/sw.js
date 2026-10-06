/*
 * Figmark's service worker: lock-screen notifications, and nothing else.
 *
 * Deliberately no fetch handler and no cache. The site is always loaded fresh
 * from the network exactly as before; this file only wakes when a push
 * arrives or a notification is tapped. A caching worker is a different piece
 * of work with its own way of serving yesterday's site, and nothing here
 * needs it.
 *
 * The message is what api/src/push.ts sends: { id, title, body, link, unread }.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }

  const title = message.title || 'Figmark';
  const shown = self.registration.showNotification(title, {
    body: message.body || '',
    icon: '/icons/icon-192.png',
    // The small monochrome glyph Android puts in the status bar.
    badge: '/icons/badge-72.png',
    // One per notice: a repeat replaces rather than stacks.
    tag: message.id || undefined,
    data: { id: message.id || null, link: message.link || '/' },
  });

  const badge = typeof message.unread === 'number' && self.navigator.setAppBadge
    ? self.navigator.setAppBadge(message.unread).catch(() => undefined)
    : Promise.resolve();

  // An open copy of the site refreshes its bell now rather than at the next poll.
  const told = self.clients.matchAll({ type: 'window' }).then((windows) => {
    for (const client of windows) client.postMessage({ type: 'figmark:notification' });
  });

  event.waitUntil(Promise.all([shown, badge, told]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { id, link } = event.notification.data || {};
  const target = new URL(link || '/', self.location.origin).href;

  event.waitUntil((async () => {
    // Tapping it is acting on it, which is when the bell counts it read.
    if (id && !String(id).startsWith('tst_')) {
      await fetch('/api/notifications/read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => undefined);
    }

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if ('navigate' in open) {
        await open.navigate(target).catch(() => open.postMessage({ type: 'figmark:open', link }));
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});

/*
 * The browser replaced the subscription (it does, now and then). Hand the new
 * one to the account straight away, with the old key, so the next notice
 * still arrives. If this fails, the bell re-syncs on the next visit.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const options = event.oldSubscription ? event.oldSubscription.options : null;
    const subscription = event.newSubscription
      || (options ? await self.registration.pushManager.subscribe(options) : null);
    if (!subscription) return;
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    });
  })().catch(() => undefined));
});
