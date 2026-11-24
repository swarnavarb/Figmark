import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { getAuthService } from '../auth/index.js';
import { AiUnavailable, scanPhoto } from '../free-ai.js';
import { clientIp, tooFast } from '../rate-limit.js';
import { error, handler, json } from './http.js';

/**
 * POST /api/ai/scan - "Scan with AI" on the site's free Gemini key, so the
 * person scanning signs in to nothing.
 *
 * Body: { image: "data:image/jpeg;base64,..." }, the photo already shrunk
 * by the app. Answers { text, model }: the model's raw list of labels and
 * boxes, which the app reads exactly as it reads Puter's. 503 `ai_unavailable`
 * when no key is set or the free day is spent: the app then asks Puter.
 */

/** A photo the app has shrunk to 1600px: well under this as base64. */
const MAX_IMAGE_CHARS = 3_000_000;
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

async function scan(request: HttpRequest, context: InvocationContext) {
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request).catch(() => null);
  const slow = await tooFast(viewer?.id ?? `ip:${clientIp(request)}`, 'aiscan');
  if (slow) return slow;

  let body: { image?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'bad_request', 'Send the photo as JSON.');
  }
  const image = typeof body?.image === 'string' && body.image.length <= MAX_IMAGE_CHARS ? DATA_URL.exec(body.image) : null;
  if (!image) return error(400, 'bad_request', 'Send one JPEG, PNG or WebP photo as a data URL.');

  try {
    const reply = await scanPhoto({ mimeType: image[1]!, base64: image[2]! });
    return json(200, reply);
  } catch (cause) {
    if (!(cause instanceof AiUnavailable)) throw cause;
    context.log(`ai scan unavailable: ${cause.message}`);
    return error(503, 'ai_unavailable', 'The free AI is busy right now.');
  }
}

export const aiScanRoute = handler(scan);

app.http('ai-scan', {
  authLevel: 'anonymous',
  methods: ['POST'],
  route: 'ai/scan',
  handler: aiScanRoute,
});
