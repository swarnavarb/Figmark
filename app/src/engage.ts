import { contestPhase } from '@shared/play';
import type { PostCard } from './api';

/*
 * Where a shop's game stands. Read by the Engage screen and by the Sell tab's
 * dashboard, which is not in the Engage chunk and should not pull it in.
 */

/** Whether a game is waiting on the shop: a shortlist, winners, a best argument, a prize to hand over. */
export function waitingOnShop(card: PostCard): string | null {
  const { post, social } = card;
  if (post.contest) {
    const phase = contestPhase(post.contest);
    if (phase === 'shortlisting') return 'Pick the shortlist';
    if (phase === 'judging') return post.contest.entries.length ? 'Pick the winners' : null;
    const owed = post.contest.prizes.filter((prize) => prize.note && post.contest!.winners?.some((winner) => winner.place === prize.place)
      && !(post.contest!.prizeSent ?? []).includes(prize.place));
    if (owed.length) return `Hand over ${owed.length} prize${owed.length === 1 ? '' : 's'}`;
  }
  if (post.debate?.prize?.judge === 'store' && !post.debate.best && social.poll?.closed) return 'Pick the best argument';
  return null;
}

export const isOpen = (card: PostCard) => {
  const { post, social } = card;
  if (post.contest) return contestPhase(post.contest) !== 'ended';
  if (social.guess) return !social.guess.revealed;
  return Boolean(social.poll && !social.poll.closed);
};
