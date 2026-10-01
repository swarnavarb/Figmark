import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api, type ForumRow, type ForumsResponse, type PostCard } from '../api';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { SocialPostCard, postHref } from '../components/SocialPost';
import { PersonVoice, VoicePicker, VoiceProvider, useVoice } from '../components/SocialVoice';
import { ChannelList, ChannelRoom } from '../components/Channels';
import { Composer } from '../components/SocialComposer';
import { RoomBar, SOCIAL_VIEWS, SocialTop, type SocialView } from '../components/SocialChrome';
import { useGoBack } from '../components/ScrollManager';
import { timeAgo } from '../format';
import { MessagesView } from './MessagesPage';
import { WantedPage } from './WantedPage';

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
        <main className="page tab-view social">
          <div className="tab-view" key={view}>
            {view === 'feed' && <FollowingFeed />}
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
  const { voice, choose } = useVoice();
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

  const replace = (row: ForumRow) =>
    setData((current) => current && {
      ...current,
      forums: current.forums.map((entry) => (entry.id === row.id ? { ...entry, ...row } : entry)),
    });

  if (!data && !error) return <ForumSkeleton />;

  const mine = data?.forums.filter((row) => row.member) ?? [];
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
          <p className="faint">{mine.length === 0 ? 'Join one below to post in it.' : `${mine.length} joined`}</p>
        </div>
        {data && data.remaining > 0 && !voice.storeId && (
          <button type="button" className="followbtn" onClick={() => setCreating(!creating)}>
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
          <p className="faint">{data?.remaining} of {data?.cap} slots left while forums are being built out.</p>
        </form>
      )}

      {mine.length > 0 && (
        <div className="forumgrid">
          {mine.map((row, index) => <ForumCard key={row.id} row={row} tone={index} onChange={replace} />)}
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

function ForumCard({ row, tone, onChange }: { row: ForumRow; tone: number; onChange: (row: ForumRow) => void }) {
  const { voice } = useVoice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`forumcard forumcard--${FORUM_TONES[tone % FORUM_TONES.length]}`}>
      <Link to={`/social/f/${encodeURIComponent(row.id)}`} className="forumcard__open">
        <span className="forumcard__top">
          <span className="forumav" aria-hidden="true"><Icon name="forum" size={20} /></span>
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
              onChange((await api.joinForum(row.id)).forum);
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
