import { parseToolTags, type CoachAnswer } from '@shared/coach';
import { ApiRequestError, api } from './api';
import { loadPuter, warmPuter } from './puterVision';

/**
 * The coach's AI chat - free to Figmark and to the seller.
 *
 * First on the site's own free-tier keys (POST /api/me/coach/chat): no
 * sign-in at all, and the server builds the brief itself from the shop's
 * counts. When those keys are not set, or the shared free day is used up,
 * it falls back to Puter.js.
 *
 * The same seam as "Scan with AI" (puterVision.ts): Puter's "user pays"
 * model means no key here and no bill for the site. The seller signs in to
 * their own free Puter account the first time, in Puter's own window, which
 * may only be opened from a tap - so `askCoachAi` is only ever called from
 * the Send button.
 *
 * What the model is told about the shop is `coachBrief` (shared/coach.ts):
 * the same counts the panel shows, nothing more - no buyer's name, no
 * message, no address leaves the app.
 */

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

interface PuterText {
  auth: { isSignedIn: () => boolean; signIn: (options?: { attempt_temp_user_creation?: boolean }) => Promise<unknown> };
  ai: { chat: (messages: { role: string; content: string }[], options?: { model?: string; temperature?: number; max_tokens?: number }) => Promise<unknown> };
}

/** How many earlier turns go with each question: enough for "and that one?", short enough to stay quick. */
const HISTORY = 8;
/*
 * Every wait on Puter has an end. Its script, its sign-in window and its
 * answer each arrive from someone else's servers, and a promise that never
 * settles left the chat "writing" for good - Send did nothing, and the chat
 * looked frozen. Past these, the seller gets Figgy's answer instead.
 */
const LOAD_MS = 20_000;
const SIGN_IN_MS = 120_000;
const ANSWER_MS = 45_000;

/** The promise, or a rejection with this message once `ms` have passed. */
function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => window.clearTimeout(timer));
}

export { warmPuter as warmCoachAi };

function textOf(response: unknown): string {
  if (typeof response === 'string') return response;
  const content = (response as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : (part as { text?: string })?.text ?? '')).join('');
  return String(response ?? '');
}

/**
 * The model's answer to the last turn, with its tool tags turned into
 * buttons. Rejects with a sentence to show when it cannot answer.
 */
export async function askCoachAi(storeId: string, brief: string, turns: readonly ChatTurn[]): Promise<CoachAnswer> {
  const recent = turns.slice(-HISTORY);
  try {
    const reply = await within(api.coachChat(storeId, recent), ANSWER_MS, 'timeout');
    const answer = parseToolTags(reply.text);
    if (answer.text) return answer;
  } catch (err) {
    // Refused for this seller (Pro only, or not their shop): Puter would be no different.
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
      throw new Error(`${err.message} Figgy has answered instead.`);
    }
    // Otherwise the free keys are off or busy: Puter, on the seller's own account, is next.
  }
  return askPuter(brief, recent);
}

async function askPuter(brief: string, turns: readonly ChatTurn[]): Promise<CoachAnswer> {
  const puter = (await within(loadPuter(), LOAD_MS, 'Puter AI did not load. Check your connection - Figgy has answered instead.')) as unknown as PuterText;
  if (!puter.auth.isSignedIn()) {
    try {
      await within(puter.auth.signIn({ attempt_temp_user_creation: true }), SIGN_IN_MS, 'timeout');
    } catch {
      throw new Error('Puter sign-in was closed or did not finish. Sign in to use Puter AI - Figgy has answered instead.');
    }
  }
  let response: unknown;
  try {
    response = await within(puter.ai.chat(
      [{ role: 'system', content: brief }, ...turns],
      { temperature: 0.4, max_tokens: 600 },
    ), ANSWER_MS, 'timeout');
  } catch {
    throw new Error('Puter AI took too long or could not answer - Figgy has answered instead.');
  }
  const answer = parseToolTags(textOf(response));
  if (!answer.text) throw new Error('Puter AI gave an empty answer - Figgy has answered instead.');
  return answer;
}
