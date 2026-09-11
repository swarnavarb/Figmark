import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CONDITION_TAGS, SOURCING_LABELS } from '@shared/enums';
import { CATALOG_KINDS, CATALOG_KIND_LABELS, CATEGORY_GROUPS } from '@shared/catalog';
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
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const search = params.get('q') ?? '';
  const group = params.get('group') ?? '';
  const category = params.get('category') ?? '';
  const condition = params.get('condition') ?? '';
  const kind = params.get('kind') ?? '';
  const maxPrice = params.get('maxPrice') ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .feed({ q: search, group, category, condition, kind, maxPrice })
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
  }, [search, group, category, condition, kind, maxPrice]);

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

  const activeFilters = [group, category, condition, kind, maxPrice].filter(Boolean).length;

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>{search ? `Results for “${search}”` : 'Browse'}</h1>
          <p className="muted">
            {user
              ? 'Sellers you follow appear first. Everything else is newest first.'
              : 'Sign in to follow sellers and personalise this feed.'}
          </p>
        </div>
        {data && <span className="muted">{data.listings.length} listings</span>}
      </div>

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

        {/* Everything else, one row down: these narrow what the two rows above
            have already chosen rather than competing with them. */}
        <div className="chips">
          {PRICE_BANDS.map((band) => (
            <button key={band.value} className={`chip chip--quiet${maxPrice === band.value ? ' is-on' : ''}`}
              onClick={() => toggle('maxPrice', band.value)}>
              {band.label}
            </button>
          ))}
          {CONDITION_TAGS.map((tag) => (
            <button key={tag} className={`chip chip--quiet${condition === tag ? ' is-on' : ''}`}
              onClick={() => toggle('condition', tag)}>
              {tag}
            </button>
          ))}
        </div>

        {/* The categories actually present in what is on screen, so a heading
            can be narrowed further without offering a chip that has nothing
            behind it. */}
        {data && data.categories.length > 1 && (
          <div className="chips">
            {data.categories.map((entry) => (
              <button key={entry} className={`chip chip--quiet${category === entry ? ' is-on' : ''}`}
                onClick={() => toggle('category', entry)}>
                {entry}
              </button>
            ))}
          </div>
        )}
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
