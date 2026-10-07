import {
  Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MouseEvent, type PointerEvent, type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdvanceStrip } from '../components/Buy';
import { CONDITION_TAGS, SOURCING_LABELS } from '@shared/enums';
import {
  CATALOG_KINDS, CATALOG_KIND_LABELS, CATALOG_SORTS, CATALOG_SORT_LABELS, CATEGORY_GROUPS, type CatalogKind,
} from '@shared/catalog';
import { sourcingOf } from '@shared/fulfilment';
import { preOrderView } from '@shared/preorder';
import { RARITY_LABELS, dayKey, listingRarity, type ListingRarity, type RarityTier } from '@shared/quest';
import { api, type FeedListing, type FeedResponse } from '../api';
import { CategoryIcon } from '../components/CategoryIcon';
import { EarnPill, earnOf } from '../components/Affiliate';
import {
  DemandRail, EarnRail, EndingRail, FEED_VIEW_TITLES, PreOrderRail, demandPicks, earnPicks, endingPicks, isFeedView,
  preOrderPicks,
} from '../components/FeedRails';
import { DropsStage, FillingBoxes, useFillingLots } from '../components/Showcase';
import { SkeletonGrid } from '../components/Feedback';
import { CardFace, CollectorChip, Glyph, RarityRibbon, StoreChip, XpBar, useQuest } from '../components/Quest';
import { EmptyState, ErrorNotice, LevelChip, Thumb, leadPhoto } from '../components/ui';
import { useSave } from '../components/useSave';
import { formatMoney, timeAgo } from '../format';

export const PRICE_BANDS = [
  { label: 'Under ₹500', value: '50000' },
  { label: 'Under ₹2,000', value: '200000' },
  { label: 'Under ₹10,000', value: '1000000' },
];

/**
 * The catalogue as the URL describes it, and the ways to change it.
 *
 * The unified catalog and the app's landing page.
 *
 * Filters live in the URL, so a filtered view is shareable and the back button
 * behaves. When signed in the ordering is personalised: sellers the account
 * follows surface first.
 */
