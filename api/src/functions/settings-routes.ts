import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { cleanSettings } from '../../../shared/settings.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { SETTINGS_ID, marketSettings } from '../settings.js';
import { error, handler, json } from './http.js';

/**
 * Marketplace settings: read by anyone, changed only by operators.
 *
 * Today that is one number - how many days a payment held under buyer
 * protection waits before it releases itself - but it is a document rather
 * than a field so the next setting is an addition, not a new store.
 */

async function operator(request: HttpRequest) {
  const auth = await getAuthService();
  return auth.requireCapability(request, ['admin']);
}

/** GET /api/settings - what the rules currently are, for the words on screen. */
async function read(_request: HttpRequest, _context: InvocationContext) {
  const settings = await marketSettings(await getRepository());
  return json(200, { autoReleaseDays: settings.autoReleaseDays });
}

/** GET /api/ops/settings - the same, with who last changed them. */
async function opsRead(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  return json(200, await marketSettings(await getRepository()));
}

/**
 * POST /api/ops/settings/save - change them.
 *
 * Applies from now on. An order stores the release deadline it was given when
 * its clock started, so a shorter window never releases money earlier than
 * the buyer was told, and a longer one never keeps a seller waiting past it.
 */
async function save(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const cleaned = cleanSettings(body);
  if ('error' in cleaned) return error(400, 'invalid_settings', cleaned.error);

  const repository = await getRepository();
  const now = new Date().toISOString();
  const existing = await repository.getSiteContent(SETTINGS_ID);
  await repository.saveSiteContent({
    id: SETTINGS_ID,
    data: cleaned.settings,
    updatedBy: user.displayName ?? user.email,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return json(200, await marketSettings(repository));
}

export const settingsRoute = handler(read);
export const opsSettingsRoute = handler(opsRead);
export const opsSettingsSaveRoute = handler(save);

const anon = { authLevel: 'anonymous' } as const;
app.http('settings', { ...anon, methods: ['GET'], route: 'settings', handler: settingsRoute });
app.http('ops-settings', { ...anon, methods: ['GET'], route: 'ops/settings', handler: opsSettingsRoute });
app.http('ops-settings-save', { ...anon, methods: ['POST'], route: 'ops/settings/save', handler: opsSettingsSaveRoute });
