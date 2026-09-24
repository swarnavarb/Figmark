import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiRequestError,
  api,
  type ChannelRow,
  type ChannelThread,
  type ForumsResponse,
  type PostCard,
  type ShareableListing,
} from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, PersonLink, Thumb } from '../components/ui';
import { Confetti, SocialPostCard, postHref } from '../components/SocialPost';
import { VoicePicker, VoiceProvider, useVoice } from '../components/SocialVoice';
import { ChannelList, ChannelRoom } from '../components/Channels';
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
    <VoiceProvider>
      <main className="page tab-view social">
        <header className="sochero">
          <span className="sochero__streak" aria-hidden="true" />
          <div className="sochero__text">
            <p className="sochero__kicker">Figmark · live</p>
            <h1 className="sochero__title">Social</h1>
            <p className="sochero__hint">{VIEWS.find((entry) => entry.id === view)?.hint}</p>
          </div>
        </header>

        <nav className="socnav" aria-label="Social sections">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`socnav__item${view === entry.id ? ' is-on' : ''}`}
              aria-pressed={view === entry.id}
              onClick={() => setView(entry.id)}
            >
              <Icon name={entry.icon} size={17} />
              <span>{entry.label}</span>
            </button>
          ))}
        </nav>

        <div className="tab-view" key={view}>
          {view === 'feed' && <FollowingFeed />}
          {view === 'wanted' && <WantedPage />}
          {view === 'channels' && <ChannelList />}
          {view === 'forums' && <Forums />}
          {view === 'messages' && <MessagesView />}
        </div>
      </main>
    </VoiceProvider>
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

type Stream = 'following' | 'trending';

/**
 * The feed: who you follow, or what everyone is talking about.
 *
 * Two streams rather than one blended one, because they answer different
 * questions - "what did my people say" and "what am I missing" - and mixing
 * them makes the first unreliable. The top of the first still carries a strip
 * of the second, so nobody has to know the tab exists to find something new.
 *
 * Read in whichever voice is chosen, because "did I react to this" depends on
 * who is asking; switching voice reads it again.
 */
function FollowingFeed() {
  const { voice } = useVoice();
  const as = voice.storeId;
  const [stream, setStream] = useState<Stream>('following');
  const [posts, setPosts] = useState<PostCard[] | null>(null);
  const [hot, setHot] = useState<PostCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeedFilter>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [feed, trending] = await Promise.all([api.socialFeed(as), api.trending(as)]);
      setPosts(feed.posts);
      setHot(trending.posts);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your feed.');
    }
  }, [as]);

  useEffect(() => {
    setPosts(null);
    void load();
  }, [load]);

  const list = stream === 'trending' ? hot : posts;
  const shown = (list ?? []).filter((card) => matches(card, filter));

  return (
    <div className="feed">
      <Composer onPosted={load} />

      {stream === 'following' && hot && hot.length > 0 && (
        <TrendingStrip cards={hot.slice(0, 8)} onMore={() => setStream('trending')} />
      )}

      <div className="streams" role="tablist" aria-label="Which posts">
        {([
          ['following', 'For you', 'users'],
          ['trending', 'Trending', 'bolt'],
        ] as const).map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={stream === id}
            className={`streams__tab${stream === id ? ' is-on' : ''}`} onClick={() => setStream(id)}>
            <Icon name={icon} size={15} /> {label}
          </button>
        ))}
      </div>

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
      ) : !list ? (
        <FeedSkeleton />
      ) : list.length === 0 ? (
        <EmptyState title={stream === 'trending' ? 'Quiet out there' : 'Nothing here yet'}>
          {stream === 'trending'
            ? 'Nothing is catching fire right now. Post something and start it.'
            : 'Follow a shop or a person from Trending and their posts show up here.'}
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing like that yet">
          Nothing matches that filter. Try another, or be the first.
        </EmptyState>
      ) : (
        shown.map((card, index) => (
          <SocialPostCard key={`${as ?? 'me'}-${card.post.id}`} card={card}
            rank={stream === 'trending' ? index + 1 : undefined}
            onRemoved={(id) => {
              setPosts((all) => all?.filter((entry) => entry.post.id !== id) ?? null);
              setHot((all) => all?.filter((entry) => entry.post.id !== id) ?? null);
            }}
            onReposted={(repost) => setPosts((all) => [repost, ...(all ?? [])])} />
        ))
      )}
    </div>
  );
}

/**
 * The hottest few, as a row you swipe along.
 *
 * Numbered like a leaderboard, because that is what it is, and because a
 * number is the fastest way to say "this one is bigger than that one".
 */
