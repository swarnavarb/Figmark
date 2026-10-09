import { error } from './functions/http.js';

/**
 * How often one account may do one thing.
 *
 * Kept per host instance, in memory. That is not a guarantee across a scaled
 * out deployment, and it does not try to be: it stops one script hammering
 * one endpoint, which is the abuse that actually shows up - a bot posting a
 * hundred times a minute, or tapping share in a loop to climb trending. A
 * determined spammer spread over many instances is a job for the edge.
 */
export type Action = 'post' | 'comment' | 'react' | 'share' | 'message' | 'want' | 'offer' | 'push_test' | 'chatphoto' | 'photosearch';

/** Each action's windows: at most `max` in any `ms`. */
const LIMITS: Record<Action, { max: number; ms: number }[]> = {
  post: [{ max: 10, ms: 60_000 }, { max: 60, ms: 3_600_000 }],
  comment: [{ max: 20, ms: 60_000 }, { max: 200, ms: 3_600_000 }],
  react: [{ max: 60, ms: 60_000 }],
  share: [{ max: 20, ms: 60_000 }],
  message: [{ max: 30, ms: 60_000 }, { max: 300, ms: 3_600_000 }],
  want: [{ max: 10, ms: 3_600_000 }],
  offer: [{ max: 30, ms: 3_600_000 }],
  push_test: [{ max: 5, ms: 60_000 }],
  chatphoto: [{ max: 20, ms: 60_000 }, { max: 150, ms: 3_600_000 }],
  // Each one may be a call to Claude, which is paid for.
  photosearch: [{ max: 10, ms: 60_000 }, { max: 60, ms: 3_600_000 }],
};

const LONGEST_MS = Math.max(...Object.values(LIMITS).flat().map((limit) => limit.ms));

/** When each account last did each thing, newest last. */
const seen = new Map<string, number[]>();
let sweptAt = 0;

/** Off only where a test does a day's worth of posting in a second. */
const enabled = () => process.env.FIGMARK_RATE_LIMITS !== 'off';

/**
 * Count one `action` by `userId`, or say no.
 *
 * Returns the refusal to send back when they are over a limit, else null. A
 * refused attempt is not counted, so waiting is all it takes.
 */
export function tooFast(userId: string, action: Action, now = Date.now()): ReturnType<typeof error> | null {
  if (!enabled()) return null;
  sweep(now);
  const key = `${action}:${userId}`;
  const times = (seen.get(key) ?? []).filter((at) => now - at < LONGEST_MS);
  for (const limit of LIMITS[action]) {
    if (times.filter((at) => now - at < limit.ms).length >= limit.max) {
      seen.set(key, times);
      const wait = limit.ms >= 3_600_000 ? 'an hour' : 'a minute';
      return error(429, 'slow_down', `That is a lot in a short time. Try again in ${wait}.`);
    }
  }
  times.push(now);
  seen.set(key, times);
  return null;
}

/** Drop accounts that have been quiet for longer than any window, now and then. */
function sweep(now: number) {
  if (now - sweptAt < 60_000) return;
  sweptAt = now;
  for (const [key, times] of seen) {
    if (times.every((at) => now - at >= LONGEST_MS)) seen.delete(key);
  }
}

/** Forget everything, for tests. */
export function resetRateLimits() {
  seen.clear();
}
