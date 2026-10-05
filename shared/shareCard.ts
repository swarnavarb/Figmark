/**
 * The square picture Figmark shares: one layout, two painters.
 *
 * The app draws it on a canvas when somebody taps Share, and the server draws
 * it as a link's preview when the thing shared has no photo of its own. Both
 * paint the same list of shapes from here, so the picture in the chat and the
 * picture under the link are the same picture.
 *
 *   ┌──────────────────────────────┐
 *   │ F Figmark            [STAMP] │
 *   │ Headline, big                │
 *   │ ┌────────┐  Title            │
 *   │ │  hero  │  detail           │
 *   │ │        │  ₹price  ₹was     │
 *   │ └────────┘  [GET ₹X OFF|link]│
 *   │ ─────────────────────────────│
 *   │ (o) Shop name     [Buyer P.] │
 *   │     LV 6 Trusted house       │
 *   └──────────────────────────────┘
 *
 * Everything here is plain data and arithmetic - no DOM, no Node - so it
 * compiles into both. Text is measured by whoever paints it: the canvas by
 * the browser's own font, the server by the width table below.
 */
import type { ShareKind } from './models.js';

export const CARD_SIZE = 1080;

/* ── The shapes ─────────────────────────────────────────────────────────── */

/** Offset, colour (hex), and opacity. */
export type Stop = [number, string, number?];
export type Paint =
  | string
  | { linear: [number, number, number, number]; stops: Stop[] }
  | { radial: [number, number, number]; stops: Stop[] };
export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  /** An SVG path, optionally moved to `at` and scaled. */
  | { kind: 'path'; d: string; at?: [number, number, number] };
export type Op =
  | { op: 'fill'; shape: Shape; paint: Paint; opacity?: number }
  | { op: 'stroke'; shape: Shape; paint: Paint; width: number; dash?: number[]; opacity?: number; round?: boolean }
  | { op: 'text'; x: number; y: number; text: string; size: number; bold: boolean; paint: string; anchor?: 'start' | 'middle' | 'end'; opacity?: number; emoji?: boolean }
  /** Cover-fitted to the box, inside `clip`. */
  | { op: 'image'; src: string; x: number; y: number; w: number; h: number; clip: Shape }
  | { op: 'clip'; shape: Shape; ops: Op[] };

export type Measure = (text: string, size: number, bold: boolean) => number;

export const CARD_FONT = 'Bricolage Grotesque';

/* Advance widths of Bricolage Grotesque for printable ASCII, in thousandths
   of an em: the server's measure, which has no font engine to ask. */
const BOLD = [230,291,360,626,642,977,754,177,321,316,436,528,196,352,233,361,665,346,603,606,624,610,657,509,656,652,243,220,528,528,528,421,987,698,683,680,700,621,593,721,723,293,373,687,508,939,775,722,646,724,679,652,571,728,673,986,697,642,571,324,357,319,572,554,283,585,638,566,639,581,399,601,631,277,281,591,274,946,631,609,638,639,434,544,397,622,572,863,569,602,524,349,271,342,528];
const REGULAR = [253,254,296,605,625,932,756,149,297,277,375,510,149,332,177,349,651,306,573,590,581,594,641,485,640,635,189,171,510,510,510,408,935,657,657,666,686,588,570,698,701,265,349,656,507,893,732,713,621,717,650,635,544,714,648,942,630,580,554,310,333,290,533,589,283,557,608,549,607,564,370,582,596,250,259,546,248,895,596,601,608,607,399,530,371,587,533,809,516,585,488,355,253,326,510];
const EXTRA: Record<string, number> = { '₹': 590, '—': 780, '–': 525, '·': 210, '…': 720, '’': 185, '‘': 185, '“': 360, '”': 360, '×': 520 };

export const tableMeasure: Measure = (text, size, bold) => {
  const table = bold ? BOLD : REGULAR;
  let units = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    units += code >= 32 && code < 127 ? table[code - 32]! : EXTRA[char] ?? 640;
  }
  return (units / 1000) * size;
};

/* ── Colours ────────────────────────────────────────────────────────────── */

