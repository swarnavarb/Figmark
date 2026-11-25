/**
 * The AI relay on the clock app (api/src/ai-relay.ts) and the site sending
 * its free-AI calls through it (AI_RELAY_URL): only with the shared secret,
 * only to the listed AI services, the service's own key passed on and the
 * relay's secret not, and the answer handed back as the service gave it.
 */
import assert from 'node:assert/strict';

process.env.AI_RELAY_SECRET = 'relay-secret';
process.env.AI_RELAY_URL = 'https://clocks.example/api/ai-relay/';
process.env.GEMINI_API_KEY = 'g-key';

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), headers: init.headers, body: init.body });
  return new Response('{"candidates":[{"content":{"parts":[{"text":"[]"}]}}]}', { status: 200, headers: { 'content-type': 'application/json' } });
};

const { relay } = await import(new URL('../api/dist/api/src/ai-relay.js', import.meta.url));
const ask = (host, path, headers = {}, body = '{}') => relay({
  url: `https://clocks.example/api/ai-relay/${host}/${path}?alt=json`,
  params: { host, path },
  headers: new Headers(headers),
  text: async () => body,
});

let r = await ask('generativelanguage.googleapis.com', 'v1beta/models/m:generateContent', { 'x-relay-secret': 'wrong' });
assert.equal(r.status, 403, 'a wrong secret is refused');
r = await ask('evil.example', 'x', { 'x-relay-secret': 'relay-secret' });
assert.equal(r.status, 400, 'only the listed AI services');
assert.equal(calls.length, 0, 'nothing sent for a refused request');

r = await ask('generativelanguage.googleapis.com', 'v1beta/models/m:generateContent',
  { 'x-relay-secret': 'relay-secret', 'x-goog-api-key': 'g-key', 'content-type': 'application/json', cookie: 'nope' }, '{"a":1}');
assert.equal(r.status, 200);
assert.match(r.body, /candidates/);
const sent = calls.at(-1);
assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?alt=json');
assert.equal(sent.headers['x-goog-api-key'], 'g-key');
assert.equal(sent.headers['x-relay-secret'], undefined, 'the relay secret stays here');
assert.equal(sent.headers.cookie, undefined, 'only the content type and the key are passed on');
assert.equal(sent.body, '{"a":1}');

// The site, with AI_RELAY_URL set, sends through the relay.
const ai = await import(new URL('../api/dist/api/src/free-ai.js', import.meta.url));
await ai.scanPhoto({ mimeType: 'image/jpeg', base64: 'AAAA' }).catch(() => undefined);
const viaRelay = calls.at(-1);
assert.equal(viaRelay.url, 'https://clocks.example/api/ai-relay/generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent');
assert.equal(viaRelay.headers['x-relay-secret'], 'relay-secret');
assert.equal(viaRelay.headers['x-goog-api-key'], 'g-key');

delete process.env.AI_RELAY_SECRET;
r = await ask('api.groq.com', 'openai/v1/chat/completions', { 'x-relay-secret': 'relay-secret' });
assert.equal(r.status, 404, 'without a secret set, the relay is not there at all');

console.log('ai relay checks passed');
