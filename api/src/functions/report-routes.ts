import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import {
  DECISIONS_FOR, DECISION_LABELS, REASON_MAX, REASON_MIN, REPORT_TARGETS, REPORT_TARGET_LABELS,
  type ContentReport, type ReportDecision, type ReportTarget,
} from '../../../shared/moderation.js';
import { reviewRevealed } from '../../../shared/orders.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { loadReports, saveReports } from '../moderation.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';

/**
 * Disputing a review or comment, or asking for your own to be validated.
 *
 * See shared/moderation.ts for the rules. The routes here are the button (one
 * for everybody) and the operator's queue.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

interface Target {
  authorId: string;
  body: string;
  /** Whether a stranger can read it yet - a blind trade review may not be. */
  visible: boolean;
}

/** The content a report is about, read fresh, or null when it is not there. */
export async function findTarget(repository: Repo, type: ReportTarget, id: string, parentId: string): Promise<Target | null> {
  if (type === 'post' || type === 'forum_post') {
    const post = await repository.getPost(parentId, id);
    if (!post || (type === 'forum_post') !== (post.channel === 'forum')) return null;
    return { authorId: post.authorId, body: post.body, visible: true };
  }
  if (type === 'review') {
    const review = (await repository.listReviewsAbout(parentId)).find((entry) => entry.id === id);
    return review
      ? { authorId: review.authorId, body: review.body, visible: reviewRevealed(review, false) }
      : null;
  }
  if (type === 'store_review') {
    const review = (await repository.listStoreReviews(parentId)).find((entry) => entry.id === id);
    return review ? { authorId: review.authorId, body: review.body, visible: true } : null;
  }
  if (type === 'post_comment') {
    const [channelId, postId] = parentId.split(':');
    if (!channelId || !postId) return null;
    const post = await repository.getPost(channelId, postId);
    const comment = post?.comments?.find((entry) => entry.id === id);
    return comment ? { authorId: comment.authorId, body: comment.body, visible: true } : null;
  }
  const comment = (await repository.listComments(parentId)).find((entry) => entry.id === id);
  return comment
    ? { authorId: comment.authorId, body: comment.body, visible: true }
    : null;
}

async function body<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * POST /api/reports - the button on every review and comment.
 *
 * Whether it is a dispute or a validation request is decided by who presses
 * it, not by what they send: the author can only ask for validation, and
 * everybody else can only dispute. One open report per person per item.
 */
async function create(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const input = await body<{ targetType?: string; targetId?: string; parentId?: string; reason?: string }>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');

  const targetType = input.targetType as ReportTarget;
  if (!REPORT_TARGETS.includes(targetType) || !input.targetId || !input.parentId) {
    return error(400, 'invalid_target', 'Say which review, comment or post this is about.');
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length < REASON_MIN) {
    return error(400, 'invalid_reason', `Explain in a sentence or two (at least ${REASON_MIN} characters).`);
  }

  const repository = await getRepository();
  const target = await findTarget(repository, targetType, input.targetId, input.parentId);
  const mine = target?.authorId === user.id;
  // A blind review nobody may read yet is not there to dispute - except for
  // the person who wrote it.
  if (!target || (!target.visible && !mine)) return error(404, 'not_found', 'That review or comment is not there any more.');

  const kind = mine ? 'validate' : 'dispute';
  const reports = await loadReports(repository);
  const already = reports.find((report) => report.status === 'open' && report.reporterId === user.id
    && report.targetType === targetType && report.targetId === input.targetId);
  if (already) {
    return error(409, 'already_reported', kind === 'validate'
      ? 'You have already asked for this to be validated.'
      : 'You have already reported this. An operator will look at it.');
  }
  if (kind === 'validate' && reports.some((report) => report.status === 'validated'
    && report.targetType === targetType && report.targetId === input.targetId)) {
    return error(409, 'already_validated', 'This has already been validated.');
  }

  const report: ContentReport = {
    id: `rpt_${randomUUID().slice(0, 12)}`,
    kind,
    targetType,
    targetId: input.targetId,
    parentId: input.parentId,
    authorId: target.authorId,
    excerpt: target.body.slice(0, 600),
    reporterId: user.id,
    reporterName: user.displayName ?? 'Member',
    reason: reason.slice(0, REASON_MAX),
    status: 'open',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  };
  await saveReports(repository, [...reports, report], user.id);
  return json(201, { report });
}

