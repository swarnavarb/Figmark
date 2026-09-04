export interface StorageStatus {
  backend: 'azure_blob' | 'memory';
  connected: boolean;
  account: string | null;
  detail: string;
}

/**
 * Blob storage seam for listing photos, condition shots and dispute evidence.
 *
 * Only the operations the scaffold needs are defined; upload/SAS issuance lands
 * with the listing feature.
 */
export interface PhotoStore {
  init(): Promise<void>;
  status(): StorageStatus;
  /** Public URL for a stored blob, or null when the backend has no public form. */
  urlFor(blobName: string): string | null;
}
