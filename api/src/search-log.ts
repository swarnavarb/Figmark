/**
 * What buyers search the catalog for, a month at a time.
 *
 * One site-content document per month (`searches-YYYY-MM`) holding a count
 * per term and how often it found nothing. Terms only - never who searched -
 * so it can be shown to every shop as demand. Kept to the most searched
 * terms, so a month never outgrows its document.
 */
import { SEARCH_TERMS_KEPT, searchMonthId, type SearchMonth } from '../../shared/seller-data.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** A month's searches expire a year after their last write. */
const KEEP_SECONDS = 400 * 86_400;

export async function recordSearch(repository: Repo, term: string, empty: boolean, at = new Date()): Promise<void> {
  const id = searchMonthId(at);
  await repository.mutateSiteContent(id, (current) => {
    const now = at.toISOString();
    const month = (current?.data as SearchMonth | undefined) ?? { terms: {} };
    const terms = { ...month.terms };
    const entry = terms[term] ?? { n: 0, empty: 0 };
    terms[term] = { n: entry.n + 1, empty: entry.empty + (empty ? 1 : 0) };
    const keys = Object.keys(terms);
    if (keys.length > SEARCH_TERMS_KEPT) {
      // The rarest go first; the term just searched always stays.
      keys.sort((a, b) => terms[a]!.n - terms[b]!.n);
      for (const key of keys.slice(0, keys.length - SEARCH_TERMS_KEPT)) if (key !== term) delete terms[key];
    }
    return {
      id,
      data: { terms } satisfies SearchMonth,
      updatedBy: null,
      ttl: KEEP_SECONDS,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
  });
}

/** The searches of the months covering the last `days` days, added together. */
export async function readSearches(repository: Repo, days = 30, now = new Date()): Promise<SearchMonth['terms']> {
  const ids = new Set([searchMonthId(now), searchMonthId(new Date(now.getTime() - days * 86_400_000))]);
  const months = await Promise.all([...ids].map((id) => repository.getSiteContent(id)));
  const out: SearchMonth['terms'] = {};
  for (const month of months) {
    for (const [term, count] of Object.entries((month?.data as SearchMonth | undefined)?.terms ?? {})) {
      const entry = out[term] ?? { n: 0, empty: 0 };
      out[term] = { n: entry.n + count.n, empty: entry.empty + count.empty };
    }
  }
  return out;
}
