import type { SiteContent } from '../../shared/models.js';
import type { getRepository } from './data/index.js';

/**
 * Append-only logs kept as site-content documents: the fee ledger and the
 * audit trail.
 *
 * Cosmos refuses any item over 2 MB, and a whole-list read costs RU in
 * proportion to its size, so a log is never one ever-growing document. Each
 * period (a month of fees, a day of operator actions) is its own document, and
 * a period that outgrows `CHUNK_BYTES` carries on in `<id>.2`, `<id>.3` and so
 * on. Nothing is ever trimmed to make room: an entry, once written, stays
 * until its document expires.
 */
type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Audit-trail days are `audit-YYYY-MM-DD`, and expire this long after their last entry. */
export const AUDIT_PREFIX = 'audit-';
export const AUDIT_KEEP_DAYS = 90;

/** Well under the 2 MB item limit, and small enough that rewriting one stays cheap. */
export const CHUNK_BYTES = 512 * 1024;
/** What any single site-content list may grow to before its oldest entries go. */
export const DOC_BUDGET_BYTES = 1_500_000;

export const sizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '');

/** The newest entries of `list` that fit in `budget` bytes, oldest dropped first. */
export function withinBudget<T>(list: T[], budget = DOC_BUDGET_BYTES): T[] {
  let total = sizeOf(list);
  let start = 0;
  while (total > budget && start < list.length) {
    total -= sizeOf(list[start]) + 1;
    start += 1;
  }
  return start === 0 ? list : list.slice(start);
}

class ChunkFull extends Error {}

const chunkId = (base: string, n: number) => (n === 1 ? base : `${base}.${n}`);

/**
 * Appends `entries` to the log period `base`, in the first chunk with room.
 *
 * An entry whose id is already in the chunk is skipped, so replaying an
 * append (a migration interrupted halfway) never records anything twice.
 */
export async function appendToLog<T extends { id: string }>(
  repository: Repo,
  base: string,
  key: string,
  entries: readonly T[],
  by: string,
  ttlSeconds?: number,
): Promise<void> {
  let pending = [...entries];
  for (let n = 1; pending.length > 0; n += 1) {
    const id = chunkId(base, n);
    // Reassigned on every attempt: the change can run more than once when it
    // loses a race, and only the attempt that was written counts.
    let placed = new Set<string>();
    try {
      await repository.mutateSiteContent(id, (current) => {
        const now = new Date().toISOString();
        const stored = (current?.data as Record<string, unknown> | undefined)?.[key];
        const list = Array.isArray(stored) ? (stored as T[]) : [];
        const seen = new Set(list.map((entry) => entry.id));
        const fresh = pending.filter((entry) => !seen.has(entry.id));
        let size = sizeOf(list);
        const taken: T[] = [];
        for (const entry of fresh) {
          const grown = size + sizeOf(entry) + 1;
          // An empty chunk always takes one entry, however large, so a single
          // oversized entry cannot send the loop on forever.
          if (grown > CHUNK_BYTES && (list.length > 0 || taken.length > 0)) break;
          taken.push(entry);
          size = grown;
        }
        if (taken.length === 0 && fresh.length > 0) throw new ChunkFull();
        placed = new Set([...seen, ...taken.map((entry) => entry.id)]);
        const next: SiteContent = {
          id,
          data: { [key]: [...list, ...taken] },
          updatedBy: by,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        };
        if (ttlSeconds !== undefined) next.ttl = ttlSeconds;
        return next;
      });
      pending = pending.filter((entry) => !placed.has(entry.id));
    } catch (error) {
      if (!(error instanceof ChunkFull)) throw error;
    }
  }
}

/** Every entry in the log documents whose ids fall in [from, to), in id order. */
export async function readLog<T>(repository: Repo, from: string, to: string, key: string): Promise<T[]> {
  const documents = await repository.listSiteContentRange(from, to);
  return documents
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
    .flatMap((document) => {
      const list = (document.data as Record<string, unknown> | undefined)?.[key];
      return Array.isArray(list) ? (list as T[]) : [];
    });
}
