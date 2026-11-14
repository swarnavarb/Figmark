import { ProBadge } from '../components/Billing';
import { ShippingChip, WholesaleChip } from '../components/Offers';
import { wholesaleHint } from '@shared/offers';
import { useNow } from '../clock';
import {
  Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MouseEvent, type PointerEvent, type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdvanceStrip } from '../components/Buy';
import { SOURCING_LABELS } from '@shared/enums';
import { advanceMinor } from '@shared/payments';
import {
  CATALOG_KINDS, CATALOG_KIND_LABELS, CATALOG_SORTS, CATALOG_SORT_LABELS, CATEGORY_GROUPS, CONDITION_BUCKETS, categoriesIn, factsOf, filterOptions, matchesKind, priceCeiling,
  type CatalogKind,
} from '@shared/catalog';
import { isTakingBookings, preOrderView } from '@shared/preorder';
import { RARITY_LABELS, XP, dayKey, listingRarity, type ListingRarity, type RarityTier } from '@shared/quest';
import { api, type FeedListing, type FeedResponse, type ShopCard } from '../api';
import { ShopStrip, ShopsForYou, useShopsForYou } from '../components/ShopCards';
import { ServiceGrid, ServiceStrip, searchWants, useProviders, useStudioSearch } from '../components/ServiceCards';
import { CategoryIcon } from '../components/CategoryIcon';
import {
  DemandRail, EarnRail, EndingRail, FEED_VIEW_TITLES, PreOrderRail, demandPicks, earnPicks, endingPicks, isFeedView,
  preOrderPicks,
} from '../components/FeedRails';
import { DropsStage, FillingBoxes, useDrops, useFillingLots } from '../components/Showcase';
import { SkeletonGrid } from '../components/Feedback';
import { ActiveOrders } from '../components/ActiveOrders';
import { SkelBlock } from '../components/PageSkeletons';
import { Glyph, RarityRibbon, XpBar, useQuest } from '../components/Quest';
import { EmptyState, ErrorNotice, Icon, Thumb, leadPhoto } from '../components/ui';
import { useSave } from '../components/useSave';
import { formatMoney } from '../format';
import { useRecentlyViewed } from '../recentViews';
import {
  AlertMe, DAY_CHOICES, FilterChips, FilterSheet, RecentRail, ShopSearch, priceLabel, sheetCount, type FilterValues,
} from '../components/ShopFinder';
import { clearPhotoQuery, usePhotoQuery } from '../photoQuery';
import '../styles/FeedPage.css';
import { Select } from '../components/Select';

/**
 * The catalogue as the URL describes it, and the ways to change it.
 *
 * The unified catalog and the app's landing page.
 *
 * Filters live in the URL, so a filtered view is shareable and the back button
 * behaves. "Newest" is the same for everyone: the latest listed or bumped
 * item leads, whoever the reader follows.
 */
/** Listings per catalogue page, as the API counts them. */
const CATALOG_PAGE = 100;
/** The API's own ceiling (400 listings). */
const CATALOG_MAX_PAGES = 4;

