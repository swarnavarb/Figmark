import type { ShareKind } from '@shared/models';
import type { CardDef } from '@shared/quest';

/*
 * The pictures people share: a booking, a haul, a delivery, a sale, a level.
 *
 * Drawn on a canvas in the browser rather than by a server, so a picture is
 * ready the moment the sheet opens - no upload, no wait, nothing to host - and
 * works offline. One renderer, two shapes: a 9:16 story for WhatsApp Status
 * and Instagram, and a 4:5 post for chats and feeds.
 *
 * No address is printed on it: the link travels beside the picture, in the
 * message, where it can be tapped. The picture's job is to make somebody want
 * to tap it - the item, the price, any discount the link brings, and the shop
 * behind it with its level, so it reads as a shop worth trusting.
 */

export type MomentFormat = 'story' | 'post';

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
  /** Under it: who, and their level. Left out when it would only repeat the badge. */
  byline: string;
  /** Item or shop photo. Drawn cover-fit, and blurred behind everything as the backdrop. */
  photo?: string | null;
  /** Item name, shop name, card name. */
  title: string;
  /** One line under the title: the shop it is from, the set a card belongs to. */
  detail?: string | null;
  price?: string | null;
  fill?: { joined: number; threshold: number } | null;
  /** A level-up draws a ring instead of a photo. */
  level?: { level: number; title: string } | null;
  /** A card pull draws the card. */
  card?: CardDef | null;
  /** What a friend saves through the sharer's link, formatted: "₹200". Drawn as a ticket. */
  discount?: string | null;
  badge?: MomentBadge | null;
}

interface Theme {
  stamp: string;
  from: string;
  to: string;
  /** Text on the stamp pill. */
  ink: string;
  glyph: string;
}

/* The brand's six hues, paired the way the app's own gradients pair them. */
const THEMES: Record<ShareKind, Theme> = {
  booked: { stamp: 'BOOKED', from: '#7C3AED', to: '#EC4899', ink: '#FFFFFF', glyph: '🎟️' },
  fill: { stamp: 'SPOTS LEFT', from: '#7C3AED', to: '#06D6E7', ink: '#FFFFFF', glyph: '⏳' },
  purchased: { stamp: 'SECURED', from: '#06D6E7', to: '#3B82F6', ink: '#002229', glyph: '🛍️' },
  delivered: { stamp: "IT'S HERE", from: '#A3E635', to: '#06D6E7', ink: '#16250A', glyph: '📦' },
  sold: { stamp: 'SOLD', from: '#FF5A5F', to: '#EC4899', ink: '#2A0709', glyph: '🔥' },
  filled: { stamp: 'FILLED', from: '#FBBF24', to: '#FF5A5F', ink: '#2B1D00', glyph: '🏁' },
  item: { stamp: 'FOUND IT', from: '#7C3AED', to: '#EC4899', ink: '#FFFFFF', glyph: '✨' },
  level: { stamp: 'LEVEL UP', from: '#FBBF24', to: '#7C3AED', ink: '#2B1D00', glyph: '⭐' },
  card: { stamp: 'PULLED', from: '#7C3AED', to: '#06D6E7', ink: '#FFFFFF', glyph: '🃏' },
  set: { stamp: 'SET COMPLETE', from: '#A3E635', to: '#7C3AED', ink: '#16250A', glyph: '🏆' },
  shop: { stamp: 'SHOP', from: '#3B82F6', to: '#7C3AED', ink: '#FFFFFF', glyph: '🏪' },
  profile: { stamp: 'COLLECTOR', from: '#EC4899', to: '#7C3AED', ink: '#FFFFFF', glyph: '💎' },
  invite: { stamp: "YOU'RE INVITED", from: '#7C3AED', to: '#FF5A5F', ink: '#FFFFFF', glyph: '💌' },
  invite_seller: { stamp: 'SELL WITH ME', from: '#A3E635', to: '#06D6E7', ink: '#16250A', glyph: '🚀' },
};

