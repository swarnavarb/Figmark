/**
 * Finding the things in a photo: the one method Figmark uses everywhere.
 *
 * Photo search ("what is this, and who sells it?") and listing a sale photo
 * ("which of these am I selling?") ask the same question of a picture, so
 * they share one answer. Three readers feed it:
 *
 * - An object detector (on the phone: EfficientDet run by MediaPipe), run on
 *   the whole photo and then on overlapping tiles of it, each enlarged, so a
 *   shelf of forty small figures is seen as forty, not as a blur. Every look
 *   at a thing is a vote; a box several looks agree on is kept, fused from
 *   all of them. A box round two or more kept things is the group, not a
 *   thing.
 * - The backdrop: the photo's own colours are grouped, those that run along
 *   its edges or cover much of it dully (cardboard, a foam mat, a white
 *   sweep) are the backdrop, and whatever stands off them is a thing. It
 *   finds what the detector has no name for - a robot, a pair of wings, a
 *   bag of parts - and a single product shot on a plain sweep.
 * - Claude, on the server when it is on: names each thing and says where
 *   each appears, a front and a back view of one thing as one.
 *
 * `combineThings` lays them together: named first, then detected, then
 * blobs where nothing else stands. Pure, so it runs on the phone, on the
 * server and in tests alike.
 */

/** Left, top, width, height, as fractions of the photo. */
export type Box = [number, number, number, number];

export interface Detection {
  /** What the detector called it: "person", "tie"... names a toy is often given wrongly. */
  label: string;
  score: number;
  box: Box;
  /** Cut by the edge of the tile it was seen in: a piece of something another look sees whole. */
  cut?: boolean;
}

/** The most things one photo is told apart into. */
export const MAX_THINGS = 60;

/** The tilings looked at, finest last: the whole photo, then 2x2, 3x3 and 4x4 overlapping tiles. */
export const TILINGS: readonly { grid: number; overlap: number }[] = [
  { grid: 1, overlap: 0 }, { grid: 2, overlap: 0.2 }, { grid: 3, overlap: 0.25 }, { grid: 4, overlap: 0.3 },
];

/** The tiles of a W x H picture for one tiling, in pixels: x, y, width, height. */
export function tilesOf(W: number, H: number, grid: number, overlap: number): [number, number, number, number][] {
  if (grid <= 1) return [[0, 0, W, H]];
  const tw = Math.min(W, (W / grid) * (1 + overlap));
  const th = Math.min(H, (H / grid) * (1 + overlap));
  const out: [number, number, number, number][] = [];
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      out.push([((W - tw) * i) / (grid - 1), ((H - th) * j) / (grid - 1), tw, th]);
    }
  }
  return out;
}

/** What a photo of a shelf is taken in front of, or on: never a thing for sale. */
const SCENERY = new Set([
  'dining table', 'bed', 'couch', 'chair', 'bench', 'tv', 'refrigerator', 'oven', 'sink', 'toilet', 'traffic light',
  'stop sign', 'parking meter', 'fire hydrant', 'car', 'truck', 'bus', 'train', 'boat', 'laptop', 'keyboard', 'potted plant',
]);
/** A detection under this is noise unless other looks agree with it. */
const MIN_SCORE = 0.08;
/** Votes a fused box needs: one sure look, or several unsure ones. */
const MIN_VOTE = 0.25;
/** Over this much of the photo is the shelf, not a thing on it. */
const MAX_AREA = 0.25;
/** Under this much, a speck. */
const MIN_AREA = 0.0015;

const areaOf = (box: Box) => box[2] * box[3];

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Shared area over combined area, 0 to 1. */
export function sameness(a: Box, b: Box): number {
  const shared = overlapArea(a, b);
  return shared / (areaOf(a) + areaOf(b) - shared || 1);
}

/** How much of `inner` lies inside `outer`, 0 to 1. */
export function insideOf(inner: Box, outer: Box): number {
  return overlapArea(inner, outer) / (areaOf(inner) || 1);
}

