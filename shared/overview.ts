import type { ClientDevice } from './models.js';
import { stillInstalled } from './devices.js';

/**
 * The operations console's first screen: how many people, how many of them are
 * around, and what is waiting on an operator - in one request.
 *
 * Each section is read on its own and is null when its read failed, so one
 * slow or broken store costs that tile and not the screen.
 */

export const SIGNUP_DAYS = 30;

export interface OverviewActivity {
  /** People with at least one signed-in device that has reported. */
  reporting: number;
  /** Seen in the last 24 hours, 7 days and 30 days. Nested: day ⊆ week ⊆ month. */
  day: number;
  week: number;
  month: number;
  installed: number;
  pushOn: number;
}

export interface OverviewPeople {
  total: number;
  new1d: number;
  new7d: number;
  new30d: number;
  /** New accounts per day, oldest first, the last entry today. */
  signups: number[];
}

export interface OverviewQueues {
  storesPending: number | null;
  disputesOpen: number | null;
  disputesOverdue: number | null;
  releasesPending: number | null;
  actionsPending: number | null;
  reportsOpen: number | null;
}

export interface OverviewMoney {
  collectedMinor: number;
  commissionMinor: number;
  managerShareMinor: number;
  last30dMinor: number;
  payments30d: number;
}

export interface OverviewEmail {
  name: string;
  today: number;
  dailyLimit: number;
  exhaustedToday: string | null;
}

export interface OverviewAuditEntry {
  id: string;
  at: string;
  actorEmail: string | null;
  action: string;
  status: number;
}

export interface OpsOverview {
  at: string;
  people: OverviewPeople | null;
  activity: OverviewActivity | null;
  queues: OverviewQueues;
  money: OverviewMoney | null;
  email: OverviewEmail[] | null;
  recent: OverviewAuditEntry[] | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the day `ms` falls in. */
const dayStart = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

/** How many of `times` fall on each of the last `days` days, oldest first. */
export function dailyCounts(times: readonly string[], days: number, now = Date.now()): number[] {
  const counts = new Array<number>(days).fill(0);
  const today = dayStart(now);
  for (const time of times) {
    const at = Date.parse(time);
    if (Number.isNaN(at)) continue;
    const back = Math.round((today - dayStart(at)) / DAY_MS);
    if (back >= 0 && back < days) counts[days - 1 - back]! += 1;
  }
  return counts;
}

/** Who has been around lately, by the most recent report from any of their devices. */
export function activityOf(
  accounts: ReadonlyArray<{ clientDevices?: readonly ClientDevice[] }>,
  now = Date.now(),
): OverviewActivity {
  const totals: OverviewActivity = { reporting: 0, day: 0, week: 0, month: 0, installed: 0, pushOn: 0 };
  for (const account of accounts) {
    const devices = account.clientDevices ?? [];
    if (devices.length === 0) continue;
    totals.reporting += 1;
    const latest = Math.max(...devices.map((device) => Date.parse(device.lastSeen) || 0));
    const since = now - latest;
    if (since < DAY_MS) totals.day += 1;
    if (since < 7 * DAY_MS) totals.week += 1;
    if (since < 30 * DAY_MS) totals.month += 1;
    if (devices.some((device) => stillInstalled(device, now))) totals.installed += 1;
    if (devices.some((device) => device.push === 'on')) totals.pushOn += 1;
  }
  return totals;
}
