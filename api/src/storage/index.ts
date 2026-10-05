import { config } from '../config.js';
import { BlobPhotoStore } from './blob-store.js';
import { MemoryPhotoStore } from './memory-store.js';
import type { PhotoStore } from './types.js';

export type { PhotoStore, StorageStatus } from './types.js';

let cached: Promise<PhotoStore> | null = null;

/** Resolve the configured photo store, initialising it once per host instance. */
export function getPhotoStore(): Promise<PhotoStore> {
  if (!cached) {
    cached = (async () => {
      const store: PhotoStore = config.storage
        ? new BlobPhotoStore(config.storage)
        : new MemoryPhotoStore();
      await store.init();
      return store;
    })();
  }
  return cached;
}

/** A name the photo store gave out: no slashes, no tricks. */
const PHOTO_NAME = /^[\w.-]+$/;

/**
 * The blob name, when a URL is one of ours: either the API's own address for a
 * photo, or the store's public URL for it. Null for anything else.
 *
 * Posts, hunts and previews only ever point at photos uploaded here. A link to
 * any other server is a picture that server sees every viewer load - their
 * addresses, when, how often - and one the preview renderer would fetch for
 * whoever typed it.
 */
export async function ownPhotoName(url: string): Promise<string | null> {
  const local = url.match(/^\/api\/photos\/([^/?#]+)$/);
  if (local) {
    const name = decodeURIComponent(local[1]!);
    return PHOTO_NAME.test(name) ? name : null;
  }
  const prefix = (await getPhotoStore()).urlFor('');
  if (!prefix || !/^https:\/\//.test(prefix) || !url.startsWith(prefix)) return null;
  const name = decodeURIComponent(url.slice(prefix.length));
  return PHOTO_NAME.test(name) ? name : null;
}

/**
 * Photo addresses a post or a hunt may carry: up to `max`, all uploaded here.
 * Null when anything is off, so the caller refuses the whole request.
 */
export async function ownPhotos(value: unknown, max: number): Promise<string[] | null> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const urls = value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
  if (urls.length > max) return null;
  for (const url of urls) {
    if (url.length > 500 || !(await ownPhotoName(url))) return null;
  }
  return urls;
}
