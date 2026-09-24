import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Get the bars out of the way while reading, and back the moment you turn.
 *
 * Scrolling down is reading, so the header and the tab bar slide off and the
 * page gets the whole screen; scrolling up is looking for somewhere to go, so
 * they come straight back. Near the top they always show, because that is
 * where people look for them. Small jitters are ignored, or a thumb resting on
 * the glass would make the bars flicker.
 *
 * Written as an attribute on the root rather than as state, so the page does
 * not re-render on every scroll event - the stylesheet does the moving.
 */
const JITTER = 8;
const ALWAYS_SHOW_ABOVE = 80;

export function ScrollBars() {
  const { pathname } = useLocation();

  // A new page starts with its bars showing, whatever the last one did.
  useEffect(() => {
    delete document.documentElement.dataset.bars;
  }, [pathname]);

  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;

    const update = () => {
      frame = 0;
      const now = window.scrollY;
      const delta = now - last;
      const root = document.documentElement;
      if (now < ALWAYS_SHOW_ABOVE) {
        delete root.dataset.bars;
      } else if (delta > JITTER) {
        root.dataset.bars = 'hidden';
      } else if (delta < -JITTER) {
        delete root.dataset.bars;
      } else {
        return;
      }
      last = now;
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      delete document.documentElement.dataset.bars;
    };
  }, []);

  return null;
}
