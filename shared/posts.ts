import type { Post } from './models.js';

/**
 * Whether this reads as an announcement.
 *
 * One rule, shared by the API and the app, so the filter and the badge can
 * never disagree about what a reader is looking at.
 *
 * The fallback is what makes an old room still make sense. Before a shop could
 * choose, everything it said in its own voice was the only kind of message
 * there was — so an unmarked post from the shop is an announcement, and an
 * unmarked post from a customer never was one.
 */
export function isAnnouncement(post: Pick<Post, 'announcement' | 'voice'>): boolean {
  return post.announcement ?? (post.voice ?? 'store') === 'store';
}
