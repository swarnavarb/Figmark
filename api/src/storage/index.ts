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
