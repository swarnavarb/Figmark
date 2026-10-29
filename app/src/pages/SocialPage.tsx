import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CommunityNotices } from '../components/CommunityAlerts';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api, type ForumRow, type ForumsResponse, type PostCard } from '../api';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { SocialPostCard } from '../components/SocialPost';
import { PersonVoice, VoicePicker, VoiceProvider, useVoice } from '../components/SocialVoice';
import { ChannelList, ChannelRoom, forumHasNews, seenMap } from '../components/Channels';
import { Composer } from '../components/SocialComposer';
import { RoomBar, SOCIAL_VIEWS, SocialTop, type SocialView } from '../components/SocialChrome';
import { useGoBack } from '../components/ScrollManager';
import { timeAgo } from '../format';
import { MessagesView } from './MessagesPage';
import { WantedPage } from './WantedPage';
import { VerifyNudge } from '../components/VerifyNudges';
import { useToast } from '../components/Feedback';
import { Spinner } from '../components/Spinner';
import { FollowSuggestions } from '../components/FollowSuggestions';
import '../styles/SocialPage.css';

/**
 * The social side.
 *
 * Five ways into the people on Figmark, because they answer different
 * questions: what is happening (the feed), what one shop is saying (its
 * channel), who is hunting for what (wanted), what everybody is talking about
 * (forums), and a word in private (messages).
 *
 * Which one is open lives in the address, so coming back from a post or a
 * room lands on the section you left rather than on the feed.
 */
export function SocialPage() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('view');
  const view: SocialView = SOCIAL_VIEWS.some((entry) => entry.id === wanted) ? (wanted as SocialView) : 'feed';
  const setView = (next: SocialView) => {
    const copy = new URLSearchParams(params);
    if (next === 'feed') copy.delete('view');
    else copy.set('view', next);
    setParams(copy, { replace: true });
  };

  return (
    <VoiceProvider>
      <div className="social socialtab">
        <SocialTop view={view} onView={setView} />
        <VerifyNudge />
        <main className="page tab-view social">
          <div className="tab-view" key={view}>
            {view === 'feed' && <><CommunityNotices /><FollowingFeed /></>}
            {view === 'wanted' && <WantedPage />}
            {view === 'channels' && <ChannelList />}
            {view === 'forums' && <Forums />}
            {view === 'messages' && <MessagesView />}
          </div>
        </main>
      </div>
    </VoiceProvider>
  );
}

/* ── Feed ───────────────────────────────────────────────────────────────── */

type FeedFilter = 'all' | 'photos' | 'polls' | 'sale' | 'flexes' | 'saved';

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'sale', label: '📦 Drops & unboxings' },
  { id: 'flexes', label: '🏆 Flexes' },
  { id: 'polls', label: '📊 Polls' },
  { id: 'photos', label: '📸 Photos' },
  { id: 'saved', label: '🔖 Saved' },
];

/** How often the feed asks whether anything new has been posted, while it is open and on screen. */
const NEW_POSTS_EVERY_MS = 60_000;
/** Drops from one shop this close together are one batch. */
const DROP_BATCH_MS = 6 * 3_600_000;
/** Fewer than this in a row are shown one by one. */
const DROP_BATCH_MIN = 3;

/** One entry in the feed: a post, or a run of one shop's drops folded together. */
type FeedEntry = { kind: 'post'; card: PostCard } | { kind: 'drops'; cards: PostCard[] };

const isDrop = (card: PostCard) => !card.badges?.length && !card.post.repostOf
  && (card.post.kind === 'sale' || Boolean(card.post.drop)) && Boolean(card.listing);

/**
 * Fold runs of one shop's drops - several items posted one after another -
 * into a single entry, so a shop listing twenty things does not push
 * everybody else off the screen.
 */
function batchDrops(cards: PostCard[]): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (let index = 0; index < cards.length;) {
    const first = cards[index]!;
    let end = index + 1;
    if (isDrop(first)) {
      while (end < cards.length && isDrop(cards[end]!) && cards[end]!.post.channelId === first.post.channelId
        && Date.parse(first.post.createdAt) - Date.parse(cards[end]!.post.createdAt) < DROP_BATCH_MS) end += 1;
    }
    if (end - index >= DROP_BATCH_MIN) out.push({ kind: 'drops', cards: cards.slice(index, end) });
    else for (const card of cards.slice(index, end)) out.push({ kind: 'post', card });
    index = end;
  }
  return out;
}

