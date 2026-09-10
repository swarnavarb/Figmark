import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import { isAnnouncement } from '@shared/posts';
import { formatMoney, timeAgo } from '../format';
import { MessagesView } from './MessagesPage';
import { useSession } from '../session';

type View = 'feed' | 'channels' | 'forums' | 'messages';

const VIEWS: { id: View; label: string; glyph: string; hint: string }[] = [
  { id: 'feed', label: 'Feed', glyph: '✳️', hint: 'Everything from the people and shops you follow' },
  { id: 'channels', label: 'Channels', glyph: '💬', hint: 'One thread per seller' },
  { id: 'forums', label: 'Forums', glyph: '🏛️', hint: 'Shared rooms' },
  { id: 'messages', label: 'Messages', glyph: '✉️', hint: 'Talk to anyone with a username' },
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
  const [view, setView] = useState<View>('feed');

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
            <span className="pill__glyph" aria-hidden="true">{entry.glyph}</span>
            <span className="pill__label">{entry.label}</span>
          </button>
        ))}
      </div>

      <div className="tab-view" key={view}>
        {view === 'feed' && <FollowingFeed />}
        {view === 'channels' && <Channels />}
        {view === 'forums' && <Forums />}
        {view === 'messages' && <MessagesView />}
      </div>
    </main>
  );
}

/* ── Feed ───────────────────────────────────────────────────────────────── */

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
  if (!posts) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <Composer onPosted={load} />
      {posts.length === 0 ? (
        <EmptyState title="Nothing here yet">
          Follow a seller from their listing and their updates show up here.
        </EmptyState>
      ) : (
        posts.map((card) => <PostView key={card.post.id} card={card} />)
      )}
    </div>
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
              {row.lastPostKind === 'sale' && '🏷️ '}
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
              ? 'This is where you tell the people who follow you what is happening — a batch closing, customs cleared, a delay. It stays here rather than going to everyone\'s feed.'
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
          <span>📣 Send as an announcement</span>
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
            🏷️
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

/**
 * Write an update, or a post into a forum.
 *
 * Outside a forum the post goes somewhere: your own profile, or a shop you run.
 * The choice only appears when there is one to make - one shop and no picker,
 * no shops and no picker either.
 */
function Composer({ forumId, onPosted }: { forumId?: string; onPosted: () => void | Promise<void> }) {
  const { user } = useSession();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreAccess[]>([]);
  const [as, setAs] = useState('');

  useEffect(() => {
    if (forumId) return;
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
  }, [forumId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createPost(
        forumId
          ? { body: body.trim(), forumId }
          : { body: body.trim(), ...(as ? { storeId: as } : {}) },
      );
      setBody('');
      await onPosted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card card--pad form" onSubmit={submit}>
      <label className="field">
        <span>{forumId ? 'Post to this forum' : 'Post an update'}</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2}
          placeholder={forumId ? 'Ask something, or answer something.' : `What's new in your shop, ${user?.displayName.split(' ')[0] ?? 'there'}?`} />
        {!forumId && (
          <span className="field__hint">Goes to everyone following you, on their feed and in your channel.</span>
        )}
      </label>
      {!forumId && stores.length > 0 && (
        <label className="field">
          <span>Post as</span>
          <select value={as} onChange={(e) => setAs(e.target.value)}>
            <option value="">{user?.displayName ?? 'Me'} — my profile</option>
            {stores.map((store) => (
              <option key={store.ownerId} value={store.ownerId}>{store.name}</option>
            ))}
          </select>
        </label>
      )}

      {error && <ErrorNotice message={error} />}
      <button type="submit" className="btn" disabled={busy || body.trim().length < 2}
        style={{ justifySelf: 'start' }}>
        {busy ? 'Posting…' : 'Post'}
      </button>
    </form>
  );
}

/** One post, with the item attached when it is a sale post. */
function PostView({ card }: { card: PostCard }) {
  const { post, listing, author } = card;

  return (
    <article className="card card--pad post">
      <div className="post__head">
        <Avatar name={post.authorName} size={38} />
        <div className="post__who">
          {/* The name opens who wrote it, which is what a name is for. Their
              feed is still one tap away, on the line below — it used to be
              what the name did, and losing that path was not the point. */}
          <PersonLink party={author} className="post__name">{post.authorName}</PersonLink>
          <span className="faint">
            {post.kind === 'sale' && '🏷️ For sale · '}
            {post.kind === 'thread' && '🏛️ Forum · '}
            <Link to={`/social/c/${post.channelId}`} className="personlink">their feed</Link>
            {' · '}
            {timeAgo(post.createdAt)}
          </span>
        </div>
      </div>

      <p className="post__body">{post.body}</p>

      {listing && (
        <Link to={`/listing/${listing.id}`} className="channel" style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
          <div className="channel__body">
            <div className="channel__top">
              <span className="channel__name">{listing.title}</span>
              <span className="badge badge--accent">{formatMoney(listing.priceMinor, listing.currency)}</span>
            </div>
            <span className="channel__last">{listing.condition} · tap to open the listing</span>
          </div>
        </Link>
      )}

      <div className="post__foot">
        <span>♥ {post.likeCount}</span>
        <span>{post.replyCount} replies</span>
      </div>
    </article>
  );
}
