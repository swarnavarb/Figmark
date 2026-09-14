/**
 * The six category marks, drawn.
 *
 * The rail used colour emoji (🧸 🤖 🃏 👟 🎧 💄), which is a different typeface
 * on every platform, carries somebody else's palette into the row that is
 * supposed to introduce ours, and in headless Chromium renders as grey blobs.
 * Drawn strokes take the colour they are given, which is the whole point of a
 * rail where every heading owns a hue.
 *
 * Deliberately simple silhouettes at one stroke weight. These sit at 22px and
 * are read at a glance next to a word that already says what they are, so
 * detail would only make them muddy.
 */
import type { ReactNode } from 'react';

const MARKS: Record<string, ReactNode> = {
  // A figure on a display base: the thing in the cabinet.
  figures: (
    <>
      <circle cx="12" cy="5.4" r="2.4" />
      <path d="M12 7.8v6.4M8.4 10.2h7.2M9.6 19.4l2.4-5.2 2.4 5.2" />
      <path d="M6.6 21h10.8" />
    </>
  ),
  // A sprue runner with parts still attached: how a kit arrives.
  models: (
    <>
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2" />
      <path d="M3.4 9.6h17.2M9.2 4.6v14.8" />
      <circle cx="15.4" cy="14.4" r="2" />
    </>
  ),
  // Two cards, fanned.
  cards: (
    <>
      <rect x="8.4" y="3.6" width="11.2" height="15" rx="1.8" />
      <path d="M15.6 20.4H6.2a1.8 1.8 0 0 1-1.8-1.8V7.2" />
    </>
  ),
  // A high-top in profile.
  wear: (
    <>
      <path d="M3 16.6V9.4l3.8.0 2.6 2.8 4.4 1.2 6.2 1.6a2 2 0 0 1 1.6 2v1.6H3.6" />
      <path d="M6.8 9.4v3M10.6 12.6l1.4-2.2" />
    </>
  ),
  // Headphones.
  tech: (
    <>
      <path d="M4.6 14.4v-2.2a7.4 7.4 0 0 1 14.8 0v2.2" />
      <rect x="2.8" y="13.8" width="4" height="6.4" rx="2" />
      <rect x="17.2" y="13.8" width="4" height="6.4" rx="2" />
    </>
  ),
  // A handbag, for beauty and bags.
  beauty: (
    <>
      <path d="M4.4 8.6h15.2l1.2 11.2a1.4 1.4 0 0 1-1.4 1.6H4.6a1.4 1.4 0 0 1-1.4-1.6Z" />
      <path d="M8.8 10.4V7a3.2 3.2 0 0 1 6.4 0v3.4" />
    </>
  ),
};

/** A ring, for "everything": no one category, so no one silhouette. */
const EVERYTHING: ReactNode = (
  <>
    <circle cx="12" cy="12" r="7.6" />
    <circle cx="12" cy="12" r="2.6" />
  </>
);

export function CategoryIcon({ id, size = 22 }: { id: string; size?: number }) {
  return (
    <svg
      className="cat__glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MARKS[id] ?? EVERYTHING}
    </svg>
  );
}
