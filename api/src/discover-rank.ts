import type { Post } from '../../shared/models.js';
import type { DiscoverWhy, FeedTaste } from '../../shared/feed.js';
import { lessTopicLift, type FeedScreen } from './feed-prefs.js';

/**
 * How Discover decides what to show next, as pure functions.
 *
 * Nothing here reads a database or a request, so every rule can be tested with
 * a handful of posts, and every number that shapes the feed lives in
 * `DISCOVER_TUNING` instead of being scattered through the routes.
 *
 * The aim is an endless stream of things worth stopping for. Three ideas do
 * the work:
 *
 * - excitement, not just popularity: how fast a post is gaining people right
 *   now, and how evenly an argument is split, count for as much as its total;
 * - taste: what this person lingers on, engages with and puts away, so the
 *   same post is worth different amounts to different people;
 * - variety: a greedy pick that charges a post for resembling the last few
 *   chosen, with a slot every few places kept for something unfamiliar.
 */
export const DISCOVER_TUNING = {
  /** Recent posts the stream ranks from. */
  window: 800,
  /**
   * Posts in one page of the stream. Small on purpose: the first screen needs
   * a handful, so a page is cheap to read and to draw, and the next one is
   * fetched while the reader is still on this one.
   */
  pageSize: 12,
  /** A cursor older than this is treated as a fresh visit. */
  cursorMaxAgeMs: 30 * 60_000,

  /** Multipliers from what the reader has done. */
  lift: {
    /** They reacted, commented or voted in this channel lately. */
    affinity: 1.5,
    /** People they follow reacted, commented or voted. */
    followedActed: 1.3,
    /** It sells something they saved. */
    wished: 1.4,
    /** Under an open report, for everybody. */
    reported: 0.3,
    /** It is in a forum they joined. */
    forumMember: 1.35,
    /** They already took part: still worth reading, less worth promoting. */
    played: 0.55,
  },

  /**
   * How far learned taste can move a post, either way. Each signal is squashed
   * into -1..1 and scaled by its number here, so no one signal can run away;
   * the sum is then held between `floor` and `ceiling` as a multiplier.
   */
  taste: {
    topic: 1.0,
    kind: 0.4,
    channel: 0.6,
    floor: 0.45,
    ceiling: 2.6,
    /** Weight an engagement adds to taste when it is read off the post rather than stored. */
    engaged: 1,
  },

  excitement: {
    /** Window "taking off" is measured over. */
    velocityHours: 6,
    /** How much a burst of recent reactions is worth, on a log scale. */
    velocity: 0.9,
    /** How much an evenly split poll is worth. */
    contested: 0.7,
    /** Votes before a split means anything. */
    contestedVotes: 4,
    /**
     * A floor under every post, so ones nobody has touched yet still have a
     * place in the stream and the newest of them come first.
     */
    baseline: 0.15,
    /** A scarce listing a post is selling: the last one or two. */
    scarce: 0.2,
  },

  /** What a post pays for resembling the ones just chosen. */
  diversity: {
    channel: 0.5,
    author: 0.65,
    format: 0.8,
    topic: 0.82,
    /** Places back the same channel or author is remembered. */
    lookback: 8,
    formatLookback: 3,
    topicLookback: 5,
  },

  /** Every n-th place goes to something outside the reader's usual. */
  explore: {
    every: 5,
    /** The explorers drawn from: the best this many by score. */
    pool: 30,
    /** A post shown to fewer people than this is still undiscovered. */
    undiscoveredViews: 25,
  },

  /** How wide a new post is tried before it has earned more. */
  rising: {
    /** Percent of readers a new post starts with. */
    seed: 15,
    max: 60,
    /** Views before its record is allowed to move that. */
    minViews: 20,
    /** Engagements per view that keep the audience at `seed`. */
    targetRate: 0.05,
  },

  /**
   * When everything new has been shown, the stream goes round again with the
   * older posts that did best - a lap - and then again, in a different order
   * each time. It reaches further back than the fresh stream does, so the
   * first lap is mostly posts the reader never saw.
   */
  replay: {
    /** Posts a lap ranks from. */
    window: 2000,
    /** Fewer eligible posts than this and going round again would only repeat a few: the stream ends instead. */
    minPool: 6,
    /** How far a post's place within a lap moves from lap to lap, as a share of its score. */
    shuffle: 0.5,
    /** Laps a visit may go round: a long way past anybody's patience. */
    maxLaps: 50,
    /** Under every post's popularity, so one nobody touched can still be placed. */
    floor: 0.05,
  },

  /** Stable orderings kept so a visit's pages agree with each other. */
  snapshot: { ttlMs: 2 * 60_000, max: 300 },
} as const;

