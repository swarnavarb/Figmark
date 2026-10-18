import { useEffect, type RefObject } from 'react';
import { SEEN_BATCH_MAX, SEEN_MS_MAX, type SeenEntry } from '@shared/feed';
import { api } from './api';

/*
 * What was on screen, for ranking.
 *
 * A post counts as seen once it has been at least half on screen for a
 * moment; the time it stays there is added up, and so is whether it was
 * opened. Each post is sent once per visit, in batches every few seconds and
 * when the page is put away, so scrolling costs a request now and then rather
 * than one per post. Nothing here is the reader's business to wait on: a
 * batch that fails is dropped.
 */

/** Less than this on screen is scrolling past, not seeing. */
const SEEN_AFTER_MS = 600;
const FLUSH_MS = 8_000;

interface Watch {
  channelId: string;
  postId: string;
  ms: number;
  since: number | null;
  opened: boolean;
}

const watching = new Map<string, Watch>();
const byElement = new WeakMap<Element, string>();
/** Sent already this visit: a post is counted once however often it scrolls back. */
const sent = new Set<string>();
let observer: IntersectionObserver | null = null;

function settle(watch: Watch, now: number) {
  if (watch.since !== null) {
    watch.ms += now - watch.since;
    watch.since = null;
  }
}

function flush() {
  const now = Date.now();
  const due: SeenEntry[] = [];
  for (const [id, watch] of watching) {
    const visible = watch.since !== null;
    settle(watch, now);
    if (watch.ms >= SEEN_AFTER_MS && !sent.has(id)) {
      due.push({ channelId: watch.channelId, postId: watch.postId, ms: Math.min(SEEN_MS_MAX, watch.ms), opened: watch.opened });
      sent.add(id);
    }
    if (visible) watch.since = now;
  }
  for (let start = 0; start < due.length; start += SEEN_BATCH_MAX) {
    void api.seenPosts(due.slice(start, start + SEEN_BATCH_MAX)).catch(() => undefined);
  }
}

function ensure(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver((entries) => {
    const now = Date.now();
    for (const entry of entries) {
      const id = byElement.get(entry.target);
      const watch = id ? watching.get(id) : undefined;
      if (!watch) continue;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) watch.since ??= now;
      else settle(watch, now);
    }
  }, { threshold: [0, 0.5] });
  window.setInterval(flush, FLUSH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  return observer;
}

/** Count this post as seen while its card is on screen. Signed-in readers only. */
export function useSeen(ref: RefObject<Element | null>, post: { channelId: string; id: string }, enabled: boolean) {
  useEffect(() => {
    const element = ref.current;
    const watcher = enabled ? ensure() : null;
    if (!element || !watcher) return;
    const key = post.id;
    if (!watching.has(key)) watching.set(key, { channelId: post.channelId, postId: post.id, ms: 0, since: null, opened: false });
    byElement.set(element, key);
    watcher.observe(element);
    return () => {
      watcher.unobserve(element);
      const watch = watching.get(key);
      if (watch) settle(watch, Date.now());
    };
  }, [ref, post.channelId, post.id, enabled]);
}

/** The reader opened it - its comments, a photo, its own page. */
export function markOpened(post: { channelId: string; id: string }) {
  const watch = watching.get(post.id);
  if (watch && !sent.has(post.id)) {
    watch.opened = true;
    return;
  }
  if (sent.has(`open:${post.id}`)) return;
  sent.add(`open:${post.id}`);
  void api.seenPosts([{ channelId: post.channelId, postId: post.id, ms: 0, opened: true }]).catch(() => undefined);
}
