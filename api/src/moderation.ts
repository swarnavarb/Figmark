import { moderationIndex, type ContentReport } from '../../shared/moderation.js';
import type { getRepository } from './data/index.js';

/**
 * Where content reports are kept: one site-content document, like the Learn
 * guide and the settings.
 *
 * The database is at its container ceiling, and the queue is small and read
 * whole - by the console, and by the three screens that draw reviews and
 * comments - so one document is the right size for it. Decided reports are
 * trimmed oldest-first once there are too many to keep; a removal or a
 * validation stays in force because the most recent decision per item is
 * always among those kept.
 */
type Repo = Awaited<ReturnType<typeof getRepository>>;

export const REPORTS_ID = 'content-reports';
const KEEP = 2_000;

export async function loadReports(repository: Repo): Promise<ContentReport[]> {
  const saved = await repository.getSiteContent(REPORTS_ID);
  const data = saved?.data as { reports?: ContentReport[] } | undefined;
  return Array.isArray(data?.reports) ? data!.reports : [];
}

export async function saveReports(repository: Repo, reports: ContentReport[], by: string): Promise<void> {
  let kept = reports;
  if (kept.length > KEEP) {
    // Open reports and standing decisions (removed / validated) are never the
    // ones dropped; the oldest settled-without-effect ones go first.
    const disposable = kept
      .filter((report) => report.status === 'kept' || report.status === 'declined')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const drop = new Set(disposable.slice(0, kept.length - KEEP).map((report) => report.id));
    kept = kept.filter((report) => !drop.has(report.id));
  }
  const now = new Date().toISOString();
  const existing = await repository.getSiteContent(REPORTS_ID);
  await repository.saveSiteContent({
    id: REPORTS_ID,
    data: { reports: kept },
    updatedBy: by,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/** The index the review and comment readers use to hide and mark content. */
export async function moderation(repository: Repo) {
  return moderationIndex(await loadReports(repository));
}
