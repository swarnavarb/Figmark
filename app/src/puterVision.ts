import { ApiRequestError, api, type PhotoBox } from './api';
import { readableUrl } from './photoDetect';
import type { FoundThing } from './photoThings';

/**
 * A closer reading of a hard photo - boxes packed edge to edge, a shelf of
 * fifty figures - by a vision model, through Puter.js (puter.com). Puter's
 * "user pays" model means it costs this site nothing and needs no key: the
 * person asking signs in to their own free Puter account the first time,
 * in Puter's own window, and the reading is counted against that account.
 *
 * Only ever started by a tap on "Scan with AI", never on its own: the
 * sign-in window may only be opened from a tap, and the photo leaves the
 * phone only when the person has asked for it to.
 */

const PUTER_SCRIPT = 'https://js.puter.com/v2/';
/** The photo is sent no larger than this across: enough to see a figure, small enough to send quickly. */
const SEND_EDGE = 1600;
/** Asked for by name when Puter's list could not be read: models that answer with boxes. */
const FALLBACK_MODELS = ['gemini-2.5-flash', 'google/gemini-2.5-flash'];
const MAX_ITEMS = 60;

interface PuterChatResponse { message?: { content?: unknown } }
interface Puter {
  auth: { isSignedIn: () => boolean; signIn: (options?: { attempt_temp_user_creation?: boolean }) => Promise<unknown> };
  ai: {
    chat: (prompt: string, image: string, options?: { model?: string; normalize?: boolean; temperature?: number; max_tokens?: number }) => Promise<PuterChatResponse>;
    listModels?: () => Promise<Record<string, unknown>[]>;
  };
}

let loading: Promise<Puter> | null = null;

/** Puter.js, fetched from Puter the first time it is wanted. */
export function loadPuter(): Promise<Puter> {
  const ready = (window as unknown as { puter?: Puter }).puter;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<Puter>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PUTER_SCRIPT;
    script.async = true;
    script.onload = () => {
      const puter = (window as unknown as { puter?: Puter }).puter;
      if (puter) resolve(puter); else reject(new Error('Puter did not start.'));
    };
    script.onerror = () => reject(new Error('Could not reach Puter. Check your connection and try again.'));
    document.head.appendChild(script);
  });
  loading.catch(() => { loading = null; });
  return loading;
}

/** Fetch Puter.js ahead of the tap, so the tap can open the sign-in window straight away. */
export function warmPuter(): void {
  void loadPuter().catch(() => undefined);
}

/* ── When Puter cannot help ─────────────────────────────────────────────── */

/** Why Puter could not answer: each is remembered for a while, so nobody is asked again and again. */
export type PuterTrouble = 'declined' | 'spent' | 'broken';

export class PuterFailed extends Error {
  constructor(readonly trouble: PuterTrouble, message: string) { super(message); }
}

const SKIP_KEY = 'figmark.puterSkip';
/**
 * How long to go straight to the site's free keys instead: a closed sign-in
 * for the rest of the day (they said no; asking each tap would nag), a spent
 * Puter allowance for a day, anything else (offline, slow, broken) briefly.
 */
const SKIP_MS: Record<PuterTrouble, number> = { declined: 12 * 3_600_000, spent: 24 * 3_600_000, broken: 10 * 60_000 };
let skipUntil = 0;

/** Whether Puter is worth asking now, or the site's free keys should answer straight away. */
export function puterWorthAsking(now = Date.now()): boolean {
  if (now < skipUntil) return false;
  try {
    const stored = Number(window.localStorage.getItem(SKIP_KEY) ?? 0);
    if (now < stored) { skipUntil = stored; return false; }
  } catch { /* storage blocked: memory alone */ }
  return true;
}

export function notePuterTrouble(error: unknown, now = Date.now()): void {
  const trouble: PuterTrouble = error instanceof PuterFailed ? error.trouble : 'broken';
  skipUntil = now + SKIP_MS[trouble];
  // A short skip lives in memory only; a reload may try Puter again.
  if (trouble === 'broken') return;
  try { window.localStorage.setItem(SKIP_KEY, String(skipUntil)); } catch { /* storage blocked */ }
}

