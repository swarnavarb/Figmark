import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { PHOTO_CONTAINER_NAME } from '../../../shared/containers.js';
import type { StorageConfig } from '../config.js';
import { randomUUID } from 'node:crypto';
import { extensionFor } from './memory-store.js';
import type { PhotoStore, StoredPhoto, StorageStatus } from './types.js';

/** Azure Blob Storage implementation for listing and condition photos. */
export class BlobPhotoStore implements PhotoStore {
  private readonly client: BlobServiceClient;
  private state: StorageStatus;

  constructor(private readonly storageConfig: StorageConfig) {
    this.client = buildClient(storageConfig);
    this.state = {
      backend: 'azure_blob',
      connected: false,
      account: storageConfig.account,
      detail: 'Not yet initialised.',
    };
  }

  async init(): Promise<void> {
    try {
      const container = this.client.getContainerClient(PHOTO_CONTAINER_NAME);
      const exists = await container.exists();
      this.state = {
        backend: 'azure_blob',
        connected: true,
        account: this.storageConfig.account,
        detail: exists
          ? `Connected. Container "${PHOTO_CONTAINER_NAME}" is present.`
          : `Connected, but container "${PHOTO_CONTAINER_NAME}" does not exist yet. Run "npm run azure:provision".`,
      };
    } catch (error) {
      // As with Cosmos: report the failure through the status page rather than
      // failing the whole API.
      this.state = {
        backend: 'azure_blob',
        connected: false,
        account: this.storageConfig.account,
        detail: `Could not reach Blob Storage: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  status(): StorageStatus {
    return this.state;
  }

  urlFor(blobName: string): string | null {
    return `${this.client.url.replace(/\/$/, '')}/${PHOTO_CONTAINER_NAME}/${encodeURIComponent(blobName)}`;
  }

  async upload(bytes: Uint8Array, contentType: string): Promise<StoredPhoto> {
    const blobName = `${randomUUID()}.${extensionFor(contentType)}`;
    const blob = this.client
      .getContainerClient(PHOTO_CONTAINER_NAME)
      .getBlockBlobClient(blobName);
    await blob.uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } });
    // The container is public-read, so the storage URL is the fast path and
    // this app never has to proxy the bytes.
    return { blobName, url: this.urlFor(blobName)! };
  }

  async read(blobName: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const blob = this.client.getContainerClient(PHOTO_CONTAINER_NAME).getBlockBlobClient(blobName);
      const buffer = await blob.downloadToBuffer();
      const properties = await blob.getProperties();
      return {
        bytes: new Uint8Array(buffer),
        contentType: properties.contentType ?? 'image/jpeg',
      };
    } catch {
      return null;
    }
  }
}

function buildClient(storageConfig: StorageConfig): BlobServiceClient {
  if (storageConfig.connectionString) {
    return BlobServiceClient.fromConnectionString(storageConfig.connectionString);
  }

  const url = `https://${storageConfig.account}.blob.core.windows.net`;
  if (storageConfig.key) {
    return new BlobServiceClient(
      url,
      new StorageSharedKeyCredential(storageConfig.account, storageConfig.key),
    );
  }
  return new BlobServiceClient(url, new DefaultAzureCredential());
}
