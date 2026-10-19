import { useEffect, useState } from 'react';
import { CommunityAlertBanner } from '../components/CommunityAlerts';
import { VerifiedChips, VerifiedTick } from '../components/VerifiedChips';
import { Link, useParams } from 'react-router-dom';
import { handleShapeProblem, USERNAME_PROBLEMS } from '@shared/handles';
import { ApiRequestError, api, type FeedListing, type PostCard, type PublicProfile, type ShelfState } from '../api';
import { listingRarity } from '@shared/quest';
import { LootCard } from './FeedPage';
import { SocialPostCard } from '../components/SocialPost';
import { SkeletonText } from '../components/Feedback';
import { Avatar, EmptyState, ErrorNotice, LevelChip } from '../components/ui';
import { brandHueFor, formatDate, timeAgo } from '../format';
import { useSession } from '../session';
import { Canopy } from '../components/ListingBlocks';
import {
  Bio, FollowButton, FollowCounts, PageActions, RatingSheet, RatingSlab, ReviewsTab, ShelfCard, StoreLevelCard,
} from '../components/ProfileParts';
import { CollectorProfile } from './CollectorProfile';
import { ShopStrip, tagPath } from '../components/ShopCards';
import { tagKey } from '@shared/shop-tags';
import type { ShopCard } from '../api';
import '../styles/ProfileByHandlePage.css';

/**
 * Whatever lives at `/<username>`.
 *
 * People and shops share one namespace, so this is one route: the server says
 * which it was. A person gets their collector page; a shop gets its storefront
 * - a banner, who they are, one rating, its level and milestones, then the
 * shelf, live items first. Everything comes back in one request.
 */
type Tab = 'items' | 'feed' | 'reviews';
type Shelf = 'all' | ShelfState;

export function ProfileByHandlePage() {
  const { username } = useParams<{ username: string }>();
  const { user } = useSession();
  const [data, setData] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;
    // A path that could never be a username is a wrong turn, not a lookup.
    // Only the shape: a handle claimed before its word was reserved still opens.
    const problem = handleShapeProblem(username);
    if (problem) {
      setError(`There is no page at /${username}. ${USERNAME_PROBLEMS[problem]}`);
      return;
    }
    setError(null);
    setData(null);
    void api.profile(username).then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not open that page.'));
  }, [username]);

  if (error) {
    return (
      <main className="page tab-view">
        <ErrorNotice message={error} />
        <Link to="/" className="btn btn--ghost" style={{ marginTop: 14, justifySelf: 'start' }}>Back to the feed</Link>
      </main>
    );
  }
  if (!data) return <PageSkeleton />;

  const isMe = user?.id === data.sellerId;
  const reload = () => void api.profile(data.handle).then(setData).catch(() => undefined);
  const onFollow = (following: boolean, followers?: number) => setData((page) => page && {
    ...page,
    following,
    followerCount: followers ?? Math.max(0, page.followerCount + (following === page.following ? 0 : following ? 1 : -1)),
  });

  return (
    <>
      {/* What a community manager's final decision put on this page, if anything. */}
      <CommunityAlertBanner userId={data.sellerId} />
      {data.isStore
        ? <Storefront data={data} isMe={isMe} onFollow={onFollow} reload={reload} />
        : <CollectorProfile profile={data} isMe={isMe} onFollow={onFollow} reload={reload} />}
    </>
  );
}

/** The page's outline while it loads, so nothing jumps when it lands. */
function PageSkeleton() {
  return (
    <main className="storefront">
      <div className="storefront__cover pskel__cover" />
      <div className="storefront__body">
        <div className="pskel__head"><span className="pskel__face" /><SkeletonText lines={2} /></div>
        <div className="pskel__slab" />
        <SkeletonText lines={3} />
      </div>
    </main>
  );
}

