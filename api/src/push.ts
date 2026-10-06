import webpush from 'web-push';
import type { Notification, PushEndpoint } from '../../shared/models.js';
import type { getRepository } from './data/index.js';

/**
 * Putting a notice on somebody's lock screen.
 *
 * The bell answers "what happened while I was looking away" once you come
 * back; this is what makes you come back. Standard Web Push, so one path
 * covers Android, desktop browsers and an iPhone that has the site on its home
 * screen, with no app store and nothing per platform.
 *
 * Every notice the bell gets goes out here too - `notify` is the only writer of
 * notices, so "push for every event" is one call in one place rather than a
 * promise each of sixty call sites has to keep.
 *
 * Three rules, the same as the bell's:
 *
 * - A held notice (its step can still be undone) is not sent until its hold
 *   ends, and never if it was taken back. The clock at the bottom sends those.
 * - A push that fails never fails what it reports. The worst case is the
 *   person sees it in the bell instead.
 * - A device the push service says is gone is forgotten, so a reinstalled
 *   browser does not cost a failed request on every notice forever.
 *
 * Off until the keys are configured (WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY,
 * from `npm run push:keys`): the site then never offers to turn it on, and
 * nothing here runs.
 */
type Repo = Awaited<ReturnType<typeof getRepository>>;

export interface PushKeys {
  publicKey: string;
  privateKey: string;
  /** Who the push services contact about abuse: a mailto: or https: address. */
  subject: string;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

/** Read at call time rather than once, so a check can turn it on and off. */
export function pushKeys(): PushKeys | null {
  const publicKey = env('WEB_PUSH_PUBLIC_KEY');
  const privateKey = env('WEB_PUSH_PRIVATE_KEY');
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env('WEB_PUSH_SUBJECT') ?? 'mailto:support@figmark.in' };
}

/** What the device receives, as the service worker reads it. */
export interface PushMessage {
  id: string;
  title: string;
  body: string;
  /** In-app route; tapping the notification opens it. */
  link: string;
  /** Unread notices, for the badge on the home-screen icon. */
  unread: number;
}

/**
 * Sends one message to one device: `delivered` when the push service took it,
 * `gone` when it says the device has unsubscribed.
 */
export type PushTransport = (endpoint: PushEndpoint, message: PushMessage) => Promise<{ delivered: boolean; gone: boolean }>;

const webPushTransport: PushTransport = async (endpoint, message) => {
  const keys = pushKeys();
  if (!keys) return { delivered: false, gone: false };
  try {
    await webpush.sendNotification(
      { endpoint: endpoint.endpoint, keys: endpoint.keys },
      JSON.stringify(message),
      {
        vapidDetails: keys,
        // A notice is still worth having a day late - the phone was off - but
        // not a week late.
        TTL: 24 * 60 * 60,
        urgency: 'high',
        // Same topic replaces an undelivered copy rather than adding a second,
        // so the rare double send from two clocks shows once.
        topic: message.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
        timeout: 5000,
      },
    );
    return { delivered: true, gone: false };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return { delivered: false, gone: status === 404 || status === 410 };
  }
};

let transport: PushTransport = webPushTransport;
let replaced = false;

/** Swap the sender, for checks; null puts the real one back. */
export function setPushTransport(next: PushTransport | null): void {
  transport = next ?? webPushTransport;
  replaced = next !== null;
}

/** True when pushes can go anywhere at all. */
export function pushEnabled(): boolean {
  return replaced || pushKeys() !== null;
}

/** Shown in the bell: not taken back, and not still held. */
export function isVisibleNotice(row: Notification, now = Date.now()): boolean {
  return !row.withdrawn && !(row.notBefore && Date.parse(row.notBefore) > now);
}

/**
 * Send `message` to every device of `userId`, forgetting the ones that are gone.
 *
 * Returns how many push services took it. Never throws.
 */
