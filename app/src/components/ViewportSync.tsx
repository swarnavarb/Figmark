import { useEffect } from 'react';

/**
 * Keep the bars pinned to the bottom - the tab bar, and a room's composer -
 * at the bottom of the screen, however wrong an iPhone's idea of the window.
 *
 * Two ways it goes wrong:
 *
 * - The keyboard is up, and the visual viewport (what is on screen) is
 *   shorter than, or shifted against, the window. The bar belongs on top of
 *   the keyboard.
 * - A home-screen app on an iPhone shrinks its whole window the first time
 *   the keyboard opens and, now and then - typically after being woken by a
 *   notification tap - never grows it back: the window, the visual viewport
 *   and 100dvh all stay a keyboard short, with nothing focused, until the app
 *   is closed. Everything pinned to the bottom floats a keyboard's height up
 *   the screen with the page showing underneath. The two measurements agree
 *   with each other there, so the only tell is the height the window had
 *   before; the tallest seen at this width is kept, across launches, and the
 *   bars are moved down by what is missing.
 *
 * Written to the root for the stylesheet: --vv-gap, the distance from the
 * bottom of the window to where a room's composer belongs (above the
 * keyboard, or the true bottom of the screen), and --vv-shrunk, the bug's
 * part of it alone, for the tab bar, which belongs under the keyboard. Both
 * are zero whenever nothing is wrong, which is almost always.
 */

/** Less than this short of the tallest is the window settling, not the bug. */
const SHRUNK_BY = 120;
const TALLEST_KEY = 'figmark:tallest:';

const isTyping = () => {
  const field = document.activeElement as HTMLElement | null;
  if (!field) return false;
  if (field.isContentEditable) return true;
  if (field.tagName === 'TEXTAREA') return true;
  return field.tagName === 'INPUT'
    && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes((field as HTMLInputElement).type);
};

/** Only a home-screen app on an iPhone or iPad has the bug. */
const homeScreenIos = () => (navigator as Navigator & { standalone?: boolean }).standalone === true;

function remembered(width: number): number {
  try {
    return Number(localStorage.getItem(`${TALLEST_KEY}${width}`)) || 0;
  } catch {
    return 0;
  }
}

function remember(width: number, height: number): void {
  try {
    localStorage.setItem(`${TALLEST_KEY}${width}`, String(height));
  } catch {
    // Kept for this launch only.
  }
}

export function ViewportSync() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const fixable = homeScreenIos();
    let frame = 0;
    let top = 0;
    let gap = 0;
    let shrunk = 0;
    let width = 0;
    let tallest = 0;

    const measure = () => {
      frame = 0;
      const height = window.innerHeight;
      if (window.innerWidth !== width) {
        // Turned on its side, or a new launch: what was tallest before is for
        // another shape of window.
        width = window.innerWidth;
        tallest = fixable ? remembered(width) : 0;
      }
      const typing = isTyping();
      if (height > tallest && !typing) {
        tallest = height;
        if (fixable) remember(width, height);
      }

      // Zoomed in with two fingers, the visual viewport is meant to be a
      // window onto part of the page; the bars stay where they are.
      const zoomed = viewport ? Math.abs(viewport.scale - 1) > 0.01 : true;
      const nextTop = zoomed || !viewport ? 0 : Math.max(0, Math.round(viewport.offsetTop));
      let nextGap = zoomed || !viewport ? 0 : Math.round(height - viewport.offsetTop - viewport.height);
      // Shrunk with nothing being typed in: the bug, not the keyboard.
      const nextShrunk = fixable && !typing && tallest - height > SHRUNK_BY ? tallest - height : 0;
      nextGap -= nextShrunk;

      if (nextTop !== top) {
        top = nextTop;
        root.style.setProperty('--vv-top', `${top}px`);
      }
      if (nextShrunk !== shrunk) {
        shrunk = nextShrunk;
        root.style.setProperty('--vv-shrunk', `${shrunk}px`);
      }
      if (nextGap !== gap) {
        gap = nextGap;
        root.style.setProperty('--vv-gap', `${gap}px`);
      }
    };
    const soon = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // Coming back to the front, and after the keyboard goes away, the numbers
    // settle a moment later, so it measures again once they have.
    const settle = () => {
      soon();
      window.setTimeout(soon, 250);
      window.setTimeout(soon, 800);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        settle();
        return;
      }
      // Put away with a field focused, the app can come back believing the
      // keyboard is still up. Nothing typed is lost; the field just lets go.
      if (isTyping()) (document.activeElement as HTMLElement).blur();
    };

    viewport?.addEventListener('resize', soon);
    viewport?.addEventListener('scroll', soon);
    window.addEventListener('resize', soon);
    window.addEventListener('pageshow', settle);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('focusin', settle);
    document.addEventListener('focusout', settle);
    measure();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', soon);
      viewport?.removeEventListener('scroll', soon);
      window.removeEventListener('resize', soon);
      window.removeEventListener('pageshow', settle);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('focusin', settle);
      document.removeEventListener('focusout', settle);
      root.style.removeProperty('--vv-top');
      root.style.removeProperty('--vv-gap');
      root.style.removeProperty('--vv-shrunk');
    };
  }, []);
  return null;
}
