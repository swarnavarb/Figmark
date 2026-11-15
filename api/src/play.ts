import type { Post } from '../../shared/models.js';
import {
  BADGE_META, LAST_CALL_MS, LEADER_POINTS, PLACE_LABELS, VOTE_POINTS_CAP, closestGuess, contestPhase,
  type Badge, type BadgeKind, type ContestWinner, type GameStage, type PlayerRow, type StoreCredit,
} from '../../shared/play.js';
import { actorName, possessive } from '../../shared/notifications.js';
import { rupees } from '../../shared/payments.js';
import { monthKey } from '../../shared/quest.js';
import { percentages } from '../../shared/social.js';
import { referralLeaders, type ReferralPayout } from '../../shared/referral.js';
import { verifiedChecks } from '../../shared/verification.js';
import type { getRepository } from './data/index.js';
import { notify, storeCrew } from './functions/notify.js';

/**
 * Settling the games posts run, and paying what they hand out.
 *
 * Nothing here runs on a clock. Like the debate results before it, a game is
 * settled on the way past - whenever a feed, Discover or the post itself reads
 * it after its time is up - because a game nobody is reading can wait. Every
 * step is marked on the post first, through the same read-change-write a vote
 * uses, so two readers arriving together settle it once, and every payment
 * has an id made from what it pays for, so paying it twice is a no-op.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

const linkOf = (post: Pick<Post, 'channelId' | 'id'>) =>
  `/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`;

const gist = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'the post';
};

/* ── Paying ─────────────────────────────────────────────────────────────── */

export interface Reward {
  credit?: Omit<StoreCredit, 'spentMinor' | 'spends' | 'createdAt'> | null;
  badge?: { id: string; kind: BadgeKind; detail: string; link: string } | null;
}

/**
 * Put store credit and a badge on somebody's account: one read, one write.
 *
 * Idempotent by id, so a settlement retried after a failure part-way pays
 * nobody twice. Returns what was new.
 */
export async function reward(repository: Repo, userId: string, given: Reward): Promise<{ credit: boolean; badge: boolean }> {
  const user = await repository.getUserById(userId);
  if (!user) return { credit: false, badge: false };
  const now = new Date().toISOString();
  const credits = user.storeCredits ?? [];
  const badges = user.badges ?? [];
  const credit = Boolean(given.credit && given.credit.amountMinor > 0 && !credits.some((entry) => entry.id === given.credit!.id));
  const badge = Boolean(given.badge && !badges.some((entry) => entry.id === given.badge!.id));
  if (!credit && !badge) return { credit, badge };
  await repository.updateUser({
    ...user,
    ...(credit ? { storeCredits: [...credits, { ...given.credit!, spentMinor: 0, spends: [], createdAt: now }] } : {}),
    ...(badge ? { badges: [...badges, { ...given.badge!, at: now } satisfies Badge] } : {}),
  });
  return { credit, badge };
}

/**
 * A milestone badge - a first sale, ten accepted answers - put on somebody's
 * page once, and they are told. Ids are fixed per kind, so reaching it again
 * (a sale refunded and made again) awards nothing new.
 */
export async function milestone(
  repository: Repo, userId: string, earned: { kind: BadgeKind; detail: string }, link: string,
): Promise<boolean> {
  const { badge } = await reward(repository, userId, {
    badge: { id: `bdg_${earned.kind}`, kind: earned.kind, detail: earned.detail, link },
  });
  if (badge) {
    await notify(repository, [userId], {
      kind: 'prize_won',
      title: `New badge: ${BADGE_META[earned.kind].emoji} ${BADGE_META[earned.kind].label}`,
      body: `${earned.detail}. It is on your page now.`,
      link,
    });
  }
  return badge;
}

/** "₹500 store credit at Kaiju Imports and a badge" - what a winner is told they got. */
function prizeLine(amountMinor: number, storeName: string | null, note: string | null): string {
  const parts: string[] = [];
  if (amountMinor > 0 && storeName) parts.push(`${rupees(amountMinor)} store credit at ${storeName}`);
  if (note) parts.push(note);
  return parts.length ? parts.join(' + ') : 'a badge for your page';
}

/* ── Competitions ───────────────────────────────────────────────────────── */

