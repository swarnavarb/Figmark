import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Notification, NotificationPrefs } from '../../../shared/models.js';
import {
  categoryOf, isCategory, NOTIFICATION_CATEGORIES, type NotificationCategory,
} from '../../../shared/notifications.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { isVisibleNotice, sendHeldPushesSoon } from '../push.js';
import { error, handler, json } from './http.js';

/**
 * What happened while you were not looking.
 *
 * Deliberately thin. Every row carries the route that answers it, so the only
 * thing a reader has to do is tap it — a notification that says something
 * happened and then makes you go and find it is an interruption rather than a
 * message.
 */

/** A page of the list. The bell shows this many, then "Show older". */
const PAGE = 20;
const PAGE_MAX = 50;
/** Rows read per pass while filling a page of one category. */
const SCAN_BATCH = 50;
const SCAN_PASSES = 4;
/** The unread count looks this far back: past it the badge says 99+ anyway. */
const UNREAD_WINDOW = 100;

function wire(row: Notification) {
  return {
    id: row.id,
    kind: row.kind,
    category: categoryOf(row.kind),
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.readAt !== null,
    count: row.count ?? 1,
    createdAt: row.notBefore ?? row.createdAt,
  };
}

/**
 * GET /api/notifications?before=&category=&limit= - yours, newest first.
 *
 * Paged: `nextBefore` is where the next page starts, null at the end. Each
 * page also carries the unread counts, overall and by category, so the badge
 * and the filter chips stay right however far down somebody has scrolled.
 */
async function list(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const beforeRaw = request.query.get('before');
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? beforeRaw : undefined;
  const categoryRaw = request.query.get('category');
  const category = isCategory(categoryRaw) ? categoryRaw : null;
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(request.query.get('limit')) || PAGE));

  /* Withdrawn ones never show; held ones show once the step they report can
     no longer be undone. */
  const now = Date.now();
  // Every open copy of the site asks this once a minute, which makes it the
  // clock for held pushes on a host without timers (see push.ts).
  await sendHeldPushesSoon(repository, now);

  const latest = await repository.listNotifications(user.id, UNREAD_WINDOW);
  const unreadRows = latest.filter((row) => row.readAt === null && isVisibleNotice(row, now));
  const unreadByCategory: Partial<Record<NotificationCategory, number>> = {};
  for (const row of unreadRows) {
    const key = categoryOf(row.kind);
    unreadByCategory[key] = (unreadByCategory[key] ?? 0) + 1;
  }

  /* Fill one page, reading in batches until it is full or the rows run out.
     The cursor is the stored time of the last row looked at, so the next page
     carries on from exactly there, whatever this one skipped. */
  const page: Notification[] = [];
  let cursor = before;
  let more = false;
  let resume: string | null = null;
  for (let pass = 0; pass < SCAN_PASSES; pass += 1) {
    const batch = await repository.listNotifications(user.id, SCAN_BATCH, cursor);
    for (const row of batch) {
      if (isVisibleNotice(row, now) && (!category || categoryOf(row.kind) === category)) {
        // One more than fits: there is a next page, starting with this row.
        if (page.length === limit) {
          more = true;
          break;
        }
        page.push(row);
      }
      resume = row.createdAt;
    }
    if (more || batch.length < SCAN_BATCH) break;
    cursor = batch[batch.length - 1]!.createdAt;
    // Read as much as one request should; whatever is further down is still there.
    if (pass === SCAN_PASSES - 1) more = true;
  }
  const nextBefore = more ? resume : null;

  return json(200, {
    notifications: page
      .map(wire)
      // Sorted by when they became visible, so a held notice lands at the top
      // when it appears rather than three minutes down.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    unread: unreadRows.length,
    unreadByCategory,
    nextBefore,
  });
}

/**
 * POST /api/notifications/read - mark them read.
 *
 * One by `id`, several by `ids`, one `category`, or all of them. Opening the
 * list is not the same as having read what is in it, so this is called when
 * something is acted on or dismissed rather than the moment the panel appears.
 */
async function markRead(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: { id?: unknown; ids?: unknown; category?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const ids = typeof body.id === 'string'
    ? [body.id]
    : Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string').slice(0, 100) : null;
  const category = isCategory(body.category) ? body.category : null;

  // Only what the reader could have seen: a held notice is not read yet.
  const rows = (await repository.listNotifications(user.id, UNREAD_WINDOW))
    .filter((row) => isVisibleNotice(row));
  const target = rows.filter((row) =>
    (!ids || ids.includes(row.id)) && (!category || categoryOf(row.kind) === category));
  if (typeof body.id === 'string' && target.length === 0) return error(404, 'not_found', 'No such notification.');

  const now = new Date().toISOString();
  await Promise.all(
    target
      .filter((row) => row.readAt === null)
      .map((row) => repository.saveNotification({ ...row, readAt: now, updatedAt: now })),
  );

  return json(200, { read: target.length });
}

function prefsOf(prefs: NotificationPrefs | undefined): NotificationPrefs {
  return { pushOff: prefs?.pushOff ?? [], quietHours: prefs?.quietHours ?? false, timeZone: prefs?.timeZone ?? null };
}

function validTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** GET /api/notifications/settings - what reaches your phone. */
async function settings(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const me = await repository.getUserById(user.id);
  if (!me) return error(404, 'not_found', 'No such account.');
  return json(200, { prefs: prefsOf(me.notificationPrefs) });
}

/**
 * POST /api/notifications/settings - choose what reaches your phone.
 *
 * `{ pushOff?: category[], quietHours?: boolean, timeZone?: string }`. What
 * is left out stays as it was. The bell gets everything either way: this is
 * only about the lock screen.
 */
async function saveSettings(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: { pushOff?: unknown; quietHours?: unknown; timeZone?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (body.pushOff !== undefined && (!Array.isArray(body.pushOff) || !body.pushOff.every(isCategory))) {
    return error(400, 'invalid_settings', 'Name categories to keep off the phone.');
  }
  if (body.quietHours !== undefined && typeof body.quietHours !== 'boolean') {
    return error(400, 'invalid_settings', 'Quiet hours is on or off.');
  }

  const me = await repository.getUserById(user.id);
  if (!me) return error(404, 'not_found', 'No such account.');
  const current = prefsOf(me.notificationPrefs);
  const next: NotificationPrefs = {
    pushOff: body.pushOff !== undefined
      ? NOTIFICATION_CATEGORIES.filter((key) => (body.pushOff as NotificationCategory[]).includes(key))
      : current.pushOff,
    quietHours: typeof body.quietHours === 'boolean' ? body.quietHours : current.quietHours,
    timeZone: validTimeZone(body.timeZone) ?? current.timeZone,
  };
  await repository.updateUser({ ...me, notificationPrefs: next, updatedAt: new Date().toISOString() });
  return json(200, { prefs: next });
}

export const notificationsRoute = handler(list);
export const notificationsReadRoute = handler(markRead);
export const notificationSettingsRoute = handler(settings);
export const notificationSettingsSaveRoute = handler(saveSettings);

const anon = { authLevel: 'anonymous' } as const;

app.http('notifications', { ...anon, methods: ['GET'], route: 'notifications', handler: notificationsRoute });
app.http('notifications-read', { ...anon, methods: ['POST'], route: 'notifications/read', handler: notificationsReadRoute });
app.http('notifications-settings', { ...anon, methods: ['GET'], route: 'notifications/settings', handler: notificationSettingsRoute });
app.http('notifications-settings-save', { ...anon, methods: ['POST'], route: 'notifications/settings/save', handler: notificationSettingsSaveRoute });
