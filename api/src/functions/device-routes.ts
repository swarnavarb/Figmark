import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { deviceFigures } from '../../../shared/devices.js';
import {
  CLIENT_BROWSERS, CLIENT_PLATFORMS, CLIENT_PUSH_STATES,
  type ClientBrowser, type ClientDevice, type ClientPlatform, type ClientPushState,
} from '../../../shared/models.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * Where people use Figmark: which phone or computer, which browser, whether
 * from the home screen, and whether notifications are on.
 *
 * Each copy of the site reports itself once a day, or when one of those
 * changes, and the operators see totals. Nothing here is shown to anybody
 * else, or used to decide anything about the account.
 */

/** Past this the least recently seen copy is dropped. */
const MAX_DEVICES = 12;

/** A copy that reports nothing new within this long is not written again. */
const QUIET_MS = 12 * 60 * 60 * 1000;

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** POST /api/me/device - this copy of the site, as it sees itself. */
async function report(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: { id?: unknown; platform?: unknown; browser?: unknown; installed?: unknown; push?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(body.id) ? body.id : null;
  if (!id || !oneOf(CLIENT_PLATFORMS, body.platform) || !oneOf(CLIENT_BROWSERS, body.browser)
    || typeof body.installed !== 'boolean' || !oneOf(CLIENT_PUSH_STATES, body.push)) {
    return error(400, 'invalid_device', 'That is not a device report.');
  }
  const platform: ClientPlatform = body.platform;
  const browser: ClientBrowser = body.browser;
  const push: ClientPushState = body.push;
  const installed = body.installed;

  const fresh = await repository.getUserById(user.id);
  if (!fresh) return error(404, 'not_found', 'No such account.');
  const now = new Date().toISOString();
  const devices = fresh.clientDevices ?? [];
  const before = devices.find((device) => device.id === id);

  const unchanged = before && before.platform === platform && before.browser === browser
    && before.installed === installed && before.push === push
    && Date.now() - Date.parse(before.lastSeen) < QUIET_MS;
  if (unchanged) return json(200, { ok: true });

  const next: ClientDevice = {
    id,
    platform,
    browser,
    installed,
    installedAt: before?.installedAt ?? (installed ? now : null),
    push,
    firstSeen: before?.firstSeen ?? now,
    lastSeen: now,
  };
  const kept = [...devices.filter((device) => device.id !== id), next]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, MAX_DEVICES);
  await repository.updateUser({ ...fresh, clientDevices: kept, updatedAt: now });
  return json(200, { ok: true });
}

/** GET /api/ops/devices - the totals, for operators only. */
async function figures(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireCapability(request, ['admin']);
  const repository = await getRepository();
  return json(200, deviceFigures(await repository.listClientDevices()));
}

export const deviceReportRoute = handler(report);
export const deviceFiguresRoute = handler(figures);

const anon = { authLevel: 'anonymous' } as const;

app.http('device-report', { ...anon, methods: ['POST'], route: 'me/device', handler: deviceReportRoute });
app.http('device-figures', { ...anon, methods: ['GET'], route: 'ops/devices', handler: deviceFiguresRoute });
