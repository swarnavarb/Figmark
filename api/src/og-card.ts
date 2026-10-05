/**
 * Preview pictures for things that have no photo of their own.
 *
 * A chat app shows a shared link as its og:image, and an item without a photo
 * used to fall back to the Figmark banner - the same picture for every item,
 * which says nothing about the one being shared. This draws the picture the
 * app itself shows for that item (its colour tile and initials) with the
 * details beside it: the price, any discount the link brings, how full the
 * pre-order is, and the shop with its level.
 *
 * Drawn as SVG and rasterised with resvg's WebAssembly build, then encoded as
 * JPEG in plain JavaScript: nothing native, so the Functions host needs no
 * binaries. Fonts are bundled because the renderer cannot see the system's.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { encode } from 'jpeg-js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/* ── Text ───────────────────────────────────────────────────────────────── */

/* Advance widths of Bricolage Grotesque for printable ASCII, in thousandths
   of an em. The renderer does not wrap text, so lines are broken here. */
const BOLD = [230,291,360,626,642,977,754,177,321,316,436,528,196,352,233,361,665,346,603,606,624,610,657,509,656,652,243,220,528,528,528,421,987,698,683,680,700,621,593,721,723,293,373,687,508,939,775,722,646,724,679,652,571,728,673,986,697,642,571,324,357,319,572,554,283,585,638,566,639,581,399,601,631,277,281,591,274,946,631,609,638,639,434,544,397,622,572,863,569,602,524,349,271,342,528];
const REGULAR = [253,254,296,605,625,932,756,149,297,277,375,510,149,332,177,349,651,306,573,590,581,594,641,485,640,635,189,171,510,510,510,408,935,657,657,666,686,588,570,698,701,265,349,656,507,893,732,713,621,717,650,635,544,714,648,942,630,580,554,310,333,290,533,589,283,557,608,549,607,564,370,582,596,250,259,546,248,895,596,601,608,607,399,530,371,587,533,809,516,585,488,355,253,326,510];
const EXTRA: Record<string, number> = { '₹': 590, '—': 780, '–': 525, '·': 210, '…': 720, '’': 185, '‘': 185, '“': 360, '”': 360, '×': 520 };

function textWidth(text: string, size: number, bold = true): number {
  const table = bold ? BOLD : REGULAR;
  let units = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    units += code >= 32 && code < 127 ? table[code - 32]! : EXTRA[char] ?? 640;
  }
  return (units / 1000) * size;
}

/** Cut to fit, with an ellipsis when anything was cut. */
function fit(text: string, size: number, max: number, bold = true): string {
  if (textWidth(text, size, bold) <= max) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, size, bold) > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Word-wrapped to at most `lines` lines, the last one ellipsised if it had to be. */
function wrap(text: string, size: number, max: number, lines: number, bold = true): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i += 1) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (textWidth(next, size, bold) <= max || !line) {
      line = next;
      continue;
    }
    out.push(line);
    line = words[i]!;
    if (out.length === lines - 1) {
      out.push(fit(words.slice(i).join(' '), size, max, bold));
      return out;
    }
  }
  if (line) out.push(fit(line, size, max, bold));
  return out;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── The same tile the app draws ─────────────────────────────────────────── */

/* Mirrors app/src/format.ts, so the preview's tile is the colour of the tile
   the person sees when they open the link. */
function hash32(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** resvg reads hex but not hsl(), so the app's hsl tiles are converted here. */
function hsl(h: number, sPct: number, lPct: number): string {
  const sat = sPct / 100;
  const light = lPct / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[0, 8, 4].map((n) => channel(n).toString(16).padStart(2, '0')).join('')}`;
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

/* The level colours of the app's .lvtag--l* chips. */
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

const TEXT = '#F2F5FA';
const DIM = '#AEBBD0';
const FONT = 'Bricolage Grotesque';

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function text(x: number, y: number, value: string, size: number, fill: string, opts: { bold?: boolean; anchor?: string; extra?: string } = {}): string {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${opts.bold === false ? 400 : 700}"`
    + ` fill="${fill}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.extra ?? ''}>${esc(value)}</text>`;
}

/** A rounded label; returns the markup and how wide it came out. */
function pill(x: number, y: number, label: string, size: number, fill: string, ink: string, extra = ''): { svg: string; width: number } {
  const padX = size * 0.75;
  const width = textWidth(label, size) + padX * 2;
  const height = size * 1.9;
  return {
    width,
    svg: `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}"${extra}/>`
      + text(x + padX, y + height / 2 + size * 0.36, label, size, ink),
  };
}

