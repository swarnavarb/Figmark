import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * What happened while you were not looking.
 *
 * Deliberately thin. Every row carries the route that answers it, so the only
 * thing a reader has to do is tap it — a notification that says something
 * happened and then makes you go and find it is an interruption rather than a
 * message.
 */

/** GET /api/notifications - yours, newest first, with the unread count. */
async function list(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const rows = await repository.listNotifications(user.id, 40);

  return json(200, {
    notifications: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.link,
      read: row.readAt !== null,
      createdAt: row.createdAt,
    })),
    unread: rows.filter((row) => row.readAt === null).length,
  });
}

/**
 * POST /api/notifications/read - mark them read.
 *
 * One by id, or all of them. Opening the list is not the same as having read
 * what is in it, so this is called when something is acted on or dismissed
 * rather than the moment the panel appears.
 */
async function markRead(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: { id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const rows = await repository.listNotifications(user.id, 100);
  const target = body.id ? rows.filter((row) => row.id === body.id) : rows;
  if (body.id && target.length === 0) return error(404, 'not_found', 'No such notification.');

  const now = new Date().toISOString();
  await Promise.all(
    target
      .filter((row) => row.readAt === null)
      .map((row) => repository.saveNotification({ ...row, readAt: now, updatedAt: now })),
  );

  return json(200, { read: target.length });
}

export const notificationsRoute = handler(list);
export const notificationsReadRoute = handler(markRead);

const anon = { authLevel: 'anonymous' } as const;

app.http('notifications', { ...anon, methods: ['GET'], route: 'notifications', handler: notificationsRoute });
app.http('notifications-read', { ...anon, methods: ['POST'], route: 'notifications/read', handler: notificationsReadRoute });
