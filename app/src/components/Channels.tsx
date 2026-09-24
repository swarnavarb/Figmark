import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiRequestError, api, type ChannelRow, type ChannelThread, type PostCard } from '../api';
import { REACTIONS, REACTION_META, type ReactionKind } from '@shared/social';
import { isAnnouncement } from '@shared/posts';
import { formatMoney, timeAgo } from '../format';
import { useSession } from '../session';
import { Avatar, EmptyState, ErrorNotice, PersonLink, Thumb } from './ui';
import { Icon } from './Icon';
import { shrink } from './PhotoManager';
import { Lightbox, copyLink, withReaction } from './SocialPost';
import { VoicePicker, VoiceProvider, useVoice } from './SocialVoice';

/**
 * Channels: one room per shop, where the shop announces and its customers
 * talk back.
 *
 * The list answers "where is something new", so it leads with unread counts
 * and a way into rooms you are not in yet. The room reads like a group chat -
 * days, runs of messages, replies that quote - because that is the shape
 * everybody already knows how to read, with the shop's announcements and pins
 * standing out of it.
 */

/* ── What you have seen ────────────────────────────────────────────────── */

const SEEN_KEY = 'figmark.channels.seen';

/**
 * When each room was last opened on this device.
 *
 * Kept on the device rather than on the server: it is a nudge, not a record,
 * and a read receipt per person per room would be a write on every visit for
 * something a phone can remember perfectly well.
 */
