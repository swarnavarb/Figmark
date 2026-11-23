import { parseToolTags, type CoachAnswer } from '@shared/coach';
import { loadPuter, warmPuter } from './puterVision';

/**
 * The coach's AI chat, through Puter.js - free to Figmark and to the seller.
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
export async function askCoachAi(brief: string, turns: readonly ChatTurn[]): Promise<CoachAnswer> {
  const puter = (await loadPuter()) as unknown as PuterText;
  if (!puter.auth.isSignedIn()) {
    try {
      await puter.auth.signIn({ attempt_temp_user_creation: true });
    } catch {
      throw new Error('Puter sign-in was closed. Sign in to chat with the AI coach, or ask the built-in coach instead.');
    }
  }
  let response: unknown;
  try {
    response = await puter.ai.chat(
      [{ role: 'system', content: brief }, ...turns.slice(-HISTORY)],
      { temperature: 0.4, max_tokens: 600 },
    );
  } catch {
    throw new Error('The AI coach could not answer just now. The built-in coach still can.');
  }
  const answer = parseToolTags(textOf(response));
  if (!answer.text) throw new Error('The AI coach gave an empty answer. Try asking another way.');
  return answer;
}