/** The app's level colours (see `.lvtag--l*` in styles.css): its own up to ten, then one per titled band. */
const LEVEL_HUES: [number, string, string][] = [
  [50, '#F43F5E', '#FBBF24'], [30, '#D97706', '#F87171'], [20, '#E11D48', '#F472B6'], [15, '#0891B2', '#22D3EE'],
  [10, '#B8860B', '#F5C542'], [9, '#C2410C', '#FBBF24'], [8, '#BE123C', '#FB7185'], [7, '#A21CAF', '#F472B6'],
  [6, '#6D28D9', '#C084FC'], [5, '#1D4ED8', '#818CF8'], [4, '#0369A1', '#38BDF8'], [3, '#0F766E', '#2DD4BF'],
  [2, '#15803D', '#4ADE80'], [1, '#475569', '#94A3B8'],
];

function levelHues(level: number): [string, string] {
  const found = LEVEL_HUES.find(([rung]) => level >= rung) ?? LEVEL_HUES[LEVEL_HUES.length - 1]!;
  return [found[1], found[2]];
}

const RARITY_HUES: Record<CardDef['rarity'], [string, string]> = {
  common: ['#6B7C96', '#9FB0C9'],
  rare: ['#3B82F6', '#06D6E7'],
  epic: ['#7C3AED', '#EC4899'],
  legendary: ['#FBBF24', '#FF5A5F'],
};

const BG = '#080B12';
const SURFACE = '#0F1420';
const TEXT = '#F2F5FA';
const DIM = '#9FB0C9';
const DISPLAY = '"Bricolage Grotesque", "Archivo", system-ui, sans-serif';
const BODY = '"Archivo", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export function themeOf(kind: ShareKind): Theme {
  return THEMES[kind];
}

/* ── Loading ────────────────────────────────────────────────────────────── */

let fontsReady: Promise<void> | null = null;

