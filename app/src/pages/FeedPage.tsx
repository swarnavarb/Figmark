import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CONDITION_TAGS, SOURCING_LABELS } from '@shared/enums';
import {
  CATALOG_KINDS, CATALOG_KIND_LABELS, CATALOG_SORTS, CATALOG_SORT_LABELS, CATEGORY_GROUPS,
} from '@shared/catalog';
import { preOrderView } from '@shared/preorder';
import { sourcingOf } from '@shared/fulfilment';
import { api, type FeedListing, type FeedResponse } from '../api';
import { EmptyState, ErrorNotice, Icon, Thumb, TrustBadge } from '../components/ui';
import { FillGap, FillKey, FillMeter } from '../components/FillMeter';
import { formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

const PRICE_BANDS = [
  { label: 'Under ₹500', value: '50000' },
  { label: 'Under ₹2,000', value: '200000' },
  { label: 'Under ₹10,000', value: '1000000' },
];

/**
 * The unified catalog and the app's landing page.
 *
 * Filters live in the URL, so a filtered view is shareable and the back button
 * behaves. When signed in the ordering is personalised: sellers the account
 * follows surface first.
 */
export function FeedPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const search = params.get('q') ?? '';
  const group = params.get('group') ?? '';
  const category = params.get('category') ?? '';
  const condition = params.get('condition') ?? '';
  const kind = params.get('kind') ?? '';
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

  return (
    <main className="page">
      {/* Two rows, and deliberately not one. The first says what a thing is,
          the second says how it is being sold; they answer different questions
          and a single row that mixes them makes both harder to read. */}
      <div className="stack" style={{ marginBottom: 22 }}>
        <div className="cats" role="tablist" aria-label="Categories">
          <button type="button" role="tab" aria-selected={group === ''}
            className={`cat${group === '' ? ' is-on' : ''}`} onClick={() => chooseGroup('')}>
            <span className="cat__glyph" aria-hidden="true">✳</span>
            Everything
          </button>
          {CATEGORY_GROUPS.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={group === entry.id}
              className={`cat${group === entry.id ? ' is-on' : ''}`} onClick={() => chooseGroup(entry.id)}>
              <span className="cat__glyph" aria-hidden="true">{entry.glyph}</span>
              {entry.label}
            </button>
          ))}
        </div>

        <div className="chips">
          {CATALOG_KINDS.map((entry) => (
            <button key={entry}
              className={`chip${(kind || 'all') === entry ? ' is-on' : ''}`}
              onClick={() => chooseKind(entry)}>
              {CATALOG_KIND_LABELS[entry]}
            </button>
          ))}
        </div>

        {/* The long tail, as controls rather than chips. Sort, price and
            condition are one choice out of many each, and a chip row for that
            is a wall of options where only one can be on - twelve of them
            wrapped into four ragged rows and pushed the first item off the
            screen. A select says "one of these" in the width of one. */}
        <div className="filters">
          <Picker label="Sort" value={sort} onChange={(value) => set('sort', value)}
            options={CATALOG_SORTS.map((entry) => ({ value: entry, label: CATALOG_SORT_LABELS[entry] }))} />
          <Picker label="Price" value={maxPrice} onChange={(value) => set('maxPrice', value)}
            empty="Any price" options={PRICE_BANDS} />
          <Picker label="Condition" value={condition} onChange={(value) => set('condition', value)}
            empty="Any condition"
            options={CONDITION_TAGS.map((tag) => ({ value: tag, label: tag }))} />
          {/* Only what is actually on screen, so it can never offer a category
              with nothing behind it. */}
          {data && data.categories.length > 1 && (
            <Picker label="Type" value={category} onChange={(value) => set('category', value)}
              empty="Any type"
              options={data.categories.map((entry) => ({ value: entry, label: entry }))} />
          )}
          {activeFilters > 0 && (
            <button type="button" className="filters__clear" onClick={() => setParams(
              search ? new URLSearchParams({ q: search }) : new URLSearchParams(), { replace: true },
            )}>
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {loading && !data ? (
        <p className="muted">Loading…</p>
      ) : data && data.listings.length === 0 ? (
        <EmptyState icon="⌕" title="Nothing matches those filters">
          {activeFilters > 0 || search
            ? 'Try removing a filter or searching for something broader.'
            : 'Be the first to list something.'}
        </EmptyState>
      ) : (
        <div className="grid">
          {data?.listings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
        </div>
      )}
    </main>
  );
}

/**
 * One choice out of a list, in the width of one chip.
 *
 * A native select rather than a custom menu: on a phone it opens the platform's
 * own picker, which is a better list than anything built here, and it is
 * reachable by keyboard and screen reader without a line of code. The chevron
 * and the pill are ours; the list is the operating system's.
 */
function Picker({ label, value, onChange, options, empty }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  /** The "no choice" row. Omitted when one of the options is always on. */
  empty?: string;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <label className={`picker${value ? ' is-on' : ''}`}>
      <span className="picker__label">{chosen ? chosen.label : (empty ?? label)}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {empty && <option value="">{empty}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function ListingCard({ listing }: { listing: FeedListing }) {
  const { user } = useSession();
  const [liked, setLiked] = useState(listing.liked);
  const [likes, setLikes] = useState(listing.likeCount);
  const view = listing.preOrder ? preOrderView(listing.preOrder) : null;

  async function toggleLike(event: React.MouseEvent) {
    // The card is a link; the heart must not navigate.
    event.preventDefault();
    event.stopPropagation();
    if (!user) return;
    const next = !liked;
    setLiked(next);
    setLikes((count) => count + (next ? 1 : -1));
    try {
      const result = await api.like(listing.id);
      setLiked(result.liked);
    } catch {
      // Roll the optimistic update back if the server disagreed.
      setLiked(!next);
      setLikes((count) => count + (next ? -1 : 1));
    }
  }

  return (
    <Link to={`/listing/${listing.id}`} className="card card--link">
      <Thumb seed={listing.id} label={listing.title}>
        {user && (
          <button type="button" className={`thumb__like${liked ? ' is-on' : ''}`} onClick={toggleLike}
            aria-label={liked ? 'Remove bookmark' : 'Bookmark'} aria-pressed={liked}>
            <Icon name="heart" size={15} />
          </button>
        )}
        <div className="thumb__badges">
          <span className="badge badge--solid">{listing.condition}</span>
          {listing.preOrder && <span className="badge badge--accent">Pre-order</span>}
        </div>
      </Thumb>

      <div className="listing__body">
        <span className="listing__title">{listing.title}</span>
        <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>

        {/* The quick read: is it here or coming, what kind of thing, how many
            left. Two cards fit across a phone, so this has to answer the
            "should I tap this" question without one. */}
        <div className="listing__meta">
          <span className={`badge${sourcingOf(listing) === 'in_hand' ? ' badge--ok' : ''}`}>
            {SOURCING_LABELS[sourcingOf(listing)]}
          </span>
          <span className="badge">{listing.category}</span>
          {listing.quantityAvailable > 1 && <span className="faint">{listing.quantityAvailable} left</span>}
        </div>

        {/* The meter, from the counters cached on the listing. No faces here:
            those need the campaign's own roster, and reading one per card would
            be a query per card. The gap is what recruits anyway. */}
        {view && (
          <div className="fillblock">
            <div className="fillblock__head">
              <span className="faint">{view.committed} of {view.fillThreshold} in</span>
              <FillGap view={view} />
            </div>
            <FillMeter view={view} height={6} />
            <FillKey view={view} />
          </div>
        )}

        <div className="listing__foot">
          <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {listing.seller?.storefrontName ?? 'Unknown seller'}
          </span>
          {listing.seller && <TrustBadge score={listing.seller.trustScore} tier={listing.seller.tier} />}
        </div>
        <span className="faint">
          {likes > 0 && `${likes} saved · `}
          {timeAgo(listing.bumpedAt ?? listing.createdAt)}
        </span>
      </div>
    </Link>
  );
}
