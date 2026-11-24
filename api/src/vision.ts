import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from '../../shared/catalog.js';
import type { RegionBox } from '../../shared/models.js';
import { config } from './config.js';

/**
 * What is in a photo, in the words a buyer would type into search.
 *
 * The fingerprint (`image-hash.ts`) finds the same picture; it cannot tell
 * that a photo of a boxed Gundam taken on somebody's desk is a "Gundam model
 * kit". Claude can, and its answer becomes an ordinary text search over the
 * catalogue - so a photo finds the item even when the shop used a different
 * picture of it.
 *
 * Off unless ANTHROPIC_API_KEY is set, like every other seam: photo search then
 * runs on the fingerprint alone, and `/api/health` says so.
 */
export interface PhotoDescription {
  /** A short search phrase, like "rx-78-2 gundam master grade model kit". */
  query: string;
  /** Single words and names worth matching on, most telling first. */
  keywords: string[];
  /** One of the catalogue's categories, or null when none fits. */
  category: string | null;
  /** Where the item sits in the photo - left, top, width, height as fractions - when Claude said. */
  box?: RegionBox | null;
  /** Every place it appears, when it appears more than once: the same thing, counted once. */
  boxes?: RegionBox[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    category: { anyOf: [{ type: 'string', enum: [...CATEGORIES] }, { type: 'null' }] },
  },
  required: ['query', 'keywords', 'category'],
  additionalProperties: false,
} as const;

const SYSTEM = [
  'You help shoppers on Figmark, a marketplace for imported collectibles - scale figures, model kits,',
  'trading cards, sneakers, plush and the like - find an item from a photo they took or saved.',
  'Name what the main item in the photo is, as a seller would title the listing: the franchise or brand,',
  'the character or model, the line or grade, and the kind of item. Prefer specific names you can actually',
  'see or read (on the box, the card, the tag) over guesses; when you are unsure of a name, describe the item',
  'plainly instead. Keywords are lowercase single words or short names, at most eight, most telling first,',
  'and never generic words like "photo", "item", "toy" or "collectible".',
  `The category must be one of: ${CATEGORIES.join(', ')} - or null if none fits.`,
].join(' ');

let client: Anthropic | null = null;

export function visionAvailable(): boolean {
  return config.vision !== null;
}

/**
 * Ask Claude what the photo shows. Null when vision is off, the photo is a type
 * Claude does not read, or anything about the call goes wrong - photo search
 * carries on with the fingerprint either way.
 */
export async function describePhoto(bytes: Uint8Array, contentType: string): Promise<PhotoDescription | null> {
  const raw = await ask(bytes, contentType, SYSTEM, SCHEMA, 'What item is this? Answer with the search terms to find it.');
  return raw ? clean(raw as Partial<PhotoDescription>) : null;
}

/** At most this many items are named in one photo: a sale photo of a shelf can hold dozens. */
const MAX_ITEMS = 60;

/** One item, and where it is: [left, top, right, bottom], each a fraction of the photo's width or height. */
const ITEM_SCHEMA = {
  ...SCHEMA,
  properties: { ...SCHEMA.properties, boxes: { type: 'array', items: { type: 'array', items: { type: 'number' } } } },
  required: [...SCHEMA.required, 'boxes'],
} as const;

const ITEMS_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: ITEM_SCHEMA } },
  required: ['items'],
  additionalProperties: false,
} as const;

const ITEMS_SYSTEM = [
  'You help people on Figmark, a marketplace for imported collectibles - action figures, scale figures, model kits,',
  'trading cards, sneakers, plush and the like - tell apart the things in a photo: a shopper asking where they are',
  'for sale, or a seller listing a sale photo that shows several things at once.',
  `List every separate thing a buyer could buy on its own that is visible in the photo, at most ${MAX_ITEMS},`,
  'the most prominent first, and do not stop at the obvious ones: a shelf photo often holds dozens.',
  'Accessories lying beside a figure (spare hands, effects, weapons, a stand) belong to the nearest figure and are',
  'not things of their own; skip furniture, hands, packaging filler, backgrounds and anything too small or blurred to',
  'name. If the SAME thing appears more than once - a front and a back view, a close-up of it - give it once, with a',
  'box for each place it appears. If nothing in the photo is something one would buy, answer with no items.',
  'For each, name it as a seller would title the listing: the franchise or brand, the character or model, the line',
  'or grade and version, and the kind of item. Prefer specific names you can actually see or read (on the box, the',
  'card, the tag) over guesses; when you are unsure of a name, describe the item plainly instead. Keywords are',
  'lowercase single words or short names, at most eight, most telling first, and never generic words like "photo",',
  `"item", "toy" or "collectible". Each category must be one of: ${CATEGORIES.join(', ')} - or null if none fits.`,
  'Each box is [left, top, right, bottom] drawn tight around the thing, each a fraction from 0 to 1 of the photo\'s',
  'width (left, right) or height (top, bottom).',
].join(' ');

/**
 * Every item in the photo, most prominent first, each in the words a buyer
 * would search with. An empty list when Claude sees nothing for sale in it;
 * null, as with `describePhoto`, when the photo could not be read at all.
 */
