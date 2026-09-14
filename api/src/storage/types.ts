export interface StorageStatus {
  backend: 'azure_blob' | 'memory';
  connected: boolean;
  account: string | null;
  detail: string;
}

/** A stored photo, as the store hands it back. */
export interface StoredPhoto {
  blobName: string;
  /** Where the app should point an <img> at it. */
  url: string;
}

/**
 * Blob storage seam for listing photos, condition shots and dispute evidence.
 *
 * Upload landed with the listing feature, which is what this comment used to
 * promise. It is deliberately a byte-in, url-out seam rather than SAS issuance:
 * the browser sends the picture through the API, which is one round trip, one
 * place to enforce the size cap, and no credential that has to reach a phone.
 */
export interface PhotoStore {
  init(): Promise<void>;
  status(): StorageStatus;
  /** Public URL for a stored blob, or null when the backend has no public form. */
  urlFor(blobName: string): string | null;
  /** Store bytes and say where they can be read. */
  upload(bytes: Uint8Array, contentType: string): Promise<StoredPhoto>;
  /** Read one back, for the backend that has no public URL of its own. */
  read(blobName: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}
