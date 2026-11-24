/**
 * The free-tier AI seam (api/src/free-ai.ts) against a stand-in fetch: what
 * is sent to Groq and Gemini, Groq falling back to Gemini, and a provider
 * whose free day is spent being left alone until midnight in California.
 */
import assert from 'node:assert/strict';
process.env.GEMINI_API_KEY = 'g-key'; process.env.GROQ_API_KEY = 'q-key';
const calls = []; let mode = {};
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body); calls.push({ url, headers: init.headers, body });
  const p = url.includes('groq') ? 'groq' : 'gemini';
  if (mode[p] === 429) return new Response('{"error":{"message":"Rate limit reached on requests per day (RPD)"}}', { status: 429 });
  if (p === 'groq') return Response.json({ choices: [{ message: { content: 'Post on WhatsApp [[tool:share]]' } }] });
  return Response.json({ candidates: [{ content: { parts: [{ text: '[{"label":"x","box_2d":[0,0,500,500]}]' }] } }] });
};
const ai = await import(new URL('../api/dist/api/src/free-ai.js', import.meta.url));
let r = await ai.coachChat('brief', [{ role: 'user', content: 'hi' }]);
assert.equal(r.model, 'openai/gpt-oss-120b'); assert.equal(calls[0].body.reasoning_effort, 'low'); assert.equal(calls[0].headers.authorization, 'Bearer q-key');
assert.equal(calls[0].body.messages[0].role, 'system');
mode.groq = 429;
r = await ai.coachChat('brief', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'more' }]);
assert.equal(r.model, 'gemini-flash-lite-latest');
const g = calls.at(-1); assert.equal(g.headers['x-goog-api-key'], 'g-key'); assert.deepEqual(g.body.contents.map((c) => c.role), ['user', 'model', 'user']); assert.equal(g.body.systemInstruction.parts[0].text, 'brief');
const before = calls.length; await ai.coachChat('b', [{ role: 'user', content: 'x' }]);
assert.equal(calls.length, before + 1, 'groq rests for the day: only gemini asked');
r = await ai.scanPhoto({ mimeType: 'image/jpeg', base64: 'AAAA' });
assert.match(r.text, /box_2d/); assert.equal(calls.at(-1).body.generationConfig.responseMimeType, 'application/json');
mode.gemini = 429;
await assert.rejects(ai.scanPhoto({ mimeType: 'image/jpeg', base64: 'AAAA' }), ai.AiUnavailable);
const n = calls.length; await assert.rejects(ai.coachChat('b', [{ role: 'user', content: 'x' }]), ai.AiUnavailable); assert.equal(calls.length, n, 'both resting: no calls');
const now = Date.parse('2026-11-24T20:00:00Z'); const mid = ai.nextPacificMidnight(now);
assert.equal(new Date(mid).toISOString(), '2026-11-25T08:00:00.000Z');
console.log('free-ai checks passed');
