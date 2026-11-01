import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PostCompare } from '@shared/social';

/**
 * Two photos read as one: the second laid over the first and cut at a line
 * the reader drags. A repaint, a custom, a figure out of its box - the
 * difference is the point, and side by side on a phone it is two small photos.
 *
 * Works with a finger, a mouse, and the arrow keys; double-tap opens the
 * photo the line is nearer.
 */
export function CompareSlider({ photos, compare, alt, onOpen }: {
  photos: [string, string] | string[];
  compare: PostCompare;
  alt: string;
  onOpen?: (index: number) => void;
}) {
  const [at, setAt] = useState(0.5);
  const box = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [before, after] = [photos[0]!, photos[1] ?? photos[0]!];

  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setAt(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    move(event.clientX);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.2 : 0.05;
    if (event.key === 'ArrowLeft') setAt((value) => Math.max(0, value - step));
    else if (event.key === 'ArrowRight') setAt((value) => Math.min(1, value + step));
    else if (event.key === 'Home') setAt(0);
    else if (event.key === 'End') setAt(1);
    else return;
    event.preventDefault();
  };

  const percent = `${Math.round(at * 1000) / 10}%`;
  return (
    <div className={`compare compare--${compare.kind}`}>
      <div ref={box} className="compare__stage"
        role="slider" tabIndex={0} aria-label={`${compare.labels[0]} and ${compare.labels[1]}: drag to compare`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at * 100)}
        aria-valuetext={`${Math.round((1 - at) * 100)}% ${compare.labels[1]}`}
        onPointerDown={down}
        onPointerMove={(event) => { if (dragging.current) move(event.clientX); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={key}
        onDoubleClick={() => onOpen?.(at > 0.5 ? 0 : 1)}>
        <img className="compare__img" src={before} alt={`${compare.labels[0]}: ${alt}`} draggable={false} loading="lazy" decoding="async" />
        <div className="compare__after" style={{ clipPath: `inset(0 0 0 ${percent})` }}>
          <img className="compare__img" src={after} alt={`${compare.labels[1]}: ${alt}`} draggable={false} loading="lazy" decoding="async" />
        </div>
        <span className="compare__line" style={{ left: percent }} aria-hidden="true">
          <span className="compare__knob">⟷</span>
        </span>
        <span className="compare__tag compare__tag--a" style={{ opacity: at > 0.12 ? 1 : 0 }}>{compare.labels[0]}</span>
        <span className="compare__tag compare__tag--b" style={{ opacity: at < 0.88 ? 1 : 0 }}>{compare.labels[1]}</span>
      </div>
    </div>
  );
}