/* Mirrors app/src/format.ts, so a tile here is the colour of the tile the
   person sees when they open the link. */
function hash32(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function hueFor(seed: string): number {
  return ((hash32(seed) * 0.6180339887498949) % 1) * 360;
}

export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
  const initials = words.slice(0, 2).map((word) => word.replace(/[^a-z0-9]/gi, '')[0] ?? '');
  const joined = initials.join('').toUpperCase();
  return joined.length === 1 ? (words[0] ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() : joined;
}

/** As hex, because the server's renderer reads hex and not hsl(). */
export function hsl(h: number, sPct: number, lPct: number): string {
  const sat = sPct / 100;
  const light = lPct / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[0, 8, 4].map((n) => channel(n).toString(16).padStart(2, '0')).join('')}`;
}

/* The app's level colours (`.lvtag--l*` in styles.css). */
const LEVEL_HUES: [number, string, string][] = [
  [50, '#F43F5E', '#FBBF24'], [30, '#D97706', '#F87171'], [20, '#E11D48', '#F472B6'], [15, '#0891B2', '#22D3EE'],
  [10, '#B8860B', '#F5C542'], [9, '#C2410C', '#FBBF24'], [8, '#BE123C', '#FB7185'], [7, '#A21CAF', '#F472B6'],
  [6, '#6D28D9', '#C084FC'], [5, '#1D4ED8', '#818CF8'], [4, '#0369A1', '#38BDF8'], [3, '#0F766E', '#2DD4BF'],
  [2, '#15803D', '#4ADE80'], [1, '#475569', '#94A3B8'],
];

export function levelHues(level: number): [string, string] {
  const found = LEVEL_HUES.find(([rung]) => level >= rung) ?? LEVEL_HUES[LEVEL_HUES.length - 1]!;
  return [found[1], found[2]];
}

/** Gold is too light for white ink: level ten's chip is inked dark, as the app's own is. */
function levelInk(level: number): string {
  return level >= 10 && level < 15 ? '#2B1D00' : '#FFFFFF';
}

export interface Theme {
  stamp: string;
  from: string;
  to: string;
  /** Text on the stamp. */
  ink: string;
  glyph: string;
}

/* What each kind of share says across its corner, in the brand's paired hues. */
export const THEMES: Record<ShareKind, Theme> = {
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

const BG = '#080B12';
const SURFACE = '#0F1420';
const TEXT = '#F2F5FA';
const DIM = '#AEBBD0';
const BRAND: [string, string] = ['#8B5CF6', '#D946EF'];

/* ── What goes on it ────────────────────────────────────────────────────── */

export type CardHero =
  /** A photo the painter has already loaded - if it could not, ask for a tile instead. */
  | { kind: 'photo'; src: string }
  /** The colour tile and initials the app shows for an item without a photo. */
  | { kind: 'tile'; label: string }
  /** A shop or a person, ringed in their level's colours. */
  | { kind: 'avatar'; name: string; photo?: string | null; level?: number | null }
  | { kind: 'level'; level: number }
  | { kind: 'card'; name: string; rarity: string; from: string; to: string; glyph: string }
  /** Figmark's own mark: for invites. */
  | { kind: 'brand'; glyph?: string | null };

export interface CardBadge {
  name: string;
  /** Loaded already, or null. */
  photo?: string | null;
  level?: number | null;
  title?: string | null;
}

export interface CardSpec {
  /** Colours the tile and the glow behind it. */
  seed: string;
  /** The top-right stamp: "BOOKED". Without one, Buyer Protection sits there. */
  stamp?: { label: string; from: string; to: string; ink: string } | null;
  headline?: string | null;
  hero: CardHero;
  /** Small labels on the hero's corner: "PRE-ORDER", "MISB". */
  chips?: { label: string; fill: string; ink: string }[];
  /** A pre-order's meter, along the hero's foot. */
  meter?: { joined: number; total: number; line: string } | null;
  title: string;
  detail?: string | null;
  /** What this link's buyer pays. */
  price?: string | null;
  /** The price before the link's discount. */
  was?: string | null;
  /** The discount the link brings, as a ticket. */
  off?: string | null;
  badge?: CardBadge | null;
  /** Show Buyer Protection (top right, or beside the badge when a stamp has the corner). */
  protection?: boolean;
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

const S = CARD_SIZE;
const PAD = 60;

function rect(x: number, y: number, w: number, h: number, r = 0): Shape {
  return { kind: 'rect', x, y, w, h, r };
}

function linear(x1: number, y1: number, x2: number, y2: number, from: string, to: string): Paint {
  return { linear: [x1, y1, x2, y2], stops: [[0, from], [1, to]] };
}

/** Word-wrapped to at most `lines`, the last one ellipsised if it had to be. */
export function wrapText(measure: Measure, text: string, size: number, bold: boolean, max: number, lines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i += 1) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (measure(next, size, bold) <= max || !line) {
      line = next;
      continue;
    }
    out.push(line);
    line = words[i]!;
    if (out.length === lines - 1) {
      out.push(fitText(measure, words.slice(i).join(' '), size, bold, max));
      return out;
    }
  }
  if (line) out.push(fitText(measure, line, size, bold, max));
  return out;
}

/** Cut to fit, with an ellipsis when anything was cut. */
export function fitText(measure: Measure, text: string, size: number, bold: boolean, max: number): string {
  if (measure(text, size, bold) <= max) return text;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`, size, bold) > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** The largest size, from `size` down, at which the text fits in `lines`. */
