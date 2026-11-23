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

/** The tilings looked at, finest last: the whole photo, then 2x2 (twice: snug and wide), 3x3 and 4x4 overlapping tiles. */
export const TILINGS: readonly { grid: number; overlap: number }[] = [
  { grid: 1, overlap: 0 }, { grid: 2, overlap: 0.2 },
  // Four big tiles, three quarters of the photo each: a boxed figure too big
  // for the finer tiles is seen whole, and larger than in the whole photo.
  { grid: 2, overlap: 0.5 },
  { grid: 3, overlap: 0.25 }, { grid: 4, overlap: 0.3 },
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
  'dining table', 'bed', 'couch', 'chair', 'bench', 'oven', 'sink', 'toilet', 'traffic light',
  'stop sign', 'parking meter', 'fire hydrant', 'car', 'truck', 'bus', 'train', 'boat', 'potted plant',
]);
/**
 * What the detector calls a boxed or carded toy: flat, printed and square,
 * it reads as a book, a screen, a fridge door or a suitcase. In a collector's
 * photo that is the package, and the figure printed on it or seen through
 * its window is the package too, not a thing of its own.
 */
const PACKAGE = new Set(['book', 'tv', 'laptop', 'refrigerator', 'suitcase', 'cell phone', 'microwave', 'keyboard', 'remote']);
/** A detection under this is noise unless other looks agree with it. */
const MIN_SCORE = 0.08;
/** Votes a fused box needs: one sure look, or several unsure ones. */
const MIN_VOTE = 0.25;
/** Over this much of the photo is the shelf, not a thing on it - a big boxed set can be a quarter of it. */
const MAX_AREA = 0.3;
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
  const clusters: { looks: { w: number; box: Box }[]; box: Box; vote: number; packed: number }[] = [];
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
      if (PACKAGE.has(d.label)) best.packed += d.score;
    } else {
      clusters.push({ looks: [{ w: d.score, box: d.box }], box: d.box, vote: d.score, packed: PACKAGE.has(d.label) ? d.score : 0 });
    }
  }
  // Each kept box is the looks at it averaged, the surer ones counting more.
  for (const cluster of clusters) {
    const total = cluster.looks.reduce((sum, look) => sum + look.w, 0);
    cluster.box = [0, 1, 2, 3].map((k) => cluster.looks.reduce((sum, look) => sum + look.w * look.box[k]!, 0) / total) as Box;
  }
  const voted = clusters.filter((cluster) => cluster.vote >= MIN_VOTE);
  const isPackage = (cluster: (typeof clusters)[number]) => cluster.packed * 2 >= cluster.vote;
  // A box round the middles of two or more smaller things is the group they
  // stand in. A package holds a figure and its parts, so it is a group only
  // when it holds other packages, whole: a box seen half in one tile and
  // whole in another is one box.
  const things = voted.filter((cluster) => voted.filter((other) => other !== cluster
    && (!isPackage(cluster) || isPackage(other))
    && areaOf(other.box) < 0.7 * areaOf(cluster.box)
    && holds(cluster.box, centre(other.box))
    && insideOf(other.box, cluster.box) > (isPackage(cluster) ? 0.7 : 0.6)).length < 2);
  // Packages first, so what is printed on one or seen through its window goes with it.
  const order = (a: (typeof clusters)[number], b: (typeof clusters)[number]) =>
    Number(isPackage(b)) - Number(isPackage(a)) || b.vote - a.vote;
  // A torso inside its own figure is the figure seen twice; a figure inside a package is the package.
  let kept: (Fused & { packaged: boolean })[] = [];
  for (const cluster of things.sort(order)) {
    if (kept.some((k) => (k.packaged && !isPackage(cluster) && insideOf(cluster.box, k.box) >= 0.65)
      || (insideOf(cluster.box, k.box) >= 0.75 && (areaOf(cluster.box) < 0.45 * areaOf(k.box) || insideOf(k.box, cluster.box) >= 0.6)))) continue;
    // A package round most of one already kept, and over nothing else kept,
    // is that one seen whole: the part goes. One that also reaches over a
    // neighbour is the row they stand in, and is not a thing.
    if (isPackage(cluster)) {
      const parts = kept.filter((k) => k.packaged && areaOf(k.box) < areaOf(cluster.box) && insideOf(k.box, cluster.box) >= 0.6);
      const others = kept.filter((k) => !parts.includes(k));
      if (parts.length > 0) {
        if (others.some((k) => insideOf(k.box, cluster.box) > 0.1)) continue;
        kept = others;
      }
    }
    kept.push({ box: rounded(cluster.box), vote: cluster.vote, packaged: isPackage(cluster) });
  }
  return kept.map(({ box, vote }) => ({ box, vote }));
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

