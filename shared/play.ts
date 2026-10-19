/**
 * The games a post can be: a photo competition, a guess-the-price, and what
 * they hand out - store credit and badges.
 *
 * Kept apart from social.ts because they have their own clock (a competition
 * moves through phases; a guess is sealed until it is revealed) and their own
 * vocabulary, and both sides must agree on every phase boundary: a button the
 * app offers and the API refuses is a broken promise.
 *
 * Figmark holds no prize. A prize is store credit: the winner's wallet says
 * they have it, and it is spent at that shop's checkout, the same way credit
 * a shop kept from an earlier order is.
 */

/* ── Photo competitions ─────────────────────────────────────────────────── */

/**
 * Who picks the winners.
 *
 * - audience: everybody votes on the entries, as a photo poll;
 * - store: the shop running it picks;
 * - mixed: the shop shortlists, then everybody votes on the shortlist.
 */
export const CONTEST_JUDGING = ['audience', 'store', 'mixed'] as const;
export type ContestJudging = (typeof CONTEST_JUDGING)[number];

export const JUDGING_LABELS: Record<ContestJudging, string> = {
  audience: 'Audience vote',
  store: 'Store decides',
  mixed: 'Store shortlist, then audience vote',
};

export function isJudging(value: unknown): value is ContestJudging {
  return typeof value === 'string' && (CONTEST_JUDGING as readonly string[]).includes(value);
}

/** Caps, enforced by the API and shown by the app. */
export const CONTEST_MAX_ENTRIES = 120;
export const CONTEST_MAX_PRIZES = 3;
export const CONTEST_TITLE_MAX = 80;
export const CONTEST_RULES_MAX = 600;
export const CONTEST_CAPTION_MAX = 140;
export const PRIZE_NOTE_MAX = 80;
/** A shortlist has to leave something to vote between, and not be the whole field. */
export const SHORTLIST_MIN = 2;
export const SHORTLIST_MAX = 12;
/** Most store credit one prize can be, in paise: a typo of a zero should not be a ₹1,00,000 promise. */
export const PRIZE_MAX_MINOR = 5_000_000;
/** Shortest and longest each phase can run, in hours. */
export const PHASE_MIN_HOURS = 1;
export const PHASE_MAX_HOURS = 24 * 30;

/** One prize: store credit, a line describing anything else, or both. */
export interface ContestPrize {
  place: 1 | 2 | 3;
  /** Store credit, in paise. Zero when the prize is only the note. */
  amountMinor: number;
  /** "Signed print", "Free shipping on your next order" - whatever the shop is giving. */
  note: string;
}

export interface ContestEntry {
  id: string;
  userId: string;
  name: string;
  photoUrl: string;
  caption: string;
  at: string;
}

/** A winner, as stored once decided. */
export interface ContestWinner {
  place: 1 | 2 | 3;
  entryId: string;
  userId: string;
  name: string;
  photoUrl: string;
  votes: number | null;
}

/**
 * A competition, as stored on the post that runs it.
 *
 * The entries live on the post itself rather than as posts of their own: the
 * competition is read whole every time it is shown, a separate post per entry
 * would be a read per entry, and the audience vote is the post's own poll,
 * whose answers are the entries.
 */
export interface PostContest {
  /** A shop's competition, or Figmark's weekly theme challenge. */
  host: 'store' | 'figmark';
  storeId: string | null;
  hostName: string;
  title: string;
  rules: string;
  /** Entries are taken until here; then voting or judging starts. */
  entriesCloseAt: string;
  /** Voting stops, and winners are settled, here. */
  endsAt: string;
  judging: ContestJudging;
  prizes: ContestPrize[];
  entries: ContestEntry[];
  /** Mixed judging: the entries the shop put through to the vote. */
  shortlist?: string[] | null;
  winners?: ContestWinner[] | null;
  /** When the winners were paid and told. Set once. */
  settledAt?: string | null;
  /** When entrants were told entries closed and voting is open. Set once. */
  votingToldAt?: string | null;
  /** Prizes that are not credit, marked handed over by the shop. */
  prizeSent?: number[];
}

/**
 * Where a competition is.
 *
 * - entries: taking photos;
 * - shortlisting: mixed judging, entries closed, waiting on the shop's shortlist;
 * - voting: everybody votes (audience, or mixed once shortlisted);
 * - judging: the shop decides (store judging, entries closed, no winners yet);
 * - ended: winners decided.
 */
export type ContestPhase = 'entries' | 'shortlisting' | 'voting' | 'judging' | 'ended';

