import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { DEFAULT_LEARN, cleanLearn, type LearnDoc } from '../../../shared/learn.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * The Learn guide.
 *
 * Everyone reads it; only operators write it. Until an operator saves a
 * version, the guide that ships with the app is served - so a fresh
 * deployment has a complete Buy guide on day one, and "reset" is simply
 * deleting the saved copy.
 */

const LEARN_ID = 'learn';

type Repo = Awaited<ReturnType<typeof getRepository>>;

async function current(repository: Repo): Promise<LearnDoc & { customised: boolean }> {
  const saved = await repository.getSiteContent(LEARN_ID);
  if (!saved) return { ...DEFAULT_LEARN, customised: false };
  // A stored copy is re-checked on the way out too: it was valid when saved,
  // but the rules may have tightened since, and the page must always draw.
  const cleaned = cleanLearn(saved.data);
  if ('error' in cleaned) return { ...DEFAULT_LEARN, customised: false };
  return { ...cleaned.doc, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy, customised: true };
}

/** GET /api/learn - the guide. Hidden tabs are left out for everybody here. */
async function read(_request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const doc = await current(repository);
  return json(200, { ...doc, tabs: doc.tabs.filter((tab) => !tab.hidden) });
}

async function operator(request: HttpRequest) {
  const auth = await getAuthService();
  return auth.requireCapability(request, ['admin']);
}

/** GET /api/ops/learn - the whole guide for the editor, hidden tabs included. */
async function opsRead(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  return json(200, await current(await getRepository()));
}

/** POST /api/ops/learn - save the guide. The whole document, replaced. */
async function save(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const cleaned = cleanLearn(body);
  if ('error' in cleaned) return error(400, 'invalid_guide', cleaned.error);

  const repository = await getRepository();
  const now = new Date().toISOString();
  const existing = await repository.getSiteContent(LEARN_ID);
  await repository.saveSiteContent({
    id: LEARN_ID,
    data: cleaned.doc,
    updatedBy: user.displayName ?? user.email,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return json(200, await current(repository));
}

/** POST /api/ops/learn/reset - throw away the saved guide and go back to the one that ships. */
async function reset(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();
  await repository.deleteSiteContent(LEARN_ID);
  return json(200, await current(repository));
}

export const learnRoute = handler(read);
export const opsLearnRoute = handler(opsRead);
export const opsLearnSaveRoute = handler(save);
export const opsLearnResetRoute = handler(reset);

const anon = { authLevel: 'anonymous' } as const;
app.http('learn', { ...anon, methods: ['GET'], route: 'learn', handler: learnRoute });
app.http('ops-learn', { ...anon, methods: ['GET'], route: 'ops/learn', handler: opsLearnRoute });
app.http('ops-learn-save', { ...anon, methods: ['POST'], route: 'ops/learn/save', handler: opsLearnSaveRoute });
app.http('ops-learn-reset', { ...anon, methods: ['POST'], route: 'ops/learn/reset', handler: opsLearnResetRoute });