/** GET /api/reports/mine - what this person has disputed or asked to validate, and what came of it. */
async function mine(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const reports = (await loadReports(await getRepository()))
    .filter((report) => report.reporterId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json(200, { reports });
}

async function operator(request: HttpRequest) {
  const auth = await getAuthService();
  return auth.requireCapability(request, ['admin']);
}

/** GET /api/ops/reports - the queue, open first, newest first within each. */
async function queue(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();
  const reports = [...await loadReports(repository)].sort((a, b) =>
    Number(b.status === 'open') - Number(a.status === 'open') || b.createdAt.localeCompare(a.createdAt));
  const people = await repository.listUsersByIds([...new Set(reports.map((report) => report.authorId))]);
  const nameOf = new Map(people.map((person) => [person.id, person.displayName]));
  return json(200, {
    reports: reports.map((report) => ({ ...report, authorName: nameOf.get(report.authorId) ?? 'Unknown' })),
  });
}

/**
 * POST /api/ops/reports/{id}/resolve - decide one.
 *
 * Removing a trade review deletes it, so it stops counting toward the
 * person's rating at once. A page review or comment is hidden from every
 * reader instead (there is no delete for those yet). Every open report on the
 * same item is closed by the same decision, so three people disputing one
 * comment get one answer.
 */
async function resolve(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const id = request.params.id;
  const input = await body<{ decision?: string; note?: string }>(request);
  if (!id || !input) return error(400, 'invalid_request', 'Say which report and what was decided.');

  const repository = await getRepository();
  const reports = await loadReports(repository);
  const report = reports.find((entry) => entry.id === id);
  if (!report) return error(404, 'not_found', 'No such report.');
  if (report.status !== 'open') return error(409, 'already_decided', 'That report has already been decided.');
  const decision = input.decision as ReportDecision;
  if (!DECISIONS_FOR[report.kind].includes(decision)) {
    return error(400, 'invalid_decision', `A ${report.kind} is decided as ${DECISIONS_FOR[report.kind].join(' or ')}.`);
  }

  const now = new Date().toISOString();
  const note = input.note?.trim().slice(0, 500) || null;
  const settled = reports.map((entry) => {
    const same = entry.status === 'open' && entry.targetType === report.targetType && entry.targetId === report.targetId;
    // A removal answers every open report on the item; any other decision
    // only answers reports of the same kind.
    if (!same || (entry.kind !== report.kind && decision !== 'removed')) return entry;
    const outcome: ReportDecision = entry.kind === report.kind ? decision : 'removed';
    return { ...entry, status: outcome, resolvedAt: now, resolvedBy: user.displayName ?? user.email, resolutionNote: note };
  });

  if (decision === 'removed' && report.targetType === 'review') {
    await repository.deleteReview(report.parentId, report.targetId);
  }
  if (decision === 'removed' && (report.targetType === 'post' || report.targetType === 'forum_post')) {
    await repository.deletePost(report.parentId, report.targetId);
  }
  await saveReports(repository, settled, user.id);

  const answered = settled.filter((entry) => entry.resolvedAt === now);
  const what = REPORT_TARGET_LABELS[report.targetType].toLowerCase();
  await notify(repository, [...new Set(answered.map((entry) => entry.reporterId))], {
    kind: 'content_report_settled',
    title: `${report.kind === 'validate' ? 'Validation' : 'Dispute'} decided: ${DECISION_LABELS[decision]}`,
    body: note ?? `Figmark looked at the ${what} you reported.`,
    link: '/me',
  });
  if (decision === 'removed' && !answered.some((entry) => entry.reporterId === report.authorId)) {
    await notify(repository, [report.authorId], {
      kind: 'content_report_settled',
      title: `Your ${what} was removed`,
      body: note ?? 'It was disputed and Figmark found it broke the rules.',
      link: '/me',
    });
  }

  return json(200, { report: settled.find((entry) => entry.id === id) });
}

export const reportCreateRoute = handler(create);
export const reportMineRoute = handler(mine);
export const opsReportsRoute = handler(queue);
export const opsReportResolveRoute = handler(resolve);

const anon = { authLevel: 'anonymous' } as const;
app.http('reports-create', { ...anon, methods: ['POST'], route: 'reports', handler: reportCreateRoute });
app.http('reports-mine', { ...anon, methods: ['GET'], route: 'reports/mine', handler: reportMineRoute });
app.http('ops-reports', { ...anon, methods: ['GET'], route: 'ops/reports', handler: opsReportsRoute });
app.http('ops-report-resolve', { ...anon, methods: ['POST'], route: 'ops/reports/{id}/resolve', handler: opsReportResolveRoute });