function matches(card: PostCard, filter: FeedFilter): boolean {
  const { post, social } = card;
  const inner = card.original ?? null;
  const hasPhotos = (entry: PostCard) => (entry.post.photoUrls?.length ?? 0) > 0 || Boolean(entry.post.photoUrl);
  switch (filter) {
    case 'photos': return hasPhotos(card) || Boolean(inner && hasPhotos(inner));
    case 'polls': return Boolean(social.poll || inner?.social.poll);
    // A shop's drop, or a buyer showing what arrived: both are stock landing.
    case 'sale': return post.kind === 'sale' || inner?.post.kind === 'sale' || Boolean(post.drop || post.delivered);
    case 'flexes': return Boolean(post.flex || inner?.post.flex);
    default: return true;
  }
}

/** A message that stays in a shop's channel or a forum, as opposed to a broadcast. */
function inRoomOnly(card: PostCard): boolean {
  return card.post.channel === 'seller' && card.post.reach === 'channel';
}

/**
 * The feed: who you follow, newest first, and nobody else.
 *
 * The shops' drops and unboxings, your people's flexes and polls, the forum
 * posts they put on their walls - in the order they were said, so "what did
 * my people post" is a question this always answers the same way. Finding
 * people you do not follow yet is Discover's job, not this one's, which is
 * what keeps a stranger from turning up between two friends.
 *
 * Read in whichever voice is chosen, because "did I react to this" depends on
 * who is asking; switching voice reads it again.
 */
function FollowingFeed() {
  const { voice } = useVoice();
  const as = voice.storeId;
  const [posts, setPosts] = useState<PostCard[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeedFilter>('all');
  /** Where this person had read up to on their last visit, to draw "all caught up" at. */
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  /** Followed posts that arrived since the newest one on screen. */
  const [fresh, setFresh] = useState<{ count: number; names: string[] } | null>(null);
  const [saved, setSaved] = useState<PostCard[] | null>(null);

  /** Which load is the latest: the voice settles after the first one has gone out, and only the newest answer counts. */
  const loading = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++loading.current;
    setError(null);
    setFresh(null);
    try {
      const page = await api.socialHome(as, undefined, true);
      if (ticket !== loading.current) return;
      setPosts(page.posts);
      setNext(page.next);
      setLastVisit((known) => known ?? page.lastVisit ?? null);
    } catch (err) {
      if (ticket !== loading.current) return;
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your feed.');
    }
  }, [as]);

  /** The next page of followed posts, under what is already here. */
  async function loadMore() {
    if (!next) return;
    setMore(true);
    try {
      const page = await api.socialHome(as, next, true);
      setPosts((current) => {
        const known = new Set((current ?? []).map((card) => card.post.id));
        return [...(current ?? []), ...page.posts.filter((card) => !known.has(card.post.id))];
      });
      setNext(page.next);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load more.');
    } finally {
      setMore(false);
    }
  }

  useEffect(() => {
    setPosts(null);
    void load();
  }, [load]);

  // Saved is its own list: posts saved from anywhere, not only from this feed.
  useEffect(() => {
    if (filter !== 'saved') return;
    let live = true;
    setSaved(null);
    api.savedPosts(as)
      .then((found) => live && setSaved(found.posts))
      .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not load what you saved.'));
    return () => {
      live = false;
    };
  }, [filter, as]);

  // Anything new from the people followed? Asked now and then while the feed
  // is on screen, and answered with a pill rather than by moving what is
  // being read.
  const newest = posts?.find((card) => !card.badges?.length)?.post.createdAt ?? null;
  useEffect(() => {
    if (!newest) return;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      api.socialHomeNew(newest).then((found) => setFresh(found.count > 0 ? found : null)).catch(() => undefined);
    };
    const timer = window.setInterval(ask, NEW_POSTS_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [newest]);

  // A channel message is said to the room, never to the feed - whatever the
  // server sends, a room message is not drawn here.
  const shown = filter === 'saved'
    ? saved ?? []
    : (posts ?? []).filter((card) => !inRoomOnly(card) && matches(card, filter));
  const entries = batchDrops(shown);
  // The line goes above the first post already seen, when something above it is new.
  const caughtUpAt = filter === 'all' && lastVisit
    ? entries.findIndex((entry, index) => index > 0 && entry.kind === 'post' && !entry.card.badges?.length
      && entry.card.post.createdAt <= lastVisit)
    : -1;
  const remove = (id: string) => setPosts((all) => all?.filter((entry) => entry.post.id !== id) ?? null);
  const repost = (card: PostCard) => setPosts((all) => [card, ...(all ?? [])]);

  return (
    <div className="feed">
      <Composer onPosted={load} />

      {fresh && filter !== 'saved' && (
        <button type="button" className="feed__fresh" onClick={() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          void load();
        }}>
          <Icon name="up" size={13} />
          {fresh.count === 1 ? '1 new post' : `${fresh.count} new posts`}
          {fresh.names.length > 0 && <span className="feed__freshwho"> from {fresh.names.join(', ')}</span>}
        </button>
      )}

      <div className="feed__filters" role="toolbar" aria-label="Show">
        {FILTERS.map((entry) => (
          <button key={entry.id} type="button" className={`chip${filter === entry.id ? ' is-on' : ''}`}
            aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorNotice message={error} />
      ) : !posts || (filter === 'saved' && !saved) ? (
        <FeedSkeleton />
      ) : posts.length === 0 && filter !== 'saved' ? (
        <>
          <EmptyState title="Your feed is quiet">
            This is where the shops, collectors and groups you follow post their drops, unboxings and flexes.
            Follow a few and it fills up.
            <span className="feed__empty-go">
              <Link to="/discover" className="btn btn--sm">Find people in Discover</Link>
              <Link to="/social?view=forums" className="btn btn--quiet btn--sm">Browse groups</Link>
            </span>
          </EmptyState>
          <FollowSuggestions title="Start with these" onFollowed={() => void load()} />
        </>
      ) : shown.length === 0 ? (
        filter === 'saved' ? (
          <EmptyState title="Nothing saved yet">
            Press ··· on any post and Save it to read again later. Saved posts wait here.
          </EmptyState>
        ) : (
          <EmptyState title="Nothing like that yet">
            Nothing matches that filter. Try another, or be the first.
          </EmptyState>
        )
      ) : (
        entries.map((entry, index) => (
          <FeedItem key={entry.kind === 'post' ? `${as ?? 'me'}-${entry.card.post.id}` : `drops-${entry.cards[0]!.post.id}`}
            entry={entry} caughtUp={index === caughtUpAt} onRemoved={remove} onReposted={repost} />
        ))
      )}

      {posts && next && filter !== 'saved' && (
        <button type="button" className="chmore" disabled={more} onClick={() => void loadMore()}>
          {more ? <><Spinner size={14} label="Loading" /> Show older posts</> : 'Show older posts'}
        </button>
      )}
    </div>
  );
}