function fitBlock(measure: Measure, text: string, size: number, min: number, bold: boolean, max: number, lines: number) {
  for (let current = size; current > min; current -= 4) {
    const all = wrapText(measure, text, current, bold, max, 99);
    if (all.length <= lines && all.every((line) => measure(line, current, bold) <= max)) return { size: current, lines: all };
  }
  return { size: min, lines: wrapText(measure, text, min, bold, max, lines) };
}

function text(x: number, y: number, value: string, size: number, paint: string, bold = true, anchor?: 'middle' | 'end'): Op {
  return { op: 'text', x, y, text: value, size, bold, paint, ...(anchor ? { anchor } : {}) };
}

/** A rounded label; its ops and how wide it came out. */
function pill(measure: Measure, x: number, y: number, label: string, size: number, fill: string | [string, string], ink: string, align: 'left' | 'right' = 'left') {
  const width = measure(label, size, true) + size * 1.5;
  const height = size * 2;
  const left = align === 'right' ? x - width : x;
  const paint = typeof fill === 'string' ? fill : linear(left, y, left + width, y + height, fill[0], fill[1]);
  return {
    width,
    ops: [
      { op: 'fill', shape: rect(left, y, width, height, height / 2), paint } as Op,
      text(left + size * 0.75, y + height / 2 + size * 0.36, label, size, ink),
    ],
  };
}

/** A small shield with a tick, for Buyer Protection. */
function shield(x: number, y: number, size: number): Op[] {
  const at: [number, number, number] = [x, y, size / 24];
  return [
    { op: 'fill', shape: { kind: 'path', d: 'M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3Z', at }, paint: '#34D399' },
    { op: 'stroke', shape: { kind: 'path', d: 'm8.5 12 2.5 2.5 4.5-5', at }, paint: BG, width: 2.2, round: true },
  ];
}

function protectionPill(measure: Measure, right: number, y: number): Op[] {
  const size = 22;
  const width = measure('Buyer Protection', size, true) + 76;
  const x = right - width;
  return [
    { op: 'fill', shape: rect(x, y, width, 48, 24), paint: '#FFFFFF', opacity: 0.1 },
    { op: 'stroke', shape: rect(x, y, width, 48, 24), paint: '#FFFFFF', width: 1.5, opacity: 0.14 },
    ...shield(x + 16, y + 11, 26),
    text(x + 52, y + 32, 'Buyer Protection', size, TEXT),
  ];
}

function brand(x: number, y: number): Op[] {
  return [
    { op: 'fill', shape: rect(x, y, 48, 48, 12), paint: linear(x, y, x + 48, y + 48, BRAND[0], BRAND[1]) },
    text(x + 24, y + 35, 'F', 30, '#FFFFFF', true, 'middle'),
    text(x + 64, y + 35, 'Figmark', 32, TEXT),
  ];
}

