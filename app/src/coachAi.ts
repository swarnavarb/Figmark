import { parseToolTags, type CoachAnswer } from '@shared/coach';
import { ApiRequestError, api } from './api';
import { PuterFailed, notePuterTrouble, puterReady, puterSpent, puterWorthAsking, warmPuter } from './puterVision';

/**
 * The coach's AI chat - free to Figmark and to the seller.
 *
 * First through Puter.js, on the seller's own free Puter account, which
 * costs the site nothing. When they close Puter's sign-in or their Puter
 * allowance is spent, the site's own free-tier keys answer instead (POST
 * /api/me/coach/chat; the server builds the brief from the shop's counts),
 * and Puter is left alone for a while so nobody is asked again and again.
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
  if (puterWorthAsking()) {
    try {
      return await askPuter(brief, recent);
    } catch (error) {
      notePuterTrouble(error);
    }
  }
  let reply: { text: string };
  try {
    reply = await within(api.coachChat(storeId, recent), ANSWER_MS, 'timeout');
  } catch (err) {
    // Refused for this seller (Pro only, not their shop, too many today): say why.
    if (err instanceof ApiRequestError && [401, 403, 429].includes(err.status)) throw new Error(`${err.message} Figgy has answered instead.`);
    throw new Error('The AI chat is used up for today - Figgy has answered instead.');
  }
  const answer = parseToolTags(reply.text);
  if (!answer.text) throw new Error('The AI chat gave an empty answer - Figgy has answered instead.');
  return answer;
}

async function askPuter(brief: string, turns: readonly ChatTurn[]): Promise<CoachAnswer> {
  const puter = (await puterReady(LOAD_MS, SIGN_IN_MS)) as unknown as PuterText;
  let response: unknown;
  try {
    response = await within(puter.ai.chat(
      [{ role: 'system', content: brief }, ...turns],
      { temperature: 0.4, max_tokens: 600 },
    ), ANSWER_MS, 'timeout');
  } catch (error) {
    throw new PuterFailed(puterSpent(error) ? 'spent' : 'broken', 'Puter could not answer.');
  }
  const answer = parseToolTags(textOf(response));
  if (!answer.text) throw new PuterFailed('broken', 'Puter gave an empty answer.');
  return answer;
}