const T = DISCOVER_TUNING;

/* ── formats ─────────────────────────────────────────────────────────────── */

export type PostFormat = 'debate' | 'flex' | 'contest' | 'guess' | 'poll' | 'sale' | 'thread' | 'photo' | 'text';

/** What a post is, as far as variety goes: two debates in a row is a run, a debate then a photo is not. */
export function formatOf(post: Post): PostFormat {
  if (post.debate) return 'debate';
  if (post.flex) return 'flex';
  if (post.contest) return 'contest';
  if (post.guess) return 'guess';
  if (post.poll) return 'poll';
  if (post.kind === 'sale' || post.listingId) return 'sale';
  if (post.channel === 'forum') return 'thread';
  if (post.photoUrl) return 'photo';
  return 'text';
}

/* ── excitement ──────────────────────────────────────────────────────────── */

/** Reactions and comments from the last few hours, per hour: how fast people are arriving. */
export function velocity(post: Post, now: number, hours: number = T.excitement.velocityHours): number {
  const since = now - hours * 3_600_000;
  let arrivals = 0;
  for (const reaction of post.reactions ?? []) if (Date.parse(reaction.at) >= since) arrivals += 1;
  // A comment costs a sentence, a reaction a tap.
  for (const comment of post.comments ?? []) if (Date.parse(comment.createdAt) >= since) arrivals += 2;
  return arrivals / hours;
}

/** How evenly a poll is split, 0 (a landslide, or too few votes to say) to 1 (neck and neck with many votes). */
export function contestedness(post: Post): number {
  const options = post.poll?.options ?? [];
  if (options.length < 2) return 0;
  const votes = options.map((option) => option.voterIds.length).sort((a, b) => b - a);
  const total = votes.reduce((sum, count) => sum + count, 0);
  if (total < T.excitement.contestedVotes) return 0;
  const gap = (votes[0]! - votes[1]!) / (votes[0]! + votes[1]! || 1);
  return (1 - gap) * Math.min(1, total / 12);
}

/**
 * How exciting a post is right now: its heat, plus a floor so the untouched
 * still rank, multiplied up when people are piling in this minute or an
 * argument is too close to call.
 */
export function excitement(post: Post, now: number, heat: number): number {
  const X = T.excitement;
  const hours = Math.max(0, (now - Date.parse(post.createdAt)) / 3_600_000);
  const floor = X.baseline / Math.pow(hours / 24 + 1, 0.6);
  const rush = Math.log1p(Math.min(6, velocity(post, now)));
  return (heat + floor) * (1 + X.velocity * rush + X.contested * contestedness(post));
}

/**
 * What a post earned over its whole life, with the discount for age taken off:
 * `heat` divided by the same decay `heat` applied. A week-old post that
 * people loved is as popular as it ever was; it only stopped being new.
 */
export function evergreen(post: Post, now: number, heat: number): number {
  const hours = Math.max(0, (now - Date.parse(post.createdAt)) / 3_600_000);
  return heat * Math.pow(hours / 24 + 1, 0.6);
}

/**
 * Moves a post's place in a lap a little, differently each lap and each
 * visit, so going round again is not the same list read twice. 1 +/- shuffle/2.
 */
