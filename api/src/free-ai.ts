import { config, type FreeAiProvider } from './config.js';
import { getRepository } from './data/index.js';

/**
 * Free AI on the site's own free-tier keys - the backstop behind Puter.
 *
 * The app asks Puter first, on the person's own free Puter account, which
 * costs the site nothing. Only when that cannot answer (the sign-in was
 * closed, or their Puter allowance is spent) does it come here.
 *
 * Here, every service the site holds a free key for (config.freeAi: Gemini,
 * Groq, and any number of OpenAI-compatible extras) has a daily budget set
 * a little under its free plan's limit. Each request goes to whichever able
 * service has the most of today's budget left, so the load spreads and no
 * plan is ever pushed over. Uses are counted in the store, shared by every
 * instance, per Pacific day (when the free plans reset). A service that
 * answers 429 anyway is rested - a minute, or till midnight when it says
 * its day is spent. Adding a free API is only adding its settings.
 */

export class AiUnavailable extends Error {}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface AiReply { text: string; model: string; provider: string }

type Task = 'scan' | 'chat';

/** How long one answer may take before the next service is tried. */
const ANSWER_MS = 30_000;
const USAGE_ID = 'free-ai-usage';
/** How long a read of today's counts is trusted before the store is asked again. */
const USAGE_FRESH_MS = 15_000;

/* ── Days, budgets and resting ──────────────────────────────────────────── */

/** Today's date in Los Angeles, as YYYY-MM-DD: the free plans' day. */
export function pacificDay(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/** The next midnight in Los Angeles, when the free plans reset their daily counts. */
export function nextPacificMidnight(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0) % 24;
  const intoDay = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000;
  return now - intoDay + 86_400_000;
}

/** Services that said no, and when they may be asked again. */
const restingUntil = new Map<string, number>();

function resting(id: string, now = Date.now()): boolean {
  const until = restingUntil.get(id);
  if (until === undefined) return false;
  if (now < until) return true;
  restingUntil.delete(id);
  return false;
}

/** A 429 is "too many this minute" or "nothing left today"; the error's own words say which. */
function rest(id: string, detail: string, now = Date.now()): void {
  const daily = /per.?day|daily|PerDay|RPD|TPD/i.test(detail);
  restingUntil.set(id, daily ? nextPacificMidnight(now) : now + 60_000);
}

interface Usage { day: string; counts: Record<string, number> }
let usage: { at: number; value: Usage } | null = null;

/** Today's uses per service: from the store, so every instance counts the same. */
async function usageToday(now = Date.now()): Promise<Usage> {
  const day = pacificDay(now);
  if (usage && usage.value.day === day && now - usage.at < USAGE_FRESH_MS) return usage.value;
  let value: Usage = { day, counts: {} };
  try {
    const stored = (await (await getRepository()).getSiteContent(USAGE_ID))?.data as Usage | undefined;
    if (stored?.day === day && stored.counts) value = { day, counts: { ...stored.counts } };
  } catch {
    // The store could not be read: carry on with what this instance has counted.
    if (usage?.value.day === day) value = usage.value;
  }
  usage = { at: now, value };
  return value;
}

/** One more use of a service today, here at once and in the store. */
async function count(id: string, now = Date.now()): Promise<void> {
  const day = pacificDay(now);
  // A copy: the cached counts may be the store's own object, which is changed only through the store.
  const counts = { ...(usage?.value.day === day ? usage.value.counts : {}) };
  counts[id] = (counts[id] ?? 0) + 1;
  usage = { at: usage?.at ?? now, value: { day, counts } };
  try {
    const saved = await (await getRepository()).mutateSiteContent(USAGE_ID, (current) => {
      const before = current?.data as Usage | undefined;
      const counts = before?.day === day ? { ...before.counts } : {};
      counts[id] = (counts[id] ?? 0) + 1;
      const at = new Date(now).toISOString();
      // Kept a couple of days for the people running the site, then removed.
      return { id: USAGE_ID, data: { day, counts }, updatedBy: null, createdAt: current?.createdAt ?? at, updatedAt: at, ttl: 3 * 86_400 };
    });
    const stored = saved.data as Usage;
    usage = { at: now, value: { day: stored.day, counts: { ...stored.counts } } };
  } catch {
    // Counted on this instance only; the budget still holds here.
  }
}

/**
 * The services able to do `task` that are not resting and have budget left
 * today, the one with the most left (as a share of its budget) first - for
 * a chat, photo readers count as having half what they have.
 */
export async function plan(task: Task, now = Date.now()): Promise<FreeAiProvider[]> {
  const able = config.freeAi.filter((provider) => (task === 'scan' ? provider.vision : provider.chat) && !resting(provider.id, now));
  if (able.length === 0) return [];
  const { counts } = await usageToday(now);
  // Photo readers are fewer, so a chat leans on the others and leaves them for scans.
  const left = (provider: FreeAiProvider) => ((provider.daily - (counts[provider.id] ?? 0)) / provider.daily)
    * (task === 'chat' && provider.vision ? 0.5 : 1);
  return able
    .filter((provider) => (counts[provider.id] ?? 0) < provider.daily)
    .map((provider, order) => ({ provider, order, left: left(provider) }))
    .sort((a, b) => b.left - a.left || a.order - b.order)
    .map((entry) => entry.provider);
}

/** Each service's use today against its budget, for the people running the site. */
export async function freeAiUsage(): Promise<{ id: string; model: string; used: number; daily: number; scan: boolean; chat: boolean; resting: boolean }[]> {
  const { counts } = await usageToday();
  return config.freeAi.map((provider) => ({
    id: provider.id, model: provider.model, used: counts[provider.id] ?? 0, daily: provider.daily,
    scan: provider.vision, chat: provider.chat, resting: resting(provider.id),
  }));
}