function Storefront({ data, isMe, onFollow, reload }: {
  data: PublicProfile;
  isMe: boolean;
  onFollow: (following: boolean, followers?: number) => void;
  reload: () => void;
}) {
  const [tab, setTab] = useState<Tab>('items');
  const [shelf, setShelf] = useState<Shelf>('all');
  const [ratingOpen, setRatingOpen] = useState(false);
  // Live items as the Buy tab shows them: rarity, saves, the lot.
  const [live, setLive] = useState<Map<string, FeedListing>>(new Map());
  useEffect(() => {
    void api.feed({ seller: data.sellerId })
      .then((result) => setLive(new Map(result.listings.map((listing) => [listing.id, listing]))))
      .catch(() => setLive(new Map()));
  }, [data.sellerId]);
  const now = Date.now();
  const [similar, setSimilar] = useState<ShopCard[] | null>(null);
  useEffect(() => {
    void api.similarShops(data.sellerId).then((result) => setSimilar(result.shops)).catch(() => setSimilar(null));
  }, [data.sellerId]);
  // Identity tags the shop did not choose itself: what its listings say.
  const chosen = new Set(data.tags.map(tagKey));
  const alsoSells = data.identity.filter((tag) => !tag.own && !chosen.has(tag.key)).slice(0, 4);

  const shown = data.listings.filter((listing) => shelf === 'all' || listing.state === shelf);
  const filters = ([
    ['all', 'All', data.counts.listings],
    ['active', 'Live', data.counts.onSale],
    ['sold', 'Sold out', data.counts.sold],
    ['expired', 'Expired', data.counts.expired],
  ] as const).filter(([id, , count]) => id === 'all' || count > 0);

  return (
    <main className="storefront storefront--shop">
      {/* An unset banner is a full gradient in the shop's own hue, so every
          storefront opens with colour and no two look like the same shop. */}
      <div className={`storefront__cover storefront__cover--${brandHueFor(data.handle)}`}>
        {data.coverUrl && <img loading="lazy" decoding="async" src={data.coverUrl} alt="" />}
        <Canopy />
        <span className="storefront__open"><i aria-hidden="true" /> Open for orders</span>
      </div>

      <div className="storefront__body">
        {/* The shop's name sits on its cover, just above the edge; its details line up under it. */}
        <header className="phead phead--shop">
          <div className="phead__face storefront__avatar">
            {data.photoUrl ? <img loading="lazy" decoding="async" src={data.photoUrl} alt="" /> : <Avatar name={data.displayName} size={64} />}
          </div>
          <div className="phead__name">
            <h1>{data.displayName}<VerifiedTick checks={data.verified} /></h1>
            <span className="phead__line">
              <span className="phead__handle">@{data.handle}</span>
              <LevelChip tag={data.levelTag} inline />
            </span>
          </div>
          <div className="phead__details">
            <p className="phead__since">
              Open since {formatDate(data.memberSince)}
              {data.lastSeenAt && ` · seen ${timeAgo(data.lastSeenAt)}`}
              {data.tier && <span className="badge phead__tier">{data.tier}</span>}
            </p>
            <VerifiedChips checks={data.verified} passedOnly />
          </div>
        </header>

        <PageActions profile={data} isMe={isMe} onFollow={onFollow}
          edit={<Link to="/shop" className="pbtn pbtn--follow">Edit shop</Link>} />

        <div className="pstats">
          <FollowCounts userId={data.sellerId} followerCount={data.followerCount} isStore />
          <span className="pstat"><b>{data.counts.onSale}</b><small>live</small></span>
          <span className="pstat"><b>{data.counts.sold}</b><small>sold out</small></span>
          <span className="pstat"><b className={`ptrust ptrust--${trustTone(data.trustScore)}`}>{data.trustScore ?? '—'}</b><small>trust</small></span>
        </div>

        {/* Earned, not typed: read off the shop's orders. */}
        {data.earned.length > 0 && (
          <div className="chips chips--tight">
            {data.earned.map((badge) => (
              <span key={badge.id} className="chip earnedtag">✓ {badge.label}</span>
            ))}
          </div>
        )}

        {/* Who they are, in one place: what they said, what they sell, where from. */}
        {(data.bio.trim() || data.tags.length > 0 || data.dispatchRegion || data.link || data.ownerHandle || alsoSells.length > 0) && (
        <section className="ppanel" aria-label="About">
          <h2 className="ppanel__title">About</h2>
          <Bio text={data.bio} />
          {(data.tags.length > 0 || data.dispatchRegion || data.link || data.ownerHandle) && (
            <div className="chips chips--tight">
              {/* Each tag opens every shop that carries it. */}
              {data.tags.map((tag) => <Link key={tag} to={tagPath(tag)} className="chip">{tag}</Link>)}
              {data.dispatchRegion && <span className="chip chip--static">📦 ships from {data.dispatchRegion}</span>}
              {data.link && (
                <a className="chip" href={withScheme(data.link)} target="_blank" rel="noreferrer noopener">
                  🔗 {data.link.replace(/^https?:\/\//, '')}
                </a>
              )}
              {/* The person behind a shop is a separate page, rated as a buyer. */}
              {data.ownerHandle && <Link to={`/${data.ownerHandle}`} className="chip">👤 @{data.ownerHandle}</Link>}
            </div>
          )}
          {/* What its listings say it sells, beyond the tags it chose. */}
          {alsoSells.length > 0 && (
            <div className="chips chips--tight alsosells">
              <span className="alsosells__label">Also sells</span>
              {alsoSells.map((tag) => <Link key={tag.key} to={tagPath(tag.label)} className="chip alsosells__tag">{tag.label}</Link>)}
            </div>
          )}
        </section>
        )}

        <RatingSlab rating={data.rating} side="store" onOpen={() => setRatingOpen(true)} />

        {data.level && <StoreLevelCard level={data.level} stickers={data.stickers} />}

        <div className="tabs" style={{ marginTop: 16 }}>
          <button type="button" className={`tab${tab === 'items' ? ' is-on' : ''}`} onClick={() => setTab('items')}>
            Items {data.counts.listings}
          </button>
          <button type="button" className={`tab${tab === 'feed' ? ' is-on' : ''}`} onClick={() => setTab('feed')}>
            Feed
          </button>
          <button type="button" className={`tab${tab === 'reviews' ? ' is-on' : ''}`} onClick={() => setTab('reviews')}>
            Reviews {data.rating.count}
          </button>
        </div>

        {tab === 'feed' ? (
          <ShopFeed shopId={data.sellerId} />
        ) : tab === 'reviews' ? (
          <ReviewsTab profile={data} canWrite={!isMe} onWritten={reload} />
        ) : data.listings.length === 0 ? (
          <EmptyState title="Nothing listed yet">
            This shop has not put anything up. Following it puts new items on your feed.
          </EmptyState>
        ) : (
          <>
            {filters.length > 2 && (
              <div className="chips chips--tight">
                {filters.map(([id, label, count]) => (
                  <button key={id} type="button" className={`chip${shelf === id ? ' is-on' : ''}`} onClick={() => setShelf(id)}>
                    {label} {count}
                  </button>
                ))}
              </div>
            )}
            <div className="grid qgrid">
              {shown.map((listing, i) => {
                const full = live.get(listing.id);
                return full
                  ? <LootCard key={listing.id} listing={{ ...full, rarity: listingRarity(full, now) }} />
                  : <ShelfCard key={listing.id} listing={listing} index={i} />;
              })}
            </div>
          </>
        )}
      </div>

      <ShopStrip title="Similar shops" sub="About the same things as this one" shops={similar} />

      {ratingOpen && (
        <RatingSheet profile={data} rating={data.rating} onClose={() => setRatingOpen(false)} onReviews={() => setTab('reviews')} />
      )}
    </main>
  );
}

/**
 * What the shop said out loud: its posts on the social feed, which anybody can
 * read - not the messages kept for followers in its channel.
 */
function ShopFeed({ shopId }: { shopId: string }) {
  const { user, gate } = useSession();
  const [posts, setPosts] = useState<PostCard[] | null>(null);
  useEffect(() => {
    if (!user) return;
    setPosts(null);
    void api.shopFeed(shopId).then((result) => setPosts(result.posts)).catch(() => setPosts([]));
  }, [shopId, user]);

  if (!user) {
    return (
      <EmptyState title="Posts">
        <button type="button" className="pbtn pbtn--follow" onClick={gate(() => undefined, 'Sign in to see the shop feed.')}>Sign in</button>
      </EmptyState>
    );
  }
  if (!posts) return <SkeletonText lines={3} />;
  if (posts.length === 0) return <EmptyState title="Nothing posted yet">When the shop posts to the feed, it shows up here.</EmptyState>;
  return (
    <div className="stack">
      {posts.map((card) => <SocialPostCard key={card.post.id} card={card} />)}
    </div>
  );
}

/** Links are stored as typed, so give a bare domain a scheme before opening it. */
function withScheme(link: string) {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

function trustTone(score: number | null): string {
  if (score === null) return 'none';
  return score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'low';
}