/** One entry in the feed, with the "caught up" line above it when that is where the new posts stop. */
function FeedItem({ entry, caughtUp, onRemoved, onReposted }: {
  entry: FeedEntry;
  caughtUp: boolean;
  onRemoved: (id: string) => void;
  onReposted: (card: PostCard) => void;
}) {
  return (
    <>
      {caughtUp && (
        <div className="feed__caught" role="separator">
          <Icon name="check" size={14} /> <span>You're all caught up. Older posts below.</span>
        </div>
      )}
      {entry.kind === 'post'
        ? <SocialPostCard card={entry.card} onRemoved={onRemoved} onReposted={onReposted} />
        : <DropBatch cards={entry.cards} onRemoved={onRemoved} onReposted={onReposted} />}
    </>
  );
}

/**
 * A run of one shop's drops: the newest in full, the rest as a strip of
 * thumbnails that opens into the posts.
 */
function DropBatch({ cards, onRemoved, onReposted }: {
  cards: PostCard[];
  onRemoved: (id: string) => void;
  onReposted: (card: PostCard) => void;
}) {
  const [open, setOpen] = useState(false);
  const [first, ...rest] = cards;
  if (open) {
    return <>{cards.map((card) => <SocialPostCard key={card.post.id} card={card} onRemoved={onRemoved} onReposted={onReposted} />)}</>;
  }
  return (
    <div className="dropbatch">
      <SocialPostCard card={first!} onRemoved={onRemoved} onReposted={onReposted} />
      <button type="button" className="dropbatch__more" onClick={() => setOpen(true)}>
        <span className="dropbatch__thumbs" aria-hidden="true">
          {rest.slice(0, 4).map((card) => (card.listing?.photoUrl
            ? <img key={card.post.id} src={card.listing.photoUrl} alt="" loading="lazy" />
            : <span key={card.post.id} className="dropbatch__blank" />))}
        </span>
        <span>
          <strong>{first!.post.authorName}</strong> posted {rest.length} more {rest.length === 1 ? 'item' : 'items'}
        </span>
        <Icon name="chevron" size={14} />
      </button>
    </div>
  );
}