function TrendingStrip({ cards, onMore }: { cards: PostCard[]; onMore: () => void }) {
  return (
    <section className="hotstrip" aria-label="Trending now">
      <div className="hotstrip__head">
        <h2 className="hotstrip__title"><Icon name="bolt" size={16} /> Trending now</h2>
        <button type="button" className="hotstrip__more" onClick={onMore}>See all</button>
      </div>
      <div className="hotstrip__row">
        {cards.map((card, index) => {
          const photo = card.post.photoUrls?.[0] ?? card.post.photoUrl ?? card.listing?.photoUrl ?? null;
          return (
            <Link key={card.post.id} to={postHref(card.post)}
              className={`hotcard${photo ? '' : ` hotcard--${card.post.vibe ?? HOT_TONES[index % HOT_TONES.length]}`}`}>
              {photo && <img className="hotcard__img" src={photo} alt="" loading="lazy" />}
              <span className="hotcard__rank">{index + 1}</span>
              <span className="hotcard__body">
                <span className="hotcard__who">{card.post.authorName}</span>
                <span className="hotcard__text">{card.post.body || 'Photo'}</span>
                <span className="hotcard__stats">
                  🔥 {card.social.reactions.total} · 💬 {card.social.commentCount}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const HOT_TONES = ['warm', 'hero', 'play', 'sea'] as const;

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

  return (
    <main className="page feedpage social">
      <div className="feedpage__bar">
        <Link to="/social" className="btn btn--quiet">
          <Icon name="back" size={14} /> Social
        </Link>
        <VoicePicker size={34} />
      </div>
      {error && <ErrorNotice message={error} />}
      {gone && <EmptyState title="Post deleted">It is gone, along with its reactions and comments.</EmptyState>}
      {!card && !error && <FeedSkeleton />}
      {card && !gone && (
        <SocialPostCard key={voice.storeId ?? 'me'} card={card} openComments onRemoved={() => setGone(true)} />
      )}
    </main>
  );
}

/* ── Channels ───────────────────────────────────────────────────────────── */

/**
 * A channel or forum, read as a room. Its own route rather than a mode of the
 * tab, so a room can be linked to and the back button does what it should.
 */
export const ChannelPage = ChannelRoom;

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
  const { voice } = useVoice();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [pollHours, setPollHours] = useState(24);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [party, setParty] = useState(0);
  // An item from the shop's own stock, with the post's words on top of it.
  const [item, setItem] = useState<ShareableListing | null>(null);
  const [stock, setStock] = useState<ShareableListing[] | null>(null);
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);
  const text = useRef<HTMLTextAreaElement | null>(null);

  // A different voice has different stock, and a person has none to attach.
  useEffect(() => {
    setItem(null);
    setStock(null);
    setPicking(false);
  }, [voice.storeId]);

  async function openStock() {
    setPicking(true);
    if (stock || !voice.storeId) return;
    try {
      setStock((await api.shareable(voice.storeId)).listings);
    } catch (err) {
      setStock([]);
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your items.');
    }
  }

  // A shop is addressed by its name; a person by their first one.
  const first = voice.storeId ? voice.name : (user?.displayName.split(' ')[0] ?? 'there');
  const uploading = photos.some((photo) => !photo.url && !photo.failed);
  const pollReady = !poll || poll.filter((option) => option.trim()).length >= POLL_MIN_OPTIONS;
  const canPost = !busy && !uploading && pollReady
    && (body.trim().length >= 2 || photos.some((photo) => photo.url) || Boolean(item))
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
    setItem(null);
    setPicking(false);
    setOpen(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPost({
        body: body.trim() || (item ? `Now available: ${item.title}` : ''),
        ...(voice.storeId ? { storeId: voice.storeId } : {}),
        ...(item ? { listingId: item.id } : {}),
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
      {voice.storeId && (
        <button type="button" className={`writer__tool writer__tool--item${item || picking ? ' is-on' : ''}`}
          onClick={() => {
            if (!open) expand();
            setVibe(null);
            if (picking) setPicking(false);
            else void openStock();
          }}>
          <Icon name="tag" size={18} /> <span>Item</span>
        </button>
      )}
    </div>
  );

  if (!open) {
    return (
      <div className="writer writer--closed">
        <Confetti run={party} />
        <div className="writer__prompt">
          <VoicePicker size={44} />
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
        <VoicePicker size={44} />
        <div className="writer__as">
          <strong>{voice.name}</strong>
          <span className="faint">
            {voice.storeId ? 'Posting as your storefront · tap the photo to switch' : 'To everyone following you'}
          </span>
        </div>
        <button type="button" className="iconbtn" aria-label="Close" onClick={reset}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className={vibe ? `vibe vibe--${vibe} vibe--edit` : 'writer__textwrap'}>
        <textarea ref={text} className="writer__text" value={body} rows={vibe ? 3 : 3}
          maxLength={vibe ? VIBE_MAX_CHARS : 2000}
          onChange={(e) => setBody(e.target.value)}
          placeholder={poll
            ? 'Ask a question…'
            : vibe
              ? 'Say it big…'
              : item
                ? `Say something about ${item.title}…`
                : `What's new, ${first}?`} />
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

      {picking && !item && (
        <div className="stockpick" role="listbox" aria-label="Pick an item to post">
          {!stock ? (
            <p className="faint">Loading your items…</p>
          ) : stock.length === 0 ? (
            <p className="faint">Nothing listed yet. List something from Sell and post it here.</p>
          ) : (
            stock.map((entry) => (
              <button key={entry.id} type="button" role="option" aria-selected={false} className="stockpick__item"
                onClick={() => {
                  setItem(entry);
                  setPicking(false);
                  setPoll(null);
                }}>
                {entry.photoUrl ? (
                  <img src={entry.photoUrl} alt="" className="stockpick__img" />
                ) : (
                  <Thumb seed={entry.id} label={entry.title} className="stockpick__img" />
                )}
                <span className="stockpick__name">{entry.title}</span>
                <span className="stockpick__price">{formatMoney(entry.priceMinor, entry.currency)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {item && (
        <div className="writer__item">
          {item.photoUrl ? (
            <img src={item.photoUrl} alt="" className="writer__itemimg" />
          ) : (
            <Thumb seed={item.id} label={item.title} className="writer__itemimg" />
          )}
          <span className="writer__itembody">
            <span className="spost__itemtag">For sale</span>
            <strong>{item.title}</strong>
            <span className="spost__price">{formatMoney(item.priceMinor, item.currency)}</span>
          </span>
          <button type="button" className="iconbtn" aria-label="Remove item" onClick={() => setItem(null)}>
            <Icon name="close" size={14} />
          </button>
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
          {busy ? 'Posting…' : uploading ? 'Uploading…' : 'Post'} <Icon name="send" size={14} />
        </button>
      </div>
    </form>
  );
}