/** A round mark with a ring in the level's colours: a photo, or initials on a gradient. */
function avatar(name: string, level: number | null | undefined, photo: string | null | undefined, cx: number, cy: number, r: number): Op[] {
  const [from, to] = levelHues(level ?? 1);
  const hue = hueFor(name);
  const ring = Math.max(4, r * 0.06);
  const face: Shape = { kind: 'circle', cx, cy, r: r - ring };
  return [
    { op: 'fill', shape: { kind: 'circle', cx, cy, r }, paint: linear(cx - r, cy - r, cx + r, cy + r, from, to) },
    ...(photo
      ? [{ op: 'image', src: photo, x: cx - r + ring, y: cy - r + ring, w: (r - ring) * 2, h: (r - ring) * 2, clip: face } as Op]
      : [
          { op: 'fill', shape: face, paint: linear(cx - r, cy - r, cx + r, cy + r, hsl(hue, 58, 40), hsl((hue + 34) % 360, 64, 20)) } as Op,
          text(cx, cy + r * 0.24, initialsOf(name) || '?', r * 0.68, '#FFFFFF', true, 'middle'),
        ]),
  ];
}

/** "LV 6" on the level's colours, then its title. */
function levelChip(measure: Measure, x: number, y: number, level: number, title: string, size: number, room: number): Op[] {
  const [from, to] = levelHues(level);
  const label = `LV ${level}`;
  const width = measure(label, size, true) + size * 1.2;
  const height = size * 1.7;
  return [
    { op: 'fill', shape: rect(x, y, width, height, size * 0.45), paint: linear(x, y, x + width, y, from, to) },
    text(x + size * 0.6, y + height / 2 + size * 0.36, label, size, levelInk(level)),
    ...(title ? [text(x + width + size * 0.5, y + height / 2 + size * 0.36, fitText(measure, title, size, false, room - width - size * 0.5), size, DIM, false)] : []),
  ];
}

/** The tile's two soft circles, clipped to it. */
function bubbles(x: number, y: number, size: number, clip: Shape): Op {
  return {
    op: 'clip', shape: clip, ops: [
      { op: 'fill', shape: { kind: 'circle', cx: x + size * 0.78, cy: y + size * 0.2, r: size * 0.3 }, paint: '#FFFFFF', opacity: 0.1 },
      { op: 'fill', shape: { kind: 'circle', cx: x + size * 0.18, cy: y + size * 0.9, r: size * 0.42 }, paint: '#000000', opacity: 0.14 },
    ],
  };
}

