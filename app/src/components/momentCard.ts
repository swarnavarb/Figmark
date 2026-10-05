import type { ShareKind } from '@shared/models';
import type { CardDef } from '@shared/quest';
import {
  CARD_FONT, CARD_SIZE, THEMES, layoutCard, type CardHero, type CardSpec, type Measure, type Op, type Paint, type Shape, type Theme,
} from '@shared/shareCard';

/*
 * The pictures people share: a booking, a haul, a delivery, a sale, a level.
 *
 * Square, and laid out by shared/shareCard.ts - the same layout the server
 * paints as a link's preview, so the picture sent and the card the link
 * unfolds into look like one thing. Drawn on a canvas in the browser, so a
 * picture is ready the moment the sheet opens and works offline.
 *
 * No address is printed on it: the link travels beside the picture, in the
 * message, where it can be tapped. The picture's job is to make somebody want
 * to tap it - the item, the price, any discount the link brings, and the shop
 * behind it with its level.
 */

/** Who stands behind the picture, at its foot: the shop for an item, the sharer otherwise. */
export interface MomentBadge {
  name: string;
  photo?: string | null;
  level?: number | null;
  /** The level's title: "Trusted Importer", "Collector". */
  title?: string | null;
  shop?: boolean;
}

export interface Moment {
  kind: ShareKind;
  /** The big line at the top: "I'm in on this pre-order". */
  headline: string;
  /** Who, and their level. Shown only when there is no badge to say it. */
  byline: string;
  /** Item or shop photo. */
  photo?: string | null;
  /** Item name, shop name, card name. */
  title: string;
  /** One line under the title: the shop it is from, the set a card belongs to. */
  detail?: string | null;
  price?: string | null;
  fill?: { joined: number; threshold: number } | null;
  /** A level-up draws its ring. */
  level?: { level: number; title: string } | null;
  /** A card pull draws the card. */
  card?: CardDef | null;
  /** What a friend saves through the sharer's link, formatted: "₹200". Drawn as a ticket. */
  discount?: string | null;
  /** What that friend pays, with the discount taken off. */
  deal?: string | null;
  badge?: MomentBadge | null;
  /** What colours the tile when there is no photo: the listing's id, so it matches the app's own tile. */
  seed?: string | null;
}

export type { Theme };

export function themeOf(kind: ShareKind): Theme {
  return THEMES[kind];
}

export const MOMENT_SIZE = CARD_SIZE;

const RARITY_HUES: Record<CardDef['rarity'], [string, string]> = {
  common: ['#6B7C96', '#9FB0C9'],
  rare: ['#3B82F6', '#06D6E7'],
  epic: ['#7C3AED', '#EC4899'],
  legendary: ['#FBBF24', '#FF5A5F'],
};

const CARD_GLYPHS: Record<CardDef['glyph'], string> = {
  mech: '🤖', beast: '🐉', card: '🎴', shoe: '👟', box: '📦', star: '⭐',
};

/** The kinds that are about something bought and sold, and so carry Buyer Protection. */
const PROTECTED: ReadonlySet<ShareKind> = new Set(['item', 'fill', 'booked', 'purchased', 'delivered', 'sold', 'filled', 'shop']);

const FAMILY = `"${CARD_FONT}", system-ui, sans-serif`;
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/* ── Loading ────────────────────────────────────────────────────────────── */

let fontsReady: Promise<void> | null = null;

/** The app's own typeface, so the picture looks like the app. Never waits long. */
function loadFonts(): Promise<void> {
  if (!fontsReady) {
    const loads = typeof document !== 'undefined' && document.fonts
      ? Promise.all([`700 48px ${FAMILY}`, `400 48px ${FAMILY}`].map((font) => document.fonts.load(font, 'Aa₹').catch(() => []))).then(() => undefined)
      : Promise.resolve();
    fontsReady = Promise.race([loads, new Promise<void>((resolve) => window.setTimeout(resolve, 1200))]);
  }
  return fontsReady;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * A photo, ready to draw, or null. Asked for with CORS so a photo from another
 * site either arrives drawable or not at all - never one that silently poisons
 * the canvas and fails the export at the last step.
 */
export function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  let pending = images.get(src);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      const sameOrigin = src.startsWith('/') || src.startsWith(window.location.origin) || src.startsWith('data:');
      if (!sameOrigin) image.crossOrigin = 'anonymous';
      const timer = window.setTimeout(() => resolve(null), 4000);
      image.onload = () => { window.clearTimeout(timer); resolve(image); };
      image.onerror = () => { window.clearTimeout(timer); resolve(null); };
      image.src = src;
    });
    images.set(src, pending);
  }
  return pending;
}

