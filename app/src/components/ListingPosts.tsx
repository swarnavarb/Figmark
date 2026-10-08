import { useEffect, useRef, useState, type FormEvent } from 'react';
import { REACTIONS, REACTION_META, type ReactionKind } from '@shared/social';
import { ApiRequestError, api, type ListingPost } from '../api';
import { timeAgo } from '../format';
import { useSession } from '../session';
import { ReportButton } from './ReportButton';
import { useLongPress } from './SocialChrome';
import { Avatar, PersonLink } from './ui';
import { Svg } from './ListingBlocks';

/**
 * The public thread under a listing: anyone can post or ask, and anyone can
 * answer. Hold a post (or right-click it) to react or reply, the same gesture
 * the messenger uses. There is deliberately no share: a post only means
 * anything next to the listing it is under.
 */
export function ListingPosts({ listingId, sellerId, posts, onChange }: {
  listingId: string;
  /** Whose listing it is, so their answers can be marked as the seller's. */
  sellerId: string;
  posts: ListingPost[];
  onChange: (posts: ListingPost[]) => void;
}) {
  const { user, promptAuth } = useSession();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ListingPost | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);

  const threads = posts.filter((post) => !post.replyToId);
  const repliesTo = (id: string) => posts.filter((post) => post.replyToId === id);

  function startReply(post: ListingPost) {
    setReplyTo(post);
    field.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await api.comment(listingId, body, replyTo?.id);
      onChange([...posts, result.comment]);
      setDraft('');
      setReplyTo(null);
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'That did not post.');
    } finally {
      setBusy(false);
    }
  }

  async function react(post: ListingPost, kind: ReactionKind) {
    const next = post.myReaction === kind ? null : kind;
    const swap = (patch: Pick<ListingPost, 'reactionCounts' | 'myReaction'>) =>
      onChange(posts.map((entry) => (entry.id === post.id ? { ...entry, ...patch } : entry)));
    // Shown at once, put back if the server says no.
    const counts = { ...post.reactionCounts };
    if (post.myReaction) counts[post.myReaction] = Math.max(0, (counts[post.myReaction] ?? 1) - 1);
    if (next) counts[next] = (counts[next] ?? 0) + 1;
    swap({ reactionCounts: counts, myReaction: next });
    try {
      swap(await api.reactToComment(listingId, post.id, next));
    } catch (err) {
      swap({ reactionCounts: post.reactionCounts, myReaction: post.myReaction });
      setProblem(err instanceof ApiRequestError ? err.message : 'Could not react.');
    }
  }

  return (
    <section className="lpcard posts rise" style={{ ['--i' as string]: 3 }}>
      <div className="posts__head">
        <h2 className="lpcard__title">Post or ask something</h2>
        <span className="posts__count">{posts.length}</span>
      </div>
      <p className="posts__hint">Public to everyone browsing. Hold a post to react or reply.</p>

      {threads.length === 0 && (
        <p className="posts__empty">Nothing here yet. Be the first to ask the seller something.</p>
      )}

      <div className="posts__list">
        {threads.map((post, n) => (
          <div key={post.id} className="posts__thread" style={{ ['--i' as string]: n }}>
            <Post post={post} listingId={listingId} sellerId={sellerId} canAct={Boolean(user)}
              mine={post.authorId === user?.id} onReact={(kind) => void react(post, kind)} onReply={() => startReply(post)} />
            {repliesTo(post.id).map((reply) => (
              <Post key={reply.id} post={reply} listingId={listingId} sellerId={sellerId} canAct={Boolean(user)} reply
                mine={reply.authorId === user?.id} onReact={(kind) => void react(reply, kind)} onReply={() => startReply(reply)} />
            ))}
          </div>
        ))}
      </div>

      {problem && <p className="posts__problem" role="alert">{problem}</p>}

      {/* A guest sees where to write, locked: tapping it asks them to sign in. */}
      {!user && (
        <button type="button" className="posts__compose posts__compose--locked is-locked"
          onClick={() => promptAuth('Sign in to post, ask the shop or react.')}>
          <span className="lockmark" aria-hidden="true">🔒</span> Sign in to post or ask something…
        </button>
      )}
      {user && (
        <form className="posts__compose" onSubmit={submit}>
          {replyTo && (
            <div className="posts__replying">
              <Svg name="reply" size={14} />
              <span>Replying to <b>{replyTo.author.name}</b></span>
              <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>×</button>
            </div>
          )}
          <div className="posts__field">
            <textarea ref={field} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={replyTo ? 'Write a reply…' : 'Post or ask something…'} aria-label="Your post" />
            <button type="submit" className="posts__send" disabled={busy || !draft.trim()} aria-label="Post">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7-7-1Z" /></svg>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** One post: hold it for React and Reply. */
function Post({ post, listingId, sellerId, canAct, mine, reply, onReact, onReply }: {
  post: ListingPost;
  listingId: string;
  sellerId: string;
  canAct: boolean;
  mine: boolean;
  reply?: boolean;
  onReact: (kind: ReactionKind) => void;
  onReply: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const { promptAuth } = useSession();
  const press = useLongPress(() => {
    if (!canAct) {
      promptAuth('Sign in to react or reply.');
      return;
    }
    setOpen(true);
    setPicking(false);
  });

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const tally = REACTIONS.map((kind) => ({ kind, count: post.reactionCounts[kind] ?? 0 })).filter((entry) => entry.count > 0);
  const choose = (kind: ReactionKind) => {
    setOpen(false);
    setPicking(false);
    onReact(kind);
  };

  return (
    <div ref={box} className={`post post--menu${reply ? ' post--reply' : ''}${open ? ' is-open' : ''}`}>
      <Avatar name={post.author.name} size={reply ? 28 : 34} />
      <div className="post__col">
        <div className="post__bubble" role="button" tabIndex={0} aria-expanded={open}
          aria-label="Post. Press and hold to react or reply" {...press}
          onDoubleClick={() => canAct && choose('love')}
          onKeyDown={(event) => canAct && (event.key === 'Enter' || event.key === 'ContextMenu') && setOpen(!open)}>
          <div className="post__head">
            <PersonLink party={post.author} className="post__who" />
            {post.authorId === sellerId && <span className="post__seller">Seller</span>}
            <span className="post__time">{timeAgo(post.createdAt)}</span>
          </div>
          <p className="post__body">{post.body}</p>
        </div>

        {open && (
          <div className="post__actions">
            {picking ? (
              <span className="post__picker">
                {REACTIONS.map((kind, index) => (
                  <button key={kind} type="button" aria-label={REACTION_META[kind].label}
                    className={post.myReaction === kind ? 'is-mine' : ''}
                    style={{ animationDelay: `${index * 25}ms` }} onClick={() => choose(kind)}>
                    {REACTION_META[kind].emoji}
                  </button>
                ))}
              </span>
            ) : (
              <>
                <button type="button" onClick={() => setPicking(true)}><Svg name="smile" size={15} /> React</button>
                <button type="button" onClick={() => { setOpen(false); onReply(); }}><Svg name="reply" size={15} /> Reply</button>
              </>
            )}
          </div>
        )}

        <div className="post__foot">
          {tally.map((entry) => (
            <button key={entry.kind} type="button" disabled={!canAct}
              className={`post__chip${post.myReaction === entry.kind ? ' is-mine' : ''}`}
              aria-label={`${REACTION_META[entry.kind].label}, ${entry.count}`} onClick={() => choose(entry.kind)}>
              {REACTION_META[entry.kind].emoji}{entry.count > 1 ? ` ${entry.count}` : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="post__more">
        <ReportButton targetType="comment" targetId={post.id} parentId={listingId} mine={mine} moderation={post.moderation}
          authorId={post.authorId} label={`Comment by ${post.author.name}`} />
      </div>
    </div>
  );
}
