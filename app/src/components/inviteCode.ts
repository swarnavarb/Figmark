import { api } from '../api';

/*
 * The signed-in person's invite code, apart from ShareKit so the shell can
 * ask for it early without loading the share cards.
 */

let invite: { userId: string; code: Promise<string | null> } | null = null;

/** The signed-in person's invite code, asked for once and kept. */
export function inviteCodeFor(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return Promise.resolve(null);
  if (invite?.userId !== userId) {
    invite = { userId, code: api.myInvite().then((summary) => summary.code).catch(() => null) };
  }
  return invite.code;
}
