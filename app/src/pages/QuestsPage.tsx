import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CARDS, CARD_SETS, SET_BONUS_XP, type CardDef, type StickerView, type TaskKind, type TaskView,
} from '@shared/quest';
import { api, type InviteSummary, type LeaderRow } from '../api';
import { useShareSheet, type ShareSpec } from '../components/ShareKit';
import { SkeletonText } from '../components/Feedback';
import {
  CardFace, CardSheet, CardSlot, Glyph, LevelRing, Sticker, StickerSheet, XpBar, useQuest,
} from '../components/Quest';
import { Avatar } from '../components/ui';
import { QuestShooter } from '../components/QuestShooter';
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
  /** Quests cleared on this visit: each one fires a burst in the arcade. */
  const [cleared, setCleared] = useState(0);
  const [openCard, setOpenCard] = useState<CardDef | null>(null);
  const [openSticker, setOpenSticker] = useState<StickerView | null>(null);
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
          {view.streak.week.map((day) => (
            <span key={day.day} className={`qweek__day${day.done ? ' is-done' : ''}${day.today ? ' is-today' : ''}${day.future ? ' is-future' : ''}`}>
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

      <InvitePanel level={view.level} title={view.title} />

      {/* The quest board as an arcade cabinet: the tasks are the HUD, and a
          little space shooter plays underneath. Clearing one fires a burst. */}
      <section className="qpanel qarcade">
        <div className="qworld" aria-hidden="true"><QuestShooter volley={cleared} /></div>
        <div className="qarcade__head">
          <span className="qarcade__title"><Glyph name="shield" size={14} /> Quest board</span>
        </div>
        <div className="tabs qtabs">
          {(['daily', 'weekly', 'monthly', 'milestone'] as const).map((kind) => (
            <button key={kind} type="button" className={`tab${tab === kind ? ' is-on' : ''}`} onClick={() => setTab(kind)}>
              {kind === 'daily' ? 'Daily' : kind === 'weekly' ? 'Weekly' : kind === 'monthly' ? 'Monthly' : 'Milestones'}
              {ready(kind) > 0 && <span className="qdot">{ready(kind)}</span>}
            </button>
          ))}
        </div>
        <ul className="qtasks">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onClaim={() => {
              setCleared((n) => n + 1);
              void act(() => api.questClaim(task.id));
            }} />
          ))}
        </ul>
        <p className="faint qtasks__note">
          {tab === 'daily'
            ? 'Check in, Reveal and Share a find are there every day; the other two change daily. They reset at midnight, India time.'
            : tab === 'weekly'
              ? 'Five check-ins and two people opening your links every week, plus three that change each Monday.'
              : tab === 'monthly'
                ? 'Bring a friend every month, plus three bigger goals that change on the 1st.'
                : 'Each milestone pays once and comes with a card pack - then the next, bigger step appears.'}
        </p>
      </section>

      <section className="qpanel">
        <div className="qpanel__head">
          <h3><Glyph name="card" size={15} /> Cards · {new Set(view.cards.map((card) => card.id)).size}/{CARDS.length}</h3>
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
                    ? <CardFace key={card.id} card={card} size="sm" copies={view.cards.filter((mine) => mine.id === card.id).length}
                        onOpen={() => setOpenCard(card)} />
                    : <CardSlot key={card.id} />
                ))}
              </div>
            </div>
          );
        })}
        <p className="faint" style={{ margin: 0 }}>
          Cards come from the daily Reveal, every level and every milestone. Finish a set of six for {SET_BONUS_XP} XP and its Master sticker. Tap a card to read it.
        </p>
      </section>

      <section className="qpanel">
        <div className="qpanel__head">
          <h3><Glyph name="shield" size={15} /> Stickers · {view.stickers.filter((sticker) => sticker.earned).length}/{view.stickers.length}</h3>
        </div>
        <div className="qstickers">
          {[...view.stickers].sort((a, b) => b.tier - a.tier).map((sticker) => (
            <Sticker key={sticker.id} sticker={sticker} onOpen={() => setOpenSticker(sticker)} />
          ))}
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
            {[...view.breakdown].sort((a, b) => Number(a.xp < 0) - Number(b.xp < 0)).map((line) => (
              <div key={line.label} className={`qbreak__row${line.xp < 0 ? ' is-loss' : ''}`}>
                <dt>{line.label}{line.detail && <small>{line.detail}</small>}</dt>
                <dd>{line.xp > 0 ? '+' : ''}{line.xp.toLocaleString('en-IN')} XP</dd>
              </div>
            ))}
            <div className="qbreak__row qbreak__total">
              <dt>Total{view.penalty > 0 && <small>after −{view.penalty} XP of losses</small>}</dt>
              <dd>{view.xp.toLocaleString('en-IN')} XP</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="qpanel">
        <div className="qpanel__head"><h3>How rarity works</h3></div>
        <ul className="qrules">
          <li><span className="qrarity qrarity--legendary">Legendary</span> Selling hard, heavily saved, a pre-order 90% full, or a timed drop in its last hours.</li>
          <li><span className="qrarity qrarity--epic">Epic</span> Strong demand, a pre-order past 60%, or real interest with under three days on the clock.</li>
          <li><span className="qrarity qrarity--new">New</span> Listed or back in stock in the last three days.</li>
        </ul>
        <p className="faint" style={{ margin: 0 }}>
          Rarity is worked out from sales, saves, views and fill, and moves as they do. A seller cannot set it.
        </p>
      </section>
      {openCard && (
        <CardSheet card={openCard} copies={view.cards.filter((mine) => mine.id === openCard.id).length}
          setOwned={view.sets.find((set) => set.id === openCard.set)?.owned ?? 0} onClose={() => setOpenCard(null)} />
      )}
      {openSticker && <StickerSheet sticker={openSticker} whose="mine" onClose={() => setOpenSticker(null)} />}
    </main>
  );
}