/* ── Views of one thing ──────────────────────────────────────────────── */

/** A subject at least this much of the photo's height (or width, stacked) is a whole view, not a thing on a shelf. */
const VIEW_SPAN = 0.45;
/** A collage of views holds a few, not a shelf's worth. */
const MAX_VIEWS = 6;

/**
 * Whether a photo is views of one thing laid side by side - a product's
 * collage: the same figure up close, full length, from the back - rather
 * than different things together. Two to six big subjects in a row (or a
 * column), each filling most of the photo's height (width), of a size, not
 * overlapping; anything smaller is part of the view it stands in. The
 * picture alone cannot always tell such views of one thing from as many
 * different things posed alike, and in that doubt the fee counts one.
 */
export function viewsLineup(boxes: readonly Box[]): boolean {
  for (const across of [true, false]) {
    const span = (box: Box) => (across ? box[3] : box[2]);
    const start = (box: Box) => (across ? box[0] : box[1]);
    const size = (box: Box) => (across ? box[2] : box[3]);
    const shared = (a: Box, b: Box) => Math.max(0, Math.min(start(a) + size(a), start(b) + size(b)) - Math.max(start(a), start(b)));
    // The views: big subjects side by side, the narrowest first, so one box
    // the detector drew across two panels does not stand for either.
    const views: Box[] = [];
    for (const box of boxes.filter((one) => span(one) >= VIEW_SPAN).sort((p, q) => size(p) - size(q))) {
      if (views.every((view) => shared(view, box) <= 0.35 * Math.min(size(view), size(box)))) views.push(box);
    }
    if (views.length < 2 || views.length > MAX_VIEWS) continue;
    const spans = views.map(span);
    if (Math.min(...spans) < 0.6 * Math.max(...spans)) continue;
    // Every other thing sits within one of the views.
    const lane = (box: Box) => { const middle = start(box) + size(box) / 2; return views.some((view) => middle >= start(view) - 0.05 && middle <= start(view) + size(view) + 0.05); };
    if (boxes.every((box) => views.includes(box) || lane(box))) return true;
  }
  return false;
}

/**
 * Whether the things found are one subject: every box touches the next, in
 * one cluster no bigger than most of the photo - one figure the detector saw
 * as a head, a jacket and a pair of legs. A shelf of figures spreads over the
 * whole photo, or falls into several clusters.
 */
export function oneSubject(found: readonly Box[]): boolean {
  // Specks beside a subject - a glove, a glint, a hand - are not things of their own.
  const largest = Math.max(0, ...found.map(areaOf));
  const boxes = found.filter((box) => areaOf(box) >= SPECK * largest);
  if (boxes.length < 2) return boxes.length === 1;
  const parent = boxes.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)));
  // Pieces of one figure - a head, a glove - often stop just short of each other.
  const near = (a: Box, b: Box) => a[0] - TOUCH <= b[0] + b[2] && b[0] - TOUCH <= a[0] + a[2] && a[1] - TOUCH <= b[1] + b[3] && b[1] - TOUCH <= a[1] + a[3];
  boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i && near(a, b)) parent[root(i)] = root(j); }));
  if (new Set(boxes.map((_, index) => root(index))).size !== 1) return false;
  const x0 = Math.min(...boxes.map((box) => box[0])); const y0 = Math.min(...boxes.map((box) => box[1]));
  const x1 = Math.max(...boxes.map((box) => box[0] + box[2])); const y1 = Math.max(...boxes.map((box) => box[1] + box[3]));
  if ((x1 - x0) * (y1 - y0) > ONE_SUBJECT_AREA) return false;
  // Two whole figures side by side are two things, not the pieces of one.
  const whole = boxes.filter((box) => box[3] >= 0.75 * (y1 - y0) || box[2] >= 0.75 * (x1 - x0));
  return !whole.some((a, i) => whole.some((b, j) => j > i && insideOf(a, b) < 0.5 && insideOf(b, a) < 0.5));
}

/** A box under this share of the largest one's area is a speck beside it, for telling one subject. */
const SPECK = 0.15;
/** Boxes this close count as touching: the pieces of one thing seen apart. */
const TOUCH = 0.05;

/**
 * The separate subjects in a photo: boxes mostly inside one another - a
 * figure's head, its jacket, the figure - are one subject; boxes that only
 * touch, as packed boxes or figures on a shelf do, are each their own.
 * Specks too small to be a thing for sale are left out.
 */
