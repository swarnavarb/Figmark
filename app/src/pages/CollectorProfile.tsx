import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { SocialPostCard } from '../components/SocialPost';
import { shrink } from '../components/PhotoManager';
import { Avatar, EmptyState, ErrorNotice, LevelChip, Modal, Thumb } from '../components/ui';
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
            {collector && <LevelChip tag={{ level: collector.level, title: collector.title }} />}
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {person.handle && <span className="faint">@{person.handle}</span>}

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

        {error && <ErrorNotice message={error} />}

        {page && <RatingSlab rating={page.rating} side="person" onOpen={() => setRatingOpen(true)} />}

        {!collector ? (
          <SkeletonText lines={3} />
        ) : (
          <>
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
        <RatingSheet profile={page} rating={page.rating} onClose={() => setRatingOpen(false)} onReviews={onReviews}
          record={stats ? (
            <div className="qstats rsheet__qstats">
                <Stat label="Orders completed" value={String(stats.completed)} sub={`of ${stats.orders} placed`} />
                <Stat label="Disputes won" tone="ok" value={String(stats.disputesWon)}
                  sub={stats.disputesOpen ? `${stats.disputesOpen} open` : stats.disputesSettled ? `${stats.disputesSettled} settled` : 'none open'} />
                <Stat label="Disputes lost" tone={stats.disputesLost ? 'hot' : undefined} value={String(stats.disputesLost)} sub="as decided" />
                <Stat label="Reviews written" value={String(stats.reviewsWritten)} sub="after orders" />
                <Stat label="Pre-orders" value={String(stats.preOrders)} sub="joined" />
                <Stat label="Following" value={String(stats.following)} sub="shops" />
            </div>
          ) : <SkeletonText lines={2} />} />
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
  const [viewing, setViewing] = useState<string | null>(null);
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
    const ok = await run(() => api.collectionAdd(candidate.orderId, filter !== 'all' && filter !== 'none' ? filter : null), 'Added to your collection · +20 XP');
    if (ok) setCandidates((list) => list.filter((entry) => entry.orderId !== candidate.orderId));
  }

  async function remove(item: CollectionItem) {
    setViewing(null);
    const ok = await run(() => api.collectionRemove(item.orderId), 'Taken off your page');
    if (ok) void load();
  }

  if (!shelf) return <SkeletonText lines={3} />;

  const unsorted = shelf.items.filter((item) => item.groupId === null);
  // "All" reads shelf by shelf, each under its own name, with the unsorted last.
  const sections = filter === 'all'
    ? [
      ...shelf.groups.map((group) => ({ id: group.id, name: group.name, items: shelf.items.filter((item) => item.groupId === group.id) })),
      { id: 'none', name: shelf.groups.length ? 'Unsorted' : '', items: unsorted },
    ].filter((section) => section.items.length > 0)
    : [{ id: filter, name: '', items: filter === 'none' ? unsorted : shelf.items.filter((item) => item.groupId === filter) }];
  const open = shelf.items.find((item) => item.orderId === viewing) ?? null;

  return (
    <div className="stack qcollection">
      <p className="faint" style={{ margin: 0 }}>
        {isMe
          ? 'Things delivered to you, as cards. Add one when it arrives, then open it to put it on a shelf or pick its photo.'
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
          {shelf.groups.length > 0 && unsorted.length > 0 && (
            <button type="button" className={`chip${filter === 'none' ? ' is-on' : ''}`} onClick={() => setFilter('none')}>
              Unsorted {unsorted.length}
            </button>
          )}
          {isMe && (
            <button type="button" className="chip qshelves__manage" onClick={() => setManaging(true)}>+ Shelves</button>
          )}
        </div>
      )}

      {sections.length === 0 || sections.every((section) => section.items.length === 0) ? (
        <EmptyState title={shelf.items.length === 0 ? 'No collection yet' : 'Nothing on this shelf'}>
          {shelf.items.length === 0
            ? (isMe ? 'When an order is delivered it shows up above, ready to add.' : 'Nothing added yet.')
            : 'Open a card to move it here.'}
        </EmptyState>
      ) : sections.map((section) => (
        <section key={section.id} className="qshelf">
          {section.name && <h3 className="shelfhead"><span>{section.name}</span></h3>}
          <div className="qitems">
            {section.items.map((item, i) => (
              <button key={item.orderId} type="button" className="qitem" style={{ ['--i' as string]: i }}
                onClick={() => setViewing(item.orderId)} aria-label={`Open ${item.name}`}>
                <RoyalCard item={item} />
              </button>
            ))}
          </div>
        </section>
      ))}

      {open && (
        <CardViewer item={open} isMe={isMe} groups={shelf.groups} onClose={() => setViewing(null)}
          onEdit={(changes, done) => run(() => api.collectionEdit(open.orderId, changes), done)}
          onRemove={() => void remove(open)} />
      )}

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

/** One royal card: the item in a gilded frame, its name engraved on a crested back. */
function RoyalCard({ item, photo = item.photos[0], flipped = false, big = false }: {
  item: CollectionItem;
  photo?: string;
  flipped?: boolean;
  big?: boolean;
}) {
  return (
    <span className={`royal${flipped ? ' is-flipped' : ''}${big ? ' royal--big' : ''}`}>
      <span className="royal__card">
        <span className="royal__face royal__front">
          <span className="royal__frame">
            <Thumb seed={item.listingId} label={item.name} photo={photo ? { url: photo } : null} className="thumb royal__thumb" />
          </span>
          <span className="royal__plate">{item.name}</span>
        </span>
        <span className="royal__face royal__back">
          <span className="royal__crest" aria-hidden="true">♛</span>
          <span className="royal__name">{item.name}</span>
          <span className="royal__date">Delivered {formatDate(item.deliveredAt)}</span>
        </span>
      </span>
    </span>
  );
}

/**
 * A card opened: the same card, larger, on a turntable. Arrows walk its photos.
 * The owner can shelve it, choose the photo it leads with, and hide the rest.
 */
function CardViewer({ item, isMe, groups, onClose, onEdit, onRemove }: {
  item: CollectionItem;
  isMe: boolean;
  groups: CollectionShelf['groups'];
  onClose: () => void;
  onEdit: (changes: { groupId?: string | null; cover?: string; hidden?: string[]; own?: string }, done?: string) => Promise<boolean>;
  onRemove: () => void;
}) {
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const photos = item.photos;
  const photo = photos[Math.min(index, photos.length - 1)];
  const hidden = item.hiddenPhotos ?? [];
  const isHidden = photo !== undefined && hidden.includes(photo);
  const step = (by: number) => { setFlipped(false); setIndex((at) => (at + by + photos.length) % photos.length); };

  async function upload(file: File) {
    setUploading(true);
    try {
      const stored = await api.uploadPhoto(await shrink(file));
      if (await onEdit({ own: stored.url }, 'Your photo is the cover now')) setIndex(0);
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That photo did not upload.', 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="qviewer">
        <div className="qviewer__stage">
          {photos.length > 1 && (
            <button type="button" className="qviewer__arrow" aria-label="Previous photo" onClick={() => step(-1)}>‹</button>
          )}
          {/* A tap turns it over, front to back and back again. */}
          <button type="button" className="qviewer__card" onClick={() => setFlipped(!flipped)}
            aria-label={flipped ? 'Show the front' : 'Turn it over'} aria-pressed={flipped}>
            <RoyalCard item={item} photo={photo} flipped={flipped} big />
          </button>
          {photos.length > 1 && (
            <button type="button" className="qviewer__arrow" aria-label="Next photo" onClick={() => step(1)}>›</button>
          )}
        </div>
        {photos.length > 1 && (
          <div className="qviewer__dots" aria-hidden="true">
            {photos.map((url, i) => <i key={url} className={`${i === index ? 'is-on' : ''}${hidden.includes(url) ? ' is-hidden' : ''}`} />)}
          </div>
        )}
        <p className="faint" style={{ margin: 0 }}>
          Tap the card to turn it over · delivered {formatDate(item.deliveredAt)}
          {isHidden && ' · this photo is hidden from others'}
        </p>

        {isMe && (
          <div className="qviewer__tools">
            <input ref={fileInput} type="file" accept="image/*" hidden
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
            <button type="button" className="btn btn--sm qbtn-gold" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? 'Uploading…' : item.ownPhoto ? 'Change your cover photo' : 'Add your own cover photo'}
            </button>
            <label className="field">
              <span>Shelf</span>
              <select value={item.groupId ?? ''} onChange={(event) => void onEdit({ groupId: event.target.value || null }, 'Moved')}>
                <option value="">Unsorted</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            {photo && index > 0 && (
              <div className="row">
                <button type="button" className="btn btn--sm btn--quiet"
                  onClick={() => void onEdit({ cover: photo, hidden: hidden.filter((url) => url !== photo) }, 'Now the cover photo').then((ok) => ok && setIndex(0))}>
                  Make this the cover
                </button>
                <button type="button" className="btn btn--sm btn--quiet"
                  onClick={() => void onEdit({ hidden: isHidden ? hidden.filter((url) => url !== photo) : [...hidden, photo] }, isHidden ? 'Shown to others' : 'Hidden from others')}>
                  {isHidden ? 'Show to others' : 'Hide from others'}
                </button>
              </div>
            )}
            <button type="button" className="btn btn--sm btn--quiet qitem__remove" onClick={onRemove}>Take off my page</button>
          </div>
        )}
      </div>
    </Modal>
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
