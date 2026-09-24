/**
 * Reactions, comments, shares and polls on a post: the wire shapes and rules.
 *
 * Kept apart from the Post model because they are one feature with its own
 * vocabulary, and both sides need the same list of reactions, the same caps and
 * the same idea of what a comment thread looks like. A reaction the API accepts
 * and the app has no face for would be a count nobody can explain.
 */

/** The reactions on offer. Order is the order the picker shows them in. */
export const REACTIONS = ['love', 'fire', 'haha', 'wow', 'sad', 'clap'] as const;
export type ReactionKind = (typeof REACTIONS)[number];

/** What each reaction looks like and is called, for the picker and the list. */
export const REACTION_META: Record<ReactionKind, { emoji: string; label: string }> = {
  love: { emoji: '❤️', label: 'Love' },
  fire: { emoji: '🔥', label: 'Fire' },
  haha: { emoji: '😂', label: 'Haha' },
  wow: { emoji: '😮', label: 'Wow' },
  sad: { emoji: '😢', label: 'Sad' },
  clap: { emoji: '👏', label: 'Applause' },
};

export function isReaction(value: unknown): value is ReactionKind {
  return typeof value === 'string' && (REACTIONS as readonly string[]).includes(value);
}

/**
 * The colour a short text post can be set on.
 *
 * Named after the gradients the design system already owns, so a vibe post is
 * Figmark's colours rather than whatever somebody picked from a wheel.
 */
export const VIBES = ['hero', 'cool', 'blue', 'warm', 'sea', 'play'] as const;
export type Vibe = (typeof VIBES)[number];

export function isVibe(value: unknown): value is Vibe {
  return typeof value === 'string' && (VIBES as readonly string[]).includes(value);
}

/** A vibe only suits a line or two; past this it is a wall of text on a poster. */
export const VIBE_MAX_CHARS = 160;

/** Caps, enforced by the API and shown by the app before it asks. */
export const POST_MAX_PHOTOS = 10;
export const COMMENT_MAX_CHARS = 1000;
/** A post is one document; its conversation cannot grow without bound. */
export const POST_MAX_COMMENTS = 500;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_OPTION_MAX_CHARS = 60;

/* ── As stored, on the post ─────────────────────────────────────────────── */

/** One person's reaction. One per person: reacting again changes it. */
export interface StoredReaction {
  userId: string;
  kind: ReactionKind;
  at: string;
}

/**
 * A comment, or a reply to one.
 *
 * Replies are one level deep: a reply to a reply is filed under the same
 * top-level comment and names who it answers. Deeper nesting reads as a
 * staircase on a phone and nobody follows it past the third step.
 */
export interface StoredComment {
  id: string;
  authorId: string;
  /** Snapshot, as a post keeps the name it was written under. */
  authorName: string;
  body: string;
  /** The top-level comment this sits under, or null for a top-level one. */
  parentId: string | null;
  /** Who a reply is answering, when it is a reply to a reply. */
  replyToName?: string | null;
  likedBy: string[];
  createdAt: string;
}

export interface StoredPollOption {
  id: string;
  label: string;
  voterIds: string[];
}

export interface StoredPoll {
  options: StoredPollOption[];
  /** When voting stops. Null runs until the post goes. */
  closesAt: string | null;
}

/** A post that is somebody else's post, passed on. */
export interface RepostRef {
  postId: string;
  channelId: string;
}

/* ── As the app reads them ─────────────────────────────────────────────── */

/** Somebody named on a screen, and the page their name opens. */
export interface SocialParty {
  name: string;
  handle: string | null;
}

export interface ReactionSummary {
  total: number;
  /** Only the reactions somebody used, most used first. */
  counts: { kind: ReactionKind; count: number }[];
  mine: ReactionKind | null;
  /** A name or two, for "Meera and 23 others". */
  names: string[];
}

export interface PollView {
  options: { id: string; label: string; votes: number }[];
  total: number;
  /** Which option this viewer picked; null until they vote. */
  myVote: string | null;
  closesAt: string | null;
  closed: boolean;
}

export interface CommentView {
  id: string;
  author: SocialParty;
  authorName: string;
  body: string;
  parentId: string | null;
  replyToName: string | null;
  likeCount: number;
  likedByMe: boolean;
  /** Whether this viewer may delete it: the one who wrote it, or the post's author. */
  canDelete: boolean;
  createdAt: string;
}

/** A top-level comment and its replies, oldest reply first. */
export interface CommentThread extends CommentView {
  replies: CommentView[];
}

/** Everything about a post that is not the post: who reacted, who replied. */
export interface PostSocial {
  reactions: ReactionSummary;
  commentCount: number;
  /** The liveliest comment or two, so a feed shows there is a conversation. */
  preview: CommentView[];
  shareCount: number;
  poll: PollView | null;
  /** Whether this viewer wrote it, and so may delete it. */
  mine: boolean;
}

/** One row in "who reacted". */
export interface ReactorRow {
  party: SocialParty;
  kind: ReactionKind;
  at: string;
}

/**
 * The reaction summary from the stored list.
 *
 * Shared so an optimistic update in the app and the answer from the API are
 * computed the same way, and the count never jumps when the answer lands.
 */
export function summarise(
  reactions: readonly StoredReaction[],
  viewerId: string | null,
  nameOf: (userId: string) => string | null = () => null,
): ReactionSummary {
  const tally = new Map<ReactionKind, number>();
  for (const reaction of reactions) tally.set(reaction.kind, (tally.get(reaction.kind) ?? 0) + 1);
  const counts = [...tally.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || REACTIONS.indexOf(a.kind) - REACTIONS.indexOf(b.kind));
  const newest = [...reactions].sort((a, b) => (a.at < b.at ? 1 : -1));
  const names = newest
    .map((reaction) => nameOf(reaction.userId))
    .filter((name): name is string => Boolean(name))
    .slice(0, 2);
  return {
    total: reactions.length,
    counts,
    mine: reactions.find((reaction) => reaction.userId === viewerId)?.kind ?? null,
    names,
  };
}