export function subjectsOf(boxes: readonly Box[]): Box[] {
  const parent = boxes.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)));
  boxes.forEach((a, i) => boxes.forEach((b, j) => {
    if (j > i && Math.max(insideOf(a, b), insideOf(b, a)) >= SAME_SUBJECT) parent[root(i)] = root(j);
  }));
  const groups = new Map<number, Box[]>();
  boxes.forEach((box, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), box]));
  return [...groups.values()].map((group) => {
    const x0 = Math.min(...group.map((box) => box[0])); const y0 = Math.min(...group.map((box) => box[1]));
    const x1 = Math.max(...group.map((box) => box[0] + box[2])); const y1 = Math.max(...group.map((box) => box[1] + box[3]));
    return [x0, y0, x1 - x0, y1 - y0] as Box;
  }).filter((subject) => areaOf(subject) >= MIN_SUBJECT);
}

/**
 * Whether a photo clearly shows several things: three or more separate
 * subjects, spread across the photo, and not views of one thing side by
 * side. Anything less is one item, as the seller says - in doubt, one fee.
 * `boxes` are those in focus.
 */
export function clearlySeveral(boxes: readonly Box[], all: readonly Box[] = boxes): boolean {
  // A collage is read from everything in it: a softer panel is still one of its views.
  if (viewsLineup(all) || viewsLineup(boxes)) return false;
  const subjects = subjectsOf(boxes);
  if (subjects.length < SEVERAL) return false;
  const xs = subjects.map((box) => box[0] + box[2] / 2); const ys = subjects.map((box) => box[1] + box[3] / 2);
  return Math.max(...xs) - Math.min(...xs) >= SPREAD || Math.max(...ys) - Math.min(...ys) >= SPREAD;
}

/** Subjects a photo must show, at least, to be charged as several things. */
export const SEVERAL = 3;
/** How far apart their middles must spread, across or down, as a share of the photo. */
const SPREAD = 0.4;
/** A box this much inside another is part of the same subject. */
const SAME_SUBJECT = 0.3;
/** A subject smaller than this share of the photo is a speck, not a thing for sale. */
const MIN_SUBJECT = 0.005;

/** One subject covers no more than this much of the photo: more is a shelf of things touching. */
const ONE_SUBJECT_AREA = 0.5;
/** A thing this much less sharp than the sharpest is the blurred background, not for sale. */
const BLUR_RATIO = 0.22;

/**
 * How sharp each box is: the strong end of the edges inside it. What is for
 * sale is what the camera focused on; a shelf, bags or a room behind it,
 * thrown out of focus, is soft.
 */
export function focusOf(rgba: ArrayLike<number>, width: number, height: number, boxes: readonly Box[]): number[] {
  const small = shrinkPixels(rgba, width, height, 640);
  const W = small.width; const H = small.height;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < gray.length; i += 1) gray[i] = 0.299 * small.data[i * 4]! + 0.587 * small.data[i * 4 + 1]! + 0.114 * small.data[i * 4 + 2]!;
  return boxes.map(([bx, by, bw, bh]) => {
    const x0 = Math.max(1, Math.floor(bx * W)); const x1 = Math.min(W - 1, Math.ceil((bx + bw) * W));
    const y0 = Math.max(1, Math.floor(by * H)); const y1 = Math.min(H - 1, Math.ceil((by + bh) * H));
    const counts = new Uint32Array(256); let total = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = y * W + x;
        const lap = Math.abs(4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - W]! - gray[i + W]!);
        counts[Math.min(255, Math.round(lap))]! += 1; total += 1;
      }
    }
    // The 90th percentile: the box's sharpest tenth, so a sharp thing on a plain backdrop still counts sharp.
    let seen = 0;
    for (let level = 0; level < 256; level += 1) { seen += counts[level]!; if (seen >= total * 0.9) return level; }
    return 0;
  });
}

/** The boxes in focus: those not far softer than the sharpest. */
export function inFocus<T extends Box>(boxes: readonly T[], focus: readonly number[], ratio = BLUR_RATIO): T[] {
  const sharpest = Math.max(0, ...focus);
  if (sharpest <= 0) return [...boxes];
  return boxes.filter((_, index) => (focus[index] ?? 0) >= ratio * sharpest);
}

/**
 * Sharp enough to be charged for: near as sharp as what the camera focused
 * on. Stricter than `inFocus` - a half-blurred bag behind a figure held up to
 * the camera is not clearly a thing for sale.
 */
export const SHARP_RATIO = 0.4;

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
