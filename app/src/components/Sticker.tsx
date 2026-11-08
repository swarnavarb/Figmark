/**
 * Little flat illustrations, drawn in the palette with a heavy ink outline:
 * the personality the screens get from pictures rather than from colour.
 *
 * Decorative only - every one is aria-hidden, and nothing a person needs is
 * said by a sticker alone. Each sits on a 64 unit square so they can be mixed
 * in a cluster at any size.
 */
import type { CSSProperties, ReactNode } from 'react';

export type StickerName =
  | 'star' | 'box' | 'toy' | 'coin' | 'bag' | 'heart' | 'sparkle'
  | 'trophy' | 'chat' | 'tag' | 'bolt' | 'ticket';

const INK = '#1A1A19';
const W = 3.2;

const art: Record<StickerName, ReactNode> = {
  star: (
    <path
      d="M32.0 3.0L37.2 12.7L46.5 6.9L46.1 17.9L57.1 17.5L51.3 26.8L61.0 32.0L51.3 37.2L57.1 46.5L46.1 46.1L46.5 57.1L37.2 51.3L32.0 61.0L26.8 51.3L17.5 57.1L17.9 46.1L6.9 46.5L12.7 37.2L3.0 32.0L12.7 26.8L6.9 17.5L17.9 17.9L17.5 6.9L26.8 12.7Z"
      fill="#F5CB5C" stroke={INK} strokeWidth={W} strokeLinejoin="round"
    />
  ),
  sparkle: (
    <path
      d="M32 6c2.5 14 8 19.5 22 22-14 2.5-19.5 8-22 22-2.5-14-8-19.5-22-22 14-2.5 19.5-8 22-22z"
      fill="#F4F1EA" stroke={INK} strokeWidth={W} strokeLinejoin="round"
    />
  ),
  box: (
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round">
      <path d="M32 8l22 10v26L32 56 10 44V18z" fill="#BDE8F0" />
      <path d="M10 18l22 11 22-11" fill="none" />
      <path d="M32 29v27" fill="none" />
      <path d="M20 13l22 11v9l-6-3v-9L14 16z" fill="#F5CB5C" />
    </g>
  ),
  toy: (
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round" strokeLinecap="round">
      <path d="M32 10V5" fill="none" />
      <circle cx="32" cy="5" r="3.5" fill="#EA6A5A" />
      <rect x="15" y="10" width="34" height="24" rx="9" fill="#6D6BF2" />
      <circle cx="25" cy="22" r="3" fill="#F4F1EA" />
      <circle cx="39" cy="22" r="3" fill="#F4F1EA" />
      <path d="M27 29h10" fill="none" />
      <rect x="19" y="36" width="26" height="20" rx="6" fill="#F5CB5C" />
      <path d="M19 42h-6M45 42h6" fill="none" />
      <circle cx="32" cy="46" r="3.5" fill="#EA6A5A" />
    </g>
  ),
  coin: (
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round">
      <ellipse cx="32" cy="44" rx="22" ry="9" fill="#C9A23E" />
      <path d="M10 44v-8h44v8" fill="#C9A23E" />
      <ellipse cx="32" cy="34" rx="22" ry="9" fill="#F5CB5C" />
      <path d="M10 34v-8h44v8" fill="#F5CB5C" />
      <ellipse cx="32" cy="24" rx="22" ry="9" fill="#F5CB5C" />
      <text x="32" y="29.5" textAnchor="middle" fontSize="15" fontWeight="800" fill={INK} stroke="none" fontFamily="system-ui, sans-serif">₹</text>
    </g>
  ),
  bag: (
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round" strokeLinecap="round">
      <path d="M24 22v-5a8 8 0 0116 0v5" fill="none" />
      <path d="M12 22h40l-4 34H16z" fill="#EA6A5A" />
      <circle cx="24" cy="30" r="2" fill={INK} />
      <circle cx="40" cy="30" r="2" fill={INK} />
    </g>
  ),
  heart: (
    <path
      d="M32 54S8 40 8 24a12 12 0 0124-5 12 12 0 0124 5c0 16-24 30-24 30z"
      fill="#EA6A5A" stroke={INK} strokeWidth={W} strokeLinejoin="round"
    />
  ),
  trophy: (
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round" strokeLinecap="round">
      <path d="M20 8h24v14a12 12 0 01-24 0z" fill="#F5CB5C" />
      <path d="M20 13h-8c0 8 4 12 9 13M44 13h8c0 8-4 12-9 13" fill="none" />
      <path d="M32 34v8" fill="none" />
      <rect x="20" y="42" width="24" height="12" rx="4" fill="#6D6BF2" />
    </g>
  ),
  chat: (
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round" strokeLinecap="round">
      <path d="M10 14h44v28H30l-12 10v-10h-8z" fill="#C6D3CB" />
      <circle cx="23" cy="28" r="2.2" fill={INK} />
      <circle cx="32" cy="28" r="2.2" fill={INK} />
      <circle cx="41" cy="28" r="2.2" fill={INK} />
    </g>
  ),
  tag: (
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round">
      <path d="M34 8h20v20L28 54 8 34z" fill="#C6D3CB" />
      <circle cx="45" cy="17" r="4" fill="#F4F1EA" />
    </g>
  ),
  bolt: (
    <path
      d="M36 4L12 36h16l-4 24 26-34H34z"
      fill="#F5CB5C" stroke={INK} strokeWidth={W} strokeLinejoin="round"
    />
  ),
  ticket: (
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round">
      <path d="M8 18h48v8a6 6 0 000 12v8H8v-8a6 6 0 000-12z" fill="#6D6BF2" />
      <path d="M40 18v28" fill="none" strokeDasharray="3 4" />
    </g>
  ),
};

export function Sticker({ name, size = 56, tilt = 0, className = '', style }: {
  name: StickerName;
  size?: number;
  tilt?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={`sticker ${className}`.trim()}
      width={size}
      height={size}
      viewBox="-2 -2 68 68"
      aria-hidden="true"
      focusable="false"
      style={{ ...style, ['--tilt' as string]: `${tilt}deg` }}
    >
      {art[name]}
    </svg>
  );
}

/**
 * A loose cluster of stickers for the corner of a hero block. Positions are
 * in percent of the cluster's box, so it scales with the space it gets.
 */
export function StickerCluster({ items, className = '' }: {
  items: Array<{ name: StickerName; size: number; x: number; y: number; tilt?: number }>;
  className?: string;
}) {
  return (
    <span className={`stickers ${className}`.trim()} aria-hidden="true">
      {items.map((item, index) => (
        <Sticker
          key={`${item.name}-${index}`}
          name={item.name}
          size={item.size}
          tilt={item.tilt ?? 0}
          style={{ left: `${item.x}%`, top: `${item.y}%`, animationDelay: `${index * -1.3}s` }}
        />
      ))}
    </span>
  );
}
