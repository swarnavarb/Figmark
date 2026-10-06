import { api } from './api';

/**
 * Lock-screen notifications on this device.
 *
 * The browser does the hard part: it holds a subscription with its push
 * service, and the service worker (public/sw.js) shows what arrives even with
 * the site closed. All this file does is ask, hand the subscription to the
 * account, and say honestly what state the device is in - including the one
 * an iPhone is in until the site is on its home screen, which is the step
 * people miss.
 */

export type PushState =
  /** Not set up on this site (no keys), or the browser has no push at all. */
  | 'unsupported'
  /** An iPhone or iPad in a browser tab: it works only from the home screen. */
  | 'needs-install'
  /** Can be turned on. */
  | 'off'
  /** On for this device. */
  | 'on'
  /** The person said no; only the browser's settings can undo that. */
  | 'blocked';

const SW_URL = '/sw.js';

/** iOS and iPadOS, including an iPad that reports itself as a Mac. */
export function isAppleMobile(): boolean {
  const agent = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(agent) || (agent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Opened from the home screen rather than in a browser tab. */
export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function browserSupportsPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

let keyPromise: Promise<string | null> | null = null;
/** The site's public key, asked once; null when push is not set up here. */
function publicKey(): Promise<string | null> {
  keyPromise ??= api.pushKey().then((result) => result.publicKey).catch(() => {
    keyPromise = null;
    return null;
  });
  return keyPromise;
}

/** Registered at start-up so a push can be shown with the site closed. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register(SW_URL).catch(() => undefined);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Where this device stands. */
export async function pushState(): Promise<PushState> {
  if (!browserSupportsPush()) {
    // Safari on an iPhone has no PushManager in a tab at all; from the home
    // screen it does. So "unsupported" there really means "install it first".
    return isAppleMobile() && !isInstalled() ? 'needs-install' : 'unsupported';
  }
  if (!(await publicKey())) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/**
 * Turn it on. Must be called straight from a tap: iPhones refuse to ask
 * otherwise, and other browsers are starting to.
 */
export async function enablePush(): Promise<PushState> {
  if (!browserSupportsPush()) return pushState();

  // Asked first, before anything else is awaited, so the tap still counts.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const key = await publicKey();
  if (!key) return 'unsupported';

  const registration = (await navigator.serviceWorker.getRegistration(SW_URL))
    ?? (await navigator.serviceWorker.register(SW_URL));
  await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? (await withinSeconds(20, registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key) as BufferSource,
    })));
  await api.pushSubscribe(subscription.toJSON());
  return 'on';
}

/**
 * Some browsers never answer a subscribe - Brave with Google's services off,
 * for one - and a button stuck on "Turning on…" is worse than an error.
 */
function withinSeconds<T>(seconds: number, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The browser did not answer.')), seconds * 1000);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err: unknown) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Turn it off for this device, here and on the account. */
export async function disablePush(): Promise<void> {
  if (!browserSupportsPush()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  try {
    await api.pushUnsubscribe(subscription.endpoint);
  } finally {
    await subscription.unsubscribe().catch(() => false);
  }
}

/**
 * Make sure a device that is on is on for whoever is signed in now.
 *
 * Run when the bell appears. Cheap and idempotent: the server keeps one copy
 * per device, and moves it off any other account that last signed in here.
 */
export async function syncPush(): Promise<void> {
  if (!browserSupportsPush() || Notification.permission !== 'granted') return;
  try {
    const subscription = await currentSubscription();
    if (subscription && (await publicKey())) await api.pushSubscribe(subscription.toJSON());
  } catch {
    // Still on in the browser; the next page load tries again.
  }
}

/** Tell the home-screen icon how many are unread, where the device shows a badge. */
export function setBadge(count: number): void {
  const badged = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) void badged.setAppBadge?.(count).catch(() => undefined);
  else void badged.clearAppBadge?.().catch(() => undefined);
}
