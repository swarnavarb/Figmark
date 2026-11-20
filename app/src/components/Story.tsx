import { useEffect, useState } from 'react';

/**
 * Discover's sections read as chapters of one story: each has its own edge
 * (a ticket, a zig-zag, a stamp, a film strip...) and its own way of arriving.
 * The styles are the `.story--<theme>` rules in styles.css; this file is the
 * little behaviour they need.
 */
export type StoryTheme = 'ticket' | 'helix' | 'stamp' | 'cast' | 'map' | 'film';

/**
 * The classes for a chapter, and the ref that plays its entrance the first
 * time it scrolls into view.
 *
 * Nothing is hidden until the observer is known to work (`is-armed`), so a
 * browser without one - or a page printed - still shows every card.
 */
export function useStory(theme: StoryTheme): { ref: (node: HTMLElement | null) => void; className: string } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<'idle' | 'armed' | 'shown'>('idle');
  useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setState('shown');
      return;
    }
    // Already on screen when it mounts: play straight away rather than flash.
    setState('armed');
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setState('shown');
        watch.disconnect();
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    watch.observe(node);
    return () => watch.disconnect();
  }, [node]);
  return {
    ref: setNode,
    className: `story story--${theme}${state === 'armed' ? ' is-armed' : state === 'shown' ? ' is-shown' : ''}`,
  };
}

/** The small chapter line over a section's heading. Decoration: the heading says what it is. */
export function StoryTag({ children }: { children: string }) {
  return <span className="story__tag" aria-hidden="true">{children}</span>;
}