const centre = (box: Box): [number, number] => [box[0] + box[2] / 2, box[1] + box[3] / 2];
const holds = (box: Box, [x, y]: [number, number]) => x >= box[0] && x <= box[0] + box[2] && y >= box[1] && y <= box[1] + box[3];
const rounded = (box: Box): Box => box.map((part) => Math.round(part * 1000) / 1000) as Box;

interface Fused { box: Box; vote: number }

/**
 * Many looks at a photo, as the things in it: each box the looks agree on,
 * once, most voted first.
 */
export function fuseDetections(detections: readonly Detection[]): Fused[] {
  const usable = detections
    .filter((d) => !d.cut && !SCENERY.has(d.label) && d.score >= MIN_SCORE && areaOf(d.box) >= MIN_AREA && areaOf(d.box) <= MAX_AREA)
    .sort((a, b) => b.score - a.score);
  const clusters: { looks: { w: number; box: Box }[]; box: Box; vote: number }[] = [];
  for (const d of usable) {
    let best: (typeof clusters)[number] | null = null;
    let bestIou = 0;
    for (const cluster of clusters) {
      const iou = sameness(d.box, cluster.box);
      if (iou >= 0.45 && iou > bestIou) { best = cluster; bestIou = iou; }
    }
    if (best) {
      best.looks.push({ w: d.score, box: d.box });
      best.vote += d.score;
    } else {
      clusters.push({ looks: [{ w: d.score, box: d.box }], box: d.box, vote: d.score });
    }
  }
  // Each kept box is the looks at it averaged, the surer ones counting more.
  for (const cluster of clusters) {
    const total = cluster.looks.reduce((sum, look) => sum + look.w, 0);
    cluster.box = [0, 1, 2, 3].map((k) => cluster.looks.reduce((sum, look) => sum + look.w * look.box[k]!, 0) / total) as Box;
  }
  const voted = clusters.filter((cluster) => cluster.vote >= MIN_VOTE);
  // A box round the middles of two or more smaller things is the group they stand in.
  const things = voted.filter((cluster) => voted.filter((other) => other !== cluster
    && areaOf(other.box) < 0.7 * areaOf(cluster.box)
    && holds(cluster.box, centre(other.box))
    && insideOf(other.box, cluster.box) > 0.6).length < 2);
  // A torso inside its own figure is the figure seen twice.
  const kept: Fused[] = [];
  for (const cluster of things.sort((a, b) => b.vote - a.vote)) {
    if (kept.some((k) => insideOf(cluster.box, k.box) >= 0.75
      && (areaOf(cluster.box) < 0.45 * areaOf(k.box) || insideOf(k.box, cluster.box) >= 0.6))) continue;
    kept.push({ box: rounded(cluster.box), vote: cluster.vote });
  }
  return kept;
}

/* ── The backdrop ─────────────────────────────────────────────────────── */

/** The picture is looked at this wide for its backdrop: enough for a shelf, quick on a phone. */
export const BLOB_EDGE = 192;

/**
 * Where things stand off the photo's backdrop, as boxes.
 *
 * `rgba` is the picture's pixels, four bytes each, `width` by `height`; pass
 * it at about BLOB_EDGE across. Colours are grouped (k-means); a group that
 * runs along the edges, or covers much of the photo, and is not vivid is
 * backdrop. What is left, cleaned of specks, is split into the shapes it
 * makes.
 */
