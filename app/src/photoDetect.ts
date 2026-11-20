import wasmLoaderUrl from '@mediapipe-wasm/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe-wasm/vision_wasm_internal.wasm?url';
import modelUrl from './models/efficientdet_lite2_int8.tflite?url';
import type { PhotoBox } from './api';
import type { PhotoQuery } from './photoQuery';
import { thingsIn, type Detected } from './photoThings';

/**
 * The things in a photo, found on the shopper's own phone.
 *
 * A shelf of figures in front of boxed toys has no plain backdrop for the
 * server to tell things from. This asks a small object detector instead:
 * Google's MediaPipe running EfficientDet-Lite2 (Apache-2.0, int8: 7.5 MB),
 * compiled to WebAssembly and served from this site - nothing is sent anywhere
 * to find them, and no key is needed. Which of its boxes are things for sale
 * (figures, and packages, which it reads as books) is photoThings.ts.
 *
 * It looks at the photo as it was taken, not the copy compressed for sending:
 * a small, soft copy loses a third of what it finds. And it looks twice:
 *
 * - once at the whole photo, in about half a second, so the dots come quickly;
 * - then at each quarter of it as well, enlarged, which finds the smaller
 *   packages and figures the whole view shrinks away - three times the work,
 *   so it runs after, and adds its dots when done.
 *
 * Any failure - an old phone, no WebAssembly, a slow download - is no boxes,
 * and the search goes on with what the server finds.
 */

type Detector = { detect: (image: CanvasImageSource) => { detections: RawDetection[] } };
interface RawDetection {
  categories: { score: number; categoryName: string }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
}

/** Below this the detector is guessing; photoThings.ts asks more of most kinds. */
const MIN_SCORE = 0.08;
/** The photo is looked at no larger than this: more is time, not things. */
const LOOK_EDGE = 1600;
/** Each quarter looked at closely covers this much of each side, so a thing on a seam is whole in one. */
const QUARTER = 0.6;
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
        maxResults: 50,
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

/** The photo drawn no larger than LOOK_EDGE. */
async function canvasOf(url: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const scale = Math.min(1, LOOK_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** What the detector sees in part of the photo, as boxes over the whole of it. */
function look(found: Detector, photo: HTMLCanvasElement, [vx, vy, vw, vh]: [number, number, number, number]): Detected[] {
  const W = photo.width; const H = photo.height;
  let source: CanvasImageSource = photo;
  if (vw < W || vh < H) {
    const part = document.createElement('canvas');
    part.width = Math.round(vw); part.height = Math.round(vh);
    part.getContext('2d')!.drawImage(photo, vx, vy, vw, vh, 0, 0, part.width, part.height);
    source = part;
  }
  const out: Detected[] = [];
  for (const detection of found.detect(source).detections) {
    const box = detection.boundingBox;
    const best = detection.categories[0];
    if (!box || !best) continue;
    // A box cut by a quarter's inner edge is a piece of something the whole view sees better.
    const cut = (vx > 0 && box.originX < 2) || (vy > 0 && box.originY < 2)
      || (vx + vw < W && box.originX + box.width > vw - 2) || (vy + vh < H && box.originY + box.height > vh - 2);
    if ((vw < W || vh < H) && cut) continue;
    const x = Math.max(0, (vx + box.originX) / W); const y = Math.max(0, (vy + box.originY) / H);
    out.push({
      label: best.categoryName, score: best.score,
      box: [x, y, Math.min(1 - x, box.width / W), Math.min(1 - y, box.height / H)],
    });
  }
  return out;
}

/** The quarters of a photo, each QUARTER of a side, overlapping in the middle. */
function quarters(W: number, H: number): [number, number, number, number][] {
  const w = W * QUARTER; const h = H * QUARTER;
  return [[0, 0, w, h], [W - w, 0, w, h], [0, H - h, w, h], [W - w, H - h, w, h]];
}

interface Looked {
  /** The things in the whole photo at a glance. */
  quick: Promise<PhotoBox[]>;
  /** Those and the ones a closer look at each quarter finds. */
  close: Promise<PhotoBox[]>;
}

/** What was found in each photo, by id, so looking at the same photo again costs nothing. */
const looked = new Map<string, Looked>();

/** Wait for a frame to be painted between looks, so the page stays responsive. */
const breathe = () => new Promise<void>((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 0)); });

/**
 * The things in the photo, as boxes: the quick look's straight away, and the
 * closer look's to `better` when it is done and finds more. Empty when there
 * are none, or none could be found.
 */
export function detectThings(photo: PhotoQuery, better?: (boxes: PhotoBox[]) => void): Promise<PhotoBox[]> {
  let found = looked.get(photo.id);
  if (!found) {
    const ready = Promise.all([loadDetector(), canvasOf(photo.original ?? photo.dataUrl)]);
    const glance = ready.then(([model, canvas]) => look(model, canvas, [0, 0, canvas.width, canvas.height]));
    const quick = glance.then(thingsIn);
    const close = Promise.all([ready, glance]).then(async ([[model, canvas], first]) => {
      const all = [...first];
      for (const part of quarters(canvas.width, canvas.height)) {
        await breathe();
        all.push(...look(model, canvas, part));
      }
      return thingsIn(all);
    });
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
