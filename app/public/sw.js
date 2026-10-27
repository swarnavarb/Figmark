/*
 * Figmark's service worker: lock-screen notifications, and a page to show
 * when there is no connection.
 *
 * Still no page cache. The site is always loaded fresh from the network
 * exactly as before - a caching worker has its own way of serving yesterday's
 * site, and nothing here wants that. The one thing kept is offline.html: a
 * page load that cannot reach the network at all gets it, instead of the
 * browser's own error, and its button tries again.
 *
 * The message is what api/src/push.ts sends: { id, title, body, link, unread,
 * tag?, silent? }.
 */

const OFFLINE_CACHE = 'figmark-offline-v1';
const OFFLINE_PAGE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE)
    .then((cache) => cache.addAll([OFFLINE_PAGE, '/icons/icon-192.png']))
    .catch(() => undefined)
    .then(() => self.skipWaiting()));
});

/* Page loads only, and only when the network fails outright: an answer from
   the server, whatever its status, is always what is shown. Every other
   request - scripts, the API, photos - is left to the browser untouched. */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  event.respondWith(fetch(request).catch(async () => {
    const offline = await caches.match(OFFLINE_PAGE, { cacheName: OFFLINE_CACHE });
    return offline || Response.error();
  }));
});
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
    // One per notice: a repeat replaces rather than stacks. A folded one
    // ("Arjun sent you 3 messages") replaces its earlier line, and still
    // buzzes, because it is news.
    tag: message.tag || message.id || undefined,
    renotify: Boolean(message.tag),
    // Quiet hours: on the lock screen, without a sound.
    silent: Boolean(message.silent),
    data: { id: message.id || null, link: message.link || '/' },
  });

  const badge = typeof message.unread === 'number' && self.navigator.setAppBadge
    ? self.navigator.setAppBadge(message.unread).catch(() => undefined)
    : Promise.resolve();

  // An open copy of the site refreshes its bell now rather than at the next
  // poll, and the conversation or room the push points at, if it is open.
  const told = self.clients.matchAll({ type: 'window' }).then((windows) => {
    for (const client of windows) client.postMessage({ type: 'figmark:notification', link: message.link || null });
  });

  event.waitUntil(Promise.all([shown, badge, told]));
});

/* Where a tapped notification is going, for the page to pick up. One entry,
   read and deleted by the page; the only thing this worker ever stores. */
const HANDOFF_CACHE = 'figmark-open';
const HANDOFF_KEY = '/__figmark-open';

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { id, link } = event.notification.data || {};
  const path = typeof link === 'string' && link.startsWith('/') ? link : '/';
  const target = new URL(path, self.location.origin).href;

  // Tapping it is acting on it, which is when the bell counts it read. Not
  // waited on: getting to the page comes first.
  const read = id && !String(id).startsWith('tst_')
    ? fetch('/api/notifications/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => undefined)
    : Promise.resolve();

  event.waitUntil(Promise.all([read, (async () => {
    /* Left first, where the page looks whenever it comes to the front. An
       iPhone often shows the app before this worker has even run, so a page
       that checked on arriving and found nothing checks again a moment
       later; a page frozen in the background, or reloaded onto a newer
       version on the way, misses the message below but still finds this. */
    await caches.open(HANDOFF_CACHE)
      .then((cache) => cache.put(HANDOFF_KEY, new Response(JSON.stringify({ link: path, at: Date.now() }))))
      .catch(() => undefined);

    const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter((client) => new URL(client.url).origin === self.location.origin);
    if (windows.length === 0) {
      await self.clients.openWindow(target);
      return;
    }
    /* Already open (often just in the background, as a home-screen app is):
       bring it forward and tell it where to go. The page moves itself, in
       place, which works everywhere - unlike navigating the window from here,
       which iPhones refuse for a page this worker did not load. The one on
       screen is preferred; a copy left over in the background is not the one
       the person is looking at. */
    const open = windows.find((client) => client.focused)
      || windows.find((client) => client.visibilityState === 'visible')
      || windows[0];
    try {
      await open.focus();
    } catch {
      // Focus can be refused; the message still lands.
    }
    // Every copy is told; only one on screen answers, so a copy asleep in
    // the background cannot swallow the tap.
    const answered = new Promise((resolve) => {
      for (const client of windows) {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve(true);
        client.postMessage({ type: 'figmark:open', link: path }, [channel.port2]);
      }
      setTimeout(() => resolve(false), 2500);
    });
    if (await answered) return;
    if ('navigate' in open) {
      const moved = await open.navigate(target).catch(() => null);
      if (moved) return;
    }
    await self.clients.openWindow(target);
  })()]));
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