/**
 * The audience's top three, by votes; ties go to whoever entered first. An
 * entry with no votes does not place: a podium of nobody's picks is noise.
 */
export function audienceWinners(post: Post): ContestWinner[] {
  const contest = post.contest!;
  const votes = new Map((post.poll?.options ?? []).map((option) => [option.id, option.voterIds.length]));
  const eligible = contest.judging === 'mixed' && contest.shortlist?.length
    ? contest.entries.filter((entry) => contest.shortlist!.includes(entry.id))
    : contest.entries;
  return eligible
    .map((entry, order) => ({ entry, order, votes: votes.get(entry.id) ?? 0 }))
    .filter((row) => row.votes > 0)
    .sort((a, b) => b.votes - a.votes || a.order - b.order)
    .slice(0, 3)
    .map((row, index) => ({
      place: (index + 1) as 1 | 2 | 3,
      entryId: row.entry.id,
      userId: row.entry.userId,
      name: row.entry.name,
      photoUrl: row.entry.photoUrl,
      votes: row.votes,
    }));
}

/**
 * Pay a competition's winners and tell everybody who took part.
 *
 * Called once, by whoever set `settledAt` - the clock for a vote, the shop
 * for its own pick. Credit only for a shop's competition; Figmark's weekly
 * challenge is for the badge.
 */
export async function payContest(repository: Repo, post: Post): Promise<void> {
  const contest = post.contest;
  if (!contest?.winners?.length) return;
  const link = linkOf(post);
  const kind: BadgeKind = contest.host === 'figmark' ? 'challenge_winner' : 'contest_winner';
  for (const winner of contest.winners) {
    const prize = contest.prizes.find((entry) => entry.place === winner.place);
    const amountMinor = contest.host === 'store' && contest.storeId ? prize?.amountMinor ?? 0 : 0;
    await reward(repository, winner.userId, {
      credit: amountMinor > 0 && contest.storeId
        ? {
            id: `prz_${post.id}_${winner.place}`,
            storeId: contest.storeId,
            storeName: contest.hostName,
            amountMinor,
            reason: `${PLACE_LABELS[winner.place]} in ${contest.title}`,
            link,
          }
        : null,
      badge: { id: `bdg_${post.id}_${winner.place}`, kind, detail: `${PLACE_LABELS[winner.place]} in ${contest.title}`, link },
    });
    await notify(repository, [winner.userId], {
      kind: 'prize_won',
      title: `You placed ${PLACE_LABELS[winner.place]} in ${contest.title}!`,
      body: `You won ${prizeLine(amountMinor, contest.hostName, prize?.note || null)}.`,
      link,
    });
  }
  const winnerIds = new Set(contest.winners.map((winner) => winner.userId));
  const top = contest.winners[0]!;
  const others = [...new Set(contest.entries.map((entry) => entry.userId))].filter((id) => !winnerIds.has(id));
  await notify(repository, others, {
    kind: 'contest_update',
    title: `${contest.title}: the winners are in`,
    body: `${top.name} took 1st. Thanks for entering.`,
    link,
  });
  if (post.authorId && !winnerIds.has(post.authorId)) {
    await notify(repository, [post.authorId], {
      kind: 'contest_update',
      title: `${contest.title} has its winners`,
      body: `${contest.winners.map((winner) => `${PLACE_LABELS[winner.place]} ${winner.name}`).join(' · ')}`,
      link,
    });
  }
}

/**
 * Move a competition on: tell entrants voting opened, ask the shop for its
 * shortlist or its pick, and settle an audience vote whose time is up.
 */
