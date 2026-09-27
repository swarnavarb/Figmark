import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CARDS, CARD_SETS } from '@shared/quest';
import {
  ApiRequestError, api, type CollectorPage, type PageReviews, type PostCard, type PublicProfile, type ReviewsAbout,
} from '../api';
import { SkeletonText } from '../components/Feedback';
import {
  CardFace, CardSlot, DesignSwitch, Glyph, LevelRing, Sticker, XpBar,
} from '../components/Quest';
import { SocialPostCard } from '../components/SocialPost';
import { Avatar, EmptyState, ErrorNotice } from '../components/ui';
import { brandHueFor, formatDate, timeAgo } from '../format';
import { MessageButton } from './MessagesPage';
import { ReviewsTab } from './ProfileByHandlePage';

/**
 * A buyer's page, as a collector's.
 *
 * Everything on it is read from the record: the rating is from sellers who
 * completed a trade with them, the disputes are counted from how each one
 * ended, and the level, stickers and cards are the same game the person plays
 * on their Quests page. Their own tasks, packs, saves and spending stay
 * private - this is what a stranger deciding whether to deal with them, or a
 * friend comparing collections, would want to see.
 */

type Tab = 'feed' | 'reviews' | 'collection';

export function CollectorProfile({ profile, trade, listed, page, isMe, canWrite, onWritten }: {
  profile: PublicProfile;
  trade: ReviewsAbout | null;
  listed: ReviewsAbout['reviews'];
  page: PageReviews | null;
  isMe: boolean;
  canWrite: boolean;
  onWritten: () => void;
}) {
  const [collector, setCollector] = useState<CollectorPage | null>(null);
  const [posts, setPosts] = useState<PostCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setCollector(null);
    setPosts(null);
    void api.collector(profile.sellerId)
      .then(setCollector)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load their collection.'));
    void api.personPosts(profile.sellerId).then((result) => setPosts(result.posts)).catch(() => setPosts([]));
  }, [profile.sellerId]);

  const stats = collector?.stats;
  const earned = collector?.stickers.filter((sticker) => sticker.earned) ?? [];
  const uniqueCards = new Set(collector?.cards.map((card) => card.id) ?? []).size;

  return (
    <main className="storefront qprofile">
      <div className={`storefront__cover storefront__cover--${brandHueFor(profile.handle ?? profile.displayName)}`}>
        {profile.coverUrl && <img src={profile.coverUrl} alt="" />}
        <div className="qprofile__switch"><DesignSwitch /></div>
      </div>

      <div className="storefront__body">
        <header className="qprofile__head">
          <div className="qprofile__avatar">
            {collector && <LevelRing level={collector.level} progress={collector.progress} size={96} />}
            <span className="qprofile__face">
              {profile.photoUrl ? <img src={profile.photoUrl} alt="" /> : <Avatar name={profile.displayName} size={72} />}
            </span>
            {collector && <span className="qprofile__lv">Lv {collector.level}</span>}
          </div>
          <div className="qprofile__who">
            <h1>{profile.displayName}</h1>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="faint">@{profile.handle}</span>
              {collector && <span className="qtitle">{collector.title}</span>}
              {collector && collector.streak.current > 1 && (
                <span className="qchip__streak"><Glyph name="flame" size={12} />{collector.streak.current}</span>
              )}
            </div>
            <p className="faint" style={{ margin: 0 }}>
              here since {formatDate(profile.memberSince)}
              {profile.lastSeenAt && ` · seen ${timeAgo(profile.lastSeenAt)}`}
            </p>
          </div>
          <div className="storefront__act">
            {isMe ? (
              <Link to="/me" className="btn btn--ghost btn--sm">Edit</Link>
            ) : (
              <MessageButton handle={profile.handle} />
            )}
          </div>
        </header>

        {collector && (
          <div className="qprofile__xp">
            <XpBar progress={collector.progress} />
            <span className="faint">{collector.xp.toLocaleString('en-IN')} XP · {collector.nextLevelXp - collector.xp} to level {collector.level + 1}</span>
          </div>
        )}

        {profile.tags.length > 0 && (
          <div className="chips chips--tight">
            {profile.tags.map((tag) => <span key={tag} className="chip chip--static">{tag}</span>)}
          </div>
        )}

        {profile.bio && (
          <p className={`storefront__bio${expanded ? ' is-open' : ''}`}>
            {profile.bio}
            {profile.bio.length > 120 && (
              <button type="button" className="storefront__more" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Less' : 'More'}
              </button>
            )}
          </p>
        )}

        {error && <ErrorNotice message={error} />}

        {/* The record, as six numbers. Each is counted from rows, and the rating
            is only from sellers who finished a trade with them. */}
        {!stats ? (
          <SkeletonText lines={2} />
        ) : (
          <div className="qstats">
            <Stat label="Buyer rating" tone="gold"
              value={stats.rating === null ? '—' : `★ ${(stats.rating / 20).toFixed(1)}`}
              sub={stats.ratingCount ? `from ${stats.ratingCount}` : 'unrated'} />
            <Stat label="Orders completed" value={String(stats.completed)} sub={`of ${stats.orders} placed`} />
            <Stat label="Disputes won" tone="ok" value={String(stats.disputesWon)}
              sub={stats.disputesOpen ? `${stats.disputesOpen} open` : stats.disputesSettled ? `${stats.disputesSettled} settled` : 'none open'} />
            <Stat label="Disputes lost" tone={stats.disputesLost ? 'hot' : undefined} value={String(stats.disputesLost)} sub="as decided" />
            <Stat label="Reviews written" value={String(stats.reviewsWritten)} sub="after orders" />
            <Stat label="Group buys" value={String(stats.groupBuys)} sub={`follows ${stats.following}`} />
          </div>
        )}

        {collector && (
          <section className="qshowcase">
            <div className="qpanel__head">
              <h3><Glyph name="card" size={15} /> Showcase</h3>
              <span className="faint">{uniqueCards}/{CARDS.length} cards · {collector.sets.filter((set) => set.owned === set.total).length}/{collector.sets.length} sets</span>
            </div>
            {collector.cards.length === 0 ? (
              <p className="faint" style={{ margin: 0 }}>No cards pulled yet.</p>
            ) : (
              <div className="qshowcase__cards">
                {dedupe(collector.cards).slice(0, 5).map((card) => <CardFace key={card.id} card={card} size="sm" />)}
              </div>
            )}
            {earned.length > 0 && (
              <div className="qstickers qstickers--row">
                {earned.map((sticker) => <Sticker key={sticker.id} sticker={sticker} />)}
              </div>
            )}
          </section>
        )}

        <div className="tabs" style={{ marginTop: 16 }}>
          <button type="button" className={`tab${tab === 'feed' ? ' is-on' : ''}`} onClick={() => setTab('feed')}>
            Feed {posts ? posts.length : ''}
          </button>
          <button type="button" className={`tab${tab === 'reviews' ? ' is-on' : ''}`} onClick={() => setTab('reviews')}>
            Reviews {(trade?.count ?? 0) + (page?.count ?? 0)}
          </button>
          <button type="button" className={`tab${tab === 'collection' ? ' is-on' : ''}`} onClick={() => setTab('collection')}>
            Collection
          </button>
        </div>

        {tab === 'feed' ? (
          posts === null ? (
            <SkeletonText lines={3} />
          ) : posts.length === 0 ? (
            <EmptyState title="Nothing posted yet">
              {isMe
                ? <>Posts you make in forums show up here. <Link to="/social">Start one</Link>.</>
                : `When ${profile.displayName} posts in a forum, it shows up here.`}
            </EmptyState>
          ) : (
            <div className="stack">
              {posts.map((card) => (
                <SocialPostCard key={card.post.id} card={card}
                  onRemoved={(id) => setPosts((list) => list?.filter((entry) => entry.post.id !== id) ?? list)} />
              ))}
            </div>
          )
        ) : tab === 'reviews' ? (
          <ReviewsTab profile={profile} trade={trade} listed={listed} page={page} canWrite={canWrite} onWritten={onWritten} />
        ) : !collector ? (
          <SkeletonText lines={4} />
        ) : (
          <div className="stack">
            {CARD_SETS.map((set) => {
              const inSet = CARDS.filter((card) => card.set === set.id);
              const owned = collector.sets.find((entry) => entry.id === set.id);
              return (
                <div key={set.id} className="qset">
                  <div className="qset__head">
                    <b>{set.name}</b>
                    <span className="faint">{owned?.owned ?? 0}/{inSet.length}</span>
                  </div>
                  <div className="qset__cards">
                    {inSet.map((card) => (collector.cards.some((mine) => mine.id === card.id)
                      ? <CardFace key={card.id} card={card} size="sm" />
                      : <CardSlot key={card.id} />))}
                  </div>
                </div>
              );
            })}
            <div className="qstickers">
              {collector.stickers.map((sticker) => <Sticker key={sticker.id} sticker={sticker} />)}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'gold' | 'ok' | 'hot' }) {
  return (
    <div className="qstat">
      <b className={tone ? `qstat__value qtone--${tone}` : 'qstat__value'}>{value}</b>
      <span className="qstat__label">{label}</span>
      <small className="faint">{sub}</small>
    </div>
  );
}

/** One of each card, rarest first - the showcase is a shelf, not a pile of duplicates. */
function dedupe<T extends { id: string }>(cards: T[]): T[] {
  const seen = new Set<string>();
  return cards.filter((card) => (seen.has(card.id) ? false : (seen.add(card.id), true)));
}
