import type { PlayerRow } from './play.js';
import { tagKey } from './shop-tags.js';

/**
 * What one person has told the feed about themselves: who they would rather
 * not hear from, what they put away to read again, and where they got up to.
 *
 * Kept on the account rather than in a container of its own: the database is
 * at its container ceiling, every list here is short and bounded, and the
 * feed reads the account anyway to know who is asking.
 */
export interface FeedPrefs {
  /**
   * Channels and authors kept out of Discover, the feed's found posts and
   * suggestions: a shop's id, or a person's. Their own channel, if you follow
   * it, is left alone - unfollowing is how you stop reading somebody you chose.
   */
  muted?: string[];
  /** Posts put out of sight, by id. */
  hidden?: string[];
  /**
   * Authors whose posts were marked "not interested". Not a mute: their posts
   * still turn up, just lower, so one dull post does not cost a whole shop.
   */
  lessFrom?: string[];
  /** Posts saved to read again, newest first. */
  saved?: SavedPostRef[];
  /**
   * The newest followed post this person had been shown when they last opened
   * the feed, so the next visit can say where the new ones stop.
   */
  seenFeedAt?: string | null;
}

export interface SavedPostRef {
  channelId: string;
  postId: string;
  savedAt: string;
}

export const MUTED_MAX = 500;
export const HIDDEN_MAX = 1_000;
export const LESS_FROM_MAX = 200;
export const SAVED_POSTS_MAX = 500;

/** Put something at the front of a bounded list, without repeating it. */
export function pushCapped<T>(list: readonly T[] | undefined, item: T, max: number, same: (a: T, b: T) => boolean = Object.is): T[] {
  return [item, ...(list ?? []).filter((entry) => !same(entry, item))].slice(0, max);
}

/**
 * The handles named in a piece of text, lowercased, each once.
 *
 * An @ counts only at the start of a word, so an email address is not a
 * mention; the handle is read the way handles are made (see USERNAME_PATTERN),
 * with a trailing full stop left to the sentence.
 */
export function mentionsIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    const handle = match[2]!.toLowerCase().replace(/[._]+$/, '');
    if (handle.length >= 3) found.add(handle);
  }
  return [...found];
}

/** Most people one post or comment may mention, so a mention stays a nudge rather than a mailshot. */
export const MENTIONS_MAX = 10;

export const MENTION = /(^|[^\p{L}\p{N}_@./])@([a-z0-9][a-z0-9_.]{1,29})/giu;

/**
 * The topics a post files itself under: its #words, keyed the way shop tags
 * are, so "#ResinKits" on a post and "resin kit" on a shop are one topic.
 */
export function hashtagsIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(HASHTAG)) {
    // CamelCase is how a hashtag spells a space.
    const key = tagKey(match[2]!.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '));
    if (key.length >= 2) found.add(key);
  }
  return [...found];
}

export const HASHTAG = /(^|[^\p{L}\p{N}_#&/])#([\p{L}\p{N}_]{2,40})/gu;

/** One topic people are posting under, for the chips on Discover. */
export interface TopicChip {
  key: string;
  label: string;
  posts: number;
}

/** A person or shop worth following, and the one line that says why. */
export interface FollowSuggestion {
  /** What the follow button sends: a shop's id, or `person:<id>`. */
  followKey: string;
  id: string;
  name: string;
  handle: string | null;
  photoUrl: string | null;
  shop: boolean;
  followerCount: number;
  reason: string;
}

/** A hunt somebody posted, as a Discover rail shows it. */
export interface WantRow {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerHandle: string | null;
  title: string;
  category: string;
  budgetMinor: number | null;
  currency: string;
  photoUrl: string | null;
  seekerCount: number;
  offerCount: number;
  /** Why it is shown to this person: it is what they sell, or what they collect. */
  why: string | null;
}

/** An item somebody showed off or argued about that can be bought right now. */
export interface SpottedItem {
  listingId: string;
  title: string;
  priceMinor: number;
  currency: string;
  photoUrl: string | null;
  /** Where it was seen. */
  postId: string;
  channelId: string;
  spottedBy: string;
  how: 'flex' | 'debate' | 'sale';
}

/** One week's best, from what people reacted to and voted on. */
export interface Leaderboard {
  since: string;
  /** Collections, most loved first. */
  shelves: { postId: string; channelId: string; name: string; photoUrl: string | null; reactions: number }[];
  /** Debates, most voted first. */
  debates: { postId: string; channelId: string; question: string; votes: number; leading: string | null }[];
  /** People and shops whose posts drew the most this week. */
  voices: { id: string; name: string; handle: string | null; shop: boolean; reactions: number; posts: number }[];
  /** Who is winning the games: competitions, debates, guesses, and every vote cast. */
  players?: PlayerRow[];
}

/**
 * What the reader did with a post on screen, sent in batches: it was shown,
 * and for how long it stayed on screen, and whether it was opened.
 */
export interface SeenEntry {
  channelId: string;
  postId: string;
  /** Milliseconds it was at least half on screen. */
  ms: number;
  opened?: boolean;
}

export const SEEN_BATCH_MAX = 50;
/** A post on screen longer than this was left there, not read. */
export const SEEN_MS_MAX = 60_000;
