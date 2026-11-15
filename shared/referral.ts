/**
 * Spread the word: a shop pays store credit to whoever brings it new buyers
 * from outside Figmark, for a set time.
 *
 * A shop posts one, optionally tied to a live drop or a listing - before the
 * drop to fill the room, during it, or after it to sell what is left. Anybody
 * who takes part gets their own link to the shop, the drop or the item; a
 * brand-new account made through that link while the drive is open counts for
 * them. When the timer runs out each sharer is paid the shop's credit per
 * person they brought, up to the shop's cap, and the one who brought the most
 * can win a bonus on top.
 *
 * Only people the server saw sign up count, and only once they have verified
 * a phone: an email address costs nothing to make, a WhatsApp number does.
 * Like every prize here, the credit is spent at that shop only.
 */

/** What the drive sends people to. */
export type ReferralTarget =
  | { kind: 'shop' }
  | { kind: 'drop'; saleId: string; name: string }
  | { kind: 'listing'; listingId: string; title: string };

/**
 * When it runs, against what it is tied to.
 *
 * - now: from posting, for the length the shop picked;
 * - before: from posting until the drop's first item goes out;
 * - during: while the drop runs, from its first item to its last window;
 * - after: from the end of the drop, for the length the shop picked.
 */
export const REFERRAL_TIMINGS = ['now', 'before', 'during', 'after'] as const;
export type ReferralTiming = (typeof REFERRAL_TIMINGS)[number];

export const TIMING_LABELS: Record<ReferralTiming, string> = {
  now: 'Starting now',
  before: 'Before the drop',
  during: 'During the drop',
  after: 'After the drop',
};

export function isReferralTiming(value: unknown): value is ReferralTiming {
  return typeof value === 'string' && (REFERRAL_TIMINGS as readonly string[]).includes(value);
}

/** Caps, enforced by the API and shown by the app. */
export const REFERRAL_MAX_PER_PERSON = 50;
export const REFERRAL_DEFAULT_PER_PERSON = 5;
/** Shortest and longest a drive runs, in hours. */
export const REFERRAL_MIN_HOURS = 1;
export const REFERRAL_MAX_HOURS = 24 * 30;
/** How many sharers the leaderboard on the post shows. */
export const REFERRAL_LEADERS = 5;
/** Most joins and sharers kept on one post: a drive is a burst, not a ledger. */
export const REFERRAL_MAX_JOINS = 2000;
export const REFERRAL_MAX_SHARERS = 2000;

/** One person who took a link. */
export interface ReferralSharer {
  userId: string;
  name: string;
  at: string;
}

/** A brand-new account that came through somebody's link while it was open. */
export interface ReferralJoin {
  /** The new account. */
  userId: string;
  /** Whose link it came through. */
  sharerId: string;
  at: string;
}

/**
 * A goal everyone works towards together: when the drive brings this many new
 * buyers, it unlocks for everyone who helped. The shop decides what it gives -
 * store credit to each person who brought at least one, a perk it writes
 * itself (a mystery item, early access, free shipping), or both.
 */
export interface ReferralMilestone {
  /** New buyers the whole drive has to bring. */
  at: number;
  /** Store credit for each person who brought at least one, in paise. Zero for none. */
  creditMinor: number;
  /** What else unlocks, in the shop's words. Empty for none. */
  perk: string;
}

export const REFERRAL_MAX_MILESTONES = 3;
export const REFERRAL_MILESTONE_MAX_AT = 1000;
export const REFERRAL_PERK_MAX = 80;
/** Perks a shop can start from; it can write its own. */
export const PERK_IDEAS = [
  'A mystery item added to the drop',
  'The drop opens 15 minutes early for sharers',
  'Free shipping on the drop',
  '10% off the whole drop for everyone',
] as const;

/** Goals as asked for: sane, in order, each a step past the last; null when one is wrong. */
export function milestonesFrom(raw: unknown, maxCreditMinor: number): ReferralMilestone[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > REFERRAL_MAX_MILESTONES) return null;
  const out: ReferralMilestone[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    const at = Number(entry?.at);
    const creditMinor = entry?.creditMinor === undefined || entry?.creditMinor === null || entry?.creditMinor === '' ? 0 : Number(entry.creditMinor);
    const perk = typeof entry?.perk === 'string' ? entry.perk.trim().slice(0, REFERRAL_PERK_MAX) : '';
    if (!Number.isInteger(at) || at < 1 || at > REFERRAL_MILESTONE_MAX_AT) return null;
    if (!Number.isInteger(creditMinor) || creditMinor < 0 || creditMinor > maxCreditMinor) return null;
    if (creditMinor === 0 && !perk) return null;
    out.push({ at, creditMinor, perk });
  }
  out.sort((a, b) => a.at - b.at);
  if (out.some((entry, index) => index > 0 && entry.at === out[index - 1]!.at)) return null;
  return out;
}

