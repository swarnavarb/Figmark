import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ApiRequestError, api, type PostCard } from '../api';
import {
  REACTIONS, REACTION_META,
  type CommentThread, type CommentView, type PollView, type ReactionKind, type ReactionSummary, type ReactorRow,
} from '@shared/social';
import { isAnnouncement } from '@shared/posts';
import { formatMoney, timeAgo } from '../format';
import { Avatar, Modal, PersonLink } from './ui';
import { Icon } from './Icon';

/**
 * One post, and everything people do with it.
 *
 * The feed, a shared link and a notification all land on this, so a reaction
 * given on one is the same reaction everywhere and nothing has two looks.
 */

/** A post counts as hot when this many people have reacted within a day of it going up. */
const HOT_REACTIONS = 15;
const HOT_WINDOW_MS = 24 * 3_600_000;

/** Where a post can be read on its own, for links and the share sheet. */
export function postHref(post: { channelId: string; id: string }): string {
  return `/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`;
}

/** The count, shortened once it stops fitting: 1.2k rather than 1,204. */
function compact(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
}

/**
 * The summary after this viewer reacts, before the server says so.
 *
 * Mirrors the server's rule - the reaction you already have takes it back - so
 * the count moves the instant it is tapped and does not jump when the answer
 * lands.
 */
function withReaction(summary: ReactionSummary, kind: ReactionKind | null): ReactionSummary {
  const next = kind === summary.mine ? null : kind;
  const tally = new Map(summary.counts.map((entry) => [entry.kind, entry.count]));
  if (summary.mine) tally.set(summary.mine, (tally.get(summary.mine) ?? 1) - 1);
  if (next) tally.set(next, (tally.get(next) ?? 0) + 1);
  const counts = [...tally.entries()]
    .filter(([, count]) => count > 0)
    .map(([k, count]) => ({ kind: k, count }))
    .sort((a, b) => b.count - a.count || REACTIONS.indexOf(a.kind) - REACTIONS.indexOf(b.kind));
  return {
    ...summary,
    counts,
    mine: next,
    total: summary.total - (summary.mine ? 1 : 0) + (next ? 1 : 0),
  };
}

function reduceMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/* ── The post ──────────────────────────────────────────────────────────── */

