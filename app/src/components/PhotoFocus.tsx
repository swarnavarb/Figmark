import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import type { PhotoBox, PhotoItem, PhotoSuggestion } from '../api';
import { formatMoney } from '../format';
import type { PhotoQuery } from '../photoQuery';
import { Icon, Thumb, leadPhoto } from './ui';

/** Smaller than this, as a share of the photo's width or height, a box is a slip of the finger. */
const MIN_SIDE = 0.05;

type Edge = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const round = (box: PhotoBox) => box.map((part) => Math.round(part * 1000) / 1000) as PhotoBox;
const sameBox = (a: PhotoBox | null, b: PhotoBox | null) => !!a && !!b && a.every((part, n) => Math.abs(part - b[n]!) < 0.002);

/** A box moved or stretched by (dx, dy), kept inside the photo and never smaller than a fingertip. */
function reshape([x, y, w, h]: PhotoBox, edge: Edge, dx: number, dy: number): PhotoBox {
  if (edge === 'move') {
    return [clamp01(Math.min(x + dx, 1 - w)), clamp01(Math.min(y + dy, 1 - h)), w, h];
  }
  let left = x; let top = y; let right = x + w; let bottom = y + h;
  if (edge === 'nw' || edge === 'sw') left = clamp01(Math.min(left + dx, right - MIN_SIDE));
  if (edge === 'ne' || edge === 'se') right = clamp01(Math.max(right + dx, left + MIN_SIDE));
  if (edge === 'nw' || edge === 'ne') top = clamp01(Math.min(top + dy, bottom - MIN_SIDE));
  if (edge === 'sw' || edge === 'se') bottom = clamp01(Math.max(bottom + dy, top + MIN_SIDE));
  return [left, top, right - left, bottom - top];
}

/** Each item cut from the photo as a small picture, for the strip under it. */
function useCrops(photo: PhotoQuery, boxes: PhotoBox[]): string[] {
  const [crops, setCrops] = useState<string[]>([]);
  const key = JSON.stringify(boxes);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const out = boxes.map(([x, y, w, h]) => {
        const canvas = document.createElement('canvas');
        canvas.width = 96; canvas.height = 120;
        const context = canvas.getContext('2d');
        if (!context) return '';
        // Cover the tile, as the photo's own crop would: the middle of the item, uncut.
        const sw = w * image.naturalWidth; const sh = h * image.naturalHeight;
        const scale = Math.max(canvas.width / sw, canvas.height / sh);
        const cw = canvas.width / scale; const ch = canvas.height / scale;
        const sx = x * image.naturalWidth + (sw - cw) / 2; const sy = y * image.naturalHeight + (sh - ch) / 2;
        context.drawImage(image, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8);
      });
      setCrops(out);
    };
    image.src = photo.dataUrl;
    return () => { cancelled = true; };
    // `key` stands for the boxes: a new array with the same boxes is no new crop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.dataUrl, key]);
  return crops;
}

/**
 * The photo being searched with, and which part of it.
 *
 * Every thing found in the photo wears a dot. Tapping a dot puts a box round
 * that thing and searches with it; the box can be dragged to move it and
 * stretched by its corners to take in more or less, and searches again when
 * let go. Dragging across the photo where there is no box draws a new one, for
 * anything that was not found. Under the photo, a strip: the whole photo
 * first, then each thing cut out, the one being searched with outlined.
 */
