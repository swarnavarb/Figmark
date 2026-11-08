import { formatCount } from '../format';
import { PageLoading } from '../components/Feedback';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MAX_LEVEL, TASK_XP, XP, rankLadder, type StickerView, type TaskKind,
} from '@shared/quest';
import type { StoreAccess } from '@shared/stores';
import { api, type InviteSummary } from '../api';
import type { PlayerRow } from '@shared/play';
import { useShareSheet, type ShareSpec } from '../components/ShareKit';
import { SkeletonText } from '../components/Feedback';
import { Glyph, Sticker, StickerSheet, useQuest } from '../components/Quest';
import { HobbyBoards } from '../components/HobbyBoards';
import { BoardHead, InfoTip, InviteStrip, NoBumpsNotice, QuestHero, QuestRow, QuestTabs } from '../components/QuestKit';
import { Avatar } from '../components/ui';
import { QuestShooter } from '../components/QuestShooter';
import { ShopQuests } from '../components/ShopQuests';
import { useSession } from '../session';
import '../styles/QuestsPage.css';
import { StickerCluster } from '../components/Sticker';

/**
 * Quests: where the collector game is played rather than glimpsed.
 *
 * Top to bottom in the order somebody acts on it - who you are in the game,
 * whether you have kept your streak, what to do next, the honours earned, and
 * how you compare on the hobby leaderboards.
 * The XP breakdown at the foot is there so the number can be checked: every
 * point of it names the thing that earned it.
 *
 * Somebody who runs a shop gets a switch at the top between their own quests
 * and the shop's. The two stay separate games - a person levels on what they
 * buy and share, a shop on its reviews, popularity, sales and marketing, and
 * everyone who runs the shop plays its board together - but they live on one
 * page, so there is one place to look for quests.
 */
