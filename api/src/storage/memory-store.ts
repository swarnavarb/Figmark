import type { PhotoStore, StorageStatus } from './types.js';

/** Used when no storage account is configured. Photos resolve to nothing. */
export class MemoryPhotoStore implements PhotoStore {
  async init(): Promise<void> {}

  status(): StorageStatus {
    return {
      backend: 'memory',
      connected: true,
      account: null,
      detail: 'No storage account configured. Set STORAGE_ACCOUNT to use Azure Blob Storage.',
    };
  }

  urlFor(): string | null {
    return null;
  }
}