/** The colour tile with its initials, as the app draws an item without a photo. */
function tile(id: string, label: string, x: number, y: number, size: number, round: number): string {
  const hue = hueFor(id);
  return `<defs><linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${hsl(hue, 58, 38)}"/>`
    + `<stop offset="1" stop-color="${hsl((hue + 34) % 360, 64, 19)}"/></linearGradient>`
    + `<clipPath id="tileclip"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${round}"/></clipPath></defs>`
    + `<rect x="${x}" y="${y + 18}" width="${size}" height="${size}" rx="${round}" fill="#000" opacity=".35"/>`
    + `<g clip-path="url(#tileclip)">`
    + `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="url(#tile)"/>`
    + `<circle cx="${x + size * 0.78}" cy="${y + size * 0.2}" r="${size * 0.3}" fill="#fff" opacity=".10"/>`
    + `<circle cx="${x + size * 0.18}" cy="${y + size * 0.9}" r="${size * 0.42}" fill="#000" opacity=".14"/>`
    + `</g>`
    + `<rect x="${x + 1}" y="${y + 1}" width="${size - 2}" height="${size - 2}" rx="${round}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>`
    + text(x + size / 2, y + size / 2 + size * 0.135, initialsOf(label) || '?', size * 0.38, '#fff', { anchor: 'middle', extra: ' fill-opacity=".94" letter-spacing="-4"' });
}

/** A round mark with a ring in the level's colours. */
function avatar(name: string, level: number | null, cx: number, cy: number, r: number, photo?: string | null): string {
  const [from, to] = levelHues(level ?? 1);
  const hue = hueFor(name);
  const face = photo
    ? `<clipPath id="face"><circle cx="${cx}" cy="${cy}" r="${r - 5}"/></clipPath>`
      + `<image href="${esc(photo)}" x="${cx - r + 5}" y="${cy - r + 5}" width="${(r - 5) * 2}" height="${(r - 5) * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#face)"/>`
    : `<defs><linearGradient id="facefill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(hue, 58, 40)}"/>`
      + `<stop offset="1" stop-color="${hsl((hue + 34) % 360, 64, 20)}"/></linearGradient></defs>`
      + `<circle cx="${cx}" cy="${cy}" r="${r - 5}" fill="url(#facefill)"/>`
      + text(cx, cy + r * 0.24, initialsOf(name) || '?', r * 0.68, '#fff', { anchor: 'middle' });
  return `<defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#ring)"/>${face}`;
}

/** The level chip: "LV 6" on the level's colours, then its title. */
function levelChip(x: number, y: number, level: number, title: string, size: number): string {
  const [from, to] = levelHues(level);
  const ink = level >= 10 && level < 15 ? '#2B1D00' : '#FFFFFF';
  const label = `LV ${level}`;
  const width = textWidth(label, size) + size * 1.2;
  const height = size * 1.7;
  return `<defs><linearGradient id="lv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${size * 0.45}" fill="url(#lv)"/>`
    + text(x + size * 0.6, y + height / 2 + size * 0.36, label, size, ink)
    + text(x + width + size * 0.5, y + height / 2 + size * 0.36, title, size, DIM, { bold: false });
}

function frame(hue: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`
    + `<defs>`
    + `<radialGradient id="glow" cx=".22" cy=".5" r=".75"><stop offset="0" stop-color="${hsl(hue, 60, 30)}" stop-opacity=".75"/><stop offset="1" stop-color="#080B12" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="glow2" cx="1" cy="0" r=".6"><stop offset="0" stop-color="#7C3AED" stop-opacity=".35"/><stop offset="1" stop-color="#080B12" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#D946EF"/></linearGradient>`
    + `</defs>`
    + `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#080B12"/>`
    + `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow)"/>`
    + `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow2)"/>`
    + body
    + `</svg>`;
}

/** The Figmark mark and name, top of the right-hand column. */
function brand(x: number, y: number): string {
  return `<rect x="${x}" y="${y}" width="44" height="44" rx="11" fill="url(#brand)"/>`
    + text(x + 22, y + 32, 'F', 28, '#fff', { anchor: 'middle' })
    + text(x + 58, y + 32, 'Figmark', 30, TEXT);
}