export function backdropBlobs(rgba: ArrayLike<number>, width: number, height: number): Box[] {
  const n = width * height;
  if (n < 64) return [];
  const K = 10;
  const px = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    px[i * 3] = rgba[i * 4]!; px[i * 3 + 1] = rgba[i * 4 + 1]!; px[i * 3 + 2] = rgba[i * 4 + 2]!;
  }
  // Seeded evenly through the picture, so the same photo always reads the same.
  const centres = new Float32Array(K * 3);
  for (let k = 0; k < K; k += 1) {
    const at = Math.floor(((k + 0.5) / K) * n) * 3;
    centres.set([px[at]!, px[at + 1]!, px[at + 2]!], k * 3);
  }
  const label = new Uint8Array(n);
  for (let round = 0; round < 12; round += 1) {
    const sums = new Float64Array(K * 4);
    for (let i = 0; i < n; i += 1) {
      let best = 0; let bestD = Infinity;
      for (let k = 0; k < K; k += 1) {
        const dr = px[i * 3]! - centres[k * 3]!; const dg = px[i * 3 + 1]! - centres[k * 3 + 1]!; const db = px[i * 3 + 2]! - centres[k * 3 + 2]!;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = k; }
      }
      label[i] = best;
      sums[best * 4] = sums[best * 4]! + px[i * 3]!; sums[best * 4 + 1] = sums[best * 4 + 1]! + px[i * 3 + 1]!;
      sums[best * 4 + 2] = sums[best * 4 + 2]! + px[i * 3 + 2]!; sums[best * 4 + 3] = sums[best * 4 + 3]! + 1;
    }
    for (let k = 0; k < K; k += 1) {
      const count = sums[k * 4 + 3]!;
      if (count > 0) centres.set([sums[k * 4]! / count, sums[k * 4 + 1]! / count, sums[k * 4 + 2]! / count], k * 3);
    }
  }
  const share = new Float64Array(K); const edge = new Float64Array(K);
  let edges = 0;
  for (let i = 0; i < n; i += 1) {
    share[label[i]!] = share[label[i]!]! + 1 / n;
    const x = i % width; const y = Math.floor(i / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) { edge[label[i]!] = edge[label[i]!]! + 1; edges += 1; }
  }
  const backdrop: number[] = [];
  for (let k = 0; k < K; k += 1) {
    const r = centres[k * 3]!; const g = centres[k * 3 + 1]!; const b = centres[k * 3 + 2]!;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const vivid = max > 0 ? (max - min) / max : 0;
    if (vivid < 0.6 && (edge[k]! / edges >= 0.08 || share[k]! >= 0.12)) backdrop.push(k);
  }
  if (backdrop.length === 0 || backdrop.length === K) return [];
  // Backdrop by distance to the nearest backdrop colour, not by group, so a thing near in colour stays a thing.
  const reach = 45 * 45;
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    let near = Infinity;
    for (const k of backdrop) {
      const dr = px[i * 3]! - centres[k * 3]!; const dg = px[i * 3 + 1]! - centres[k * 3 + 1]!; const db = px[i * 3 + 2]! - centres[k * 3 + 2]!;
      near = Math.min(near, dr * dr + dg * dg + db * db);
    }
    mask[i] = near > reach ? 1 : 0;
  }
  // Open: off what has a gap beside it, then grown back, so specks and threads go.
  const at = (m: Uint8Array, x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : m[y * width + x]!);
  const erode = (m: Uint8Array) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = i % width; const y = Math.floor(i / width);
      out[i] = m[i]! && at(m, x - 1, y) && at(m, x + 1, y) && at(m, x, y - 1) && at(m, x, y + 1) ? 1 : 0;
    }
    return out;
  };
  const dilate = (m: Uint8Array) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = i % width; const y = Math.floor(i / width);
      out[i] = m[i] || at(m, x - 1, y) || at(m, x + 1, y) || at(m, x, y - 1) || at(m, x, y + 1) ? 1 : 0;
    }
    return out;
  };
  // Twice each way: a thread of glare two cells wide joining two things is cut.
  mask = dilate(dilate(erode(erode(mask))));
  const seen = new Uint8Array(n);
  const boxes: Box[] = [];
  const minCells = Math.max(20, n * 0.0007);
  for (let start = 0; start < n; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let x0 = width; let y0 = height; let x1 = 0; let y1 = 0; let cells = 0;
    while (queue.length > 0) {
      const cell = queue.pop()!;
      const cx = cell % width; const cy = Math.floor(cell / width);
      cells += 1;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx; const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (cells < minCells) continue;
    // Glare and the seams of a box are threads and outlines; a thing fills most of its box.
    if (cells / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.3) continue;
    // Cut by the edge of the photo: the tape, the table, the box behind - not a thing on it.
    if (x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1) continue;
    const box: Box = [x0 / width, y0 / height, (x1 - x0 + 1) / width, (y1 - y0 + 1) / height];
    // The whole photo standing off nothing: there was no backdrop to find.
    if (areaOf(box) > 0.6) continue;
    boxes.push(rounded(box));
  }
  return boxes.sort((a, b) => areaOf(b) - areaOf(a));
}