function hero(spec: CardSpec, measure: Measure, x: number, y: number, size: number): Op[] {
  const h = spec.hero;
  const round = size * 0.087;
  const box = rect(x, y, size, size, round);
  const ops: Op[] = [];
  const lift = () => ops.push({ op: 'fill', shape: rect(x, y + 18, size, size, round), paint: '#000000', opacity: 0.35 });
  const edge = () => ops.push({ op: 'stroke', shape: rect(x + 1, y + 1, size - 2, size - 2, round), paint: '#FFFFFF', width: 2, opacity: 0.16 });

  if (h.kind === 'photo' || h.kind === 'tile') {
    lift();
    if (h.kind === 'photo') {
      ops.push({ op: 'fill', shape: box, paint: SURFACE }, { op: 'image', src: h.src, x, y, w: size, h: size, clip: box });
    } else {
      const hue = hueFor(spec.seed);
      ops.push(
        { op: 'fill', shape: box, paint: linear(x, y, x + size, y + size, hsl(hue, 58, 38), hsl((hue + 34) % 360, 64, 19)) },
        bubbles(x, y, size, box),
        { op: 'text', x: x + size / 2, y: y + size / 2 + size * 0.135, text: initialsOf(h.label) || '?', size: size * 0.38, bold: true, paint: '#FFFFFF', anchor: 'middle', opacity: 0.94 },
      );
    }
    edge();
    // What kind of thing it is, on its corner.
    let cx = x + 28;
    for (const chip of spec.chips ?? []) {
      const made = pill(measure, cx, y + 28, fitText(measure, chip.label, 21, true, size * 0.45), 21, chip.fill, chip.ink);
      ops.push(...made.ops);
      cx += made.width + 10;
    }
    // How full the pre-order is, along its foot.
    const meter = spec.meter;
    if (meter && meter.total > 0) {
      const share = Math.max(0.04, Math.min(1, meter.joined / meter.total));
      const mx = x + 30;
      const mw = size - 60;
      ops.push(
        { op: 'clip', shape: box, ops: [{ op: 'fill', shape: rect(x, y + size - 112, size, 112), paint: '#000000', opacity: 0.45 }] },
        text(mx, y + size - 66, fitText(measure, meter.line, 24, true, mw), 24, '#FFFFFF'),
        { op: 'fill', shape: rect(mx, y + size - 46, mw, 14, 7), paint: '#FFFFFF', opacity: 0.18 },
        { op: 'fill', shape: rect(mx, y + size - 46, mw * share, 14, 7), paint: linear(mx, 0, mx + mw, 0, '#F472B6', '#FBBF24') },
      );
    }
    return ops;
  }

  if (h.kind === 'avatar') {
    const r = size / 2;
    ops.push({ op: 'fill', shape: { kind: 'circle', cx: x + r, cy: y + r + 14, r }, paint: '#000000', opacity: 0.3 });
    ops.push(...avatar(h.name, h.level, h.photo, x + r, y + r, r));
    return ops;
  }

  if (h.kind === 'level') {
    const [from, to] = levelHues(h.level);
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size * 0.34;
    lift();
    ops.push(
      { op: 'fill', shape: box, paint: SURFACE },
      { op: 'clip', shape: box, ops: [{ op: 'fill', shape: rect(x, y, size, size), paint: { radial: [cx, cy, size * 0.62], stops: [[0, from, 0.55], [1, SURFACE, 0]] } }] },
      { op: 'stroke', shape: { kind: 'circle', cx, cy, r }, paint: '#FFFFFF', width: 30, opacity: 0.1 },
      { op: 'stroke', shape: { kind: 'circle', cx, cy, r }, paint: linear(cx - r, cy - r, cx + r, cy + r, from, to), width: 30 },
      text(cx, cy - r * 0.36, 'LEVEL', 28, DIM, true, 'middle'),
      text(cx, cy + r * 0.42, String(h.level), r * 0.95, TEXT, true, 'middle'),
    );
    edge();
    return ops;
  }

  if (h.kind === 'card') {
    // Portrait, the shape of a card, centred in the square.
    const w = Math.round(size * 0.72);
    const cx = x + (size - w) / 2;
    const face = rect(cx, y, w, size, 36);
    const inner = rect(cx + 22, y + 22, w - 44, size - 44, 26);
    ops.push(
      { op: 'fill', shape: rect(cx, y + 18, w, size, 36), paint: '#000000', opacity: 0.35 },
      { op: 'fill', shape: face, paint: linear(cx, y, cx + w, y + size, h.from, h.to) },
      { op: 'fill', shape: inner, paint: SURFACE },
      { op: 'clip', shape: inner, ops: [{ op: 'fill', shape: rect(cx, y, w, size), paint: { radial: [cx + w / 2, y + size * 0.4, w * 0.6], stops: [[0, h.from, 0.55], [1, SURFACE, 0]] } }] },
      { op: 'text', x: cx + w / 2, y: y + size * 0.5, text: h.glyph, size: w * 0.36, bold: false, paint: '#FFFFFF', anchor: 'middle', emoji: true },
    );
    const name = fitBlock(measure, h.name, Math.round(w * 0.1), 22, true, w - 80, 2);
    let ny = y + size * 0.7;
    for (const line of name.lines) {
      ops.push(text(cx + w / 2, ny, line, name.size, TEXT, true, 'middle'));
      ny += name.size * 1.1;
    }
    ops.push(text(cx + w / 2, y + size - 56, h.rarity.toUpperCase(), 22, h.to, true, 'middle'));
    return ops;
  }

  // Figmark's own mark, for an invite.
  lift();
  ops.push(
    { op: 'fill', shape: box, paint: linear(x, y, x + size, y + size, BRAND[0], BRAND[1]) },
    bubbles(x, y, size, box),
    text(x + size / 2, y + size / 2 + size * 0.17, 'F', size * 0.5, '#FFFFFF', true, 'middle'),
  );
  if (h.glyph) ops.push({ op: 'text', x: x + size - 70, y: y + size - 44, text: h.glyph, size: 72, bold: false, paint: '#FFFFFF', anchor: 'middle', emoji: true });
  edge();
  return ops;
}