/** A small shield, for Buyer Protection. */
function shield(x: number, y: number, s: number, fill: string): string {
  return `<path transform="translate(${x} ${y}) scale(${s / 24})" d="M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3Z" fill="${fill}"/>`
    + `<path transform="translate(${x} ${y}) scale(${s / 24})" d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="#080B12" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/* ── Cards ───────────────────────────────────────────────────────────────── */

export interface ListingCard {
  id: string;
  title: string;
  /** Formatted, e.g. "₹28,000": what this link's buyer pays. */
  price: string;
  /** The price before the link's discount, when there is one. */
  was?: string | null;
  /** The discount itself, e.g. "₹500". */
  off?: string | null;
  condition?: string | null;
  preOrder?: boolean;
  /** How full the pre-order is, drawn as a meter along the tile's foot. */
  fill?: { joined: number; total: number; line: string } | null;
  shop: { name: string; level: number | null; title: string | null; photo?: string | null };
}

const COL = 620;
const COL_W = 1140 - COL;

export function listingSvg(card: ListingCard): string {
  const hue = hueFor(card.id);
  const parts: string[] = [tile(card.id, card.title, 60, 52, 508, 44)];

  // On the tile: what kind of thing it is.
  let bx = 92;
  for (const [label, fill, ink] of [
    card.preOrder ? ['PRE-ORDER', '#F472B6', '#2A0614'] : null,
    card.condition ? [card.condition.toUpperCase(), 'rgba(8,11,18,.62)', '#fff'] : null,
  ].filter(Boolean) as [string, string, string][]) {
    const chip = pill(bx, 84, fit(label, 22, 220), 22, fill, ink, ' letter-spacing="1"');
    parts.push(chip.svg);
    bx += chip.width + 12;
  }

  if (card.fill && card.fill.total > 0) {
    const share = Math.max(0.04, Math.min(1, card.fill.joined / card.fill.total));
    const mx = 92;
    const mw = 508 - 64;
    parts.push(
      `<rect x="60" y="${52 + 508 - 118}" width="508" height="118" fill="#000" opacity=".38" clip-path="url(#tileclip)"/>`,
      text(mx, 52 + 508 - 72, fit(card.fill.line, 24, mw), 24, '#fff'),
      `<rect x="${mx}" y="${52 + 508 - 50}" width="${mw}" height="14" rx="7" fill="#fff" opacity=".18"/>`,
      `<defs><linearGradient id="meter" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F472B6"/><stop offset="1" stop-color="#FBBF24"/></linearGradient></defs>`,
      `<rect x="${mx}" y="${52 + 508 - 50}" width="${(mw * share).toFixed(1)}" height="14" rx="7" fill="url(#meter)"/>`,
    );
  }

  parts.push(brand(COL, 58));
  const bp = pill(0, 0, 'Buyer Protection', 20, 'rgba(255,255,255,.10)', TEXT);
  const bpX = 1140 - bp.width - 30;
  parts.push(
    `<rect x="${bpX}" y="60" width="${bp.width + 30}" height="40" rx="20" fill="rgba(255,255,255,.10)" stroke="rgba(255,255,255,.14)"/>`,
    shield(bpX + 12, 69, 22, '#34D399'),
    text(bpX + 42, 87, 'Buyer Protection', 20, TEXT),
  );

  let y = 178;
  const titleLines = wrap(card.title, 50, COL_W, card.off ? 2 : 3);
  for (const line of titleLines) {
    parts.push(text(COL, y, line, 50, TEXT, { extra: ' letter-spacing="-.5"' }));
    y += 58;
  }

  y += 20;
  parts.push(text(COL, y + 50, card.price, 68, '#fff', { extra: ' letter-spacing="-1"' }));
  if (card.was) {
    const px = COL + textWidth(card.price, 68) + 22;
    const ww = textWidth(card.was, 34, false);
    parts.push(
      text(px, y + 48, card.was, 34, DIM, { bold: false }),
      `<line x1="${px - 2}" y1="${y + 36}" x2="${px + ww + 2}" y2="${y + 36}" stroke="${DIM}" stroke-width="3"/>`,
    );
  }
  y += 78;

  if (card.off) {
    // The reason to tap, as a ticket: gold, with the stub notched off.
    const head = `GET ${card.off} OFF`;
    const headW = textWidth(head, 30) + 44;
    const tail = 'with my link';
    const tailW = textWidth(tail, 22, false) + 40;
    const h = 60;
    parts.push(
      `<defs><linearGradient id="ticket" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FBBF24"/><stop offset="1" stop-color="#F59E0B"/></linearGradient>`
      + `<mask id="notch"><rect x="${COL}" y="${y}" width="${headW + tailW}" height="${h}" rx="12" fill="#fff"/>`
      + `<circle cx="${COL + headW}" cy="${y}" r="9" fill="#000"/><circle cx="${COL + headW}" cy="${y + h}" r="9" fill="#000"/></mask></defs>`,
      `<g mask="url(#notch)"><rect x="${COL}" y="${y}" width="${headW + tailW}" height="${h}" rx="12" fill="url(#ticket)"/>`
      + `<rect x="${COL + headW}" y="${y}" width="${tailW}" height="${h}" fill="#000" opacity=".12"/></g>`,
      `<line x1="${COL + headW}" y1="${y + 12}" x2="${COL + headW}" y2="${y + h - 12}" stroke="#2B1D00" stroke-opacity=".45" stroke-width="2" stroke-dasharray="5 5"/>`,
      text(COL + 22, y + 41, head, 30, '#2B1D00'),
      text(COL + headW + 20, y + 38, tail, 22, '#2B1D00', { bold: false }),
    );
    y += h + 20;
  }


  // The shop, along the bottom: who is selling and how far they have come.
  const shopY = 528;
  parts.push(`<line x1="${COL}" y1="${shopY - 52}" x2="1140" y2="${shopY - 52}" stroke="#fff" stroke-opacity=".10" stroke-width="2"/>`);
  parts.push(avatar(card.shop.name, card.shop.level, COL + 34, shopY, 34, card.shop.photo));
  parts.push(text(COL + 84, shopY - 6, fit(card.shop.name, 28, COL_W - 90), 28, TEXT));
  if (card.shop.level) {
    parts.push(levelChip(COL + 84, shopY + 8, card.shop.level, fit(card.shop.title ?? '', 20, COL_W - 200, false), 20));
  }

  return frame(hue, parts.join(''));
}