/** Out of credit, over a limit, or signed out on Puter's side: no other model there will help. */
export function puterSpent(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } } | null;
  const words = [e?.error?.code, e?.code, e?.error?.message, e?.message].filter((part) => typeof part === 'string').join(' ');
  return /credit|funds|insufficient|limit|quota|usage|exceed|payment/i.test(words);
}

/** Puter, loaded and signed in - or `PuterFailed`. Call straight from a tap: it may open Puter's sign-in window. */
export async function puterReady(loadMs?: number, signInMs?: number): Promise<Puter> {
  const within = <T>(promise: Promise<T>, ms: number | undefined) => (ms === undefined ? promise : Promise.race([
    promise,
    new Promise<never>((_, reject) => { window.setTimeout(() => reject(new Error('timeout')), ms); }),
  ]));
  let puter: Puter;
  try {
    puter = await within(loadPuter(), loadMs);
  } catch {
    throw new PuterFailed('broken', 'Puter did not load.');
  }
  if (!puter.auth.isSignedIn()) {
    try {
      await within(puter.auth.signIn({ attempt_temp_user_creation: true }), signInMs);
    } catch {
      throw new PuterFailed('declined', 'Puter sign-in was closed.');
    }
  }
  return puter;
}

let chosenModel: Promise<string | undefined> | null = null;

/**
 * How good a model is likely to be at placing boxes, by its name; 0 for one
 * that cannot be asked. Gemini is trained to answer with boxes (box_2d, the
 * form asked for here), Qwen-VL too; the small default models guess.
 */