export function useCatalog() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const search = params.get('q') ?? '';
  const group = params.get('group') ?? '';
  const category = params.get('category') ?? '';
  const condition = params.get('condition') ?? '';
  // What the chosen heading asks about: the kind of thing, whether it is the
  // real thing, and the size. Only offered once a heading is chosen, because
  // "size" means nothing across figures and sneakers at once.
  const type = params.get('type') ?? '';
  const size = params.get('size') ?? '';
  const authenticity = params.get('authenticity') ?? '';
  // Mixed lots are no longer a tab; an old link to them shows everything.
  const kind = params.get('kind') === 'mixed_lot' ? '' : params.get('kind') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const maxPrice = params.get('maxPrice') ?? '';
  const minPrice = params.get('minPrice') ?? '';
  // Asked of the shop and its promise rather than the item: how far it is
  // trusted, and how soon it says the parcel arrives.
  const minTrust = params.get('minTrust') ?? '';
  const maxDays = params.get('maxDays') ?? '';
  // A photo search: the URL names it, the photo itself is only ever in memory.
  const photoId = params.get('photo') ?? '';
  const photo = usePhotoQuery(photoId);
  const [photoFound, setPhotoFound] = useState<FeedListing[] | null>(null);

  // A reload forgets the photo; the catalogue it leaves behind is the ordinary one.
  useEffect(() => {
    if (!photoId || photo) return;
    const next = new URLSearchParams(params);
    next.delete('photo');
    setParams(next, { replace: true });
  }, [photoId, photo, params, setParams]);

  // Sent once per photo; the filters below narrow what came back without
  // sending the photo again.
  useEffect(() => {
    setPhotoFound(null);
    if (!photo) return;
    let cancelled = false;
    setLoading(true);
    void api
      .photoSearch(photo.dataUrl)
      .then((result) => {
        if (cancelled) return;
        setPhotoFound(result.listings);
        setError(null);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [photo]);

  const photoData: FeedResponse | null = useMemo(() => {
    if (!photoFound) return null;
    const inGroup = group ? new Set(categoriesIn(group)) : null;
    const ceiling = priceCeiling(maxPrice);
    const floor = priceCeiling(minPrice);
    const listings = photoFound.filter((listing) =>
      (!inGroup || inGroup.has(listing.category))
      && (!category || listing.category === category)
      && (!condition || listing.condition === condition)
      && (!type || listing.attributes?.['type'] === type)
      && (!size || listing.attributes?.['size'] === size)
      && matchesAuthenticity(listing, authenticity)
      && (!kind || matchesKind(listing, kind))
      && (ceiling === undefined || listing.priceMinor <= ceiling)
      && (floor === undefined || listing.priceMinor >= floor)
      && (!Number(minTrust) || (listing.seller?.trustScore ?? 0) >= Number(minTrust))
      && (!Number(maxDays) || (listing.deliveryEta != null && listing.deliveryEta.maxDays <= Number(maxDays))));
    // Best match first unless a price order was asked for.
    if (sort === 'price_asc') listings.sort((a, b) => a.priceMinor - b.priceMinor);
    if (sort === 'price_desc') listings.sort((a, b) => b.priceMinor - a.priceMinor);
    return { listings, categories: [...new Set(listings.map((l) => l.category))].sort(), followedSellerIds: [] };
  }, [photoFound, group, category, condition, type, size, authenticity, kind, maxPrice, minPrice, minTrust, maxDays, sort]);

  // How many pages of the catalogue are asked for: "Show more" adds one, and
  // any change of filter starts again from the first.
  const [pages, setPages] = useState(1);
  const filters = `${search}|${group}|${category}|${condition}|${type}|${size}|${authenticity}|${kind}|${sort}|${maxPrice}|${minPrice}|${minTrust}|${maxDays}`;
  const [pagesFor, setPagesFor] = useState(filters);
  if (pagesFor !== filters) {
    setPagesFor(filters);
    setPages(1);
  }
  const showMore = useCallback(() => setPages((count) => Math.min(CATALOG_MAX_PAGES, count + 1)), []);

  useEffect(() => {
    if (photoId) return;
    let cancelled = false;
    setLoading(true);
    void api
      .feed({
        q: search, group, category, condition, type, size, authenticity, kind, sort, maxPrice,
        minPrice: minPrice || undefined, minTrust: minTrust || undefined, maxDays: maxDays || undefined,
        limit: pages > 1 ? String(pages * CATALOG_PAGE) : undefined,
      })
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
  }, [photoId, search, group, category, condition, type, size, authenticity, kind, sort, maxPrice, minPrice, minTrust, maxDays, pages]);

  /** Back to the ordinary catalogue, with the filters as they are. */
  const clearPhoto = useCallback(() => {
    clearPhotoQuery();
    const next = new URLSearchParams(params);
    next.delete('photo');
    setParams(next, { replace: true });
  }, [params, setParams]);

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
   * Otherwise "Sneakers & wear" plus a leftover "Figures" chip is a
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

  const activeFilters = [group, category, condition, type, size, authenticity, kind, maxPrice, minPrice, minTrust, maxDays]
    .filter(Boolean).length;
  return {
    params, setParams, data: photoId ? photoData : data, error, loading, setData,
    // More to come: the server said this is not every match, and there is room to ask for more.
    canShowMore: !photoId && data?.complete === false && pages < CATALOG_MAX_PAGES, showMore,
    search, group, category, condition, type, size, authenticity, kind, sort, maxPrice, minPrice, minTrust, maxDays,
    photo, clearPhoto,
    toggle, chooseGroup, chooseKind, set, activeFilters,
  };
}

/**
 * The Buy tab, as a collector's game.
 *
 * Every listing wears a rarity worked out from how it is
 * actually selling (sales, saves, views, how full its pre-order is, and how
 * close its timer is), so "Legendary" is a fact about demand rather than a
 * sticker a seller chose. Above the grid sit only the search, the daily pick
 * and any drop that is on now; everything else - lots filling up, shops for
 * you, what you looked at lately - is a shelf between rows of items, so the
 * first thing to buy is never more than a scroll away.
 */

type Rated = FeedListing & { rarity: ListingRarity };

const RARITY_FILTERS: readonly RarityTier[] = ['legendary', 'epic', 'new'];

/** The filters the sheet holds, by their URL name. */
const SHEET_KEYS = ['category', 'condition', 'type', 'size', 'authenticity', 'rarity', 'minPrice', 'maxPrice', 'minTrust', 'maxDays'] as const;

export function FeedPage() {
  const {
    params, setParams, data, error, loading,
    search, group, category, condition, type, size, authenticity, kind, sort, maxPrice, minPrice, minTrust, maxDays,
    photo, clearPhoto,
    chooseGroup, chooseKind, set, activeFilters,
    canShowMore, showMore,
  } = useCatalog();
  const rarityFilter = (params.get('rarity') ?? '') as RarityTier | '';
  const [sheetOpen, setSheetOpen] = useState(false);

  // Read against one clock per render so every card agrees on "now".
  const now = useNow(60_000);

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
  const [drawn, sentinel] = useProgressive(shown.length, `${params.toString()}`);
  const fillingLots = useFillingLots();
  const drops = useDrops();
  const recent = useRecentlyViewed();

  /* Shops alongside items: the ones known for what was searched, and when
     just browsing, the ones this buyer's likes and purchases point to. */
  const [searchShops, setSearchShops] = useState<ShopCard[] | null>(null);
  const forYou = useShopsForYou();
  useEffect(() => {
    setSearchShops(null);
    if (!search) return;
    const controller = new AbortController();
    void api.searchShops(search, controller.signal).then((result) => setSearchShops(result.shops)).catch(() => undefined);
    return () => controller.abort();
  }, [search]);

  // The categories under the chosen heading, and what a buyer can narrow them by.
  const members = group ? categoriesIn(group) : [];
  const typeOptions = filterOptions(members, 'type');
  const sizeOptions = filterOptions(members, 'size');
  const authenticityOptions = [
    { value: 'genuine', label: 'Original / official only' },
    { value: 'copies', label: 'Copies only' },
    ...filterOptions(members, 'authenticity').map((option) => ({ value: option.value, label: option.value })),
  ];
  // Across every heading only the two broad answers make sense; the specific
  // grades ("7A", "Batch / 1:1") appear once a heading narrows what is meant.
  const authenticityChoices = group ? authenticityOptions : authenticityOptions.slice(0, 2);

  const browsing = !search && !photo && activeFilters === 0 && !rarityFilter && !feedView;

  /* The page fills top to bottom: the daily pick, the drops, then the grid. A
     section waits for the ones above it, so nothing that answers late pushes
     down what is already being read. */
  const answered = Boolean(data) || Boolean(error);
  const [showDaily, showDrops, showGrid] = useCascade([
    !browsing || answered,
    !browsing || drops !== null,
    answered || !loading,
  ]);
  const pending = <><SkelBlock h={112} /><SkeletonGrid count={4} /></>;

  // The chosen badge in view: most categories sit past the edge on a phone.
  const zonesRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = zonesRef.current;
    const on = row?.querySelector<HTMLElement>('.qzone.is-on');
    if (!row || !on || row.scrollWidth <= row.clientWidth) return;
    const left = on.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + on.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: left - (row.clientWidth - on.offsetWidth) / 2 });
    }
  }, [group]);

  // A search for a repaint or a forwarder is asking for a person: the studios or routes first.
  const providers = useProviders();
  const wants = search && !photo ? searchWants(search) : null;
  const studioHits = useStudioSearch(wants === 'artist' ? search : null);
  // What has loaded is not everything there is: counts say so with a "+".
  const more = !photo && data?.complete === false;
  const counts = useMemo(() => Object.fromEntries(
    RARITY_FILTERS.map((tier) => [tier, rated.filter((listing) => listing.rarity.tier === tier).length]),
  ) as Record<RarityTier, number>, [rated]);
  // What this search mostly found, to guess the category an alert is for.
  const seenCategories = useMemo(() => {
    const tally = new Map<string, number>();
    for (const listing of shown) tally.set(listing.category, (tally.get(listing.category) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [shown]);

  /* The shelves, each after a row of items: what you looked at, what is
     selling, lots filling up, what is ending, shops for you, then the rest. */
  const shelves = useMemo(() => {
    const last = shown.length - 1;
    const after = (n: number) => Math.min(n, last);
    return [
      { at: after(1), node: <RecentRail items={recent} /> },
      { at: after(3), node: <DemandRail listings={demand} /> },
      { at: after(5), node: fillingLots && fillingLots.length > 0
        ? <div className="qshelf-wide"><FillingBoxes lots={fillingLots} /></div> : null },
      { at: after(7), node: <EndingRail listings={endingSoon} now={now} /> },
      { at: after(9), node: forYou && forYou.length > 0
        ? <div className="qshelf-wide"><ShopsForYou shops={forYou} /></div> : null },
      { at: after(11), node: <EarnRail listings={earn} /> },
      { at: after(15), node: <PreOrderRail listings={preOrders} now={now} /> },
    ];
  }, [shown.length, recent, demand, fillingLots, endingSoon, forYou, earn, preOrders, now]);

  /* Filters: the sheet's values, and a chip for each one that is on. */
  const values: FilterValues = { category, condition, type, size, authenticity, rarity: rarityFilter, minPrice, maxPrice, minTrust, maxDays };
  const setMany = (changes: Partial<Record<string, string>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const clearFilters = () => setMany({
    ...Object.fromEntries(SHEET_KEYS.map((key) => [key, ''])), view: '',
  });
  const option = (list: readonly { value: string; label: string }[], value: string) =>
    list.find((entry) => entry.value === value)?.label ?? value;
  const chips = [
    feedView && { key: 'view', label: FEED_VIEW_TITLES[feedView], clear: () => set('view', '') },
    (minPrice || maxPrice) && { key: 'price', label: priceLabel(minPrice, maxPrice), clear: () => setMany({ minPrice: '', maxPrice: '' }) },
    category && { key: 'category', label: category, clear: () => set('category', '') },
    condition && { key: 'condition', label: CONDITION_BUCKETS[condition as keyof typeof CONDITION_BUCKETS]?.label ?? condition, clear: () => set('condition', '') },
    authenticity && { key: 'authenticity', label: option(authenticityOptions, authenticity), clear: () => set('authenticity', '') },
    maxDays && { key: 'maxDays', label: `Arrives within ${option(DAY_CHOICES, maxDays).toLowerCase()}`, clear: () => set('maxDays', '') },
    minTrust && { key: 'minTrust', label: `Trust ${minTrust}+`, clear: () => set('minTrust', '') },
    rarityFilter && { key: 'rarity', label: RARITY_LABELS[rarityFilter], clear: () => set('rarity', '') },
    type && { key: 'type', label: option(typeOptions, type), clear: () => set('type', '') },
    size && { key: 'size', label: option(sizeOptions, size), clear: () => set('size', '') },
  ].filter((chip): chip is { key: string; label: string; clear: () => void } => Boolean(chip));
  const onSheet = sheetCount(values);

  return (
    <main className="page qfeed">
      {/* The catalogue's cards are its heading; this names the page for screen readers. */}
      <h1 className="sr-only">Shop</h1>
      <ShopSearch value={search} onSearch={(term) => set('q', term)} />
      {/* Orders still on their way, first: after paying, "where is it?" is the question. */}
      {browsing && <ActiveOrders />}

      {/* Until a section can show, its place holds a skeleton and nothing below it draws. */}
      {!showDaily && pending}
      {browsing && showDaily && <DailyDrop listings={rated} now={now} />}
      {/* Drops sit up top, before the catalogue: an event on now beats any one item. */}
      {showDaily && !showDrops && pending}
      {browsing && showDrops && <DropsStage drops={drops} />}

      {showDrops && (
      <div className="stack" id="catalogue" style={{ marginBottom: 14 }}>
        {/* Zones: what a thing is. Round, like the pin badges they are named after. */}
        <div className="qzones" role="tablist" aria-label="Categories" ref={zonesRef}>
          <button type="button" role="tab" aria-selected={group === ''}
            className={`qzone${group === '' ? ' is-on' : ''}`} onClick={() => chooseGroup('')}>
            <span className="qzone__medal qhue--gold"><CategoryIcon id="everything" /></span>
            <span className="qzone__label">Everything</span>
          </button>
          {CATEGORY_GROUPS.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={group === entry.id}
              className={`qzone${group === entry.id ? ' is-on' : ''}`} onClick={() => chooseGroup(entry.id)}>
              <span className={`qzone__medal qhue--${entry.hue}`}><CategoryIcon id={entry.id} /></span>
              <span className="qzone__label">{entry.label}</span>
            </button>
          ))}
        </div>

        {/* How it is sold, then the order, then every other filter behind one button. */}
        <KindTabs value={(kind || 'all') as CatalogKind} onChoose={chooseKind} />
        <div className="filters">
          <Picker label="Sort" icon="sort" value={sort} onChange={(value) => set('sort', value)}
            options={CATALOG_SORTS.map((entry) => ({ value: entry, label: CATALOG_SORT_LABELS[entry] }))} />
          <button type="button" className={`filters__open${onSheet > 0 ? ' is-on' : ''}`} onPointerDown={tapFx}
            onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
            <Icon name="filter" size={13} /> Filters
            {onSheet > 0 && <span className="filters__count">{onSheet}</span>}
          </button>
        </div>
        <FilterChips chips={chips} onClearAll={clearFilters} />
      </div>
      )}
      {sheetOpen && (
        <FilterSheet values={values} set={(key, value) => set(key, value)} setMany={setMany} onClose={() => setSheetOpen(false)}
          total={shown.length} more={more} categories={data?.categories ?? []}
          typeOptions={typeOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
          sizeOptions={sizeOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
          authenticityOptions={authenticityChoices} rarityCounts={counts} />
      )}

      {wants === 'artist' && <ServiceStrip title="Artists who do this" sub="Restore, repaint, customise" picks={studioHits} />}
      {wants === 'forwarder' && <ServiceStrip title="Forwarders" sub="Routes, days and price per kg" picks={providers.forwarders} />}
      {search && !photo && <ShopStrip title={`Shops for “${search}”`} sub="Known for it by name, tags or what they list" shops={searchShops} />}

      {showGrid && error && <ErrorNotice message={error} />}

      <div className="qrow__head">
        {photo ? (
          <h2 className="qphoto">
            <img loading="lazy" decoding="async" src={photo.dataUrl} alt="" />
            Your photo
            <button type="button" className="qphoto__clear" aria-label="Clear photo search" onClick={clearPhoto}>
              <Icon name="close" size={12} />
            </button>
          </h2>
        ) : (
          <h2>{search ? `“${search}”` : rarityFilter ? `${RARITY_LABELS[rarityFilter]} finds` : feedView ? FEED_VIEW_TITLES[feedView] : 'All items'}</h2>
        )}
        <span className="qrow__side">
          {data && <span className="faint">{shown.length}{more ? '+' : ''} {shown.length === 1 && !more ? 'item' : 'items'}</span>}
          {search && !photo && <AlertMe search={search} category={category} maxPrice={maxPrice} condition={condition} seen={seenCategories} />}
        </span>
      </div>

      {!showGrid || (loading && !data) ? (
        <SkeletonGrid count={6} />
      ) : shown.length === 0 ? (
        <>
        <EmptyState title={photo ? 'Nothing like your photo yet'
          : rarityFilter ? `Nothing ${RARITY_LABELS[rarityFilter].toLowerCase()} right now`
          : browsing ? 'Nothing for sale yet' : 'Nothing matches those filters'}>
          {photo
            ? 'Try another photo, or search with words instead.'
            : rarityFilter
            ? 'Rarity moves with demand. Check back as things sell and fill.'
            : search
              ? 'Try something broader, or press “Alert me” to be told when a shop lists it.'
              : activeFilters > 0
                ? 'Try removing a filter.'
                : 'Be the first to list something.'}
        </EmptyState>
        {/* No items to show, but the people offering services are still worth knowing about. */}
        {browsing && <ServiceGrid providers={providers} />}
        </>
      ) : (
        <div className="grid qgrid">
          {shown.slice(0, drawn).map((listing, n) => (
            <Fragment key={listing.id}>
              <LootCard listing={listing} priority={n < 2} />
              {browsing && shelves.map((entry, r) => entry.at === n && entry.node && <Fragment key={r}>{entry.node}</Fragment>)}
            </Fragment>
          ))}
          {drawn < shown.length && <span ref={sentinel} className="qgrid__more" aria-hidden="true" />}
        </div>
      )}
      {drawn >= shown.length && canShowMore && (
        <div className="qgrid__showmore">
          <button type="button" className="btn btn--ghost" onClick={showMore} disabled={loading}>
            {loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </main>
  );
}

const PAGE = 24;

/** Longest a slow section holds back the ones below it. */
const CASCADE_WAIT_MS = 1200;

/**
 * Which sections may show, given which have their answers, top to bottom: a
 * section shows once it is ready and every one above it shows. Once shown it
 * stays, whatever reloads later. After CASCADE_WAIT_MS a section still waiting
 * stops holding back the ones below it.
 */
function useCascade(ready: boolean[]): boolean[] {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), CASCADE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const shown = useRef<boolean[]>([]);
  let above = true;
  return ready.map((isReady, n) => {
    above = above && (isReady || waited || Boolean(shown.current[n]));
    if (above) shown.current[n] = true;
    return above;
  });
}

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

/* ── Loot of the day ───────────────────────────────────────────────────── */

/**
 * One listing a day, face down until you flip it.
 *
 * Chosen from the rarest things in the catalogue by the date, so it is the
 * same pick for everybody all day and a new one tomorrow. Flipping it is the
 * daily reveal: the server records the day once, however many times the
 * button is pressed, and pays its XP once.
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

  // Flipped already: the reveal has had its moment, so it is one line, not a stage.
  if (revealed) {
    return (
      <Link to={`/listing/${pick.id}`} className="qdropline">
        <span className="qdropline__mark" aria-hidden="true"><Glyph name="star" size={13} /></span>
        <span className="qdropline__label">Today&rsquo;s pick</span>
        <span className="qdropline__title">{pick.title}</span>
        <b className="qdropline__price">{formatMoney(pick.priceMinor, pick.currency)}</b>
        <Icon name="chevron" size={14} className="qdropline__go" />
      </Link>
    );
  }

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
            {revealed && pick.rarity.tier
              ? <span className="qdrop__face"><Glyph name="star" size={28} /><RarityRibbon tier={pick.rarity.tier} /></span>
              : <span className="qdrop__blank" />}
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
            <p className="qdrop__meta">Flip it for today&rsquo;s pick and +{XP.reveal} XP.</p>
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
export const LootCard = memo(function LootCard({ listing, priority = false }: { listing: Rated; priority?: boolean }) {
  const { refresh } = useQuest();
  // Saves count towards quests, so the level chip is re-read after one.
  const [liked, toggle] = useSave(listing.id, listing.liked, refresh);
  // A save throws a burst of pixel hearts; taking one back drops a grey one.
  const [pop, setPop] = useState<{ id: number; gain: boolean } | null>(null);
  const { rarity } = listing;
  const tier = rarity.tier;
  // A closed campaign stays on the listing; the card only advertises one still taking bookings.
  const view = isTakingBookings(listing.preOrder) ? preOrderView(listing.preOrder!) : null;
  const left = listing.quantityMode === 'multiple' ? null : listing.quantityAvailable;
  const wasPrice = rarity.priceDropPercent
    ? Math.max(...(listing.priceHistory ?? []).map((entry) => entry.priceMinor))
    : null;
  // The one thing worth saying after how it ships: a clock running out, then few left.
  const signal = rarity.hoursLeft !== null && rarity.hoursLeft <= 72
    ? { text: `Ends in ${hoursLabel(rarity.hoursLeft)}`, hot: rarity.hoursLeft <= 24 }
    : left !== null && left > 0 && left <= 5
      ? { text: `${left} left`, hot: true }
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
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb qloot__art" priority={priority}>
        {tier && <RarityRibbon tier={tier} />}
        <span className="qgrade" title="Condition">{factsOf(listing).condition}</span>
        <button type="button" className={`qheart${liked ? ' is-on' : ''}`} onClick={toggleSave}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={liked ? 'Remove from your saves' : 'Save'} aria-pressed={liked}>
          <PixelHeart full={liked} />
          {pop && <HeartPop key={pop.id} gain={pop.gain} />}
        </button>
        {rarity.priceDropPercent && <span className="qsticker-tag qsticker-tag--drop">−{rarity.priceDropPercent}%</span>}
        {view && !rarity.priceDropPercent && <span className="qsticker-tag">Pre-order</span>}
      </Thumb>
      {/* Under the picture rather than on it: on the picture it sat on the
          condition stamp. With a booking amount too, the two share one strip
          rather than stacking into two bands of different heights. */}
      {listing.channelDrop && listing.advancePercent ? (
        <span className="qloot__strips">
          <span className="qloot__drop" title="Exclusive channel drop"><Glyph name="bolt" size={11} /><span>Exclusive</span></span>
          <span className="qloot__book" title={`Pay ${listing.advancePercent}% now, the rest later`}>
            Book for {formatMoney(advanceMinor(listing.priceMinor, listing.advancePercent), listing.currency)}
          </span>
        </span>
      ) : listing.channelDrop ? (
        <span className="qloot__drop" title="Exclusive channel drop"><Glyph name="bolt" size={11} /><span>Channel exclusive</span></span>
      ) : (
        <AdvanceStrip percent={listing.advancePercent} priceMinor={listing.priceMinor} currency={listing.currency} />
      )}

      {/* Title, price, one line of what matters about this one, and the shop. */}
      <div className="qloot__body">
        <span className="qloot__title">{listing.title}</span>
        <span className="pricerow">
          <span className="qloot__price">
            {formatMoney(listing.priceMinor, listing.currency)}
            {wasPrice && <s>{formatMoney(wasPrice, listing.currency)}</s>}
          </span>
        </span>
        {/* Shipping is beside the price, never in it; wholesale is the one offer worth a flag. */}
        {(listing.shippingMinor != null || wholesaleHint(listing.offers, listing.priceMinor)) && (
          <span className="offr-chips">
            <ShippingChip shippingMinor={listing.shippingMinor} />
            <WholesaleChip offers={listing.offers} priceMinor={listing.priceMinor} currency={listing.currency} />
          </span>
        )}

        {view ? (
          <span className="qloot__lv">
            <span className="qloot__lvlabel">{view.committed} of {view.fillThreshold} joined</span>
            <XpBar progress={view.committed / view.fillThreshold} tone={tier === 'legendary' ? 'gold' : 'violet'} />
          </span>
        ) : (
          <span className="qloot__meta">
            <b className={listing.sourcing === 'in_hand' ? 'qok' : ''}>{SOURCING_LABELS[listing.sourcing]}</b>
            {signal && <> · <span className={signal.hot ? 'qhot' : ''}>{signal.text}</span></>}
          </span>
        )}

        {listing.seller && (
          <span className="qloot__foot qseller" title={`Trust ${listing.seller.trustScore} of 100`}>
            <span className={`qseller__crest qcrest__mark--${crestFor(listing.seller.trustScore)}`}>
              <Glyph name="crest" size={13} />
              {listing.seller.photoUrl && <StorePic url={listing.seller.photoUrl} />}
            </span>
            <span className="qseller__name">{listing.seller.storefrontName}{listing.seller.pro && <ProBadge />}</span>
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

function hoursLabel(hours: number): string {
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
      <Select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {empty && <option value="">{empty}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    </label>
  );
}

type PickerIcon = 'sort' | 'price' | 'condition' | 'rarity' | 'type' | 'authentic' | 'size' | 'route' | 'craft';

const icon = (path: ReactNode) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

/** The seller's "original or copy" answer against a buyer's pick of it. */
function matchesAuthenticity(listing: FeedListing, wanted: string): boolean {
  if (!wanted) return true;
  const facts = factsOf(listing).authenticity;
  if (!facts) return false;
  if (wanted === 'genuine') return facts.genuine;
  if (wanted === 'copies') return !facts.genuine;
  return facts.label === wanted;
}

const PICKER_ICONS: Record<PickerIcon, ReactNode> = {
  sort: icon(<><path d="M7 4v16M3 16l4 4 4-4" /><path d="M17 20V4M13 8l4-4 4 4" /></>),
  price: icon(<><path d="M6 4h12M6 9h12M9 4c5 0 5 10 0 10H6l9 7" /></>),
  condition: icon(<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />),
  rarity: icon(<path d="M6 3h12l3 6-9 12L3 9z M3 9h18" />),
  type: icon(<><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></>),
  authentic: icon(<><path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></>),
  size: icon(<path d="M3 16 16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2" />),
  route: icon(<><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" /></>),
  craft: icon(<><path d="m14 4 6 6-9 9H5v-6z" /><path d="m12 6 6 6" /></>),
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
          <span className="qkind__label">{CATALOG_KIND_LABELS[entry]}</span>
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
