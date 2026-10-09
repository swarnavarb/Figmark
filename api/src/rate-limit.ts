import { createHash } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import { getRepository } from './data/index.js';
import { error } from './functions/http.js';

/**
 * How often one account, or one address, may do one thing.
 *
 * Counted twice. Each host instance keeps its own sliding window in memory,
 * which is free and stops one script hammering one worker. Behind it, when
 * the store can keep them, are fixed-window counters every instance shares,
 * so a limit holds across a scaled-out deployment and survives a restart -
 * it is not reset by landing on a different worker. If the store cannot be
 * reached the local count still applies: a limit that fails open is better
 * than an endpoint that fails closed.
 */
export type Action = 'post' | 'comment' | 'react' | 'share' | 'message' | 'want' | 'offer' | 'push_test' | 'chatphoto' | 'photosearch'
  | 'verify_email' | 'verify_code' | 'verify_phone' | 'verify_aadhaar'
  | 'upload' | 'login' | 'signup' | 'login_fail' | 'login_fail_account';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = HOUR * 24;

/** Each action's windows: at most `max` in any `ms`. */
const LIMITS: Record<Action, { max: number; ms: number }[]> = {
  post: [{ max: 10, ms: MINUTE }, { max: 60, ms: HOUR }],
  comment: [{ max: 20, ms: MINUTE }, { max: 200, ms: HOUR }],
  react: [{ max: 60, ms: MINUTE }],
  share: [{ max: 20, ms: MINUTE }],
  message: [{ max: 30, ms: MINUTE }, { max: 300, ms: HOUR }],
  want: [{ max: 10, ms: HOUR }],
  offer: [{ max: 30, ms: HOUR }],
  push_test: [{ max: 5, ms: MINUTE }],
  chatphoto: [{ max: 20, ms: MINUTE }, { max: 150, ms: HOUR }],
  // Each one may be a call to Claude, which is paid for.
  photosearch: [{ max: 10, ms: MINUTE }, { max: 60, ms: HOUR }],
  // Each email sent counts against the free daily quota.
  verify_email: [{ max: 3, ms: 600_000 }, { max: 8, ms: DAY }],
  verify_code: [{ max: 10, ms: 600_000 }],
  verify_phone: [{ max: 10, ms: HOUR }],
  verify_aadhaar: [{ max: 10, ms: HOUR }],
  // Every photo is stored, and paid for, until someone deletes it. A busy
  // shop listing forty items with six photos each stays well inside these.
  upload: [{ max: 30, ms: MINUTE }, { max: 400, ms: HOUR }, { max: 1500, ms: DAY }],
  // Per address, across every account tried from it: what stops one machine
  // guessing passwords for many accounts, or opening accounts by the hundred.
  // Generous, because a mobile carrier puts thousands of people behind one
  // address and they must not be refused for each other.
  login: [{ max: 30, ms: MINUTE }, { max: 300, ms: HOUR }],
  signup: [{ max: 20, ms: HOUR }, { max: 100, ms: DAY }],
  // Wrong passwords for one account from one address. Keyed by both, so
  // nobody can lock somebody else out by typing their email badly on purpose.
  login_fail: [{ max: 8, ms: 600_000 }],
  // Wrong passwords for one account from anywhere, counted only for devices
  // that have never signed in to it - so guessing spread over many addresses
  // is still capped, and the owner's own browser is never held back by it.
  login_fail_account: [{ max: 20, ms: 900_000 }, { max: 100, ms: DAY }],
};

const LONGEST_MS = Math.max(...Object.values(LIMITS).flat().map((limit) => limit.ms));

/** When each subject last did each thing, newest last. */
const seen = new Map<string, number[]>();
let sweptAt = 0;

/** Off only where a test does a day's worth of posting in a second. */
const enabled = () => process.env.FIGMARK_RATE_LIMITS !== 'off';

function waitFor(ms: number): string {
  if (ms >= DAY) return 'tomorrow';
  if (ms >= HOUR) return 'an hour';
  if (ms > MINUTE) return `${Math.round(ms / MINUTE)} minutes`;
  return 'a minute';
}

/**
 * Count one `action` by `subject`, or say how long to wait.
 *
 * With `count: false` it only asks - nothing is recorded - which is how a
 * sign-in checks for a lockout before it knows whether the password was wrong.
 * A refused attempt is not counted, so waiting is all it takes.
 */
