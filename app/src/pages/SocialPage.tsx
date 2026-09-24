import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiRequestError,
  api,
  type ChannelRow,
  type ChannelThread,
  type ForumsResponse,
  type PostCard,
} from '../api';
import type { StoreAccess } from '@shared/stores';
import { Avatar, EmptyState, ErrorNotice, Icon, PersonLink, Thumb } from '../components/ui';
import { Confetti, SocialPostCard } from '../components/SocialPost';
import { shrink } from '../components/PhotoManager';
import {
  POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, POLL_OPTION_MAX_CHARS, POST_MAX_PHOTOS, VIBES, VIBE_MAX_CHARS,
  type Vibe,
} from '@shared/social';
import type { IconName } from '../components/Icon';
import { isAnnouncement } from '@shared/posts';
import { formatMoney, timeAgo } from '../format';
import { MessagesView } from './MessagesPage';
import { WantedPage } from './WantedPage';
import { useSession } from '../session';

type View = 'feed' | 'channels' | 'wanted' | 'forums' | 'messages';

const VIEWS: { id: View; label: string; icon: IconName; hint: string }[] = [
  { id: 'feed', label: 'Feed', icon: 'spark', hint: 'Everything from the people and shops you follow' },
  { id: 'channels', label: 'Channels', icon: 'message', hint: 'One thread per seller' },
  { id: 'wanted', label: 'Wanted', icon: 'search', hint: 'What people are hunting for' },
  { id: 'forums', label: 'Forums', icon: 'forum', hint: 'Shared rooms' },
  { id: 'messages', label: 'Messages', icon: 'mail', hint: 'Talk to anyone with a username' },
];

/**
 * The social side.
 *
 * Three ways into the same posts, because they answer different questions:
 * "what is happening", "what has this one seller been saying", and "what is
 * everyone talking about". The first is a feed, the second a message list, the
 * third a set of rooms. Messages sit alongside them rather than in their own
 * tab: reading what someone posted and asking them about it are the same
 * errand.
 */
export function SocialPage() {
  // A notification points at a view, and sometimes at one thing inside it.
  // Reading it from the URL is what makes tapping one land where it promised
  // rather than on the tab it happens to be filed under.
  const [params] = useSearchParams();
  const wanted = params.get('view');
  const [view, setView] = useState<View>(
    VIEWS.some((entry) => entry.id === wanted) ? (wanted as View) : 'feed',
  );

  return (
    <main className="page tab-view">
      <div className="page__head">
        <div>
          <h1>Social</h1>
          <p className="muted">{VIEWS.find((entry) => entry.id === view)?.hint}</p>
        </div>
      </div>

      <div className="pills" style={{ marginBottom: 18 }}>
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`pill${view === entry.id ? ' is-on' : ''}`}
            aria-pressed={view === entry.id}
            onClick={() => setView(entry.id)}
          >
            <span className="pill__glyph"><Icon name={entry.icon} size={19} /></span>
            <span className="pill__label">{entry.label}</span>
          </button>
        ))}
      </div>

      <div className="tab-view" key={view}>
        {view === 'feed' && <FollowingFeed />}
        {view === 'wanted' && <WantedPage />}
        {view === 'channels' && <Channels />}
        {view === 'forums' && <Forums />}
        {view === 'messages' && <MessagesView />}
      </div>
    </main>
  );
}

/* ── Feed ───────────────────────────────────────────────────────────────── */

type FeedFilter = 'all' | 'photos' | 'polls' | 'sale' | 'hot';

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'photos', label: '📸 Photos' },
  { id: 'polls', label: '📊 Polls' },
  { id: 'sale', label: '🏷️ For sale' },
  { id: 'hot', label: '🔥 Popular' },
];

function matches(card: PostCard, filter: FeedFilter): boolean {
  const { post, social } = card;
  const inner = card.original ?? null;
  const hasPhotos = (entry: PostCard) => (entry.post.photoUrls?.length ?? 0) > 0 || Boolean(entry.post.photoUrl);
  switch (filter) {
    case 'photos': return hasPhotos(card) || Boolean(inner && hasPhotos(inner));
    case 'polls': return Boolean(social.poll || inner?.social.poll);
    case 'sale': return post.kind === 'sale' || inner?.post.kind === 'sale';
    case 'hot': return social.reactions.total + social.commentCount * 2 >= 10;
    default: return true;
  }
}

