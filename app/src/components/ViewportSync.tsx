import { useEffect } from 'react';

/**
 * Keep a room's header and the bar you write from on the part of the page
 * that is actually on screen.
 *
 * Both are pinned to the browser's idea of the window, which on an iPhone is
 * not always the screen: after the keyboard has been up, or when the app is
 * brought back by a notification tap, the window can be left shorter than the
 * screen or shifted against it until something makes it measure again. The
 * bar you write from then floats in the middle of the conversation with
 * messages showing under it, and the header sits above the top of the screen.
 *
 * What is on screen is the visual viewport, which iOS does keep right, so the
 * distance between the two is written to the root and the stylesheet moves
 * the header and the bar by it. Both are zero whenever the two agree, which is
 * almost always, so nothing moves while somebody is simply scrolling.
 */
export function ViewportSync() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    let top = 0;
    let gap = 0;

    const measure = () => {
      frame = 0;
      // Zoomed in with two fingers, the visual viewport is meant to be a
      // window onto part of the page; the bars stay where they are.
      const zoomed = Math.abs(viewport.scale - 1) > 0.01;
      const nextTop = zoomed ? 0 : Math.max(0, Math.round(viewport.offsetTop));
      // Positive when the window runs below the screen, negative when it stops
      // short of it - the bar moves up or down by exactly that.
      const nextGap = zoomed ? 0 : Math.round(window.innerHeight - viewport.offsetTop - viewport.height);
      if (nextTop !== top) {
        top = nextTop;
        root.style.setProperty('--vv-top', `${top}px`);
      }
      if (nextGap !== gap) {
        gap = nextGap;
        root.style.setProperty('--vv-gap', `${gap}px`);
      }
    };
    const soon = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // Coming back to the front, the numbers settle a moment after the page
    // shows, so it measures again once they have.
    const onFront = () => {
      if (document.visibilityState !== 'visible') return;
      soon();
      window.setTimeout(soon, 250);
      window.setTimeout(soon, 800);
    };

    viewport.addEventListener('resize', soon);
    viewport.addEventListener('scroll', soon);
    window.addEventListener('resize', soon);
    window.addEventListener('pageshow', onFront);
    document.addEventListener('visibilitychange', onFront);
    // The keyboard going away is the commonest way into the bad state.
    document.addEventListener('focusout', onFront);
    measure();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', soon);
      viewport.removeEventListener('scroll', soon);
      window.removeEventListener('resize', soon);
      window.removeEventListener('pageshow', onFront);
      document.removeEventListener('visibilitychange', onFront);
      document.removeEventListener('focusout', onFront);
      root.style.removeProperty('--vv-top');
      root.style.removeProperty('--vv-gap');
    };
  }, []);
  return null;
}