export async function limited(
  subject: string,
  action: Action,
  options: { count?: boolean; now?: number; force?: boolean } = {},
): Promise<string | null> {
  if (!enabled() && !options.force) return null;
  const count = options.count !== false;
  const now = options.now ?? Date.now();
  sweep(now);

  const key = `${action}:${subject}`;
  const times = (seen.get(key) ?? []).filter((at) => now - at < LONGEST_MS);
  for (const limit of LIMITS[action]) {
    if (times.filter((at) => now - at < limit.ms).length >= limit.max) {
      seen.set(key, times);
      return waitFor(limit.ms);
    }
  }
  if (count) times.push(now);
  seen.set(key, times);

  const shared = await sharedLimit(subject, action, count, now);
  if (shared && count) {
    times.pop();
    seen.set(key, times);
  }
  return shared;
}

/** Count one `action` by `userId`, or the refusal to send back. */
export async function tooFast(userId: string, action: Action, now = Date.now()): Promise<ReturnType<typeof error> | null> {
  const wait = await limited(userId, action, { now });
  return wait ? error(429, 'slow_down', `That is a lot in a short time. Try again in ${wait}.`) : null;
}

/**
 * The same windows, counted in the store so every instance sees them.
 *
 * Fixed windows rather than sliding ones: one counter per window per subject
 * is a single patch, where a sliding window would be a list to rewrite.
 * Subjects are hashed - an email address has no business in a counter.
 */
async function sharedLimit(subject: string, action: Action, count: boolean, now: number): Promise<string | null> {
  let repository;
  try {
    repository = await getRepository();
  } catch {
    return null;
  }
  const digest = createHash('sha256').update(subject).digest('base64url').slice(0, 22);
  const bumped: string[] = [];
  try {
    for (const limit of LIMITS[action]) {
      const id = `rl:${action}:${digest}:${limit.ms}:${Math.floor(now / limit.ms)}`;
      const ttl = Math.ceil(limit.ms / 1000) + 60;
      const total = await repository.bumpCounter(id, count ? 1 : 0, ttl);
      if (total === null) return null;
      if (count) bumped.push(id);
      if (count ? total > limit.max : total >= limit.max) {
        // Refused attempts are not counted: take this one back off.
        for (const taken of bumped) void repository.bumpCounter(taken, -1, ttl).catch(() => undefined);
        return waitFor(limit.ms);
      }
    }
  } catch {
    // The store is unreachable or refusing; the local count still stands.
    return null;
  }
  return null;
}

/** Drop subjects that have been quiet for longer than any window, now and then. */
function sweep(now: number) {
  if (now - sweptAt < MINUTE) return;
  sweptAt = now;
  for (const [key, times] of seen) {
    if (times.every((at) => now - at >= LONGEST_MS)) seen.delete(key);
  }
}

/** Forget a subject's record for one action - a correct password clears its failures. */
export async function forget(subject: string, action: Action): Promise<void> {
  seen.delete(`${action}:${subject}`);
  try {
    const repository = await getRepository();
    const digest = createHash('sha256').update(subject).digest('base64url').slice(0, 22);
    const now = Date.now();
    for (const limit of LIMITS[action]) {
      const id = `rl:${action}:${digest}:${limit.ms}:${Math.floor(now / limit.ms)}`;
      const total = await repository.bumpCounter(id, 0, 1);
      if (total) await repository.bumpCounter(id, -total, 1);
    }
  } catch {
    // Best effort: the window expires on its own.
  }
}

/**
 * The address a request came from, as the platform reports it.
 *
 * Azure's front ends set `x-azure-clientip` and `x-client-ip` themselves; the
 * first `x-forwarded-for` entry is the fallback. A port, if one is attached,
 * is dropped. 'unknown' when nothing says - every such request then shares
 * one bucket, which errs towards limiting.
 */
export function clientIp(request: HttpRequest): string {
  const raw = request.headers.get('x-azure-clientip')
    ?? request.headers.get('x-client-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]
    ?? '';
  const value = raw.trim();
  if (!value) return 'unknown';
  // IPv4 with a port; a bracketed IPv6 with a port; anything else as it came.
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4) return v4[1]!;
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (v6) return v6[1]!;
  return value;
}

/** Forget everything, for tests. */
export function resetRateLimits() {
  seen.clear();
}
