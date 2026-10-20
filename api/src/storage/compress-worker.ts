import { parentPort } from 'node:worker_threads';
import { compressPhoto } from './compress.js';

/**
 * Photo compression, on a thread of its own: decoding and re-encoding a big
 * JPEG takes a second or two of solid CPU, and on the request thread every
 * other request on the worker waited behind it.
 */
parentPort?.on('message', (job: { id: number; bytes: Uint8Array; contentType: string }) => {
  try {
    const out = compressPhoto(job.bytes, job.contentType);
    const transfer = new Set<ArrayBuffer>();
    if (out.bytes.buffer instanceof ArrayBuffer) transfer.add(out.bytes.buffer);
    if (out.pixels?.data.buffer instanceof ArrayBuffer) transfer.add(out.pixels.data.buffer);
    if (out.thumb?.buffer instanceof ArrayBuffer) transfer.add(out.thumb.buffer);
    parentPort!.postMessage({ id: job.id, out }, [...transfer]);
  } catch (err) {
    parentPort!.postMessage({ id: job.id, failed: String(err) });
  }
});
