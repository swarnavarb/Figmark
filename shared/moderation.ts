/**
 * Disputing a review or a comment, and asking for your own to be validated.
 *
 * Every review and comment carries one button. Pressed by somebody else it is
 * a dispute: "this is false, abusive, or not about a real trade". Pressed by
 * the person who wrote it, it is a request for validation: "check this and
 * stand behind it" - the author putting their own words up for the same
 * review a dispute would get, so a genuine review can carry a mark that says
 * an operator looked at it.
 *
 * Both land in one queue in the operations console and are decided the same
 * way. This is the first version: one reason, one decision, no back-and-forth.
 */

/**
 * - `review`: a trade review (parent: the person it is about)
 * - `store_review`: a review of somebody's page (parent: whose page)
 * - `comment`: a question or answer under a listing (parent: the listing)
 * - `post_comment`: a comment under a social post (parent: `channelId:postId`)
 */
export const REPORT_TARGETS = ['review', 'store_review', 'comment', 'post_comment'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_TARGET_LABELS: Record<ReportTarget, string> = {
  review: 'Trade review',
  store_review: 'Page review',
  comment: 'Listing comment',
  post_comment: 'Post comment',
};

export type ReportKind = 'dispute' | 'validate';

/**
 * What an operator decided.
 *
 * - `kept` / `removed` answer a dispute: the content stays, or comes down.
 * - `validated` / `declined` answer a validation request: it gets the mark, or
 *   it does not (and stays up either way - declining is not removing).
 */
export type ReportDecision = 'kept' | 'removed' | 'validated' | 'declined';
export type ReportStatus = 'open' | ReportDecision;

export const DECISIONS_FOR: Record<ReportKind, ReportDecision[]> = {
  dispute: ['kept', 'removed'],
  validate: ['validated', 'declined'],
};

export const DECISION_LABELS: Record<ReportDecision, string> = {
  kept: 'Kept up',
  removed: 'Removed',
  validated: 'Validated',
  declined: 'Not validated',
};

export interface ContentReport {
  id: string;
  kind: ReportKind;
  targetType: ReportTarget;
  targetId: string;
  /**
   * Where the content lives: whose page a review is on, or which listing a
   * comment is under. Stored so the console can open it and so the content can
   * be found again in one read.
   */
  parentId: string;
  /** Who wrote the content. */
  authorId: string;
  /** What it said when it was reported, so the decision is about those words. */
  excerpt: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

/** What a reader of one review or comment is told about its reports. */
export interface ModerationMark {
  /** An operator validated it at its author's request. */
  validated: boolean;
  /** There is an open dispute or validation request on it. */
  underReview: boolean;
  /** This viewer already has an open report on it, so the button says so. */
  reportedByMe: boolean;
}

export const REASON_MIN = 10;
export const REASON_MAX = 500;

/** The moderation state of every target a list of reports touches. */
export function moderationIndex(reports: readonly ContentReport[]) {
  const removed = new Set<string>();
  const validated = new Set<string>();
  const open = new Map<string, Set<string>>();
  for (const report of reports) {
    const key = `${report.targetType}:${report.targetId}`;
    if (report.status === 'removed') removed.add(key);
    if (report.status === 'validated') validated.add(key);
    if (report.status === 'open') {
      const by = open.get(key) ?? new Set<string>();
      by.add(report.reporterId);
      open.set(key, by);
    }
  }
  return {
    isRemoved: (type: ReportTarget, id: string) => removed.has(`${type}:${id}`),
    mark: (type: ReportTarget, id: string, viewerId: string | null | undefined): ModerationMark => {
      const key = `${type}:${id}`;
      const by = open.get(key);
      return {
        validated: validated.has(key),
        underReview: Boolean(by?.size),
        reportedByMe: Boolean(viewerId && by?.has(viewerId)),
      };
    },
  };
}