async function settleContest(repository: Repo, post: Post, now: number): Promise<void> {
  const contest = post.contest!;
  const link = linkOf(post);
  const entrants = [...new Set(contest.entries.map((entry) => entry.userId))];

  // Entries just closed: once, tell who is waiting on what.
  if (now >= Date.parse(contest.entriesCloseAt) && !contest.votingToldAt) {
    const stamp = new Date(now).toISOString();
    const marked = await repository.mutatePost(post.channelId, post.id, (current) =>
      (!current.contest || current.contest.votingToldAt ? null : { ...current, contest: { ...current.contest, votingToldAt: stamp } }));
    if (marked?.contest?.votingToldAt === stamp) {
      const phase = contestPhase(marked.contest, now);
      if (phase === 'voting') {
        await notify(repository, entrants, {
          kind: 'contest_update', title: `Voting is open: ${contest.title}`, body: 'Entries are closed. Share it so people vote for yours.', link,
        });
      } else if (phase === 'judging' || phase === 'shortlisting') {
        await notify(repository, [post.authorId], {
          kind: 'contest_update',
          title: phase === 'judging' ? `Pick the winners of ${contest.title}` : `Shortlist ${contest.title}`,
          body: `${contest.entries.length} ${contest.entries.length === 1 ? 'entry' : 'entries'} are in.`,
          link,
        });
      }
    }
  }

  // An audience vote whose time is up: count it, once.
  if (contest.judging !== 'store' && !contest.settledAt && now >= Date.parse(contest.endsAt)
    && (contest.judging === 'audience' || contest.shortlist?.length)) {
    const stamp = new Date(now).toISOString();
    const settled = await repository.mutatePost(post.channelId, post.id, (current) => {
      if (!current.contest || current.contest.settledAt) return null;
      return { ...current, contest: { ...current.contest, winners: audienceWinners(current), settledAt: stamp } };
    });
    if (settled?.contest?.settledAt === stamp) await payContest(repository, settled);
  }
}

/* ── Debates ────────────────────────────────────────────────────────────── */