export function shuffleBy(seed: string, lap: number, id: string): number {
  const unit = hashOf(`${seed}:${lap}:${id}`) / 4_294_967_296;
  return 1 - T.replay.shuffle / 2 + T.replay.shuffle * unit;
}

/* ── the rising bandit ───────────────────────────────────────────────────── */

/**
 * Percent of readers a new post is tried on.
 *
 * It starts at `seed`. Once it has been seen enough to judge, the share moves
 * with how many views turn into a reaction, comment or vote: a post that
 * lands is shown to more people, one that is scrolled past is shown to fewer,
 * down to none. So a good newcomer is found fast and a dud stops costing
 * everybody a place.
 */
export function risingSeedPercent(post: Post): number {
  const R = T.rising;
  const views = post.views ?? 0;
  if (views < R.minViews) return R.seed;
  const votes = post.poll?.options.reduce((sum, option) => sum + option.voterIds.length, 0) ?? 0;
  const engaged = (post.reactions?.length ?? post.likeCount) + (post.comments?.length ?? post.replyCount) + votes;
  const rate = engaged / views;
  return Math.max(0, Math.min(R.max, Math.round((R.seed * rate) / R.targetRate)));
}

/* ── the engagement index, shared between requests ───────────────────────── */

/** Who engaged with what, worked out once for a set of posts and reused while they do not change. */
export interface EngagementIndex {
  /** Who reacted, commented or voted on each post (not its author). */
  actors: ReadonlyMap<string, ReadonlySet<string>>;
  /** The posts each actor engaged with. */
  byActor: ReadonlyMap<string, readonly string[]>;
  topics: ReadonlyMap<string, readonly string[]>;
}

/** A short fingerprint of everything on a post that ranking reads, to tell whether a cached index is still true. */
export function fingerprint(posts: readonly Post[]): string {
  let hash = 0x811c9dc5;
  const mix = (text: string) => {
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  };
  for (const post of posts) {
    const votes = post.poll?.options.reduce((sum, option) => sum + option.voterIds.length, 0) ?? 0;
    mix(`${post.id}|${post.likeCount}|${post.replyCount}|${post.reactions?.length ?? ''}|${post.comments?.length ?? ''}|`
      + `${post.views ?? ''}|${post.opens ?? ''}|${post.dwellMs ?? ''}|${post.shareCount ?? ''}|${post.buyCount ?? ''}|`
      + `${votes}|${post.guess?.guesses.length ?? ''}|${post.contest?.entries.length ?? ''}|${post.body.length}\n`);
  }
  return `${posts.length}:${(hash >>> 0).toString(36)}`;
}

const indexes = new Map<string, EngagementIndex>();

/**
 * The engagement index for these posts: rebuilt only when something on one of
 * them changed. A page of Discover asks for it on every request; building it
 * means walking every reaction and comment on every post, which is the part
 * worth not repeating.
 */
export function indexOf(
  posts: readonly Post[],
  actorsOf: (post: Post) => ReadonlySet<string>,
  topicsOf: (post: Post) => readonly string[],
): EngagementIndex {
  const key = fingerprint(posts);
  const cached = indexes.get(key);
  if (cached) return cached;
  const actors = new Map<string, ReadonlySet<string>>();
  const byActor = new Map<string, string[]>();
  const topics = new Map<string, readonly string[]>();
  for (const post of posts) {
    const who = actorsOf(post);
    actors.set(post.id, who);
    topics.set(post.id, topicsOf(post));
    for (const actor of who) {
      const list = byActor.get(actor);
      if (list) list.push(post.id);
      else byActor.set(actor, [post.id]);
    }
  }
  const built: EngagementIndex = { actors, byActor, topics };
  indexes.set(key, built);
  // A handful is plenty: requests a moment apart share one, and a changed feed makes a new one.
  while (indexes.size > 4) indexes.delete(indexes.keys().next().value!);
  return built;
}

