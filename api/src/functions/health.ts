import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { HealthResponse } from '../../../shared/contracts.js';
import { getAuthService } from '../auth/index.js';
import { config } from '../config.js';
import { getRepository } from '../data/index.js';
import { getPhotoStore } from '../storage/index.js';
import { handler, json } from './http.js';

/**
 * End-to-end status probe.
 *
 * Reports which implementation each seam actually resolved to, so a deployment
 * running on in-memory fallbacks is visibly degraded rather than quietly wrong.
 */
async function health(_request: HttpRequest, _context: InvocationContext) {
  const [repository, photos, auth] = await Promise.all([
    getRepository(),
    getPhotoStore(),
    getAuthService(),
  ]);

  const data = repository.status();
  const storage = photos.status();

  const body: HealthResponse = {
    // Degraded means "running, but not on the intended backing services".
    status:
      data.connected && storage.connected && data.database !== null && config.sessionSecretSource !== 'development'
        ? 'ok'
        : 'degraded',
    service: 'figmark-api',
    version: config.version,
    time: new Date().toISOString(),
    auth: {
      mode: auth.mode,
      demoAccounts: auth.listDemoAccounts(),
      sessionSecretSource: config.sessionSecretSource,
      // Accounts created at runtime only survive if something durable is behind
      // the repository; the in-memory store loses them on every restart.
      accountsDurable: repository.backend === 'cosmos',
    },
    data: {
      backend: repository.backend,
      connected: data.connected,
      database: data.database,
      detail: data.detail,
    },
    storage,
  };

  return json(200, body);
}

/** Exported as the wrapped form that is actually served, so tests exercise it. */
export const healthRoute = handler(health);

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: healthRoute,
});