/** What a sharer was paid when the drive ended. */
export interface ReferralPayout {
  userId: string;
  name: string;
  /** People they brought who counted: verified, within their cap. */
  joins: number;
  amountMinor: number;
  /** Brought the most and took the bonus. */
  top?: boolean;
  /** Of `amountMinor`, what the goals reached paid them. */
  goalsMinor?: number;
}

/** A drive, as stored on the post that runs it. */
export interface PostReferral {
  storeId: string;
  storeName: string;
  /** The shop's handle, for links to its page. */
  storeHandle: string | null;
  target: ReferralTarget;
  timing: ReferralTiming;
  /** Joins count from here... */
  startsAt: string;
  /** ...until here, and then it is paid. */
  endsAt: string;
  /** Store credit per person brought, in paise. */
  rewardMinor: number;
  /** Most people one sharer is paid for. */
  maxPerPerson: number;
  /** Extra credit for whoever brought the most. Zero for none. */
  topPrizeMinor: number;
  /** Store credit each new buyer gets for joining through a link, in paise. Zero for none. */
  welcomeMinor?: number;
  /** Goals the whole drive works towards together, in order. */
  milestones?: ReferralMilestone[];
  /** When each goal was first reached, by index, so everybody is told once. */
  reached?: (string | null)[];
  /** New buyers who counted when it was paid: verified, the number goals were judged on. */
  counted?: number | null;
  terms?: string | null;
  sharers: ReferralSharer[];
  joins: ReferralJoin[];
  /** Set once, when it was paid out. */
  settledAt?: string | null;
  payouts?: ReferralPayout[] | null;
}

export type ReferralPhase = 'soon' | 'open' | 'ended';

export function referralPhase(referral: Pick<PostReferral, 'startsAt' | 'endsAt' | 'settledAt'>, now = Date.now()): ReferralPhase {
  if (referral.settledAt || now >= Date.parse(referral.endsAt)) return 'ended';
  return now < Date.parse(referral.startsAt) ? 'soon' : 'open';
}

/** How many people each sharer brought, most first; ties go to whoever got there first. */
export function referralLeaders(referral: Pick<PostReferral, 'joins' | 'sharers'>): { userId: string; name: string; joins: number }[] {
  const counts = new Map<string, { joins: number; last: string }>();
  for (const join of referral.joins) {
    const row = counts.get(join.sharerId) ?? { joins: 0, last: join.at };
    counts.set(join.sharerId, { joins: row.joins + 1, last: join.at > row.last ? join.at : row.last });
  }
  const names = new Map(referral.sharers.map((sharer) => [sharer.userId, sharer.name]));
  return [...counts.entries()]
    .map(([userId, row]) => ({ userId, name: names.get(userId) ?? 'Someone', joins: row.joins, last: row.last }))
    .sort((a, b) => b.joins - a.joins || a.last.localeCompare(b.last))
    .map(({ last: _last, ...row }) => row);
}

/** A drive as one viewer sees it. */
export interface ReferralView {
  storeId: string;
  storeName: string;
  storeHandle: string | null;
  target: ReferralTarget;
  timing: ReferralTiming;
  startsAt: string;
  endsAt: string;
  rewardMinor: number;
  maxPerPerson: number;
  topPrizeMinor: number;
  terms: string | null;
  phase: ReferralPhase;
  sharers: number;
  joined: number;
  leaders: { name: string; joins: number }[];
  /** The viewer's own part, when signed in. */
  mine: { in: boolean; joins: number; paidMinor: number | null } | null;
  /** Paid out: who got what. */
  payouts: { name: string; joins: number; amountMinor: number; top: boolean }[] | null;
  /** What a new buyer gets for joining through a link. */
  welcomeMinor: number;
  /** The goals, and which are reached: live on the joins so far, final on the verified count once paid. */
  goals: (ReferralMilestone & { reached: boolean })[];
}

/** How many new buyers the goals are judged on: everybody so far while it runs, the verified count once paid. */
export function goalCount(referral: Pick<PostReferral, 'joins' | 'counted' | 'settledAt'>): number {
  return referral.settledAt && typeof referral.counted === 'number' ? referral.counted : referral.joins.length;
}

/**
 * The tag a drive link carries as `?d=`: the post it counts for. Channel and
 * post ids never hold a `/`.
 */
export const driveTag = (channelId: string, postId: string) => `${channelId}/${postId}`;

export function parseDriveTag(value: string | null | undefined): { channelId: string; postId: string } | null {
  if (!value) return null;
  const match = /^([A-Za-z0-9_:-]{1,80})\/(pst_[A-Za-z0-9-]{1,40})$/.exec(value);
  return match ? { channelId: match[1]!, postId: match[2]! } : null;
}
