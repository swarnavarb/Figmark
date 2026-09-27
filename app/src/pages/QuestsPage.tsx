import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CARDS, CARD_SETS, type TaskKind, type TaskView } from '@shared/quest';
import { api, type LeaderRow } from '../api';
import { SkeletonText } from '../components/Feedback';
import {
  CardFace, CardSlot, DesignSwitch, Glyph, LevelRing, Sticker, XpBar, useQuest,
} from '../components/Quest';
import { Avatar } from '../components/ui';
import { useSession } from '../session';

/**
 * Quests: where the collector game is played rather than glimpsed.
 *
 * Top to bottom in the order somebody acts on it - who you are in the game,
 * whether you have kept your streak, anything waiting to be opened or
 * collected, what to do next, what you have collected, and how you compare.
 * The XP breakdown at the foot is there so the number can be checked: every
 * point of it names the thing that earned it.
 */
export function QuestsPage() {
  const { view, act, refresh } = useQuest();
  const [tab, setTab] = useState<TaskKind>('daily');
  const [board, setBoard] = useState<{ top: LeaderRow[]; me: LeaderRow | null; total: number } | null>(null);

  useEffect(() => {
    void refresh();
    void api.leaderboard().then(setBoard).catch(() => setBoard(null));
  }, [refresh]);

  if (!view) {
    return <main className="page qpage"><SkeletonText lines={6} /></main>;
  }

  const tasks = view.tasks.filter((task) => task.kind === tab);
  const ready = (kind: TaskKind) => view.tasks.filter((task) => task.kind === kind && task.claimable).length;
  const toNext = view.nextLevelXp - view.xp;

  return (
    <main className="page qpage">
      <div className="qbar">
        <h1 className="qpage__title">Quests</h1>
        <span className="qbar__spacer" />
        <DesignSwitch />
      </div>

      <section className="qhero">
        <LevelRing level={view.level} progress={view.progress} size={112} />
        <div className="qhero__body">
          <p className="qhero__eyebrow">Level {view.level}</p>
          <h2>{view.title}</h2>
          <p className="qhero__xp">{view.xp.toLocaleString('en-IN')} XP · {toNext.toLocaleString('en-IN')} to level {view.level + 1}</p>
          <XpBar progress={view.progress} />
          <p className="faint qhero__next">Next up: a Level {view.level + 1} card pack{(view.level + 1) % 5 === 0 ? ' (epic or better)' : ''}</p>
        </div>
      </section>

      <section className="qpanel">
        <div className="qpanel__head">
          <h3><Glyph name="flame" size={15} /> Streak · {view.streak.current} {view.streak.current === 1 ? 'day' : 'days'}</h3>
          <span className="faint">best {view.streak.best}</span>
        </div>
        <div className="qweek">
          {view.streak.week.map((day, index) => (
            <span key={day.day} className={`qweek__day${day.done ? ' is-done' : ''}${index === 6 ? ' is-today' : ''}`}>
              <i>{day.done ? <Glyph name="flame" size={14} /> : null}</i>
              {new Date(`${day.day}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'narrow' })}
            </span>
          ))}
        </div>
        {!view.streak.checkedInToday ? (
          <button type="button" className="btn qbtn-gold" onClick={() => void act(api.questCheckIn)}>
            Check in for today · +{10 + 5 * Math.min(view.streak.current, 7)} XP
          </button>
        ) : (
          <p className="faint" style={{ margin: 0 }}>Checked in today. Come back tomorrow to keep it going.</p>
        )}
      </section>

      {view.packs.length > 0 && (
        <section className="qpanel qpanel--gold">
          <div className="qpanel__head">
            <h3><Glyph name="gift" size={15} /> Packs to open · {view.packs.length}</h3>
          </div>
          <div className="qpacks">
            {view.packs.map((pack) => (
              <button key={pack.id} type="button" className={`qpack qpack--${pack.min}`}
                onClick={() => void act(() => api.questOpen(pack.id), pack.label)}>
                <span className="qpack__foil"><Glyph name="star" size={22} /></span>
                <b>{pack.label}</b>
                <small>{pack.min} or better · tap to open</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="qpanel">
        <div className="tabs qtabs">
          {(['daily', 'weekly', 'milestone'] as const).map((kind) => (
            <button key={kind} type="button" className={`tab${tab === kind ? ' is-on' : ''}`} onClick={() => setTab(kind)}>
              {kind === 'daily' ? 'Daily' : kind === 'weekly' ? 'Weekly' : 'Milestones'}
              {ready(kind) > 0 && <span className="qdot">{ready(kind)}</span>}
            </button>
          ))}
        </div>
        <ul className="qtasks">
          {tasks.map((task) => <TaskRow key={task.id} task={task} onClaim={() => void act(() => api.questClaim(task.id))} />)}
        </ul>
        <p className="faint qtasks__note">
          {tab === 'daily' ? 'Daily quests reset at midnight, India time.' : tab === 'weekly' ? 'Weekly quests reset every Monday.' : 'Milestones pay once, and each comes with a card pack.'}
        </p>
      </section>

      <section className="qpanel">
        <div className="qpanel__head">
          <h3><Glyph name="card" size={15} /> Collection · {new Set(view.cards.map((card) => card.id)).size}/{CARDS.length}</h3>
          <span className="faint">{view.cards.length} pulled</span>
        </div>
        {CARD_SETS.map((set) => {
          const inSet = CARDS.filter((card) => card.set === set.id);
          const owned = view.sets.find((entry) => entry.id === set.id);
          return (
            <div key={set.id} className="qset">
              <div className="qset__head">
                <b>{set.name}</b>
                <span className={owned && owned.owned === owned.total ? 'qok' : 'faint'}>
                  {owned?.owned ?? 0}/{inSet.length}{owned && owned.owned === owned.total ? ' · complete' : ''}
                </span>
              </div>
              <div className="qset__cards">
                {inSet.map((card) => (
                  view.cards.some((mine) => mine.id === card.id)
                    ? <CardFace key={card.id} card={card} size="sm" />
                    : <CardSlot key={card.id} />
                ))}
              </div>
            </div>
          );
        })}
        <p className="faint" style={{ margin: 0 }}>
          Finish a set for its Master sticker. Cards come from the daily drop, every level, and every milestone.
        </p>
      </section>

      <section className="qpanel">
        <div className="qpanel__head">
          <h3><Glyph name="shield" size={15} /> Stickers · {view.stickers.filter((sticker) => sticker.earned).length}/{view.stickers.length}</h3>
        </div>
        <div className="qstickers">
          {[...view.stickers].sort((a, b) => Number(b.earned) - Number(a.earned)).map((sticker) => <Sticker key={sticker.id} sticker={sticker} />)}
        </div>
      </section>

      <section className="qpanel">
        <div className="qpanel__head">
          <h3><Glyph name="crown" size={15} /> Top collectors</h3>
          {board && <span className="faint">{board.total} playing</span>}
        </div>
        {!board ? <SkeletonText lines={3} /> : <Leaderboard board={board} />}
      </section>

      <section className="qpanel">
        <div className="qpanel__head"><h3>Where your XP came from</h3></div>
        {view.breakdown.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>Nothing yet. Check in, save something, or place an order to start.</p>
        ) : (
          <dl className="qbreak">
            {view.breakdown.map((line) => (
              <div key={line.label} className="kv"><dt>{line.label}</dt><dd>{line.xp.toLocaleString('en-IN')} XP</dd></div>
            ))}
          </dl>
        )}
      </section>

      <section className="qpanel">
        <div className="qpanel__head"><h3>How rarity works</h3></div>
        <ul className="qrules">
          <li><span className="qrarity qrarity--legendary">Legendary</span> Selling hard, heavily saved, a group buy 90% full, or a timed drop in its last hours.</li>
          <li><span className="qrarity qrarity--epic">Epic</span> Strong demand, a group buy past 60%, or real interest with under three days on the clock.</li>
          <li><span className="qrarity qrarity--new">New</span> Listed or back in stock in the last three days.</li>
        </ul>
        <p className="faint" style={{ margin: 0 }}>
          Rarity is worked out from sales, saves, views and fill, and moves as they do. A seller cannot set it.
        </p>
      </section>
    </main>
  );
}

function TaskRow({ task, onClaim }: { task: TaskView; onClaim: () => void }) {
  return (
    <li className={`qtask${task.claimed ? ' is-claimed' : ''}`}>
      <span className="qtask__body">
        <b>{task.title}</b>
        <small>{task.blurb}</small>
        {task.goal > 1 && (
          <span className="qtask__progress">
            <XpBar progress={task.progress / task.goal} />
            <span className="faint">{task.progress}/{task.goal}</span>
          </span>
        )}
      </span>
      <span className="qtask__act">
        {task.claimed ? (
          <span className="qok">✓ +{task.xp}</span>
        ) : task.claimable ? (
          <button type="button" className="btn btn--sm qbtn-gold" onClick={onClaim}>
            Claim +{task.xp}{task.pack ? ' + pack' : ''}
          </button>
        ) : task.href ? (
          <Link to={task.href} className="btn btn--sm btn--quiet">+{task.xp} XP · Go</Link>
        ) : (
          <span className="faint">+{task.xp} XP</span>
        )}
      </span>
    </li>
  );
}

function Leaderboard({ board }: { board: { top: LeaderRow[]; me: LeaderRow | null } }) {
  const { user } = useSession();
  const rows = board.me && !board.top.some((row) => row.userId === board.me!.userId)
    ? [...board.top, board.me]
    : board.top;
  if (rows.length === 0) return <p className="faint" style={{ margin: 0 }}>Nobody has scored yet. Be first.</p>;
  return (
    <ol className="qleaders">
      {rows.map((row) => (
        <li key={row.userId} className={row.userId === user?.id ? 'is-me' : ''}>
          <span className={`qleaders__rank qboard__rank--${Math.min(row.rank, 4)}`}>#{row.rank}</span>
          <Avatar name={row.name} size={30} />
          <span className="qleaders__who">
            {row.handle ? <Link to={`/${row.handle}`}>{row.name}</Link> : row.name}
            <small>Level {row.level} · {row.cards} cards</small>
          </span>
          <b className="qleaders__xp">{row.xp.toLocaleString('en-IN')} XP</b>
        </li>
      ))}
    </ol>
  );
}