/** Grey shapes where posts are about to be, so the page does not jump when they land. */
function FeedSkeleton() {
  return (
    <>
      {[0, 1].map((key) => (
        <div key={key} className="spost" aria-hidden="true">
          <div className="spost__head">
            <span className="skel" style={{ width: 42, height: 42, borderRadius: '50%' }} />
            <span className="skel" style={{ width: '38%', height: 12 }} />
          </div>
          <span className="skel" style={{ width: '92%', height: 12 }} />
          <span className="skel" style={{ width: '64%', height: 12 }} />
          <span className="skel" style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 12 }} />
        </div>
      ))}
    </>
  );
}

/**
 * One post on its own page, with its conversation open.
 *
 * Where a shared link and a notification land, so it has to stand without the
 * feed around it.
 */
export function PostPage() {
  return (
    <VoiceProvider>
      <PostPageBody />
    </VoiceProvider>
  );
}

function PostPageBody() {
  const { channel, id } = useParams<{ channel: string; id: string }>();
  const { voice } = useVoice();
  const [card, setCard] = useState<PostCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const back = useGoBack('/social');

  useEffect(() => {
    if (!channel || !id) return;
    let live = true;
    api.socialPost(channel, id, voice.storeId)
      .then((detail) => live && setCard(detail.card))
      .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not load that post.'));
    return () => {
      live = false;
    };
  }, [channel, id, voice.storeId]);

  const who = card?.post.authorName;
  return (
    <div className="social">
      <RoomBar onBack={back}
        avatar={<span className="forumav" aria-hidden="true"><Icon name="spark" size={18} /></span>}
        title="Post"
        sub={who ? `by ${who}${card?.forum ? ` in ${card.forum.name}` : ''}` : undefined}
        action={card?.forum ? undefined : <VoicePicker size={34} />} />
      <main className="page feedpage social">
        {error && <ErrorNotice message={error} />}
        {gone && <EmptyState title="Post deleted">It is gone, along with its reactions and comments.</EmptyState>}
        {!card && !error && <FeedSkeleton />}
        {/* A forum post is answered as yourself, whichever voice the tab is in. */}
        {card && !gone && (card.forum ? (
          <PersonVoice>
            <SocialPostCard card={card} openComments onRemoved={() => setGone(true)} />
          </PersonVoice>
        ) : (
          <SocialPostCard key={voice.storeId ?? 'me'} card={card} openComments onRemoved={() => setGone(true)} />
        ))}
      </main>
    </div>
  );
}

/* ── Channels and forums ─────────────────────────────────────────────── */

/**
 * A shop's channel. Its own route rather than a mode of the tab, so a room can
 * be linked to and the back button does what it should.
 */
export const ChannelPage = ChannelRoom;

/* ── Forums ─────────────────────────────────────────────────────────────── */

/**
 * The forums: yours first, then the rest to join.
 *
 * A forum is a feed with a subject - people post, everybody engages - so the
 * list sells what is inside: how many are in it, and the latest thing said.
 */
