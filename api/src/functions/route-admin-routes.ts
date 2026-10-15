import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { ROUTE_COMMON_ID, ROUTE_SAMPLES_ID } from '../../../shared/route-samples.js';
import { ROUTE_WORDS_ID, cleanRouteWords } from '../../../shared/route-words.js';
import { audited } from '../audit.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { cleanCommonSteps, cleanSample, commonSteps, readRouteWords, routeSamples, syncRouteWords } from '../route-library.js';
import { error, handler, json } from './http.js';

/**
 * The route library the operators keep for every shop: the sample routes
 * offered under "New route", and the short forms buttons are drawn with.
 */

async function operator(request: HttpRequest) {
  return (await getAuthService()).requireCapability(request, ['admin']);
}

async function body(request: HttpRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** GET /api/route-words - the short forms, for the app to draw buttons with. */
async function words(_request: HttpRequest, _context: InvocationContext) {
  return json(200, await readRouteWords(await getRepository()));
}

/** GET /api/ops/route-library - the samples and short forms, with who changed them last. */
async function library(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();
  const [samples, saved, wordsDoc, common, commonDoc] = await Promise.all([
    routeSamples(repository),
    repository.getSiteContent(ROUTE_SAMPLES_ID),
    repository.getSiteContent(ROUTE_WORDS_ID),
    commonSteps(repository),
    repository.getSiteContent(ROUTE_COMMON_ID),
  ]);
  return json(200, {
    samples,
    /** False until the operators save a list of their own: until then it is Figmark's built-in one. */
    customised: Boolean(saved),
    samplesUpdatedAt: saved?.updatedAt ?? null,
    samplesUpdatedBy: saved?.updatedBy ?? null,
    words: await readRouteWords(repository),
    wordsUpdatedAt: wordsDoc?.updatedAt ?? null,
    wordsUpdatedBy: wordsDoc?.updatedBy ?? null,
    /** What "Start from common steps" opens with; false until the operators save their own. */
    common,
    commonCustomised: Boolean(commonDoc),
    commonUpdatedAt: commonDoc?.updatedAt ?? null,
    commonUpdatedBy: commonDoc?.updatedBy ?? null,
  });
}

/** POST /api/ops/route-samples/save - the whole list, in the order shops see it. */
async function saveSamples(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const sent = (await body(request)) as { samples?: unknown } | undefined;
  if (!sent || !Array.isArray(sent.samples)) return error(400, 'invalid_body', 'Send { samples: [...] }.');
  if (sent.samples.length > 40) return error(400, 'invalid_samples', 'At most 40 sample routes.');
  const samples = [];
  const ids = new Set<string>();
  for (const entry of sent.samples) {
    const cleaned = cleanSample(entry);
    if ('error' in cleaned) return error(400, 'invalid_samples', cleaned.error);
    if (ids.has(cleaned.sample.id)) return error(400, 'invalid_samples', `Two samples share the id "${cleaned.sample.id}".`);
    ids.add(cleaned.sample.id);
    samples.push(cleaned.sample);
  }
  const repository = await getRepository();
  const now = new Date().toISOString();
  const existing = await repository.getSiteContent(ROUTE_SAMPLES_ID);
  await repository.saveSiteContent({
    id: ROUTE_SAMPLES_ID, data: { samples }, updatedBy: user.displayName ?? user.email,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
  return json(200, { samples });
}

/** POST /api/ops/route-common/save - the steps "Start from common steps" opens with; { steps: null } restores the built-in ones. */
async function saveCommon(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const sent = (await body(request)) as { steps?: unknown } | undefined;
  if (!sent || !('steps' in sent)) return error(400, 'invalid_body', 'Send { steps: [...] }.');
  const repository = await getRepository();
  if (sent.steps === null) {
    await repository.deleteSiteContent(ROUTE_COMMON_ID);
    return json(200, { steps: await commonSteps(repository) });
  }
  const cleaned = cleanCommonSteps(sent.steps);
  if ('error' in cleaned) return error(400, 'invalid_steps', cleaned.error);
  const now = new Date().toISOString();
  const existing = await repository.getSiteContent(ROUTE_COMMON_ID);
  await repository.saveSiteContent({
    id: ROUTE_COMMON_ID, data: { steps: cleaned.steps }, updatedBy: user.displayName ?? user.email,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
  return json(200, { steps: cleaned.steps });
}

/** POST /api/ops/route-words/save - the short forms and whether countries show as flags. */
async function saveWords(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const cleaned = cleanRouteWords(await body(request));
  if ('error' in cleaned) return error(400, 'invalid_words', cleaned.error);
  const repository = await getRepository();
  const now = new Date().toISOString();
  const existing = await repository.getSiteContent(ROUTE_WORDS_ID);
  await repository.saveSiteContent({
    id: ROUTE_WORDS_ID, data: cleaned.words, updatedBy: user.displayName ?? user.email,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
  // This worker draws with the new list straight away; the others within the minute.
  await syncRouteWords(repository, true);
  return json(200, cleaned.words);
}

export const routeWordsRoute = handler(words);
export const opsRouteLibraryRoute = handler(library);
export const opsRouteSamplesSaveRoute = audited('routes.samples.save', handler(saveSamples));
export const opsRouteCommonSaveRoute = audited('routes.common.save', handler(saveCommon));
export const opsRouteWordsSaveRoute = audited('routes.words.save', handler(saveWords));

const anon = { authLevel: 'anonymous' } as const;
app.http('route-words', { ...anon, methods: ['GET'], route: 'route-words', handler: routeWordsRoute });
app.http('ops-route-library', { ...anon, methods: ['GET'], route: 'ops/route-library', handler: opsRouteLibraryRoute });
app.http('ops-route-samples-save', { ...anon, methods: ['POST'], route: 'ops/route-samples/save', handler: opsRouteSamplesSaveRoute });
app.http('ops-route-common-save', { ...anon, methods: ['POST'], route: 'ops/route-common/save', handler: opsRouteCommonSaveRoute });
app.http('ops-route-words-save', { ...anon, methods: ['POST'], route: 'ops/route-words/save', handler: opsRouteWordsSaveRoute });