export async function describeItems(bytes: Uint8Array, contentType: string): Promise<PhotoDescription[] | null> {
  const raw = await ask(bytes, contentType, ITEMS_SYSTEM, ITEMS_SCHEMA, 'What items are in this photo? Answer with the search terms to find each.');
  if (!raw) return null;
  const items = Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const named = items
    .filter((item): item is Partial<PhotoDescription> => typeof item === 'object' && item !== null)
    .map((item): PhotoDescription | null => {
      const named = clean(item);
      const raw = (item as { boxes?: unknown; box?: unknown });
      const boxes = (Array.isArray(raw.boxes) ? raw.boxes : [raw.box]).map(boxOf).filter((box): box is RegionBox => box !== null).slice(0, 4);
      return named ? { ...named, box: boxes[0] ?? null, boxes } : null;
    })
    .filter((item): item is PhotoDescription => item !== null);
  // Two names for one thing would be two groups of the same listings: one item, every place it appears.
  const byKey = new Map<string, PhotoDescription>();
  for (const item of named) {
    const key = item.query.toLowerCase() || item.keywords.join(' ');
    const known = byKey.get(key);
    if (known) known.boxes = [...(known.boxes ?? []), ...(item.boxes ?? [])].slice(0, 4);
    else byKey.set(key, item);
  }
  return [...byKey.values()].slice(0, MAX_ITEMS);
}

/** One structured look at a photo; the parsed answer, or null for any failure. */
async function ask(bytes: Uint8Array, contentType: string, system: string, schema: object, question: string): Promise<unknown> {
  return askAbout([{ bytes, contentType }], system, schema, question);
}

type Picture = { bytes: Uint8Array; contentType: string };
const READABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** One structured look at one or more photos; the parsed answer, or null for any failure. */
async function askAbout(pictures: Picture[], system: string, schema: object, question: string): Promise<unknown> {
  if (!config.vision) return null;
  if (pictures.length === 0 || pictures.some((picture) => !READABLE.includes(picture.contentType))) return null;
  client ??= new Anthropic({ apiKey: config.vision.apiKey, maxRetries: 1, timeout: 25_000 });

  try {
    const response = await client.beta.messages.create({
      model: config.vision.model,
      max_tokens: 8000,
      // Naming items in one photo is a quick look, not a hard problem.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: schema as Record<string, unknown> },
      },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{
        role: 'user',
        content: [
          ...pictures.map((picture) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: picture.contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: Buffer.from(picture.bytes).toString('base64'),
            },
          })),
          { type: 'text' as const, text: question },
        ],
      }],
    });
    if (response.stop_reason !== 'end_turn') return null;
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') return null;
    return JSON.parse(text.text) as unknown;
  } catch (error) {
    // A search that cannot read the photo still searches; the reason goes to
    // the log rather than to the shopper.
    console.warn(`photo search: Claude could not describe the photo: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const SAME_SCHEMA = {
  type: 'object',
  properties: { same: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['same', 'reason'],
  additionalProperties: false,
} as const;

const SAME_SYSTEM = [
  'You check product pages on Figmark, a marketplace for imported collectibles - action figures, scale figures, model',
  'kits, trading cards, sneakers and the like. Two listings were matched to one product page by their titles, and you',
  'see one photo from each. Say whether they show the same product: the same character or model, the same version,',
  'mark, edition, release and colourway. Different photos, angles, lighting, boxed or loose, or one photo showing other',
  'things beside it, are still the same product. A different mark or model number, another version of the character,',
  'another colourway, another scale or another release is a different product. When the photos cannot tell, say same.',
].join(' ');

/**
 * Whether two photos show the same product, as the matcher's last check on
 * two listings whose titles say so. Null when vision is off or the answer
 * could not be had: the titles then decide alone.
 */
export async function sameProductInPhotos(a: Picture, b: Picture, titles: [string, string]): Promise<boolean | null> {
  const raw = await askAbout([a, b], SAME_SYSTEM, SAME_SCHEMA,
    `First photo: "${titles[0].slice(0, 120)}". Second photo: "${titles[1].slice(0, 120)}". Is it the same product?`);
  const same = (raw as { same?: unknown } | null)?.same;
  return typeof same === 'boolean' ? same : null;
}

/** Claude's [left, top, right, bottom] as a box; null for anything that is not one. */
function boxOf(value: unknown): RegionBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((part) => typeof part === 'number' && Number.isFinite(part) && part >= 0 && part <= 1)) return null;
  const [left, top, right, bottom] = value as number[];
  if (right! - left! < 0.03 || bottom! - top! < 0.03) return null;
  const round = (part: number) => Math.round(part * 1000) / 1000;
  return [round(left!), round(top!), round(right! - left!), round(bottom! - top!)];
}

/** Trim what came back to what search can use. */
function clean(raw: Partial<PhotoDescription>): PhotoDescription | null {
  const query = typeof raw.query === 'string' ? raw.query.trim().slice(0, 120) : '';
  const keywords = (Array.isArray(raw.keywords) ? raw.keywords : [])
    .filter((word): word is string => typeof word === 'string')
    .map((word) => word.trim().toLowerCase().slice(0, 40))
    .filter(Boolean);
  const category = typeof raw.category === 'string' && (CATEGORIES as readonly string[]).includes(raw.category)
    ? raw.category
    : null;
  if (!query && keywords.length === 0) return null;
  return { query, keywords: [...new Set(keywords)].slice(0, 8), category };
}
