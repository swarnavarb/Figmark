import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { CHAT_PHOTO_CONTAINER_NAME, PHOTO_CONTAINER_NAME } from '../../../shared/containers.js';
import type { StorageConfig } from '../config.js';
import { randomUUID } from 'node:crypto';
import { extensionFor } from './memory-store.js';
import type { BlobEntry, PhotoScope, PhotoStore, PrivatePhotoInfo, StoredPhoto, StorageStatus } from './types.js';

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
      const chatExists = await this.client.getContainerClient(CHAT_PHOTO_CONTAINER_NAME).exists();
      this.state = {
        backend: 'azure_blob',
        connected: true,
        account: this.storageConfig.account,
        detail: !exists
          ? `Connected, but container "${PHOTO_CONTAINER_NAME}" does not exist yet. Run "npm run azure:provision".`
          : !chatExists
            ? `Connected, but container "${CHAT_PHOTO_CONTAINER_NAME}" (private chat photos) does not exist yet. Run "npm run azure:provision".`
            : `Connected. Containers "${PHOTO_CONTAINER_NAME}" and "${CHAT_PHOTO_CONTAINER_NAME}" are present.`,
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

  private chatBlob(blobName: string) {
    return this.client.getContainerClient(CHAT_PHOTO_CONTAINER_NAME).getBlockBlobClient(blobName);
  }

  async uploadPrivate(bytes: Uint8Array, contentType: string, uploadedBy: string): Promise<{ blobName: string }> {
    const blobName = `${randomUUID()}.${extensionFor(contentType)}`;
    // The container has no anonymous access, so this blob has no public URL.
    await this.chatBlob(blobName).uploadData(bytes, {
      blobHTTPHeaders: { blobContentType: contentType },
      metadata: { uploadedby: uploadedBy },
    });
    return { blobName };
  }

  async privateInfo(blobName: string): Promise<PrivatePhotoInfo | null> {
    try {
      const { metadata } = await this.chatBlob(blobName).getProperties();
      if (!metadata?.uploadedby) return null;
      return { uploadedBy: metadata.uploadedby, threadKey: metadata.threadkey ?? null };
    } catch {
      return null;
    }
  }

  async attachPrivate(blobName: string, threadKey: string): Promise<void> {
    const blob = this.chatBlob(blobName);
    const { metadata } = await blob.getProperties();
    await blob.setMetadata({ ...(metadata ?? {}), threadkey: threadKey });
  }

  async readPrivate(blobName: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const blob = this.chatBlob(blobName);
      const buffer = await blob.downloadToBuffer();
      const properties = await blob.getProperties();
      return { bytes: new Uint8Array(buffer), contentType: properties.contentType ?? 'image/jpeg' };
    } catch {
      return null;
    }
  }

  async list(): Promise<BlobEntry[]> {
    const entries: BlobEntry[] = [];
    for (const [scope, containerName] of [
      ['public', PHOTO_CONTAINER_NAME],
      ['private', CHAT_PHOTO_CONTAINER_NAME],
    ] as const) {
      const container = this.client.getContainerClient(containerName);
      try {
        for await (const blob of container.listBlobsFlat()) {
          entries.push({
            scope,
            name: blob.name,
            size: blob.properties.contentLength ?? 0,
            uploadedAt: (blob.properties.lastModified ?? new Date()).toISOString(),
          });
        }
      } catch {
        // A container that is not there yet has nothing to list.
      }
    }
    return entries;
  }

  async remove(scope: PhotoScope, blobName: string): Promise<boolean> {
    const containerName = scope === 'public' ? PHOTO_CONTAINER_NAME : CHAT_PHOTO_CONTAINER_NAME;
    const gone = await this.client.getContainerClient(containerName).getBlockBlobClient(blobName).deleteIfExists();
    return gone.succeeded;
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
