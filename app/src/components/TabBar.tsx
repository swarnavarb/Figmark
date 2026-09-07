import { NavLink, useLocation } from 'react-router-dom';

/**
 * The three things this app is.
 *
 * Buy, sell and the people around it are separate jobs done at separate times,
 * so they get separate homes rather than competing for one navigation bar. The
 * order is deliberate: browsing is what most sessions are.
 */
export const TABS = [
  { to: '/', label: 'Buy', glyph: '🛍️', match: (path: string) => path === '/' || path.startsWith('/listing') },
  { to: '/shop', label: 'Sell', glyph: '📦', match: (path: string) => path.startsWith('/shop') || path.startsWith('/sell') || path.startsWith('/batches') || path.startsWith('/lot/') },
  { to: '/social', label: 'Social', glyph: '💬', match: (path: string) => path.startsWith('/social') },
] as const;

/**
 * A raised, notched tab bar.
 *
 * The active tab lifts out of the row and the ones beside it curve away from
 * it, so the selected tab reads as the surface you are standing on rather than
 * a highlighted button. The curves are drawn with radial gradients on
 * pseudo-elements rather than SVG, which keeps the shape attached to whichever
 * tab is active without a second element to keep in sync.
 */
export function TabBar() {
  const { pathname } = useLocation();
  const activeIndex = Math.max(0, TABS.findIndex((tab) => tab.match(pathname)));

  return (
    <nav className="tabbar" aria-label="Sections">
      {/* Slides between tabs rather than cutting, which is what makes the row
          feel like one surface with a moving notch in it. */}
      <span
        className="tabbar__indicator"
        style={{ transform: `translateX(${activeIndex * 100}%)`, width: `${100 / TABS.length}%` }}
        aria-hidden="true"
      />
      {TABS.map((tab, index) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={`tab-item${index === activeIndex ? ' is-on' : ''}`}
          aria-current={index === activeIndex ? 'page' : undefined}
        >
          <span className="tab-item__glyph" aria-hidden="true">{tab.glyph}</span>
          <span className="tab-item__label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