/** The ticket's outline: a rounded rectangle with a notch top and bottom where it tears. */
function ticketPath(x: number, y: number, w: number, h: number, tear: number, r = 14, n = 10): string {
  const sx = x + tear;
  return `M${x + r} ${y}H${sx - n}A${n} ${n} 0 0 0 ${sx + n} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}`
    + `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${sx + n}A${n} ${n} 0 0 0 ${sx - n} ${y + h}H${x + r}`
    + `A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

/** Everything to paint, back to front. */
export function layoutCard(spec: CardSpec, measure: Measure = tableMeasure): Op[] {
  const hue = hueFor(spec.seed);
  const ops: Op[] = [
    { op: 'fill', shape: rect(0, 0, S, S), paint: BG },
    { op: 'fill', shape: rect(0, 0, S, S), paint: { radial: [S * 0.24, S * 0.5, S * 0.8], stops: [[0, hsl(hue, 60, 30), 0.75], [1, BG, 0]] } },
    { op: 'fill', shape: rect(0, 0, S, S), paint: { radial: [S, 0, S * 0.65], stops: [[0, spec.stamp?.from ?? '#7C3AED', 0.35], [1, BG, 0]] } },
    ...brand(PAD, PAD),
  ];

  // The corner: the moment's stamp, or Buyer Protection.
  if (spec.stamp) {
    const stamp = spec.stamp;
    const made = pill(measure, S - PAD, PAD + 2, stamp.label, 22, [stamp.from, stamp.to], stamp.ink, 'right');
    ops.push(...made.ops);
  } else if (spec.protection) {
    ops.push(...protectionPill(measure, S - PAD, PAD));
  }

  // The headline, as big as it fits in two lines.
  let top = PAD + 48 + 44;
  if (spec.headline) {
    const head = fitBlock(measure, spec.headline, 68, 44, true, S - PAD * 2, 2);
    for (const line of head.lines) {
      ops.push(text(PAD, top + head.size * 0.8, line, head.size, TEXT));
      top += head.size * 1.1;
    }
    top += 4;
    ops.push({ op: 'fill', shape: rect(PAD, top, 120, 8, 4), paint: linear(PAD, 0, PAD + 120, 0, spec.stamp?.from ?? BRAND[0], spec.stamp?.to ?? BRAND[1]) });
    top += 8;
  }

  // The foot: who stands behind it.
  const showFoot = Boolean(spec.badge) || Boolean(spec.stamp && spec.protection);
  const divider = showFoot ? S - 190 : S - PAD;
  if (showFoot) {
    ops.push({ op: 'fill', shape: rect(PAD, divider, S - PAD * 2, 2), paint: '#FFFFFF', opacity: 0.1 });
    const cy = S - 98;
    let room = S - PAD * 2;
    if (spec.stamp && spec.protection) {
      ops.push(...protectionPill(measure, S - PAD, cy - 24));
      room -= measure('Buyer Protection', 22, true) + 76 + 24;
    }
    const badge = spec.badge;
    if (badge) {
      const r = 46;
      ops.push(...avatar(badge.name, badge.level, badge.photo, PAD + r, cy, r));
      const tx = PAD + r * 2 + 22;
      room -= r * 2 + 22;
      if (badge.level) {
        ops.push(text(tx, cy - 8, fitText(measure, badge.name, 34, true, room), 34, TEXT));
        ops.push(...levelChip(measure, tx, cy + 6, badge.level, badge.title ?? '', 22, room));
      } else {
        ops.push(text(tx, cy + 12, fitText(measure, badge.name, 34, true, room), 34, TEXT));
      }
    }
  }

  // The middle: the hero on the left, what it is on the right, centred together.
  const space = divider - 40 - (top + 36);
  const size = Math.max(320, Math.min(460, space));
  const heroY = top + 36 + Math.max(0, (space - size) / 2);
  ops.push(...hero(spec, measure, PAD, heroY, size));

  const col = PAD + size + 44;
  const colW = S - PAD - col;
  const right: Op[] = [];
  let y = 0;
  const title = fitBlock(measure, spec.title, 54, 36, true, colW, spec.off ? 2 : 3);
  for (const line of title.lines) {
    right.push(text(col, y + title.size * 0.8, line, title.size, TEXT));
    y += title.size * 1.14;
  }
  if (spec.detail) {
    y += 8;
    for (const line of wrapText(measure, spec.detail, 26, false, colW, 2)) {
      right.push(text(col, y + 26, line, 26, DIM, false));
      y += 36;
    }
  }
  if (spec.price) {
    y += 24;
    const size = 66;
    right.push(text(col, y + size * 0.78, spec.price, size, '#FFFFFF'));
    if (spec.was) {
      const px = col + measure(spec.price, size, true) + 20;
      const ww = measure(spec.was, 32, false);
      if (px + ww <= S - PAD) {
        right.push(
          text(px, y + size * 0.76, spec.was, 32, DIM, false),
          { op: 'fill', shape: rect(px - 2, y + size * 0.76 - 13, ww + 4, 3), paint: DIM },
        );
      }
    }
    y += size + 6;
  }
  if (spec.off) {
    // The reason to tap, as a gold ticket with the stub torn off.
    y += 18;
    const tail = 'with my link';
    const tailW = measure(tail, 22, false) + 36;
    const headSize = Math.min(30, Math.max(20, 30 * (colW - tailW - 40) / measure(`GET ${spec.off} OFF`, 30, true)));
    const headW = measure(`GET ${spec.off} OFF`, headSize, true) + 40;
    const h = 64;
    const path: Shape = { kind: 'path', d: ticketPath(col, y, headW + tailW, h, headW) };
    right.push(
      { op: 'fill', shape: path, paint: linear(col, 0, col + headW + tailW, 0, '#FDE047', '#FB923C') },
      { op: 'clip', shape: path, ops: [{ op: 'fill', shape: rect(col + headW, y, tailW, h), paint: '#000000', opacity: 0.1 }] },
      { op: 'stroke', shape: { kind: 'path', d: `M${col + headW} ${y + 14}V${y + h - 14}` }, paint: '#2B1D00', width: 2, dash: [5, 5], opacity: 0.45 },
      text(col + 20, y + h / 2 + headSize * 0.36, `GET ${spec.off} OFF`, headSize, '#2B1D00'),
      text(col + headW + 18, y + h / 2 + 8, tail, 22, '#2B1D00', false),
    );
    y += h;
  }
  // Centred on the hero, unless it is taller than the hero.
  const shift = heroY + Math.max(0, (size - y) / 2);
  ops.push(...right.map((op) => moveY(op, shift)));
  return ops;
}

function moveShape(shape: Shape, dy: number): Shape {
  if (shape.kind === 'rect') return { ...shape, y: shape.y + dy };
  if (shape.kind === 'circle') return { ...shape, cy: shape.cy + dy };
  // Paths here are only the ticket's, laid out at y = 0 plus their offset: rewrite by translating.
  const at = shape.at ?? [0, 0, 1];
  return { ...shape, at: [at[0], at[1] + dy, at[2]] };
}

function movePaint(paint: Paint, dy: number): Paint {
  if (typeof paint === 'string') return paint;
  if ('linear' in paint) return { ...paint, linear: [paint.linear[0], paint.linear[1] + dy, paint.linear[2], paint.linear[3] + dy] };
  return { ...paint, radial: [paint.radial[0], paint.radial[1] + dy, paint.radial[2]] };
}

function moveY(op: Op, dy: number): Op {
  switch (op.op) {
    case 'text': return { ...op, y: op.y + dy };
    case 'image': return { ...op, y: op.y + dy, clip: moveShape(op.clip, dy) };
    case 'clip': return { ...op, shape: moveShape(op.shape, dy), ops: op.ops.map((inner) => moveY(inner, dy)) };
    case 'fill': return { ...op, shape: moveShape(op.shape, dy), paint: movePaint(op.paint, dy) };
    case 'stroke': return { ...op, shape: moveShape(op.shape, dy), paint: movePaint(op.paint, dy) };
  }
}

/* ── As SVG, for the server ─────────────────────────────────────────────── */

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function opsToSvg(ops: Op[], size = CARD_SIZE): string {
  const defs: string[] = [];
  let next = 0;
  const id = () => `d${(next += 1)}`;
  const stops = (list: Stop[]) => list.map(([offset, color, opacity]) =>
    `<stop offset="${offset}" stop-color="${color}"${opacity === undefined ? '' : ` stop-opacity="${opacity}"`}/>`).join('');
  const paint = (value: Paint): string => {
    if (typeof value === 'string') return value;
    const name = id();
    if ('linear' in value) {
      const [x1, y1, x2, y2] = value.linear;
      defs.push(`<linearGradient id="${name}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(value.stops)}</linearGradient>`);
    } else {
      const [cx, cy, r] = value.radial;
      defs.push(`<radialGradient id="${name}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}">${stops(value.stops)}</radialGradient>`);
    }
    return `url(#${name})`;
  };
  const shape = (value: Shape, attrs: string): string => {
    if (value.kind === 'rect') return `<rect x="${value.x}" y="${value.y}" width="${value.w}" height="${value.h}"${value.r ? ` rx="${value.r}"` : ''}${attrs}/>`;
    if (value.kind === 'circle') return `<circle cx="${value.cx}" cy="${value.cy}" r="${value.r}"${attrs}/>`;
    const at = value.at ? ` transform="translate(${value.at[0]} ${value.at[1]}) scale(${value.at[2]})"` : '';
    return `<path d="${value.d}"${at}${attrs}/>`;
  };
  const opacity = (value?: number) => (value === undefined ? '' : ` opacity="${value}"`);
  const draw = (op: Op): string => {
    switch (op.op) {
      case 'fill':
        return shape(op.shape, ` fill="${paint(op.paint)}"${opacity(op.opacity)}`);
      case 'stroke': {
        const scale = op.shape.kind === 'path' && op.shape.at ? op.shape.at[2] : 1;
        return shape(op.shape, ` fill="none" stroke="${paint(op.paint)}" stroke-width="${op.width / scale}"${op.dash ? ` stroke-dasharray="${op.dash.join(' ')}"` : ''}`
          + `${op.round ? ' stroke-linecap="round" stroke-linejoin="round"' : ''}${opacity(op.opacity)}`);
      }
      case 'text':
        return `<text x="${op.x}" y="${op.y}" font-family="${CARD_FONT}" font-size="${op.size}" font-weight="${op.bold ? 700 : 400}" fill="${op.paint}"`
          + `${op.anchor && op.anchor !== 'start' ? ` text-anchor="${op.anchor}"` : ''}${opacity(op.opacity)}>${esc(op.text)}</text>`;
      case 'image': {
        const name = id();
        defs.push(`<clipPath id="${name}">${shape(op.clip, '')}</clipPath>`);
        return `<image href="${esc(op.src)}" x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${name})"/>`;
      }
      case 'clip': {
        const name = id();
        defs.push(`<clipPath id="${name}">${shape(op.shape, '')}</clipPath>`);
        return `<g clip-path="url(#${name})">${op.ops.map(draw).join('')}</g>`;
      }
    }
  };
  // The server has no emoji font: an emoji would come out as a box.
  const body = ops.filter((op) => !(op.op === 'text' && op.emoji)).map(draw).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CARD_SIZE} ${CARD_SIZE}"><defs>${defs.join('')}</defs>${body}</svg>`;
}
