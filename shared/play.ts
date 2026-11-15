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
/** A prize's terms and conditions: optional, on every kind of prize. */
export const PRIZE_TERMS_MAX = 800;
/** Most winners one guess-the-price can pay. */
export const GUESS_MAX_WINNERS = 10;

/** Terms as asked for: trimmed, capped, null when there are none. */
export function termsFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, PRIZE_TERMS_MAX);
  return text || null;
}
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
  /** The prizes' terms and conditions, when the shop set any. */
  terms?: string | null;
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
/**
 * A shop's prize on a guess-the-price: store credit, spent only at that shop.
 *
 * - closest: the `winners` closest guesses each get it at the reveal;
 * - store: the shop picks one guess once the price is out.
 */
export interface GuessPrize {
  storeId: string;
  storeName: string;
  amountMinor: number;
  judge: 'closest' | 'store';
  /** How many of the closest are paid; always 1 when the shop picks. */
  winners: number;
  terms?: string | null;
}

export interface GuessWinner { userId: string; name: string; amountMinor: number }

export interface PostGuess {
  listingId: string | null;
  answerMinor: number;
  revealAt: string;
  guesses: { userId: string; name: string; amountMinor: number; at: string }[];
  revealedAt?: string | null;
  /** The closest guess, decided at reveal; ties go to whoever guessed first. */
  winner?: GuessWinner | null;
  prize?: GuessPrize | null;
  /** Everybody the prize was paid to, closest first. Set once. */
  winners?: GuessWinner[] | null;
  /** When the prize was paid. */
  paidAt?: string | null;
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
  /** The closest, once revealed: three, or as many as the prize pays (and ten to pick from for the shop). */
  closest: { userId?: string; name: string; amountMinor: number }[];
  prize?: { amountMinor: number; storeName: string; judge: GuessPrize['judge']; winners: number; terms?: string | null } | null;
  /** Who the prize went to, once paid. */
  winners?: GuessWinner[] | null;
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
export type GameStage = 'entries' | 'votes' | 'guesses' | 'shares';

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
  /** Who gave it: a shop (absent, as game prizes always were), a forwarder or an artist. */
  kind?: 'shop' | 'forwarder' | 'artist';
  /** Credit a store gave by hand, rather than one won. */
  given?: boolean;
  /**
   * When what is left of it lapses, as the shop set it; absent or null for
   * credit that never does. Nothing has to run to lapse it: every read and
   * every checkout counts lapsed credit as nothing (see `storeCreditLeft`).
   * A refund is never a StoreCredit - money owed back lives on the order and
   * cannot lapse.
   */
  expiresAt?: string | null;
  /** Given by hand as a refund: money owed back, which never lapses. */
  refund?: boolean;
}

/** Whether a credit's time is up. */
export const creditLapsed = (credit: Pick<StoreCredit, 'expiresAt'>, now = Date.now()) =>
  Boolean(credit.expiresAt && Date.parse(credit.expiresAt) <= now);

/** What is left to spend of one credit: nothing once it has lapsed. */
export const storeCreditLeft = (credit: Pick<StoreCredit, 'amountMinor' | 'spentMinor' | 'expiresAt'>, now = Date.now()) =>
  (creditLapsed(credit, now) ? 0 : Math.max(0, credit.amountMinor - credit.spentMinor));

/* ── How long credit lasts ──────────────────────────────────────────────── */

/** The lengths a shop picks from. Null - never lapses - is always offered too. */
export const CREDIT_LIFE_DAYS = [7, 30, 90, 180, 365] as const;
/** The longest a shop may type. */
export const CREDIT_LIFE_MAX_DAYS = 730;

/**
 * A credit life as asked for: a whole number of days, or null for never.
 * Undefined when it is not one - the caller refuses it.
 */
export function creditLifeFrom(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '' || value === 0) return null;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= CREDIT_LIFE_MAX_DAYS ? days : undefined;
}

/** When credit given now lapses, or null for never. */
export function creditExpiry(days: number | null | undefined, from = Date.now()): string | null {
  return days ? new Date(from + days * 86_400_000).toISOString() : null;
}

/** "Lasts 30 days", "Never lapses". */
export function creditLifeLabel(days: number | null | undefined): string {
  if (!days) return 'Never lapses';
  if (days % 365 === 0) return `Lasts ${days / 365} year${days === 365 ? '' : 's'}`;
  return `Lasts ${days} day${days === 1 ? '' : 's'}`;
}

export const BADGE_KINDS = [
  'contest_winner', 'challenge_winner', 'debate_winner', 'guess_winner',
  'first_sale', 'hundred_sales', 'helpful_answer', 'helpful_10', 'helpful_50',
] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

export const BADGE_META: Record<BadgeKind, { emoji: string; label: string }> = {
  contest_winner: { emoji: '🏆', label: 'Competition winner' },
  challenge_winner: { emoji: '🌟', label: 'Weekly challenge winner' },
  debate_winner: { emoji: '🎤', label: 'Debate winner' },
  guess_winner: { emoji: '🎯', label: 'Sharpest guess' },
  first_sale: { emoji: '🛍️', label: 'First sale' },
  hundred_sales: { emoji: '💯', label: '100 sales' },
  helpful_answer: { emoji: '💡', label: 'Best answer' },
  helpful_10: { emoji: '🧠', label: '10 best answers' },
  helpful_50: { emoji: '🎓', label: '50 best answers' },
};

/** Sales that earn a milestone badge, and the badge. */
export const SALE_MILESTONES: { count: number; kind: BadgeKind; detail: string }[] = [
  { count: 1, kind: 'first_sale', detail: 'Made a first sale on Figmark' },
  { count: 100, kind: 'hundred_sales', detail: '100 orders accepted on Figmark' },
];

/** Accepted answers that earn a badge, and the badge. */
export const HELPFUL_MILESTONES: { count: number; kind: BadgeKind; detail: string }[] = [
  { count: 1, kind: 'helpful_answer', detail: 'Picked as the best answer' },
  { count: 10, kind: 'helpful_10', detail: '10 answers picked as the best' },
  { count: 50, kind: 'helpful_50', detail: '50 answers picked as the best' },
];

/**
 * What a badge says it was for. A milestone's words come from the list above
 * rather than what was stored when it was won, so renaming one renames every
 * copy already on someone's page.
 */
export function badgeDetail(badge: Pick<Badge, 'kind' | 'detail'>): string {
  return [...SALE_MILESTONES, ...HELPFUL_MILESTONES].find((each) => each.kind === badge.kind)?.detail ?? badge.detail;
}

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
  /** Place on the board; people level on points and wins share it (1, 2, 2, 4). */
  rank?: number;
}

/** Ranks rows already sorted by points then wins, ties sharing a place. */
export function rankPlayers<T extends { points: number; wins: number }>(sorted: readonly T[]): (T & { rank: number })[] {
  let rank = 0;
  return sorted.map((row, index) => {
    const prev = sorted[index - 1];
    if (!prev || prev.points !== row.points || prev.wins !== row.wins) rank = index + 1;
    return { ...row, rank };
  });
}

/** Points on the leaderboard: a win is worth far more than a vote, but voting is how most people play. */
export const LEADER_POINTS = { first: 10, second: 6, third: 4, debate: 5, guess: 5, vote: 1 } as const;
/**
 * Most points votes can earn one person in a season. Votes only count on the
 * games themselves (a competition's entries, a debate's sides), never on an
 * ordinary poll, and this cap keeps a pile of polls and friends from buying a
 * place: past it, only winning moves you up.
 */
export const VOTE_POINTS_CAP = 30;
