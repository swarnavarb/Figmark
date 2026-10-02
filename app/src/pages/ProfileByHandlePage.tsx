import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { checkUsername, USERNAME_PROBLEMS } from '@shared/handles';
import { ApiRequestError, api, type ChannelThread, type PublicProfile, type ShelfState } from '../api';
import { SocialPostCard } from '../components/SocialPost';
import { SkeletonText } from '../components/Feedback';
import { Avatar, EmptyState, ErrorNotice, LevelChip } from '../components/ui';
import { brandHueFor, formatDate, timeAgo } from '../format';
import { useSession } from '../session';
import { Canopy } from '../components/ListingBlocks';
import {
  Bio, FollowButton, PageActions, RatingSheet, RatingSlab, ReviewsTab, ShelfCard, StoreLevelCard,
} from '../components/ProfileParts';
import { CollectorProfile } from './CollectorProfile';

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
    const problem = checkUsername(username);
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

  return data.isStore
    ? <Storefront data={data} isMe={isMe} onFollow={onFollow} reload={reload} />
    : <CollectorProfile profile={data} isMe={isMe} onFollow={onFollow} reload={reload} />;
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
        {data.coverUrl && <img src={data.coverUrl} alt="" />}
        <Canopy />
        <span className="storefront__open"><i aria-hidden="true" /> Open for orders</span>
      </div>

      <div className="storefront__body">
        <header className="storefront__head storefront__sign">
          <div className="storefront__avatar">
            {data.photoUrl ? <img src={data.photoUrl} alt="" /> : <Avatar name={data.displayName} size={64} />}
          </div>
          <div className="storefront__who">
            <h1>{data.displayName}</h1>
            <LevelChip tag={data.levelTag} />
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="faint">@{data.handle}</span>

              {data.tier && <span className="badge">{data.tier}</span>}
            </div>
            <p className="faint" style={{ margin: 0 }}>
              open since {formatDate(data.memberSince)}
              {data.lastSeenAt && ` · seen ${timeAgo(data.lastSeenAt)}`}
            </p>
          </div>
        </header>

        <PageActions profile={data} isMe={isMe} onFollow={onFollow}
          edit={<Link to="/shop" className="pbtn pbtn--follow">Edit shop</Link>} />

        <div className="pstats">
          <span><b>{data.followerCount}</b><small>{data.followerCount === 1 ? 'follower' : 'followers'}</small></span>
          <span><b>{data.counts.onSale}</b><small>live</small></span>
          <span><b>{data.counts.sold}</b><small>sold out</small></span>
          <span><b className={`ptrust ptrust--${trustTone(data.trustScore)}`}>{data.trustScore ?? '—'}</b><small>trust</small></span>
        </div>

        {(data.tags.length > 0 || data.dispatchRegion || data.link || data.ownerHandle) && (
          <div className="chips chips--tight">
            {data.tags.map((tag) => <span key={tag} className="chip chip--static">{tag}</span>)}
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

        <Bio text={data.bio} />

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
          <ShopFeed shopId={data.sellerId} following={data.following} onFollow={onFollow} />
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
            <div className="grid">
              {shown.map((listing, i) => <ShelfCard key={listing.id} listing={listing} index={i} />)}
            </div>
          </>
        )}
      </div>

      {ratingOpen && (
        <RatingSheet profile={data} rating={data.rating} onClose={() => setRatingOpen(false)} onReviews={() => setTab('reviews')} />
      )}
    </main>
  );
}

/**
 * What the shop posts to its channel. A channel is for its followers, so
 * anybody else sees how much is behind the door and a way in.
 */
function ShopFeed({ shopId, following, onFollow }: {
  shopId: string;
  following: boolean;
  onFollow: (following: boolean, followers?: number) => void;
}) {
  const { user, gate } = useSession();
  const [thread, setThread] = useState<ChannelThread | null>(null);
  useEffect(() => {
    if (!user) return;
    setThread(null);
    void api.channelThread(shopId).then(setThread).catch(() => setThread(null));
  }, [shopId, user, following]);

  if (!user || thread?.locked) {
    return (
      <EmptyState title={thread ? `${thread.channel.postCount ?? 0} posts for followers` : 'Posts for followers'}>
        Drops, restocks and news go to the shop's followers first.{' '}
        {user
          ? <FollowButton id={shopId} following={following} onChange={onFollow} />
          : <button type="button" className="pbtn pbtn--follow" onClick={gate(() => undefined, 'Sign in to see the shop feed.')}>Sign in</button>}
      </EmptyState>
    );
  }
  if (!thread) return <SkeletonText lines={3} />;
  if (thread.posts.length === 0) return <EmptyState title="Nothing posted yet">When the shop posts, it shows up here.</EmptyState>;
  return (
    <div className="stack">
      {thread.posts.map((card) => <SocialPostCard key={card.post.id} card={card} />)}
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
