import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CARDS } from '@shared/quest';
import type { CollectionItem } from '@shared/models';
import {
  ApiRequestError, api,
  type CollectionCandidate, type CollectionShelf, type CollectorPage, type PostCard, type PublicProfile,
} from '../api';
import { SkeletonText, useToast } from '../components/Feedback';
import {
  CardFace, Glyph, LevelRing, ShowcaseModal, Sticker, XpBar,
} from '../components/Quest';
import { Lightbox, SocialPostCard } from '../components/SocialPost';
import { Avatar, EmptyState, ErrorNotice, Modal, Thumb } from '../components/ui';
import { brandHueFor, formatDate, timeAgo } from '../format';
import { Bio, PageActions, RatingSheet, RatingSlab, ReviewsTab } from '../components/ProfileParts';

/**
 * A person's page, as a collector's.
 *
 * Everything on it is read from the record: the ratings are from people who
 * completed a trade with them, the disputes are counted from how each one
 * ended, the level and stickers are the same game they play on their Quests
 * page, and the collection is things that were actually delivered to them.
 * Their tasks, packs, saves and spending stay private.
 */

export interface Person {
  userId: string;
  displayName: string;
  handle: string | null;
  photoUrl?: string | null;
  coverUrl?: string | null;
  bio?: string;
  tags?: string[];
  memberSince?: string;
  lastSeenAt?: string | null;
}

export type ProfilePart = Pick<PublicProfile,
  'sellerId' | 'isStore' | 'handle' | 'displayName' | 'ownerHandle' | 'trustScore' | 'memberSince' | 'rating' | 'followerCount'>;

/* ── The header every person page shares ──────────────────────────────── */

/**
 * Banner, level ring, name, the buttons, bio, rating, stats and showcase.
 *
 * Used on anybody's page and on your own hub at /me, so the two always look
 * the same - the only difference is the buttons under the name.
 */