/** The app's own typefaces, so the picture looks like the app. Never waits long. */
function loadFonts(): Promise<void> {
  if (!fontsReady) {
    const wanted = [`800 96px ${DISPLAY}`, `700 48px ${BODY}`, `500 36px ${BODY}`, `600 40px ${MONO}`];
    const loads = typeof document !== 'undefined' && document.fonts
      ? Promise.all(wanted.map((font) => document.fonts.load(font).catch(() => []))).then(() => undefined)
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
      const sameOrigin = src.startsWith('/') || src.startsWith(window.location.origin);
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

/* ── Drawing helpers ────────────────────────────────────────────────────── */

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function gradient(ctx: Ctx, x: number, y: number, w: number, h: number, from: string, to: string) {
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, from);
  fill.addColorStop(1, to);
  return fill;
}

/** Lines that fit, the last one cut with an ellipsis when there is more. */
function wrap(ctx: Ctx, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** The largest size, from `size` down, at which the text fits in `maxLines`. */
function fit(ctx: Ctx, text: string, font: (size: number) => string, size: number, min: number, width: number, maxLines: number) {
  for (let current = size; current >= min; current -= 4) {
    ctx.font = font(current);
    const lines = wrap(ctx, text, width, 99);
    if (lines.length <= maxLines) return { size: current, lines };
  }
  ctx.font = font(min);
  return { size: min, lines: wrap(ctx, text, width, maxLines) };
}

/** A small seeded random, so the same moment always draws the same confetti. */
function seeded(seed: string) {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) value = Math.imul(value ^ seed.charCodeAt(index), 16777619);
  return () => {
    value = Math.imul(value ^ (value >>> 15), 2246822507);
    value = Math.imul(value ^ (value >>> 13), 3266489909);
    return ((value ^= value >>> 16) >>> 0) / 4294967296;
  };
}

function glow(ctx: Ctx, x: number, y: number, radius: number, color: string, alpha: number) {
  const fill = ctx.createRadialGradient(x, y, 0, x, y, radius);
  fill.addColorStop(0, hexA(color, alpha));
  fill.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = fill;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function hexA(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/* ── The picture ────────────────────────────────────────────────────────── */

const SIZES: Record<MomentFormat, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  post: { w: 1080, h: 1350 },
};

export function sizeOf(format: MomentFormat) {
  return SIZES[format];
}

/** Draws the moment and hands back a JPEG. */
export async function renderMoment(moment: Moment, format: MomentFormat): Promise<Blob> {
  const [photo, avatar] = await Promise.all([loadImage(moment.photo), loadImage(moment.badge?.photo), loadFonts()]);
  const { w, h } = SIZES[format];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw pictures.');
  draw(ctx, moment, format, { photo, avatar });
  return new Promise((resolve, reject) => {
    // JPEG: a fifth the size of a PNG of the same picture, so it sends fast on a phone connection.
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the picture.'))), 'image/jpeg', 0.9);
  });
}

interface Art {
  photo: HTMLImageElement | null;
  avatar: HTMLImageElement | null;
}

function draw(ctx: Ctx, m: Moment, format: MomentFormat, art: Art) {
  const { w, h } = SIZES[format];
  const story = format === 'story';
  const t = m.card ? { ...THEMES.card, from: RARITY_HUES[m.card.rarity][0], to: RARITY_HUES[m.card.rarity][1] } : THEMES[m.kind];
  const pad = story ? 76 : 64;
  const inner = w - pad * 2;
  const { photo } = art;

  backdrop(ctx, w, h, photo, t, `${m.kind}|${m.title}`, story);

  /* Header: the mark, and the date that makes it a keepsake rather than an advert. */
  let y = story ? 92 : 60;
  const markSize = story ? 64 : 56;
  ctx.fillStyle = gradient(ctx, pad, y, markSize, markSize, '#7C3AED', '#EC4899');
  roundRect(ctx, pad, y, markSize, markSize, markSize * 0.28);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 ${Math.round(markSize * 0.64)}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('F', pad + markSize / 2, y + markSize / 2 + 2);
  ctx.textAlign = 'left';
  ctx.font = `800 ${Math.round(markSize * 0.66)}px ${DISPLAY}`;
  ctx.fillStyle = TEXT;
  ctx.fillText('Figmark', pad + markSize + 18, y + markSize / 2 + 2);

  const stamped = !m.card && !m.level;
  const pill = m.card ? `${m.card.rarity.toUpperCase()} PULL`
    : stamped ? new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
      : t.stamp;
  ctx.font = `600 ${story ? 26 : 24}px ${MONO}`;
  const pillW = ctx.measureText(pill).width + 48;
  const pillH = markSize - 12;
  glass(ctx, w - pad - pillW, y + 6, pillW, pillH, pillH / 2);
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'center';
  ctx.fillText(pill, w - pad - pillW / 2, y + markSize / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  /* Headline and who. */
  y += markSize + (story ? 76 : 44);
  const head = fit(ctx, m.headline, (size) => `800 ${size}px ${DISPLAY}`, story ? 104 : 78, story ? 64 : 54, inner, 2);
  ctx.font = `800 ${head.size}px ${DISPLAY}`;
  ctx.fillStyle = TEXT;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24;
  for (const line of head.lines) {
    ctx.fillText(line, pad, y + head.size * 0.8);
    y += head.size * 1.02;
  }
  ctx.restore();
  // A gradient rule under the headline, in the moment's colours.
  y += story ? 20 : 14;
  ctx.fillStyle = gradient(ctx, pad, y, 160, 8, t.from, t.to);
  roundRect(ctx, pad, y, 160, 8, 4);
  ctx.fill();
  const showByline = Boolean(m.byline) && m.byline !== m.badge?.name;
  if (showByline) {
    ctx.font = `500 ${story ? 36 : 32}px ${BODY}`;
    ctx.fillStyle = DIM;
    ctx.fillText(wrap(ctx, m.byline, inner - 190, 1)[0] ?? '', pad + 184, y + 12);
  }
  y += story ? 64 : 44;

  /* The foot is fixed, then the ticket, then the words; the hero gets what is left. */
  const footH = story ? 156 : 128;
  const footY = h - footH - (story ? 84 : 52);
  const ticketH = m.discount ? (story ? 168 : 132) : 0;
  const ticketY = footY - ticketH - (m.discount ? (story ? 36 : 24) : 0);
  const titleFit = fit(ctx, m.title, (size) => `700 ${size}px ${BODY}`, story ? 56 : 46, 36, inner, 2);
  const fillH = m.fill && m.fill.threshold > 0 ? (story ? 104 : 92) : 0;
  const textH = titleFit.lines.length * titleFit.size * 1.12 + (m.detail ? 50 : 0) + fillH;
  const gap = story ? 52 : 34;
  const heroLimit = ticketY - (story ? 40 : 26) - textH - gap - y;
  const heroH = Math.max(220, Math.min(story ? inner * 1.08 : inner, heroLimit));
  const heroW = m.card ? Math.round(heroH * 0.72) : photo || !m.level ? inner : heroH;
  const heroX = (w - heroW) / 2;
  const radius = story ? 52 : 44;

  // A soft lift, then a thin frame in the moment's colours.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 90;
  ctx.shadowOffsetY = 30;
  ctx.fillStyle = gradient(ctx, heroX, y, heroW, heroH, t.from, t.to);
  roundRect(ctx, heroX - 5, y - 5, heroW + 10, heroH + 10, radius + 5);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, heroX, y, heroW, heroH, radius);
  ctx.clip();
  if (m.card) {
    drawCard(ctx, m.card, heroX, y, heroW, heroH);
  } else if (photo) {
    cover(ctx, photo, heroX, y, heroW, heroH);
    const shade = ctx.createLinearGradient(0, y + heroH * 0.6, 0, y + heroH);
    shade.addColorStop(0, 'rgba(8,11,18,0)');
    shade.addColorStop(1, 'rgba(8,11,18,0.45)');
    ctx.fillStyle = shade;
    ctx.fillRect(heroX, y, heroW, heroH);
  } else if (m.level) {
    drawLevel(ctx, m.level, heroX, y, heroW, heroH, t);
  } else {
    ctx.fillStyle = gradient(ctx, heroX, y, heroW, heroH, hexA(t.from, 0.9), hexA(t.to, 0.9));
    ctx.fillRect(heroX, y, heroW, heroH);
    ctx.font = `${Math.round(heroH * 0.34)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.glyph, heroX + heroW / 2, y + heroH / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  /* The sticker across the corner: the proud part. */
  if (stamped) sticker(ctx, m.kind, t, heroX + heroW - (story ? 40 : 34), y + (story ? 30 : 24), story);
  /* The price, as a tag clipped to the photo. */
  if (m.price && !m.card) priceTag(ctx, m.price, heroX + (story ? 30 : 24), y + heroH - (story ? 30 : 24), story);
  y += heroH + gap;

  /* What it is: name, where from, and how full. */
  ctx.font = `700 ${titleFit.size}px ${BODY}`;
  ctx.fillStyle = TEXT;
  for (const line of titleFit.lines) {
    ctx.fillText(line, pad, y + titleFit.size * 0.85);
    y += titleFit.size * 1.12;
  }
  if (m.detail) {
    ctx.font = `500 ${story ? 34 : 30}px ${BODY}`;
    ctx.fillStyle = DIM;
    ctx.fillText(wrap(ctx, m.detail, inner, 1)[0] ?? '', pad, y + 34);
    y += 50;
  }
  if (fillH) meter(ctx, m.fill!, t, pad, y + 20, inner, story);

  if (m.discount) ticket(ctx, m.discount, pad, ticketY, inner, ticketH, story);
  foot(ctx, m, art.avatar, t, pad, footY, inner, footH, story);
}

/**
 * Behind everything: the photo itself, blown up and blurred, so every picture
 * takes its colours from the thing in it. Shrinking it to a few dozen pixels
 * and drawing it back up is the blur - it works in every browser, where the
 * canvas `filter` does not.
 */
function backdrop(ctx: Ctx, w: number, h: number, photo: HTMLImageElement | null, t: Theme, seed: string, story: boolean) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  if (photo) {
    const small = document.createElement('canvas');
    small.width = 10;
    small.height = Math.round((10 * h) / w);
    const sctx = small.getContext('2d');
    if (sctx) {
      cover(sctx, photo, 0, 0, small.width, small.height);
      const mid = document.createElement('canvas');
      mid.width = 60;
      mid.height = Math.round((60 * h) / w);
      const mctx = mid.getContext('2d');
      if (mctx) {
        mctx.imageSmoothingQuality = 'high';
        mctx.drawImage(small, 0, 0, mid.width, mid.height);
        ctx.save();
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = 0.85;
        ctx.drawImage(mid, -80, -80, w + 160, h + 160);
        ctx.restore();
      }
    }
    const veil = ctx.createLinearGradient(0, 0, 0, h);
    veil.addColorStop(0, 'rgba(8,11,18,0.70)');
    veil.addColorStop(0.5, 'rgba(8,11,18,0.74)');
    veil.addColorStop(1, 'rgba(8,11,18,0.90)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);
  }
  glow(ctx, w * 0.08, h * 0.1, w * 0.85, t.from, photo ? 0.32 : 0.42);
  glow(ctx, w * 0.98, h * 0.8, w * 0.8, t.to, photo ? 0.22 : 0.32);
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = 24; y < h; y += 36) for (let x = 24; x < w; x += 36) ctx.fillRect(x, y, 2, 2);

  /* A little confetti along the top: it is a celebration, not a catalogue. */
  const random = seeded(seed);
  for (let index = 0; index < 22; index += 1) {
    const x = random() * w;
    const y = random() * h * (story ? 0.2 : 0.16);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(random() * Math.PI);
    ctx.globalAlpha = 0.3 + random() * 0.4;
    ctx.fillStyle = [t.from, t.to, '#FBBF24', '#F2F5FA'][index % 4]!;
    ctx.fillRect(-7, -3, 10 + random() * 12, 6);
    ctx.restore();
  }
}

function cover(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Frosted glass: a pale fill and a hairline, for anything laid over the backdrop. */
function glass(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r);
  ctx.stroke();
}

function sticker(ctx: Ctx, kind: ShareKind, t: Theme, right: number, top: number, story: boolean) {
  const size = story ? 50 : 42;
  const label = `${t.stamp}${kind === 'booked' || kind === 'delivered' || kind === 'purchased' ? ' ✓' : ''}`;
  ctx.save();
  ctx.font = `800 ${size}px ${DISPLAY}`;
  const sw = ctx.measureText(label).width + size * 1.3;
  const sh = size * 1.75;
  ctx.translate(right - sw / 2, top + sh / 2);
  ctx.rotate(-0.12);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = gradient(ctx, -sw / 2, -sh / 2, sw, sh, t.from, t.to);
  roundRect(ctx, -sw / 2, -sh / 2, sw, sh, sh / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  roundRect(ctx, -sw / 2 + 7, -sh / 2 + 7, sw - 14, sh - 14, (sh - 14) / 2);
  ctx.stroke();
  ctx.fillStyle = t.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 3);
  ctx.restore();
}

/** A shop's price tag: white card, hole punched, tilted a touch. */
function priceTag(ctx: Ctx, price: string, left: number, bottom: number, story: boolean) {
  const size = story ? 56 : 46;
  ctx.save();
  ctx.font = `700 ${size}px ${MONO}`;
  const tw = ctx.measureText(price).width + size * 1.6;
  const th = size * 1.6;
  ctx.translate(left + tw / 2, bottom - th / 2);
  ctx.rotate(-0.04);
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, -tw / 2, -th / 2, tw, th, 22);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#C7CEDB';
  ctx.beginPath();
  ctx.arc(-tw / 2 + size * 0.45, 0, size * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0B0F18';
  ctx.textBaseline = 'middle';
  ctx.fillText(price, -tw / 2 + size * 0.85, 3);
  ctx.restore();
}

function meter(ctx: Ctx, fill: { joined: number; threshold: number }, t: Theme, x: number, y: number, width: number, story: boolean) {
  const share = Math.min(1, fill.joined / fill.threshold);
  const left = Math.max(0, fill.threshold - fill.joined);
  const bar = story ? 24 : 20;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, x, y, width, bar, bar / 2);
  ctx.fill();
  if (share > 0) {
    ctx.fillStyle = gradient(ctx, x, y, width, bar, t.from, t.to);
    roundRect(ctx, x, y, Math.max(bar, width * share), bar, bar / 2);
    ctx.fill();
  }
  ctx.font = `600 ${story ? 30 : 27}px ${MONO}`;
  ctx.fillStyle = TEXT;
  ctx.fillText(`${Math.min(fill.joined, fill.threshold)}/${fill.threshold} joined`, x, y + bar + (story ? 46 : 40));
  ctx.textAlign = 'right';
  ctx.fillStyle = left > 0 ? '#FBBF24' : '#34D399';
  ctx.fillText(left > 0 ? `${left} spot${left === 1 ? '' : 's'} left` : 'Full - shipping', x + width, y + bar + (story ? 46 : 40));
  ctx.textAlign = 'left';
}

/**
 * The discount the sharer's link brings, as a torn-off ticket: the loudest
 * thing on the picture after the item itself, because it is the reason to tap.
 */
function ticket(ctx: Ctx, amount: string, x: number, y: number, w: number, h: number, story: boolean) {
  const layer = document.createElement('canvas');
  layer.width = w + 40;
  layer.height = h + 40;
  const lc = layer.getContext('2d');
  if (!lc) return;
  const ox = 20;
  const oy = 20;
  lc.fillStyle = gradient(lc, ox, oy, w, h, '#FDE047', '#FB923C');
  roundRect(lc, ox, oy, w, h, 28);
  lc.fill();
  // Notches where it tears, punched clean through.
  const stub = Math.round(w * 0.7);
  lc.globalCompositeOperation = 'destination-out';
  const notch = story ? 22 : 18;
  for (const cx of [ox + stub]) {
    lc.beginPath();
    lc.arc(cx, oy, notch, 0, Math.PI * 2);
    lc.arc(cx, oy + h, notch, 0, Math.PI * 2);
    lc.fill();
  }
  lc.beginPath();
  lc.arc(ox, oy + h / 2, notch, 0, Math.PI * 2);
  lc.arc(ox + w, oy + h / 2, notch, 0, Math.PI * 2);
  lc.fill();
  lc.globalCompositeOperation = 'source-over';
  // The perforation.
  lc.strokeStyle = 'rgba(43,29,0,0.35)';
  lc.lineWidth = 4;
  lc.setLineDash([10, 12]);
  lc.beginPath();
  lc.moveTo(ox + stub, oy + notch + 8);
  lc.lineTo(ox + stub, oy + h - notch - 8);
  lc.stroke();
  lc.setLineDash([]);

  const ink = '#2B1D00';
  lc.fillStyle = ink;
  lc.font = `600 ${story ? 28 : 23}px ${MONO}`;
  lc.fillText('GET', ox + 52, oy + h * 0.36);
  const big = fit(lc, `${amount} OFF`, (size) => `800 ${size}px ${DISPLAY}`, story ? 84 : 66, 40, stub - 90, 1);
  lc.font = `800 ${big.size}px ${DISPLAY}`;
  lc.fillText(big.lines[0] ?? '', ox + 50, oy + h * 0.36 + big.size * 0.95);
  lc.textAlign = 'center';
  const sx = ox + stub + (w - stub) / 2;
  lc.font = `700 ${story ? 34 : 28}px ${BODY}`;
  lc.fillText('with', sx, oy + h / 2 - (story ? 10 : 8));
  lc.fillText('my link', sx, oy + h / 2 + (story ? 32 : 26));
  lc.textAlign = 'left';

  ctx.save();
  ctx.shadowColor = 'rgba(251,146,60,0.45)';
  ctx.shadowBlur = 50;
  ctx.drawImage(layer, x - ox, y - oy);
  ctx.restore();
}

/** The foot: whose this is - the shop, or the person - and their level. */
function foot(ctx: Ctx, m: Moment, avatar: HTMLImageElement | null, t: Theme, x: number, y: number, w: number, h: number, story: boolean) {
  glass(ctx, x, y, w, h, h / 2.6);
  const badge = m.badge ?? { name: 'Figmark' };
  const [la, lb] = badge.level ? levelHues(badge.level) : [t.from, t.to];
  const size = h - (story ? 40 : 34);
  const ax = x + (h - size) / 2 + 6;
  const ay = y + (h - size) / 2;

  // The picture, ringed in the level's colours.
  ctx.fillStyle = gradient(ctx, ax - 5, ay - 5, size + 10, size + 10, la, lb);
  ctx.beginPath();
  ctx.arc(ax + size / 2, ay + size / 2, size / 2 + 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + size / 2, ay + size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    cover(ctx, avatar, ax, ay, size, size);
  } else {
    ctx.fillStyle = gradient(ctx, ax, ay, size, size, hexA(la, 0.95), '#0F1420');
    ctx.fillRect(ax, ay, size, size);
    ctx.fillStyle = TEXT;
    ctx.font = `800 ${Math.round(size * 0.46)}px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((badge.name.trim()[0] ?? 'F').toUpperCase(), ax + size / 2, ay + size / 2 + 3);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  const tx = ax + size + (story ? 30 : 24);
  const room = x + w - tx - (story ? 36 : 28);
  const nameSize = story ? 42 : 36;
  ctx.font = `800 ${nameSize}px ${DISPLAY}`;
  ctx.fillStyle = TEXT;
  const hasLevel = Boolean(badge.level);
  const nameY = hasLevel ? y + h / 2 - (story ? 8 : 6) : y + h / 2 + nameSize * 0.35;
  ctx.fillText(wrap(ctx, badge.name, room, 1)[0] ?? '', tx, nameY);

  if (hasLevel) {
    // "LV 7" in a solid chip, then the title in the level's colour - the app's own level tag.
    const chipSize = story ? 26 : 22;
    ctx.font = `700 ${chipSize}px ${MONO}`;
    const lvText = `LV ${badge.level}`;
    const cw = ctx.measureText(lvText).width + chipSize * 1.1;
    const ch = chipSize * 1.6;
    const cy = nameY + (story ? 18 : 14);
    ctx.fillStyle = gradient(ctx, tx, cy, cw, ch, la, lb);
    roundRect(ctx, tx, cy, cw, ch, ch / 2);
    ctx.fill();
    // Gold is too light for white: level ten's chip is inked dark, as the app's own is.
    const lv = badge.level ?? 1;
    ctx.fillStyle = lv >= 10 && lv < 15 ? '#2B1D00' : '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(lvText, tx + chipSize * 0.55, cy + ch / 2 + 1);
    const rest = [badge.title, badge.shop ? 'Shop' : null].filter(Boolean).join(' · ');
    if (rest) {
      ctx.font = `700 ${story ? 30 : 26}px ${BODY}`;
      ctx.fillStyle = lb;
      ctx.fillText(wrap(ctx, rest, room - cw - 16, 1)[0] ?? '', tx + cw + 16, cy + ch / 2 + 1);
    }
    ctx.textBaseline = 'alphabetic';
  }
}

function drawLevel(ctx: Ctx, level: { level: number; title: string }, x: number, y: number, w: number, h: number, t: Theme) {
  ctx.fillStyle = '#0F1420';
  ctx.fillRect(x, y, w, h);
  glow(ctx, x + w / 2, y + h / 2, w * 0.6, t.from, 0.5);
  const cx = x + w / 2;
  const cy = y + h / 2 - 20;
  const r = Math.min(w, h) * 0.33;
  ctx.lineWidth = 34;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = gradient(ctx, cx - r, cy - r, r * 2, r * 2, t.from, t.to);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = DIM;
  ctx.font = `600 34px ${MONO}`;
  ctx.fillText('LEVEL', cx, cy - r * 0.42);
  ctx.fillStyle = TEXT;
  ctx.font = `800 ${Math.round(r * 0.9)}px ${DISPLAY}`;
  ctx.fillText(String(level.level), cx, cy + r * 0.08);
  ctx.fillStyle = t.from;
  ctx.font = `700 44px ${BODY}`;
  ctx.fillText(level.title, cx, cy + r + 80);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

const CARD_GLYPHS: Record<CardDef['glyph'], string> = {
  mech: '🤖', beast: '🐉', card: '🎴', shoe: '👟', box: '📦', star: '⭐',
};

function drawCard(ctx: Ctx, card: CardDef, x: number, y: number, w: number, h: number) {
  const [from, to] = RARITY_HUES[card.rarity];
  ctx.fillStyle = gradient(ctx, x, y, w, h, from, to);
  ctx.fillRect(x, y, w, h);
  const inset = 28;
  ctx.fillStyle = '#0F1420';
  roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, 36);
  ctx.fill();
  glow(ctx, x + w / 2, y + h * 0.4, w * 0.55, from, 0.5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(w * 0.4)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.fillText(CARD_GLYPHS[card.glyph], x + w / 2, y + h * 0.4);
  ctx.fillStyle = TEXT;
  ctx.font = `800 ${Math.round(w * 0.085)}px ${DISPLAY}`;
  ctx.fillText(card.name, x + w / 2, y + h * 0.72);
  ctx.fillStyle = to;
  ctx.font = `600 ${Math.round(w * 0.05)}px ${MONO}`;
  ctx.fillText(card.rarity.toUpperCase(), x + w / 2, y + h * 0.81);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