export function useCatalog() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const search = params.get('q') ?? '';
  const group = params.get('group') ?? '';
  const category = params.get('category') ?? '';
  const condition = params.get('condition') ?? '';
  // Mixed lots are no longer a tab; an old link to them shows everything.
  const kind = params.get('kind') === 'mixed_lot' ? '' : params.get('kind') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const maxPrice = params.get('maxPrice') ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .feed({ q: search, group, category, condition, kind, sort, maxPrice })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [search, group, category, condition, kind, sort, maxPrice]);

  /** Selecting an active filter clears it, so chips toggle. */
  const toggle = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (next.get(key) === value) next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  /**
   * Picking a heading drops the finer category with it.
   *
   * Otherwise "Sneakers & wear" plus a leftover "Scale figures" chip is a
   * filter pair that can only ever return nothing, and an empty page is read as
   * an empty catalog rather than as a contradiction the reader typed.
   */
  const chooseGroup = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.delete('category');
      if (next.get('group') === id || id === '') next.delete('group');
      else next.set('group', id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  /**
   * "All" is a choice, not the absence of one.
   *
   * So it clears the filter outright rather than toggling like the chips below
   * it: a row where the selected chip can be un-selected has a state where
   * nothing is on, and a filter row with nothing on reads as broken.
   */
  const chooseKind = useCallback(
    (entry: string) => {
      const next = new URLSearchParams(params);
      if (entry === 'all') next.delete('kind');
      else next.set('kind', entry);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  /** Sets a filter, or clears it when the empty option is chosen. */
  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (value) next.set(key, value);
      else next.delete(key);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const activeFilters = [group, category, condition, kind, maxPrice].filter(Boolean).length;
  return {
    params, setParams, data, error, loading, setData,
    search, group, category, condition, kind, sort, maxPrice,
    toggle, chooseGroup, chooseKind, set, activeFilters,
  };
}

/**
 * The Buy tab, as a collector's game.
 *
 * Every listing wears a rarity worked out from how it is
 * actually selling (sales, saves, views, how full its pre-order is, and how
 * close its timer is), so "Legendary" is a fact about demand rather than a
 * sticker a seller chose. Above the grid sit only the daily drop and any drop
 * that is on now; the quest board lives on the Quests page, so the first
 * thing to buy is never more than a scroll away.
 */

type Rated = FeedListing & { rarity: ListingRarity };

const RARITY_FILTERS: readonly RarityTier[] = ['legendary', 'epic', 'new'];

export function FeedPage() {
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
  const earn = useMemo(() => earnPicks(rated), [rated]);
  const preOrders = useMemo(() => preOrderPicks(rated), [rated]);
  const base = feedView ? { demand, ending: endingSoon, earn, preorder: preOrders }[feedView] : rated;
  const shown = rarityFilter ? base.filter((listing) => listing.rarity.tier === rarityFilter) : base;
  const [drawn, more] = useProgressive(shown.length, `${params.toString()}`);
  // The shelves sit in the grid after every 4th card, or after the last one
  // when there are fewer.
  const rails = useMemo(() => {
    const last = shown.length - 1;
    return [
      { at: Math.min(3, last), rail: <DemandRail listings={demand} /> },
      { at: Math.min(7, last), rail: <EndingRail listings={endingSoon} now={now} /> },
      { at: Math.min(11, last), rail: <EarnRail listings={earn} /> },
      { at: Math.min(15, last), rail: <PreOrderRail listings={preOrders} now={now} /> },
    ];
  }, [shown.length, demand, endingSoon, earn, preOrders, now]);
  const fillingLots = useFillingLots();

  const browsing = !search && activeFilters === 0 && !rarityFilter && !feedView;
  const counts = useMemo(() => Object.fromEntries(
    RARITY_FILTERS.map((tier) => [tier, rated.filter((listing) => listing.rarity.tier === tier).length]),
  ) as Record<RarityTier, number>, [rated]);

  return (
    <main className="page qfeed">
      <QuestBar />

      {browsing && <DailyDrop listings={rated} now={now} />}
      {/* Drops sit up top, before the catalogue: an event on now beats any one item. */}
      {browsing && <DropsStage />}

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

        {/* How it is sold. How rare it is sits with the other one-of-many
            choices below, as a picker rather than a third row of chips. */}
        <KindTabs value={(kind || 'all') as CatalogKind} onChoose={chooseKind} />
        <div className="filters">
          <Picker label="Sort" icon="sort" value={sort} onChange={(value) => set('sort', value)}
            options={CATALOG_SORTS.map((entry) => ({ value: entry, label: CATALOG_SORT_LABELS[entry] }))} />
          <Picker label="Price" icon="price" value={maxPrice} onChange={(value) => set('maxPrice', value)}
            empty="Any price" options={PRICE_BANDS} />
          <Picker label="Condition" icon="condition" value={condition} onChange={(value) => set('condition', value)}
            empty="Any condition" options={CONDITION_TAGS.map((tag) => ({ value: tag, label: tag }))} />
          <Picker label="Rarity" icon="rarity" value={rarityFilter} onChange={(value) => set('rarity', value)}
            empty="Any rarity"
            options={RARITY_FILTERS.map((tier) => ({ value: tier, label: `${RARITY_LABELS[tier]} · ${counts[tier]}` }))} />
          {data && data.categories.length > 1 && (
            <Picker label="Type" icon="type" value={category} onChange={(value) => set('category', value)}
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

      {browsing && <FillingBoxes lots={fillingLots} />}

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
          {shown.slice(0, drawn).map((listing, n) => (
            <Fragment key={listing.id}>
              <LootCard listing={listing} />
              {browsing && rails.map((entry, r) => entry.at === n && <Fragment key={r}>{entry.rail}</Fragment>)}
            </Fragment>
          ))}
          {drawn < shown.length && <span ref={more} className="qgrid__more" aria-hidden="true" />}
        </div>
      )}
    </main>
  );
}

const PAGE = 24;

/**
 * How many cards to draw: a screenful and a bit, then the next lot as the
 * end comes into view. A hundred cards drawn at once is most of the feed's
 * first paint on a phone, and most of them are never scrolled to. Starts
 * over whenever the filters change.
 */
function useProgressive(total: number, resetKey: string) {
  const [drawn, setDrawn] = useState(PAGE);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const totalRef = useRef(total);
  totalRef.current = total;
  useEffect(() => setDrawn(PAGE), [resetKey]);
  useEffect(() => {
    if (!sentinel) return;
    const watcher = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setDrawn((n) => Math.min(totalRef.current, n + PAGE));
    }, { rootMargin: '600px 0px' });
    watcher.observe(sentinel);
    return () => watcher.disconnect();
  }, [sentinel]);
  return [drawn, setSentinel] as const;
}

/* ── The top bar ───────────────────────────────────────────────────────── */

