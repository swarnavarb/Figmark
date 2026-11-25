import { timingSafeEqual } from 'node:crypto';
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { registerHttpAnyway } from './http-off.js';

/**
 * POST /api/ai-relay/{host}/{*path} - passes one request on to a free AI
 * service, from the clock Function App.
 *
 * Google's Gemini API and Groq refuse requests from Hong Kong, where the
 * Static Web App's API runs ("User location is not supported"). The clock
 * apps run in Central India, which both serve, so the site's free-AI calls
 * (free-ai.ts) go through here when AI_RELAY_URL is set.
 *
 * Not a general proxy: only HTTPS POSTs to the AI services listed below
 * (plus AI_RELAY_EXTRA_HOSTS), and only with the shared AI_RELAY_SECRET.
 * Without that secret set, the route answers 404 to everyone. The service's
 * own key travels with the request and is never stored here.
 */

const HOSTS = new Set([
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'openrouter.ai',
  'api.cerebras.ai',
  'api.mistral.ai',
  'api.cloudflare.com',
  ...(process.env.AI_RELAY_EXTRA_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
]);
/** Headers passed on: the body's type and the service's own key. */
const PASSED = ['content-type', 'authorization', 'x-goog-api-key'];
const MAX_BODY = 4 * 1024 * 1024;
const ANSWER_MS = 35_000;

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const refuse = (status: number, message: string): HttpResponseInit => ({ status, jsonBody: { error: message } });

export async function relay(request: HttpRequest): Promise<HttpResponseInit> {
  const secret = process.env.AI_RELAY_SECRET?.trim();
  if (!secret) return refuse(404, 'not_found');
  if (!sameSecret(request.headers.get('x-relay-secret'), secret)) return refuse(403, 'forbidden');

  const host = (request.params.host ?? '').toLowerCase();
  if (!HOSTS.has(host)) return refuse(400, 'host_not_allowed');
  const path = (request.params.path ?? '').replace(/^\/+/, '');
  const target = new URL(`https://${host}/${path}`);
  if (target.host !== host) return refuse(400, 'host_not_allowed');
  target.search = new URL(request.url).search;

  const body = await request.text();
  if (body.length > MAX_BODY) return refuse(413, 'too_large');
  const headers: Record<string, string> = {};
  for (const name of PASSED) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  let response: Response;
  try {
    response = await fetch(target, { method: 'POST', headers, body, signal: AbortSignal.timeout(ANSWER_MS) });
  } catch (cause) {
    return refuse(502, `could not reach ${host}: ${(cause as Error)?.message ?? cause}`);
  }
  return {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    body: await response.text(),
  };
}

registerHttpAnyway('ai-relay', {
  authLevel: 'anonymous',
  methods: ['POST'],
  route: 'ai-relay/{host}/{*path}',
  handler: relay,
});
