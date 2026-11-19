import wasmLoaderUrl from '@mediapipe-wasm/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe-wasm/vision_wasm_internal.wasm?url';
import modelUrl from './models/efficientdet_lite2.tflite?url';
import type { PhotoBox } from './api';

/**
 * The things in a photo, found on the shopper's own phone.
 *
 * A shelf of figures in front of boxed toys has no plain backdrop for the
 * server to tell things from, so the server alone finds nothing in it. This
 * asks a small object detector instead: Google's MediaPipe running
 * EfficientDet-Lite2 (Apache-2.0), compiled to WebAssembly and served from
 * this site - nothing is sent anywhere to find them, and no key is needed.
 * It is fetched only when somebody searches with a photo (about 21 MB the
 * first time, from the cache after), and only the boxes it finds go to the
 * server with the photo.
 *
 * It knows everyday things, and reads a figure as a person; packaged toys it
 * mostly does not see. What it misses the server's own look, and the shopper's
 * own box, still cover. Any failure - an old phone, no WebAssembly, a slow
 * download - is no boxes, and the search goes on without them.
 */

type Detector = { detect: (image: HTMLImageElement) => { detections: Detection[] } };
interface Detection {
  categories: { score: number; categoryName: string }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
}

/** Below this the detector is guessing. Low, because a missed figure costs more than an extra dot. */
const MIN_SCORE = 0.15;
/** At most this many things are offered: the server fingerprints each. */
const MAX_THINGS = 12;
/** A box over this much of the photo is the shelf or the wall, not a thing on it. */
const MAX_AREA = 0.6;
/** A box under this much of it is a speck. */
const MIN_AREA = 0.003;
/**
 * Two boxes sharing this much of the smaller one are one thing found twice: a
 * torso inside its whole figure. A figure standing behind another shares less
 * (about 0.7 on a crowded shelf) and stays its own thing.
 */
const SAME_THING = 0.8;
/** How long the first look may take, model download included, before the search goes on without it. */
const PATIENCE_MS = 20_000;

let detector: Promise<Detector> | null = null;

function loadDetector(): Promise<Detector> {
  detector ??= import('@mediapipe/tasks-vision').then(({ ObjectDetector }) =>
    ObjectDetector.createFromOptions(
      { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
      {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
        scoreThreshold: MIN_SCORE,
        maxResults: 40,
        runningMode: 'IMAGE',
      },
    ) as Promise<Detector>);
  // A failed load is tried again next time rather than kept.
  detector.catch(() => { detector = null; });
  return detector;
}

const areaOf = (box: PhotoBox) => box[2] * box[3];

function overlapShare(a: PhotoBox, b: PhotoBox): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(areaOf(a), areaOf(b));
}

/**
 * The detector's boxes made into things: as fractions of the photo, the shelf
 * and the specks dropped, a thing found twice kept once, likeliest first.
 */
export function thingsFrom(detections: Detection[], width: number, height: number): PhotoBox[] {
  const found = detections
    .filter((detection) => detection.boundingBox && (detection.categories[0]?.score ?? 0) >= MIN_SCORE)
    .map((detection) => {
      const { originX, originY, width: w, height: h } = detection.boundingBox!;
      const x = Math.max(0, originX / width); const y = Math.max(0, originY / height);
      const box: PhotoBox = [x, y, Math.min(1 - x, w / width), Math.min(1 - y, h / height)];
      return { box, score: detection.categories[0]!.score };
    })
    .filter(({ box }) => areaOf(box) <= MAX_AREA && areaOf(box) >= MIN_AREA)
    .sort((a, b) => b.score - a.score);
  const kept: PhotoBox[] = [];
  for (const { box } of found) {
    if (kept.length >= MAX_THINGS) break;
    if (kept.some((other) => overlapShare(other, box) >= SAME_THING)) continue;
    kept.push(box.map((part) => Math.round(part * 1000) / 1000) as PhotoBox);
  }
  return kept;
}

/** The things found in a photo by id, so looking at the same photo again costs nothing. */
const looked = new Map<string, Promise<PhotoBox[]>>();

/** The things in the photo, as boxes; empty when there are none, or none could be found. */
export function detectThings(photoId: string, dataUrl: string): Promise<PhotoBox[]> {
  const known = looked.get(photoId);
  if (known) return known;
  const work = (async () => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const found = await loadDetector();
    const result = found.detect(image);
    return thingsFrom(result.detections, image.naturalWidth, image.naturalHeight);
  })();
  const patient = new Promise<PhotoBox[]>((resolve) => { setTimeout(() => resolve([]), PATIENCE_MS); });
  const answer = Promise.race([work, patient]).catch(() => [] as PhotoBox[]);
  looked.set(photoId, answer);
  return answer;
}

/** Start fetching the detector before it is needed: when the photo picker opens, say. */
export function warmDetector(): void {
  void loadDetector().catch(() => undefined);
}
