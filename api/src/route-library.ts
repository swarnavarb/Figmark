import { checkButtons, withButtons } from '../../shared/buttons.js';
import { normaliseSteps, tagStepPlaces, type RouteStep, type StageIcon } from '../../shared/routes.js';
import { ROUTE_COMMON_ID, ROUTE_SAMPLES_ID, builtInCommonSteps, builtInSamples, isStageIcon, type SampleRoute } from '../../shared/route-samples.js';
import { DEFAULT_ROUTE_WORDS, ROUTE_WORDS_ID, cleanRouteWords, setRouteWords, type RouteWords } from '../../shared/route-words.js';
import { EMPTY_BUTTON_LIBRARY, ROUTE_BUTTONS_ID, cleanButtonLibrary, type ButtonLibrary } from '../../shared/route-buttons.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** The samples every shop is offered: the operators' list, or the built-in one until they save their own. */
export async function routeSamples(repository: Repo): Promise<SampleRoute[]> {
  const saved = await repository.getSiteContent(ROUTE_SAMPLES_ID);
  const list = (saved?.data as { samples?: unknown } | undefined)?.samples;
  if (!Array.isArray(list)) return builtInSamples();
  return list.flatMap((entry) => {
    const cleaned = cleanSample(entry);
    return 'sample' in cleaned ? [cleaned.sample] : [];
  });
}

/** What "Start from common steps" opens with: the operators' steps, or the built-in nine. */
export async function commonSteps(repository: Repo): Promise<RouteStep[]> {
  const saved = await repository.getSiteContent(ROUTE_COMMON_ID);
  const cleaned = cleanCommonSteps((saved?.data as { steps?: unknown } | undefined)?.steps);
  return 'steps' in cleaned ? cleaned.steps : builtInCommonSteps();
}

/** The common steps as the console sent them, held to the rules a shop's own route is. */
export function cleanCommonSteps(input: unknown): { steps: RouteStep[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'Send the common steps as a list.' };
  if (input.length > 30) return { error: 'At most 30 common steps.' };
  const written = normaliseSteps(
    (input as Partial<RouteStep>[]).map((step) => ({ ...tagStepPlaces(step ?? {}), stageIcon: isStageIcon(step?.stageIcon) ? step.stageIcon : undefined })),
    { keepButtons: true },
  );
  if (written.length < 2) return { error: 'The common steps need at least two steps.' };
  const steps = withButtons(written);
  const wrong = checkButtons(steps).find((problem) => problem.level === 'error');
  if (wrong) return { error: wrong.text };
  return { steps };
}

/** One sample as the console sent it, checked the same way a shop's own route is. */
export function cleanSample(input: unknown): { sample: SampleRoute } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'A sample route must be an object.' };
  const body = input as Partial<SampleRoute> & { steps?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Give the sample route a name.' };
  if (name.length > 80) return { error: 'Keep the name under 80 characters.' };
  const blurb = typeof body.blurb === 'string' ? body.blurb.trim().slice(0, 200) : '';
  const id = typeof body.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(body.id) ? body.id : '';
  if (!id) return { error: 'A sample route needs an id.' };
  if (!Array.isArray(body.steps)) return { error: 'A sample route needs its steps.' };
  const written = normaliseSteps(
    (body.steps as Partial<RouteStep>[]).map((step) => ({ ...tagStepPlaces(step ?? {}), stageIcon: isStageIcon(step?.stageIcon) ? step.stageIcon : undefined })),
    { keepButtons: true },
  );
  if (written.length < 2) return { error: `"${name}" needs at least two steps.` };
  const steps = withButtons(written);
  const wrong = checkButtons(steps).find((problem) => problem.level === 'error');
  if (wrong) return { error: `"${name}": ${wrong.text}` };
  return { sample: { id, name, blurb, icon: isStageIcon(body.icon) ? body.icon : ('transit' as StageIcon), steps } };
}

/** The operators' button library: their words for the built-in buttons, and buttons of their own. */
export async function readButtonLibrary(repository: Repo): Promise<ButtonLibrary> {
  const saved = await repository.getSiteContent(ROUTE_BUTTONS_ID);
  if (!saved) return EMPTY_BUTTON_LIBRARY;
  const cleaned = cleanButtonLibrary(saved.data);
  return 'error' in cleaned ? EMPTY_BUTTON_LIBRARY : cleaned.library;
}

/* ── Route words ─────────────────────────────────────────────────────── */

/** How long a worker trusts the short forms it last read before reading them again. */
const WORDS_FRESH_MS = 60_000;
let wordsReadAt = 0;
let reading: Promise<void> | null = null;

/** The operators' short forms as saved, or the defaults. */
export async function readRouteWords(repository: Repo): Promise<RouteWords> {
  const saved = await repository.getSiteContent(ROUTE_WORDS_ID);
  if (!saved) return DEFAULT_ROUTE_WORDS;
  const cleaned = cleanRouteWords(saved.data);
  return 'error' in cleaned ? DEFAULT_ROUTE_WORDS : cleaned.words;
}

/**
 * Bring this worker's short forms up to date, at most once a minute.
 *
 * Every label a request draws goes through the shared list, so it is read
 * once a minute rather than once a request: one small point read, and a
 * change in the console is on every button within the minute.
 */
export async function syncRouteWords(repository: Repo, force = false): Promise<void> {
  if (!force && Date.now() - wordsReadAt < WORDS_FRESH_MS) return;
  reading ??= readRouteWords(repository)
    .then((words) => { setRouteWords(words); wordsReadAt = Date.now(); })
    .catch(() => { /* Keep what we had; try again next request. */ })
    .finally(() => { reading = null; });
  await reading;
}
