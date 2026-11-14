import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BOARD_POINTS, BOARD_POST_CAP, seasonLabel, type BoardRow, type BoardScope, type BoardView } from '@shared/boards';
import { ApiRequestError, api, type BoardList } from '../api';
import { useSession } from '../session';
import { SkeletonText, useToast } from './Feedback';
import { Glyph } from './Quest';
import { InfoTip } from './QuestKit';
import { Avatar } from './ui';

/**
 * Hobby leaderboards on the Quests page.
 *
 * Your boards as a row of chips, the chosen one's season standings under
 * them, and its Hall of Fame. "Join a board" opens the choices: a fixed set of
 * broad hobbies (Action figures, Sneakers, Trading cards …), with the ones
 * your page's hobbies belong to first. Standings can be everybody or only the
 * people you follow.
 */
export function HobbyBoards() {
  const { user } = useSession();
  const toast = useToast();
  const [list, setList] = useState<BoardList | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [view, setView] = useState<BoardView | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [scope, setScope] = useState<BoardScope>('all');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => api.boards().then((next) => {
    setList(next);
    return next;
  }).catch(() => null), []);

  useEffect(() => {
    void loadList().then((next) => {
      if (!next) return;
      setChosen((current) => current ?? next.mine[0] ?? next.boards[0]?.id ?? null);
      if (next.mine.length === 0) setPicking(true);
    });
  }, [loadList]);

  useEffect(() => {
    if (!chosen) return;
    let live = true;
    setView(null);
    api.board(chosen, season ?? undefined, scope).then((next) => live && setView(next)).catch(() => live && setView(null));
    return () => { live = false; };
  }, [chosen, season, scope]);

  async function join(target: { board: string }) {
    setBusy(true);
    try {
      const { joined } = await api.boardJoin(target);
      await loadList();
      setChosen(joined.id);
      setSeason(null);
      setPicking(false);
      toast(`You are on the ${joined.label} board.`, 'ok');
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Could not join that board.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function leave(board: string) {
    setBusy(true);
    try {
      const { boards } = await api.boardLeave(board);
      await loadList();
      if (chosen === board) setChosen(boards[0] ?? null);
      if (boards.length === 0) setPicking(true);
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Could not leave that board.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const mine = list?.boards.filter((board) => list.mine.includes(board.id)) ?? [];
  const full = list ? list.mine.length >= list.limit : false;
  const others = list?.boards.filter((board) => !list.mine.includes(board.id)) ?? [];

  return (
    <section className="qpanel" id="boards">
      <div className="qpanel__head">
        <h3><Glyph name="crown" size={15} /> Hobby leaderboards</h3>
        <InfoTip label="About hobby leaderboards">
          <b>Hobby leaderboards</b>
          <p>Compete with the people who collect what you do. Join up to {list?.limit ?? 3} hobby boards, such as Action figures, Sneakers or Trading cards.</p>
          <p>Each board runs for a calendar month, India time, then starts again from zero. The top three of every month go into its Hall of Fame and earn the Season Podium honour.</p>
          <p>Points come only from that hobby: {BOARD_POINTS.delivered} for an order that arrives, {BOARD_POINTS.collected} for adding it to your collection, {BOARD_POINTS.review} for reviewing it, and {BOARD_POINTS.post} for a post about it (up to {BOARD_POST_CAP} posts a month).</p>
        </InfoTip>
      </div>

      {!list ? <SkeletonText lines={3} /> : (
        <>
          <div className="chips qboards__mine">
            {mine.map((board) => (
              <button key={board.id} type="button" className={`chip${chosen === board.id ? ' is-on' : ''}`}
                onClick={() => { setChosen(board.id); setSeason(null); setPicking(false); }}>
                {board.glyph} {board.label}
              </button>
            ))}
            {user && !full && (
              <button type="button" className={`chip qboards__add${picking ? ' is-on' : ''}`} onClick={() => setPicking((open) => !open)}>
                + Join a board
              </button>
            )}
          </div>

          {picking && user && (
            <div className="qboards__picker">
              <p className="faint">{mine.length === 0 ? 'Pick a hobby to compete in.' : 'Join another board.'} You can be on {list.limit} at a time.</p>
              {list.suggestions.length > 0 && (
                <>
                  <small className="qboards__label">Your hobbies</small>
                  <div className="chips">
                    {list.suggestions.map((board) => (
                      <button key={board.id} type="button" className="chip" disabled={busy} onClick={() => void join({ board: board.id })}>
                        {board.glyph} {board.label}{board.members > 0 ? ` · ${board.members}` : ''}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <small className="qboards__label">All hobbies</small>
              <div className="chips">
                {others.filter((board) => !list.suggestions.some((hint) => hint.id === board.id)).map((board) => (
                  <button key={board.id} type="button" className="chip" disabled={busy} onClick={() => void join({ board: board.id })}>
                    {board.glyph} {board.label}{board.members > 0 ? ` · ${board.members}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chosen && <Standings view={view} onLeave={leave} busy={busy} onSeason={setSeason} onJoin={(id) => void join({ board: id })}
            canJoin={Boolean(user) && !full} scope={scope} onScope={user ? setScope : null} />}
        </>
      )}
    </section>
  );
}

function daysLeft(endsAt: string): string {
  const days = Math.ceil((Date.parse(endsAt) - Date.now()) / 86_400_000);
  return days <= 1 ? 'ends today' : `${days} days left`;
}

function Standings({ view, onLeave, onSeason, onJoin, busy, canJoin, scope, onScope }: {
  view: BoardView | null;
  onLeave: (board: string) => void;
  onSeason: (season: string | null) => void;
  onJoin: (board: string) => void;
  busy: boolean;
  canJoin: boolean;
  scope: BoardScope;
  /** Null when signed out: there is nobody to follow. */
  onScope: ((scope: BoardScope) => void) | null;
}) {
  const { user } = useSession();
  if (!view) return <SkeletonText lines={3} />;
  const current = Date.parse(view.endsAt) > Date.now();
  const rows = view.me ? [...view.rows, view.me] : view.rows;
  return (
    <div className="qboards__board">
      <div className="qboards__head">
        <b>{view.board.glyph} {view.board.label}</b>
        <span className="faint">
          {seasonLabel(view.season)} · {current ? daysLeft(view.endsAt) : 'final'} · {view.board.members} on the board
        </span>
        {!current && <button type="button" className="btn btn--sm btn--quiet" onClick={() => onSeason(null)}>This month</button>}
        {view.joined
          ? <button type="button" className="btn btn--sm btn--quiet" disabled={busy} onClick={() => onLeave(view.board.id)}>Leave</button>
          : canJoin && <button type="button" className="btn btn--sm" disabled={busy} onClick={() => onJoin(view.board.id)}>Join</button>}
      </div>
      {onScope && (
        <div className="seg" role="tablist" aria-label="Whose standings">
          {(['all', 'following'] as const).map((option) => (
            <button key={option} type="button" role="tab" aria-selected={scope === option} className={scope === option ? 'is-on' : ''}
              onClick={() => onScope(option)}>
              {option === 'all' ? 'Everyone' : 'People you follow'}
            </button>
          ))}
        </div>
      )}
      {view.gap && (
        <p className="qboards__gap">
          You're <b>#{view.gap.rank}</b>, {view.gap.points} point{view.gap.points === 1 ? '' : 's'} behind #{view.gap.aheadRank}.
          {' '}An order in this hobby that arrives is worth {BOARD_POINTS.delivered}.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="faint" style={{ margin: 0 }}>
          {view.scope === 'following'
            ? 'Nobody you follow has scored on this board this month. Follow other collectors to race them here.'
            : 'Nobody has scored this month yet. An order in this hobby that arrives, a collection piece or a post about it puts you on the board.'}
        </p>
      ) : (
        <ol className="qleaders">
          {rows.map((row) => <Row key={row.userId} row={row} me={row.userId === user?.id} />)}
        </ol>
      )}
      {view.hall.some((entry) => entry.podium.length > 0) && (
        <div className="qboards__hall">
          <small className="qboards__label">Hall of Fame</small>
          {view.hall.filter((entry) => entry.podium.length > 0).map((entry) => (
            <button key={entry.season} type="button" className="qboards__season" onClick={() => onSeason(entry.season)}>
              <b>{seasonLabel(entry.season)}</b>
              <span>{entry.podium.map((row) => `${['🥇', '🥈', '🥉'][row.rank - 1] ?? '🏅'} ${row.name}`).join('  ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ row, me }: { row: BoardRow; me: boolean }) {
  const parts = [
    row.delivered && `${row.delivered} arrived`,
    row.collected && `${row.collected} collected`,
    row.reviews && `${row.reviews} reviewed`,
    row.posts && `${row.posts} post${row.posts === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return (
    <li className={me ? 'is-me' : ''}>
      <span className={`qleaders__rank qboard__rank--${Math.min(row.rank, 4)}`}>#{row.rank}</span>
      <Avatar name={row.name} size={30} />
      <span className="qleaders__who">
        {row.handle ? <Link to={`/${row.handle}`}>{row.name}</Link> : row.name}
        <small>{parts.join(' · ')}</small>
      </span>
      <b className="qleaders__xp">{row.points} pts</b>
    </li>
  );
}
