import { randomUUID } from 'node:crypto';
import type { PhotoStore, PrivatePhotoInfo, StoredPhoto, StorageStatus } from './types.js';

/**
 * Used when no storage account is configured.
 *
 * Photos are held in the process, which is exactly as durable as the in-memory
 * repository beside it: the demo works end to end, a restart loses both, and
 * the health page says so rather than letting anyone believe otherwise. The
 * alternative - refusing uploads without an Azure account - would mean the one
 * screen a seller uses most could not be tried at all.
 */
export class MemoryPhotoStore implements PhotoStore {
  private readonly blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async init(): Promise<void> {}

  status(): StorageStatus {
    return {
      backend: 'memory',
      connected: true,
      account: null,
      detail:
        `In-memory photos: ${this.blobs.size} stored, lost on restart. `
        + 'Set STORAGE_ACCOUNT to use Azure Blob Storage.',
    };
  }

  urlFor(blobName: string): string | null {
    // Served back through the API, because there is no storage account to
    // point at and a null here would render as a broken image.
    return `/api/photos/${encodeURIComponent(blobName)}`;
  }

  async upload(bytes: Uint8Array, contentType: string): Promise<StoredPhoto> {
    const blobName = `${randomUUID()}.${extensionFor(contentType)}`;
    this.blobs.set(blobName, { bytes, contentType });
    return { blobName, url: this.urlFor(blobName)! };
  }

  async read(blobName: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    return this.blobs.get(blobName) ?? null;
  }

  private readonly privateBlobs = new Map<
    string,
    { bytes: Uint8Array; contentType: string; uploadedBy: string; threadKey: string | null }
  >();

  async uploadPrivate(bytes: Uint8Array, contentType: string, uploadedBy: string): Promise<{ blobName: string }> {
    const blobName = `${randomUUID()}.${extensionFor(contentType)}`;
    this.privateBlobs.set(blobName, { bytes, contentType, uploadedBy, threadKey: null });
    return { blobName };
  }

  async privateInfo(blobName: string): Promise<PrivatePhotoInfo | null> {
    const found = this.privateBlobs.get(blobName);
    return found ? { uploadedBy: found.uploadedBy, threadKey: found.threadKey } : null;
  }

  async attachPrivate(blobName: string, threadKey: string): Promise<void> {
    const found = this.privateBlobs.get(blobName);
    if (found) found.threadKey = threadKey;
  }

  async readPrivate(blobName: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    return this.privateBlobs.get(blobName) ?? null;
  }
}

export function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/gif') return 'gif';
  return 'jpg';
}