/* ── taste ───────────────────────────────────────────────────────────────── */

/** What a reader's own reactions, comments and votes say about where their interest is. */
export interface Engaged {
  channels: Set<string>;
  topics: Map<string, number>;
  formats: Map<string, number>;
}

/**
 * How much more or less a post is worth to this reader for what it is about,
 * what format it is and where it was said, from what they have lingered on
 * (stored taste) and what they have taken part in (read off the posts).
 * Each part is squashed so no one signal can run away, and the whole is held
 * between a floor and a ceiling.
 */
export function tasteLiftFor(taste: FeedTaste, taken: Engaged, screen: FeedScreen) {
  const K = DISCOVER_TUNING.taste;
  return (post: Post, topics: readonly string[]): number => {
    let sum = 0;
    for (const topic of topics) {
      const weight = (taste.topics[topic] ?? 0) + (taken.topics.get(topic) ?? 0);
      sum += weight;
    }
    const topicSignal = topics.length ? sum / Math.sqrt(topics.length) : 0;
    const format = formatOf(post);
    const formatSignal = (taste.kinds[format] ?? 0) + (taken.formats.get(format) ?? 0) * 0.5;
    const channelSignal = taste.channels[post.channelId] ?? 0;
    const raw = K.topic * Math.tanh(topicSignal / 3) + K.kind * Math.tanh(formatSignal / 3) + K.channel * Math.tanh(channelSignal / 3);
    const shown = Math.max(K.floor, Math.min(K.ceiling, 1 + raw)) * lessTopicLift(screen, topics);
    return shown;
  };
}

/* ── the stream ──────────────────────────────────────────────────────────── */

/** A post in the running for the stream, with what ranking needs to know about it. */
export interface Candidate {
  id: string;
  /** What it is worth to this reader before variety is considered. */
  score: number;
  channel: string;
  author: string;
  format: PostFormat;
  topics: readonly string[];
  /** Outside their usual, and so eligible for an exploration slot. */
  explorer: boolean;
}

export interface Placed {
  id: string;
  /** It was put here as an exploration pick rather than on its score. */
  explore: boolean;
}

/** A stable number from a string. */
export function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** What `next` pays for resembling what was just placed: 1 for nothing in common. */
export function repeatPenalty(next: Candidate, placed: readonly Candidate[]): number {
  const D = T.diversity;
  const end = placed.length;
  let penalty = 1;
  for (let i = Math.max(0, end - D.lookback); i < end; i += 1) {
    const earlier = placed[i]!;
    if (earlier.channel === next.channel) penalty *= D.channel;
    else if (earlier.author === next.author) penalty *= D.author;
  }
  for (let i = Math.max(0, end - D.formatLookback); i < end; i += 1) if (placed[i]!.format === next.format) penalty *= D.format;
  // Sharing any topic with the last few is charged once, however many it shares.
  if (next.topics.length) {
    search: for (let i = Math.max(0, end - D.topicLookback); i < end; i += 1) {
      for (const topic of placed[i]!.topics) {
        if (next.topics.includes(topic)) {
          penalty *= D.topic;
          break search;
        }
      }
    }
  }
  return penalty;
}

/**
 * Put candidates in order: best score first, each pick charged for looking
 * like the last few, and every `explore.every`-th place given to one of the
 * best unfamiliar posts, drawn by a hash of `seed` and the place so the same
 * visit always draws the same ones.
 *
 * `before` is what a reader has already been given on earlier pages, in
 * order: it is not moved, it shapes what comes next, and `limit` more places
 * are filled after it.
 */
