import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { currentRound, decisionOverdue, isClosed, releaseOverdue } from '../../../shared/disputes.js';
import { SIGNUP_DAYS, activityOf, dailyCounts, type OpsOverview } from '../../../shared/overview.js';
import { STORE_KINDS, statusOf, storeOf } from '../../../shared/service-stores.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { loadActions, loadLedger } from '../community.js';
import { loadReports } from '../moderation.js';
import { loadAudit } from '../audit.js';
import { emailUsage } from '../verification/email-providers.js';
import { handler, json } from './http.js';

/**
 * GET /api/ops/overview - the console's first screen, in one request.
 *
 * Counts only: every figure here is a read, and nothing is brought up to date
 * on the way (the disputes tab does that when it is opened). Each read runs at
 * once and stands alone, so a store that is slow or failing blanks its own
 * tile instead of the whole screen.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The value, or null when the read failed - logged, so a blank tile has a cause on record. */
async function settle<T>(context: InvocationContext, name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    context.warn(`overview: ${name} failed`, err);
    return null;
  }
}

async function overview(request: HttpRequest, context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireCapability(request, ['admin']);
  const repository = await getRepository();
  const now = Date.now();
  const since = new Date(now - SIGNUP_DAYS * DAY_MS).toISOString();

  const [total, signups, devices, owners, disputes, actions, reports, ledger, email, audit] = await Promise.all([
    settle(context, 'people', async () => (await repository.pageUsers({ limit: 1 })).total),
    settle(context, 'signups', () => repository.listSignupTimes(since)),
    settle(context, 'devices', () => repository.listClientDevices()),
    settle(context, 'stores', () => repository.listServiceStoreOwners()),
    settle(context, 'disputes', () => repository.listDisputes()),
    settle(context, 'actions', () => loadActions(repository)),
    settle(context, 'reports', () => loadReports(repository)),
    settle(context, 'ledger', () => loadLedger(repository)),
    settle(context, 'email', () => emailUsage(repository)),
    settle(context, 'audit', () => loadAudit(3)),
  ]);

  const openDisputes = disputes?.filter((dispute) => !isClosed(dispute)) ?? null;
  const releases = disputes?.filter((dispute) => dispute.status === 'resolved' && !dispute.release) ?? null;
  const newWithin = (days: number) => signups?.filter((at) => now - Date.parse(at) < days * DAY_MS).length ?? 0;
  const monthAgo = now - 30 * DAY_MS;
  const recentFees = ledger?.filter((entry) => Date.parse(entry.paidAt) >= monthAgo) ?? [];
  const sum = (entries: NonNullable<typeof ledger>, pick: (entry: NonNullable<typeof ledger>[number]) => number) =>
    entries.reduce((total, entry) => total + pick(entry), 0);

  const body: OpsOverview = {
    at: new Date(now).toISOString(),
    people: total === null || signups === null ? null : {
      total,
      new1d: newWithin(1),
      new7d: newWithin(7),
      new30d: newWithin(30),
      signups: dailyCounts(signups, SIGNUP_DAYS, now),
    },
    activity: devices && activityOf(devices, now),
    queues: {
      storesPending: owners && owners
        .flatMap((owner) => STORE_KINDS.map((kind) => statusOf(storeOf(owner, kind))))
        .filter((status) => status === 'pending').length,
      disputesOpen: openDisputes && openDisputes.length,
      disputesOverdue: openDisputes && releases && (
        openDisputes.filter((dispute) => decisionOverdue(currentRound(dispute), new Date(now))).length
        + releases.filter((dispute) => releaseOverdue(dispute.releaseDuty, new Date(now))).length
      ),
      releasesPending: releases && releases.length,
      actionsPending: actions && actions.filter((action) => action.status === 'pending').length,
      reportsOpen: reports && reports.filter((report) => report.status === 'open').length,
    },
    money: ledger && {
      collectedMinor: sum(ledger, (entry) => entry.amountMinor),
      commissionMinor: sum(ledger, (entry) => entry.commissionMinor),
      managerShareMinor: sum(ledger, (entry) => entry.managerShareMinor),
      last30dMinor: sum(recentFees, (entry) => entry.amountMinor),
      payments30d: recentFees.length,
    },
    email: email && email.map(({ name, today, dailyLimit, exhaustedToday }) => ({ name, today, dailyLimit, exhaustedToday })),
    recent: audit && audit.slice(0, 6).map(({ id, at, actorEmail, action, status }) => ({ id, at, actorEmail, action, status })),
  };
  return json(200, body);
}

export const opsOverviewRoute = handler(overview);

app.http('ops-overview', { authLevel: 'anonymous', methods: ['GET'], route: 'ops/overview', handler: opsOverviewRoute });
