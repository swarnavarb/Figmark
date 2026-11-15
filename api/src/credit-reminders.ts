import { LAPSE_REMINDER_MS, lapsingSoon, storeCreditLeft } from '../../shared/play.js';
import { rupees } from '../../shared/payments.js';
import type { getRepository } from './data/index.js';
import { notify } from './functions/notify.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Telling people their store credit is about to lapse - with no timer.
 *
 * There is no clock here and no Function App: the reminder rides on traffic
 * the app already has. Two ways, both from the page-load bootstrap:
 *
 *   - **On a visit.** Whoever opens the app is checked: credit of theirs
 *     lapsing within three days, not yet mentioned, gets one notification.
 *   - **On anybody's visit.** At most once every quarter of an hour - for the
 *     whole site, through a stamp in the store - somebody's page load also
 *     looks up every account with credit lapsing within three days and tells
 *     them, by bell and push, so people who have not opened the app hear too.
 *     A site with nobody on it for a day sends nothing that day; one with
 *     anybody on it works like a clock.
 *
 * Each credit is stamped `remindedAt` as it is mentioned, so nobody is told
 * twice however many visits land together.
 */

const SWEEP_EVERY_MS = 15 * 60_000;
/** One person's own check, at most this often per instance: a page load is not worth a read every time. */
const VISIT_EVERY_MS = 60 * 60_000;
const visited = new Map<string, number>();
const SWEEP_BATCH = 50;
const SWEEP_STAMP = 'credit-lapse-sweep';
let lastSweep = 0;

/** The check made when somebody opens the app: their own credit, at most hourly per instance. */
export async function remindOnVisit(repository: Repo, userId: string, now = Date.now()): Promise<number> {
  if (now - (visited.get(userId) ?? 0) < VISIT_EVERY_MS) return 0;
  visited.set(userId, now);
  if (visited.size > 10_000) visited.clear();
  return remindLapsing(repository, userId, now);
}

/** Tell one person about their credit lapsing soon. Returns how many credits were mentioned. */
export async function remindLapsing(repository: Repo, userId: string, now = Date.now()): Promise<number> {
  const user = await repository.getUserById(userId);
  const due = (user?.storeCredits ?? []).filter((credit) => lapsingSoon(credit, now));
  if (!user || due.length === 0) return 0;
  const at = new Date(now).toISOString();
  const ids = new Set(due.map((credit) => credit.id));
  await repository.updateUser({
    ...user,
    storeCredits: (user.storeCredits ?? []).map((credit) => (ids.has(credit.id) ? { ...credit, remindedAt: at } : credit)),
  });
  // One line per shop: "₹350 at Arjun Collects lapses on 18 Nov".
  const byStore = new Map<string, { name: string; amount: number; first: number }>();
  for (const credit of due) {
    const row = byStore.get(credit.storeId) ?? { name: credit.storeName, amount: 0, first: Infinity };
    row.amount += storeCreditLeft(credit, now);
    row.first = Math.min(row.first, Date.parse(credit.expiresAt!));
    byStore.set(credit.storeId, row);
  }
  const shops = [...byStore.values()].sort((a, b) => a.first - b.first);
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const top = shops[0]!;
  await notify(repository, [userId], {
    kind: 'credit_lapsing',
    title: shops.length === 1
      ? `⏳ ${rupees(top.amount)} credit at ${top.name} lapses on ${day(top.first)}`
      : `⏳ Store credit at ${shops.length} shops lapses soon`,
    body: shops.length === 1
      ? 'Use it before then - it comes off your next order there on its own.'
      : shops.map((shop) => `${rupees(shop.amount)} at ${shop.name} by ${day(shop.first)}`).join(' · '),
    link: '/wallet',
  });
  return due.length;
}

/**
 * The site-wide pass, at most once every quarter of an hour. Cheap to call on
 * every page load: almost always it returns at the first line.
 */
export async function sweepLapsing(repository: Repo, now = Date.now()): Promise<number> {
  if (now - lastSweep < SWEEP_EVERY_MS) return 0;
  lastSweep = now;
  // The stamp is shared, so the instances do not all sweep the same quarter.
  const stamp = await repository.getSiteContent(SWEEP_STAMP);
  const was = Date.parse(((stamp?.data as { at?: string } | undefined)?.at) ?? '') || 0;
  if (now - was < SWEEP_EVERY_MS) return 0;
  const at = new Date(now).toISOString();
  await repository.saveSiteContent({ id: SWEEP_STAMP, data: { at }, updatedBy: 'system', createdAt: stamp?.createdAt ?? at, updatedAt: at });
  const ids = await repository.listUserIdsWithLapsingCredit(at, new Date(now + LAPSE_REMINDER_MS).toISOString(), SWEEP_BATCH);
  let told = 0;
  for (const id of ids) {
    try {
      told += (await remindLapsing(repository, id, now)) > 0 ? 1 : 0;
    } catch {
      // One account that will not save is left for the next pass.
    }
  }
  return told;
}

/** Forget when this instance last swept, for tests. */
export function resetLapseSweep() {
  lastSweep = 0;
  visited.clear();
}