export function rankStream(candidates: readonly Candidate[], limit: number, seed: string, before: readonly Candidate[] = []): Placed[] {
  const X = T.explore;
  const given = new Set(before.map((candidate) => candidate.id));
  // Variety can promote something below the top, but not from the far tail.
  const remaining = candidates
    .filter((candidate) => !given.has(candidate.id))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit + 200);
  // Places already given still count: for how the next one should vary, and for which place it is.
  const placed: Candidate[] = [...before];
  const out: Placed[] = [];
  while (out.length < limit && remaining.length) {
    const place = before.length + out.length;
    let chosen = -1;
    let explore = false;
    if ((place + 1) % X.every === 0) {
      const explorers: number[] = [];
      for (let i = 0; i < remaining.length && explorers.length < X.pool; i += 1) if (remaining[i]!.explorer) explorers.push(i);
      if (explorers.length) {
        chosen = explorers[hashOf(`${seed}:${place}`) % explorers.length]!;
        explore = true;
      }
    }
    if (chosen < 0) {
      let best = -Infinity;
      for (let i = 0; i < remaining.length; i += 1) {
        const worth = remaining[i]!.score * repeatPenalty(remaining[i]!, placed);
        if (worth > best) {
          best = worth;
          chosen = i;
        }
      }
    }
    const [picked] = remaining.splice(chosen, 1);
    placed.push(picked!);
    out.push({ id: picked!.id, explore });
  }
  return out;
}

/* ── stable pages: a cursor and a remembered ordering ────────────────────── */

export interface Cursor {
  /** The moment the visit began: every page is ranked as of then. */
  at: number;
  offset: number;
  /** Chooses the exploration picks, so they hold still between pages. */
  seed: string;
  /** 0 while there is something new to show; 1, 2... for each time round the older ones again. */
  lap: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.offset, cursor.seed, cursor.lap])).toString('base64url');
}

/** Read a cursor from a query, or null when it is missing, mangled, or from too long ago. */
export function decodeCursor(raw: string | null | undefined, now: number): Cursor | null {
  if (!raw || raw.length > 200) return null;
  try {
    const [at, offset, seed, lap = 0] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown[];
    if (typeof at !== 'number' || typeof offset !== 'number' || typeof seed !== 'string' || typeof lap !== 'number') return null;
    if (!Number.isFinite(at) || !Number.isFinite(offset) || !Number.isFinite(lap) || seed.length > 64) return null;
    if (at > now || now - at > T.cursorMaxAgeMs) return null;
    return {
      at: Math.floor(at),
      offset: Math.max(0, Math.min(T.replay.window, Math.floor(offset))),
      seed,
      lap: Math.max(0, Math.min(T.replay.maxLaps, Math.floor(lap))),
    };
  } catch {
    return null;
  }
}

const snapshots = new Map<string, { at: number; placed: Placed[] }>();

/** The ordering a visit's earlier pages used, if it is still remembered. */
export function readSnapshot(key: string, now: number): Placed[] | null {
  const found = snapshots.get(key);
  if (!found) return null;
  if (now - found.at > T.snapshot.ttlMs) {
    snapshots.delete(key);
    return null;
  }
  return found.placed;
}

export function writeSnapshot(key: string, placed: Placed[], now: number) {
  snapshots.delete(key);
  snapshots.set(key, { at: now, placed });
  while (snapshots.size > T.snapshot.max) snapshots.delete(snapshots.keys().next().value!);
}

/** Forget every remembered ordering and index. For tests. */
export function resetDiscoverCaches() {
  snapshots.clear();
  indexes.clear();
}

/* ── saying why ──────────────────────────────────────────────────────────── */

/**
 * What is known about a post, and the few things the reader chose in the open
 * (a forum they joined, people they follow), from which its one line is made.
 * Nothing here is what the reader has been learned to like or engage with.
 */
