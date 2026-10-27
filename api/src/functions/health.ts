import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { HealthResponse } from '../../../shared/contracts.js';
import { getAuthService } from '../auth/index.js';
import { config, runningInAzure } from '../config.js';
import { getRepository } from '../data/index.js';
import { getPhotoStore } from '../storage/index.js';
import { visionAvailable } from '../vision.js';
import { cached, handler, json } from './http.js';

/**
 * End-to-end status probe.
 *
 * Reports which implementation each seam actually resolved to, so a deployment
 * running on in-memory fallbacks is visibly degraded rather than quietly wrong.
 */
async function health(request: HttpRequest, _context: InvocationContext) {
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
      data.connected &&
      storage.connected &&
      data.database !== null &&
      // A store nobody can sign in to is running, not working.
      data.signInAccounts !== 0 &&
      // A container the code queries and the store lacks is a broken feature,
      // whatever the rest of the page says.
      (data.missingContainers?.length ?? 0) === 0 &&
      // 'development' is forgeable and 'missing' means nobody can sign in.
      (config.sessionSecretSource === 'configured' || config.sessionSecretSource === 'derived')
        ? 'ok'
        : 'degraded',
    service: 'figmark-api',
    version: config.version,
    environment: config.siteEnvironment,
    time: new Date().toISOString(),
    auth: {
      mode: auth.mode,
      demoAccounts: auth.listDemoAccounts(),
      captchaSiteKey: config.captcha?.siteKey ?? null,
      sessionSecretSource: config.sessionSecretSource,
      // Accounts created at runtime only survive if something durable is behind
      // the repository; the in-memory store loses them on every restart.
      accountsDurable: repository.backend === 'cosmos',
    },
    data: {
      backend: repository.backend,
      // Hosts run several workers, each with its own memory: nothing is shared.
      perWorker: repository.backend === 'memory' && runningInAzure(),
      connected: data.connected,
      database: data.database,
      detail: data.detail,
      signInAccounts: data.signInAccounts,
      missingContainers: data.missingContainers,
    },
    storage,
    photoSearch: visionAvailable()
      ? { vision: true, detail: `Photos are read by ${config.vision!.model} and matched by picture.` }
      : { vision: false, detail: 'Matching by picture only. Set ANTHROPIC_API_KEY to also find items from what is in the photo.' },
  };

  // The detail lines name the database endpoint, the storage account and raw
  // store errors: for the people running the site, not for anyone who asks.
  // Everyone still gets every yes/no the app's own banners are drawn from.
  if (runningInAzure() && !(await auth.getCurrentUser(request).catch(() => null))?.capabilities.isAdmin) {
    body.data.detail = describeData(body.data);
    body.storage = { ...body.storage, account: null, detail: body.storage.connected ? `${body.storage.backend === 'azure_blob' ? 'Blob Storage' : 'In-memory photos'} connected.` : 'Photo storage is not reachable.' };
  }

  // Asked on every page load for the banners; a few seconds old is fine, and
  // it differs by who asks, so only this browser keeps it.
  return cached(json(200, body), 'private, max-age=30');
}

/** What the database's state is, without where it is or what it said. */
function describeData(data: HealthResponse['data']): string {
  if (!data.connected) return 'The database is not reachable. An operator can see why on /api/health while signed in.';
  if ((data.missingContainers?.length ?? 0) > 0) return 'The database is missing containers.';
  if (data.signInAccounts === 0) return 'The database holds no accounts yet.';
  return data.backend === 'cosmos' ? 'Connected to Cosmos DB.' : 'In-memory store.';
}

/** Exported as the wrapped form that is actually served, so tests exercise it. */
export const healthRoute = handler(health);

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: healthRoute,
});
