import type { PhotoBox } from './api';
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
/** The models tried first, best at placing boxes first; otherwise Puter's own default. */
const PREFERRED_MODELS = ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4-6'];
/** The photo is sent no larger than this across: enough to see a figure, small enough to send quickly. */
const SEND_EDGE = 1600;
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

let chosenModel: Promise<string | undefined> | null = null;

/** The best model Puter offers for this, or none to take Puter's default. */
function modelFor(puter: Puter): Promise<string | undefined> {
  chosenModel ??= (async () => {
    try {
      const models = await puter.ai.listModels?.() ?? [];
      const names = new Set(models.flatMap((model) => [model['id'], model['name'], model['model']]).filter((name): name is string => typeof name === 'string'));
      return PREFERRED_MODELS.find((name) => names.has(name));
    } catch {
      return undefined;
    }
  })();
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
 * Every item in the photo, as read by a vision model through the person's
 * own Puter account. Call it straight from a tap: the first time, it opens
 * Puter's sign-in window. Rejects with a message to show when it cannot.
 */
export async function scanWithAI(photoUrl: string): Promise<FoundThing[]> {
  const puter = await loadPuter();
  if (!puter.auth.isSignedIn()) {
    try {
      await puter.auth.signIn({ attempt_temp_user_creation: true });
    } catch {
      throw new Error('Puter sign-in was closed. Sign in to scan with AI.');
    }
  }
  const [image, model] = await Promise.all([photoToSend(photoUrl), modelFor(puter)]);
  let response: PuterChatResponse;
  try {
    response = await puter.ai.chat(PROMPT, image, { ...(model ? { model } : {}), normalize: true, temperature: 0, max_tokens: 6000 });
  } catch (error) {
    const message = (error as { message?: string; error?: { message?: string } })?.error?.message ?? (error as { message?: string })?.message;
    throw new Error(message ? `AI scan failed: ${message}` : 'AI scan failed. Try again in a moment.');
  }
  const items = parseItems(textOf(response));
  if (items.length === 0) throw new Error('The AI found nothing it could box in this photo.');
  return items;
}
