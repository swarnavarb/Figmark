import type React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

/**
 * The three things this app is.
 *
 * Buy, sell and the people around it are separate jobs done at separate times,
 * so they get separate homes rather than competing for one navigation bar. The
 * order is deliberate: browsing is what most sessions are.
 */
export const TABS = [
  {
    to: '/',
    label: 'Buy',
    match: (path: string) => path === '/' || path.startsWith('/listing'),
    icon: (
      <>
        <path d="M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z" />
        <path d="M9.5 8V6.5a2.5 2.5 0 0 1 5 0V8" />
      </>
    ),
  },
  {
    to: '/shop',
    label: 'Sell',
    match: (path: string) =>
      path.startsWith('/shop') || path.startsWith('/sell') || path.startsWith('/batches')
      || path.startsWith('/lot/') || path.startsWith('/packing'),
    icon: (
      <>
        <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
        <path d="m4 8.5 8 4.5 8-4.5M12 13v7" />
      </>
    ),
  },
  {
    to: '/social',
    label: 'Social',
    match: (path: string) => path.startsWith('/social') || path.startsWith('/messages'),
    icon: (
      <>
        <path d="M20 12a7 7 0 0 1-9.9 6.4L5 20l1.6-4.5A7 7 0 1 1 20 12Z" />
      </>
    ),
  },
] as const;

/**
 * The bottom bar.
 *
 * A soft pill slides under whichever tab is current, rather than the row being
 * notched around it. The notch version drew its inward curves with radial
 * gradients on two pseudo-elements, and on a real phone those landed as a pair
 * of grey blocks either side of the active tab - a clever shape that only held
 * together at one background colour and one device pixel ratio. A pill holds
 * together everywhere, which is the better trade for the thing that is on
 * screen the whole time.
 *
 * The glyphs are drawn rather than typed: emoji are a different typeface on
 * every platform, sit off the baseline, and carry somebody else's colour
 * palette into a bar that is otherwise two colours.
 */
export function TabBar() {
  const { pathname } = useLocation();
  const activeIndex = Math.max(0, TABS.findIndex((tab) => tab.match(pathname)));

  return (
    <nav className="tabbar" aria-label="Sections">
      {/* Position and width both come from the index and the tab count, in CSS,
          against the bar's padding box. Sizing it as a percentage of the whole
          bar instead put it eight pixels past the right edge on the last tab -
          enough to make the page scroll sideways. */}
      <span
        className="tabbar__pill"
        style={{ '--i': activeIndex, '--tabs': TABS.length } as React.CSSProperties}
        aria-hidden="true"
      />
      {TABS.map((tab, index) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={`tab-item${index === activeIndex ? ' is-on' : ''}`}
          aria-current={index === activeIndex ? 'page' : undefined}
        >
          <svg className="tab-item__glyph" viewBox="0 0 24 24" width="23" height="23" fill="none"
            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            {tab.icon}
          </svg>
          <span className="tab-item__label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
