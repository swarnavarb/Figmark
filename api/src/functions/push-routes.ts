import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { PushEndpoint } from '../../../shared/models.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { forgetEndpoints, pushKeys, pushToUser, sendHeldPushes } from '../push.js';
import { tooFast } from '../rate-limit.js';
import { error, handler, json } from './http.js';

/**
 * Turning lock-screen notifications on and off, one device at a time.
 *
 * The device asks the browser for a subscription with the public key from
 * here, then hands the subscription back to be kept on the account. Sending is
 * push.ts; this is only the list of where to send.
 */

/** A person rarely has more; past this the oldest device is dropped. */
const MAX_DEVICES = 10;

/** GET /api/push/key - the public key, or null when push is not set up here. */
async function key(_request: HttpRequest, _context: InvocationContext) {
  return json(200, { publicKey: pushKeys()?.publicKey ?? null });
}

/** A short name for the device, from its user agent. For telling them apart, nothing more. */
function deviceName(agent: string): string {
  const os = /iPhone|iPad/.test(agent) ? (agent.includes('iPad') ? 'iPad' : 'iPhone')
    : /Android/.test(agent) ? 'Android'
    : /Macintosh/.test(agent) ? 'Mac'
    : /Windows/.test(agent) ? 'Windows'
    : /Linux/.test(agent) ? 'Linux'
    : 'Device';
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /Firefox\//.test(agent) ? 'Firefox'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : '';
  return browser ? `${os} · ${browser}` : os;
}

/** Where Chrome, Firefox, Safari and Edge keep their push services. */
const PUSH_SERVICES = [
  'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com',
  'push.apple.com', 'notify.windows.com',
];

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** The subscription as the browser serialises it, or why it is not one. */
function readSubscription(body: unknown): { endpoint: string; keys: PushEndpoint['keys'] } | string {
  const value = (body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof value.endpoint === 'string' ? value.endpoint : '';
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'That is not a push subscription.';
  }
  // Only the browsers' own push services. Anything else is somebody trying to
  // make this server send requests wherever they choose.
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || endpoint.length > 1024
    || !PUSH_SERVICES.some((service) => host === service || host.endsWith(`.${service}`))) {
    return 'That is not a push subscription.';
  }
  const p256dh = value.keys?.p256dh;
  const auth = value.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string'
    || !BASE64URL.test(p256dh) || !BASE64URL.test(auth) || p256dh.length > 200 || auth.length > 100) {
    return 'That is not a push subscription.';
  }
  return { endpoint, keys: { p256dh, auth } };
}

/**
 * POST /api/push/subscribe - send this device my notifications.
 *
 * A browser belongs to whoever signed in on it last: if the same subscription
 * is on another account (somebody else used this phone and never signed out),
 * it comes off theirs, so their news stops landing on a stranger's screen.
 */
async function subscribe(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  if (!pushKeys()) return error(409, 'push_off', 'Notifications are not set up on this site yet.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const subscription = readSubscription(body);
  if (typeof subscription === 'string') return error(400, 'invalid_subscription', subscription);

  const previous = await repository.listUsersByPushEndpoint(subscription.endpoint);
  await Promise.all(previous
    .filter((other) => other.id !== user.id)
    .map((other) => forgetEndpoints(repository, other.id, new Set([subscription.endpoint]))));

  const fresh = await repository.getUserById(user.id);
  if (!fresh) return error(404, 'not_found', 'No such account.');
  const now = new Date().toISOString();
  const entry: PushEndpoint = {
    ...subscription,
    device: deviceName(request.headers.get('user-agent') ?? ''),
    createdAt: now,
  };
  const endpoints = [
    ...(fresh.pushEndpoints ?? []).filter((existing) => existing.endpoint !== entry.endpoint),
    entry,
  ].slice(-MAX_DEVICES);
  await repository.updateUser({ ...fresh, pushEndpoints: endpoints, updatedAt: now });

  return json(200, { ok: true, devices: endpoints.length });
}

/** POST /api/push/unsubscribe - stop sending to this device. Called before signing out. */
async function unsubscribe(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: { endpoint?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  if (typeof body.endpoint !== 'string' || body.endpoint === '') {
    return error(400, 'invalid_subscription', 'Which device?');
  }
  await forgetEndpoints(repository, user.id, new Set([body.endpoint]));
  return json(200, { ok: true });
}

/**
 * POST /api/push/test - a notification to my own devices, now.
 *
 * So turning it on can be checked on the spot rather than by waiting for
 * somebody to buy something. Not written to the bell: nothing happened.
 */
async function test(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  if (!pushKeys()) return error(409, 'push_off', 'Notifications are not set up on this site yet.');
  const slow = await tooFast(user.id, 'push_test');
  if (slow) return slow;

  const sent = await pushToUser(repository, user.id, {
    id: `tst_${randomUUID().slice(0, 12)}`,
    title: 'Notifications are on',
    body: 'This is how you will hear the moment something happens.',
    link: '/',
  });
  return json(200, { sent });
}

export const pushKeyRoute = handler(key);
export const pushSubscribeRoute = handler(subscribe);
export const pushUnsubscribeRoute = handler(unsubscribe);
export const pushTestRoute = handler(test);

const anon = { authLevel: 'anonymous' } as const;

app.http('push-key', { ...anon, methods: ['GET'], route: 'push/key', handler: pushKeyRoute });
app.http('push-subscribe', { ...anon, methods: ['POST'], route: 'push/subscribe', handler: pushSubscribeRoute });
app.http('push-unsubscribe', { ...anon, methods: ['POST'], route: 'push/unsubscribe', handler: pushUnsubscribeRoute });
app.http('push-test', { ...anon, methods: ['POST'], route: 'push/test', handler: pushTestRoute });

/**
 * The clock for held notices, where the host runs timers. Reads of the bell
 * do the same job where it does not (see sendHeldPushesSoon).
 */
app.timer('push-clock', {
  schedule: '30 */1 * * * *',
  handler: async (_timer, context) => {
    const sent = await sendHeldPushes(await getRepository());
    if (sent > 0) context.log(`push-clock: sent ${sent} held notice(s)`);
  },
});