function seenMap(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function markSeen(channelId: string) {
  try {
    const map = seenMap();
    map[channelId] = new Date().toISOString();
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {
    /* Unread counts just stay; nothing else depends on it. */
  }
}

/** How many messages arrived since you last opened it. Never opened: all of the recent ones. */
function unreadOf(row: ChannelRow, seen: Record<string, string>): number {
  const since = seen[row.sellerId];
  return (row.recent ?? []).filter((at) => !since || at > since).length;
}

/* ── The list ──────────────────────────────────────────────────────────── */

export function ChannelList() {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [discover, setDiscover] = useState<ChannelRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [seen] = useState(seenMap);

  const load = useCallback(async () => {
    try {
      const result = await api.channels();
      setRows(result.channels);
      setDiscover(result.discover ?? []);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your channels.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNotice message={error} />;
  if (!rows) return <ListSkeleton />;

  const needle = query.trim().toLowerCase();
  const match = (row: ChannelRow) => !needle || row.name.toLowerCase().includes(needle)
    || (row.lastPost ?? '').toLowerCase().includes(needle);
  const mine = rows.filter((row) => row.mine && match(row));
  const following = rows.filter((row) => !row.mine && match(row));
  const strangers = discover.filter(match);
  const totalUnread = following.reduce((sum, row) => sum + unreadOf(row, seen), 0);

  return (
    <div className="chlist">
      <label className="chlist__search">
        <Icon name="search" size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels and messages" aria-label="Search channels" />
      </label>

      {mine.map((row) => (
        <Link key={row.sellerId} to={`/social/c/${row.sellerId}`} className="chmine">
          <span className="chmine__stripes" aria-hidden="true" />
          <Avatar name={row.name} size={52} />
          <span className="chmine__body">
            <span className="chmine__kicker">Your channel</span>
            <strong className="chmine__name">{row.name}</strong>
            <span className="chmine__stats">
              {row.followerCount ?? 0} followers
              {row.lastPostAt && <> · last post {timeAgo(row.lastPostAt)}</>}
            </span>
          </span>
          <span className="chmine__cta"><Icon name="megaphone" size={15} /> Post</span>
        </Link>
      ))}

      <section className="chsection">
        <h2 className="chsection__title">
          Following
          {totalUnread > 0 && <span className="chsection__count">{totalUnread > 99 ? '99+' : totalUnread} new</span>}
        </h2>
        {following.length === 0 ? (
          <p className="chsection__empty">
            {needle ? 'No channel matches that.' : 'Follow a shop and its room shows up here.'}
          </p>
        ) : (
          <div className="chrows">
            {following.map((row) => <ChannelRowView key={row.sellerId} row={row} unread={unreadOf(row, seen)} />)}
          </div>
        )}
      </section>

      {strangers.length > 0 && (
        <section className="chsection">
          <h2 className="chsection__title"><Icon name="bolt" size={14} /> Discover channels</h2>
          <div className="chdiscover">
            {strangers.map((row) => <DiscoverCard key={row.sellerId} row={row} onFollowed={load} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function ChannelRowView({ row, unread }: { row: ChannelRow; unread: number }) {
  return (
    <Link to={`/social/c/${row.sellerId}`} className={`chrow${unread > 0 ? ' is-unread' : ''}`}>
      <span className={`chrow__ring${unread > 0 ? ' is-lit' : ''}`}>
        {row.photoUrl ? <img className="chrow__photo" src={row.photoUrl} alt="" /> : <Avatar name={row.name} size={48} />}
      </span>
      <span className="chrow__body">
        <span className="chrow__top">
          <span className="chrow__name">
            {row.name}
            {row.tier === 'pro' && <span className="chrow__tier">PRO</span>}
            {row.pinned && <Icon name="star" size={11} />}
          </span>
          <span className="chrow__time">{row.lastPostAt ? timeAgo(row.lastPostAt) : ''}</span>
        </span>
        <span className="chrow__bottom">
          <span className="chrow__last">
            {row.lastPostKind === 'sale' && <Icon name="tag" size={12} />}
            {row.lastPostBy && row.lastPostBy !== row.name && <strong>{row.lastPostBy.split(' ')[0]}: </strong>}
            {row.lastPost ?? 'No messages yet'}
          </span>
          {unread > 0 && <span className="chrow__badge">{unread > 9 ? '9+' : unread}</span>}
        </span>
      </span>
    </Link>
  );
}

function DiscoverCard({ row, onFollowed }: { row: ChannelRow; onFollowed: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="chcard">
      <Link to={`/social/c/${row.sellerId}`} className="chcard__open">
        <Avatar name={row.name} size={46} />
        <strong className="chcard__name">{row.name}</strong>
        <span className="chcard__bio">{row.bio || row.lastPost || 'A shop on Figmark'}</span>
        <span className="chcard__stats">{row.followerCount ?? 0} followers</span>
      </Link>
      <button type="button" className="followbtn chcard__follow" disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.follow(row.sellerId);
            onFollowed();
          } finally {
            setBusy(false);
          }
        }}>
        <Icon name="plus" size={12} /> Follow
      </button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="chlist" aria-hidden="true">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="chrow">
          <span className="skel" style={{ width: 48, height: 48, borderRadius: '50%' }} />
          <span className="chrow__body">
            <span className="skel" style={{ width: '45%', height: 12 }} />
            <span className="skel" style={{ width: '80%', height: 11 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── The room ──────────────────────────────────────────────────────────── */

type Show = 'announcements' | 'everything' | 'media';

/** How often an open room looks for new messages. */
const REFRESH_MS = 12_000;
/** Messages this close together from the same voice read as one run. */
const RUN_GAP_MS = 5 * 60_000;

export function ChannelRoom() {
  return (
    <VoiceProvider>
      <Room />
    </VoiceProvider>
  );
}

function photosOf(card: PostCard): string[] {
  return card.post.photoUrls?.length ? card.post.photoUrls : card.post.photoUrl ? [card.post.photoUrl] : [];
}

function dayLabel(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(day, today)) return 'Today';
  if (same(day, yesterday)) return 'Yesterday';
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function Room() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const { voice } = useVoice();
  const [data, setData] = useState<ChannelThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('everything');
  const [replyTo, setReplyTo] = useState<PostCard | null>(null);
  const [fresh, setFresh] = useState(0);
  const [pinAt, setPinAt] = useState(0);
  const [lightbox, setLightbox] = useState<{ photos: string[]; start: number } | null>(null);
  const [following, setFollowing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const known = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 220;
  // The very bottom of the page, not the last message: the bar you write from
  // sits there, and stopping at the message would leave it under the bar.
  const toBottom = (smooth = true) => window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });

  const load = useCallback(async (quiet = false) => {
    if (!id) return;
    try {
      const next = await api.channelThread(id, voice.storeId);
      const arrived = next.posts.filter((card) => !known.current.has(card.post.id));
      const wasNear = nearBottom();
      setData(next);
      setFollowing(Boolean(next.channel.following));
      next.posts.forEach((card) => known.current.add(card.post.id));
      if (quiet && arrived.length > 0 && !wasNear) setFresh((count) => count + arrived.length);
      if (quiet && arrived.length > 0 && wasNear) window.setTimeout(() => toBottom(), 50);
      markSeen(id);
    } catch (err) {
      if (!quiet) setError(err instanceof ApiRequestError ? err.message : 'Could not load this channel.');
    }
  }, [id, voice.storeId]);

  useEffect(() => {
    known.current = new Set();
    firstLoad.current = true;
    setData(null);
    void load();
  }, [load]);

  // A room is live while you are looking at it, and quiet while you are not.
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, REFRESH_MS);
    return () => window.clearInterval(tick);
  }, [load]);

  // Open at the newest message, as every chat does.
  useLayoutEffect(() => {
    if (data && firstLoad.current) {
      firstLoad.current = false;
      toBottom(false);
    }
  }, [data]);

  useEffect(() => {
    const onScroll = () => {
      if (nearBottom()) setFresh(0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isForum = data?.channel.kind === 'forum';
  const ordered = useMemo(() => [...(data?.posts ?? [])].reverse(), [data]);
  const pinned = ordered.filter((card) => card.post.pinned);
  const media = ordered.filter((card) => photosOf(card).length > 0);
  const photoCount = media.reduce((sum, card) => sum + photosOf(card).length, 0);
  const shown = show === 'media'
    ? media
    : show === 'announcements' && !isForum
      ? ordered.filter((card) => isAnnouncement(card.post))
      : ordered;

  if (error) return <main className="page social"><ErrorNotice message={error} /></main>;
  if (!data) {
    return (
      <main className="page social chroom">
        <div className="chhero chhero--loading" aria-hidden="true" />
      </main>
    );
  }

  const { channel } = data;
  const canPin = channel.mine && !isForum;

  const patch = (postId: string, change: (card: PostCard) => PostCard | null) =>
    setData((current) => current && {
      ...current,
      posts: current.posts
        .map((card) => (card.post.id === postId ? change(card) : card))
        .filter((card): card is PostCard => card !== null),
    });

  const jump = (postId: string) => {
    const node = document.getElementById(`msg-${postId}`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.remove('is-flash');
    void node.offsetWidth;
    node.classList.add('is-flash');
  };

  // Group into days, and mark where a run of messages from one voice starts.
  const blocks: ReactNode[] = [];
  let lastDay = '';
  shown.forEach((card, index) => {
    const day = dayLabel(card.post.createdAt);
    if (day !== lastDay) {
      blocks.push(<div key={`day-${card.post.id}`} className="chday"><span>{day}</span></div>);
      lastDay = day;
    }
    const before = shown[index - 1];
    const startsRun = !before || before.post.authorName !== card.post.authorName
      || dayLabel(before.post.createdAt) !== day
      || new Date(card.post.createdAt).getTime() - new Date(before.post.createdAt).getTime() > RUN_GAP_MS
      || isAnnouncement(before.post) !== isAnnouncement(card.post);
    blocks.push(
      <Message key={card.post.id} card={card} startsRun={startsRun}
        mine={card.post.authorId === user?.id} isForum={Boolean(isForum)} canPin={canPin}
        onReply={() => setReplyTo(card)} onJump={jump}
        onOpenPhoto={(start) => setLightbox({ photos: photosOf(card), start })}
        onChange={(change) => patch(card.post.id, change)}
        onNotice={setNotice} />,
    );
  });

  const current = pinned[pinAt % Math.max(1, pinned.length)];

  return (
    <main className="page social chroom">
      <div className="feedpage__bar">
        <Link to="/social?view=channels" className="btn btn--quiet"><Icon name="back" size={14} /> Channels</Link>
        <button type="button" className="btn btn--quiet" onClick={async () => {
          const url = `${window.location.origin}/social/c/${encodeURIComponent(channel.id)}`;
          try {
            await navigator.clipboard.writeText(url);
            setNotice('Link copied');
          } catch {
            window.prompt('Copy this link', url);
          }
        }}>
          <Icon name="link" size={14} /> Share
        </button>
      </div>

      <header className={`chhero${isForum ? ' chhero--forum' : ''}`}>
        <span className="chhero__stripes" aria-hidden="true" />
        <div className="chhero__row">
          <Avatar name={channel.name} size={64} />
          <div className="chhero__text">
            <h1 className="chhero__name">{channel.name}</h1>
            <p className="chhero__meta">
              {isForum ? 'Forum' : (
                <>
                  {channel.handle && <>@{channel.handle} · </>}
                  {channel.followerCount ?? 0} followers
                  {channel.tier === 'pro' && <span className="chhero__tier">PRO</span>}
                </>
              )}
            </p>
          </div>
        </div>
        {channel.description && <p className="chhero__bio">{channel.description}</p>}
        {!isForum && (
          <div className="chhero__actions">
            {channel.mine ? (
              <span className="chhero__you"><Icon name="megaphone" size={14} /> You run this channel</span>
            ) : (
              <button type="button" className={`chhero__follow${following ? ' is-on' : ''}`}
                onClick={async () => setFollowing((await api.follow(channel.id)).following)}>
                {following ? <><Icon name="check" size={14} /> Following</> : <><Icon name="plus" size={14} /> Follow</>}
              </button>
            )}
            {channel.handle && <Link to={`/${channel.handle}`} className="chhero__shop"><Icon name="tag" size={14} /> Shop</Link>}
          </div>
        )}
      </header>

      {current && show !== 'media' && (
        <button type="button" className="chpin" onClick={() => {
          jump(current.post.id);
          setPinAt((at) => at + 1);
        }}>
          <span className="chpin__bar" aria-hidden="true">
            {pinned.map((card, at) => (
              <span key={card.post.id} className={at === pinAt % pinned.length ? 'is-on' : ''} />
            ))}
          </span>
          <span className="chpin__body">
            <span className="chpin__label"><Icon name="star" size={11} /> Pinned{pinned.length > 1 && ` · ${(pinAt % pinned.length) + 1} of ${pinned.length}`}</span>
            <span className="chpin__text">{current.post.body || 'Photo'}</span>
          </span>
        </button>
      )}

      <div className="chtabs" role="tablist">
        {([
          ...(isForum ? [] : [['announcements', 'Announcements', 'megaphone'] as const]),
          ['everything', 'Everything', 'message'] as const,
          ['media', `Media${photoCount ? ` · ${photoCount}` : ''}`, 'image'] as const,
        ]).map(([key, label, icon]) => (
          <button key={key} type="button" role="tab" aria-selected={show === key}
            className={`chtabs__tab${show === key ? ' is-on' : ''}`} onClick={() => setShow(key)}>
            <Icon name={icon} size={14} /> {label}
          </button>
        ))}
      </div>

      {show === 'media' ? (
        media.length === 0 ? (
          <EmptyState title="No photos yet">Photos shared in this room collect here.</EmptyState>
        ) : (
          <div className="chmedia">
            {media.flatMap((card) => photosOf(card).map((url, at) => (
              <button key={`${card.post.id}-${at}`} type="button" className="chmedia__tile"
                onClick={() => setLightbox({ photos: photosOf(card), start: at })}>
                <img src={url} alt={card.post.body || `Photo from ${card.post.authorName}`} loading="lazy" />
              </button>
            )))}
          </div>
        )
      ) : (
        <div className="chthread">
          {shown.length === 0 ? (
            <EmptyState title={channel.mine ? 'Say the first thing' : 'Nothing here yet'}>
              {channel.mine
                ? 'Tell the people who follow you what is happening - a lot closing, customs cleared, a delay.'
                : show === 'announcements'
                  ? 'Nothing announced yet. Try Everything.'
                  : 'Nobody has said anything here yet. Ask something.'}
            </EmptyState>
          ) : blocks}
        </div>
      )}

      {fresh > 0 && (
        <button type="button" className="chnew" onClick={() => {
          setFresh(0);
          toBottom();
        }}>
          <Icon name="down" size={14} /> {fresh} new message{fresh === 1 ? '' : 's'}
        </button>
      )}

      {notice && <p className="chtoast" role="status" onAnimationEnd={() => setNotice(null)}>{notice}</p>}

      <RoomComposer data={data} replyTo={replyTo} onClearReply={() => setReplyTo(null)}
        onPosted={async () => {
          setReplyTo(null);
          if (show === 'media' || (show === 'announcements' && !channel.mine)) setShow('everything');
          await load();
          window.setTimeout(() => toBottom(), 60);
        }} />

      {lightbox && <Lightbox photos={lightbox.photos} start={lightbox.start} onClose={() => setLightbox(null)} />}
    </main>
  );
}

/* ── One message ───────────────────────────────────────────────────────── */

function Message({ card, startsRun, mine, isForum, canPin, onReply, onJump, onOpenPhoto, onChange, onNotice }: {
  card: PostCard;
  startsRun: boolean;
  mine: boolean;
  isForum: boolean;
  canPin: boolean;
  onReply: () => void;
  onJump: (postId: string) => void;
  onOpenPhoto: (start: number) => void;
  onChange: (change: (card: PostCard) => PostCard | null) => void;
  onNotice: (text: string) => void;
}) {
  const { voice } = useVoice();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const { post, listing, author, social } = card;
  const fromShop = !isForum && (post.voice ?? 'store') === 'store';
  const announced = !isForum && isAnnouncement(post) && fromShop;
  const photos = photosOf(card);

  async function react(kind: ReactionKind) {
    const before = social.reactions;
    onChange((current) => ({ ...current, social: { ...current.social, reactions: withReaction(before, kind) } }));
    setPicking(false);
    setOpen(false);
    try {
      const { reactions } = await api.react(post.channelId, post.id, kind, voice.storeId);
      onChange((current) => ({ ...current, social: { ...current.social, reactions } }));
    } catch (err) {
      onChange((current) => ({ ...current, social: { ...current.social, reactions: before } }));
      onNotice(err instanceof ApiRequestError ? err.message : 'Could not react.');
    }
  }

  async function pin() {
    try {
      const { pinned } = await api.pinPost(post.channelId, post.id);
      onChange((current) => ({ ...current, post: { ...current.post, pinned } }));
      onNotice(pinned ? 'Pinned to the top' : 'Unpinned');
    } catch (err) {
      onNotice(err instanceof ApiRequestError ? err.message : 'Could not pin that.');
    }
    setOpen(false);
  }

  async function remove() {
    setOpen(false);
    if (!window.confirm('Delete this message?')) return;
    try {
      await api.deletePost(post.channelId, post.id);
      onChange(() => null);
    } catch (err) {
      onNotice(err instanceof ApiRequestError ? err.message : 'Could not delete that.');
    }
  }

  const side = mine ? 'mine' : fromShop ? 'shop' : 'visitor';

  return (
    <div id={`msg-${post.id}`}
      className={`cmsg cmsg--${side}${startsRun ? ' is-first' : ''}${announced ? ' cmsg--announce' : ''}${open ? ' is-open' : ''}`}>
      {!mine && (
        <span className="cmsg__avatar">{startsRun ? <Avatar name={post.authorName} size={32} /> : null}</span>
      )}
      <div className="cmsg__col">
        {startsRun && !mine && (
          <span className="cmsg__who">
            <PersonLink party={author}>{post.authorName}</PersonLink>
            {fromShop && <span className="cmsg__role">Shop</span>}
          </span>
        )}
        <div className="cmsg__bubble" role="button" tabIndex={0} aria-expanded={open}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a, button')) return;
            setOpen(!open);
            setPicking(false);
          }}
          onDoubleClick={() => void react('love')}
          onKeyDown={(event) => event.key === 'Enter' && setOpen(!open)}>
          {announced && (
            <span className="cmsg__announce"><Icon name="megaphone" size={12} /> Announcement</span>
          )}
          {post.pinned && <span className="cmsg__pinned"><Icon name="star" size={11} /> Pinned</span>}
          {post.replyTo && (
            <button type="button" className="cmsg__quote" onClick={() => onJump(post.replyTo!.postId)}>
              <strong>{post.replyTo.authorName}</strong>
              <span>{post.replyTo.body}</span>
            </button>
          )}
          {photos.length > 0 && (
            <div className={`cmsg__photos cmsg__photos--${Math.min(photos.length, 4)}`}>
              {photos.slice(0, 4).map((url, at) => (
                <button key={`${url}-${at}`} type="button" className="cmsg__photo" onClick={() => onOpenPhoto(at)}>
                  <img src={url} alt="" loading="lazy" />
                  {at === 3 && photos.length > 4 && <span className="cmsg__more">+{photos.length - 4}</span>}
                </button>
              ))}
            </div>
          )}
          {post.body && <p className="cmsg__body">{post.body}</p>}
          {listing && (
            <Link to={`/listing/${listing.id}`} className="cmsg__item">
              {listing.photoUrl
                ? <img src={listing.photoUrl} alt="" className="cmsg__itemimg" />
                : <Thumb seed={listing.id} label={listing.title} className="cmsg__itemimg" />}
              <span className="cmsg__itembody">
                <span className="cmsg__itemname">{listing.title}</span>
                <span className="cmsg__itemprice">{formatMoney(listing.priceMinor, listing.currency)}</span>
              </span>
              <Icon name="right" size={14} />
            </Link>
          )}
          <span className="cmsg__time">{timeAgo(post.createdAt)}</span>
        </div>

        {social.reactions.total > 0 && (
          <div className="cmsg__reactions">
            {social.reactions.counts.map((entry) => (
              <button key={entry.kind} type="button"
                className={`cmsg__chip${social.reactions.mine === entry.kind ? ' is-mine' : ''}`}
                aria-label={`${REACTION_META[entry.kind].label}, ${entry.count}`}
                onClick={() => void react(entry.kind)}>
                {REACTION_META[entry.kind].emoji} {entry.count}
              </button>
            ))}
          </div>
        )}

        {open && (
          <div className="cmsg__actions">
            {picking ? (
              <span className="cmsg__picker">
                {REACTIONS.map((kind, index) => (
                  <button key={kind} type="button" aria-label={REACTION_META[kind].label}
                    style={{ animationDelay: `${index * 25}ms` }} onClick={() => void react(kind)}>
                    {REACTION_META[kind].emoji}
                  </button>
                ))}
              </span>
            ) : (
              <>
                <button type="button" onClick={() => setPicking(true)}><Icon name="smile" size={14} /> React</button>
                <button type="button" onClick={() => { onReply(); setOpen(false); }}><Icon name="back" size={14} /> Reply</button>
                <button type="button" onClick={async () => {
                  setOpen(false);
                  onNotice((await copyLink(post)) ? 'Link copied' : 'Link ready');
                }}><Icon name="link" size={14} /> Link</button>
                {canPin && (
                  <button type="button" onClick={() => void pin()}>
                    <Icon name="star" size={14} /> {post.pinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
                {social.mine && (
                  <button type="button" className="is-danger" onClick={() => void remove()}>
                    <Icon name="trash" size={14} /> Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Writing in the room ───────────────────────────────────────────────── */

interface Draft {
  key: string;
  preview: string;
  url: string | null;
  failed: boolean;
}

function RoomComposer({ data, replyTo, onClearReply, onPosted }: {
  data: ChannelThread;
  replyTo: PostCard | null;
  onClearReply: () => void;
  onPosted: () => void | Promise<void>;
}) {
  const { voice } = useVoice();
  const { channel, shareable } = data;
  const isForum = channel.kind === 'forum';
  // Whoever may speak for this room's shop speaks as it here, whichever voice
  // is picked - the server decides that by rights - and only the shop can
  // announce or put its items in front of its followers.
  const asThisShop = !isForum && channel.mine;
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Draft[]>([]);
  const [itemId, setItemId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const files = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  const item = shareable.find((entry) => entry.id === itemId) ?? null;
  const uploading = photos.some((photo) => !photo.url && !photo.failed);
  const ready = !busy && !uploading && (text.trim().length > 0 || photos.some((photo) => photo.url) || Boolean(item));

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const chosen = [...list].filter((file) => file.type.startsWith('image/')).slice(0, 10 - photos.length);
    const drafts = chosen.map((file) => ({
      key: `${file.name}-${Math.random().toString(36).slice(2, 7)}`,
      preview: URL.createObjectURL(file),
      url: null,
      failed: false,
    }));
    setPhotos((all) => [...all, ...drafts]);
    await Promise.all(chosen.map(async (file, index) => {
      const key = drafts[index]!.key;
      try {
        const stored = await api.uploadPhoto(await shrink(file));
        setPhotos((all) => all.map((photo) => (photo.key === key ? { ...photo, url: stored.url } : photo)));
      } catch (err) {
        setPhotos((all) => all.map((photo) => (photo.key === key ? { ...photo, failed: true } : photo)));
        setError(err instanceof ApiRequestError ? err.message : 'A photo would not upload.');
      }
    }));
  }

  async function send() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPost({
        body: text.trim() || (item ? item.title : ''),
        ...(isForum ? { forumId: channel.id } : { channelId: channel.id }),
        ...(voice.storeId && voice.storeId !== channel.id ? { storeId: voice.storeId } : {}),
        ...(item && asThisShop ? { listingId: item.id } : {}),
        ...(announce && asThisShop ? { announcement: true } : {}),
        photoUrls: photos.map((photo) => photo.url).filter((url): url is string => Boolean(url)),
        ...(replyTo ? { replyToId: replyTo.post.id } : {}),
      });
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setText('');
      setPhotos([]);
      setItemId(null);
      setAnnounce(false);
      if (input.current) input.current.style.height = 'auto';
      await onPosted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cbar">
      {error && <p className="notice notice--error" onClick={() => setError(null)}>{error}</p>}

      {replyTo && (
        <div className="cbar__reply">
          <span className="cbar__replybody">
            <strong>Replying to {replyTo.post.authorName}</strong>
            <span>{replyTo.post.body || 'Photo'}</span>
          </span>
          <button type="button" className="iconbtn" aria-label="Cancel reply" onClick={onClearReply}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {photos.length > 0 && (
        <div className="writer__photos">
          {photos.map((photo, index) => (
            <div key={photo.key} className={`writer__photo${photo.failed ? ' is-failed' : ''}`}>
              <img src={photo.preview} alt={`Attached photo ${index + 1}`} />
              {!photo.url && !photo.failed && <span className="writer__spin" aria-label="Uploading" />}
              <button type="button" className="writer__unphoto" aria-label="Remove photo"
                onClick={() => setPhotos((all) => all.filter((entry) => entry.key !== photo.key))}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {item && (
        <div className="writer__item">
          {item.photoUrl
            ? <img src={item.photoUrl} alt="" className="writer__itemimg" />
            : <Thumb seed={item.id} label={item.title} className="writer__itemimg" />}
          <span className="writer__itembody">
            <span className="spost__itemtag">For sale</span>
            <strong>{item.title}</strong>
            <span className="spost__price">{formatMoney(item.priceMinor, item.currency)}</span>
          </span>
          <button type="button" className="iconbtn" aria-label="Remove item" onClick={() => setItemId(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {picking && (
        <div className="stockpick">
          {shareable.length === 0 ? <p className="faint">Nothing listed to share yet.</p> : shareable.map((entry) => (
            <button key={entry.id} type="button" className="stockpick__item"
              onClick={() => { setItemId(entry.id); setPicking(false); }}>
              {entry.photoUrl
                ? <img src={entry.photoUrl} alt="" className="stockpick__img" />
                : <Thumb seed={entry.id} label={entry.title} className="stockpick__img" />}
              <span className="stockpick__name">{entry.title}</span>
              <span className="stockpick__price">{formatMoney(entry.priceMinor, entry.currency)}</span>
            </button>
          ))}
        </div>
      )}

      {asThisShop && (
        <div className="cbar__tools">
          <button type="button" className={`cbar__toggle${announce ? ' is-on' : ''}`} aria-pressed={announce}
            onClick={() => setAnnounce(!announce)}>
            <Icon name="megaphone" size={14} /> {announce ? 'Announcement' : 'Announce'}
          </button>
          <button type="button" className={`cbar__toggle${picking || item ? ' is-on' : ''}`}
            onClick={() => setPicking(!picking)}>
            <Icon name="tag" size={14} /> Item
          </button>
        </div>
      )}

      <div className="cbar__row">
        <VoicePicker size={36} />
        <button type="button" className="cbar__attach" aria-label="Add photos" onClick={() => files.current?.click()}>
          <Icon name="image" size={18} />
        </button>
        <textarea ref={input} className="cbar__input" rows={1} value={text} maxLength={2000}
          placeholder={replyTo ? 'Write a reply…' : asThisShop ? 'Message your followers…' : `Message as ${voice.name}…`}
          onChange={(event) => {
            setText(event.target.value);
            event.target.style.height = 'auto';
            event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
            if (event.key === 'Escape') onClearReply();
          }} />
        <button type="button" className="cbar__send" disabled={!ready} aria-label="Send" onClick={() => void send()}>
          {busy || uploading ? <span className="writer__spin cbar__spin" /> : <Icon name="send" size={18} />}
        </button>
      </div>
      <input ref={files} type="file" accept="image/*" multiple hidden
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = '';
        }} />
    </div>
  );
}
