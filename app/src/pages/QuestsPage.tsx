import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ACTION_CAP, ACTION_XP, CARDS, CARD_SETS, MAX_LEVEL, SET_BONUS_XP, type CardDef, type StickerView, type TaskKind,
} from '@shared/quest';
import type { StoreAccess } from '@shared/stores';
import { api, type InviteSummary, type LeaderRow } from '../api';
import { useShareSheet, type ShareSpec } from '../components/ShareKit';
import { SkeletonText } from '../components/Feedback';
import {
  CardFace, CardSheet, CardSlot, Glyph, Sticker, StickerSheet, useQuest,
} from '../components/Quest';
import { BoardHead, InfoTip, InviteStrip, NoBumpsNotice, QuestHero, QuestRow, QuestTabs } from '../components/QuestKit';
import { Avatar } from '../components/ui';
import { QuestShooter } from '../components/QuestShooter';
import { ShopQuests } from '../components/ShopQuests';
import { useSession } from '../session';

/**
 * Quests: where the collector game is played rather than glimpsed.
 *
 * Top to bottom in the order somebody acts on it - who you are in the game,
 * whether you have kept your streak, anything waiting to be opened or
 * collected, what to do next, what you have collected, and how you compare.
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
  const { view, act, refresh } = useQuest();
  const [tab, setTab] = useState<TaskKind>('daily');
  /** Quests cleared on this visit: each one fires a burst in the arcade. */
  const [cleared, setCleared] = useState(0);
  const [openCard, setOpenCard] = useState<CardDef | null>(null);
  const [openSticker, setOpenSticker] = useState<StickerView | null>(null);
  const [board, setBoard] = useState<{ top: LeaderRow[]; me: LeaderRow | null; total: number } | null>(null);
  const [stores, setStores] = useState<StoreAccess[]>([]);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    void refresh();
    void api.leaderboard().then(setBoard).catch(() => setBoard(null));
    void api.stores().then(({ stores: mine }) => setStores(mine)).catch(() => setStores([]));
  }, [refresh]);

  const shop = stores.find((store) => store.ownerId === params.get('shop')) ?? null;
  const noBumps = params.get('nobump') === '1';
  const notice = noBumps && (
    <NoBumpsNotice onClose={() => setParams((current) => { current.delete('nobump'); return current; }, { replace: true })} />
  );
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
          {store.name}
        </button>
      ))}
    </div>
  );
  const bar = (
    <div className="qbar">
      <h1 className="qpage__title">Quests</h1>
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
    return <main className="page qpage">{bar}<SkeletonText lines={6} /></main>;
  }

  const tasks = view.tasks.filter((task) => task.kind === tab);
  const ready = (kind: TaskKind) => view.tasks.filter((task) => task.kind === kind && task.claimable).length;

  return (
    <main className="page qpage">
      {bar}
      {notice}
      <div className="qside">
        <QuestHero
          side="you" eyebrow={`Level ${view.level}`} title={view.title} level={view.level} progress={view.progress}
          xp={view.xp} toNext={view.level >= MAX_LEVEL ? null : view.nextLevelXp - view.xp} nextLevel={view.level + 1} bumps={view.bumps}
          info={(
            <>
              <b>How you level</b>
              <p>XP comes from what you do here: orders, reviews, sharing, check-ins, quests, cards and complete sets. Most counted actions pay {ACTION_XP} XP each, up to {ACTION_CAP} of a kind.</p>
              <p>Every level opens a card pack{(view.level + 1) % 5 === 0 ? ' - the next one is epic or better' : ', and every fifth is epic or better'}.</p>
              <p>Low ratings from sellers and lost disputes take XP away, so a level says how you trade.</p>
            </>
          )}
        />

        <section className="qpanel qstreak">
          <span className="qstreak__flame"><Glyph name="flame" size={18} /><b>{view.streak.current}</b></span>
          <span className="qstreak__body">
            <span className="qstreak__head">
              <b>day streak</b>
              <span className="faint">best {view.streak.best}</span>
              <InfoTip label="About streaks">
                <b>Streaks</b>
                <p>Check in once a day, India time, for {ACTION_XP} XP. Days in a row climb the On Fire milestone: 7, 30 and 100 days.</p>
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
              Check in · +{ACTION_XP}
            </button>
          ) : <span className="qok qstreak__done">✓ Today</span>}
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
          <BoardHead info={(
            <>
              <b>Your quests</b>
              <p>Daily: Check in, Reveal and Share a find every day, plus two that change daily. They reset at midnight, India time.</p>
              <p>Weekly: five check-ins and two people opening your links, plus three that change each Monday. Monthly: bring a friend, plus three bigger goals that change on the 1st.</p>
              <p>Each weekly quest pays 1 bump point and each monthly one pays 2. Milestones pay once a step and come with a card pack.</p>
            </>
          )} />
          <QuestTabs tab={tab} onTab={setTab} ready={ready} />
          <ul className="qtasks">
            {tasks.map((task) => (
              <QuestRow key={task.id}
                title={task.title} blurb={task.blurb} step={task.step}
                progress={task.progress} goal={task.goal} xp={task.xp} bumps={task.bumps} pack={task.pack}
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
          <h3><Glyph name="card" size={15} /> Cards · {new Set(view.cards.map((card) => card.id)).size}/{CARDS.length}</h3>
          <span className="faint">{view.cards.length} pulled</span>
          <InfoTip label="About cards">
            <b>Cards</b>
            <p>Cards come from the daily Reveal, every level and every milestone. Each card is worth {ACTION_XP} XP. Finish a set of six for {SET_BONUS_XP} XP and its Master sticker.</p>
            <p>Tap a card to read it.</p>
          </InfoTip>
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
      </section>

      <section className="qpanel">
        <div className="qpanel__head">
          <h3><Glyph name="shield" size={15} /> Stickers · {view.stickers.filter((sticker) => sticker.earned).length}/{view.stickers.length}</h3>
          <InfoTip label="About stickers">
            <b>Stickers</b>
            <p>Badges for your page, from Bronze to Gold. Tap one to see what it takes to earn or upgrade it.</p>
          </InfoTip>
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
          <InfoTip label="About the leaderboard">
            <b>Top collectors</b>
            <p>Everybody playing, ranked by XP. You always see your own place, even outside the top.</p>
          </InfoTip>
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
    <>
      <InviteStrip
        title="Invite & earn"
        stats={summary ? [
          { value: summary.opens, label: 'opens' },
          { value: summary.joined, label: 'joined' },
          { value: summary.sellers, label: 'shops' },
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
