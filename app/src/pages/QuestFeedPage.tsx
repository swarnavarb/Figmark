import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { AdvanceStrip, DropTag } from '../components/Buy';
import { Link } from 'react-router-dom';
import { CONDITION_TAGS, SOURCING_LABELS } from '@shared/enums';
import {
  CATALOG_KINDS, CATALOG_KIND_LABELS, CATALOG_SORTS, CATALOG_SORT_LABELS, CATEGORY_GROUPS,
} from '@shared/catalog';
import { sourcingOf } from '@shared/fulfilment';
import { preOrderView } from '@shared/preorder';
import { RARITY_LABELS, dayKey, listingRarity, type ListingRarity, type RarityTier } from '@shared/quest';
import { api, type FeedListing } from '../api';
import { CategoryIcon } from '../components/CategoryIcon';
import {
  DemandRail, EndingRail, FEED_VIEW_TITLES, demandPicks, endingPicks, isFeedView,
} from '../components/FeedRails';
import { SkeletonGrid } from '../components/Feedback';
import {
  CardFace, CollectorChip, DesignSwitch, Glyph, RarityRibbon, XpBar, useQuest, type GlyphName,
} from '../components/Quest';
import { EmptyState, ErrorNotice, Thumb, leadPhoto } from '../components/ui';
import { formatMoney, timeAgo } from '../format';
import { PRICE_BANDS, Picker, useCatalog } from './FeedPage';

/**
 * The Buy tab, as a collector's game.
 *
 * The same catalogue, filters and URL as the classic page - only the reading
 * of it changes. Every listing wears a rarity worked out from how it is
 * actually selling (sales, saves, views, how full its pre-order is, and how
 * close its timer is), so "Legendary" is a fact about demand rather than a
 * sticker a seller chose. Around the grid sit the things that bring somebody
 * back tomorrow: the daily drop, a streak, today's quests, what is filling and
 * what is about to go.
 */

type Rated = FeedListing & { rarity: ListingRarity };

const RARITY_FILTERS: readonly RarityTier[] = ['legendary', 'epic', 'new'];