/* ── From a moment to the card ──────────────────────────────────────────── */

function fillLine(fill: { joined: number; threshold: number }): string {
  const left = Math.max(0, fill.threshold - fill.joined);
  return left > 0 ? `${fill.joined} of ${fill.threshold} joined, ${left} spot${left === 1 ? '' : 's'} left` : 'Pre-order full';
}

/** The card for a moment, given which of its pictures actually loaded. */
export function cardFor(m: Moment, loaded: { photo: boolean; avatar: boolean }): CardSpec {
  const theme = m.card ? { ...THEMES.card, from: RARITY_HUES[m.card.rarity][0], to: RARITY_HUES[m.card.rarity][1] } : THEMES[m.kind];
  const photo = loaded.photo ? m.photo ?? null : null;
  const badgePhoto = loaded.avatar ? m.badge?.photo ?? null : null;

  let hero: CardHero;
  if (m.card) {
    hero = { kind: 'card', name: m.card.name, rarity: m.card.rarity, from: theme.from, to: theme.to, glyph: CARD_GLYPHS[m.card.glyph] };
  } else if (m.level) {
    hero = { kind: 'level', level: m.level.level };
  } else if (m.kind === 'shop' || m.kind === 'profile') {
    hero = { kind: 'avatar', name: m.title, photo, level: m.badge?.level ?? null };
  } else if (m.kind === 'invite' || m.kind === 'invite_seller') {
    hero = { kind: 'brand', glyph: theme.glyph };
  } else if (photo) {
    hero = { kind: 'photo', src: photo };
  } else {
    hero = { kind: 'tile', label: m.title };
  }

  const itemish = hero.kind === 'photo' || hero.kind === 'tile';
  const badge = m.badge ? { name: m.badge.name, photo: badgePhoto, level: m.badge.level ?? null, title: m.badge.title ?? null } : null;
  // A shop's own picture is its avatar: no need to show the same mark twice.
  const footBadge = hero.kind === 'avatar' && badge && badge.name === m.title ? null : badge;
  const byline = !m.badge && m.byline ? m.byline : null;

  return {
    seed: m.seed ?? m.photo ?? m.title,
    stamp: { label: theme.stamp, from: theme.from, to: theme.to, ink: theme.ink },
    headline: m.headline,
    hero,
    chips: itemish && m.fill ? [{ label: 'PRE-ORDER', fill: '#F472B6', ink: '#2A0614' }] : [],
    meter: itemish && m.fill && m.fill.threshold > 0 ? { joined: m.fill.joined, total: m.fill.threshold, line: fillLine(m.fill) } : null,
    title: m.title,
    detail: [m.detail, byline].filter(Boolean).join(' · ') || null,
    price: m.discount && m.deal ? m.deal : m.price ?? null,
    was: m.discount && m.deal ? m.price ?? null : null,
    off: m.discount ?? null,
    badge: footBadge,
    protection: PROTECTED.has(m.kind),
  };
}

/* ── Painting ───────────────────────────────────────────────────────────── */

type Ctx = CanvasRenderingContext2D;

function fontOf(size: number, bold: boolean, emoji = false): string {
  return emoji ? `${size}px ${EMOJI}` : `${bold ? 700 : 400} ${size}px ${FAMILY}`;
}