export function boxSkill(name: string): number {
  const id = name.toLowerCase();
  if (/image|tts|audio|speech|transcribe|embed|video|live|omni|ocr|veo|imagen|banana|realtime|search/.test(id)) return 0;
  const version = Number(/(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  const size = /pro/.test(id) ? 6 : /flash/.test(id) && !/lite/.test(id) ? 5 : /lite|nano|mini|small|haiku/.test(id) ? 1 : 3;
  if (id.includes('gemini')) return 300 + version * 10 + size;
  if (id.includes('qwen') && /vl|omni/.test(id)) return 200 + version * 10 + size;
  if (id.includes('claude')) return 120 + version * 5 + size;
  if (/gpt-5|gpt-4\.1|gpt-4o|o3|o4/.test(id)) return 100 + version * 5 + size;
  return 0;
}

/** The model best at placing boxes that Puter offers, or none to take Puter's default. */
function modelFor(puter: Puter): Promise<string | undefined> {
  chosenModel ??= (async () => {
    try {
      const models = await puter.ai.listModels?.() ?? [];
      const names = models.flatMap((model) => [model['id'], model['name'], model['model'], ...(Array.isArray(model['aliases']) ? model['aliases'] : [])])
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      let best: string | undefined; let bestSkill = 0;
      for (const name of names) {
        const skill = boxSkill(name);
        if (skill > bestSkill) { best = name; bestSkill = skill; }
      }
      return best;
    } catch {
      return undefined;
    }
  })();
  chosenModel.then((model) => { if (!model) chosenModel = null; }).catch(() => { chosenModel = null; });
  return chosenModel;
}

/** The photo as a JPEG no larger than SEND_EDGE across, as a data URL. */
async function photoToSend(address: string): Promise<string> {
  // A stored photo is read through this site, so its pixels may be drawn and sent.
  const url = readableUrl(address);
  const image = new Image();
  if (!url.startsWith('data:') && !url.startsWith('blob:')) image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  const scale = Math.min(1, SEND_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const PROMPT = `You are finding every separate item for sale in a seller's photo of collectibles (action figures, statues, boxed toys, cards, accessories).
Return ONLY a JSON array, no other text. One entry per separate item, at most ${MAX_ITEMS}:
[{"label": "short name, e.g. Marvel Legends Ghost Rider with motorcycle", "box_2d": [ymin, xmin, ymax, xmax]}]
box_2d is the item's bounding box, each value an integer 0-1000 relative to the image height (y) and width (x).
Rules:
- A boxed or carded item is ONE item: box the whole package, including any figure or vehicle visible inside it or printed on it.
- Every loose figure is its own item, even when figures overlap or stand close together.
- Boxes packed edge to edge are still separate items: give each its own box.
- Leave out the background, shelves, foam, tables, walls and price tags.`;

/** The text of a chat answer, whatever shape the model gave it in. */
function textOf(response: PuterChatResponse | string): string {
  if (typeof response === 'string') return response;
  const content = response?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : (part as { text?: string })?.text ?? '')).join('');
  return String(response ?? '');
}

/** The items in a model's answer, as boxes over the photo; anything malformed is passed over. */
export function parseItems(text: string): FoundThing[] {
  const start = text.indexOf('['); const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: FoundThing[] = [];
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    const box = (entry as { box_2d?: unknown })?.box_2d;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
    const [y0, x0, y1, x1] = (box as number[]).map((value) => Math.min(1000, Math.max(0, value)) / 1000) as [number, number, number, number];
    const w = x1 - x0; const h = y1 - y0;
    if (w < 0.01 || h < 0.01 || w * h > 0.9) continue;
    const label = (entry as { label?: unknown }).label;
    const rounded = [x0, y0, w, h].map((value) => Math.round(value * 1000) / 1000) as PhotoBox;
    out.push({ label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : null, boxes: [rounded] });
  }
  return out;
}

/**
 * Every item in the photo, as read by a vision model: first through the
 * person's own free Puter account (it costs the site nothing), then - when
 * they close Puter's sign-in or their Puter allowance is spent - on the
 * site's free keys (POST /api/ai/scan). Call it straight from a tap: Puter's
 * first use opens its sign-in window. Rejects with a message to show.
 */
export async function scanWithAI(photoUrl: string): Promise<{ things: FoundThing[]; model: string | null }> {
  // Asked for once, whichever answers: the photo is only read and shrunk the one time.
  let shrunk: Promise<string> | null = null;
  const image = () => (shrunk ??= photoToSend(photoUrl));
  if (puterWorthAsking()) {
    try {
      const found = await scanWithPuter(image);
      if (found.things.length > 0) return found;
    } catch (error) {
      notePuterTrouble(error);
    }
  }
  let free: { text: string; model: string } | null = null;
  try {
    free = await api.aiScan(await image());
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 429) throw new Error(error.message);
    throw new Error('The free AI scans are used up for today. Try again tomorrow.');
  }
  const items = parseItems(free.text);
  if (items.length === 0) throw new Error('The AI found nothing it could box in this photo.');
  return { things: items, model: free.model };
}

async function scanWithPuter(image: () => Promise<string>): Promise<{ things: FoundThing[]; model: string | null }> {
  // Signed in first, while the tap still counts: the photo is shrunk after.
  const puter = await puterReady();
  const [photo, model] = await Promise.all([image(), modelFor(puter)]);
  // The best model Puter listed; failing that, a Gemini model asked for by name, then Puter's own default.
  const tries = [...new Set([model, ...FALLBACK_MODELS, undefined])];
  let response: PuterChatResponse | null = null;
  let used: string | null = null;
  let failure: unknown = null;
  for (const name of tries) {
    try {
      response = await puter.ai.chat(PROMPT, photo, { ...(name ? { model: name } : {}), normalize: true, temperature: 0, max_tokens: 6000 });
      used = name ?? null;
      break;
    } catch (error) {
      failure = error;
      // Out of credit on Puter's side: another model there will not help.
      if (puterSpent(error)) throw new PuterFailed('spent', 'Puter allowance used up.');
    }
  }
  if (!response) throw new PuterFailed('broken', String((failure as { message?: string })?.message ?? 'Puter could not answer.'));
  return { things: parseItems(textOf(response)), model: used };
}
