import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { PhotoBox } from '../api';
import { haptic } from '../haptics';
import { boxStyle } from './Pieces';

/*
 * The seller's photo of several things, to mark them on: every box can be
 * moved by dragging it and resized by its corners, the photo zooms (pinch,
 * the buttons, or ctrl-scroll) to get at small things on a crowded shelf,
 * and "Add item" draws a new box. The numbers are bare, so the photo shows
 * through. Tapping a box picks it; what to call it and its price are typed
 * in the bar under the photo (`children`), so the photo stays in view.
 */

export interface MarkedThing {
  key: string;
  boxes: PhotoBox[];
  /** Named and priced: drawn green; otherwise amber. */
  done: boolean;
  sold?: boolean;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
/** The smallest box a drag can make or a resize can leave, as a share of the photo. */
const MIN_SIDE = 0.02;

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'move' | Corner; key: string; view: number; from: [number, number]; start: PhotoBox; moved: boolean };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (box: PhotoBox) => box.map((part) => Math.round(part * 1000) / 1000) as PhotoBox;

export function PhotoMarker({ photoUrl, things, selected, onSelect, onBox, onAdd, adding, onAdding, children }: {
  photoUrl: string;
  things: MarkedThing[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** A box moved or resized. */
  onBox: (key: string, view: number, box: PhotoBox) => void;
  /** A new box drawn while adding. */
  onAdd: (box: PhotoBox) => void;
  adding: boolean;
  onAdding: (on: boolean) => void;
  /** The bar under the photo: the picked thing's name and price. */
  children?: ReactNode;
}) {
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Where the photo should stay put under the fingers as it zooms: a point on the photo and where it is on screen. */
  const anchor = useRef<{ fx: number; fy: number; sx: number; sy: number } | null>(null);
  /** The click a drag ends with is not a tap: it neither picks nor lets go. */
  const dragged = useRef(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /** Zoom to `next`, keeping the photo still under (clientX, clientY), or the middle of the view. */
  const zoomTo = (next: number, clientX?: number, clientY?: number) => {
    const target = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const frame = view.current; const inner = canvas.current;
    if (!frame || !inner) { setZoom(target); return; }
    const outer = frame.getBoundingClientRect();
    const sx = (clientX ?? outer.left + outer.width / 2) - outer.left;
    const sy = (clientY ?? outer.top + outer.height / 2) - outer.top;
    anchor.current = { fx: (frame.scrollLeft + sx) / inner.offsetWidth, fy: (frame.scrollTop + sy) / inner.offsetHeight, sx, sy };
    setZoom(target);
  };
  useLayoutEffect(() => {
    const frame = view.current; const inner = canvas.current; const at = anchor.current;
    if (!frame || !inner || !at) return;
    anchor.current = null;
    frame.scrollLeft = at.fx * inner.offsetWidth - at.sx;
    frame.scrollTop = at.fy * inner.offsetHeight - at.sy;
  }, [zoom]);

  // Two fingers zoom the photo, not the page; ctrl-scroll (and a trackpad pinch) does too.
  useEffect(() => {
    const frame = view.current;
    if (!frame) return;
    let pinch: { distance: number; zoom: number } | null = null;
    const spread = (touches: TouchList) => Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) { pinch = { distance: spread(event.touches), zoom: zoomRef.current }; event.preventDefault(); }
    };
    const move = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const midX = (event.touches[0]!.clientX + event.touches[1]!.clientX) / 2;
      const midY = (event.touches[0]!.clientY + event.touches[1]!.clientY) / 2;
      zoomTo(pinch.zoom * (spread(event.touches) / pinch.distance), midX, midY);
    };
    const end = (event: TouchEvent) => { if (event.touches.length < 2) pinch = null; };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-event.deltaY / 200), event.clientX, event.clientY);
    };
    frame.addEventListener('touchstart', start, { passive: false });
    frame.addEventListener('touchmove', move, { passive: false });
    frame.addEventListener('touchend', end);
    frame.addEventListener('wheel', wheel, { passive: false });
    return () => {
      frame.removeEventListener('touchstart', start);
      frame.removeEventListener('touchmove', move);
      frame.removeEventListener('touchend', end);
      frame.removeEventListener('wheel', wheel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A thing picked from its row is brought into view on the zoomed photo.
  useEffect(() => {
    const frame = view.current; const inner = canvas.current;
    const box = things.find((thing) => thing.key === selected)?.boxes[0];
    if (!frame || !inner || !box || zoom <= 1) return;
    const [x, y, w, h] = box;
    const left = x * inner.offsetWidth; const top = y * inner.offsetHeight;
    const right = (x + w) * inner.offsetWidth; const bottom = (y + h) * inner.offsetHeight;
    if (left < frame.scrollLeft || right > frame.scrollLeft + frame.clientWidth || top < frame.scrollTop || bottom > frame.scrollTop + frame.clientHeight) {
      frame.scrollTo({ left: (left + right) / 2 - frame.clientWidth / 2, top: (top + bottom) / 2 - frame.clientHeight / 2, behavior: 'smooth' });
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect();
    return [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1)];
  };

  const beginDraw = (event: ReactPointerEvent) => {
    if (!adding || event.button !== 0) return;
    const [x, y] = at(event);
    canvas.current?.setPointerCapture(event.pointerId);
    setDrag({ kind: 'draw', x0: x, y0: y, x1: x, y1: y });
  };
  const beginEdit = (kind: 'move' | Corner, key: string, viewIndex: number, box: PhotoBox) => (event: ReactPointerEvent) => {
    if (event.button !== 0 || adding) return;
    event.stopPropagation();
    canvas.current?.setPointerCapture(event.pointerId);
    setDrag({ kind, key, view: viewIndex, from: at(event), start: box, moved: false });
  };

  const onMove = (event: ReactPointerEvent) => {
    if (!drag) return;
    const [x, y] = at(event);
    if (drag.kind === 'draw') { setDrag({ ...drag, x1: x, y1: y }); return; }
    const dx = x - drag.from[0]; const dy = y - drag.from[1];
    if (!drag.moved && Math.hypot(dx, dy) < 0.004) return;
    const [bx, by, bw, bh] = drag.start;
    let next: PhotoBox;
    if (drag.kind === 'move') {
      next = [clamp(bx + dx, 0, 1 - bw), clamp(by + dy, 0, 1 - bh), bw, bh];
    } else {
      let left = bx; let top = by; let right = bx + bw; let bottom = by + bh;
      if (drag.kind === 'nw' || drag.kind === 'sw') left = clamp(bx + dx, 0, right - MIN_SIDE);
      if (drag.kind === 'ne' || drag.kind === 'se') right = clamp(bx + bw + dx, left + MIN_SIDE, 1);
      if (drag.kind === 'nw' || drag.kind === 'ne') top = clamp(by + dy, 0, bottom - MIN_SIDE);
      if (drag.kind === 'sw' || drag.kind === 'se') bottom = clamp(by + bh + dy, top + MIN_SIDE, 1);
      next = [left, top, right - left, bottom - top];
    }
    if (!drag.moved) setDrag({ ...drag, moved: true });
    onBox(drag.key, drag.view, round(next));
  };

  const onUp = () => {
    if (!drag) return;
    setDrag(null);
    dragged.current = drag.kind === 'draw' || drag.moved;
    window.setTimeout(() => { dragged.current = false; }, 0);
    if (drag.kind !== 'draw') {
      if (drag.moved) haptic('tap');
      return;
    }
    const { x0, y0, x1, y1 } = drag;
    let box: PhotoBox;
    if (Math.abs(x1 - x0) < 0.02 && Math.abs(y1 - y0) < 0.02) {
      // A tap: a box of a figure's usual size round where it landed, made smaller the more the photo is zoomed.
      const w = 0.12 / Math.sqrt(zoom); const h = 0.2 / Math.sqrt(zoom);
      box = [clamp(x0 - w / 2, 0, 1 - w), clamp(y0 - h / 2, 0, 1 - h), w, h];
    } else {
      box = [Math.min(x0, x1), Math.min(y0, y1), Math.max(MIN_SIDE, Math.abs(x1 - x0)), Math.max(MIN_SIDE, Math.abs(y1 - y0))];
    }
    haptic('tap');
    onAdd(round(box));
  };

  const drawn = drag?.kind === 'draw'
    ? [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)] as PhotoBox
    : null;

  return (
    <div className="pcm">
      <div className="pcm__bar">
        <button type="button" className={`pcm__add${adding ? ' is-on' : ''}`} aria-pressed={adding}
          onClick={() => { haptic('tap'); onAdding(!adding); }}>
          {adding ? 'Cancel' : '＋ Add item'}
        </button>
        <span className="pcm__zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">−</button>
          <button type="button" className="pcm__pct" onClick={() => zoomTo(1)} aria-label="Fit the photo">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">+</button>
        </span>
      </div>
      <p className="pcm__hint">
        {adding
          ? <><b>Drag round the item</b> on the photo, or tap it.</>
          : <>Tap a box to name it · drag to move · pull a corner to resize · pinch to zoom</>}
      </p>
      <div ref={view} className={`pcm__view${zoom > 1 ? ' is-zoomed' : ''}`}>
        <div ref={canvas} className={`pcm__canvas${adding ? ' is-adding' : ''}`} style={{ width: `${zoom * 100}%` }}
          onPointerDown={beginDraw} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
          onClick={(event) => { if (!dragged.current && !adding && event.target === canvas.current) onSelect(null); }}>
          <img src={photoUrl} alt="Your photo, with each item marked" draggable={false} />
          {things.map((thing, index) => thing.boxes.map((place, viewIndex) => {
            const on = selected === thing.key;
            const editable = on && !thing.sold && !adding;
            return (
              <span key={`${thing.key}-${viewIndex}`} style={boxStyle(place)}
                className={`pcm__box${on ? ' is-on' : ''}${thing.sold ? ' is-sold' : thing.done ? ' is-done' : ''}`}
                onPointerDown={editable ? beginEdit('move', thing.key, viewIndex, place) : undefined}
                onClick={(event) => { event.stopPropagation(); if (!dragged.current && !adding && !on) { haptic('tap'); onSelect(thing.key); } }}>
                <span className="pcm__n">{index + 1}</span>
                {editable && (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                  <span key={corner} className={`pcm__handle pcm__handle--${corner}`} onPointerDown={beginEdit(corner, thing.key, viewIndex, place)} />
                ))}
              </span>
            );
          }))}
          {drawn && <span className="pcm__box is-new" style={boxStyle(drawn)} />}
        </div>
      </div>
      {children}
    </div>
  );
}
