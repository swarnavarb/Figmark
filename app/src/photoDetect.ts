import wasmLoaderUrl from '@mediapipe-wasm/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe-wasm/vision_wasm_internal.wasm?url';
import modelUrl from './models/efficientdet_lite2_int8.tflite?url';
import {
  BLOB_EDGE, MAX_THINGS, TILINGS, backdropBlobs, combineThings, fuseDetections, shrinkPixels, tilesOf, type Detection,
} from '@shared/photo-things';
import type { PhotoBox } from './api';
import type { PhotoQuery } from './photoQuery';

/**
 * The things in a photo, found on the person's own phone: the one detector
 * photo search and the sell form both use (the method is shared with the
 * server: shared/photo-things.ts).
 *
 * Google's MediaPipe runs EfficientDet-Lite2 (Apache-2.0, int8: 7.5 MB),
 * compiled to WebAssembly and served from this site - nothing is sent
 * anywhere to find them, and no key is needed. It looks at the photo as it
 * was taken, not the copy compressed for sending, and more than once:
 *
 * - the whole photo and its four quarters first, in a second or so, so the
 *   first boxes come quickly;
 * - then a 3x3 and a 4x4 grid of overlapping tiles, each enlarged, which is
 *   what finds forty small figures on a shelf as forty.
 *
 * Every look at a thing is a vote, and the boxes several looks agree on are
 * kept. The photo's backdrop is read too, for things the detector has no
 * name for. Any failure - an old phone, no WebAssembly, a photo whose pixels
 * this page may not read - is fewer boxes, and the server's reading stands.
 */

type Detector = { detect: (image: CanvasImageSource) => { detections: RawDetection[] } };
interface RawDetection {
  categories: { score: number; categoryName: string }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
}

/** Below this the detector is guessing; fusing the looks asks more. */
const MIN_SCORE = 0.05;
/** The photo is looked at no larger than this: more is time, not things. */
const LOOK_EDGE = 2000;
/** How long the first look may take, model download included, before the search goes on without it. */
const PATIENCE_MS = 25_000;

let detector: Promise<Detector> | null = null;

function loadDetector(): Promise<Detector> {
  detector ??= import('@mediapipe/tasks-vision').then(({ ObjectDetector }) =>
    ObjectDetector.createFromOptions(
      { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
      {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
        scoreThreshold: MIN_SCORE,
        maxResults: 100,
        runningMode: 'IMAGE',
      },
    ) as Promise<Detector>);
  // A failed load is tried again next time rather than kept.
  detector.catch(() => { detector = null; });
  return detector;
}

/** Start fetching the detector before it is needed: when the photo picker opens, say. */
export function warmDetector(): void {
  void loadDetector().catch(() => undefined);
}

/**
 * An address this page may read the pixels of. A photo already uploaded is
 * kept in Blob Storage, another origin that sends no CORS headers: drawn
 * from there, the canvas is tainted and the detector reads nothing. The API
 * serves the same photo from this origin, so that is read instead.
 */
export function readableUrl(url: string): string {
  try {
    const at = new URL(url, window.location.href);
    if (at.protocol === 'data:' || at.protocol === 'blob:' || at.origin === window.location.origin) return url;
    const name = decodeURIComponent(at.pathname.split('/').pop() ?? '');
    if (/^[A-Za-z0-9._-]{8,120}$/.test(name)) return `/api/photos/${encodeURIComponent(name)}`;
  } catch {
    /* Not an address: read it as it is. */
  }
  return url;
}

/** The photo drawn no larger than LOOK_EDGE, from an address whose pixels may be read. */
async function canvasOf(address: string): Promise<HTMLCanvasElement> {
  const url = readableUrl(address);
  const image = new Image();
  if (!url.startsWith('data:') && !url.startsWith('blob:')) image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  const scale = Math.min(1, LOOK_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** What the detector sees in one tile of the photo, as boxes over the whole of it. */
function look(found: Detector, photo: HTMLCanvasElement, [vx, vy, vw, vh]: [number, number, number, number]): Detection[] {
  const W = photo.width; const H = photo.height;
  const whole = vw >= W && vh >= H;
  let source: CanvasImageSource = photo;
  if (!whole) {
    const part = document.createElement('canvas');
    part.width = Math.round(vw); part.height = Math.round(vh);
    part.getContext('2d')!.drawImage(photo, vx, vy, vw, vh, 0, 0, part.width, part.height);
    source = part;
  }
  const out: Detection[] = [];
  for (const detection of found.detect(source).detections) {
    const box = detection.boundingBox;
    const best = detection.categories[0];
    if (!box || !best) continue;
    // A box cut by a tile's inner edge is a piece of something another look sees whole.
    const cut = !whole && ((vx > 0 && box.originX < 2) || (vy > 0 && box.originY < 2)
      || (vx + vw < W && box.originX + box.width > vw - 2) || (vy + vh < H && box.originY + box.height > vh - 2));
    out.push({
      label: best.categoryName, score: best.score, cut,
      box: [(vx + box.originX) / W, (vy + box.originY) / H, box.width / W, box.height / H],
    });
  }
  return out;
}

/** Wait for a frame to be painted between looks, so the page stays responsive. */
const breathe = () => new Promise<void>((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 0)); });

/** Where things stand off the photo's backdrop; none when its pixels may not be read. */
function blobsOf(photo: HTMLCanvasElement): PhotoBox[] {
  try {
    const scale = BLOB_EDGE / Math.max(photo.width, photo.height);
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(photo.width * scale * 2)); small.height = Math.max(1, Math.round(photo.height * scale * 2));
    const context = small.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(photo, 0, 0, small.width, small.height);
    const pixels = context.getImageData(0, 0, small.width, small.height);
    const shrunk = shrinkPixels(pixels.data, small.width, small.height);
    return backdropBlobs(shrunk.data, shrunk.width, shrunk.height);
  } catch {
    return [];
  }
}