function Forums() {
  const toast = useToast();
  const { voice, choose } = useVoice();
  const [data, setData] = useState<ForumsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  // Read once, so a forum stays marked new for as long as this list is open.
  const [seen] = useState(seenMap);

  const load = useCallback(async () => {
    try {
      setData(await api.forums());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the forums.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createForum({ name: name.trim(), description: description.trim() });
      setName('');
      setDescription('');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create that forum.');
    } finally {
      setBusy(false);
    }
  }

  const replace = (row: ForumRow) =>
    setData((current) => current && {
      ...current,
      forums: current.forums.map((entry) => (entry.id === row.id ? { ...entry, ...row } : entry)),
    });

  if (!data && !error) return <ForumSkeleton />;

  // The ones with something new lead, so the Groups count points somewhere.
  const mine = (data?.forums.filter((row) => row.member) ?? [])
    .map((row, index) => ({ row, index, fresh: forumHasNews(row, seen) }))
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || a.index - b.index);
  const fresh = mine.filter((entry) => entry.fresh).length;
  const others = data?.forums.filter((row) => !row.member) ?? [];

  return (
    <div className="forums">
      {error && <ErrorNotice message={error} />}

      {voice.storeId && (
        <div className="peopleonly">
          <Icon name="users" size={16} />
          <span>Forums are for people. You are acting as <strong>{voice.name}</strong>.</span>
          <button type="button" className="followbtn" onClick={() => choose(null)}>Switch to me</button>
        </div>
      )}

      <div className="forums__head">
        <div>
          <h2 className="forums__title">Your forums</h2>
          <p className="faint">
            {mine.length === 0 ? 'Join one below to post in it.' : `${mine.length} joined`}
            {fresh > 0 && ` · ${fresh} with new posts`}
          </p>
        </div>
        {data && !voice.storeId && (
          <button type="button" className="followbtn" onClick={() => {
            // Not there yet: say when they will be, rather than hiding the button.
            if (!creating && data.slots && !data.slots.canCreate) {
              toast(data.slots.message ?? 'You will be eligible to create your first forum when you reach level 5.', 'info');
              return;
            }
            setCreating(!creating);
          }}>
            <Icon name={creating ? 'close' : 'plus'} size={12} /> {creating ? 'Cancel' : 'New forum'}
          </button>
        )}
      </div>

      {creating && (
        <form className="forumnew" onSubmit={create}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it - Customs and duty" required autoFocus
            aria-label="Forum name" />
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="One line on what it is for" aria-label="What it is for" />
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create forum'}
          </button>
          {data?.slots && (
            <p className="faint">
              You have opened {data.slots.opened} of {data.slots.allowed} forum{data.slots.allowed === 1 ? '' : 's'} at level {data.slots.level}.
              {data.slots.nextLevel && ` Another unlocks at level ${data.slots.nextLevel}.`} Forums unlock at levels {data.slots.unlockLevels.join(', ')}.
            </p>
          )}
        </form>
      )}

      {mine.length > 0 && (
        <div className="forumgrid">
          {mine.map((entry) => <ForumCard key={entry.row.id} row={entry.row} tone={entry.index} fresh={entry.fresh} onChange={replace} />)}
        </div>
      )}

      {others.length > 0 && (
        <>
          <h2 className="forums__title forums__title--sub"><Icon name="bolt" size={14} /> Discover</h2>
          <div className="forumgrid">
            {others.map((row, index) => <ForumCard key={row.id} row={row} tone={index + mine.length} onChange={replace} />)}
          </div>
        </>
      )}
    </div>
  );
}

const FORUM_TONES = ['blaze', 'violet', 'volt', 'sea'] as const;

function ForumCard({ row, tone, fresh = false, onChange }: { row: ForumRow; tone: number; fresh?: boolean; onChange: (row: ForumRow) => void }) {
  const { voice } = useVoice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`forumcard forumcard--${FORUM_TONES[tone % FORUM_TONES.length]}${fresh ? ' is-unread' : ''}`}>
      <Link to={`/social/f/${encodeURIComponent(row.id)}`} className="forumcard__open">
        <span className="forumcard__top">
          <span className="forumav" aria-hidden="true"><Icon name="forum" size={20} /></span>
          {fresh && <span className="forumcard__new">New post</span>}
          <span className="forumcard__stats">
            <strong>{row.memberCount}</strong> members · <strong>{row.postCount}</strong> posts
          </span>
        </span>
        <strong className="forumcard__name">{row.name}</strong>
        <span className="forumcard__desc">{row.description || 'A room to talk in.'}</span>
        {row.lastPost && (
          <span className="forumcard__last">
            <strong>{row.lastPostBy?.split(' ')[0]}:</strong> {row.lastPost}
            {row.lastPostAt && <span className="faint"> · {timeAgo(row.lastPostAt)}</span>}
          </span>
        )}
      </Link>
      {!voice.storeId && (
        <button type="button" className={`forumcard__join${row.member ? ' is-on' : ''}`} disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              onChange((await api.joinForum(row.id, !row.member)).forum);
            } catch (err) {
              setError(err instanceof ApiRequestError ? err.message : 'Could not join.');
            } finally {
              setBusy(false);
            }
          }}>
          {row.member ? <><Icon name="check" size={13} /> Joined</> : <><Icon name="plus" size={13} /> Join</>}
        </button>
      )}
      {error && <p className="spost__error">{error}</p>}
    </div>
  );
}

function ForumSkeleton() {
  return (
    <div className="forumgrid" aria-hidden="true">
      {[0, 1, 2].map((key) => (
        <div key={key} className="forumcard">
          <span className="skel" style={{ width: 44, height: 44, borderRadius: 14 }} />
          <span className="skel" style={{ width: '60%', height: 14 }} />
          <span className="skel" style={{ width: '85%', height: 11 }} />
        </div>
      ))}
    </div>
  );
}
