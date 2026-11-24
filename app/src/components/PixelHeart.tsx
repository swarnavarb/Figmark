/**
 * The save button's pixel heart, shared by the shop's cards and the item
 * page: hollow until saved, then full, with a burst of little hearts when
 * saved and one grey one dropping when taken back. Styles: `.qheart` and
 * `.qpop` in styles.css.
 */
/** A pixel heart for saving: hollow until saved, then full. */
export const HEART_FULL = 'M1 0h1v1h-1zM2 0h1v1h-1zM6 0h1v1h-1zM7 0h1v1h-1zM0 1h1v1h-1zM1 1h1v1h-1zM2 1h1v1h-1zM3 1h1v1h-1zM5 1h1v1h-1zM6 1h1v1h-1zM7 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM1 2h1v1h-1zM2 2h1v1h-1zM3 2h1v1h-1zM4 2h1v1h-1zM5 2h1v1h-1zM6 2h1v1h-1zM7 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM1 3h1v1h-1zM2 3h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM7 3h1v1h-1zM8 3h1v1h-1zM1 4h1v1h-1zM2 4h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1zM5 6h1v1h-1zM4 7h1v1h-1z';
const HEART_EDGE = 'M1 0h1v1h-1zM2 0h1v1h-1zM6 0h1v1h-1zM7 0h1v1h-1zM0 1h1v1h-1zM3 1h1v1h-1zM5 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM4 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM8 3h1v1h-1zM1 4h1v1h-1zM7 4h1v1h-1zM2 5h1v1h-1zM6 5h1v1h-1zM3 6h1v1h-1zM5 6h1v1h-1zM4 7h1v1h-1z';

export function PixelHeart({ full }: { full: boolean }) {
  return (
    <svg width="18" height="16" viewBox="0 0 9 8" shapeRendering="crispEdges" aria-hidden="true">
      {full ? <path d={HEART_FULL} fill="currentColor" /> : <path d={HEART_EDGE} fill="currentColor" />}
      {full ? <path d="M2 1h1v1h-1zM1 2h1v1h-1z" fill="#fff" opacity=".85" /> : null}
    </svg>
  );
}

/** Where each little heart of a save's burst flies to, and how big it is. */
// The button sits in the card's top-right corner, so the burst spills down
// and to the left, into the photo, where none of it is cut off by the edge.
const HEART_BURST = [
  { x: -30, y: -12, s: 0.9, r: -18 }, { x: -40, y: 10, s: 1.1, r: -6 }, { x: -24, y: 30, s: 0.9, r: 12 },
  { x: 0, y: 38, s: 0.75, r: 20 }, { x: 14, y: 24, s: 0.6, r: 28 }, { x: -52, y: -4, s: 0.6, r: -26 },
  { x: -46, y: 34, s: 0.65, r: 8 },
];

/**
 * The save's reward, in the card's own pixel art: little hearts burst out of
 * the button and blink out as they rise, over a quick square ring. Taking a
 * save back drops one grey, broken-looking heart instead.
 */
export function HeartPop({ gain }: { gain: boolean }) {
  return (
    <span className={`qpop${gain ? '' : ' qpop--loss'}`} aria-hidden="true">
      {gain && <span className="qpop__ring" />}
      {(gain ? HEART_BURST : [{ x: 0, y: 26, s: 0.9, r: 14 }]).map((spot, i) => (
        <span key={i} className="qpop__heart" style={{
          ['--x' as string]: `${spot.x}px`, ['--y' as string]: `${spot.y}px`,
          ['--s' as string]: spot.s, ['--r' as string]: `${spot.r}deg`, ['--d' as string]: `${i * 25}ms`,
        }}>
          <svg width="9" height="8" viewBox="0 0 9 8" shapeRendering="crispEdges"><path d={HEART_FULL} fill="currentColor" /></svg>
        </span>
      ))}
    </span>
  );
}

