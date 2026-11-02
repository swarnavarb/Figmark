import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BOARD_POINTS, BOARD_POST_CAP, seasonLabel, type BoardRow, type BoardView } from '@shared/boards';
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
 * them, and its Hall of Fame. "Join a board" opens the choices: every category
 * heading, the hobby boards people have started, the hobbies on your own page,
 * and a box for any hobby at all - which starts its board if nobody has.
 */
export function HobbyBoards() {
  const { user } = useSession();
  const toast = useToast();
  const [list, setList] = useState<BoardList | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [view, setView] = useState<BoardView | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState('');
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
    api.board(chosen, season ?? undefined).then((next) => live && setView(next)).catch(() => live && setView(null));
    return () => { live = false; };
  }, [chosen, season]);

  async function join(target: { board: string } | { tag: string }) {
    setBusy(true);
    try {
      const { joined } = await api.boardJoin(target);
      await loadList();
      setChosen(joined.id);
      setSeason(null);
      setPicking(false);
      setTyped('');
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

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    if (typed.trim().length >= 2) void join({ tag: typed.trim() });
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
          <p>Compete with the people who collect what you do. Join up to {list?.limit ?? 3} boards: a category, or any hobby you type.</p>
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
                {board.glyph ?? '#'} {board.label}
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
                  <small className="qboards__label">From your page</small>
                  <div className="chips">
                    {list.suggestions.map((board) => (
                      <button key={board.id} type="button" className="chip" disabled={busy} onClick={() => void join({ board: board.id })}>
                        # {board.label}{board.members > 0 ? ` · ${board.members}` : ''}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <small className="qboards__label">Categories and hobbies</small>
              <div className="chips">
                {others.map((board) => (
                  <button key={board.id} type="button" className="chip" disabled={busy} onClick={() => void join({ board: board.id })}>
                    {board.glyph ?? '#'} {board.label}{board.members > 0 ? ` · ${board.members}` : ''}
                  </button>
                ))}
              </div>
              <form className="qboards__typed" onSubmit={submitTyped}>
                <input value={typed} onChange={(event) => setTyped(event.target.value)} maxLength={32}
                  placeholder="Any hobby: gunpla, pokemon, nendoroid…" aria-label="Hobby to join" />
                <button type="submit" className="btn btn--sm" disabled={busy || typed.trim().length < 2}>Join</button>
              </form>
            </div>
          )}

          {chosen && <Standings view={view} onLeave={leave} busy={busy} onSeason={setSeason} onJoin={(id) => void join({ board: id })} canJoin={Boolean(user) && !full} />}
        </>
      )}
    </section>
  );
}

function daysLeft(endsAt: string): string {
  const days = Math.ceil((Date.parse(endsAt) - Date.now()) / 86_400_000);
  return days <= 1 ? 'ends today' : `${days} days left`;
}

function Standings({ view, onLeave, onSeason, onJoin, busy, canJoin }: {
  view: BoardView | null;
  onLeave: (board: string) => void;
  onSeason: (season: string | null) => void;
  onJoin: (board: string) => void;
  busy: boolean;
  canJoin: boolean;
}) {
  const { user } = useSession();
  if (!view) return <SkeletonText lines={3} />;
  const current = Date.parse(view.endsAt) > Date.now();
  const rows = view.me ? [...view.rows, view.me] : view.rows;
  return (
    <div className="qboards__board">
      <div className="qboards__head">
        <b>{view.board.glyph ?? '#'} {view.board.label}</b>
        <span className="faint">
          {seasonLabel(view.season)} · {current ? daysLeft(view.endsAt) : 'final'} · {view.board.members} on the board
        </span>
        {!current && <button type="button" className="btn btn--sm btn--quiet" onClick={() => onSeason(null)}>This month</button>}
        {view.joined
          ? <button type="button" className="btn btn--sm btn--quiet" disabled={busy} onClick={() => onLeave(view.board.id)}>Leave</button>
          : canJoin && <button type="button" className="btn btn--sm" disabled={busy} onClick={() => onJoin(view.board.id)}>Join</button>}
      </div>
      {rows.length === 0 ? (
        <p className="faint" style={{ margin: 0 }}>
          Nobody has scored this month yet. An order in this hobby that arrives, a collection piece or a post about it puts you on the board.
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
              <span>{entry.podium.map((row) => `${['🥇', '🥈', '🥉'][row.rank - 1]} ${row.name}`).join('  ')}</span>
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
