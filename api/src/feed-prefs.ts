import type { Post, User } from '../../shared/models.js';
import type { FeedPrefs } from '../../shared/feed.js';

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
  saved: ReadonlySet<string>;
}

export const NO_SCREEN: FeedScreen = { muted: new Set(), hidden: new Set(), lessFrom: new Set(), saved: new Set() };

export function screenOf(user: Pick<User, 'feedPrefs'> | null | undefined): FeedScreen {
  const prefs: FeedPrefs = user?.feedPrefs ?? {};
  return {
    muted: new Set(prefs.muted ?? []),
    hidden: new Set(prefs.hidden ?? []),
    lessFrom: new Set(prefs.lessFrom ?? []),
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