export function SocialPostCard({ card: initial, openComments = false, onRemoved, onReposted, nested = false }: {
  card: PostCard;
  /** Open with the conversation showing, as a post read on its own page does. */
  openComments?: boolean;
  onRemoved?: (id: string) => void;
  onReposted?: (card: PostCard) => void;
  /** Rendered inside a repost: the post itself, without its own buttons. */
  nested?: boolean;
}) {
  const [card, setCard] = useState(initial);
  const [showComments, setShowComments] = useState(openComments);
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [burst, setBurst] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setCard(initial), [initial]);

  const { post, listing, author, social } = card;
  const photos = post.photoUrls?.length ? post.photoUrls : post.photoUrl ? [post.photoUrl] : [];
  const hot = social.reactions.total >= HOT_REACTIONS
    && Date.now() - new Date(post.createdAt).getTime() < HOT_WINDOW_MS;

  const react = useCallback(async (kind: ReactionKind | null) => {
    const before = card.social.reactions;
    const optimistic = withReaction(before, kind);
    setCard((current) => ({ ...current, social: { ...current.social, reactions: optimistic } }));
    try {
      const { reactions } = await api.react(post.channelId, post.id, kind ?? before.mine);
      setCard((current) => ({ ...current, social: { ...current.social, reactions } }));
    } catch (err) {
      setCard((current) => ({ ...current, social: { ...current.social, reactions: before } }));
      setError(err instanceof ApiRequestError ? err.message : 'Could not react to that.');
    }
  }, [card.social.reactions, post.channelId, post.id]);

  // Double-tap a photo to love it, which never takes a love back: the gesture
  // means "more of this", and a second double-tap undoing the first would be a
  // trap.
  const loveFromPhoto = useCallback(() => {
    setBurst((count) => count + 1);
    if (card.social.reactions.mine !== 'love') void react('love');
  }, [card.social.reactions.mine, react]);

  async function remove() {
    setMenu(false);
    if (!window.confirm('Delete this post? Its reactions and comments go with it.')) return;
    try {
      await api.deletePost(post.channelId, post.id);
      onRemoved?.(post.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete that.');
    }
  }

  const kindLine = (
    <>
      {post.kind === 'sale' && <span className="spost__kind spost__kind--sale"><Icon name="tag" size={11} /> For sale</span>}
      {post.kind === 'thread' && <span className="spost__kind"><Icon name="forum" size={11} /> Forum</span>}
      {social.poll && <span className="spost__kind spost__kind--poll"><Icon name="poll" size={11} /> Poll</span>}
      {hot && <span className="spost__kind spost__kind--hot">🔥 Hot</span>}
      {post.channel === 'seller' && post.reach === 'channel' && isAnnouncement(post) && (
        <span className="spost__kind"><Icon name="megaphone" size={11} /> Announcement</span>
      )}
    </>
  );

  return (
    <article className={`spost${nested ? ' spost--nested' : ''}`}>
      <header className="spost__head">
        <Avatar name={post.authorName} size={nested ? 32 : 42} />
        <div className="spost__who">
          <PersonLink party={author} className="spost__name">{post.authorName}</PersonLink>
          <span className="spost__meta">
            <Link to={postHref(post)} className="spost__time">{timeAgo(post.createdAt)}</Link>
            {post.channel === 'seller' && !nested && (
              <>
                <span aria-hidden="true">·</span>
                <Link to={`/social/c/${post.channelId}`} className="spost__time">channel</Link>
              </>
            )}
            {kindLine}
          </span>
        </div>
        {!nested && (
          <div className="spost__menuwrap">
            <button type="button" className="iconbtn" aria-label="More" aria-expanded={menu}
              onClick={() => setMenu(!menu)}>
              <Icon name="more" size={18} />
            </button>
            {menu && (
              <div className="spost__menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); void copyLink(post); }}>
                  <Icon name="link" size={15} /> Copy link
                </button>
                <Link role="menuitem" to={postHref(post)} onClick={() => setMenu(false)}>
                  <Icon name="external" size={15} /> Open post
                </Link>
                {social.mine && (
                  <button type="button" role="menuitem" className="is-danger" onClick={() => void remove()}>
                    <Icon name="trash" size={15} /> Delete post
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {post.vibe ? (
        <div className={`vibe vibe--${post.vibe}`}><p>{post.body}</p></div>
      ) : (
        post.body && <Body text={post.body} long={!nested && photos.length === 0} />
      )}

      {photos.length > 0 && (
        <Carousel photos={photos} alt={post.body || `Photo by ${post.authorName}`} burst={burst}
          onOpen={(index) => setLightbox(index)} onDoubleTap={nested ? undefined : loveFromPhoto} />
      )}

      {social.poll && (
        <Poll poll={social.poll} disabled={nested}
          onVote={async (optionId) => {
            const { poll } = await api.votePoll(post.channelId, post.id, optionId);
            setCard((current) => ({ ...current, social: { ...current.social, poll } }));
          }} />
      )}

      {listing && (
        <Link to={`/listing/${listing.id}`} className="spost__item">
          <span className="spost__itemglyph"><Icon name="tag" size={18} /></span>
          <span className="spost__itembody">
            <span className="spost__itemname">{listing.title}</span>
            <span className="faint">{listing.condition} · tap to open</span>
          </span>
          <span className="spost__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
        </Link>
      )}

      {post.repostOf && (
        card.original
          ? <div className="spost__quoted"><SocialPostCard card={card.original} nested /></div>
          : <p className="spost__gone">The original post has been taken down.</p>
      )}

      {!nested && (
        <>
          <Tally card={card} onComments={() => setShowComments(true)} />

          <div className="spost__actions">
            <ReactButton mine={social.reactions.mine} onReact={(kind) => void react(kind)} />
            <button type="button" className={`spost__action${showComments ? ' is-on' : ''}`}
              onClick={() => setShowComments(!showComments)} aria-expanded={showComments}>
              <Icon name="message" size={18} /> <span>Comment</span>
            </button>
            <button type="button" className="spost__action" onClick={() => setSharing(true)}>
              <Icon name="share" size={18} /> <span>Share</span>
            </button>
          </div>

          {error && <p className="spost__error" role="alert" onClick={() => setError(null)}>{error}</p>}

          {!showComments && social.preview.length > 0 && (
            <button type="button" className="spost__preview" onClick={() => setShowComments(true)}>
              {social.preview.map((comment) => (
                <span key={comment.id} className="spost__previewline">
                  <strong>{comment.authorName}</strong> {comment.body}
                </span>
              ))}
              {social.commentCount > social.preview.length && (
                <span className="faint">View all {social.commentCount} comments</span>
              )}
            </button>
          )}

          {showComments && (
            <Comments card={card}
              onCount={(commentCount, preview) =>
                setCard((current) => ({ ...current, social: { ...current.social, commentCount, preview } }))} />
          )}
        </>
      )}

      {sharing && (
        <ShareSheet card={card} onClose={() => setSharing(false)}
          onShared={(shareCount, repost) => {
            setCard((current) => ({ ...current, social: { ...current.social, shareCount } }));
            if (repost) onReposted?.(repost);
          }} />
      )}

      {lightbox !== null && (
        <Lightbox photos={photos} start={lightbox} onClose={() => setLightbox(null)} />
      )}
    </article>
  );
}

/** Long text folds after a few lines, so one essay does not push the feed off the screen. */
function Body({ text, long }: { text: string; long: boolean }) {
  const [open, setOpen] = useState(false);
  const folds = text.length > 280 || text.split('\n').length > 6;
  // A short line with nothing else to look at reads better a size up.
  const big = long && text.length < 90 && !text.includes('\n');
  return (
    <div className={`spost__body${big ? ' spost__body--big' : ''}${folds && !open ? ' is-folded' : ''}`}>
      <p>{text}</p>
      {folds && !open && (
        <button type="button" className="spost__more" onClick={() => setOpen(true)}>See more</button>
      )}
    </div>
  );
}

async function copyLink(post: { channelId: string; id: string }): Promise<boolean> {
  const url = `${window.location.origin}${postHref(post)}`;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    window.prompt('Copy this link', url);
    return false;
  }
}

/* ── Photos ────────────────────────────────────────────────────────────── */

/**
 * The photos on a post, one at a time.
 *
 * Native scroll snapping does the swiping, so it has the phone's own momentum
 * and nothing here has to reimplement a gesture. Arrows appear for a pointer,
 * dots and a counter for everyone.
 */
function Carousel({ photos, alt, burst, onOpen, onDoubleTap }: {
  photos: string[];
  alt: string;
  burst: number;
  onOpen: (index: number) => void;
  onDoubleTap?: () => void;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const lastTap = useRef(0);
  const single = useRef<number | null>(null);

  const go = (to: number) => {
    const node = track.current;
    if (!node) return;
    const next = Math.max(0, Math.min(photos.length - 1, to));
    node.scrollTo({ left: next * node.clientWidth, behavior: reduceMotion() ? 'auto' : 'smooth' });
  };

  // One tap opens the photo, two love the post. The single tap waits out the
  // double-tap window so the second tap is not also an open.
  const tap = (at: number) => {
    const now = Date.now();
    if (onDoubleTap && now - lastTap.current < 280) {
      if (single.current) window.clearTimeout(single.current);
      single.current = null;
      lastTap.current = 0;
      onDoubleTap();
      return;
    }
    lastTap.current = now;
    single.current = window.setTimeout(() => {
      single.current = null;
      onOpen(at);
    }, onDoubleTap ? 280 : 0);
  };

  useEffect(() => () => {
    if (single.current) window.clearTimeout(single.current);
  }, []);

  return (
    <div className={`carousel${photos.length === 1 ? ' carousel--single' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(index + 1);
        if (event.key === 'ArrowLeft') go(index - 1);
      }}>
      <div className="carousel__track" ref={track} tabIndex={0}
        aria-roledescription="carousel" aria-label={`${photos.length} photo${photos.length === 1 ? '' : 's'}`}
        onScroll={(event) => {
          const node = event.currentTarget;
          setIndex(Math.round(node.scrollLeft / Math.max(1, node.clientWidth)));
        }}>
        {photos.map((url, at) => (
          <button key={`${url}-${at}`} type="button" className="carousel__slide"
            aria-label={`Photo ${at + 1} of ${photos.length}`} onClick={() => tap(at)}>
            <img src={url} alt={at === 0 ? alt : ''} loading="lazy" draggable={false} />
          </button>
        ))}
      </div>

      {burst > 0 && <span key={burst} className="carousel__heart" aria-hidden="true">❤️</span>}

      {photos.length > 1 && (
        <>
          <span className="carousel__count">{index + 1}/{photos.length}</span>
          {index > 0 && (
            <button type="button" className="carousel__arrow carousel__arrow--prev" aria-label="Previous photo"
              onClick={() => go(index - 1)}>
              <Icon name="left" size={18} />
            </button>
          )}
          {index < photos.length - 1 && (
            <button type="button" className="carousel__arrow carousel__arrow--next" aria-label="Next photo"
              onClick={() => go(index + 1)}>
              <Icon name="right" size={18} />
            </button>
          )}
          <div className="carousel__dots" aria-hidden="true">
            {photos.map((url, at) => (
              <span key={`${url}-dot-${at}`} className={`carousel__dot${at === index ? ' is-on' : ''}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A photo filling the screen, with the rest a swipe or an arrow key away. */
function Lightbox({ photos, start, onClose }: { photos: string[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') setIndex((at) => Math.min(photos.length - 1, at + 1));
      if (event.key === 'ArrowLeft') setIndex((at) => Math.max(0, at - 1));
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, photos.length]);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onTouchStart={(event) => { touch.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        const from = touch.current;
        const to = event.changedTouches[0]?.clientX;
        touch.current = null;
        if (from === null || to === undefined || Math.abs(to - from) < 40) return;
        setIndex((at) => Math.max(0, Math.min(photos.length - 1, at + (to < from ? 1 : -1))));
      }}>
      <button type="button" className="lightbox__close" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
      <img key={index} className="lightbox__img" src={photos[index]} alt={`Photo ${index + 1} of ${photos.length}`} />
      {photos.length > 1 && (
        <>
          <span className="lightbox__count">{index + 1} / {photos.length}</span>
          {index > 0 && (
            <button type="button" className="lightbox__nav lightbox__nav--prev" aria-label="Previous photo"
              onClick={() => setIndex(index - 1)}>
              <Icon name="left" size={22} />
            </button>
          )}
          {index < photos.length - 1 && (
            <button type="button" className="lightbox__nav lightbox__nav--next" aria-label="Next photo"
              onClick={() => setIndex(index + 1)}>
              <Icon name="right" size={22} />
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

/* ── Reactions ─────────────────────────────────────────────────────────── */

/**
 * The react button: a tap loves, a hold (or a hover) offers the rest.
 *
 * The one-tap path stays the fast one because most reactions are a heart. The
 * picker is there for everything else, and the arrow key opens it for anyone
 * not holding a mouse or a phone.
 */
function ReactButton({ mine, onReact }: { mine: ReactionKind | null; onReact: (kind: ReactionKind | null) => void }) {
  const [picking, setPicking] = useState(false);
  const [pop, setPop] = useState(0);
  const hold = useRef<number | null>(null);
  const held = useRef(false);
  const hoverOpen = useRef<number | null>(null);
  const hoverClose = useRef<number | null>(null);

  const clear = (timer: { current: number | null }) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => () => {
    clear(hold);
    clear(hoverOpen);
    clear(hoverClose);
  }, []);

  const choose = (kind: ReactionKind) => {
    setPicking(false);
    setPop((count) => count + 1);
    onReact(kind);
  };

  return (
    <div className="react"
      onMouseEnter={() => {
        clear(hoverClose);
        hoverOpen.current = window.setTimeout(() => setPicking(true), 450);
      }}
      onMouseLeave={() => {
        clear(hoverOpen);
        hoverClose.current = window.setTimeout(() => setPicking(false), 300);
      }}>
      {picking && (
        <div className="react__picker" role="menu" aria-label="Pick a reaction">
          {REACTIONS.map((kind, index) => (
            <button key={kind} type="button" role="menuitem"
              className={`react__option${mine === kind ? ' is-on' : ''}`}
              style={{ animationDelay: `${index * 28}ms` }}
              aria-label={REACTION_META[kind].label}
              title={REACTION_META[kind].label}
              onClick={() => choose(kind)}>
              <span>{REACTION_META[kind].emoji}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button"
        className={`spost__action react__button${mine ? ` is-on react__button--${mine}` : ''}`}
        aria-haspopup="menu" aria-expanded={picking}
        aria-label={mine ? `You reacted ${REACTION_META[mine].label}. Tap to take it back` : 'React'}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          if (event.pointerType === 'mouse') return;
          held.current = false;
          hold.current = window.setTimeout(() => {
            held.current = true;
            setPicking(true);
            navigator.vibrate?.(12);
          }, 380);
        }}
        onPointerUp={() => clear(hold)}
        onPointerLeave={() => clear(hold)}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setPicking(true);
          }
          if (event.key === 'Escape') setPicking(false);
        }}
        onClick={() => {
          // The hold already opened the picker; letting go is not also a tap.
          if (held.current) {
            held.current = false;
            return;
          }
          clear(hoverOpen);
          setPicking(false);
          setPop((count) => count + 1);
          onReact(mine ? null : 'love');
        }}>
        <span key={pop} className={`react__glyph${pop > 0 ? ' is-popping' : ''}`}>
          {mine ? REACTION_META[mine].emoji : <Icon name="heart" size={18} />}
        </span>
        <span>{mine ? REACTION_META[mine].label : 'React'}</span>
      </button>
    </div>
  );
}

/** The line above the buttons: who reacted, how much talk, how many shares. */
function Tally({ card, onComments }: { card: PostCard; onComments: () => void }) {
  const [who, setWho] = useState(false);
  const { reactions, commentCount, shareCount } = card.social;
  if (reactions.total === 0 && commentCount === 0 && shareCount === 0) {
    return <p className="spost__nudge">Be the first to react ✨</p>;
  }

  // "You, Meera and 23 others", in whatever combination is true.
  const others = reactions.total - (reactions.mine ? 1 : 0);
  const named = reactions.names.slice(0, reactions.mine ? 1 : 2);
  const rest = Math.max(0, others - named.length);
  const parts = [...(reactions.mine ? ['You'] : []), ...named];
  const label = rest > 0
    ? `${parts.join(', ')}${parts.length ? ' and ' : ''}${compact(rest)}${parts.length ? ' others' : ''}`
    : parts.join(' and ');

  return (
    <div className="spost__tally">
      {reactions.total > 0 ? (
        <button type="button" className="spost__reacted" onClick={() => setWho(true)}
          aria-label={`${reactions.total} reactions. See who reacted`}>
          <span className="spost__stack">
            {reactions.counts.slice(0, 3).map((entry) => (
              <span key={entry.kind} className="spost__stackitem">{REACTION_META[entry.kind].emoji}</span>
            ))}
          </span>
          <span className="spost__reactedlabel">{label || compact(reactions.total)}</span>
        </button>
      ) : <span />}
      <span className="spost__counts">
        {commentCount > 0 && (
          <button type="button" className="spost__countlink" onClick={onComments}>
            {compact(commentCount)} comment{commentCount === 1 ? '' : 's'}
          </button>
        )}
        {shareCount > 0 && <span>{compact(shareCount)} share{shareCount === 1 ? '' : 's'}</span>}
      </span>
      {who && <Reactors card={card} onClose={() => setWho(false)} />}
    </div>
  );
}

/** Everyone who reacted, filterable by reaction. */
function Reactors({ card, onClose }: { card: PostCard; onClose: () => void }) {
  const [rows, setRows] = useState<ReactorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<ReactionKind | 'all'>('all');

  useEffect(() => {
    let live = true;
    api.reactors(card.post.channelId, card.post.id)
      .then((result) => live && setRows(result.reactors))
      .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not load who reacted.'));
    return () => {
      live = false;
    };
  }, [card.post.channelId, card.post.id]);

  const kinds = REACTIONS.filter((kind) => rows?.some((row) => row.kind === kind));
  const shown = (rows ?? []).filter((row) => only === 'all' || row.kind === only);

  return (
    <Modal title="Reactions" onClose={onClose}>
      <div className="reactors__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={only === 'all'}
          className={`reactors__tab${only === 'all' ? ' is-on' : ''}`} onClick={() => setOnly('all')}>
          All <span>{rows?.length ?? card.social.reactions.total}</span>
        </button>
        {kinds.map((kind) => (
          <button key={kind} type="button" role="tab" aria-selected={only === kind}
            className={`reactors__tab${only === kind ? ' is-on' : ''}`} onClick={() => setOnly(kind)}>
            {REACTION_META[kind].emoji} <span>{rows?.filter((row) => row.kind === kind).length}</span>
          </button>
        ))}
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      {!rows && !error && <p className="muted">Loading…</p>}
      <ul className="reactors__list">
        {shown.map((row, index) => (
          <li key={`${row.party.handle ?? row.party.name}-${index}`} className="reactors__row">
            <span className="reactors__avatar">
              <Avatar name={row.party.name} size={38} />
              <span className="reactors__badge">{REACTION_META[row.kind].emoji}</span>
            </span>
            <span className="reactors__name">
              <PersonLink party={row.party} />
              <span className="faint">{timeAgo(row.at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ── Comments ──────────────────────────────────────────────────────────── */

function Comments({ card, onCount }: {
  card: PostCard;
  onCount: (count: number, preview: CommentView[]) => void;
}) {
  const [threads, setThreads] = useState<CommentThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const { channelId, id } = card.post;

  useEffect(() => {
    let live = true;
    api.socialPost(channelId, id)
      .then((detail) => live && setThreads(detail.comments))
      .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not load the comments.'));
    return () => {
      live = false;
    };
  }, [channelId, id]);

  const apply = (detail: { card: PostCard; comments: CommentThread[] }) => {
    setThreads(detail.comments);
    onCount(detail.card.social.commentCount, detail.card.social.preview);
  };

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await api.commentOnPost(channelId, id, body, replyTo?.id ?? null);
      apply(detail);
      setFresh(detail.comment);
      setText('');
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that comment.');
    } finally {
      setBusy(false);
    }
  }

  const startReply = (comment: CommentView) => {
    setReplyTo(comment);
    window.setTimeout(() => input.current?.focus(), 0);
  };

  return (
    <section className="cmts" aria-label="Comments">
      {error && <p className="notice notice--error">{error}</p>}
      {!threads && !error && <p className="faint">Loading comments…</p>}
      {threads && threads.length === 0 && (
        <p className="cmts__empty">No comments yet. Start the conversation 💬</p>
      )}
      {threads?.map((thread) => (
        <Thread key={thread.id} thread={thread} fresh={fresh} card={card}
          onReply={startReply} onChanged={apply} />
      ))}

      <div className="cmts__write">
        {replyTo && (
          <div className="cmts__replying">
            <span>Replying to <strong>{replyTo.authorName}</strong></span>
            <button type="button" className="iconbtn iconbtn--sm" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <div className="cmts__row">
          <textarea ref={input} className="cmts__input" rows={1} value={text} maxLength={1000}
            placeholder={replyTo ? `Reply to ${replyTo.authorName.split(' ')[0]}…` : 'Write a comment…'}
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
              if (event.key === 'Escape') setReplyTo(null);
            }} />
          <button type="button" className="cmts__send" aria-label="Send comment"
            disabled={busy || !text.trim()} onClick={() => void send()}>
            <Icon name="send" size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}

/** A comment and its replies, folded once there are more than a couple. */
function Thread({ thread, fresh, card, onReply, onChanged }: {
  thread: CommentThread;
  fresh: string | null;
  card: PostCard;
  onReply: (comment: CommentView) => void;
  onChanged: (detail: { card: PostCard; comments: CommentThread[] }) => void;
}) {
  const [open, setOpen] = useState(thread.replies.length <= 2);
  useEffect(() => {
    if (fresh && thread.replies.some((reply) => reply.id === fresh)) setOpen(true);
  }, [fresh, thread.replies]);

  return (
    <div className="cmts__thread">
      <Comment comment={thread} fresh={fresh === thread.id} card={card} onReply={onReply} onChanged={onChanged} />
      {thread.replies.length > 0 && (
        <div className="cmts__replies">
          {open ? (
            thread.replies.map((reply) => (
              <Comment key={reply.id} comment={reply} fresh={fresh === reply.id} card={card}
                onReply={onReply} onChanged={onChanged} small />
            ))
          ) : (
            <button type="button" className="cmts__more" onClick={() => setOpen(true)}>
              <span className="cmts__line" aria-hidden="true" />
              View {thread.replies.length} replies
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Comment({ comment, fresh, card, onReply, onChanged, small = false }: {
  comment: CommentView;
  fresh: boolean;
  card: PostCard;
  onReply: (comment: CommentView) => void;
  onChanged: (detail: { card: PostCard; comments: CommentThread[] }) => void;
  small?: boolean;
}) {
  const [liked, setLiked] = useState(comment.likedByMe);
  const [likes, setLikes] = useState(comment.likeCount);
  const { channelId, id } = card.post;

  useEffect(() => {
    setLiked(comment.likedByMe);
    setLikes(comment.likeCount);
  }, [comment.likedByMe, comment.likeCount]);

  async function like() {
    setLiked(!liked);
    setLikes(likes + (liked ? -1 : 1));
    try {
      const result = await api.likePostComment(channelId, id, comment.id);
      setLiked(result.liked);
      setLikes(result.likeCount);
    } catch {
      setLiked(liked);
      setLikes(likes);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this comment?')) return;
    try {
      onChanged(await api.deletePostComment(channelId, id, comment.id));
    } catch {
      /* It stays; the list is still the truth. */
    }
  }

  return (
    <div className={`cmt${small ? ' cmt--small' : ''}${fresh ? ' is-fresh' : ''}`}>
      <Avatar name={comment.authorName} size={small ? 26 : 32} />
      <div className="cmt__main">
        <div className="cmt__bubble">
          <PersonLink party={comment.author} className="cmt__name">{comment.authorName}</PersonLink>
          <p className="cmt__body">
            {comment.replyToName && <span className="cmt__to">@{comment.replyToName} </span>}
            {comment.body}
          </p>
        </div>
        <div className="cmt__meta">
          <span>{timeAgo(comment.createdAt)}</span>
          <button type="button" className={liked ? 'is-on' : ''} onClick={() => void like()}>
            {liked ? 'Liked' : 'Like'}
          </button>
          <button type="button" onClick={() => onReply(comment)}>Reply</button>
          {comment.canDelete && <button type="button" onClick={() => void remove()}>Delete</button>}
          {likes > 0 && <span className="cmt__likes">❤️ {likes}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── Polls ─────────────────────────────────────────────────────────────── */

function Poll({ poll, disabled, onVote }: {
  poll: PollView;
  disabled: boolean;
  onVote: (optionId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reveal = poll.myVote !== null || poll.closed || disabled;
  const leader = Math.max(...poll.options.map((option) => option.votes));

  const closes = poll.closesAt
    ? poll.closed
      ? 'Final results'
      : `Closes ${timeAgoAhead(poll.closesAt)}`
    : null;

  return (
    <div className="poll">
      {poll.options.map((option) => {
        const share = poll.total > 0 ? Math.round((option.votes / poll.total) * 100) : 0;
        const mine = poll.myVote === option.id;
        return (
          <button key={option.id} type="button"
            className={`poll__option${reveal ? ' is-revealed' : ''}${mine ? ' is-mine' : ''}`
              + `${reveal && option.votes === leader && leader > 0 ? ' is-leading' : ''}`}
            disabled={disabled || poll.closed || busy !== null}
            onClick={async () => {
              setBusy(option.id);
              setError(null);
              try {
                await onVote(option.id);
              } catch (err) {
                setError(err instanceof ApiRequestError ? err.message : 'Could not count that vote.');
              } finally {
                setBusy(null);
              }
            }}>
            <span className="poll__fill" style={{ width: reveal ? `${share}%` : '0%' }} />
            <span className="poll__label">
              {mine && <Icon name="check" size={14} />}
              {option.label}
            </span>
            {reveal && <span className="poll__share">{share}%</span>}
          </button>
        );
      })}
      <p className="poll__foot">
        {poll.total} vote{poll.total === 1 ? '' : 's'}
        {closes && <> · {closes}</>}
        {poll.myVote && !poll.closed && <> · tap another to change</>}
      </p>
      {error && <p className="spost__error">{error}</p>}
    </div>
  );
}

function timeAgoAhead(iso: string): string {
  const hours = Math.max(0, (new Date(iso).getTime() - Date.now()) / 3_600_000);
  if (hours < 1) return 'in under an hour';
  if (hours < 48) return `in ${Math.round(hours)}h`;
  return `in ${Math.round(hours / 24)} days`;
}

/* ── Sharing ───────────────────────────────────────────────────────────── */

function ShareSheet({ card, onClose, onShared }: {
  card: PostCard;
  onClose: () => void;
  onShared: (shareCount: number, repost: PostCard | null) => void;
}) {
  const [thought, setThought] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Share the original when this is a repost: that is what the link should open.
  const target = card.original?.post ?? card.post;
  const canRepost = (target.reach ?? 'feed') === 'feed';
  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function count(mode: 'repost' | 'link', body?: string) {
    const result = await api.sharePost(target.channelId, target.id, mode, body);
    onShared(result.shareCount, result.repost);
    return result;
  }

  async function repost() {
    setBusy(true);
    setError(null);
    try {
      await count('repost', thought.trim());
      setDone('Shared to your feed 🎉');
      window.setTimeout(onClose, 900);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not share that.');
    } finally {
      setBusy(false);
    }
  }

  async function link(native: boolean) {
    setError(null);
    const url = `${window.location.origin}${postHref(target)}`;
    try {
      if (native) {
        await navigator.share({ title: `${target.authorName} on Figmark`, text: target.body.slice(0, 120), url });
      } else {
        await copyLink(target);
      }
      await count('link').catch(() => undefined);
      setDone(native ? 'Shared ✨' : 'Link copied 📋');
    } catch {
      /* Closing the phone's share sheet is not an error worth showing. */
    }
  }

  return (
    <Modal title="Share post" onClose={onClose}>
      <div className="sharesheet">
        {canRepost && (
          <div className="sharesheet__repost">
            <textarea rows={2} value={thought} maxLength={2000}
              placeholder="Say something about this (optional)…"
              onChange={(event) => setThought(event.target.value)} />
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void repost()}>
              <Icon name="repost" size={16} /> {busy ? 'Sharing…' : 'Share to my feed'}
            </button>
          </div>
        )}
        <div className="sharesheet__row">
          <button type="button" className="sharesheet__tile" onClick={() => void link(false)}>
            <span className="sharesheet__glyph sharesheet__glyph--link"><Icon name="link" size={20} /></span>
            Copy link
          </button>
          {canNative && (
            <button type="button" className="sharesheet__tile" onClick={() => void link(true)}>
              <span className="sharesheet__glyph sharesheet__glyph--out"><Icon name="share" size={20} /></span>
              More apps
            </button>
          )}
          <Link to={`/social?view=messages`} className="sharesheet__tile" onClick={onClose}>
            <span className="sharesheet__glyph sharesheet__glyph--dm"><Icon name="mail" size={20} /></span>
            Message
          </Link>
        </div>
        {done && <p className="sharesheet__done" role="status">{done}</p>}
        {error && <p className="notice notice--error">{error}</p>}
      </div>
    </Modal>
  );
}

/** A small celebration, for things worth one. Respects reduced motion by not happening. */
export function Confetti({ run }: { run: number }): ReactNode {
  if (run === 0 || reduceMotion()) return null;
  const pieces = Array.from({ length: 18 }, (_, index) => index);
  return (
    <span key={run} className="confetti" aria-hidden="true">
      {pieces.map((index) => (
        <span key={index} className={`confetti__bit confetti__bit--${index % 6}`}
          style={{ left: `${(index * 53) % 100}%`, animationDelay: `${(index % 6) * 40}ms` }} />
      ))}
    </span>
  );
}
