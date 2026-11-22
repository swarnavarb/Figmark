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

/** At most this many items are named in one photo: a shelf shot is a handful, not an inventory. */
const MAX_ITEMS = 5;

/** One item, and where it is: [left, top, right, bottom], each a fraction of the photo's width or height. */
const ITEM_SCHEMA = {
  ...SCHEMA,
  properties: { ...SCHEMA.properties, box: { type: 'array', items: { type: 'number' } } },
  required: [...SCHEMA.required, 'box'],
} as const;

const ITEMS_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: ITEM_SCHEMA } },
  required: ['items'],
  additionalProperties: false,
} as const;

const ITEMS_SYSTEM = [
  'You help shoppers on Figmark, a marketplace for imported collectibles - scale figures, model kits,',
  'trading cards, sneakers, plush and the like - find where the things in a photo are, or were, for sale.',
  `List each distinct item a shopper could buy that is clearly visible in the photo, at most ${MAX_ITEMS},`,
  'the most prominent first. Skip furniture, hands, packaging filler, backgrounds and anything too small or blurred',
  'to name. Several copies of the same item are one item. If nothing in the photo is something one would buy, answer',
  'with no items. For each, name it as a seller would title the listing: the franchise or brand, the character or',
  'model, the line or grade, and the kind of item. Prefer specific names you can actually see or read (on the box,',
  'the card, the tag) over guesses; when you are unsure of a name, describe the item plainly instead. Keywords are',
  'lowercase single words or short names, at most eight, most telling first, and never generic words like "photo",',
  `"item", "toy" or "collectible". Each category must be one of: ${CATEGORIES.join(', ')} - or null if none fits.`,
  'For each, give its box: [left, top, right, bottom] around the item, each a fraction from 0 to 1 of the photo\'s',
  'width (left, right) or height (top, bottom), so a shopper can tap the item in the photo.',
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
      return named ? { ...named, box: boxOf((item as { box?: unknown }).box) } : null;
    })
    .filter((item): item is PhotoDescription => item !== null);
  // Two names for one thing would be two groups of the same listings.
  const seen = new Set<string>();
  return named.filter((item) => {
    const key = item.query.toLowerCase() || item.keywords.join(' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_ITEMS);
}

/** Things a sale photo may be split into: a shelf of figures, not a warehouse. */
const MAX_PIECES = 60;

const PIECES_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          boxes: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
        },
        required: ['name', 'boxes'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

const PIECES_SYSTEM = [
  'You help sellers on Figmark, a marketplace for collectibles - action figures, scale figures, model kits,',
  'trading cards, sneakers, plush and the like - list a sale photo that shows several things for sale at once.',
  `List every separate thing a buyer could buy on its own that is visible in the photo, at most ${MAX_PIECES}.`,
  'Accessories lying beside a figure (spare hands, effects, weapons, a stand) belong to the nearest figure and are',
  'not items of their own, and neither are furniture, backgrounds, packaging filler or bags of loose parts.',
  'If the SAME physical item appears more than once in the photo - a front and back view, or a close-up of it -',
  'that is ONE item: give it once, with one box for each place it appears. Two copies of the same product that',
  'are clearly separate physical items are two items.',
  'Name each as a seller would title it: the line or brand, the character or model, and the version if you can',
  'tell (for example "Marvel Legends Wolverine (classic yellow)"). When unsure, describe it plainly.',
  'Each box is [left, top, right, bottom], each a fraction from 0 to 1 of the photo\'s width (left, right) or',
  'height (top, bottom), drawn tight around the item.',
].join(' ');

/** One thing in a sale photo: its name, and each place it appears. */
export interface PhotoPiece {
  name: string;
  boxes: RegionBox[];
}

/**
 * Every thing for sale in a photo, each once, with every place it appears.
 * Null when vision is off or the photo could not be read; empty when Claude
 * saw nothing for sale.
 */
export async function describePieces(bytes: Uint8Array, contentType: string): Promise<PhotoPiece[] | null> {
  const raw = await ask(bytes, contentType, PIECES_SYSTEM, PIECES_SCHEMA,
    'List each separate item for sale in this photo, with a box for every place it appears.');
  if (!raw) return null;
  const items = Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: PhotoPiece[] = [];
  for (const item of items as { name?: unknown; boxes?: unknown }[]) {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 120) : '';
    const boxes = (Array.isArray(item?.boxes) ? item.boxes : []).map(boxOf).filter((box): box is RegionBox => box !== null).slice(0, 4);
    if (boxes.length > 0) out.push({ name, boxes });
  }
  return out.slice(0, MAX_PIECES);
}

/** One structured look at a photo; the parsed answer, or null for any failure. */
async function ask(bytes: Uint8Array, contentType: string, system: string, schema: object, question: string): Promise<unknown> {
  if (!config.vision) return null;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) return null;
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
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: Buffer.from(bytes).toString('base64'),
            },
          },
          { type: 'text', text: question },
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