export function QuestFeedPage() {
  const {
    params, setParams, data, error, loading,
    search, group, category, condition, kind, sort, maxPrice,
    chooseGroup, chooseKind, set, activeFilters,
  } = useCatalog();
  const rarityFilter = (params.get('rarity') ?? '') as RarityTier | '';

  // Read against one clock per render so every card agrees on "now".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const rated: Rated[] = useMemo(
    () => (data?.listings ?? []).map((listing) => ({ ...listing, rarity: listingRarity(listing, now) })),
    [data, now],
  );
  const viewParam = params.get('view') ?? '';
  const feedView = isFeedView(viewParam) ? viewParam : null;
  const demand = useMemo(() => demandPicks(rated), [rated]);
  const endingSoon = useMemo(() => endingPicks(rated, now), [rated, now]);
  const base = feedView === 'demand' ? demand : feedView === 'ending' ? endingSoon : rated;
  const shown = rarityFilter ? base.filter((listing) => listing.rarity.tier === rarityFilter) : base;
  // The shelves sit in the grid after the 4th and the 8th card, or after the
  // last one when there are fewer.
  const demandAt = Math.min(3, shown.length - 1);
  const endingAt = Math.min(7, shown.length - 1);

  const filling = rated
    .filter((listing) => listing.preOrder && !listing.preOrder.closedAt)
    .map((listing) => ({ listing, view: preOrderView(listing.preOrder!) }))
    .filter(({ view }) => view.toGo > 0)
    .sort((a, b) => b.view.committed / b.view.fillThreshold - a.view.committed / a.view.fillThreshold)
    .slice(0, 6);

  const browsing = !search && activeFilters === 0 && !rarityFilter && !feedView;
  const counts = Object.fromEntries(
    RARITY_FILTERS.map((tier) => [tier, rated.filter((listing) => listing.rarity.tier === tier).length]),
  ) as Record<RarityTier, number>;

  const chooseRarity = (tier: RarityTier) => set('rarity', rarityFilter === tier ? '' : tier);

  return (
    <main className="page qfeed">
      <QuestBar />

      {browsing && <DailyDrop listings={rated} now={now} />}
      {browsing && <TodayQuests />}

      <div className="stack" id="catalogue" style={{ marginBottom: 18 }}>
        {/* Zones: what a thing is. Round, like the pin badges they are named after. */}
        <div className="qzones" role="tablist" aria-label="Categories">
          <button type="button" role="tab" aria-selected={group === ''}
            className={`qzone${group === '' ? ' is-on' : ''}`} onClick={() => chooseGroup('')}>
            <span className="qzone__medal qhue--gold"><CategoryIcon id="everything" /></span>
            Everything
          </button>
          {CATEGORY_GROUPS.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={group === entry.id}
              className={`qzone${group === entry.id ? ' is-on' : ''}`} onClick={() => chooseGroup(entry.id)}>
              <span className={`qzone__medal qhue--${entry.hue}`}><CategoryIcon id={entry.id} /></span>
              {entry.label}
            </button>
          ))}
        </div>

        {/* How it is sold, then how rare it is: two questions, one row each. */}
        <div className="chips">
          {CATALOG_KINDS.map((entry) => (
            <button key={entry} type="button"
              className={`chip${(kind || 'all') === entry ? ' is-on' : ''}`}
              onClick={() => chooseKind(entry)}>
              {CATALOG_KIND_LABELS[entry]}
            </button>
          ))}
        </div>
        <div className="chips">
          {RARITY_FILTERS.map((tier) => (
            <button key={tier} type="button" aria-pressed={rarityFilter === tier}
              className={`qrchip qrchip--${tier}${rarityFilter === tier ? ' is-on' : ''}`}
              onClick={() => chooseRarity(tier)}>
              {RARITY_LABELS[tier]} <span>{counts[tier]}</span>
            </button>
          ))}
        </div>

        <div className="filters">
          <Picker label="Sort" value={sort} onChange={(value) => set('sort', value)}
            options={CATALOG_SORTS.map((entry) => ({ value: entry, label: CATALOG_SORT_LABELS[entry] }))} />
          <Picker label="Price" value={maxPrice} onChange={(value) => set('maxPrice', value)}
            empty="Any price" options={PRICE_BANDS} />
          <Picker label="Condition" value={condition} onChange={(value) => set('condition', value)}
            empty="Any condition" options={CONDITION_TAGS.map((tag) => ({ value: tag, label: tag }))} />
          {data && data.categories.length > 1 && (
            <Picker label="Type" value={category} onChange={(value) => set('category', value)}
              empty="Any type" options={data.categories.map((entry) => ({ value: entry, label: entry }))} />
          )}
          {(activeFilters > 0 || rarityFilter || feedView) && (
            <button type="button" className="filters__clear" onClick={() => setParams(
              search ? new URLSearchParams({ q: search }) : new URLSearchParams(), { replace: true },
            )}>
              Clear
            </button>
          )}
        </div>
      </div>

      {browsing && filling.length > 0 && (
        <section className="qrow">
          <div className="qrow__head">
            <h2><Glyph name="flame" size={15} /> Filling now</h2>
            <button type="button" className="qrow__more" onClick={() => chooseKind('pre_order')}>All pre-orders</button>
          </div>
          <div className="qrow__scroll">
            {filling.map(({ listing, view }, index) => (
              <Link key={listing.id} to={`/listing/${listing.id}`} className="qboard">
                <span className={`qboard__rank qboard__rank--${Math.min(index + 1, 4)}`}>#{index + 1}</span>
                <FillRing percent={view.committed / view.fillThreshold} />
                <span className="qboard__text">
                  <b>{listing.title}</b>
                  <small>{view.committed}/{view.fillThreshold} · {view.toGo} to go</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}


      {error && <ErrorNotice message={error} />}

      <div className="qrow__head">
        <h2>{rarityFilter ? `${RARITY_LABELS[rarityFilter]} finds` : feedView ? FEED_VIEW_TITLES[feedView] : 'All loot'}</h2>
        {data && <span className="faint">{shown.length} {shown.length === 1 ? 'item' : 'items'}</span>}
      </div>

      {loading && !data ? (
        <SkeletonGrid count={6} />
      ) : shown.length === 0 ? (
        <EmptyState title={rarityFilter ? `Nothing ${RARITY_LABELS[rarityFilter].toLowerCase()} right now` : 'Nothing matches those filters'}>
          {rarityFilter
            ? 'Rarity moves with demand. Check back as things sell and fill.'
            : activeFilters > 0 || search
              ? 'Try removing a filter or searching for something broader.'
              : 'Be the first to list something.'}
        </EmptyState>
      ) : (
        <div className="grid qgrid">
          {shown.map((listing, n) => (
            <Fragment key={listing.id}>
              <LootCard listing={listing} />
              {browsing && n === demandAt && <DemandRail listings={demand} />}
              {browsing && n === endingAt && <EndingRail listings={endingSoon} now={now} />}
            </Fragment>
          ))}
        </div>
      )}
    </main>
  );
}

/* ── The top bar ───────────────────────────────────────────────────────── */

function QuestBar() {
  const { view, act } = useQuest();
  return (
    <div className="qbar">
      <CollectorChip />
      {view && !view.streak.checkedInToday && (
        <button type="button" className="btn btn--sm qcheckin" onClick={() => void act(api.questCheckIn)}>
          <Glyph name="flame" size={14} /> Check in
        </button>
      )}
      <span className="qbar__spacer" />
      <DesignSwitch />
    </div>
  );
}

/* ── Loot of the day ───────────────────────────────────────────────────── */

/**
 * One listing a day, face down until you flip it - and a free card with it.
 *
 * Chosen from the rarest things in the catalogue by the date, so it is the
 * same pick for everybody all day and a new one tomorrow. Flipping it is the
 * daily reveal: the card is drawn on the server, once, however many times the
 * button is pressed.
 */
function DailyDrop({ listings, now }: { listings: Rated[]; now: number }) {
  const { view, act } = useQuest();
  const [busy, setBusy] = useState(false);

  const pick = useMemo(() => {
    const pool = ['legendary', 'epic'].map((tier) => listings.filter((listing) => listing.rarity.tier === tier))
      .find((group) => group.length > 0) ?? [...listings].sort((a, b) => b.rarity.heat - a.rarity.heat).slice(0, 3);
    if (pool.length === 0) return null;
    const seed = [...dayKey(now)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return pool[seed % pool.length] ?? null;
  }, [listings, now]);

  if (!pick) return null;
  const revealed = Boolean(view?.dailyRevealed);
  const todaysCard = view?.cards.find((card) => card.packId === `daily-${dayKey(now)}`) ?? null;

  async function reveal() {
    setBusy(true);
    await act(api.questReveal, 'Loot revealed');
    setBusy(false);
  }

  return (
    <section className={`qdrop${revealed ? ' is-revealed' : ''}`}>
      <div className={`qflip qdrop__flip${revealed ? ' is-flipped' : ''}`}>
        <div className="qflip__inner">
          <div className="qflip__back" aria-hidden="true"><span>?</span></div>
          <div className="qflip__front">
            {todaysCard ? <CardFace card={todaysCard} size="sm" /> : <span className="qdrop__blank" />}
          </div>
        </div>
      </div>
      <div className="qdrop__body">
        <p className="qdrop__eyebrow">
          <Glyph name="star" size={11} /> Loot of the day · resets in {untilMidnight(now)}
        </p>
        {revealed ? (
          <>
            <h3><Link to={`/listing/${pick.id}`}>{pick.title}</Link></h3>
            <p className="qdrop__meta">
              {pick.rarity.tier && <span className={`qrarity qrarity--${pick.rarity.tier}`}>{RARITY_LABELS[pick.rarity.tier]}</span>}
              {formatMoney(pick.priceMinor, pick.currency)}
              {pick.rarity.reasons[0] && ` · ${pick.rarity.reasons[0]}`}
            </p>
            <Link className="btn btn--sm qbtn-gold" to={`/listing/${pick.id}`}>See it</Link>
          </>
        ) : (
          <>
            <h3>Something rare is waiting</h3>
            <p className="qdrop__meta">Flip it for today&rsquo;s pick and a free collectible card.</p>
            <button type="button" className="btn btn--sm qbtn-gold" disabled={busy || !view} onClick={() => void reveal()}>
              {busy ? 'Revealing…' : 'Reveal now'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/* ── Today's quests, as an arcade quest board ─────────────────────────── */

/** A glyph for each daily task, keyed by what it counts. */
const MISSIONS: Record<string, { glyph: GlyphName }> = {
  checkin: { glyph: 'clock' },
  reveal: { glyph: 'gift' },
  save: { glyph: 'chest' },
  follow: { glyph: 'heart' },
  post: { glyph: 'chat' },
  order: { glyph: 'bag' },
  review: { glyph: 'star' },
  collect: { glyph: 'crown' },
};

function missionOf(id: string) {
  const key = id.replace(/^daily-/, '').replace(/\d+$/, '');
  return MISSIONS[key] ?? { glyph: 'bolt' as GlyphName };
}

/** Time left until the daily quests roll over at midnight, India time. */
function useResetClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const ist = 5.5 * 3600_000;
  const left = 86_400_000 - ((now + ist) % 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(left / 3600_000))}:${pad(Math.floor(left / 60_000) % 60)}:${pad(Math.floor(left / 1000) % 60)}`;
}

type Coin = { id: number; x: number; y: number; sx: number; sy: number; dx: number; dy: number; delay: number };

/**
 * Today's daily tasks as one-line missions over a small side-scrolling
 * scene. Claiming one stamps it CLEAR! and throws a handful of coins at the
 * XP bar, which then fills - the reward is seen landing, not just a number
 * changing.
 */
function TodayQuests() {
  const { view, act } = useQuest();
  const clock = useResetClock();
  const barRef = useRef<HTMLDivElement>(null);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [gain, setGain] = useState<{ id: number; xp: number } | null>(null);
  if (!view) return null;
  const daily = view.tasks.filter((task) => task.kind === 'daily');
  const done = daily.filter((task) => task.claimed).length;
  const waiting = view.tasks.filter((task) => task.claimable).length + view.packs.length;
  const into = view.xp - view.levelFloor;
  const span = view.nextLevelXp - view.levelFloor;

  function claim(event: MouseEvent<HTMLButtonElement>, id: string, xp: number) {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const bar = barRef.current?.getBoundingClientRect();
    if (!still && bar) {
      const from = event.currentTarget.getBoundingClientRect();
      const x = from.left + from.width / 2;
      const y = from.top + from.height / 2;
      const tx = bar.left + Math.min(bar.width, bar.width * view!.progress + 12);
      const ty = bar.top + bar.height / 2;
      const stamp = Date.now();
      setCoins(Array.from({ length: 9 }, (_, i) => {
        const angle = (i / 9) * Math.PI * 2;
        return {
          id: stamp + i, x, y,
          sx: Math.cos(angle) * (26 + (i % 3) * 10), sy: Math.sin(angle) * (22 + (i % 2) * 12) - 18,
          dx: tx - x, dy: ty - y, delay: i * 35,
        };
      }));
      window.setTimeout(() => setCoins([]), 1300);
    }
    setClaiming(id);
    setGain({ id: Date.now(), xp });
    window.setTimeout(() => {
      void act(() => api.questClaim(id)).finally(() => setClaiming(null));
    }, still ? 0 : 750);
  }

  return (
    <section className="qarcade" aria-label="Daily quests">
      <div className="qworld" aria-hidden="true">
        <span className="qworld__block qworld__block--a">?</span>
        <span className="qworld__coin qworld__coin--a" />
        <span className="qworld__pipe" />
        <span className="qworld__block qworld__block--b">?</span>
        <span className="qworld__coin qworld__coin--b" />
        <span className="qworld__hero"><span /></span>
      </div>

      <div className="qarcade__head">
        <span className="qarcade__title"><Glyph name="shield" size={14} /> Daily quests</span>
        <span className="qarcade__reset" title="Daily quests reset at midnight, India time">
          <Glyph name="clock" size={11} /> <b>{clock}</b>
        </span>
        <Link to="/quests" className="qarcade__all">
          {waiting > 0 ? <span className="qdot">{waiting}</span> : null}All &rsaquo;
        </Link>
        <span className="qarcade__hud" title={`${view.title} - ${done}/${daily.length} quests cleared today`}>
          <span className="qarcade__lvl">LV{view.level}</span>
          <span className="qarcade__bar" ref={barRef}>
            <span style={{ width: `${Math.round(Math.min(1, Math.max(0, view.progress)) * 100)}%` }} />
            {gain ? <em key={gain.id} className="qarcade__gain">+{gain.xp}</em> : null}
          </span>
          <span className="qarcade__num">{into}<i>/{span}</i></span>
        </span>
      </div>

      <ul className="qarcade__list">
        {daily.map((task) => {
          const mission = missionOf(task.id);
          const cleared = task.claimed || claiming === task.id;
          const state = cleared ? 'is-clear' : task.claimable ? 'is-ready' : '';
          return (
            <li key={task.id} className={`qmission ${state}`} title={task.blurb}>
              <span className="qmission__icon"><Glyph name={cleared ? 'star' : mission.glyph} size={13} /></span>
              <span className="qmission__title">{task.title}</span>
              {cleared ? (
                <span className="qmission__stamp">Clear!</span>
              ) : task.claimable ? (
                <button type="button" className="qmission__claim" disabled={claiming !== null}
                  onClick={(event) => claim(event, task.id, task.xp)}>
                  +{task.xp} XP
                </button>
              ) : (
                <>
                  <span className="qmission__count">{task.progress}/{task.goal}</span>
                  <span className="qmission__xp">+{task.xp}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {coins.length > 0 ? createPortal(
        <div className="qcoins" aria-hidden="true">
          {coins.map((coin) => (
            <span key={coin.id} className="qcoin" style={{
              left: coin.x, top: coin.y, animationDelay: `${coin.delay}ms`,
              ['--sx' as string]: `${coin.sx}px`, ['--sy' as string]: `${coin.sy}px`,
              ['--dx' as string]: `${coin.dx}px`, ['--dy' as string]: `${coin.dy}px`,
            }} />
          ))}
        </div>,
        document.body,
      ) : null}
    </section>
  );
}

/* ── One listing ───────────────────────────────────────────────────────── */

/**
 * A listing as a collectible: a frame in its rarity, the condition stamped on
 * like a stamp, the save button as a chest, and a pre-order's fill as a level.
 */
function LootCard({ listing }: { listing: Rated }) {
  const { refresh } = useQuest();
  const [liked, setLiked] = useState(listing.liked);
  const [pop, setPop] = useState(0);
  const { rarity } = listing;
  const tier = rarity.tier;
  const view = listing.preOrder ? preOrderView(listing.preOrder) : null;
  const left = listing.quantityMode === 'multiple' ? null : listing.quantityAvailable;
  const wasPrice = rarity.priceDropPercent
    ? Math.max(...(listing.priceHistory ?? []).map((entry) => entry.priceMinor))
    : null;

  async function toggleSave(event: MouseEvent) {
    // The card is a link; the chest must not navigate.
    event.preventDefault();
    event.stopPropagation();
    const next = !liked;
    setLiked(next);
    if (next) setPop((count) => count + 1);
    try {
      const result = await api.like(listing.id);
      setLiked(result.liked);
      void refresh();
    } catch {
      setLiked(!next);
    }
  }

  return (
    <Link to={`/listing/${listing.id}`} className={`qloot qloot--${tier ?? 'plain'}`}>
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb qloot__art">
        {tier && <RarityRibbon tier={tier} />}
        <span className="qgrade" title="Condition">{listing.condition}</span>
        <button type="button" className={`qchest${liked ? ' is-on' : ''}`} onClick={(event) => void toggleSave(event)}
          aria-label={liked ? 'Remove from your vault' : 'Save to your vault'} aria-pressed={liked}>
          <Glyph name="chest" size={16} />
          {pop > 0 && <span key={pop} className="qfloat">+3 XP</span>}
        </button>
        {rarity.priceDropPercent && <span className="qsticker-tag qsticker-tag--drop">−{rarity.priceDropPercent}%</span>}
        {listing.preOrder && !rarity.priceDropPercent && <span className="qsticker-tag">Pre-order</span>}
        <DropTag on={listing.channelDrop} />
      </Thumb>
      <AdvanceStrip percent={listing.advancePercent} />

      <div className="qloot__body">
        <span className="qloot__title">{listing.title}</span>
        <span className="qloot__price">
          {formatMoney(listing.priceMinor, listing.currency)}
          {wasPrice && <s>{formatMoney(wasPrice, listing.currency)}</s>}
        </span>
        <span className="qloot__meta">
          <b className={sourcingOf(listing) === 'in_hand' ? 'qok' : ''}>{SOURCING_LABELS[sourcingOf(listing)]}</b>
          {' · '}{listing.category}
          {left !== null && left > 0 && left <= 5 && <> · <b className="qhot">{left} left</b></>}
          {left === null && ' · plenty'}
        </span>

        {view && (
          <span className="qloot__lv">
            <span className="qloot__lvlabel">LV {view.committed}/{view.fillThreshold}</span>
            <XpBar progress={view.committed / view.fillThreshold} tone={tier === 'legendary' ? 'gold' : 'violet'} />
          </span>
        )}

        {rarity.reasons.length > 0 && (
          <span className="qloot__why">{rarity.reasons.slice(0, 2).join(' · ')}</span>
        )}

        <span className="qloot__foot">
          {rarity.hoursLeft !== null ? (
            <span className={`qtimer${rarity.hoursLeft <= 24 ? ' qhot' : ''}`}>
              <Glyph name="clock" size={12} />{countdown(rarity.hoursLeft)}
            </span>
          ) : (
            <span className="faint">{timeAgo(listing.bumpedAt ?? listing.createdAt)}</span>
          )}
          {listing.seller && (
            <span className="qcrest" title={`Trust ${listing.seller.trustScore} of 100`}>
              <span className={`qcrest__mark qcrest__mark--${crestFor(listing.seller.trustScore)}`}><Glyph name="crest" size={11} /></span>
              {listing.seller.storefrontName}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

function FillRing({ percent }: { percent: number }) {
  const length = 2 * Math.PI * 18;
  const tone = percent >= 0.9 ? 'var(--coral)' : percent >= 0.6 ? 'var(--q-gold)' : 'var(--violet-text)';
  return (
    <svg className="qboard__ring" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" fill="none" stroke="var(--q-track)" strokeWidth="5" />
      <circle cx="22" cy="22" r="18" fill="none" stroke={tone} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${Math.min(1, percent) * length} ${length}`} transform="rotate(-90 22 22)" />
      <text x="22" y="26" textAnchor="middle">{Math.round(Math.min(1, percent) * 100)}%</text>
    </svg>
  );
}

/** A seller's trust as a rank crest: bronze, silver, gold. */
function crestFor(score: number): 'gold' | 'silver' | 'bronze' {
  return score >= 85 ? 'gold' : score >= 65 ? 'silver' : 'bronze';
}

function countdown(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.floor(hours)}h ${Math.floor((hours % 1) * 60)}m`;
  return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
}

/** Time until the India day turns, when the drop and the dailies reset. */
function untilMidnight(now: number): string {
  const ist = now + 5.5 * 3_600_000;
  const next = Math.ceil(ist / 86_400_000) * 86_400_000;
  const minutes = Math.max(1, Math.round((next - ist) / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
