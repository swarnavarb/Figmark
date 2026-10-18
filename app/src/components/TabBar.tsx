import type React from 'react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../session';
import { CreateSheet } from './CreateSheet';

/**
 * Six places and one action.
 *
 * Buying, finding, selling on the left; the trades in between, the people, and
 * the game on the right; and in the middle the one thing every side of the app
 * shares - putting something up. Three and three either side of it, so the
 * thumb's resting place is the button that makes things.
 *
 * Shop and Discover are both about finding: Shop when you know what you want
 * and search for it, Discover when you do not and want to be shown.
 */
/**
 * A wrench: the trades around one lot - forwarding, repainting, partners.
 *
 * Drawn rather than an emoji for the same reason every glyph in this bar is
 * drawn - 🛠 has no colour glyph in half the browsers there are, and lands as a
 * grey blob in the one place the page is asking somebody to tap.
 */
export const SERVICES_GLYPH = (
  <path d="M14.7 6.3a3.9 3.9 0 0 0-5 5L4.6 16.4a1.9 1.9 0 0 0 2.7 2.7l5.1-5.1a3.9 3.9 0 0 0 5-5l-2.4 2.4-2.4-.6-.6-2.4Z" />
);

export type TabId = 'buy' | 'discover' | 'sell' | 'services' | 'social' | 'quests';

export interface Tab {
  /** Also the section's tone: `data-tone` on the root, and the bar's hue. */
  id: TabId;
  to: string;
  label: string;
  match: (path: string) => boolean;
  icon: React.ReactNode;
  /** Asked of a guest before it opens: these are about your own account. */
  members?: string;
}

export const TABS: readonly Tab[] = [
  {
    id: 'buy',
    to: '/',
    label: 'Shop',
    match: (path) => path === '/' || path.startsWith('/listing'),
    icon: (
      <>
        <path d="M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z" />
        <path d="M9.5 8V6.5a2.5 2.5 0 0 1 5 0V8" />
      </>
    ),
  },
  {
    id: 'discover',
    to: '/discover',
    label: 'Discover',
    match: (path) => path.startsWith('/discover'),
    icon: (
      <>
        <circle cx="12" cy="12" r="8.4" />
        <path d="m15.4 8.6-2.1 4.7-4.7 2.1 2.1-4.7Z" />
      </>
    ),
  },
  {
    id: 'sell',
    to: '/shop',
    label: 'Sell',
    match: (path) =>
      path.startsWith('/shop') || path.startsWith('/sell') || path.startsWith('/lots')
      || path.startsWith('/lot/') || path.startsWith('/routes'),
    icon: (
      <>
        <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
        <path d="m4 8.5 8 4.5 8-4.5M12 13v7" />
      </>
    ),
    members: 'Sign in to open your shop and sell.',
  },
  {
    id: 'services',
    to: '/services',
    label: 'Services',
    // The consoles too: a lot to pack and a Community Service desk are
    // somebody's job rather than somebody's shop, and the bar should say so
    // while they are standing in one.
    match: (path) =>
      path.startsWith('/services') || path.startsWith('/forwarders')
      || path.startsWith('/community-service'),
    icon: SERVICES_GLYPH,
  },
  {
    id: 'social',
    to: '/social',
    label: 'Social',
    match: (path) => path.startsWith('/social') || path.startsWith('/messages'),
    // Two bubbles: a conversation rather than an announcement.
    icon: (
      <>
        <path d="M15.5 9.5a5.5 5.5 0 0 1-7.6 5.1L4 16l1.1-3.3a5.5 5.5 0 1 1 10.4-3.2Z" />
        <path d="M16.9 10.6a5 5 0 0 1 2.2 7l.9 2.8-3.1-1a5 5 0 0 1-6.4-1.6" />
      </>
    ),
    members: 'Sign in to join the conversation.',
  },
  {
    id: 'quests',
    to: '/quests',
    label: 'Quests',
    match: (path) => path.startsWith('/quests'),
    icon: (
      <>
        <path d="M8 4.5h8v4.5a4 4 0 0 1-8 0V4.5Z" />
        <path d="M8 6.5H5.2a2.6 2.6 0 0 0 2.9 3.6M16 6.5h2.8a2.6 2.6 0 0 1-2.9 3.6M12 13v3.4M8.8 19.6h6.4M9.8 19.6l.6-3.2h3.2l.6 3.2" />
      </>
    ),
    members: 'Sign in to start your quests.',
  },
];

/** The tab a path belongs to; a page outside all six reads as Shop. */
export function tabFor(pathname: string): Tab {
  return TABS.find((tab) => tab.match(pathname)) ?? TABS[0]!;
}

/** Where the Create button sits among the bar's seven columns. */
const CREATE_COLUMN = 3;

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
  const { user, promptAuth } = useSession();
  const [creating, setCreating] = useState(false);
  // A page outside the six reads as Shop, as the header's colour does.
  const active = tabFor(pathname);
  const activeIndex = TABS.indexOf(active);
  // Seven equal columns, the middle one the Create button's.
  const column = activeIndex < CREATE_COLUMN ? activeIndex : activeIndex + 1;

  // Going anywhere puts the sheet away.
  useEffect(() => setCreating(false), [pathname]);

  const tabLink = (tab: Tab) => {
    const on = tab === active;
    return (
      <NavLink
        key={tab.id}
        to={tab.to}
        className={`tab-item${on ? ' is-on' : ''}`}
        aria-current={on ? 'page' : undefined}
        onClick={(event) => {
          if (user || !tab.members) return;
          event.preventDefault();
          promptAuth(tab.members);
        }}
      >
        <svg className="tab-item__glyph" viewBox="0 0 24 24" width="22" height="22" fill="none"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true">
          {tab.icon}
        </svg>
        <span className="tab-item__label">{tab.label}</span>
      </NavLink>
    );
  };

  return (
    // The current section is published to CSS so the bar can carry its hue:
    // Shop violet, Discover iris, Sell aqua, Services lime, Social pink,
    // Quests gold. Colours people learn without being told, on the one element
    // always on screen.
    //
    // Pinned by the dock, slid by the bar inside it. An iPhone holds a fixed
    // element that is mid-transition where it was while Safari's toolbar
    // grows back, then drops it into place once the slide ends; a dock that
    // never moves is kept on the toolbar the whole way.
    <div className="tabdock">
      <nav className="tabbar" aria-label="Sections" data-tab={active.id}>
        {/* Position and width both come from the column and the column count, in
            CSS, against the bar's padding box. Sizing it as a percentage of the
            whole bar instead put it eight pixels past the right edge on the last
            tab - enough to make the page scroll sideways. */}
        <span
          className="tabbar__pill"
          style={{ '--i': column, '--tabs': TABS.length + 1 } as React.CSSProperties}
          aria-hidden="true"
        />
        {TABS.slice(0, CREATE_COLUMN).map(tabLink)}
        <div className="tab-create">
          <button type="button" className={`tab-create__btn${creating ? ' is-open' : ''}`}
            aria-label="Create a post or listing" aria-haspopup="dialog" aria-expanded={creating}
            onClick={() => {
              if (!user) {
                promptAuth('Sign in to post, list and share.');
                return;
              }
              setCreating(!creating);
            }}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4"
              strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <span className="tab-item__label" aria-hidden="true">Create</span>
        </div>
        {TABS.slice(CREATE_COLUMN).map(tabLink)}
        {creating && <CreateSheet onClose={() => setCreating(false)} />}
      </nav>
    </div>
  );
}
