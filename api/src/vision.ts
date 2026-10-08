import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from '../../shared/catalog.js';
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
  if (!config.vision) return null;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) return null;
  client ??= new Anthropic({ apiKey: config.vision.apiKey, maxRetries: 1, timeout: 25_000 });

  try {
    const response = await client.beta.messages.create({
      model: config.vision.model,
      max_tokens: 4000,
      // Naming an item in one photo is a quick look, not a hard problem.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
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
          { type: 'text', text: 'What item is this? Answer with the search terms to find it.' },
        ],
      }],
    });
    if (response.stop_reason !== 'end_turn') return null;
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') return null;
    return clean(JSON.parse(text.text) as Partial<PhotoDescription>);
  } catch (error) {
    // A search that cannot read the photo still searches; the reason goes to
    // the log rather than to the shopper.
    console.warn(`photo search: Claude could not describe the photo: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
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