/**
 * The things in a photo, as boxes, each once, read top row first. `quick`
 * looks at the whole photo and its quarters; otherwise every tiling is
 * looked at, and `better` hears the quick answer first.
 */
export async function findThings(url: string, options: { quick?: boolean; max?: number; better?: (boxes: PhotoBox[]) => void } = {}): Promise<PhotoBox[]> {
  const [model, canvas] = await Promise.all([loadDetector(), canvasOf(url)]);
  const blobs = blobsOf(canvas);
  const all: Detection[] = [];
  const answer = () => combineThings({ detected: fuseDetections(all).map((fused) => fused.box), blobs }, options.max ?? MAX_THINGS)
    .map((thing) => thing.boxes[0]!);
  for (const [index, { grid, overlap }] of TILINGS.entries()) {
    if (options.quick && index > 1) break;
    for (const tile of tilesOf(canvas.width, canvas.height, grid, overlap)) {
      all.push(...look(model, canvas, tile));
      if (grid > 1) await breathe();
    }
    if (index === 1 && !options.quick) options.better?.(answer());
  }
  return answer();
}

interface Looked {
  /** The things in the photo at a glance. */
  quick: Promise<PhotoBox[]>;
  /** Those and the ones a closer look at every tile finds. */
  close: Promise<PhotoBox[]>;
}

/** What was found in each photo, by id, so looking at the same photo again costs nothing. */
const looked = new Map<string, Looked>();

/**
 * Photo search: the things in the shopper's photo, the quick look's straight
 * away, and the closer look's to `better` when it is done and finds more.
 * Empty when there are none, or none could be found.
 */
export function detectThings(photo: PhotoQuery, better?: (boxes: PhotoBox[]) => void): Promise<PhotoBox[]> {
  let found = looked.get(photo.id);
  if (!found) {
    const source = photo.original ?? photo.dataUrl;
    // One reading: the quick answer is what it has after the first two tilings.
    let early: (boxes: PhotoBox[]) => void = () => undefined;
    const quick = new Promise<PhotoBox[]>((resolve) => { early = resolve; });
    const close = findThings(source, { better: early }).then((boxes) => { early(boxes); return boxes; });
    close.catch(() => early([]));
    const patient = new Promise<PhotoBox[]>((resolve) => { setTimeout(() => resolve([]), PATIENCE_MS); });
    found = {
      quick: Promise.race([quick, patient]).catch(() => [] as PhotoBox[]),
      close: close.catch(() => [] as PhotoBox[]),
    };
    looked.set(photo.id, found);
  }
  const { quick, close } = found;
  if (better) {
    void Promise.all([quick, close]).then(([first, more]) => {
      if (more.length > 0 && JSON.stringify(more) !== JSON.stringify(first)) better(more);
    });
  }
  return quick;
}

/** The sell form: every thing on a sale photo the seller just added, the quick look first. */
export function detectAllThings(url: string, better?: (boxes: PhotoBox[]) => void): Promise<PhotoBox[]> {
  return findThings(url, { better }).catch(() => [] as PhotoBox[]);
}