export function PhotoFocus({ photo, items, region, onPick, onClear, busy }: {
  photo: PhotoQuery;
  items: PhotoItem[];
  /** The part searched with, or null for the whole photo. */
  region: PhotoBox | null;
  onPick: (box: PhotoBox | null) => void;
  onClear: () => void;
  busy: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  // The box as it is being dragged; searched with only when let go.
  const [live, setLive] = useState<PhotoBox | null>(null);
  const gesture = useRef<{ edge: Edge | 'draw'; from: [number, number]; start: PhotoBox | null; moved: boolean } | null>(null);
  const crops = useCrops(photo, items.map((item) => item.box));

  const at = (event: PointerEvent): [number, number] => {
    const rect = frame.current!.getBoundingClientRect();
    return [clamp01((event.clientX - rect.left) / rect.width), clamp01((event.clientY - rect.top) / rect.height)];
  };

  const begin = (edge: Edge | 'draw') => (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    frame.current!.setPointerCapture(event.pointerId);
    gesture.current = { edge, from: at(event), start: region, moved: false };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const now = gesture.current;
    if (!now) return;
    const [px, py] = at(event);
    const dx = px - now.from[0]; const dy = py - now.from[1];
    if (!now.moved && Math.hypot(dx, dy) < 0.01) return;
    now.moved = true;
    if (now.edge === 'draw') {
      setLive([Math.min(now.from[0], px), Math.min(now.from[1], py), Math.abs(dx), Math.abs(dy)]);
    } else if (now.start) {
      setLive(reshape(now.start, now.edge, dx, dy));
    }
  };
  const end = () => {
    const now = gesture.current;
    gesture.current = null;
    const box = live;
    setLive(null);
    if (!now?.moved || !box || box[2] < MIN_SIDE || box[3] < MIN_SIDE) return;
    onPick(round(box));
  };

  const shown = live ?? region;
  const picked = items.findIndex((item) => sameBox(item.box, region));
  const place = (box: PhotoBox) => ({
    left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%`,
  });
  const name = (item: PhotoItem, n: number) => item.label ?? `Item ${n + 1}`;

  return (
    <section className={`pstage${busy ? ' is-busy' : ''}`} aria-label="Your photo">
      <div className="pstage__view">
        <div
          ref={frame}
          className="pstage__frame"
          onPointerDown={begin('draw')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => { gesture.current = null; setLive(null); }}
        >
          <img src={photo.dataUrl} alt="Your photo" draggable={false} />
          {items.map((item, n) => n !== picked && (
            <button
              key={n}
              type="button"
              className="pstage__dot"
              style={{ left: `${(item.box[0] + item.box[2] / 2) * 100}%`, top: `${(item.box[1] + item.box[3] / 2) * 100}%` }}
              aria-label={`Search for ${name(item, n)}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onPick(item.box)}
            />
          ))}
          {shown && (
            <div className="pstage__box" style={place(shown)} onPointerDown={begin('move')} role="group"
              aria-label="The part of the photo searched with. Drag to move, drag a corner to resize.">
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <span key={corner} className={`pstage__handle pstage__handle--${corner}`} onPointerDown={begin(corner)} aria-hidden="true" />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pstage__bar">
        <div className="pstage__strip" role="group" aria-label="Search with">
          <button type="button" className={`pstage__tile pstage__tile--whole${!region ? ' is-on' : ''}`}
            aria-pressed={!region} aria-label="Whole photo" onClick={() => onPick(null)}>
            <img src={photo.dataUrl} alt="" />
            <span>All</span>
          </button>
          {items.map((item, n) => (
            <button key={n} type="button" className={`pstage__tile${n === picked ? ' is-on' : ''}`}
              aria-pressed={n === picked} aria-label={name(item, n)} title={name(item, n)} onClick={() => onPick(item.box)}>
              {crops[n] ? <img src={crops[n]} alt="" /> : <span className="pstage__num">{n + 1}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="pstage__close" aria-label="Clear photo search" onClick={onClear}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <p className="pstage__hint">
        {items.length > 1
          ? `${items.length} things found. Tap a dot to search for it; drag the box or its corners to adjust.`
          : 'Drag the box or its corners to adjust, or drag across the photo to draw one.'}
      </p>
    </section>
  );
}

const BECAUSE: Record<PhotoSuggestion['because'], string> = { colour: 'Other colour', name: 'Similar name' };

/**
 * Listings suggested beside a photo's matches: the same thing in other colours
 * - a repaint, a variant, another colourway - and listings named almost the
 * same as a match, typos and all. Each says which it is, so a shopper hunting
 * one colourway sees the others without mistaking them for it.
 */
export function PhotoSuggestions({ listings }: { listings: PhotoSuggestion[] }) {
  if (listings.length === 0) return null;
  const colours = listings.filter((listing) => listing.because === 'colour').length;
  return (
    <section className="psug" aria-label="Suggested">
      <div className="psug__head">
        <h2>Also suggested</h2>
        <span className="faint">
          {colours === listings.length ? 'Other colours of it'
            : colours === 0 ? 'Named almost the same'
              : 'Other colours, and names almost the same'}
        </span>
      </div>
      <div className="psug__row">
        {listings.map((listing) => (
          <Link key={listing.id} to={`/listing/${listing.id}`} className="psug__card">
            <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb psug__art" />
            <span className={`psug__why psug__why--${listing.because}`}>{BECAUSE[listing.because]}</span>
            <span className="psug__name">{listing.title}</span>
            <b className="psug__price">{formatMoney(listing.priceMinor, listing.currency)}</b>
          </Link>
        ))}
      </div>
    </section>
  );
}