export function contestPhase(contest: Pick<PostContest, 'entriesCloseAt' | 'endsAt' | 'judging' | 'shortlist' | 'winners'>, now = Date.now()): ContestPhase {
  if (contest.winners?.length) return 'ended';
  if (now < Date.parse(contest.entriesCloseAt)) return 'entries';
  if (contest.judging === 'store') return 'judging';
  if (contest.judging === 'mixed' && !contest.shortlist?.length) return 'shortlisting';
  if (now < Date.parse(contest.endsAt)) return 'voting';
  // Voting has stopped and nothing is settled yet: counted on the next read.
  return 'ended';
}

export const PLACE_LABELS: Record<1 | 2 | 3, string> = { 1: '1st', 2: '2nd', 3: '3rd' };
export const PLACE_MEDALS: Record<1 | 2 | 3, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** A competition as the app reads it: everything but what is the server's alone. */
export interface ContestView extends Omit<PostContest, 'entries'> {
  entries: ContestEntry[];
  phase: ContestPhase;
  /** This viewer's own entry, if they entered. */
  myEntryId: string | null;
  /** Whether this viewer runs it, and so shortlists and picks. */
  mine: boolean;
}

/* ── Guess the price ────────────────────────────────────────────────────── */

export const GUESS_MAX_MINOR = 100_000_000;

/**
 * A guess-the-price, as stored. The answer is sealed: it never leaves the API
 * until `revealAt`, and neither do anybody's guesses, so nobody can read the
 * room before they guess.
 */
export interface PostGuess {
  listingId: string | null;
  answerMinor: number;
  revealAt: string;
  guesses: { userId: string; name: string; amountMinor: number; at: string }[];
  revealedAt?: string | null;
  /** The closest guess, decided at reveal; ties go to whoever guessed first. */
  winner?: { userId: string; name: string; amountMinor: number } | null;
}

/** A guess as the app reads it. */
export interface GuessView {
  listingId: string | null;
  revealAt: string;
  count: number;
  mine: number | null;
  revealed: boolean;
  /** Only once revealed. */
  answerMinor: number | null;
  winner: PostGuess['winner'] | null;
  /** The three closest, once revealed. */
  closest: { name: string; amountMinor: number }[];
}

/** The guess nearest the answer; ties go to the earliest. */
export function closestGuess(guess: Pick<PostGuess, 'answerMinor' | 'guesses'>) {
  return [...guess.guesses]
    .sort((a, b) => Math.abs(a.amountMinor - guess.answerMinor) - Math.abs(b.amountMinor - guess.answerMinor)
      || a.at.localeCompare(b.at));
}

/* ── Last call ──────────────────────────────────────────────────────────── */

/**
 * What a game is still waiting on people to do: enter a competition, vote,
 * or guess. Each gets one "ending soon" reminder, stamped on the post.
 */
export type GameStage = 'entries' | 'votes' | 'guesses';

/** How close to the deadline the reminder goes out, and how long a stage must have run first. */
export const LAST_CALL_MS = 6 * 3_600_000;

/* ── What the games hand out ────────────────────────────────────────────── */

/**
 * Store credit somebody won: spendable at that shop only, taken off their
 * next order there at checkout, oldest first.
 */
export interface StoreCredit {
  /** Made from what it was won for, so paying the same prize twice is a no-op. */
  id: string;
  storeId: string;
  storeName: string;
  amountMinor: number;
  spentMinor: number;
  reason: string;
  link: string;
  createdAt: string;
  spends: { orderId: string; itemName: string; amountMinor: number; at: string }[];
}

export const storeCreditLeft = (credit: Pick<StoreCredit, 'amountMinor' | 'spentMinor'>) =>
  Math.max(0, credit.amountMinor - credit.spentMinor);

export const BADGE_KINDS = ['contest_winner', 'challenge_winner', 'debate_winner', 'guess_winner'] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

export const BADGE_META: Record<BadgeKind, { emoji: string; label: string }> = {
  contest_winner: { emoji: '🏆', label: 'Competition winner' },
  challenge_winner: { emoji: '🌟', label: 'Weekly challenge winner' },
  debate_winner: { emoji: '🎤', label: 'Debate winner' },
  guess_winner: { emoji: '🎯', label: 'Sharpest guess' },
};

export interface Badge {
  /** Made from what it was won for, so awarding twice is a no-op. */
  id: string;
  kind: BadgeKind;
  /** What exactly: "1st in Best custom paint job". */
  detail: string;
  link: string;
  at: string;
}

/** One row of the leaderboard. */
export interface PlayerRow {
  userId: string;
  name: string;
  handle: string | null;
  points: number;
  wins: number;
  votes: number;
}

/** Points on the leaderboard: a win is worth far more than a vote, but voting is how most people play. */
export const LEADER_POINTS = { first: 10, second: 6, third: 4, debate: 5, guess: 5, vote: 1 } as const;