export interface WhyFacts {
  /** Milliseconds until whatever is open on it closes, or null. */
  endsInMs: number | null;
  live: boolean;
  /** What is open on it, when something is: a competition, a guess, or a poll. */
  play: 'contest' | 'guess' | 'poll' | null;
  /** People they follow who took part. */
  followedActed: number;
  forumJoined: boolean;
  contested: number;
  velocity: number;
  rising: boolean;
  explore: boolean;
  /** It is from further back, shown again for how well it did. */
  replay: boolean;
  /** How many are left of the item it sells, when few enough to say. */
  left: number | null;
  /** A group pre-order's fill. */
  fill: { joined: number; total: number } | null;
  /** What can be won by taking part while it is open. */
  prize: 'contest' | 'debate' | 'reward' | null;
  /** Times the item was bought from this post. */
  bought: number;
  /** Times it was passed on. */
  shared: number;
  comments: number;
  /** How long ago it was posted. */
  ageMs: number;
}

/** The numbers at which a plain fact about a post is worth a line. */
export const WHY_AT = {
  /** The last few of an item. */
  scarce: 3,
  /** A pre-order this full, and not yet full. */
  filling: 0.5,
  bought: 3,
  shared: 3,
  comments: 8,
  /** Posted this recently. */
  freshMs: 60 * 60_000,
} as const;

function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * The one line that says why a post is here, strongest reason first, or null
 * when there is nothing honest to say.
 *
 * It never names what the reader has been learned to like. Their taste moves
 * the ranking, but a line such as "Because you like #resin" would tell anybody
 * looking over their shoulder what they linger on - so the reasons given are
 * about the post (closing soon, the last few left, a prize to win, too close to
 * call, taking off, bought or shared or talked about) or about things the
 * reader chose in the open (a forum they joined, people they follow). The same
 * goes for what they engage with: "from someone you engage with" is not said.
 */
export function whyOf(facts: WhyFacts): DiscoverWhy | null {
  const W = WHY_AT;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (facts.endsInMs !== null && Number.isFinite(facts.endsInMs) && facts.endsInMs > 0 && facts.endsInMs < 24 * 3_600_000) {
    return { kind: 'ending', label: `Closes in ${span(facts.endsInMs)}` };
  }
  if (facts.left !== null && facts.left > 0 && facts.left <= W.scarce) return { kind: 'scarce', label: `Only ${facts.left} left` };
  if (facts.followedActed > 0) {
    return { kind: 'followed', label: `${plural(facts.followedActed, 'person', 'people')} you follow joined in` };
  }
  if (facts.forumJoined) return { kind: 'forum', label: 'From a forum you joined' };
  if (facts.live && facts.prize === 'contest') return { kind: 'prize', label: 'Prizes to win' };
  if (facts.live && facts.prize === 'debate') return { kind: 'prize', label: 'Prize for the best argument' };
  if (facts.live && facts.prize === 'reward') return { kind: 'prize', label: 'Voters can win store credit' };
  if (facts.replay) return { kind: 'popular', label: 'Popular earlier' };
  if (facts.contested >= 0.5) return { kind: 'contested', label: 'Too close to call' };
  if (facts.velocity >= 1) return { kind: 'taking-off', label: 'Taking off right now' };
  if (facts.fill && facts.fill.total > 0 && facts.fill.joined < facts.fill.total && facts.fill.joined / facts.fill.total >= W.filling) {
    return { kind: 'filling', label: `Pre-order ${facts.fill.joined}/${facts.fill.total} filled` };
  }
  if (facts.bought >= W.bought) return { kind: 'bought', label: `Bought ${facts.bought} times from this post` };
  if (facts.comments >= W.comments) return { kind: 'lively', label: `${facts.comments} comments and counting` };
  if (facts.shared >= W.shared) return { kind: 'shared', label: `Shared ${facts.shared} times` };
  if (facts.live) {
    return { kind: 'live', label: facts.play === 'contest' ? 'Competition open' : facts.play === 'guess' ? 'Guess the price' : 'Open to vote' };
  }
  if (facts.ageMs >= 0 && facts.ageMs < W.freshMs) return { kind: 'fresh', label: 'Just posted' };
  if (facts.explore) return { kind: 'explore', label: 'Something different' };
  if (facts.rising) return { kind: 'new', label: 'A new voice worth a look' };
  return null;
}
