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
  upload(bytes: Uint8Array, contentType: string, uploadedBy?: string): Promise<StoredPhoto>;
  /** Who uploaded a public photo and what, if anything, has claimed it since. */
  publicInfo(blobName: string): Promise<PublicPhotoInfo | null>;
  /**
   * Record that a listing, post or hunt now uses this photo. The first claim
   * wins: true when the photo is, or now becomes, `owner`'s.
   *
   * It is what makes deleting safe. A photo is only ever removed along with the
   * thing that claimed it, never because something else was deleted.
   */
  claimPublic(blobName: string, owner: string): Promise<boolean>;
  /** Read one back, for the backend that has no public URL of its own. */
  read(blobName: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;

  /**
   * Private photos: the ones sent in a chat.
   *
   * Kept apart from the public store on purpose. They have no public URL at all,
   * so the only way to see one is through the API, which checks who is asking.
   * Each is tagged with the account that uploaded it and, once a message carries
   * it, the thread it was sent in - so it can be attached once, by its owner,
   * and read only from that thread.
   */
  uploadPrivate(bytes: Uint8Array, contentType: string, uploadedBy: string): Promise<{ blobName: string }>;
  privateInfo(blobName: string): Promise<PrivatePhotoInfo | null>;
  /** Pin a private photo to the thread it was sent in. */
  attachPrivate(blobName: string, threadKey: string): Promise<void>;
  readPrivate(blobName: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;

  /** Every stored photo, public and private, for the operator's unused-photo scan. */
  list(): Promise<BlobEntry[]>;
  /** Delete one. False when there was nothing by that name. */
  remove(scope: PhotoScope, blobName: string): Promise<boolean>;
}

export interface PublicPhotoInfo {
  /** Null for photos uploaded before this was recorded. */
  uploadedBy: string | null;
  /** What claimed it, like `post:pst_x` or `listing:lst_x`; null while unsaved. */
  attachedTo: string | null;
  uploadedAt: string;
}

/** Which container a blob lives in: the public-read photos, or the private chat ones. */
export type PhotoScope = 'public' | 'private';

export interface BlobEntry {
  scope: PhotoScope;
  name: string;
  size: number;
  /** When it was uploaded, as an ISO time. */
  uploadedAt: string;
}

export interface PrivatePhotoInfo {
  uploadedBy: string;
  /** Opaque key of the thread it was attached to, or null while unsent. */
  threadKey: string | null;
}
