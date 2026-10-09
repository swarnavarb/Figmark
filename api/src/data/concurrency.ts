/**
 * Optimistic concurrency for documents that are read, changed and written back.
 *
 * Orders, listings and users are each read by a request, changed in memory and
 * written whole. Written unconditionally, the second of two overlapping writes
 * silently wins: two `pay` calls each record a payment, a seller saving an edit
 * puts back the stock a buyer just took. Every write of these is now made
 * conditional on the etag the document was read with.
 *
 * Losing that race is not always a real conflict. A view counter ticking over
 * changes the etag of a listing a seller is editing, and refusing the edit for
 * that would make the seller's screen unusable. So when the write is refused,
 * the document is read again and the two changes are compared, field by field,
 * against what both sides started from:
 *
 * - fields only this writer changed are applied on top of what won;
 * - a field both sides changed is a real conflict, even if they set the same
 *   value - two requests both moving an order to "paid" is the double payment
 *   this exists to stop - and the write is refused with `StaleWriteError`.
 *
 * What a document looked like when it was read is kept here, per instance,
 * keyed by its id and etag. When it is not (another instance read it, or it
 * has been evicted), a lost race is simply refused: the safe answer.
 */

/** Fields the store writes itself; never part of a change. */
const STORE_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);
/** Stamped on every write, so it says nothing about what changed. */
const STAMP_FIELDS = new Set(['updatedAt']);

/** A conditional write lost to a change it cannot be merged with. */
export class StaleWriteError extends Error {
  readonly code = 'stale_write';
  constructor(message = 'Someone else changed this at the same moment. Reload and try again.') {
    super(message);
    this.name = 'StaleWriteError';
  }
}

export interface StoredDocument {
  id: string;
  _etag?: string;
}

/** What documents looked like when last read or written, bounded. */
export class ReadSnapshots {
  /** Keyed by kind, id and etag: two requests may hold two versions of one document. */
  private readonly entries = new Map<string, string>();

  constructor(private readonly limit = 1000) {}

  remember<T>(kind: string, doc: T): T {
    const stored = doc as unknown as StoredDocument | null | undefined;
    if (!stored?.id || !stored._etag) return doc;
    const key = `${kind}:${stored.id}:${stored._etag}`;
    // Re-inserting moves it to the newest end, so eviction drops the coldest.
    this.entries.delete(key);
    this.entries.set(key, JSON.stringify(doc));
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return doc;
  }

  rememberAll<T>(kind: string, docs: T[]): T[] {
    for (const doc of docs) this.remember(kind, doc);
    return docs;
  }

  /** The document as read with this etag, if it is still known. */
  recall<T>(kind: string, id: string, etag: string): T | null {
    const json = this.entries.get(`${kind}:${id}:${etag}`);
    return json ? (JSON.parse(json) as T) : null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `mine` applied on top of `theirs`, both having started from `base`; null
 * when both changed the same field.
 */
export function mergeChanges<T extends object>(base: T, mine: T, theirs: T): T | null {
  const baseRecord = base as Record<string, unknown>;
  const mineRecord = mine as Record<string, unknown>;
  const theirsRecord = theirs as Record<string, unknown>;
  const keys = new Set([...Object.keys(baseRecord), ...Object.keys(mineRecord)]);
  const merged: Record<string, unknown> = { ...theirsRecord };
  for (const key of keys) {
    if (STORE_FIELDS.has(key)) continue;
    if (STAMP_FIELDS.has(key)) {
      if (key in mineRecord) merged[key] = mineRecord[key];
      continue;
    }
    if (same(mineRecord[key], baseRecord[key])) continue;
    if (!same(theirsRecord[key], baseRecord[key])) return null;
    if (key in mineRecord) merged[key] = mineRecord[key];
    else delete merged[key];
  }
  return merged as T;
}

/**
 * Makes the caller's object match what was actually stored.
 *
 * Callers keep using the object they passed in - write it again, return it -
 * and both have to see the merged result and the new etag, or the next write
 * would be refused as stale or would put back what it was merged with.
 */
export function adopt<T extends object>(target: T, saved: T): T {
  if (target === saved) return target;
  const record = target as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!(key in saved)) delete record[key];
  Object.assign(record, saved);
  return target;
}
