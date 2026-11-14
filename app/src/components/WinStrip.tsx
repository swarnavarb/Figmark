import { Link } from 'react-router-dom';
import { boardInfo, seasonLabel } from '@shared/boards';
import { BADGE_META, type Badge, type BadgeKind } from '@shared/play';
import { monthKey } from '@shared/quest';

/**
 * Your own wins, small: the profile's Wins tab in a strip that sits above a
 * leaderboard. Leaderboard medals are little struck discs in gold, silver or
 * bronze; game wins are chips with the game's emoji. Each one says which
 * period it was won in - a monthly board, a weekly challenge - so nobody has
 * to guess what a "1st" was first of.
 */

export type Period = 'weekly' | 'monthly';

/** "Weekly" or "Monthly", as a small tag beside a board's name. */
export function PeriodTag({ period, title }: { period: Period; title?: string }) {
  return (
    <span className={`periodtag periodtag--${period}`} title={title}>
      {period === 'weekly' ? 'Weekly' : 'Monthly'}
    </span>
  );
}

const PLACE_TONE = { 1: 'gold', 2: 'silver', 3: 'bronze' } as const;
const PLACE_NAME = { 1: '1st', 2: '2nd', 3: '3rd' } as const;

export interface PodiumFinish {
  board: string;
  season: string;
  place: 1 | 2 | 3;
}

/** Your top-three finishes on the monthly hobby boards, newest first. */
export function MedalStrip({ podiums, profileHref }: { podiums: readonly PodiumFinish[]; profileHref: string | null }) {
  if (podiums.length === 0) return null;
  return (
    <div className="winstrip" aria-label="Your leaderboard medals">
      <small className="winstrip__label">
        Your medals · {podiums.length}
        {profileHref && <Link to={profileHref} className="winstrip__all">All wins ›</Link>}
      </small>
      <div className="winstrip__row">
        {podiums.map((finish) => {
          const board = boardInfo(finish.board);
          const name = board?.label ?? finish.board.replace(/^\w+:/, '');
          return (
            <span key={`${finish.board}-${finish.season}`} className={`minimedal minimedal--${PLACE_TONE[finish.place]}`}
              title={`${PLACE_NAME[finish.place]} on the ${name} board, ${seasonLabel(finish.season)}`}>
              <span className="minimedal__disc" aria-hidden="true"><b>{finish.place}</b></span>
              <span className="minimedal__text">
                <b>{board?.glyph ?? '#'} {name}</b>
                <small>{PLACE_NAME[finish.place]} · {shortSeason(finish.season)} · Monthly</small>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The game wins Top players counts, by name; the weekly challenge says it was a week's. */
const GAME_WINS: Partial<Record<BadgeKind, { label: string }>> = {
  challenge_winner: { label: 'Weekly challenge' },
  contest_winner: { label: 'Competition' },
  debate_winner: { label: 'Debate' },
  guess_winner: { label: 'Guess the price' },
};

export const isGameWin = (badge: Pick<Badge, 'kind'>) => badge.kind in GAME_WINS;

/**
 * Your game wins, newest first. Every one counts toward the monthly Top
 * players board of the month it was won in; the weekly challenge also says
 * it was a week's.
 */
export function WinStrip({ badges, profileHref, now = Date.now() }: {
  badges: readonly Badge[];
  profileHref: string | null;
  now?: number;
}) {
  const wins = badges.filter(isGameWin);
  if (wins.length === 0) return null;
  const thisMonth = monthKey(now);
  const counted = wins.filter((badge) => monthKey(badge.at) === thisMonth).length;
  return (
    <div className="winstrip" aria-label="Your game wins">
      <small className="winstrip__label">
        Your wins · {wins.length}{counted > 0 ? ` · ${counted} this month` : ''}
        {profileHref && <Link to={profileHref} className="winstrip__all">All wins ›</Link>}
      </small>
      <div className="winstrip__row">
        {wins.map((badge) => {
          const meta = GAME_WINS[badge.kind]!;
          const when = monthKey(badge.at) === thisMonth ? 'This month' : shortSeason(monthKey(badge.at));
          return (
            <Link key={badge.id} to={badge.link} className="winchip" title={badge.detail}>
              <span className="winchip__emoji" aria-hidden="true">{BADGE_META[badge.kind].emoji}</span>
              <span className="minimedal__text">
                <b>{badge.detail}</b>
                <small>{meta.label} · {when}</small>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** "Nov 2026" for a season key. */
function shortSeason(season: string): string {
  const [year, month] = season.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