/**
 * Everything from everyone you follow, newest first, sale posts included.
 *
 * People and shops both land here. An account can post as either, and which
 * voice it used decides whose page the name opens — but the feed does not care
 * which it was: what you follow is what you see.
 */
function FollowingFeed() {
  const [posts, setPosts] = useState<PostCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeedFilter>('all');

  const load = useCallback(async () => {
    try {
      setPosts((await api.socialFeed()).posts);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your feed.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNotice message={error} />;

  const shown = (posts ?? []).filter((card) => matches(card, filter));

  return (
    <div className="feed">
      <Composer onPosted={load} />

      <div className="feed__filters" role="toolbar" aria-label="Show">
        {FILTERS.map((entry) => (
          <button key={entry.id} type="button" className={`chip${filter === entry.id ? ' is-on' : ''}`}
            aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {!posts ? (
        <FeedSkeleton />
      ) : posts.length === 0 ? (
        <EmptyState title="Nothing here yet">
          Follow a seller from their listing and their updates show up here.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing like that yet">
          Nobody you follow has posted one of those. Try another filter, or be the first.
        </EmptyState>
      ) : (
        shown.map((card) => (
          <SocialPostCard key={card.post.id} card={card}
            onRemoved={(id) => setPosts((list) => list?.filter((entry) => entry.post.id !== id) ?? null)}
            onReposted={(repost) => setPosts((list) => [repost, ...(list ?? [])])} />
        ))
      )}
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
  const { channel, id } = useParams<{ channel: string; id: string }>();
  const [card, setCard] = useState<PostCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!channel || !id) return;
    let live = true;
    api.socialPost(channel, id)
      .then((detail) => live && setCard(detail.card))
      .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not load that post.'));
    return () => {
      live = false;
    };
  }, [channel, id]);

  return (
    <main className="page feedpage">
      <Link to="/social" className="btn btn--quiet" style={{ marginBottom: 12 }}>
        <Icon name="back" size={14} /> Social
      </Link>
      {error && <ErrorNotice message={error} />}
      {gone && <EmptyState title="Post deleted">It is gone, along with its reactions and comments.</EmptyState>}
      {!card && !error && <FeedSkeleton />}
      {card && !gone && <SocialPostCard card={card} openComments onRemoved={() => setGone(true)} />}
    </main>
  );
}

/* ── Channels ───────────────────────────────────────────────────────────── */

/**
 * One row per seller followed, newest first.
 *
 * A message list rather than a feed: who, what they last said, and when. That
 * is the shape people already read fluently, and it makes a quiet seller
 * visibly quiet instead of simply absent.
 */
function Channels() {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .channels()
      .then((result) => setRows(result.channels))
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your channels.'),
      );
  }, []);

  if (error) return <ErrorNotice message={error} />;
  if (!rows) return <p className="muted">Loading…</p>;
  if (rows.length === 0) {
    return (
      <EmptyState title="No channels yet">
        A channel belongs to a shop. Open one and yours appears here; follow a shop and theirs does
        too.
      </EmptyState>
    );
  }

  return (
    <div className="card">
      {rows.map((row) => (
        <Link key={row.sellerId} to={`/social/c/${row.sellerId}`} className="channel">
          {row.photoUrl ? (
            <img className="channel__photo" src={row.photoUrl} alt="" />
          ) : (
            <Avatar name={row.name} size={46} />
          )}
          <div className="channel__body">
            <div className="channel__top">
              <span className="channel__name">
                {row.name}
                {row.mine && <span className="badge badge--accent" style={{ marginLeft: 8 }}>yours</span>}
              </span>
              <span className="faint">{row.lastPostAt ? timeAgo(row.lastPostAt) : ''}</span>
            </div>
            <span className="channel__last">
              {row.lastPostKind === 'sale' && <Icon name="tag" size={12} />}
              {row.lastPost ?? (row.mine ? 'Say something to your followers' : 'No posts yet')}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * One channel or forum, read as a thread.
 *
 * Its own route rather than a mode of the tab, so a thread can be linked to and
 * the back button does what it should.
 */
export function ChannelPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const [data, setData] = useState<ChannelThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<'announcements' | 'everything'>('announcements');
  const foot = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.channelThread(id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this channel.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const isForum = data.channel.kind === 'forum';
  // Oldest first: a channel is read like a conversation, not like a feed. The
  // newest thing is at the bottom, above where you type.
  const ordered = [...data.posts].reverse();
  const shown = isForum || show === 'everything'
    ? ordered
    : ordered.filter((card) => isAnnouncement(card.post));

  return (
    <main className="page chanroom">
      <Link to="/social" className="btn btn--quiet" style={{ marginBottom: 12 }}>
        <Icon name="back" size={14} /> Social
      </Link>

      <header className="chanroom__head">
        <div style={{ minWidth: 0 }}>
          <h1>{data.channel.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {data.channel.mine
              ? 'Your channel. Everyone who follows the shop reads this.'
              : data.channel.description || 'No description'}
          </p>
        </div>
        {data.channel.handle && (
          <Link to={`/${data.channel.handle}`} className="btn btn--ghost btn--sm">Shop</Link>
        )}
      </header>

      {/* Two ways to read a shop's room: what the shop said, or the whole
          conversation with it. The first is the announcement board and the one
          most people want; the second is everything, including customers. */}
      {!isForum && (
        <div className="chips chips--tight">
          {([
            ['announcements', 'Announcements'],
            ['everything', 'Everything'],
          ] as const).map(([key, label]) => (
            <button key={key} type="button" className={`chip${show === key ? ' is-on' : ''}`}
              onClick={() => setShow(key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="chanroom__thread">
        {shown.length === 0 ? (
          <EmptyState title={data.channel.mine ? 'Nothing said here yet' : 'Nothing posted here yet'}>
            {data.channel.mine
              ? 'This is where you tell the people who follow you what is happening — a lot closing, customs cleared, a delay. It stays here rather than going to everyone\'s feed.'
              : isForum
                ? 'Start it off.'
                : show === 'announcements'
                  ? 'Nothing announced here. Try Everything.'
                  : 'Nobody has said anything here yet.'}
          </EmptyState>
        ) : (
          shown.map((card) => (
            <ChannelMessage key={card.post.id} card={card} mine={card.post.authorId === user?.id} />
          ))
        )}
        <div ref={foot} />
      </div>

      {/* Anybody may speak in a shop's room. A shop that cannot be answered in
          its own channel is a noticeboard, and the questions would only end up
          in twenty separate private messages instead. */}
      <ChannelComposer
        channelId={data.channel.id}
        isForum={isForum}
        asShop={data.channel.mine}
        shareable={data.shareable}
        onPosted={async () => {
          await load();
          foot.current?.scrollIntoView({ behavior: 'smooth' });
        }}
      />
    </main>
  );
}

/**
 * One message in a shop's room.
 *
 * The shop's own messages and a customer's read differently because they are
 * different things: one is the announcement, the other is somebody talking back
 * to it. Aligning them opposite each other is the cheapest way to say so
 * without labelling every line.
 */
function ChannelMessage({ card, mine }: { card: PostCard; mine: boolean }) {
  const { post, listing, author } = card;
  const fromShop = (post.voice ?? 'store') === 'store';
  const announced = isAnnouncement(post);

  return (
    <div className={`bubble${fromShop ? ' bubble--shop' : ' bubble--visitor'}`
      + `${mine ? ' bubble--mine' : ''}${announced ? ' bubble--announced' : ''}`}>
      <div className="bubble__head">
        <PersonLink party={author} className="bubble__who">{post.authorName}</PersonLink>
        {/* Marked where it is read, not only where it is filtered: an
            announcement nobody can pick out of the room is just a message. */}
        {announced && post.channel !== 'forum' && (
          <span className="badge badge--accent">announcement</span>
        )}
        <span className="faint">{timeAgo(post.createdAt)}</span>
      </div>
      <p className="bubble__body">{post.body}</p>
      {listing && (
        <Link to={`/listing/${listing.id}`} className="bubble__item">
          <Thumb seed={listing.id} label={listing.title} />
          <div style={{ minWidth: 0 }}>
            <span className="bubble__itemname">{listing.title}</span>
            <span className="faint">{formatMoney(listing.priceMinor, listing.currency)}</span>
          </div>
        </Link>
      )}
    </div>
  );
}

/**
 * The bar at the bottom, which is where a room is written from.
 *
 * A message box pinned to the foot rather than a form at the top, because that
 * is what everybody already knows a room to be — and because the thing you
 * came to say is usually a sentence, not a composition.
 */
function ChannelComposer({ channelId, isForum, asShop, shareable, onPosted }: {
  channelId: string;
  isForum: boolean;
  asShop: boolean;
  shareable: ChannelThread['shareable'];
  onPosted: () => void | Promise<void>;
}) {
  const [text, setText] = useState('');
  const [listingId, setListingId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Off by default. Most of what is said in a room is conversation, and a shop
  // that announces every line has an announcement list worth nothing to open.
  const [announce, setAnnounce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attached = shareable.find((entry) => entry.id === listingId) ?? null;

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPost({
        body,
        ...(isForum ? { forumId: channelId } : { channelId }),
        ...(listingId ? { listingId } : {}),
        ...(announce ? { announcement: true } : {}),
      });
      setText('');
      setListingId(null);
      setAnnounce(false);
      await onPosted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="saybar">
      {error && <p className="notice notice--error" style={{ margin: '0 0 8px' }}>{error}</p>}

      {attached && (
        <div className="saybar__attached">
          <span style={{ minWidth: 0 }}>{attached.title}</span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setListingId(null)}>
            Remove
          </button>
        </div>
      )}

      {picking && (
        <div className="saybar__picker">
          {shareable.length === 0 ? (
            <p className="faint" style={{ margin: 0 }}>Nothing listed to share yet.</p>
          ) : (
            shareable.map((entry) => (
              <button key={entry.id} type="button" className="saybar__pick"
                onClick={() => { setListingId(entry.id); setPicking(false); }}>
                <span style={{ minWidth: 0 }}>{entry.title}</span>
                <span className="faint">{formatMoney(entry.priceMinor, entry.currency)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* The choice sits above the box rather than beside it, because it
          changes what the message is rather than adding something to it. */}
      {asShop && !isForum && (
        <label className="saybar__announce">
          <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
          <span><Icon name="megaphone" size={14} /> Send as an announcement</span>
          <span className="faint">
            {announce ? 'Pinned to the Announcements list.' : 'Just a message in the room.'}
          </span>
        </label>
      )}

      <div className="saybar__row">
        {/* Only a shop advertises in its own room. A customer attaching a
            listing here would be advertising in somebody else's shop. */}
        {asShop && !isForum && (
          <button type="button" className="saybar__attach" aria-label="Share one of your items"
            onClick={() => setPicking(!picking)}>
            <Icon name="tag" size={18} />
          </button>
        )}
        <textarea
          className="saybar__input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line, as everywhere else.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={asShop ? 'Message followers…' : 'Say something…'}
        />
        <button type="button" className="saybar__send" disabled={busy || !text.trim()}
          aria-label="Send" onClick={() => void send()}>
          {busy ? '…' : '↑'}
        </button>
      </div>
    </div>
  );
}

/* ── Forums ─────────────────────────────────────────────────────────────── */

/** A few shared rooms. Capped for now, and it says so rather than failing later. */
function Forums() {
  const [data, setData] = useState<ForumsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

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

  if (!data && !error) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      {error && <ErrorNotice message={error} />}

      <p className="notice notice--info">
        Forums are deliberately few while this is being built out
        {data && <> — {data.remaining} of {data.cap} slots left</>}. Threads, replies and moderation come later.
      </p>

      {data && data.remaining > 0 && !creating && (
        <button type="button" className="btn btn--ghost" style={{ justifySelf: 'start' }}
          onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} /> New forum
        </button>
      )}

      {creating && (
        <form className="card card--pad form" onSubmit={create}>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customs and duty" required autoFocus />
          </label>
          <label className="field">
            <span>What it is for</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="One line, so people know whether to post here." />
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create forum'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}

      {data && (
        <div className="card">
          {data.forums.map((forum) => (
            <Link key={forum.id} to={`/social/c/${forum.id}`} className="channel">
              <div className="channel__body">
                <div className="channel__top">
                  <span className="channel__name">{forum.name}</span>
                  <span className="badge">{forum.postCount}</span>
                </div>
                <span className="channel__last">{forum.description || 'No description'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */

/** How long a poll runs, as offered. */
const POLL_LENGTHS: { hours: number; label: string }[] = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 0, label: 'No end' },
];

interface DraftPhoto {
  key: string;
  preview: string;
  url: string | null;
  failed: boolean;
}

/**
 * Write an update: words, photos, a poll, or a line on a colour.
 *
 * Closed it is one tap-target with the three things you might add, so the
 * feed starts with an invitation rather than a form. Open, it grows only the
 * parts you asked for. The post goes to your own profile, or a shop you run -
 * the choice only appears when there is one to make.
 */
function Composer({ onPosted }: { onPosted: () => void | Promise<void> }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [pollHours, setPollHours] = useState(24);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreAccess[]>([]);
  const [as, setAs] = useState('');
  const [party, setParty] = useState(0);
  const picker = useRef<HTMLInputElement | null>(null);
  const text = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .stores()
      .then((result) => {
        if (cancelled) return;
        setStores(result.stores.filter((store) => store.permissions.includes('posts')));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const first = user?.displayName.split(' ')[0] ?? 'there';
  const uploading = photos.some((photo) => !photo.url && !photo.failed);
  const pollReady = !poll || poll.filter((option) => option.trim()).length >= POLL_MIN_OPTIONS;
  const canPost = !busy && !uploading && pollReady
    && (body.trim().length >= 2 || photos.some((photo) => photo.url))
    && (!vibe || body.trim().length <= VIBE_MAX_CHARS)
    && (!poll || body.trim().length >= 2);

  function expand(then?: () => void) {
    setOpen(true);
    window.setTimeout(() => {
      text.current?.focus();
      then?.();
    }, 0);
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setVibe(null);
    const room = POST_MAX_PHOTOS - photos.length;
    const chosen = [...files].filter((file) => file.type.startsWith('image/')).slice(0, room);
    if (files.length > room) setError(`Up to ${POST_MAX_PHOTOS} photos on one post.`);
    const drafts = chosen.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
      preview: URL.createObjectURL(file),
      url: null,
      failed: false,
    }));
    setPhotos((list) => [...list, ...drafts]);
    await Promise.all(chosen.map(async (file, index) => {
      const key = drafts[index]!.key;
      try {
        const stored = await api.uploadPhoto(await shrink(file));
        setPhotos((list) => list.map((photo) => (photo.key === key ? { ...photo, url: stored.url } : photo)));
      } catch (err) {
        setPhotos((list) => list.map((photo) => (photo.key === key ? { ...photo, failed: true } : photo)));
        setError(err instanceof ApiRequestError ? err.message : 'A photo would not upload.');
      }
    }));
  }

  function reset() {
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setBody('');
    setPhotos([]);
    setPoll(null);
    setVibe(null);
    setOpen(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPost({
        body: body.trim(),
        ...(as ? { storeId: as } : {}),
        photoUrls: photos.map((photo) => photo.url).filter((url): url is string => Boolean(url)),
        ...(poll ? { poll: { options: poll.map((option) => option.trim()).filter(Boolean), closesInHours: pollHours } } : {}),
        ...(vibe ? { vibe } : {}),
      });
      reset();
      setParty((count) => count + 1);
      await onPosted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
    } finally {
      setBusy(false);
    }
  }

  const tools = (
    <div className="writer__tools">
      <button type="button" className="writer__tool writer__tool--photo"
        disabled={photos.length >= POST_MAX_PHOTOS}
        onClick={() => (open ? picker.current?.click() : expand(() => picker.current?.click()))}>
        <Icon name="image" size={18} /> <span>Photo</span>
      </button>
      <button type="button" className={`writer__tool writer__tool--poll${poll ? ' is-on' : ''}`}
        onClick={() => {
          if (!open) expand();
          setVibe(null);
          setPoll(poll ? null : ['', '']);
        }}>
        <Icon name="poll" size={18} /> <span>Poll</span>
      </button>
      <button type="button" className={`writer__tool writer__tool--vibe${vibe ? ' is-on' : ''}`}
        onClick={() => {
          if (!open) expand();
          if (vibe) {
            setVibe(null);
          } else {
            setPoll(null);
            setPhotos([]);
            setVibe('hero');
          }
        }}>
        <Icon name="spark" size={18} /> <span>Colour</span>
      </button>
    </div>
  );

  if (!open) {
    return (
      <div className="writer writer--closed">
        <Confetti run={party} />
        <div className="writer__prompt">
          <Avatar name={user?.displayName ?? 'Me'} size={40} />
          <button type="button" className="writer__fake" onClick={() => expand()}>
            What's new, {first}?
          </button>
        </div>
        {tools}
      </div>
    );
  }

  const left = VIBE_MAX_CHARS - body.trim().length;

  return (
    <form className="writer" onSubmit={submit}>
      <div className="writer__prompt">
        <Avatar name={user?.displayName ?? 'Me'} size={40} />
        <div className="writer__as">
          <strong>{stores.find((store) => store.ownerId === as)?.name ?? user?.displayName}</strong>
          {stores.length > 0 ? (
            <select value={as} onChange={(e) => setAs(e.target.value)} aria-label="Post as">
              <option value="">My profile</option>
              {stores.map((store) => (
                <option key={store.ownerId} value={store.ownerId}>{store.name}</option>
              ))}
            </select>
          ) : (
            <span className="faint">To everyone following you</span>
          )}
        </div>
        <button type="button" className="iconbtn" aria-label="Close" onClick={reset}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className={vibe ? `vibe vibe--${vibe} vibe--edit` : 'writer__textwrap'}>
        <textarea ref={text} className="writer__text" value={body} rows={vibe ? 3 : 3}
          maxLength={vibe ? VIBE_MAX_CHARS : 2000}
          onChange={(e) => setBody(e.target.value)}
          placeholder={poll ? 'Ask a question…' : vibe ? 'Say it big…' : `What's new, ${first}?`} />
      </div>

      {vibe && (
        <div className="writer__vibes" role="radiogroup" aria-label="Colour">
          {VIBES.map((entry) => (
            <button key={entry} type="button" role="radio" aria-checked={vibe === entry}
              aria-label={entry} className={`writer__swatch vibe--${entry}${vibe === entry ? ' is-on' : ''}`}
              onClick={() => setVibe(entry)} />
          ))}
          <span className={`faint writer__left${left < 20 ? ' is-low' : ''}`}>{left}</span>
        </div>
      )}

      {photos.length > 0 && (
        <div className="writer__photos">
          {photos.map((photo, index) => (
            <div key={photo.key} className={`writer__photo${photo.failed ? ' is-failed' : ''}`}>
              <img src={photo.preview} alt={`Attached photo ${index + 1}`} />
              {!photo.url && !photo.failed && <span className="writer__spin" aria-label="Uploading" />}
              {photo.failed && <span className="writer__failed">Failed</span>}
              <button type="button" className="writer__unphoto" aria-label="Remove photo"
                onClick={() => {
                  URL.revokeObjectURL(photo.preview);
                  setPhotos((list) => list.filter((entry) => entry.key !== photo.key));
                }}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          {photos.length < POST_MAX_PHOTOS && (
            <button type="button" className="writer__addphoto" onClick={() => picker.current?.click()}
              aria-label="Add more photos">
              <Icon name="plus" size={20} />
            </button>
          )}
        </div>
      )}

      {poll && (
        <div className="writer__poll">
          {poll.map((option, index) => (
            <div key={index} className="writer__pollrow">
              <input value={option} maxLength={POLL_OPTION_MAX_CHARS}
                placeholder={`Option ${index + 1}`}
                onChange={(e) => setPoll(poll.map((entry, at) => (at === index ? e.target.value : entry)))} />
              {poll.length > POLL_MIN_OPTIONS && (
                <button type="button" className="iconbtn iconbtn--sm" aria-label={`Remove option ${index + 1}`}
                  onClick={() => setPoll(poll.filter((_, at) => at !== index))}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
          <div className="writer__pollfoot">
            {poll.length < POLL_MAX_OPTIONS && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setPoll([...poll, ''])}>
                <Icon name="plus" size={12} /> Add option
              </button>
            )}
            <label className="writer__pollfor">
              <span className="faint">Runs for</span>
              <select value={pollHours} onChange={(e) => setPollHours(Number(e.target.value))}>
                {POLL_LENGTHS.map((entry) => (
                  <option key={entry.hours} value={entry.hours}>{entry.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      <input ref={picker} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }} />

      {error && <p className="notice notice--error" onClick={() => setError(null)}>{error}</p>}

      <div className="writer__foot">
        {tools}
        <button type="submit" className="btn writer__post" disabled={!canPost}>
          {busy ? 'Posting…' : uploading ? 'Uploading…' : 'Post'}
        </button>
      </div>
    </form>
  );
}