export function QuestsPage() {
  const { user } = useSession();
  const { view, act, refresh } = useQuest();
  /** Null until picked: Getting started while it has steps left, otherwise Daily. */
  const [picked, setTab] = useState<TaskKind | null>(null);
  /** Quests cleared on this visit: each one fires a burst in the arcade. */
  const [cleared, setCleared] = useState(0);
  const [openSticker, setOpenSticker] = useState<StickerView | null>(null);
  const [stores, setStores] = useState<StoreAccess[]>([]);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    void refresh();
    void api.stores().then(({ stores: mine }) => setStores(mine)).catch(() => setStores([]));
  }, [refresh]);

  const shop = stores.find((store) => store.ownerId === params.get('shop')) ?? null;
  const noBumps = params.get('nobump') === '1';
  const closeNotice = useCallback(
    () => setParams((current) => { current.delete('nobump'); return current; }, { replace: true }),
    [setParams],
  );
  const notice = noBumps && <NoBumpsNotice onClose={closeNotice} />;
  const sides = stores.length > 0 && (
    <div className="seg qsides" role="tablist" aria-label="Whose quests">
      <button type="button" role="tab" aria-selected={!shop} className={!shop ? 'is-on' : ''}
        onClick={() => setParams((current) => { current.delete('shop'); return current; }, { replace: true })}>
        You
      </button>
      {stores.map((store) => (
        <button key={store.ownerId} type="button" role="tab" aria-selected={shop?.ownerId === store.ownerId}
          className={shop?.ownerId === store.ownerId ? 'is-on' : ''}
          onClick={() => setParams((current) => { current.set('shop', store.ownerId); return current; }, { replace: true })}>
          {stores.length === 1 ? 'Store' : store.name}
        </button>
      ))}
    </div>
  );
  const bar = (
    <div className="qbar">
      <h1 className="qpage__title">Quests</h1>
      <StickerCluster
        className="title-stickers"
        items={[
          { name: 'trophy', size: 36, x: 0, y: 4, tilt: -10 },
          { name: 'star', size: 22, x: 60, y: 0, tilt: 14 },
        ]}
      />
      {sides}
    </div>
  );

  if (shop) {
    return (
      <main className="page qpage">
        {bar}
        {notice}
        <ShopQuests key={shop.ownerId} store={shop} />
      </main>
    );
  }

  if (!view) {
    return <PageLoading label="Loading your quests" shape="quests" />;
  }

  const starterLeft = view.tasks.some((task) => task.kind === 'starter' && !task.claimed);
  const tab: TaskKind = picked ?? (starterLeft ? 'starter' : 'daily');
  const tasks = view.tasks.filter((task) => task.kind === tab);
  const ready = (kind: TaskKind) => view.tasks.filter((task) => task.kind === kind && task.claimable).length;

  return (
    <main className="page qpage">
      {bar}
      {notice}
      <div className="qside">
        <QuestHero
          side="you" who={{ name: user?.displayName ?? 'You', href: user?.username ? `/${user.username}` : '/me' }}
          eyebrow={`Level ${view.level}`} title={view.title} level={view.level} progress={view.progress}
          xp={view.xp} toNext={view.level >= MAX_LEVEL ? null : view.nextLevelXp - view.xp} nextLevel={view.level + 1} bumps={view.bumps}
          info={(
            <>
              <b>How your rank works</b>
              <p>Your level reads as a rank: {rankLadder(false).map((rank) => rank.title).join(', ')}. Finishing an order pays {XP.orderDelivered} XP and writing a review pays {XP.reviewWritten}. Following, saving and posting pay only a few points each, so a rank is earned by trading well.</p>
              <p>A rank needs a record: a first finished order for Rising Collector, ten for Trusted and forty for Elite and above. Confirming delivery promptly and reviewing right after, as a buyer or a seller, is what moves you up.</p>
              <p>Low ratings and lost disputes take XP away, and a few lost disputes hold your rank back.</p>
              <RankLadder current={view.level} />
            </>
          )}
        />
        {view.heldBack && <p className="notice notice--warn" role="status">{view.heldBack}</p>}

        <section className="qpanel qstreak">
          <span className="qstreak__flame"><Glyph name="flame" size={18} /><b>{view.streak.current}</b></span>
          <span className="qstreak__body">
            <span className="qstreak__head">
              <b>day streak</b>
              <span className="faint">best {view.streak.best}</span>
              <InfoTip label="About streaks">
                <b>Streaks</b>
                <p>Check in once a day, India time, for {XP.checkIn} XP. Days in a row climb the On Fire milestone: 7, 30 and 100 days.</p>
              </InfoTip>
            </span>
            <span className="qweek">
              {view.streak.week.map((day) => (
                <span key={day.day} className={`qweek__day${day.done ? ' is-done' : ''}${day.today ? ' is-today' : ''}${day.future ? ' is-future' : ''}`}>
                  <i>{day.done ? <Glyph name="flame" size={12} /> : null}</i>
                  {new Date(`${day.day}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'narrow' })}
                </span>
              ))}
            </span>
          </span>
          {!view.streak.checkedInToday ? (
            <button type="button" className="btn btn--sm qbtn-gold" onClick={() => void act(api.questCheckIn)}>
              Check in · +{XP.checkIn}
            </button>
          ) : <span className="qok qstreak__done">✓ Today</span>}
        </section>

        <InvitePanel level={view.level} title={view.title} />

        {/* The quest board as an arcade cabinet: the tasks are the HUD, and a
            little space shooter plays underneath. Clearing one fires a burst. */}
        <section className="qpanel qarcade">
          <div className="qworld" aria-hidden="true"><QuestShooter volley={cleared} /></div>
          <BoardHead info={(
            <>
              <b>Your quests</b>
              <p>Start: Getting started steps that set your account up, {TASK_XP.starter} XP each, once.</p>
              <p>Daily: Check in, Reveal and Share a find every day, plus two that change daily. They reset at midnight, India time.</p>
              <p>Weekly: five check-ins and two people opening your links, plus three that change each Monday and one Grow quest about sharing. Monthly: bring a friend, plus three bigger goals that change on the 1st and one Grow quest.</p>
              <p>Each weekly quest pays 1 bump point and each monthly one pays 2. Milestones pay once a step, then a bigger step appears.</p>
            </>
          )} />
          <QuestTabs tab={tab} onTab={setTab} ready={ready} starter={starterLeft || tab === 'starter'} />
          <ul className="qtasks">
            {tasks.map((task) => (
              <QuestRow key={task.id}
                title={task.title} blurb={task.blurb} step={task.step}
                progress={task.progress} goal={task.goal} xp={task.xp} bumps={task.bumps} marketing={task.marketing}
                claimed={task.claimed} claimable={task.claimable}
                onClaim={() => {
                  setCleared((n) => n + 1);
                  void act(() => api.questClaim(task.id));
                }}
                action={task.href ? <Link to={task.href} className="btn btn--sm btn--quiet">Go</Link> : null} />
            ))}
          </ul>
        </section>

      <section className="qpanel">
        <div className="qpanel__head">
          <h3><Glyph name="shield" size={15} /> Honours · {view.stickers.filter((sticker) => sticker.earned).length}/{view.stickers.length}</h3>
          <InfoTip label="About honours">
            <b>Honours</b>
            <p>Badges for your page, each climbing Bronze, Silver, Gold, Platinum and Diamond. Tap one to see what it takes to earn or upgrade it.</p>
          </InfoTip>
        </div>
        <div className="qstickers">
          {[...view.stickers].sort((a, b) => b.tier - a.tier).map((sticker) => (
            <Sticker key={sticker.id} sticker={sticker} onOpen={() => setOpenSticker(sticker)} />
          ))}
        </div>
      </section>

      <HobbyBoards />

      <GamePlayers />

      <section className="qpanel">
        <div className="qpanel__head"><h3>Where your XP came from</h3></div>
        {view.breakdown.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>Nothing yet. Check in, save something, or place an order to start.</p>
        ) : (
          <dl className="qbreak">
            {[...view.breakdown].sort((a, b) => Number(a.xp < 0) - Number(b.xp < 0)).map((line) => (
              <div key={line.label} className={`qbreak__row${line.xp < 0 ? ' is-loss' : ''}`}>
                <dt>{line.label}{line.detail && <small>{line.detail}</small>}</dt>
                <dd>{line.xp > 0 ? '+' : ''}{formatCount(line.xp)} XP</dd>
              </div>
            ))}
            <div className="qbreak__row qbreak__total">
              <dt>Total{view.penalty > 0 && <small>after −{view.penalty} XP of losses</small>}</dt>
              <dd>{formatCount(view.xp)} XP</dd>
            </div>
          </dl>
        )}
      </section>

        <section className="qpanel qrarities">
          <h3>Item rarity</h3>
          <span className="qrarities__list">
            {RARITY_HELP.map((entry) => (
              <span key={entry.tier} className="qrarities__item">
                <span className={`qrarity qrarity--${entry.tier}`}>{entry.label}</span>
                <InfoTip label={`What ${entry.label} means`}>
                  <b>{entry.label}</b>
                  <p>{entry.text}</p>
                  <p>Rarity is worked out from sales, saves, views and fill, and moves as they do. A seller cannot set it.</p>
                </InfoTip>
              </span>
            ))}
          </span>
        </section>
      </div>
      {openSticker && <StickerSheet sticker={openSticker} whose="mine" onClose={() => setOpenSticker(null)} />}
    </main>
  );
}

/**
 * Invite & earn: the two people worth bringing - a friend who will buy, and a
 * seller who will open a shop - each with a picture made to send them. One
 * slim strip; what it pays is behind its ⓘ.
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
      level: { level, title }, title: 'Join me on Figmark', detail: 'Pre-orders · Buyer Protection · hobby leaderboards',
      headline: 'Come shop with me',
    },
    link: { to: 'invite' },
    caption: 'Join me on Figmark - pre-orders from verified import resellers, quests and leaderboards for what you collect. Here is my invite:',
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
    <>
      <InviteStrip
        title="Invite & earn"
        stats={summary ? [
          { value: summary.opens, label: summary.opens === 1 ? 'open' : 'opens' },
          { value: summary.joined, label: 'joined' },
          { value: summary.sellers, label: summary.sellers === 1 ? 'shop' : 'shops' },
        ] : []}
        actions={(
          <>
            <button type="button" className="btn btn--sm mshare__go" onClick={() => open(friend)}>Invite a friend</button>
            <button type="button" className="btn btn--sm btn--quiet" onClick={() => open(seller)}>Invite a seller</button>
          </>
        )}
        info={(
          <>
            <b>Invite &amp; earn</b>
            <p>Every friend who joins with your link climbs Ambassador; every seller who opens a shop climbs Talent Scout.</p>
            <p>Anybody opening what you share counts for Promoter and this week's quest.</p>
            {summary && summary.recent.length > 0 && (
              <p>Recently joined: {summary.recent.map((person) => `${person.name}${person.seller ? ' (shop)' : ''}`).join(', ')}.</p>
            )}
          </>
        )}
      />
      {sheet}
    </>
  );
}

const RARITY_HELP = [
  { tier: 'legendary', label: 'Legendary', text: 'Selling hard, heavily saved, a pre-order 90% full, or a timed drop in its last hours.' },
  { tier: 'epic', label: 'Epic', text: 'Strong demand, a pre-order past 60%, or real interest with under three days on the clock.' },
  { tier: 'new', label: 'New', text: 'Listed or back in stock in the last three days.' },
] as const;

/** Every rank with the levels it covers, the current one marked. */
function RankLadder({ current }: { current: number }) {
  return (
    <ol className="qranks">
      {rankLadder(false).map((rank) => (
        <li key={rank.title} className={current >= rank.from && (rank.to === null || current <= rank.to) ? 'is-me' : ''}>
          <b>{rank.title}</b>
          <small>{rank.to === null ? `Level ${rank.from}+` : rank.from === rank.to ? `Level ${rank.from}` : `Levels ${rank.from}–${rank.to}`}</small>
        </li>
      ))}
    </ol>
  );
}

/**
 * Who is winning the games: competitions, debates and guesses, with every
 * vote cast counting a point - from the same board Discover's "This week" reads.
 */
function GamePlayers() {
  const { user } = useSession();
  const [players, setPlayers] = useState<PlayerRow[] | null>(null);
  useEffect(() => {
    let live = true;
    api.weeklyBest().then((board) => live && setPlayers(board.players ?? [])).catch(() => live && setPlayers([]));
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="qpanel">
      <div className="qpanel__head">
        <h3>🏅 Top players</h3>
        <Link to="/discover#competitions" className="faint">Play</Link>
        <InfoTip label="About top players">
          <b>Top players</b>
          <p>Points from the games: 10 for a competition win, 6 and 4 for second and third, 5 for the best argument or the closest guess, and 1 for every vote.</p>
        </InfoTip>
      </div>
      {!players ? <SkeletonText lines={3} /> : players.length === 0 ? (
        <p className="faint" style={{ margin: 0 }}>Nobody has played yet. Vote in a poll or enter a competition to get on the board.</p>
      ) : (
        <ol className="qleaders">
          {players.map((row, index) => (
            <li key={row.userId} className={row.userId === user?.id ? 'is-me' : ''}>
              <span className={`qleaders__rank qboard__rank--${Math.min(index + 1, 4)}`}>#{index + 1}</span>
              <Avatar name={row.name} size={30} />
              <span className="qleaders__who">
                {row.handle ? <Link to={`/${row.handle}`}>{row.name}</Link> : row.name}
                <small>{row.wins} win{row.wins === 1 ? '' : 's'} · {row.votes} vote{row.votes === 1 ? '' : 's'}</small>
              </span>
              <b className="qleaders__xp">{row.points} pts</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
