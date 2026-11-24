import { config } from './config.js';

/**
 * Free AI, through the site's own free-tier keys: Google's Gemini API (reads
 * photos, and chats) and Groq (chats). Neither plan asks for a card, and
 * nobody using the site signs in to anything - which is what Puter, the
 * other free route, could not offer: its own sign-in window, popup blockers,
 * and a small allowance per guest account.
 *
 * The catch is that a free plan's daily allowance is shared by everyone on
 * the site. When a provider says it is used up, it is left alone until its
 * day turns over (midnight in California, where both count), and the app
 * falls back to Puter for that request. So each caller gets `AiUnavailable`
 * whenever nothing here can answer, and decides what to do instead.
 *
 * Off unless GEMINI_API_KEY or GROQ_API_KEY is set, like every other seam.
 */

export class AiUnavailable extends Error {}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface AiReply { text: string; model: string }

type Provider = 'gemini' | 'groq';

/** How long one answer may take before the app is told to try elsewhere. */
const ANSWER_MS = 40_000;

/** Providers whose free day is spent, and when they may be asked again. */
const restingUntil = new Map<Provider, number>();

/** The next midnight in Los Angeles, when both free plans reset their daily counts. */
export function nextPacificMidnight(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0) % 24;
  const intoDay = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000;
  return now - intoDay + 86_400_000;
}

function resting(provider: Provider, now = Date.now()): boolean {
  const until = restingUntil.get(provider);
  if (until === undefined) return false;
  if (now < until) return true;
  restingUntil.delete(provider);
  return false;
}

/**
 * A 429 is either "too many this minute" (wait a moment) or "nothing left
 * today" (wait for the reset). The quota error's own words say which.
 */
function rest(provider: Provider, detail: string, now = Date.now()): void {
  const daily = /per.?day|daily|PerDay|RPD|TPD/i.test(detail);
  restingUntil.set(provider, daily ? nextPacificMidnight(now) : now + 60_000);
}

export function freeAiStatus(): { scan: boolean; chat: boolean; providers: Provider[] } {
  const providers: Provider[] = [];
  if (config.freeAi.gemini) providers.push('gemini');
  if (config.freeAi.groq) providers.push('groq');
  return { scan: Boolean(config.freeAi.gemini), chat: providers.length > 0, providers };
}

/** Test seam: forget which providers are resting. */
export function resetFreeAi(): void {
  restingUntil.clear();
}

/* ── Gemini ─────────────────────────────────────────────────────────────── */

interface GeminiPart { text?: string; inline_data?: { mime_type: string; data: string } }

async function gemini(body: {
  system?: string;
  contents: { role: 'user' | 'model'; parts: GeminiPart[] }[];
  temperature: number;
  maxTokens: number;
  json?: boolean;
}): Promise<AiReply> {
  const setup = config.freeAi.gemini;
  if (!setup || resting('gemini')) throw new AiUnavailable('gemini');
  const response = await call('gemini', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(setup.model)}:generateContent`, {
    'x-goog-api-key': setup.apiKey,
  }, {
    ...(body.system ? { systemInstruction: { parts: [{ text: body.system }] } } : {}),
    contents: body.contents,
    generationConfig: {
      temperature: body.temperature,
      maxOutputTokens: body.maxTokens,
      ...(body.json ? { responseMimeType: 'application/json' } : {}),
    },
  });
  const parts = (response as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })
    ?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('').trim();
  if (!text) throw new AiUnavailable('gemini gave an empty answer');
  return { text, model: setup.model };
}

/* ── Groq ───────────────────────────────────────────────────────────────── */

async function groq(messages: { role: string; content: string }[], temperature: number, maxTokens: number): Promise<AiReply> {
  const setup = config.freeAi.groq;
  if (!setup || resting('groq')) throw new AiUnavailable('groq');
  const response = await call('groq', 'https://api.groq.com/openai/v1/chat/completions', {
    authorization: `Bearer ${setup.apiKey}`,
  }, {
    model: setup.model,
    messages,
    temperature,
    max_completion_tokens: maxTokens,
    // Reasoning models think before they answer; a coach reply needs little of it.
    ...(/gpt-oss/i.test(setup.model) ? { reasoning_effort: 'low' } : {}),
  });
  const text = String((response as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new AiUnavailable('groq gave an empty answer');
  return { text, model: setup.model };
}

/** One POST to a provider. Anything short of a usable answer is `AiUnavailable`. */
async function call(provider: Provider, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ANSWER_MS),
    });
  } catch (cause) {
    throw new AiUnavailable(`${provider} could not be reached: ${(cause as Error)?.message ?? cause}`);
  }
  if (response.status === 429) {
    rest(provider, await response.text().catch(() => ''));
    throw new AiUnavailable(`${provider} free allowance used up`);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new AiUnavailable(`${provider} answered ${response.status}: ${detail}`);
  }
  return response.json().catch(() => {
    throw new AiUnavailable(`${provider} sent something that was not JSON`);
  });
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
 * Every item in a photo, as Gemini's raw answer (a JSON array of labels and
 * box_2d boxes); the app reads it the same way it reads Puter's.
 */
export function scanPhoto(image: { mimeType: string; base64: string }): Promise<AiReply> {
  return gemini({
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: image.mimeType, data: image.base64 } }, { text: SCAN_PROMPT }] }],
    temperature: 0,
    maxTokens: 6000,
    json: true,
  });
}

/** The coach's reply: Groq first, which allows more a day, then Gemini. */
export async function coachChat(system: string, turns: readonly ChatMessage[]): Promise<AiReply> {
  try {
    return await groq([{ role: 'system', content: system }, ...turns], 0.4, 1500);
  } catch (error) {
    if (!(error instanceof AiUnavailable)) throw error;
    return gemini({
      system,
      contents: turns.map((turn) => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.content }] })),
      temperature: 0.4,
      maxTokens: 800,
    });
  }
}
