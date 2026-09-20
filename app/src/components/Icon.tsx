import type { ReactNode } from 'react';

/**
 * The icon set, drawn.
 *
 * One family, one stroke weight, one viewBox, taking `currentColor` so an icon
 * is the colour of the thing it sits in. That is the whole reason this exists
 * rather than a library: the app is built around six hues that icons have to
 * inherit, and emoji cannot inherit anything.
 *
 * The alternative considered was @phosphor-icons/react. It is a better set than
 * this one, but it is a dependency in an app whose only runtime dependencies
 * are React and the router, for perhaps thirty glyphs. Drawing them costs one
 * file and no bytes at install time.
 *
 * Paths are laid out on a 24-grid with a 1.7 stroke, which matches the tab bar
 * glyphs that were already drawn this way.
 */
export type IconName =
  | 'search' | 'heart' | 'plus' | 'back' | 'check' | 'close' | 'chevron'
  | 'tag' | 'bolt' | 'lock' | 'bell' | 'message' | 'mail' | 'megaphone'
  | 'plane' | 'bank' | 'star' | 'grip' | 'up' | 'down' | 'left' | 'right'
  | 'box' | 'truck' | 'users' | 'spark' | 'forum' | 'send' | 'image'
  | 'trash' | 'sort' | 'filter' | 'external' | 'home';

const PATHS: Record<IconName, ReactNode> = {
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  heart: <path d="M12 20s-7-4.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.5-7 9-7 9Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 19l-7-7 7-7" />,
  check: <path d="m5 13 4 4L19 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  // A price tag, for listing something.
  tag: (<><path d="M3.6 11.2V4.4a.8.8 0 0 1 .8-.8h6.8L20.4 12l-7.6 7.6Z" /><circle cx="8" cy="8" r="1.6" /></>),
  // A bolt, for power selling.
  bolt: <path d="M13.4 2.6 4.8 13.4h6L10.6 21.4 19.2 10.6h-6Z" />,
  lock: (<><rect x="4.4" y="10.4" width="15.2" height="10.4" rx="2" /><path d="M8 10.4V7.2a4 4 0 0 1 8 0v3.2" /></>),
  bell: (<><path d="M18.4 15.2V10.6a6.4 6.4 0 1 0-12.8 0v4.6L4 17.6h16Z" /><path d="M9.8 20.4a2.4 2.4 0 0 0 4.4 0" /></>),
  message: <path d="M20 11.8a7 7 0 0 1-9.9 6.4L5 19.8l1.6-4.4A7 7 0 1 1 20 11.8Z" />,
  mail: (<><rect x="3" y="5.2" width="18" height="13.6" rx="2" /><path d="m3.6 6.6 8.4 6.2 8.4-6.2" /></>),
  megaphone: (<><path d="M4 10v4a1.6 1.6 0 0 0 1.6 1.6H8l7.6 4.2V4.2L8 8.4H5.6A1.6 1.6 0 0 0 4 10Z" /><path d="M18.6 9.2a4 4 0 0 1 0 5.6" /></>),
  plane: <path d="M20.6 3.4 3.8 10.2l5.6 2.2m11.2-9-9 11.4m9-11.4-6 15.2-2.2-5.2-2.8 3.4v-4.6" />,
  bank: (<><path d="M3.6 9.6 12 4.4l8.4 5.2M5.2 9.6v8.8m4.4-8.8v8.8m4.8-8.8v8.8m4.4-8.8v8.8M3.4 20h17.2" /></>),
  star: <path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8Z" />,
  grip: <path d="M4 8h16M4 12h16M4 16h16" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  left: <path d="m15 6-6 6 6 6" />,
  right: <path d="m9 6 6 6-6 6" />,
  box: (<><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" /><path d="m4 8.5 8 4.5 8-4.5M12 13v7" /></>),
  truck: (<><path d="M3 6.6h10.4v10H3ZM13.4 10h3.8l2.8 3v3.6h-6.6" /><circle cx="7" cy="18" r="1.8" /><circle cx="16.6" cy="18" r="1.8" /></>),
  users: (<><circle cx="9" cy="8.4" r="3.2" /><path d="M3.6 19.4a5.4 5.4 0 0 1 10.8 0" /><path d="M16 5.6a3.2 3.2 0 0 1 0 6M17.4 19.4a5.4 5.4 0 0 0-2-4.2" /></>),
  // A six-point spark, for "everything" and for anything new.
  spark: <path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" />,
  forum: (<><path d="M4 5.6h12.8v8.8H8.8L4 17.6Z" /><path d="M8.4 17.6v1.2h7.2l4 2.8v-9.2h-2.8" /></>),
  send: <path d="M4.4 12 20 4.4l-4 15.2-4-6.2Zm7.6 1.4L20 4.4" />,
  image: (<><rect x="3.4" y="5" width="17.2" height="14" rx="2" /><circle cx="8.6" cy="10" r="1.6" /><path d="m4.4 17.4 5-4.6 4.4 3.6 2.8-2.4 4 3.4" /></>),
  trash: (<><path d="M4.8 7.2h14.4M9.6 7.2V5.4a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.8" /><path d="M6.6 7.2 7.6 19a1.6 1.6 0 0 0 1.6 1.4h5.6A1.6 1.6 0 0 0 16.4 19l1-11.8" /></>),
  sort: <path d="M7 4.6v14.8M7 19.4l-3-3M17 19.4V4.6M17 4.6l3 3" />,
  filter: <path d="M3.6 5.4h16.8l-6.6 7.6v6l-3.6 2v-8Z" />,
  external: (<><path d="M14 4.6h5.4V10" /><path d="m19.4 4.6-8 8" /><path d="M18 14v4.6a1.4 1.4 0 0 1-1.4 1.4H5.6a1.4 1.4 0 0 1-1.4-1.4V7.4A1.4 1.4 0 0 1 5.6 6H10" /></>),
  home: (<><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9.4h12V10" /><path d="M10 19.4v-6h4v6" /></>),
};

/** Glyphs that read better filled than stroked. */
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['heart', 'star', 'bolt', 'filter']);

export function Icon({ name, size = 16, className }: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
