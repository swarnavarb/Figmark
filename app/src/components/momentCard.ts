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
 * Every picture carries the link it came with, printed big enough to type, so
 * a story that cannot be tapped still sends people somewhere.
 */

export type MomentFormat = 'story' | 'post';

export interface Moment {
  kind: ShareKind;
  /** The big line at the top: "I'm in on this group buy". */
  headline: string;
  /** Under it: who, and their level. */
  byline: string;
  /** Item or shop photo. Drawn cover-fit; a gradient and glyph stand in without one. */
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
  /** The ask at the foot: "Join me before it fills". */
  cta: string;
  /** Full URL; printed without the scheme. */
  link: string;
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
  const [photo] = await Promise.all([loadImage(moment.photo), loadFonts()]);
  const { w, h } = SIZES[format];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw pictures.');
  draw(ctx, moment, format, photo);
  return new Promise((resolve, reject) => {
    // JPEG: a fifth the size of a PNG of the same picture, so it sends fast on a phone connection.
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the picture.'))), 'image/jpeg', 0.9);
  });
}

function draw(ctx: Ctx, m: Moment, format: MomentFormat, photo: HTMLImageElement | null) {
  const { w, h } = SIZES[format];
  const story = format === 'story';
  const t = m.card ? { ...THEMES.card, from: RARITY_HUES[m.card.rarity][0], to: RARITY_HUES[m.card.rarity][1] } : THEMES[m.kind];
  const pad = 84;
  const inner = w - pad * 2;
  const random = seeded(`${m.kind}|${m.title}`);

  /* Stage: deep navy, two soft lights in the moment's colours, a fine dot grid. */
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.1, h * 0.12, w * 0.9, t.from, 0.42);
  glow(ctx, w * 0.95, h * 0.78, w * 0.85, t.to, 0.32);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let y = 24; y < h; y += 36) for (let x = 24; x < w; x += 36) ctx.fillRect(x, y, 2, 2);

  /* Confetti across the top: the picture is a celebration. */
  for (let index = 0; index < 34; index += 1) {
    const x = random() * w;
    const y = random() * h * (story ? 0.3 : 0.26);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(random() * Math.PI);
    ctx.globalAlpha = 0.35 + random() * 0.45;
    ctx.fillStyle = [t.from, t.to, '#FBBF24', '#F2F5FA'][index % 4]!;
    ctx.fillRect(-7, -3, 10 + random() * 12, 6);
    ctx.restore();
  }

  /* Header: the mark and the stamp. */
  let y = story ? 96 : 72;
  const markSize = 64;
  ctx.fillStyle = gradient(ctx, pad, y, markSize, markSize, '#7C3AED', '#EC4899');
  roundRect(ctx, pad, y, markSize, markSize, 18);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 42px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('F', pad + markSize / 2, y + markSize / 2 + 2);
  ctx.textAlign = 'left';
  ctx.font = `800 44px ${DISPLAY}`;
  ctx.fillStyle = TEXT;
  ctx.fillText('Figmark', pad + markSize + 20, y + markSize / 2 + 2);

  ctx.font = `600 28px ${MONO}`;
  // A moment with a photo wears its stamp on the photo; the pill then dates
  // it, which is what makes it a keepsake rather than an advert.
  const stamped = !m.card && !m.level;
  const stampText = m.card ? `${m.card.rarity.toUpperCase()} PULL`
    : stamped ? new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
      : t.stamp;
  const stampW = ctx.measureText(stampText).width + 56;
  ctx.fillStyle = gradient(ctx, w - pad - stampW, y, stampW, markSize, t.from, t.to);
  roundRect(ctx, w - pad - stampW, y + 6, stampW, markSize - 12, 26);
  ctx.fill();
  ctx.fillStyle = t.ink;
  ctx.textAlign = 'center';
  ctx.fillText(stampText, w - pad - stampW / 2, y + markSize / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  /* Headline and who. */
  y += markSize + (story ? 92 : 64);
  const head = fit(ctx, m.headline, (size) => `800 ${size}px ${DISPLAY}`, story ? 100 : 76, story ? 60 : 52, inner, 2);
  ctx.font = `800 ${head.size}px ${DISPLAY}`;
  ctx.fillStyle = TEXT;
  for (const line of head.lines) {
    ctx.fillText(line, pad, y + head.size * 0.8);
    y += head.size * 1.04;
  }
  y += 18;
  ctx.font = `500 36px ${BODY}`;
  ctx.fillStyle = DIM;
  ctx.fillText(wrap(ctx, m.byline, inner, 1)[0] ?? '', pad, y + 30);
  y += story ? 92 : 62;

  /* The foot is fixed; the words under the hero are measured; the hero gets the rest. */
  const boxH = story ? 172 : 150;
  const boxY = h - boxH - (story ? 84 : 60);
  const titleFit = fit(ctx, m.title, (size) => `700 ${size}px ${BODY}`, story ? 54 : 46, 36, m.price ? inner - 300 : inner, 2);
  const fillH = m.fill && m.fill.threshold > 0 ? 112 : 0;
  const textH = titleFit.lines.length * titleFit.size * 1.12 + (m.detail ? 52 : 0) + fillH;
  const gap = story ? 56 : 36;

  /* The hero: the photo, the level ring or the card, in a gradient frame. */
  const heroH = Math.max(220, Math.min(inner, boxY - (story ? 48 : 28) - textH - gap - y));
  const heroW = m.card ? Math.round(heroH * 0.72) : photo || !m.level ? inner : heroH;
  const heroX = (w - heroW) / 2;
  const radius = 56;

  ctx.save();
  ctx.shadowColor = hexA(t.from, 0.55);
  ctx.shadowBlur = 80;
  ctx.fillStyle = gradient(ctx, heroX, y, heroW, heroH, t.from, t.to);
  roundRect(ctx, heroX - 6, y - 6, heroW + 12, heroH + 12, radius + 6);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, heroX, y, heroW, heroH, radius);
  ctx.clip();
  if (m.card) {
    drawCard(ctx, m.card, heroX, y, heroW, heroH);
  } else if (photo) {
    const scale = Math.max(heroW / photo.naturalWidth, heroH / photo.naturalHeight);
    const dw = photo.naturalWidth * scale;
    const dh = photo.naturalHeight * scale;
    ctx.drawImage(photo, heroX + (heroW - dw) / 2, y + (heroH - dh) / 2, dw, dh);
    const shade = ctx.createLinearGradient(0, y + heroH * 0.55, 0, y + heroH);
    shade.addColorStop(0, 'rgba(8,11,18,0)');
    shade.addColorStop(1, 'rgba(8,11,18,0.55)');
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

  /* The rubber stamp across the corner: the proud part. */
  if (stamped) {
    const big = story ? 64 : 52;
    ctx.save();
    ctx.font = `800 ${big}px ${DISPLAY}`;
    ctx.translate(heroX + heroW - ctx.measureText(t.stamp).width / 2 - 70, y + (story ? 110 : 90));
    ctx.rotate(-0.2);
    const label = `${t.stamp}${m.kind === 'booked' || m.kind === 'delivered' || m.kind === 'purchased' ? ' ✓' : ''}`;
    const sw = ctx.measureText(label).width + 56;
    const sh = big * 1.6;
    ctx.fillStyle = 'rgba(8,11,18,0.72)';
    roundRect(ctx, -sw / 2, -sh / 2, sw, sh, 22);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = t.to;
    roundRect(ctx, -sw / 2 + 8, -sh / 2 + 8, sw - 16, sh - 16, 16);
    ctx.stroke();
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 4);
    ctx.restore();
  }
  y += heroH + gap;

  /* What it is: name, where from, price, and how full. */
  ctx.font = `700 ${titleFit.size}px ${BODY}`;
  ctx.fillStyle = TEXT;
  let ty = y;
  for (const line of titleFit.lines) {
    ctx.fillText(line, pad, ty + titleFit.size * 0.85);
    ty += titleFit.size * 1.12;
  }
  if (m.price) {
    ctx.font = `600 ${story ? 60 : 52}px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = t.to;
    ctx.fillText(m.price, w - pad, y + titleFit.size * 0.9);
    ctx.textAlign = 'left';
  }
  if (m.detail) {
    ctx.font = `500 34px ${BODY}`;
    ctx.fillStyle = DIM;
    ctx.fillText(wrap(ctx, m.detail, inner, 1)[0] ?? '', pad, ty + 34);
    ty += 52;
  }
  y = ty + 22;

  if (m.fill && m.fill.threshold > 0) {
    const share = Math.min(1, m.fill.joined / m.fill.threshold);
    const left = Math.max(0, m.fill.threshold - m.fill.joined);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, pad, y, inner, 26, 13);
    ctx.fill();
    if (share > 0) {
      ctx.fillStyle = gradient(ctx, pad, y, inner, 26, t.from, t.to);
      roundRect(ctx, pad, y, Math.max(26, inner * share), 26, 13);
      ctx.fill();
    }
    ctx.font = `600 30px ${MONO}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(`${m.fill.joined}/${m.fill.threshold} joined`, pad, y + 70);
    ctx.textAlign = 'right';
    ctx.fillStyle = left > 0 ? t.to : '#34D399';
    ctx.fillText(left > 0 ? `${left} spot${left === 1 ? '' : 's'} left` : 'Full - shipping', w - pad, y + 70);
    ctx.textAlign = 'left';
  }

  /* The ask, and the link to act on it. */
  ctx.fillStyle = hexA(SURFACE, 0.92);
  roundRect(ctx, pad, boxY, inner, boxH, 40);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, pad, boxY, inner, boxH, 40);
  ctx.stroke();

  const arrow = boxH - 52;
  const ax = w - pad - 26 - arrow;
  const ay = boxY + 26;
  ctx.fillStyle = gradient(ctx, ax, ay, arrow, arrow, t.from, t.to);
  roundRect(ctx, ax, ay, arrow, arrow, arrow / 2);
  ctx.fill();
  ctx.strokeStyle = t.ink;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const cx = ax + arrow / 2;
  const cy = ay + arrow / 2;
  ctx.moveTo(cx - 18, cy);
  ctx.lineTo(cx + 18, cy);
  ctx.moveTo(cx + 2, cy - 16);
  ctx.lineTo(cx + 18, cy);
  ctx.lineTo(cx + 2, cy + 16);
  ctx.stroke();

  const textW = ax - pad - 60;
  ctx.font = `700 40px ${BODY}`;
  ctx.fillStyle = TEXT;
  ctx.fillText(wrap(ctx, m.cta, textW, 1)[0] ?? '', pad + 36, boxY + boxH / 2 - 6);
  const shown = printable(m.link);
  let linkSize = 32;
  ctx.font = `600 ${linkSize}px ${MONO}`;
  while (linkSize > 18 && ctx.measureText(shown).width > textW) {
    linkSize -= 2;
    ctx.font = `600 ${linkSize}px ${MONO}`;
  }
  ctx.fillStyle = t.to;
  ctx.fillText(shown, pad + 36, boxY + boxH / 2 + 42, textW);
}

/**
 * The link as it should be typed off a picture: no scheme, and none of the
 * preview-only hints. The invite stays - it is what credits the sharer.
 */
function printable(link: string): string {
  try {
    const url = new URL(link);
    url.searchParams.delete('m');
    const query = url.searchParams.toString();
    return `${url.host}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return link.replace(/^https?:\/\//, '');
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
