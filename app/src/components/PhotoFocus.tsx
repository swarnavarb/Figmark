import { useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import type { PhotoBox, PhotoItem, PhotoSuggestion } from '../api';
import { formatMoney } from '../format';
import type { PhotoQuery } from '../photoQuery';
import { Icon, Thumb, leadPhoto } from './ui';

/**
 * The photo being searched with, and which part of it.
 *
 * A photo of several things - a haul, a shelf, a lot - comes back with each
 * thing marked on it. Tapping one searches with that thing alone; "Whole photo"
 * searches with all of them at once; "Draw" lets the shopper drag a box round
 * anything the search did not mark. Each thing's chip carries a peek at its
 * best matches, so the shopper can see which is worth tapping.
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
  const [drawMode, setDrawMode] = useState(false);
  const [drag, setDrag] = useState<{ from: [number, number]; to: [number, number] } | null>(null);

  const at = (event: PointerEvent): [number, number] => {
    const rect = frame.current!.getBoundingClientRect();
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)];
  };
  const boxOf = ({ from, to }: { from: [number, number]; to: [number, number] }): PhotoBox => [
    Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]),
  ];
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = at(event);
    setDrag({ from: point, to: point });
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ ...drag, to: at(event) });
  };
  const up = () => {
    if (!drag) return;
    const box = boxOf(drag);
    setDrag(null);
    // A tap is not a box: the server wants something to look at.
    if (box[2] >= 0.05 && box[3] >= 0.05) {
      setDrawMode(false);
      onPick(box.map((part) => Math.round(part * 1000) / 1000) as PhotoBox);
    }
  };

  const same = (a: PhotoBox | null, b: PhotoBox | null) => !!a && !!b && a.every((part, n) => Math.abs(part - b[n]!) < 0.002);
  const picked = items.findIndex((item) => same(item.box, region));
  const drawn = region && picked < 0 ? region : null;
  const place = (box: PhotoBox) => ({
    left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%`,
  });
  const name = (item: PhotoItem, n: number) => item.label ?? `Item ${n + 1}`;

  return (
    <section className={`pfocus${busy ? ' is-busy' : ''}`} aria-label="Your photo">
      <div
        ref={frame}
        className={`pfocus__frame${drawMode ? ' is-drawing' : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
      >
        <img src={photo.dataUrl} alt="Your photo" draggable={false} />
        {region && <div className="pfocus__shade" style={place(region)} aria-hidden="true" />}
        {items.map((item, n) => (
          <button
            key={n}
            type="button"
            className={`pfocus__box${n === picked ? ' is-on' : ''}`}
            style={place(item.box)}
            aria-label={`Search with ${name(item, n)} only`}
            aria-pressed={n === picked}
            onClick={() => onPick(n === picked ? null : item.box)}
          >
            <span className="pfocus__num">{n + 1}</span>
          </button>
        ))}
        {drawn && <div className="pfocus__box is-on is-drawn" style={place(drawn)} aria-hidden="true" />}
        {drag && <div className="pfocus__box is-drag" style={place(boxOf(drag))} aria-hidden="true" />}
      </div>

      <div className="pfocus__side">
        <h2 className="pfocus__title">
          Your photo
          <button type="button" className="qphoto__clear" aria-label="Clear photo search" onClick={onClear}>
            <Icon name="close" size={12} />
          </button>
        </h2>
        <p className="pfocus__hint faint">
          {drawMode
            ? 'Drag across the photo round the thing you want.'
            : items.length > 0
              ? `${items.length} things in this photo. Tap one to search for it alone.`
              : 'Searching the whole photo. Draw round one thing to search for just that.'}
        </p>
        <div className="pfocus__chips" role="group" aria-label="Search with">
          <button type="button" className={`pfocus__chip${!region ? ' is-on' : ''}`} aria-pressed={!region} onClick={() => onPick(null)}>
            <Icon name="image" size={14} /> Whole photo
          </button>
          {items.map((item, n) => (
            <button
              key={n}
              type="button"
              className={`pfocus__chip${n === picked ? ' is-on' : ''}`}
              aria-pressed={n === picked}
              onClick={() => onPick(item.box)}
            >
              <span className="pfocus__num">{n + 1}</span>
              <span className="pfocus__label">{name(item, n)}</span>
              {item.preview.length > 0 && (
                <span className="pfocus__peek" aria-hidden="true">
                  {item.preview.map((entry) => entry.photoUrl && (
                    <img key={entry.id} src={entry.photoUrl} alt="" loading="lazy" decoding="async" />
                  ))}
                </span>
              )}
              <span className="faint">{item.matches > 0 ? item.matches : 'none'}</span>
            </button>
          ))}
          {drawn && (
            <button type="button" className="pfocus__chip is-on" aria-pressed="true" onClick={() => onPick(null)}>
              Your box <Icon name="close" size={10} />
            </button>
          )}
          <button
            type="button"
            className={`pfocus__chip${drawMode ? ' is-on' : ''}`}
            aria-pressed={drawMode}
            onClick={() => setDrawMode((on) => !on)}
          >
            <Icon name="target" size={14} /> {drawMode ? 'Cancel' : 'Draw'}
          </button>
        </div>
      </div>
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