export async function pushToUser(repository: Repo, userId: string, message: Omit<PushMessage, 'unread'>): Promise<number> {
  if (!pushEnabled()) return 0;
  try {
    const user = await repository.getUserById(userId);
    const endpoints = user?.pushEndpoints ?? [];
    if (endpoints.length === 0) return 0;

    const unread = (await repository.listNotifications(userId, 100))
      .filter((row) => isVisibleNotice(row) && row.readAt === null).length;
    const full: PushMessage = {
      ...message,
      // Push services cap a message at about 4KB, and a lock screen shows two lines.
      title: message.title.slice(0, 120),
      body: message.body.slice(0, 300),
      unread,
    };

    const results = await Promise.all(endpoints.map(async (endpoint) => {
      try {
        return { endpoint, ...(await transport(endpoint, full)) };
      } catch {
        return { endpoint, delivered: false, gone: false };
      }
    }));

    const gone = new Set(results.filter((result) => result.gone).map((result) => result.endpoint.endpoint));
    if (gone.size > 0) await forgetEndpoints(repository, userId, gone);
    return results.filter((result) => result.delivered).length;
  } catch {
    return 0;
  }
}

/** Drop endpoints from an account, from a fresh read so nothing else is lost. */
export async function forgetEndpoints(repository: Repo, userId: string, endpoints: ReadonlySet<string>): Promise<void> {
  const fresh = await repository.getUserById(userId);
  if (!fresh) return;
  const kept = (fresh.pushEndpoints ?? []).filter((entry) => !endpoints.has(entry.endpoint));
  if (kept.length === (fresh.pushEndpoints ?? []).length) return;
  await repository.updateUser({ ...fresh, pushEndpoints: kept, updatedAt: new Date().toISOString() });
}

/** One notice out to its person's devices. */
export function pushNotice(repository: Repo, notice: Notification): Promise<number> {
  return pushToUser(repository, notice.userId, {
    id: notice.id, title: notice.title, body: notice.body, link: notice.link,
  });
}

/* ── The clock for held notices ─────────────────────────────────────────── */

/**
 * How far back the clock looks. A hold is three minutes; anything that should
 * have gone out longer ago than this was owed before push existed, or while
 * nothing was running, and arriving now would be news about old news.
 */
const LOOKBACK_MS = 15 * 60_000;

/**
 * Send every held notice whose hold has ended. Returns how many went.
 *
 * Each is marked sent before it is sent: if two clocks race, the loser's push
 * carries the same topic and replaces rather than repeats.
 */
export async function sendHeldPushes(repository: Repo, now = Date.now()): Promise<number> {
  if (!pushEnabled()) return 0;
  const due = await repository.listHeldNotificationsDue(
    new Date(now - LOOKBACK_MS).toISOString(),
    new Date(now).toISOString(),
  );
  const stamp = new Date(now).toISOString();
  await Promise.all(due.map(async (row) => {
    try {
      await repository.saveNotification({ ...row, pushedAt: stamp });
      await pushNotice(repository, row);
    } catch {
      // Still in the bell.
    }
  }));
  return due.length;
}

let lastSweep = 0;

/**
 * The clock, run on a read rather than a timer.
 *
 * Every open copy of the site asks for its notifications once a minute, so
 * hooking the clock there means held notices go out within about a minute of
 * their hold ending on any host - including one where timer triggers are not
 * available. At most once per 20 seconds per instance, so it costs nothing to
 * call from a hot path.
 */
export async function sendHeldPushesSoon(repository: Repo, now = Date.now()): Promise<void> {
  if (!pushEnabled() || now - lastSweep < 20_000) return;
  lastSweep = now;
  try {
    await sendHeldPushes(repository, now);
  } catch {
    // The next read or the timer tries again.
  }
}

/**
 * Also try right when a hold ends, if this instance is still alive then.
 *
 * Best effort and nothing depends on it: the reads and the timer are the
 * guarantee. Unreferenced so it never keeps a process up on its own.
 */
export function sendHeldPushesAt(repository: Repo, notBefore: string): void {
  if (!pushEnabled()) return;
  const wait = Date.parse(notBefore) - Date.now() + 1000;
  if (!Number.isFinite(wait) || wait > LOOKBACK_MS) return;
  const timer = setTimeout(() => {
    void sendHeldPushes(repository).catch(() => undefined);
  }, Math.max(0, wait));
  timer.unref?.();
}