export interface PersonCard {
  id: string;
  name: string;
  /** "Shop" or "Collector": what kind of page the link opens. */
  kicker: string;
  level: number | null;
  title: string | null;
  lines: string[];
  photo?: string | null;
}

/** A shop or a person: their mark large, with their standing beside it. */
export function personSvg(card: PersonCard): string {
  const hue = hueFor(card.name);
  const parts: string[] = [
    `<circle cx="314" cy="${CARD_HEIGHT / 2 + 14}" r="232" fill="#000" opacity=".3"/>`,
    avatar(card.name, card.level, 314, CARD_HEIGHT / 2, 232, card.photo),
    brand(COL, 58),
  ];
  let y = 210;
  parts.push(text(COL, y - 50, card.kicker.toUpperCase(), 22, '#C4B5FD', { extra: ' letter-spacing="3"' }));
  for (const line of wrap(card.name, 60, COL_W, 2)) {
    parts.push(text(COL, y, line, 60, TEXT, { extra: ' letter-spacing="-1"' }));
    y += 68;
  }
  if (card.level) {
    parts.push(levelChip(COL, y - 20, card.level, card.title ?? '', 26));
    y += 70;
  }
  for (const line of card.lines.slice(0, 3)) {
    for (const part of wrap(line, 26, COL_W, 2, false)) {
      parts.push(text(COL, y, part, 26, DIM, { bold: false }));
      y += 36;
    }
    y += 6;
  }
  return frame(hue, parts.join(''));
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

let ready: Promise<Uint8Array[]> | null = null;

function assetsDir(): string {
  const candidates = [
    resolve(__dirname, '../../../assets'), // api/dist/api/src -> api/assets
    resolve(__dirname, '../assets'), // api/src -> api/assets, run from source
    join(process.cwd(), 'assets'),
    join(process.cwd(), 'api', 'assets'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'fonts'))) ?? candidates[0]!;
}

function boot(): Promise<Uint8Array[]> {
  if (!ready) {
    ready = (async () => {
      await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
      const fonts = join(assetsDir(), 'fonts');
      return ['BricolageGrotesque-Bold.ttf', 'BricolageGrotesque-Regular.ttf'].map((name) => new Uint8Array(readFileSync(join(fonts, name))));
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

/** An SVG card as a JPEG, small enough for any chat app's preview. */
export async function renderCard(svg: string): Promise<Buffer> {
  const fontBuffers = await boot();
  const resvg = new Resvg(svg, {
    font: { fontBuffers, defaultFontFamily: FONT, sansSerifFamily: FONT },
    fitTo: { mode: 'original' },
  });
  const image = resvg.render();
  try {
    const jpeg = encode({ data: image.pixels, width: image.width, height: image.height }, 86);
    return Buffer.from(jpeg.data);
  } finally {
    image.free();
    resvg.free();
  }
}