function QuestBar() {
  const { view } = useQuest();
  const waiting = view ? view.tasks.filter((task) => task.claimable).length + view.packs.length : 0;
  return (
    <div className="qbar qbar--buy">
      {/* You and your shop as one pill; the shop half only when you run one. */}
      <div className="qduo">
        <CollectorChip />
        <StoreChip />
      </div>
      <span className="qbar__spacer" />
      {view && (
        <Link to="/quests" className="btn btn--sm btn--ghost">
          <Glyph name="shield" size={14} /> Quests{waiting > 0 && <span className="qdot">{waiting}</span>}
        </Link>
      )}
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

/* ── One listing ───────────────────────────────────────────────────────── */

/** A pixel heart for saving: hollow until saved, then full. */
const HEART_FULL = 'M1 0h1v1h-1zM2 0h1v1h-1zM6 0h1v1h-1zM7 0h1v1h-1zM0 1h1v1h-1zM1 1h1v1h-1zM2 1h1v1h-1zM3 1h1v1h-1zM5 1h1v1h-1zM6 1h1v1h-1zM7 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM1 2h1v1h-1zM2 2h1v1h-1zM3 2h1v1h-1zM4 2h1v1h-1zM5 2h1v1h-1zM6 2h1v1h-1zM7 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM1 3h1v1h-1zM2 3h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM7 3h1v1h-1zM8 3h1v1h-1zM1 4h1v1h-1zM2 4h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1zM5 6h1v1h-1zM4 7h1v1h-1z';
const HEART_EDGE = 'M1 0h1v1h-1zM2 0h1v1h-1zM6 0h1v1h-1zM7 0h1v1h-1zM0 1h1v1h-1zM3 1h1v1h-1zM5 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM4 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM8 3h1v1h-1zM1 4h1v1h-1zM7 4h1v1h-1zM2 5h1v1h-1zM6 5h1v1h-1zM3 6h1v1h-1zM5 6h1v1h-1zM4 7h1v1h-1z';

function PixelHeart({ full }: { full: boolean }) {
  return (
    <svg width="18" height="16" viewBox="0 0 9 8" shapeRendering="crispEdges" aria-hidden="true">
      {full ? <path d={HEART_FULL} fill="currentColor" /> : <path d={HEART_EDGE} fill="currentColor" />}
      {full ? <path d="M2 1h1v1h-1zM1 2h1v1h-1z" fill="#fff" opacity=".85" /> : null}
    </svg>
  );
}

/** Where each little heart of a save's burst flies to, and how big it is. */
// The button sits in the card's top-right corner, so the burst spills down
// and to the left, into the photo, where none of it is cut off by the edge.
const HEART_BURST = [
  { x: -30, y: -12, s: 0.9, r: -18 }, { x: -40, y: 10, s: 1.1, r: -6 }, { x: -24, y: 30, s: 0.9, r: 12 },
  { x: 0, y: 38, s: 0.75, r: 20 }, { x: 14, y: 24, s: 0.6, r: 28 }, { x: -52, y: -4, s: 0.6, r: -26 },
  { x: -46, y: 34, s: 0.65, r: 8 },
];

/**
 * The save's reward, in the card's own pixel art: little hearts burst out of
 * the button and blink out as they rise, over a quick square ring. Taking a
 * save back drops one grey, broken-looking heart instead.
 */
function HeartPop({ gain }: { gain: boolean }) {
  return (
    <span className={`qpop${gain ? '' : ' qpop--loss'}`} aria-hidden="true">
      {gain && <span className="qpop__ring" />}
      {(gain ? HEART_BURST : [{ x: 0, y: 26, s: 0.9, r: 14 }]).map((spot, i) => (
        <span key={i} className="qpop__heart" style={{
          ['--x' as string]: `${spot.x}px`, ['--y' as string]: `${spot.y}px`,
          ['--s' as string]: spot.s, ['--r' as string]: `${spot.r}deg`, ['--d' as string]: `${i * 25}ms`,
        }}>
          <svg width="9" height="8" viewBox="0 0 9 8" shapeRendering="crispEdges"><path d={HEART_FULL} fill="currentColor" /></svg>
        </span>
      ))}
    </span>
  );
}

/**
 * A listing as a collectible: a frame in its rarity, the condition stamped on
 * like a stamp, the save button as a chest, and a pre-order's fill as a level.
 */
export const LootCard = memo(function LootCard({ listing }: { listing: Rated }) {
  const { refresh } = useQuest();
  // Saves count towards quests, so the level chip is re-read after one.
  const [liked, toggle] = useSave(listing.id, listing.liked, refresh);
  // A save throws a burst of pixel hearts; taking one back drops a grey one.
  const [pop, setPop] = useState<{ id: number; gain: boolean } | null>(null);
  const { rarity } = listing;
  const tier = rarity.tier;
  const view = listing.preOrder ? preOrderView(listing.preOrder) : null;
  const left = listing.quantityMode === 'multiple' ? null : listing.quantityAvailable;
  const wasPrice = rarity.priceDropPercent
    ? Math.max(...(listing.priceHistory ?? []).map((entry) => entry.priceMinor))
    : null;

  function toggleSave(event: MouseEvent) {
    // The card is a link; the heart must not navigate.
    event.preventDefault();
    event.stopPropagation();
    setPop({ id: Date.now(), gain: !liked });
    void toggle();
  }

  return (
    <Link to={`/listing/${listing.id}`} onPointerDown={tapFx}
      className={`qloot qloot--${tier ?? 'plain'}${listing.affiliate ? ' is-affiliate' : ''}`}>
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb qloot__art">
        {tier && <RarityRibbon tier={tier} />}
        <span className="qgrade" title="Condition">{listing.condition}</span>
        <button type="button" className={`qheart${liked ? ' is-on' : ''}`} onClick={toggleSave}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={liked ? 'Remove from your saves' : 'Save'} aria-pressed={liked}>
          <PixelHeart full={liked} />
          {pop && <HeartPop key={pop.id} gain={pop.gain} />}
        </button>
        {rarity.priceDropPercent && <span className="qsticker-tag qsticker-tag--drop">−{rarity.priceDropPercent}%</span>}
        {listing.preOrder && !rarity.priceDropPercent && <span className="qsticker-tag">Pre-order</span>}
      </Thumb>
      {/* Under the picture rather than on it: on the picture it sat on the
          condition stamp. With a booking amount too, the two share one strip
          rather than stacking into two bands of different heights. */}
      {listing.channelDrop && listing.advancePercent ? (
        <span className="qloot__strips">
          <span className="qloot__drop" title="Exclusive channel drop"><Glyph name="bolt" size={11} /><span>Exclusive</span></span>
          <span className="qloot__book" title={`Book with ${listing.advancePercent}% of the price`}>Book {listing.advancePercent}%</span>
        </span>
      ) : listing.channelDrop ? (
        <span className="qloot__drop" title="Exclusive channel drop"><Glyph name="bolt" size={11} /><span>Channel exclusive</span></span>
      ) : (
        <AdvanceStrip percent={listing.advancePercent} />
      )}

      <div className="qloot__body">
        <span className="qloot__title">{listing.title}</span>
        <span className="pricerow">
          <span className="qloot__price">
            {formatMoney(listing.priceMinor, listing.currency)}
            {wasPrice && <s>{formatMoney(wasPrice, listing.currency)}</s>}
          </span>
          <EarnPill amountMinor={earnOf(listing)} currency={listing.currency} />
        </span>
        <span className="qloot__meta">
          {rarity.hoursLeft !== null ? (
            <span className={`qtimer${rarity.hoursLeft <= 24 ? ' qhot' : ''}`}>
              <Glyph name="clock" size={11} />{countdown(rarity.hoursLeft)}
            </span>
          ) : (
            <span className="qtimer qtimer--ago"><Glyph name="clock" size={11} />{timeAgo(listing.bumpedAt ?? listing.createdAt)}</span>
          )}
          {' · '}
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

        {/* The store, then its level under it: side by side they never fit a phone's half-width card. */}
        {listing.seller && (
          <span className="qloot__foot qseller" title={`Trust ${listing.seller.trustScore} of 100`}>
            <span className={`qseller__crest qcrest__mark--${crestFor(listing.seller.trustScore)}`}>
              <Glyph name="crest" size={13} />
              {listing.seller.photoUrl && <StorePic url={listing.seller.photoUrl} />}
            </span>
            <span className="qseller__name">{listing.seller.storefrontName}</span>
            <span className="qseller__lv"><LevelChip tag={listing.seller.level} /></span>
          </span>
        )}
      </div>
    </Link>
  );
// Re-drawn only when something it shows changed: the feed's clock ticks every
// minute, and most cards have nothing on that clock.
}, (before, after) => before.listing.id === after.listing.id
  && before.listing.liked === after.listing.liked
  && JSON.stringify(before.listing.rarity) === JSON.stringify(after.listing.rarity));

/**
 * The store's picture over its crest. The address already comes with the
 * feed, so this costs no request of its own; the picture is lazy, sized, and
 * fades in once it has loaded. Until then, or if it never loads, the crest
 * underneath is what shows.
 */
function StorePic({ url }: { url: string }) {
  const [state, setState] = useState<'wait' | 'ok' | 'gone'>('wait');
  if (state === 'gone') return null;
  return (
    <img className={`qseller__pic${state === 'ok' ? ' is-in' : ''}`} src={url} alt="" width={26} height={26}
      loading="lazy" decoding="async" referrerPolicy="no-referrer"
      onLoad={() => setState('ok')} onError={() => setState('gone')} />
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

/**
 * One choice out of a list, in the width of one chip.
 *
 * A native select rather than a custom menu: on a phone it opens the platform's
 * own picker, which is a better list than anything built here, and it is
 * reachable by keyboard and screen reader without a line of code. The chevron
 * and the pill are ours; the list is the operating system's.
 */
export function Picker({ label, value, onChange, options, empty, icon }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  /** The "no choice" row. Omitted when one of the options is always on. */
  empty?: string;
  icon?: PickerIcon;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <label className={`picker${value ? ' is-on' : ''}${icon ? ' picker--icon' : ''}`} onPointerDown={tapFx}>
      {icon && <span className="picker__icon" aria-hidden="true">{PICKER_ICONS[icon]}</span>}
      {/* Keyed on the value, so a new choice lands with a pop. */}
      <span key={value} className="picker__val">{chosen ? chosen.label : (empty ?? label)}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {empty && <option value="">{empty}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

type PickerIcon = 'sort' | 'price' | 'condition' | 'rarity' | 'type';

const icon = (path: ReactNode) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

const PICKER_ICONS: Record<PickerIcon, ReactNode> = {
  sort: icon(<><path d="M7 4v16M3 16l4 4 4-4" /><path d="M17 20V4M13 8l4-4 4 4" /></>),
  price: icon(<><path d="M6 4h12M6 9h12M9 4c5 0 5 10 0 10H6l9 7" /></>),
  condition: icon(<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />),
  rarity: icon(<path d="M6 3h12l3 6-9 12L3 9z M3 9h18" />),
  type: icon(<><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></>),
};

/** The tabs on the bar: mixed lots were dropped from it. */
const SHOWN_KINDS = CATALOG_KINDS.filter((kind) => kind !== 'mixed_lot');

const KIND_ICONS: Partial<Record<CatalogKind, ReactNode>> = {
  all: icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>),
  pre_order: icon(<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />),
  in_hand: icon(<><path d="M20 6 9 17l-5-5" /></>),
};

/**
 * How it is sold, as a game's tab bar: a lit slot slides under the one
 * chosen, overshooting a touch as it lands, and every tap ripples.
 */
function KindTabs({ value, onChoose }: { value: CatalogKind; onChoose: (kind: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const row = track.current;
    const on = row?.querySelector<HTMLElement>('.qkind.is-on');
    if (!row || !on) return;
    const measure = () => setSlot({ x: on.offsetLeft, w: on.offsetWidth });
    measure();
    // On a narrow phone the row scrolls: bring the chosen tab into view.
    if (row.scrollWidth > row.clientWidth) {
      row.scrollTo({ left: on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
    }
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [value]);

  return (
    <div className="qkinds" role="tablist" aria-label="How it is sold" ref={track}>
      {slot && (
        <span className="qkinds__slot" aria-hidden="true"
          style={{ transform: `translateX(${slot.x}px)`, width: slot.w }}>
          <span key={value} className="qkinds__flash" />
        </span>
      )}
      {SHOWN_KINDS.map((entry, i) => (
        <button key={entry} type="button" role="tab" aria-selected={value === entry}
          className={`qkind${value === entry ? ' is-on' : ''}`} style={{ ['--i' as string]: i }}
          onPointerDown={tapFx} onClick={() => onChoose(entry)}>
          <span className="qkind__icon">{KIND_ICONS[entry]}</span>
          {CATALOG_KIND_LABELS[entry]}
        </button>
      ))}
    </div>
  );
}

/**
 * A ripple from where the finger landed. Added straight to the element rather
 * than through state: it is decoration, and a re-render per tap would be waste.
 */
function tapFx(event: PointerEvent<HTMLElement>) {
  const host = event.currentTarget;
  const box = host.getBoundingClientRect();
  const size = Math.max(box.width, box.height) * 2;
  const wave = document.createElement('span');
  wave.className = 'qripple';
  wave.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - box.left - size / 2}px;top:${event.clientY - box.top - size / 2}px`;
  host.appendChild(wave);
  wave.addEventListener('animationend', () => wave.remove(), { once: true });
  // Reduced motion runs no animation, so nothing would fire animationend.
  window.setTimeout(() => wave.remove(), 800);
}
