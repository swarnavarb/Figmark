import type { Post, User } from '../../shared/models.js';
import {
  TASTE_CHANNELS_MAX, TASTE_HALF_LIFE_DAYS, TASTE_KINDS_MAX, TASTE_TOPICS_MAX,
  type FeedPrefs, type FeedTaste,
} from '../../shared/feed.js';

/**
 * One person's feed preferences, read into sets once per request.
 *
 * Everything that shows posts from people the viewer did not choose -
 * Discover, the found posts in the feed, suggestions - asks `screens` before
 * showing one, and `lift` how far down a "not interested" pushes it.
 */
export interface FeedScreen {
  muted: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  lessFrom: ReadonlySet<string>;
  /** Where each "less from" sits in the list, newest = 0: how recently it was said. */
  lessRank: ReadonlyMap<string, number>;
  /** Topics asked to hear less about. */
  lessTopics: ReadonlySet<string>;
  saved: ReadonlySet<string>;
}

export const NO_SCREEN: FeedScreen = {
  muted: new Set(), hidden: new Set(), lessFrom: new Set(), lessRank: new Map(), lessTopics: new Set(), saved: new Set(),
};

export function screenOf(user: Pick<User, 'feedPrefs'> | null | undefined): FeedScreen {
  const prefs: FeedPrefs = user?.feedPrefs ?? {};
  const lessFrom = prefs.lessFrom ?? [];
  return {
    muted: new Set(prefs.muted ?? []),
    hidden: new Set(prefs.hidden ?? []),
    lessFrom: new Set(lessFrom),
    lessRank: new Map(lessFrom.map((id, index) => [id, index] as const)),
    lessTopics: new Set(prefs.lessTopics ?? []),
    saved: new Set((prefs.saved ?? []).map((entry) => entry.postId)),
  };
}

/**
 * Whether a post is kept out of sight: hidden itself, or said by somebody
 * muted - in their channel, or by them anywhere. A repost of a hidden post
 * goes with it, so "hide" is not undone by the next person passing it on.
 */
export function screens(screen: FeedScreen, post: Post): boolean {
  if (screen.hidden.has(post.id)) return true;
  if (post.repostOf && screen.hidden.has(post.repostOf.postId)) return true;
  if (screen.muted.has(post.authorId)) return true;
  return post.channel === 'seller' && screen.muted.has(post.channelId);
}

/** How much less of somebody a "not interested" means: well down, not gone. */
export const LESS_FROM_LIFT = 0.35;

export function lessFrom(screen: FeedScreen, post: Post): boolean {
  return screen.lessFrom.has(post.authorId) || (post.channel === 'seller' && screen.lessFrom.has(post.channelId));
}

/**
 * How far down a "not interested" still pushes a post, given how long ago it
 * was said. The list is newest first, so position stands in for age: the most
 * recent ones bite hardest and each older one fades back towards neutral,
 * until the 60th is forgiven. A dull post should not cost a shop for ever.
 */
export const LESS_FROM_FADE = 60;

export function lessFromLift(screen: FeedScreen, post: Post): number {
  const rank = [post.authorId, post.channel === 'seller' ? post.channelId : null]
    .reduce<number | null>((best, id) => {
      const at = id ? screen.lessRank.get(id) : undefined;
      return at === undefined ? best : best === null ? at : Math.min(best, at);
    }, null);
  if (rank === null) return 1;
  return LESS_FROM_LIFT + (1 - LESS_FROM_LIFT) * Math.min(1, rank / LESS_FROM_FADE);
}

/** How much a topic marked "less like this" lowers a post that carries it. */
export const LESS_TOPIC_LIFT = 0.5;

export function lessTopicLift(screen: FeedScreen, topics: readonly string[]): number {
  return topics.some((topic) => screen.lessTopics.has(topic)) ? LESS_TOPIC_LIFT : 1;
}

/* ── taste: what holds this person's attention ───────────────────────────── */

const DAY_MS = 86_400_000;

/** This person's taste with the time since it was written taken off every weight. */
export function tasteAt(taste: FeedTaste | undefined, now: number): FeedTaste {
  if (!taste) return { topics: {}, kinds: {}, channels: {}, at: new Date(now).toISOString() };
  const age = Math.max(0, now - Date.parse(taste.at));
  const keep = Math.pow(0.5, age / (TASTE_HALF_LIFE_DAYS * DAY_MS));
  const fade = (table: Record<string, number>) => Object.fromEntries(
    Object.entries(table).map(([key, weight]) => [key, weight * keep] as const).filter(([, weight]) => Math.abs(weight) >= 0.02),
  );
  return { topics: fade(taste.topics), kinds: fade(taste.kinds), channels: fade(taste.channels), at: taste.at };
}

/** What one post told us about its reader: where, what format, which topics, and how strongly. */
export interface TasteSignal {
  channelId: string;
  kind: string;
  topics: readonly string[];
  /** Positive for attention, negative for putting it away. */
  weight: number;
}

const WEIGHT_CAP = 8;

function bump(table: Record<string, number>, key: string, by: number) {
  table[key] = Math.max(-WEIGHT_CAP, Math.min(WEIGHT_CAP, (table[key] ?? 0) + by));
}

/** Keep the strongest `max` entries by size, so the table stays small however long it is fed. */
function strongest(table: Record<string, number>, max: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(table)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, max)
      .map(([key, weight]) => [key, Math.round(weight * 100) / 100] as const),
  );
}

/** Age the taste to now, add what was just learned, and trim it. */
export function learnTaste(taste: FeedTaste | undefined, signals: readonly TasteSignal[], now: number): FeedTaste {
  const next = tasteAt(taste, now);
  for (const signal of signals) {
    if (!signal.weight) continue;
    bump(next.channels, signal.channelId, signal.weight);
    bump(next.kinds, signal.kind, signal.weight * 0.6);
    // A post's weight is shared among its topics, so a post with ten tags does not outshout one with two.
    const share = signal.weight / Math.max(1, Math.sqrt(signal.topics.length));
    for (const topic of signal.topics) bump(next.topics, topic, share);
  }
  return {
    topics: strongest(next.topics, TASTE_TOPICS_MAX),
    kinds: strongest(next.kinds, TASTE_KINDS_MAX),
    channels: strongest(next.channels, TASTE_CHANNELS_MAX),
    at: new Date(now).toISOString(),
  };
}

/**
 * What a reader's time on one post says about them: a glance says nothing,
 * lingering says a little, and opening it says the most. Capped so one long
 * stare cannot define a taste.
 */
export function attentionWeight(ms: number, opened: boolean): number {
  const dwell = Math.min(1, Math.max(0, ms - 1_500) / 15_000) * 0.6;
  return dwell + (opened ? 1 : 0);
}
