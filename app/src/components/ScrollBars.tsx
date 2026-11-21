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
 * not re-render on every scroll event - the stylesheet does the moving. The
 * same pass marks the page as scrolled at all (`data-scrolled`), which is when
 * the header turns to glass over what passes under it.
 */
const JITTER = 8;
const ALWAYS_SHOW_ABOVE = 80;
/** Past this the page is under the header, and the header is see-through. */
const SCROLLED_PAST = 4;

/**
 * The phone's status bar, clear while the header is away. Safari paints the
 * strip under the clock from theme-color when nothing colours it, so the tag
 * comes out while the bars are hidden (the strip itself goes clear in the
 * stylesheet) and goes back, as a new tag, when they return. A new tag rather
 * than an edited one: Safari does not always notice an edit. AppShell puts in
 * a fresh one whenever the section changes, so this only restores one when
 * none is there.
 */
let heldStatusColour: string | null = null;
function clearStatusBar(clear: boolean) {
  const tags = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (clear) {
    if (!tags.length) return;
    heldStatusColour = tags[tags.length - 1]?.content ?? heldStatusColour;
    tags.forEach((tag) => tag.remove());
  } else if (!tags.length && heldStatusColour) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = heldStatusColour;
    document.head.append(meta);
  }
}

/** Show or hide the bars, with the status bar to match. */
function setBars(hidden: boolean) {
  const root = document.documentElement;
  if (hidden) root.dataset.bars = 'hidden';
  else delete root.dataset.bars;
  clearStatusBar(hidden);
}

function markScrolled() {
  const root = document.documentElement;
  if (window.scrollY > SCROLLED_PAST) root.dataset.scrolled = '';
  else delete root.dataset.scrolled;
}

export function ScrollBars() {
  const { pathname } = useLocation();

  // A new page starts with its bars showing, whatever the last one did.
  useEffect(() => {
    setBars(false);
    markScrolled();
  }, [pathname]);

  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;

    const update = () => {
      frame = 0;
      const now = window.scrollY;
      const delta = now - last;
      const root = document.documentElement;
      markScrolled();
      if (now < ALWAYS_SHOW_ABOVE) {
        if ('bars' in root.dataset) setBars(false);
      } else if (delta > JITTER) {
        if (!('bars' in root.dataset)) setBars(true);
      } else if (delta < -JITTER) {
        if ('bars' in root.dataset) setBars(false);
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
      setBars(false);
      delete document.documentElement.dataset.scrolled;
    };
  }, []);

  return null;
}
