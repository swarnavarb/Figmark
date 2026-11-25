/**
 * The free-tier AI seam (api/src/free-ai.ts) against a stand-in fetch: what
 * is sent to each kind of service, each request going to the service with
 * the most of today's budget left, chats sparing the photo readers, a
 * service over its budget or rested after a 429 being left alone, and new
 * services added from FREE_AI_<n>_* settings alone.
 */
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'g-key'; process.env.GEMINI_DAILY_LIMIT = '4';
process.env.GROQ_API_KEY = 'q-key'; process.env.GROQ_DAILY_LIMIT = '4';
process.env.FREE_AI_1_URL = 'https://openrouter.example/api/v1/'; process.env.FREE_AI_1_KEY = 'o-key';
process.env.FREE_AI_1_MODEL = 'some/vision-model:free'; process.env.FREE_AI_1_NAME = 'OpenRouter';
process.env.FREE_AI_1_VISION = 'on'; process.env.FREE_AI_1_DAILY = '2';
process.env.FREE_AI_3_URL = 'https://incomplete.example'; // no key or model: ignored

const calls = [];
const replies = {};
const who = (url) => (url.includes('groq') ? 'groq' : url.includes('openrouter') ? 'openrouter' : 'gemini');
globalThis.fetch = async (url, init) => {
  const provider = who(url);
  calls.push({ provider, url, headers: init.headers, body: JSON.parse(init.body) });
  const reply = replies[provider];
  if (reply === 429) return new Response('{"error":{"message":"Rate limit reached on requests per day (RPD)"}}', { status: 429 });
  if (reply === 500) return new Response('oops', { status: 500 });
  if (provider === 'gemini') return Response.json({ candidates: [{ content: { parts: [{ text: '[{"label":"x","box_2d":[0,0,500,500]}]' }] } }] });
  return Response.json({ choices: [{ message: { content: `answer from ${provider}` } }] });
};

const { config } = await import(new URL('../api/dist/api/src/config.js', import.meta.url));
const ai = await import(new URL('../api/dist/api/src/free-ai.js', import.meta.url));
const ids = (list) => list.map((p) => p.id);
const chat = () => ai.coachChat('brief', [{ role: 'user', content: 'hi' }]);
const scan = () => ai.scanPhoto({ mimeType: 'image/jpeg', base64: 'AAAA' });

assert.deepEqual(ids(config.freeAi), ['gemini', 'groq', 'openrouter'], 'two presets and one numbered extra; the incomplete one left out');
assert.equal(config.freeAi[2].url, 'https://openrouter.example/api/v1/chat/completions');

// A chat goes to the chat-only service first, sparing the photo readers.
let r = await chat();
assert.equal(r.provider, 'groq');
const groqCall = calls.at(-1);
assert.equal(groqCall.headers.authorization, 'Bearer q-key');
assert.equal(groqCall.body.reasoning_effort, 'low');
assert.deepEqual(groqCall.body.messages.map((m) => m.role), ['system', 'user']);

// Scans only ever go to photo readers, the one with the most budget left first.
assert.deepEqual(ids(await ai.plan('scan')), ['gemini', 'openrouter']);
r = await scan();
assert.equal(r.provider, 'gemini');
assert.equal(calls.at(-1).headers['x-goog-api-key'], 'g-key');
assert.equal(calls.at(-1).body.generationConfig.responseMimeType, 'application/json');
assert.ok(calls.at(-1).body.contents[0].parts[0].inline_data, 'the photo goes with the prompt');
// gemini 1/4 used (75% left) against openrouter 0/2 (100%): openrouter is next.
r = await scan();
assert.equal(r.provider, 'openrouter');
const image = calls.at(-1).body.messages[0].content.find((part) => part.type === 'image_url');
assert.equal(image.image_url.url, 'data:image/jpeg;base64,AAAA', 'an OpenAI-style service gets the photo as an image_url');

// Budgets are never passed: six scans fill gemini (4) and openrouter (2) between them.
for (let n = 0; n < 4; n += 1) await scan();
const usage = Object.fromEntries((await ai.freeAiUsage()).map((s) => [s.id, s.used]));
assert.deepEqual(usage, { gemini: 4, groq: 1, openrouter: 2 }, JSON.stringify(usage));
const before = calls.length;
await assert.rejects(scan(), ai.AiUnavailable);
assert.equal(calls.length, before, 'over budget: nothing is sent');

// A failing service passes the request to the next; a 429 rests it for the day.
const { getRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));
await (await getRepository()).deleteSiteContent('free-ai-usage');
ai.resetFreeAi();
replies.groq = 429;
const stillChat = await chat();
assert.notEqual(stillChat.provider, 'groq');
assert.ok(!ids(await ai.plan('chat')).includes('groq'), 'groq rests until midnight Pacific');

// Days are counted in California, where the free plans reset.
const evening = Date.parse('2026-11-24T20:00:00Z');
assert.equal(new Date(ai.nextPacificMidnight(evening)).toISOString(), '2026-11-25T08:00:00.000Z');
assert.equal(ai.pacificDay(Date.parse('2026-11-25T07:59:00Z')), '2026-11-24');

console.log('free-ai checks passed');