/** The most-liked top-level argument by somebody other than the debate's author. */
export function bestArgument(post: Post) {
  return [...(post.comments ?? [])]
    .filter((comment) => comment.parentId === null && comment.authorId !== post.authorId && !comment.asStore && comment.likedBy.length > 0)
    .sort((a, b) => b.likedBy.length - a.likedBy.length || a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

/** Pay a debate's best argument: a badge, and the shop's credit when it put up a prize. */
export async function payDebate(repository: Repo, post: Post): Promise<void> {
  const best = post.debate?.best;
  if (!best) return;
  const prize = post.debate?.prize ?? null;
  const link = linkOf(post);
  await reward(repository, best.userId, {
    credit: prize && prize.amountMinor > 0
      ? { id: `prz_${post.id}_best`, storeId: prize.storeId, storeName: prize.storeName, amountMinor: prize.amountMinor, reason: `Best argument: ${gist(post.body)}`, link }
      : null,
    badge: { id: `bdg_${post.id}_best`, kind: 'debate_winner', detail: `Best argument: ${gist(post.body)}`, link },
  });
  await notify(repository, [best.userId], {
    kind: 'prize_won',
    title: 'You made the best argument!',
    body: `${gist(post.body)} — you won ${prizeLine(prize?.amountMinor ?? 0, prize?.storeName ?? null, null)}.`,
    link,
  });
}

/**
 * Tell the voters how a closed debate came out, and name its best argument
 * when the likes decide it.
 */
async function settleDebate(repository: Repo, post: Post, nowIso: string): Promise<void> {
  const marked = await repository.mutatePost(post.channelId, post.id, (current) => {
    if (current.resultsSentAt) return null;
    const judgedByLikes = !current.debate?.prize || current.debate.prize.judge === 'likes';
    const top = judgedByLikes && !current.debate?.best ? bestArgument(current) : null;
    return {
      ...current,
      resultsSentAt: nowIso,
      ...(top && current.debate
        ? { debate: { ...current.debate, best: { userId: top.authorId, name: top.authorName, commentId: top.id, side: top.side ?? null } } }
        : {}),
    };
  });
  if (!marked || marked.resultsSentAt !== nowIso) return;
  if (marked.debate?.best && post.debate?.best?.commentId !== marked.debate.best.commentId) await payDebate(repository, marked);

  const options = marked.poll!.options;
  const total = options.reduce((sum, option) => sum + option.voterIds.length, 0);
  if (total === 0) return;
  const ranked = [...options].sort((a, b) => b.voterIds.length - a.voterIds.length);
  const tie = ranked.length > 1 && ranked[0]!.voterIds.length === ranked[1]!.voterIds.length;
  const shares = percentages(options.map((option) => option.voterIds.length));
  const split = options.map((option, index) => `${option.label} ${shares[index]}%`).join(' · ');
  const link = linkOf(marked);
  for (const option of options) {
    const won = !tie && option.id === ranked[0]!.id;
    await notify(repository, option.voterIds.filter((id) => id !== marked.authorId), {
      kind: 'debate_result',
      title: tie ? 'A debate you voted in ended level' : won ? `Your pick won: ${option.label}` : `${ranked[0]!.label} won the debate`,
      body: `${split} — ${gist(marked.body)}`,
      link,
    });
  }
  await notify(repository, [marked.authorId], {
    kind: 'debate_result',
    title: tie ? 'Your debate ended level' : `Your debate closed: ${ranked[0]!.label} won`,
    body: `${split} from ${total} ${total === 1 ? 'vote' : 'votes'}`,
    link,
  });
}

/* ── Polls with a reward ────────────────────────────────────────────────── */

/**
 * Pay a shop's thank-you to the voters of the winning answer: the earliest,
 * up to the number the shop set. A tie pays every leading answer's voters,
 * because none of them picked wrong.
 */
async function payVoters(repository: Repo, post: Post, nowIso: string): Promise<void> {
  const marked = await repository.mutatePost(post.channelId, post.id, (current) =>
    (!current.poll?.reward || current.poll.reward.paidAt ? null : { ...current, poll: { ...current.poll, reward: { ...current.poll.reward, paidAt: nowIso } } }));
  const prize = marked?.poll?.reward;
  if (!marked || !prize || prize.paidAt !== nowIso) return;
  const top = Math.max(0, ...marked.poll!.options.map((option) => option.voterIds.length));
  if (top === 0) return;
  const voters = marked.poll!.options.filter((option) => option.voterIds.length === top)
    .flatMap((option) => option.voterIds)
    .filter((id) => id !== marked.authorId)
    .slice(0, prize.maxVoters);
  const link = linkOf(marked);
  for (const id of voters) {
    await reward(repository, id, {
      credit: { id: `prz_${marked.id}_${id}`, storeId: prize.storeId, storeName: prize.storeName, amountMinor: prize.amountMinor, reason: `Voted for the winner: ${gist(marked.body)}`, link },
    });
  }
  await notify(repository, voters, {
    kind: 'prize_won',
    title: `Your pick won — ${rupees(prize.amountMinor)} from ${prize.storeName}`,
    body: `Store credit for voting in "${gist(marked.body)}". It comes off your next order there.`,
    link,
  });
  await repository.mutatePost(marked.channelId, marked.id, (current) =>
    (current.poll?.reward ? { ...current, poll: { ...current.poll, reward: { ...current.poll.reward, paidCount: voters.length } } } : null));
}

/* ── Guess the price ────────────────────────────────────────────────────── */

async function revealGuess(repository: Repo, post: Post, nowIso: string): Promise<void> {
  const marked = await repository.mutatePost(post.channelId, post.id, (current) => {
    if (!current.guess || current.guess.revealedAt) return null;
    const ranked = closestGuess(current.guess);
    const top = ranked[0];
    const prize = current.guess.prize;
    // The closest are paid at the reveal; a shop that picks does so after.
    const paid = prize && prize.judge === 'closest' && ranked.length
      ? ranked.slice(0, prize.winners).map((entry) => ({ userId: entry.userId, name: entry.name, amountMinor: entry.amountMinor }))
      : null;
    return {
      ...current,
      guess: {
        ...current.guess, revealedAt: nowIso,
        winner: top ? { userId: top.userId, name: top.name, amountMinor: top.amountMinor } : null,
        ...(paid ? { winners: paid, paidAt: nowIso } : {}),
      },
    };
  });
  const guess = marked?.guess;
  if (!marked || !guess || guess.revealedAt !== nowIso) return;
  const link = linkOf(marked);
  if (guess.winner) {
    await reward(repository, guess.winner.userId, {
      badge: { id: `bdg_${marked.id}_guess`, kind: 'guess_winner', detail: `Closest guess: ${gist(marked.body)}`, link },
    });
    if (!guess.prize) {
      await notify(repository, [guess.winner.userId], {
        kind: 'prize_won',
        title: 'Your guess was the closest! 🎯',
        body: `It was ${rupees(guess.answerMinor)}; you said ${rupees(guess.winner.amountMinor)}.`,
        link,
      });
    }
  }
  if (guess.paidAt === nowIso) await payGuess(repository, marked);
  const told = new Set([...(guess.winners ?? []).map((entry) => entry.userId), ...(guess.prize ? [] : [guess.winner?.userId])]);
  const rest = [...new Set(guess.guesses.map((entry) => entry.userId))].filter((id) => !told.has(id));
  await notify(repository, [...rest, marked.authorId], {
    kind: 'contest_update',
    title: `The price is out: ${rupees(guess.answerMinor)}`,
    body: guess.prize?.judge === 'store' && marked.authorId
      ? `${gist(marked.body)} — the shop picks the winner next.`
      : guess.winner ? `${guess.winner.name} got closest — ${gist(marked.body)}` : gist(marked.body),
    link,
  });
}

/** Pay a guess-the-price's prize to everybody it names: idempotent by id, like every payment here. */
export async function payGuess(repository: Repo, post: Post): Promise<void> {
  const guess = post.guess;
  const prize = guess?.prize;
  if (!guess || !prize || !guess.winners?.length) return;
  const link = linkOf(post);
  for (const [index, winner] of guess.winners.entries()) {
    await reward(repository, winner.userId, {
      credit: {
        id: `prz_${post.id}_guess_${winner.userId}`, storeId: prize.storeId, storeName: prize.storeName, amountMinor: prize.amountMinor,
        reason: `${prize.judge === 'store' ? 'Picked guess' : index === 0 ? 'Closest guess' : `#${index + 1} closest guess`}: ${gist(post.body)}`, link,
      },
    });
  }
  await notify(repository, guess.winners.map((winner) => winner.userId), {
    kind: 'prize_won',
    title: `You won ${rupees(prize.amountMinor)} from ${prize.storeName} 🎯`,
    body: `It was ${rupees(guess.answerMinor)}. Store credit for your guess on "${gist(post.body)}" comes off your next order there.`,
    link,
  });
}

/* ── Who hears, and the last call ───────────────────────────────────────── */

/** How far back a purchase still makes somebody one of the shop's buyers. */
const BUYER_WINDOW_MS = 365 * 86_400_000;

/**
 * Who hears about a shop's game: its followers and whoever bought from it in
 * the last year, once each, minus the people who speak for the shop. Three
 * reads, side by side.
 */
export async function gameAudience(repository: Repo, shopId: string): Promise<{ audience: string[]; shopName: string | null }> {
  const since = new Date(Date.now() - BUYER_WINDOW_MS).toISOString();
  const [owner, followers, buyers] = await Promise.all([
    repository.getUserById(shopId),
    repository.listFollowerIds(shopId),
    repository.listBuyerIdsForSeller(shopId, since),
  ]);
  const crew = new Set(owner ? storeCrew(owner, 'posts') : [shopId]);
  return {
    audience: [...new Set([...followers, ...buyers])].filter((id) => !crew.has(id)),
    shopName: owner?.sellerProfile?.storefrontName ?? null,
  };
}

/** "a photo competition: Best shelf" - what a game is, for a notice. */
export function gameWhat(post: Post): string {
  return post.referral ? 'a Spread the word'
    : post.contest ? `a photo competition: ${post.contest.title}`
    : post.guess ? 'a guess-the-price'
      : post.debate ? 'a debate'
        : post.poll?.stock ? 'a poll on what to stock next' : 'a poll';
}

/**
 * The stage of a shop's game whose "ending soon" reminder is due, if one is:
 * within LAST_CALL_MS of its deadline, after it has run at least that long
 * (a short game's announcement is its reminder), and not yet sent.
 */
export function lastCallDue(post: Post, now: number): { stage: GameStage; closesAt: number } | null {
  if (!post.hostShopId) return null;
  const sent = post.lastCalls ?? {};
  const due = (stage: GameStage, opened: number, closesAt: number) =>
    (!sent[stage] && closesAt > now && closesAt - now <= LAST_CALL_MS && now - opened >= LAST_CALL_MS ? { stage, closesAt } : null);
  const created = Date.parse(post.createdAt);
  const contest = post.contest;
  if (contest) {
    if (contest.settledAt) return null;
    const phase = contestPhase(contest, now);
    if (phase === 'entries') return due('entries', created, Date.parse(contest.entriesCloseAt));
    if (phase === 'voting') return due('votes', Date.parse(contest.entriesCloseAt), Date.parse(contest.endsAt));
    return null;
  }
  if (post.referral) {
    const referral = post.referral;
    return referral.settledAt ? null : due('shares', Math.max(created, Date.parse(referral.startsAt)), Date.parse(referral.endsAt));
  }
  if (post.guess) return post.guess.revealedAt ? null : due('guesses', created, Date.parse(post.guess.revealAt));
  if (post.poll?.closesAt) return due('votes', created, Date.parse(post.poll.closesAt));
  return null;
}

/** Who already did what a stage asks: entered, voted, or guessed. */
function doneFor(post: Post, stage: GameStage): Set<string> {
  if (stage === 'entries') return new Set((post.contest?.entries ?? []).map((entry) => entry.userId));
  if (stage === 'guesses') return new Set((post.guess?.guesses ?? []).map((entry) => entry.userId));
  // Anybody can still bring somebody: the reminder goes to everyone who heard it start.
  if (stage === 'shares') return new Set<string>();
  return new Set((post.poll?.options ?? []).flatMap((option) => option.voterIds));
}

const hoursLeft = (ms: number) => {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
};

/**
 * One "ending soon" reminder per stage, to the people who heard the game
 * start and have not played it yet. Stamped on the post first, so two readers
 * arriving together send it once.
 */
async function lastCall(repository: Repo, post: Post, now: number): Promise<void> {
  const due = lastCallDue(post, now);
  if (!due || !post.hostShopId) return;
  const stamp = new Date(now).toISOString();
  const marked = await repository.mutatePost(post.channelId, post.id, (current) =>
    (lastCallDue(current, now)?.stage === due.stage
      ? { ...current, lastCalls: { ...(current.lastCalls ?? {}), [due.stage]: stamp } }
      : null));
  if (marked?.lastCalls?.[due.stage] !== stamp) return;
  const { audience, shopName } = await gameAudience(repository, post.hostShopId);
  const done = doneFor(marked, due.stage);
  const left = audience.filter((id) => !done.has(id) && id !== marked.authorId);
  if (left.length === 0) return;
  const name = actorName(shopName ?? marked.authorName);
  const verb = due.stage === 'entries' ? 'enter' : due.stage === 'guesses' ? 'guess' : due.stage === 'shares' ? 'bring a friend' : 'vote';
  const what = gameWhat(marked);
  await notify(repository, left, {
    kind: 'game_ending',
    title: `${hoursLeft(due.closesAt - now)} left to ${verb}: ${possessive(name)} ${what.replace(/^an? /, '').replace(/:.*$/, '')}`,
    body: marked.contest ? marked.contest.title : gist(marked.body),
    link: linkOf(marked),
    group: {
      key: `ending:${post.hostShopId}`,
      actor: name,
      title: ({ count }) => (count === 1 ? `Closing soon at ${name}` : `${count} things at ${name} close soon`),
    },
  }, { pushLater: left.length > 1 });
}

/* ── Spread the word ────────────────────────────────────────────────────── */

/**
 * Pay a drive whose timer has run out.
 *
 * Each person somebody brought counts once they have verified a phone - an
 * email address costs nothing to make, a WhatsApp number does - and each
 * sharer is paid for at most the shop's cap. Whoever brought the most
 * counted people takes the bonus, if there is one; a tie goes to whoever got
 * there first. Marked settled on the post first, so two readers pay it once;
 * every credit's id is made from the post and the person, so a retry after a
 * failure part-way pays nobody twice.
 */
async function settleReferral(repository: Repo, post: Post, nowIso: string): Promise<void> {
  const marked = await repository.mutatePost(post.channelId, post.id, (current) =>
    (current.referral && !current.referral.settledAt && current.referral.endsAt < nowIso
      ? { ...current, referral: { ...current.referral, settledAt: nowIso } }
      : null));
  if (marked?.referral?.settledAt !== nowIso) return;
  const referral = marked.referral;
  const people = await repository.listUsersByIds([...new Set(referral.joins.map((join) => join.userId))]);
  const verified = new Set(people.filter((person) => verifiedChecks(person).phone && !person.suspended).map((person) => person.id));
  const counted = { ...referral, joins: referral.joins.filter((join) => verified.has(join.userId)) };
  const leaders = referralLeaders(counted);
  const payouts: ReferralPayout[] = leaders.map((row, index) => {
    const joins = Math.min(row.joins, referral.maxPerPerson);
    const top = index === 0 && referral.topPrizeMinor > 0;
    return { userId: row.userId, name: row.name, joins, amountMinor: joins * referral.rewardMinor + (top ? referral.topPrizeMinor : 0), ...(top ? { top } : {}) };
  });
  for (const payout of payouts) {
    if (payout.amountMinor <= 0) continue;
    const { credit } = await reward(repository, payout.userId, {
      credit: {
        id: `ref_${marked.id}_${payout.userId}`,
        storeId: referral.storeId,
        storeName: referral.storeName,
        amountMinor: payout.amountMinor,
        reason: `Brought ${payout.joins} ${payout.joins === 1 ? 'person' : 'people'} to ${referral.storeName}${payout.top ? ' - the most of anyone' : ''}`,
        link: linkOf(marked),
      },
    });
    if (credit) {
      await notify(repository, [payout.userId], {
        kind: 'prize_won',
        title: `${rupees(payout.amountMinor)} store credit at ${referral.storeName} 📣`,
        body: `For the ${payout.joins} ${payout.joins === 1 ? 'person' : 'people'} you brought${payout.top ? ', the most of anyone' : ''}. Spend it there at checkout.`,
        link: linkOf(marked),
      });
    }
  }
  await repository.mutatePost(marked.channelId, marked.id, (current) =>
    (current.referral ? { ...current, referral: { ...current.referral, payouts } } : null));
  const paid = payouts.reduce((sum, row) => sum + row.amountMinor, 0);
  const shop = await repository.getUserById(referral.storeId);
  await notify(repository, shop ? storeCrew(shop, 'posts') : [referral.storeId], {
    kind: 'prize_won',
    title: `Spread the word ended: ${counted.joins.length} new ${counted.joins.length === 1 ? 'buyer' : 'buyers'}`,
    body: paid > 0
      ? `${rupees(paid)} in store credit went to ${payouts.filter((row) => row.amountMinor > 0).length} sharers, spendable at your shop.`
      : referral.joins.length > 0 ? 'Nobody who joined has verified a phone yet, so no credit was paid.' : 'Nobody joined through a link this time.',
    link: linkOf(marked),
  });
}

/* ── On the way past ────────────────────────────────────────────────────── */

/** How many games one read settles at most, so a feed load never turns into a batch job. */
const SETTLE_PER_READ = 6;

/** Whether anything about this post is waiting to be settled. */
export function isDue(post: Post, now: number): boolean {
  const nowIso = new Date(now).toISOString();
  const pollClosed = Boolean(post.poll?.closesAt && post.poll.closesAt < nowIso);
  if (post.debate && pollClosed && !post.resultsSentAt) return true;
  if (post.poll?.reward && pollClosed && !post.poll.reward.paidAt) return true;
  if (post.guess && !post.guess.revealedAt && post.guess.revealAt < nowIso) return true;
  if (post.referral && !post.referral.settledAt && post.referral.endsAt < nowIso) return true;
  if (lastCallDue(post, now)) return true;
  const contest = post.contest;
  if (contest && !contest.settledAt) {
    if (now >= Date.parse(contest.entriesCloseAt) && !contest.votingToldAt) return true;
    if (contest.judging !== 'store' && now >= Date.parse(contest.endsAt)
      && (contest.judging === 'audience' || contest.shortlist?.length)) return true;
  }
  return false;
}

/**
 * Settle whatever among these posts has come due. Returns the ids it touched,
 * so a caller holding the old copies knows which to read again.
 */
export async function settlePlay(recent: readonly Post[], repository: Repo): Promise<Set<string>> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const touched = new Set<string>();
  for (const post of recent.filter((entry) => isDue(entry, now)).slice(0, SETTLE_PER_READ)) {
    touched.add(post.id);
    const pollClosed = Boolean(post.poll?.closesAt && post.poll.closesAt < nowIso);
    if (post.debate && post.poll && pollClosed && !post.resultsSentAt) await settleDebate(repository, post, nowIso);
    if (post.poll?.reward && pollClosed && !post.poll.reward.paidAt) await payVoters(repository, post, nowIso);
    if (post.guess && !post.guess.revealedAt && post.guess.revealAt < nowIso) await revealGuess(repository, post, nowIso);
    if (post.contest && !post.contest.settledAt) await settleContest(repository, post, now);
    if (post.referral && !post.referral.settledAt && post.referral.endsAt < nowIso) await settleReferral(repository, post, nowIso);
    if (lastCallDue(post, now)) await lastCall(repository, post, now);
  }
  return touched;
}

/* ── The clock ──────────────────────────────────────────────────────────── */

/** How many unfinished games one tick looks through. */
const CLOCK_WINDOW = 500;

/**
 * Settle every game that has come due, wherever it is, read or not.
 *
 * Reads settle what they show (settlePlay), but only while someone is reading:
 * a debate closing at 3am told nobody its result until the next visitor came
 * past. The games clock runs this every five minutes. One game that fails is left
 * for the next tick rather than holding up the rest. Returns how many it
 * settled, for the log.
 */
export async function settleDueGames(repository: Repo, now = Date.now()): Promise<number> {
  const open = await repository.listOpenGames(new Date(now).toISOString(), CLOCK_WINDOW);
  let settled = 0;
  for (const post of open.filter((entry) => isDue(entry, now))) {
    try {
      settled += (await settlePlay([post], repository)).size;
    } catch {
      /* Retried next minute. */
    }
  }
  return settled;
}

/* ── The leaderboard ────────────────────────────────────────────────────── */

/** Whether a post is one of the games: a competition, a debate or a guess-the-price. */
export const isGamePost = (post: Post) => Boolean(post.contest || post.debate || post.guess);

/**
 * Points from the games in these posts, for one season (a monthKey, India
 * time), so the board starts again on the 1st like the hobby boards do.
 *
 * - A win counts in the season it was decided in: a competition when it was
 *   settled, a debate when its voters were told, a guess when it was revealed.
 * - A vote counts in the season the game was posted, and only on a game:
 *   a competition's entries or a debate's sides. Vote points stop at
 *   VOTE_POINTS_CAP a season; the votes themselves are still shown.
 */
export function leaderboardOf(posts: readonly Post[], season: string): Map<string, Omit<PlayerRow, 'name' | 'handle'>> {
  const rows = new Map<string, Omit<PlayerRow, 'name' | 'handle'>>();
  const row = (userId: string) => {
    let found = rows.get(userId);
    if (!found) rows.set(userId, (found = { userId, points: 0, wins: 0, votes: 0 }));
    return found;
  };
  const inSeason = (at: string | null | undefined) => Boolean(at) && monthKey(at!) === season;
  const placePoints = { 1: LEADER_POINTS.first, 2: LEADER_POINTS.second, 3: LEADER_POINTS.third } as const;
  const votePoints = new Map<string, number>();
  for (const post of posts) {
    if (!isGamePost(post)) continue;
    if ((post.contest || post.debate) && inSeason(post.createdAt)) {
      for (const option of post.poll?.options ?? []) {
        for (const id of option.voterIds) {
          if (id.startsWith('store:')) continue;
          const entry = row(id);
          entry.votes += 1;
          const earned = votePoints.get(id) ?? 0;
          if (earned < VOTE_POINTS_CAP) {
            entry.points += LEADER_POINTS.vote;
            votePoints.set(id, earned + LEADER_POINTS.vote);
          }
        }
      }
    }
    if (post.contest && inSeason(post.contest.settledAt ?? (post.contest.winners?.length ? post.contest.endsAt : null))) {
      for (const winner of post.contest.winners ?? []) {
        const entry = row(winner.userId);
        entry.points += placePoints[winner.place];
        if (winner.place === 1) entry.wins += 1;
      }
    }
    if (post.debate?.best && inSeason(post.resultsSentAt ?? post.poll?.closesAt ?? post.createdAt)) {
      const entry = row(post.debate.best.userId);
      entry.points += LEADER_POINTS.debate;
      entry.wins += 1;
    }
    if (post.guess?.winner && inSeason(post.guess.revealedAt ?? post.guess.revealAt)) {
      const entry = row(post.guess.winner.userId);
      entry.points += LEADER_POINTS.guess;
      entry.wins += 1;
    }
  }
  for (const [id, entry] of rows) if (entry.points === 0) rows.delete(id);
  return rows;
}

