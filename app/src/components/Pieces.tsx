import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ListingPiece } from '@shared/pieces';
import type { ListingOffer } from '@shared/offers';
import { isPieceSold, piecesLeft } from '@shared/pieces';
import type { PhotoBox } from '../api';
import { formatMoney } from '../format';
import { haptic } from '../haptics';
import { Modal } from './ui';
import { Svg } from './ListingBlocks';

/*
 * One photo, many things for sale: what a buyer and a seller both look at.
 *
 * - PieceThumb: one thing cut out of the photo, for a row in a list.
 * - PiecePhoto: the whole photo with each thing numbered where it stands,
 *   and a cross over each one that has sold.
 * - PiecePicker: what Buy opens on such a listing - tick the ones you want,
 *   see the total and the advance, check out once.
 */

/** Photos already loaded, so forty thumbnails of one photo load it once. */
const loaded = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let found = loaded.get(src);
  if (!found) {
    found = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    found.catch(() => loaded.delete(src));
    loaded.set(src, found);
  }
  return found;
}

/** The part of the photo a box covers, with a little room round it, drawn to fit a square. */
export function PieceThumb({ src, box, size = 56, sold = false }: { src: string; box: PhotoBox | null; size?: number; sold?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void loadImage(src).then((image) => {
      const target = canvas.current;
      if (!live || !target) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      target.width = size * ratio;
      target.height = size * ratio;
      const context = target.getContext('2d');
      if (!context) return;
      const W = image.naturalWidth; const H = image.naturalHeight;
      const [bx, by, bw, bh] = box ?? [0, 0, 1, 1];
      // A tenth more each way, so the thing is not touching the edge.
      const pad = 0.1;
      let sx = (bx - bw * pad) * W; let sy = (by - bh * pad) * H;
      let sw = bw * (1 + 2 * pad) * W; let sh = bh * (1 + 2 * pad) * H;
      // Square it, round the middle, so nothing is stretched.
      const side = Math.max(sw, sh);
      sx -= (side - sw) / 2; sy -= (side - sh) / 2; sw = side; sh = side;
      context.fillStyle = '#0F1420';
      context.fillRect(0, 0, target.width, target.height);
      context.drawImage(image, sx, sy, sw, sh, 0, 0, target.width, target.height);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [src, box?.join(','), size]);
  return (
    <span className={`pcs-thumb${sold ? ' is-sold' : ''}`} style={{ width: size, height: size }}>
      <canvas ref={canvas} aria-hidden="true" />
      {sold && <span className="pcs-thumb__x" aria-hidden="true" />}
    </span>
  );
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/** A box laid over the photo. */
export function boxStyle([x, y, w, h]: PhotoBox) {
  return { left: pct(x), top: pct(y), width: pct(w), height: pct(h) };
}

/**
 * The photo with each piece numbered where it stands: a tap picks it, and a
 * sold one carries a cross. A piece shown twice is numbered at each place.
 */
export function PiecePhoto({ src, pieces, picked, onPick, alt, children }: {
  src: string;
  pieces: Pick<ListingPiece, 'id' | 'title' | 'boxes' | 'soldAt' | 'soldOrderId'>[];
  picked?: ReadonlySet<string>;
  onPick?: (id: string) => void;
  alt: string;
  children?: ReactNode;
}) {
  return (
    <div className="pcs-photo">
      <img src={src} alt={alt} draggable={false} />
      {pieces.map((piece, index) => piece.boxes.map((box, view) => {
        const sold = isPieceSold(piece);
        const on = picked?.has(piece.id) ?? false;
        return (
          <button key={`${piece.id}-${view}`} type="button"
            className={`pcs-mark${sold ? ' is-sold' : ''}${on ? ' is-on' : ''}`}
            style={boxStyle(box)} disabled={sold || !onPick}
            aria-label={`${index + 1}. ${piece.title}${sold ? ' - sold' : on ? ' - picked' : ''}`}
            aria-pressed={onPick && !sold ? on : undefined}
            onClick={(event) => { event.stopPropagation(); if (!sold) onPick?.(piece.id); }}>
            <span className="pcs-mark__n">{index + 1}</span>
            {sold && <span className="pcs-mark__x" aria-hidden="true" />}
            {sold && <span className="pcs-mark__sold">Sold</span>}
          </button>
        );
      }))}
      {children}
    </div>
  );
}

/** "12 of 40 left", for a badge and a price line. */
export function piecesCount(pieces: readonly ListingPiece[]): string {
  const left = piecesLeft(pieces).length;
  return left === pieces.length ? `${pieces.length} items` : `${left} of ${pieces.length} left`;
}

/**
 * What a buyer sees on a listing sold piece by piece: the photo, numbered,
 * with crosses on what has gone, and every piece listed with its price. A
 * tap on either picks a piece; Buy opens the picker with what was picked.
 */
/** An item's name, with its own condition under it when the listing's is "Mixed". */
function PieceName({ title, facts }: { title: string; facts?: string }) {
  if (!facts) return <span className="pcs-row__title">{title}</span>;
  return (
    <span className="pcs-row__title pcs-row__title--facts">
      <span>{title}</span>
      <small>{facts}</small>
    </span>
  );
}

export function PieceBoard({ src, pieces, title, onBuy, onCart, shippingMinor, offers = [], disabled, describe, bare = false }: {
  src: string;
  pieces: ListingPiece[];
  title: string;
  onBuy: (picked: string[]) => void;
  /** Puts what is picked in the cart instead of checking out. */
  onCart?: (picked: string[]) => void;
  /** Said beside the total, never added to it. */
  shippingMinor?: number | null;
  /** The item's offers: free shipping on 2 or more counts the items picked here, lot or no lot. */
  offers?: readonly ListingOffer[];
  disabled?: boolean;
  /** Each item's own condition or original-or-copy, when the listing's is "Mixed". */
  describe?: (piece: ListingPiece) => string;
  /** Inside a popup that already has the heading and its own frame. */
  bare?: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => {
    haptic('tap');
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const total = pieces.filter((piece) => picked.has(piece.id)).reduce((sum, piece) => sum + piece.priceMinor, 0);
  // Picked together they ship together, so "free shipping on 2 or more" is met here and now.
  const shipFree = offers.find((offer) => offer.kind === 'free_shipping' && picked.size >= (offer.minItems ?? 2));
  const nextFree = shipFree ? null : offers.find((offer) => offer.kind === 'free_shipping' && (offer.minItems ?? 2) > picked.size);
  return (
    <section className={`pcs-board${bare ? ' pcs-board--bare' : ''}`} aria-label="Items in this photo">
      {!bare && (
        <header className="pcs-board__head">
          <h2>Pick from the photo</h2>
          <span className="pcs-board__count">{piecesCount(pieces)}</span>
        </header>
      )}
      <p className="pcs-board__hint">
        {bare && <b className="pcs-board__count">{piecesCount(pieces)} · </b>}
        {disabled ? 'Each item has its own price.' : 'Each item has its own price. Tap the ones you want, then check out once.'}
      </p>
      <PiecePhoto src={src} pieces={pieces} picked={picked} onPick={disabled ? undefined : toggle} alt={title} />
      <ol className="pcs-list">
        {pieces.map((piece, index) => {
          const sold = isPieceSold(piece);
          const on = picked.has(piece.id);
          return (
            <li key={piece.id}>
              <button type="button" className={`pcs-row${sold ? ' is-sold' : ''}${on ? ' is-on' : ''}`}
                disabled={sold || disabled} aria-pressed={sold ? undefined : on} onClick={() => toggle(piece.id)}>
                <span className="pcs-row__n">{index + 1}</span>
                <PieceThumb src={src} box={piece.boxes[0] ?? null} sold={sold} />
                <PieceName title={piece.title} facts={describe?.(piece)} />
                <span className="pcs-row__price">{sold ? 'Sold' : formatMoney(piece.priceMinor)}</span>
                <span className="pcs-row__tick" aria-hidden="true">{on ? '✓' : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {picked.size > 0 && (
        <div className="pcs-board__bar">
          <span className="pcs-board__sum">
            <span><b>{picked.size}</b> picked · <b>{formatMoney(total)}</b></span>
            {shippingMinor && shipFree ? <small className="pcs-board__free">🎁 Free shipping · offer</small>
              : shippingMinor ? (
                <small>+ {formatMoney(shippingMinor)} shipping{nextFree ? ` · pick ${(nextFree.minItems ?? 2) - picked.size} more for free shipping` : ''}</small>
              ) : null}
          </span>
          <span className="pcs-board__go">
            {onCart && (
              <button type="button" className="btn btn--ghost pcs-board__cart" aria-label="Add to cart" title="Add to cart"
                onClick={() => onCart([...picked])} disabled={disabled}>
                <Svg name="cart" size={17} />
              </button>
            )}
            <button type="button" className="btn" onClick={() => onBuy([...picked])} disabled={disabled}>
              Buy {picked.size === 1 ? 'this' : `these ${picked.size}`} →
            </button>
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * What Buy opens on a listing sold piece by piece: every piece with its
 * photo, title and price; sold ones crossed out. The total, and the advance
 * when the shop takes one, follow what is ticked.
 */
export function PiecePicker({ src, pieces, initial, advancePercent, shippingMinor, busy, onClose, onCheckout, cartLabel, describe }: {
  src: string;
  pieces: ListingPiece[];
  initial?: readonly string[];
  advancePercent?: number | null;
  shippingMinor?: number | null;
  busy?: boolean;
  onClose: () => void;
  onCheckout: (ids: string[], to: 'checkout' | 'cart') => void;
  /** Shown as a second button when the item can go in the cart. */
  cartLabel?: string;
  /** Each item's own condition or original-or-copy, when the listing's is "Mixed". */
  describe?: (piece: ListingPiece) => string;
}) {
  const left = useMemo(() => piecesLeft(pieces), [pieces]);
  const [picked, setPicked] = useState<Set<string>>(() =>
    new Set((initial ?? []).filter((id) => left.some((piece) => piece.id === id))));
  const toggle = (id: string) => {
    haptic('tap');
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const chosen = pieces.filter((piece) => picked.has(piece.id));
  const totalMinor = chosen.reduce((sum, piece) => sum + piece.priceMinor, 0);
  // The advance is on what the checkout will charge: the items and their shipping.
  const advanceMinor = advancePercent ? Math.round(((totalMinor + (shippingMinor ?? 0)) * advancePercent) / 100) : null;
  const all = left.length > 0 && picked.size === left.length;

  return (
    <Modal title="Pick what you want" onClose={onClose} layout="panel">
      <div className="pcs-pick">
        <PiecePhoto src={src} pieces={pieces} picked={picked} onPick={toggle} alt="The photo" />
        <div className="pcs-pick__tools">
          <span>{left.length} of {pieces.length} still for sale</span>
          {left.length > 1 && (
            <button type="button" className="btn btn--quiet btn--sm"
              onClick={() => setPicked(all ? new Set() : new Set(left.map((piece) => piece.id)))}>
              {all ? 'Clear' : 'Pick all'}
            </button>
          )}
        </div>
        <ol className="pcs-list">
          {pieces.map((piece, index) => {
            const sold = isPieceSold(piece);
            const on = picked.has(piece.id);
            return (
              <li key={piece.id}>
                <label className={`pcs-row${sold ? ' is-sold' : ''}${on ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={on} disabled={sold} onChange={() => toggle(piece.id)} />
                  <span className="pcs-row__n">{index + 1}</span>
                  <PieceThumb src={src} box={piece.boxes[0] ?? null} sold={sold} />
                  <PieceName title={piece.title} facts={describe?.(piece)} />
                  <span className="pcs-row__price">{sold ? 'Sold' : formatMoney(piece.priceMinor)}</span>
                </label>
              </li>
            );
          })}
        </ol>
        <div className="pcs-pick__sum" aria-live="polite">
          <div className="pcs-pick__lines">
            <span>{picked.size === 0 ? 'Nothing picked yet' : `${picked.size} ${picked.size === 1 ? 'item' : 'items'}`}</span>
            <b>{formatMoney(totalMinor)}</b>
            {shippingMinor ? <span className="faint">+ {formatMoney(shippingMinor)} shipping</span> : null}
            {advanceMinor !== null && totalMinor > 0 && (
              <span className="pcs-pick__adv">or {formatMoney(advanceMinor)} now ({advancePercent}% advance), rest later</span>
            )}
          </div>
          <div className="pcs-pick__go">
            {cartLabel && (
              <button type="button" className="btn btn--ghost" disabled={busy || picked.size === 0}
                onClick={() => onCheckout([...picked], 'cart')}>{cartLabel}</button>
            )}
            <button type="button" className="btn" disabled={busy || picked.size === 0}
              onClick={() => onCheckout([...picked], 'checkout')}>
              {busy ? 'One moment…' : 'Checkout →'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