/* ── Together ─────────────────────────────────────────────────────────── */

/** One thing in a photo, with every place it appears and, when it was named, its name. */
export interface Thing {
  boxes: Box[];
  label: string | null;
  /** How it was found: named (Claude), detected (the object detector) or standing off the backdrop. */
  source: 'named' | 'detected' | 'backdrop';
}

/** Two boxes round the same place. */
function samePlace(a: Box, b: Box): boolean {
  return sameness(a, b) >= 0.45 || insideOf(a, b) >= 0.8 || insideOf(b, a) >= 0.8;
}

/**
 * The things in a photo from every reader, each once, read as a person reads
 * a shelf: top row first, left to right. Named things come first, then
 * detected ones where nothing named stands, then backdrop shapes where
 * neither does and that are big enough to be a thing on their own.
 */
export function combineThings(
  { named = [], detected = [], blobs = [] }: { named?: { label: string | null; boxes: Box[] }[]; detected?: Box[]; blobs?: Box[] },
  max = MAX_THINGS,
): Thing[] {
  const things: Thing[] = named.filter((thing) => thing.boxes.length > 0).map((thing) => ({ ...thing, source: 'named' as const }));
  const taken = () => things.flatMap((thing) => thing.boxes);
  for (const box of detected) {
    if (!taken().some((known) => samePlace(known, box))) things.push({ boxes: [box], label: null, source: 'detected' });
  }
  const before = taken();
  for (const box of blobs) {
    if (areaOf(box) < 0.003) continue;
    // A shape mostly covered by things already found is them, or part of one.
    const covered = before.reduce((sum, known) => sum + overlapArea(box, known), 0) / areaOf(box);
    if (covered >= 0.3 || before.some((known) => holds(known, centre(box)))) continue;
    if (!things.some((thing) => thing.boxes.some((known) => samePlace(known, box)))) things.push({ boxes: [box], label: null, source: 'backdrop' });
  }
  return things.sort(readingOrder).slice(0, max);
}

/** Top row first, then left to right. */
export function readingOrder(a: { boxes: Box[] }, b: { boxes: Box[] }): number {
  const [ax, ay, , ah] = a.boxes[0] ?? [0, 0, 0, 0];
  const [bx, by, , bh] = b.boxes[0] ?? [0, 0, 0, 0];
  const acy = ay + ah / 2; const bcy = by + bh / 2;
  if (Math.abs(acy - bcy) > Math.min(ah, bh) / 2) return acy - bcy;
  return ax - bx;
}

/** Pixels shrunk by averaging, to about `edge` across: what `backdropBlobs` reads. */
export function shrinkPixels(rgba: ArrayLike<number>, width: number, height: number, edge = BLOB_EDGE): { data: Uint8ClampedArray; width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)); const h = Math.max(1, Math.round(height * scale));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy0 = Math.floor((y / h) * height); const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / h) * height));
    for (let x = 0; x < w; x += 1) {
      const sx0 = Math.floor((x / w) * width); const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / w) * width));
      let r = 0; let g = 0; let b = 0; let count = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const at = (sy * width + sx) * 4;
          r += rgba[at]!; g += rgba[at + 1]!; b += rgba[at + 2]!; count += 1;
        }
      }
      const to = (y * w + x) * 4;
      data[to] = r / count; data[to + 1] = g / count; data[to + 2] = b / count; data[to + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}