/**
 * Invite & earn: the two people worth bringing - a friend who will buy, and a
 * seller who will open a shop - each with a picture made to send them.
 */
function InvitePanel({ level, title }: { level: number; title: string }) {
  const [summary, setSummary] = useState<InviteSummary | null>(null);
  const { open, sheet } = useShareSheet();

  useEffect(() => {
    void api.myInvite().then(setSummary).catch(() => setSummary(null));
  }, []);

  const friend: ShareSpec = {
    kind: 'invite',
    moment: {
      level: { level, title }, title: 'Join me on Figmark', detail: 'Pre-orders · Buyer Protection · card packs',
      headline: 'Come shop with me',
    },
    link: { to: 'invite' },
    caption: 'Join me on Figmark - pre-orders from import resellers with Buyer Protection, and you collect cards as you shop. Here is my invite:',
    target: summary?.code ?? null,
  };
  const seller: ShareSpec = {
    kind: 'invite_seller',
    moment: {
      title: 'Open your shop', detail: 'Pre-orders · tracking · Buyer Protection · affiliates',
      headline: 'Sell with me on Figmark',
    },
    link: { to: 'invite', seller: true },
    caption: 'Selling imports? Run your pre-orders on Figmark - order manifests, tracking your buyers can see, Buyer Protection, and people who share your items for a commission. Open a shop with my invite:',
    target: summary?.code ?? null,
  };

  return (
    <section className="qpanel qinv" id="invite">
      <div className="qpanel__head">
        <h3><Glyph name="gift" size={15} /> Invite &amp; earn</h3>
        {summary && <span className="faint">{summary.joined} joined · {summary.sellers} shops</span>}
      </div>
      <p className="qinv__lead">
        Every friend who joins with your link climbs Ambassador; every seller who opens a shop climbs Talent Scout.
        Anybody opening what you share counts for Promoter and this week's quest.
      </p>
      <div className="qinv__cards">
        <button type="button" className="qinv__card qinv__card--friend" onClick={() => open(friend)}>
          <span className="qinv__emoji" aria-hidden="true">💌</span>
          <b>Invite a friend</b>
          <small>WhatsApp, Status or a story · XP when they join</small>
        </button>
        <button type="button" className="qinv__card qinv__card--seller" onClick={() => open(seller)}>
          <span className="qinv__emoji" aria-hidden="true">🚀</span>
          <b>Invite a seller</b>
          <small>They open a shop, you level up</small>
        </button>
      </div>
      {summary && (
        <div className="qinv__stats">
          <span className="qinv__stat"><b>{summary.opens}</b><small>link opens</small></span>
          <span className="qinv__stat"><b>{summary.joined}</b><small>friends joined</small></span>
          <span className="qinv__stat"><b>{summary.sellers}</b><small>shops opened</small></span>
        </div>
      )}
      {summary && summary.recent.length > 0 && (
        <ul className="qinv__recent">
          {summary.recent.map((person) => (
            <li key={`${person.name}-${person.at}`} className={person.seller ? 'is-seller' : undefined}>
              {person.handle ? <Link to={`/${person.handle}`}>{person.name}</Link> : person.name}{person.seller ? ' · shop' : ''}
            </li>
          ))}
        </ul>
      )}
      {sheet}
    </section>
  );
}

function TaskRow({ task, onClaim }: { task: TaskView; onClaim: () => void }) {
  return (
    <li className={`qtask${task.claimed ? ' is-claimed' : ''}`}>
      <span className="qtask__body">
        <b>{task.title}{task.step && task.step.of > 1 && <span className="qtask__step">step {task.step.index} of {task.step.of}</span>}</b>
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