function shapePath(ctx: Ctx, shape: Shape) {
  ctx.beginPath();
  if (shape.kind === 'rect') {
    const r = Math.min(shape.r ?? 0, shape.w / 2, shape.h / 2);
    if (r <= 0) {
      ctx.rect(shape.x, shape.y, shape.w, shape.h);
    } else {
      const { x, y, w, h } = shape;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  } else if (shape.kind === 'circle') {
    ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
  }
}

function hexA(hex: string, alpha = 1): string {
  if (!hex.startsWith('#')) return hex;
  const value = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function paintOf(ctx: Ctx, paint: Paint): string | CanvasGradient {
  if (typeof paint === 'string') return paint;
  const gradient = 'linear' in paint
    ? ctx.createLinearGradient(...paint.linear)
    : ctx.createRadialGradient(paint.radial[0], paint.radial[1], 0, paint.radial[0], paint.radial[1], paint.radial[2]);
  for (const [offset, color, opacity] of paint.stops) gradient.addColorStop(offset, hexA(color, opacity ?? 1));
  return gradient;
}

/** Fills (or strokes) a shape; a path is drawn in its own moved and scaled space. */
function withShape(ctx: Ctx, shape: Shape, act: (path?: Path2D, scale?: number) => void) {
  if (shape.kind === 'path') {
    ctx.save();
    const [x, y, scale] = shape.at ?? [0, 0, 1];
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    act(new Path2D(shape.d), scale);
    ctx.restore();
    return;
  }
  shapePath(ctx, shape);
  act();
}

function cover(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function paint(ctx: Ctx, ops: Op[], pictures: Map<string, HTMLImageElement>) {
  for (const op of ops) {
    ctx.save();
    if ('opacity' in op && op.opacity !== undefined) ctx.globalAlpha = op.opacity;
    switch (op.op) {
      case 'fill':
        ctx.fillStyle = paintOf(ctx, op.paint);
        withShape(ctx, op.shape, (path) => (path ? ctx.fill(path) : ctx.fill()));
        break;
      case 'stroke':
        ctx.strokeStyle = paintOf(ctx, op.paint);
        if (op.dash) ctx.setLineDash(op.dash);
        if (op.round) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
        withShape(ctx, op.shape, (path, scale = 1) => {
          ctx.lineWidth = op.width / scale;
          if (path) ctx.stroke(path);
          else ctx.stroke();
        });
        break;
      case 'text':
        ctx.font = fontOf(op.size, op.bold, op.emoji);
        ctx.fillStyle = op.paint;
        ctx.textAlign = op.anchor === 'middle' ? 'center' : op.anchor === 'end' ? 'right' : 'left';
        ctx.textBaseline = op.emoji ? 'middle' : 'alphabetic';
        ctx.fillText(op.text, op.x, op.emoji ? op.y - op.size * 0.1 : op.y);
        break;
      case 'image': {
        const image = pictures.get(op.src);
        if (image) {
          withShape(ctx, op.clip, (path) => (path ? ctx.clip(path) : ctx.clip()));
          cover(ctx, image, op.x, op.y, op.w, op.h);
        }
        break;
      }
      case 'clip':
        withShape(ctx, op.shape, (path) => (path ? ctx.clip(path) : ctx.clip()));
        paint(ctx, op.ops, pictures);
        break;
    }
    ctx.restore();
  }
}

/** Draws the moment, square, and hands back a JPEG. */
export async function renderMoment(moment: Moment): Promise<Blob> {
  const [photo, avatar] = await Promise.all([loadImage(moment.photo), loadImage(moment.badge?.photo), loadFonts()]);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_SIZE;
  canvas.height = CARD_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw pictures.');

  // Measured by the browser's own font, so the lines break where they are drawn.
  const measure: Measure = (text, size, bold) => {
    ctx.font = fontOf(size, bold);
    return ctx.measureText(text).width;
  };
  const pictures = new Map<string, HTMLImageElement>();
  if (photo && moment.photo) pictures.set(moment.photo, photo);
  if (avatar && moment.badge?.photo) pictures.set(moment.badge.photo, avatar);
  paint(ctx, layoutCard(cardFor(moment, { photo: Boolean(photo), avatar: Boolean(avatar) }), measure), pictures);

  return new Promise((resolve, reject) => {
    // JPEG: a fifth the size of a PNG of the same picture, so it sends fast on a phone connection.
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the picture.'))), 'image/jpeg', 0.9);
  });
}
