import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CONDITION_TAGS } from '@shared/enums';
import { api, type FeedListing, type FeedResponse } from '../api';
import { EmptyState, ErrorNotice, Icon, LotMeter, Thumb, TrustBadge } from '../components/ui';
import { daysUntil, formatMoney, timeAgo } from '../format';
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
  const category = params.get('category') ?? '';
  const condition = params.get('condition') ?? '';
  const kind = params.get('kind') ?? '';
  const maxPrice = params.get('maxPrice') ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .feed({ q: search, category, condition, kind, maxPrice })
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
  }, [search, category, condition, kind, maxPrice]);

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

  const activeFilters = [category, condition, kind, maxPrice].filter(Boolean).length;

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

      <div className="stack" style={{ marginBottom: 22 }}>
        <div className="chips">
          <button className={`chip${kind === 'lot_slot' ? ' is-on' : ''}`} onClick={() => toggle('kind', 'lot_slot')}>
            Open lots
          </button>
          <button className={`chip${kind === 'in_stock' ? ' is-on' : ''}`} onClick={() => toggle('kind', 'in_stock')}>
            In stock
          </button>
          {PRICE_BANDS.map((band) => (
            <button key={band.value} className={`chip${maxPrice === band.value ? ' is-on' : ''}`}
              onClick={() => toggle('maxPrice', band.value)}>
              {band.label}
            </button>
          ))}
          {CONDITION_TAGS.map((tag) => (
            <button key={tag} className={`chip${condition === tag ? ' is-on' : ''}`}
              onClick={() => toggle('condition', tag)}>
              {tag}
            </button>
          ))}
        </div>

        {data && data.categories.length > 0 && (
          <div className="chips">
            {data.categories.map((entry) => (
              <button key={entry} className={`chip${category === entry ? ' is-on' : ''}`}
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

  const lot = listing.lot;

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
          {lot && <span className="badge badge--accent">Group buy</span>}
        </div>
      </Thumb>

      <div className="listing__body">
        <span className="listing__title">{listing.title}</span>
        <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>

        {lot && (
          <>
            <LotMeter filled={lot.filledCount} threshold={lot.fillThreshold} />
            <span className="faint">
              {lot.filledCount}/{lot.fillThreshold} filled · closes in {daysUntil(lot.cutoffAt)}d
            </span>
          </>
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