export function freeAiStatus(): { scan: boolean; chat: boolean } {
  return { scan: config.freeAi.some((provider) => provider.vision), chat: config.freeAi.some((provider) => provider.chat) };
}

/** Test seam: forget rests and cached counts. */
export function resetFreeAi(): void {
  restingUntil.clear();
  usage = null;
}

/* ── Talking to a service ───────────────────────────────────────────────── */

interface Ask {
  system?: string;
  turns: ChatMessage[];
  image?: { mimeType: string; base64: string };
  temperature: number;
  maxTokens: number;
  json?: boolean;
}

async function askGemini(provider: FreeAiProvider, ask: Ask): Promise<string> {
  const contents = ask.turns.map((turn, index) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(ask.image && index === ask.turns.length - 1 ? [{ inline_data: { mime_type: ask.image.mimeType, data: ask.image.base64 } }] : []),
      { text: turn.content },
    ],
  }));
  const response = await post(provider, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent`,
    { 'x-goog-api-key': provider.apiKey }, {
      ...(ask.system ? { systemInstruction: { parts: [{ text: ask.system }] } } : {}),
      contents,
      generationConfig: { temperature: ask.temperature, maxOutputTokens: ask.maxTokens, ...(ask.json ? { responseMimeType: 'application/json' } : {}) },
    });
  const parts = (response as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })
    ?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('').trim();
}

async function askOpenAi(provider: FreeAiProvider, ask: Ask): Promise<string> {
  const messages: unknown[] = ask.system ? [{ role: 'system', content: ask.system }] : [];
  ask.turns.forEach((turn, index) => {
    messages.push(ask.image && index === ask.turns.length - 1
      ? { role: turn.role, content: [{ type: 'text', text: turn.content }, { type: 'image_url', image_url: { url: `data:${ask.image.mimeType};base64,${ask.image.base64}` } }] }
      : turn);
  });
  const response = await post(provider, provider.url, { authorization: `Bearer ${provider.apiKey}` }, {
    model: provider.model,
    messages,
    temperature: ask.temperature,
    max_tokens: ask.maxTokens,
    // Reasoning models think before they answer; these replies need little of it.
    ...(/gpt-oss/i.test(provider.model) ? { reasoning_effort: 'low' } : {}),
  });
  return String((response as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content ?? '').trim();
}

/** One POST to a service. Anything short of a usable answer is `AiUnavailable`. */
async function post(provider: FreeAiProvider, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ANSWER_MS),
    });
  } catch (cause) {
    throw new AiUnavailable(`${provider.id} could not be reached: ${(cause as Error)?.message ?? cause}`);
  }
  if (response.status === 429) {
    rest(provider.id, await response.text().catch(() => ''));
    throw new AiUnavailable(`${provider.id} is over its free limit`);
  }
  // It reached the service, so it counts against today's budget whatever came back.
  await count(provider.id);
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new AiUnavailable(`${provider.id} answered ${response.status}: ${detail}`);
  }
  return response.json().catch(() => {
    throw new AiUnavailable(`${provider.id} sent something that was not JSON`);
  });
}

/** The first service, in budget order, that gives a usable answer. */
async function answer(task: Task, ask: Ask): Promise<AiReply> {
  const order = await plan(task);
  const failures: string[] = [];
  for (const provider of order) {
    try {
      const text = provider.kind === 'gemini' ? await askGemini(provider, ask) : await askOpenAi(provider, ask);
      if (text) return { text, model: provider.model, provider: provider.id };
      failures.push(`${provider.id} gave an empty answer`);
    } catch (error) {
      if (!(error instanceof AiUnavailable)) throw error;
      failures.push(error.message);
    }
  }
  throw new AiUnavailable(failures.length > 0 ? failures.join('; ') : `no free ${task} service has budget left today`);
}

/* ── What the app asks for ──────────────────────────────────────────────── */

/** At most this many items are named in one photo. */
export const SCAN_MAX_ITEMS = 60;

const SCAN_PROMPT = `You are finding every separate item for sale in a seller's photo of collectibles (action figures, statues, boxed toys, cards, accessories).
Return ONLY a JSON array, no other text. One entry per separate item, at most ${SCAN_MAX_ITEMS}:
[{"label": "short name, e.g. Marvel Legends Ghost Rider with motorcycle", "box_2d": [ymin, xmin, ymax, xmax]}]
box_2d is the item's bounding box, each value an integer 0-1000 relative to the image height (y) and width (x).
Rules:
- A boxed or carded item is ONE item: box the whole package, including any figure or vehicle visible inside it or printed on it.
- Every loose figure is its own item, even when figures overlap or stand close together.
- Boxes packed edge to edge are still separate items: give each its own box.
- Leave out the background, shelves, foam, tables, walls and price tags.`;

/**
 * Every item in a photo, as the model's raw answer (a JSON array of labels
 * and box_2d boxes); the app reads it the same way it reads Puter's.
 */
export function scanPhoto(image: { mimeType: string; base64: string }): Promise<AiReply> {
  return answer('scan', { turns: [{ role: 'user', content: SCAN_PROMPT }], image, temperature: 0, maxTokens: 6000, json: true });
}

/** The coach's reply to the last turn. */
export function coachChat(system: string, turns: readonly ChatMessage[]): Promise<AiReply> {
  return answer('chat', { system, turns: [...turns], temperature: 0.4, maxTokens: 1500 });
}