export function CollectorHeader({ person, actions, page, onReviews }: {
  person: Person;
  actions: ReactNode;
  /** The public page: its one rating and follower count. Absent until loaded. */
  page: ProfilePart | null;
  onReviews: () => void;
}) {
  const [collector, setCollector] = useState<CollectorPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [showcase, setShowcase] = useState<'cards' | 'stickers' | null>(null);

  useEffect(() => {
    setCollector(null);
    void api.collector(person.userId)
      .then(setCollector)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load their record.'));
  }, [person.userId]);

  const stats = collector?.stats;
  const earned = collector?.stickers.filter((entry) => entry.earned) ?? [];
  const uniqueCards = collector?.cards.length ?? 0;

  return (
    <>
      <div className={`storefront__cover storefront__cover--${brandHueFor(person.handle ?? person.displayName)}`}>
        {person.coverUrl && <img src={person.coverUrl} alt="" />}
      </div>

      <div className="storefront__body">
        <header className="qprofile__head">
          <div className="qprofile__avatar">
            {collector && <LevelRing level={collector.level} progress={collector.progress} size={96} />}
            <span className="qprofile__face">
              {person.photoUrl ? <img src={person.photoUrl} alt="" /> : <Avatar name={person.displayName} size={72} />}
            </span>
            {collector && <span className="qprofile__lv">Lv {collector.level}</span>}
          </div>
          <div className="qprofile__who">
            <h1>{person.displayName}</h1>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {person.handle && <span className="faint">@{person.handle}</span>}
              {collector && <span className="qtitle">{collector.title}</span>}
              {collector && collector.streak.current > 1 && (
                <span className="qchip__streak"><Glyph name="flame" size={12} />{collector.streak.current}</span>
              )}
            </div>
            <p className="faint" style={{ margin: 0 }}>
              {page && <><b className="qprofile__fans">{page.followerCount}</b> {page.followerCount === 1 ? 'follower' : 'followers'}</>}
              {page && person.memberSince && ' · '}
              {person.memberSince && `here since ${formatDate(person.memberSince)}`}
              {person.lastSeenAt && ` · seen ${timeAgo(person.lastSeenAt)}`}
            </p>
          </div>
        </header>

        {collector && (
          <div className="qprofile__xp">
            <XpBar progress={collector.progress} />
            <span className="faint">{collector.xp.toLocaleString('en-IN')} XP · {collector.nextLevelXp - collector.xp} to level {collector.level + 1}</span>
          </div>
        )}
        {collector && collector.penalty > 0 && (
          <p className="qprofile__penalty">−{collector.penalty} XP from low ratings and lost disputes</p>
        )}
        {actions}

        {person.tags && person.tags.length > 0 && (
          <div className="chips chips--tight">
            {person.tags.map((tag) => <span key={tag} className="chip chip--static">{tag}</span>)}
          </div>
        )}

        {person.bio && <Bio text={person.bio} />}

        {page && <RatingSlab rating={page.rating} side="person" onOpen={() => setRatingOpen(true)} />}

        {error && <ErrorNotice message={error} />}

        {!stats || !collector ? (
          <SkeletonText lines={3} />
        ) : (
          <>
            <div className="qstats">
              <Stat label="Orders completed" value={String(stats.completed)} sub={`of ${stats.orders} placed`} />
              <Stat label="Disputes won" tone="ok" value={String(stats.disputesWon)}
                sub={stats.disputesOpen ? `${stats.disputesOpen} open` : stats.disputesSettled ? `${stats.disputesSettled} settled` : 'none open'} />
              <Stat label="Disputes lost" tone={stats.disputesLost ? 'hot' : undefined} value={String(stats.disputesLost)} sub="as decided" />
              <Stat label="Reviews written" value={String(stats.reviewsWritten)} sub="after orders" />
              <Stat label="Pre-orders" value={String(stats.preOrders)} sub="joined" />
              <Stat label="Following" value={String(stats.following)} sub="shops" />
            </div>

            <button type="button" className="qshowcase" onClick={() => setShowcase('cards')}
              aria-label="Open the showcase: every card and sticker">
              <span className="qpanel__head">
                <span className="qshowcase__title"><Glyph name="card" size={15} /> Showcase</span>
                <span className="faint">{uniqueCards}/{CARDS.length} cards · {earned.length} stickers ›</span>
              </span>
              {collector.cards.length === 0 && earned.length === 0 ? (
                <span className="faint qshowcase__empty">Nothing yet. Cards and stickers are earned by checking in, completing quests and trading well.</span>
              ) : (
                <>
                  {collector.cards.length > 0 && (
                    <span className="qshowcase__cards">
                      {collector.cards.slice(0, 5).map((card) => <CardFace key={card.id} card={card} size="sm" copies={card.copies} />)}
                    </span>
                  )}
                  {earned.length > 0 && (
                    <span className="qstickers qstickers--row">
                      {earned.slice(0, 8).map((entry) => <Sticker key={entry.id} sticker={entry} />)}
                    </span>
                  )}
                </>
              )}
            </button>
          </>
        )}
      </div>

      {ratingOpen && page && (
        <RatingSheet profile={page} rating={page.rating} onClose={() => setRatingOpen(false)} onReviews={onReviews} />
      )}
      {showcase && collector && (
        <ShowcaseModal cards={collector.cards} stickers={collector.stickers} whose="theirs" start={showcase}
          onClose={() => setShowcase(null)} />
      )}
    </>
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

/* ── The collection of delivered purchases ────────────────────────────── */

/**
 * Things this person bought and received, as cards on shelves.
 *
 * The owner adds a delivered item with one tap, names the card, sorts cards
 * onto shelves and can take one off again. Everyone else sees the shelves.
 * Tapping a card opens every photo of the item full screen.
 */
export function PurchasedCollection({ userId, isMe }: { userId: string; isMe: boolean }) {
  const toast = useToast();
  const [shelf, setShelf] = useState<CollectionShelf | null>(null);
  const [candidates, setCandidates] = useState<CollectionCandidate[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [viewing, setViewing] = useState<CollectionItem | null>(null);
  const [newShelf, setNewShelf] = useState('');
  const [managing, setManaging] = useState(false);

  const load = useCallback(async () => {
    try {
      if (isMe) {
        const result = await api.myCollection();
        setShelf({ groups: result.groups, items: result.items });
        setCandidates(result.candidates);
      } else {
        setShelf(await api.collection(userId));
      }
    } catch {
      setShelf({ groups: [], items: [] });
    }
  }, [isMe, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(write: () => Promise<CollectionShelf>, done?: string) {
    try {
      const result = await write();
      setShelf({ groups: result.groups, items: result.items });
      if (done) toast(done, 'ok');
      return true;
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not save.', 'error');
      return false;
    }
  }

  async function add(candidate: CollectionCandidate) {
    const ok = await run(() => api.collectionAdd(candidate.orderId, undefined, filter !== 'all' && filter !== 'none' ? filter : null), 'Added to your collection · +10 XP');
    if (ok) setCandidates((list) => list.filter((entry) => entry.orderId !== candidate.orderId));
  }

  async function remove(item: CollectionItem) {
    const ok = await run(() => api.collectionRemove(item.orderId), 'Taken off your page');
    if (ok) void load();
  }

  if (!shelf) return <SkeletonText lines={3} />;

  const shown = shelf.items.filter((item) =>
    filter === 'all' ? true : filter === 'none' ? item.groupId === null : item.groupId === filter,
  );
  const hasUnsorted = shelf.items.some((item) => item.groupId === null);

  return (
    <div className="stack qcollection">
      <p className="faint" style={{ margin: 0 }}>
        {isMe
          ? 'Things delivered to you, as cards. Add one when it arrives, give it a name, and sort your cards onto shelves.'
          : 'Things delivered to them through Figmark, as cards.'}
      </p>

      {isMe && candidates.length > 0 && (
        <section className="qready">
          <div className="qpanel__head">
            <h3><Glyph name="gift" size={15} /> Ready to add · {candidates.length}</h3>
          </div>
          <div className="qready__row">
            {candidates.map((candidate) => (
              <div key={candidate.orderId} className="qready__item">
                <Thumb seed={candidate.listingId} label={candidate.itemName} photo={candidate.photo ? { url: candidate.photo } : null}
                  className="thumb qready__thumb" />
                <span className="qready__name">{candidate.itemName}</span>
                <small className="faint">Delivered {formatDate(candidate.deliveredAt)}</small>
                <button type="button" className="btn btn--sm qbtn-gold" onClick={() => void add(candidate)}>Add</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {(shelf.groups.length > 0 || isMe) && (
        <div className="chips qshelves">
          <button type="button" className={`chip${filter === 'all' ? ' is-on' : ''}`} onClick={() => setFilter('all')}>
            All {shelf.items.length}
          </button>
          {shelf.groups.map((group) => (
            <button key={group.id} type="button" className={`chip${filter === group.id ? ' is-on' : ''}`} onClick={() => setFilter(group.id)}>
              {group.name} {shelf.items.filter((item) => item.groupId === group.id).length}
            </button>
          ))}
          {shelf.groups.length > 0 && hasUnsorted && (
            <button type="button" className={`chip${filter === 'none' ? ' is-on' : ''}`} onClick={() => setFilter('none')}>
              Unsorted
            </button>
          )}
          {isMe && (
            <button type="button" className="chip qshelves__manage" onClick={() => setManaging(true)}>+ Shelves</button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState title={shelf.items.length === 0 ? 'No collection yet' : 'Nothing on this shelf'}>
          {shelf.items.length === 0
            ? (isMe ? 'When an order is delivered it shows up above, ready to add.' : 'Nothing added yet.')
            : 'Move cards here from the menu under each one.'}
        </EmptyState>
      ) : (
        <div className="qitems">
          {shown.map((item) => (
            <ItemCard key={item.orderId} item={item} isMe={isMe} groups={shelf.groups}
              onOpen={() => setViewing(item)}
              onRename={(name) => run(() => api.collectionEdit(item.orderId, { name }))}
              onMove={(groupId) => run(() => api.collectionEdit(item.orderId, { groupId }), 'Moved')}
              onRemove={() => void remove(item)} />
          ))}
        </div>
      )}

      {viewing && (viewing.photos.length > 0 ? (
        <Lightbox photos={viewing.photos} start={0} onClose={() => setViewing(null)}
          title={viewing.name} caption={`Delivered ${formatDate(viewing.deliveredAt)} · added ${formatDate(viewing.addedAt)}`} />
      ) : (
        <Modal title={viewing.name} onClose={() => setViewing(null)}>
          <div className="qsheet">
            <Thumb seed={viewing.listingId} label={viewing.name} className="thumb qitem__big" />
            <p className="faint">Delivered {formatDate(viewing.deliveredAt)} · added to collection {formatDate(viewing.addedAt)}</p>
            <p className="faint" style={{ margin: 0 }}>This item had no photos when it was added.</p>
          </div>
        </Modal>
      ))}

      {managing && (
        <Modal title="Shelves" onClose={() => setManaging(false)}>
          <div className="stack">
            <p className="faint" style={{ margin: 0 }}>Group your cards however you like - by series, by shop, by year. Deleting a shelf keeps its cards.</p>
            {shelf.groups.map((group) => (
              <ShelfRow key={group.id} name={group.name}
                onRename={(name) => run(() => api.collectionGroups('rename', { id: group.id, name }))}
                onDelete={() => {
                  if (filter === group.id) setFilter('all');
                  void run(() => api.collectionGroups('delete', { id: group.id }), 'Shelf deleted');
                }} />
            ))}
            <form className="row qshelf__new" onSubmit={(event) => {
              event.preventDefault();
              if (!newShelf.trim()) return;
              void run(() => api.collectionGroups('create', { name: newShelf.trim() }), 'Shelf added').then((ok) => ok && setNewShelf(''));
            }}>
              <input value={newShelf} onChange={(event) => setNewShelf(event.target.value)} maxLength={30}
                placeholder="New shelf, e.g. Gunpla" aria-label="New shelf name" />
              <button type="submit" className="btn btn--sm" disabled={!newShelf.trim()}>Add</button>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * One card: the item's picture, and its name underneath.
 *
 * The owner types straight into the name. The field never grows - a long
 * name is cut with an ellipsis once you leave it - so every card in the grid
 * stays the same size.
 */
function ItemCard({ item, isMe, groups, onOpen, onRename, onMove, onRemove }: {
  item: CollectionItem;
  isMe: boolean;
  groups: CollectionShelf['groups'];
  onOpen: () => void;
  onRename: (name: string) => Promise<boolean>;
  onMove: (groupId: string | null) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [menu, setMenu] = useState(false);
  useEffect(() => setName(item.name), [item.name]);

  async function commit() {
    const next = name.trim();
    if (!next) {
      setName(item.name);
      return;
    }
    if (next !== item.name && !(await onRename(next))) setName(item.name);
  }

  return (
    <div className="qitem">
      <button type="button" className="qitem__open" onClick={onOpen} aria-label={`Open photos of ${item.name}`}>
        <Thumb seed={item.listingId} label={item.name} photo={item.photos[0] ? { url: item.photos[0] } : null} className="thumb qitem__thumb">
          {item.photos.length > 1 && <span className="qitem__count">{item.photos.length}</span>}
        </Thumb>
      </button>
      {isMe ? (
        <input className="qitem__name" value={name} maxLength={60} aria-label="Card name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
      ) : (
        <span className="qitem__label" title={item.name}>{item.name}</span>
      )}
      {isMe && (
        <div className="qitem__tools">
          <button type="button" className="qitem__more" aria-label="Card options" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
          {menu && (
            <div className="qitem__menu" role="menu">
              <label className="qitem__menurow">
                <span>Shelf</span>
                <select value={item.groupId ?? ''} onChange={(event) => { setMenu(false); void onMove(event.target.value || null); }}>
                  <option value="">Unsorted</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <button type="button" className="qitem__menurow qitem__remove" onClick={() => { setMenu(false); onRemove(); }}>
                Take off my page
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ShelfRow({ name, onRename, onDelete }: { name: string; onRename: (name: string) => Promise<boolean>; onDelete: () => void }) {
  const [value, setValue] = useState(name);
  return (
    <div className="row qshelf__row">
      <input value={value} maxLength={30} aria-label="Shelf name" onChange={(event) => setValue(event.target.value)}
        onBlur={() => { if (value.trim() && value.trim() !== name) void onRename(value.trim()); else setValue(name); }} />
      <button type="button" className="btn btn--sm btn--quiet" onClick={onDelete}>Delete</button>
    </div>
  );
}

/* ── The page ──────────────────────────────────────────────────────────── */

type Tab = 'feed' | 'reviews' | 'collection';

export function CollectorProfile({ profile, isMe, onFollow, reload }: {
  profile: PublicProfile;
  isMe: boolean;
  onFollow: (following: boolean, followers?: number) => void;
  reload: () => void;
}) {
  const [posts, setPosts] = useState<PostCard[] | null>(null);
  const [tab, setTab] = useState<Tab>('collection');

  // Posts are read when the tab is first opened: most visits are not for them.
  useEffect(() => setPosts(null), [profile.sellerId]);
  useEffect(() => {
    if (tab !== 'feed' || posts !== null) return;
    void api.personPosts(profile.sellerId).then((result) => setPosts(result.posts)).catch(() => setPosts([]));
  }, [tab, posts, profile.sellerId]);

  const person: Person = {
    userId: profile.sellerId,
    displayName: profile.displayName,
    handle: profile.handle,
    photoUrl: profile.photoUrl,
    coverUrl: profile.coverUrl,
    bio: profile.bio,
    tags: profile.tags,
    memberSince: profile.memberSince,
    lastSeenAt: profile.lastSeenAt,
  };

  return (
    <main className="storefront qprofile">
      <CollectorHeader person={person} page={profile} onReviews={() => setTab('reviews')}
        actions={<PageActions profile={profile} isMe={isMe} onFollow={onFollow}
          edit={<Link to="/me?tab=settings" className="pbtn pbtn--follow">Edit profile</Link>} />} />

      <div className="storefront__body">
        <div className="tabs" style={{ marginTop: 16 }}>
          <button type="button" className={`tab${tab === 'collection' ? ' is-on' : ''}`} onClick={() => setTab('collection')}>
            Collection
          </button>
          <button type="button" className={`tab${tab === 'feed' ? ' is-on' : ''}`} onClick={() => setTab('feed')}>
            Feed {posts ? posts.length : ''}
          </button>
          <button type="button" className={`tab${tab === 'reviews' ? ' is-on' : ''}`} onClick={() => setTab('reviews')}>
            Reviews {profile.rating.count}
          </button>
        </div>

        {tab === 'collection' ? (
          <PurchasedCollection userId={profile.sellerId} isMe={isMe} />
        ) : tab === 'feed' ? (
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
        ) : (
          <ReviewsTab profile={profile} canWrite={!isMe} onWritten={reload} />
        )}
      </div>
    </main>
  );
}
