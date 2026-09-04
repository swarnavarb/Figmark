import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LOT_STAGES, LOT_STAGE_LABELS } from '@shared/enums';
import type { Lot } from '@shared/models';
import { ApiRequestError, api, type ListingDetail } from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, LotMeter, Thumb, TrustBadge } from '../components/ui';
import { daysUntil, formatDate, formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

export function ListingPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();

  const [data, setData] = useState<ListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api
      .listing(id)
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const { listing, seller, lot, comments } = data;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setAction(null);
    try {
      await fn();
      setAction(label);
    } catch (err) {
      setAction(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const buy = () =>
    run('Order placed — see it under My Purchases.', async () => {
      await api.order(listing.id, 1);
      navigate('/me?tab=purchases');
    });

  const toggleLike = () =>
    run('', async () => {
      const result = await api.like(listing.id);
      setData((prev) => (prev ? { ...prev, liked: result.liked } : prev));
    });

  const toggleFollow = () =>
    run('', async () => {
      if (!seller) return;
      const result = await api.follow(seller.id);
      setData((prev) => (prev ? { ...prev, following: result.following } : prev));
    });

  const bump = () =>
    run('Bumped to the top of the feed.', async () => {
      await api.bump(listing.id);
    });

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    await run('', async () => {
      const result = await api.comment(listing.id, body);
      setData((prev) => (prev ? { ...prev, comments: [...prev.comments, result.comment] } : prev));
      setDraft('');
    });
  }

  return (
    <main className="page">
      <Link to="/" className="btn btn--quiet" style={{ marginBottom: 16 }}>
        <Icon name="back" size={14} /> Back to browse
      </Link>

      <div className="detail">
        <div>
          <Thumb seed={listing.id} label={listing.title} className="thumb detail__hero">
            <div className="thumb__badges">
              <span className="badge badge--solid">{listing.condition}</span>
              {lot && <span className="badge badge--accent">Group buy</span>}
            </div>
          </Thumb>

          <div className="detail__section" style={{ marginTop: 22 }}>
            <h1>{listing.title}</h1>
            <div className="spread muted">
              <span>{listing.category}</span>
              <span>{listing.viewCount} views</span>
              <span>{listing.likeCount} saved</span>
              <span>Listed {timeAgo(listing.createdAt)}</span>
            </div>
            <p style={{ marginTop: 6, lineHeight: 1.65 }}>{listing.description}</p>
            {listing.tags.length > 0 && (
              <div className="chips">
                {listing.tags.map((tag) => (
                  <span key={tag} className="chip" style={{ cursor: 'default' }}>#{tag}</span>
                ))}
              </div>
            )}
          </div>

          {lot && <LotPanel lot={lot} />}

          <section className="detail__section">
            <h2>Questions</h2>
            <p className="muted">Public — anyone browsing this listing can read these.</p>
            {comments.length === 0 && <p className="muted">No questions yet.</p>}
            <div>
              {comments.filter((c) => !c.replyToId).map((comment) => (
                <div key={comment.id}>
                  <div className="comment">
                    <div className="comment__head">
                      <span className="comment__who">{comment.authorName}</span>
                      <span className="faint">{timeAgo(comment.createdAt)}</span>
                    </div>
                    <p style={{ fontSize: 'var(--t-sm)' }}>{comment.body}</p>
                  </div>
                  {comments.filter((reply) => reply.replyToId === comment.id).map((reply) => (
                    <div key={reply.id} className="comment comment--reply">
                      <div className="comment__head">
                        <span className="comment__who">{reply.authorName}</span>
                        <span className="badge badge--accent">Seller</span>
                        <span className="faint">{timeAgo(reply.createdAt)}</span>
                      </div>
                      <p style={{ fontSize: 'var(--t-sm)' }}>{reply.body}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {user && (
              <form className="row" onSubmit={submitComment} style={{ marginTop: 10 }}>
                <input className="search" style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)' }}
                  value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask the seller a question…" />
                <button type="submit" className="btn btn--ghost" disabled={busy || !draft.trim()}>Post</button>
              </form>
            )}
          </section>
        </div>

        {/* ── Purchase rail ── */}
        <aside className="stack">
          <div className="card card--pad stack">
            <span className="detail__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
            <p className="muted">
              {listing.quantityAvailable > 0
                ? `${listing.quantityAvailable} available`
                : 'Sold out'}
            </p>

            {action && <p className={`notice ${action.includes('—') || action.includes('Bumped') ? 'notice--ok' : 'notice--error'}`}>{action}</p>}

            {data.isOwn ? (
              <>
                <p className="notice notice--info">This is your listing.</p>
                <button className="btn btn--ghost btn--block" onClick={() => void bump()} disabled={busy}>
                  Bump to top
                </button>
              </>
            ) : (
              <>
                <button className="btn btn--lg btn--block" onClick={() => void buy()}
                  disabled={busy || !user || listing.quantityAvailable === 0}>
                  {lot ? 'Join this lot' : 'Buy now'}
                </button>
                <button className={`btn btn--ghost btn--block${data.liked ? ' is-on' : ''}`}
                  onClick={() => void toggleLike()} disabled={busy || !user}
                  style={data.liked ? { color: 'var(--accent)', borderColor: 'var(--accent-line)' } : undefined}>
                  <Icon name="heart" size={14} /> {data.liked ? 'Saved' : 'Save'}
                </button>
                {!user && <p className="faint">Sign in to buy or save this listing.</p>}
              </>
            )}

            <p className="faint">
              Payment is held in escrow and released once you confirm delivery, or automatically after the
              dispute window closes.
            </p>
          </div>

          {seller && (
            <div className="card card--pad stack">
              <div className="row">
                <Avatar name={seller.storefrontName} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="card__title">{seller.storefrontName}</div>
                  <span className="faint">{seller.dispatchRegion ?? 'Location not set'}</span>
                </div>
                <TrustBadge score={seller.trustScore} tier={seller.tier} />
              </div>

              <dl style={{ margin: 0 }}>
                <div className="kv"><dt>Followers</dt><dd>{seller.followerCount}</dd></div>
                {seller.onTimeDispatchRate !== null && (
                  <div className="kv">
                    <dt>On-time dispatch</dt>
                    <dd>{Math.round(seller.onTimeDispatchRate * 100)}%</dd>
                  </div>
                )}
                <div className="kv"><dt>Tier</dt><dd style={{ textTransform: 'capitalize' }}>{seller.tier}</dd></div>
              </dl>

              {user && !data.isOwn && (
                <button className="btn btn--ghost btn--block" onClick={() => void toggleFollow()} disabled={busy}>
                  {data.following ? <><Icon name="check" size={14} /> Following</> : 'Follow seller'}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

/** The buyer-visible half of the lot workflow: fill, cutoff, stage, forwarder. */
function LotPanel({ lot }: { lot: Lot }) {
  const current = LOT_STAGES.indexOf(lot.stage);
  return (
    <section className="detail__section">
      <h2>{lot.name}</h2>
      <p className="muted">{lot.description}</p>

      <LotMeter filled={lot.filledCount} threshold={lot.fillThreshold} />
      <div className="spread muted">
        <span><strong style={{ color: 'var(--text)' }}>{lot.filledCount}/{lot.fillThreshold}</strong> units booked</span>
        {lot.status === 'open' && <span>Closes in {daysUntil(lot.cutoffAt)} days</span>}
        {lot.estimatedDispatchAt && <span>Est. dispatch {formatDate(lot.estimatedDispatchAt)}</span>}
      </div>

      <ol className="track" style={{ marginTop: 8 }}>
        {LOT_STAGES.map((stage, index) => (
          <li key={stage} className={`track__step${index < current ? ' is-done' : ''}${index === current ? ' is-current' : ''}`}>
            <span className="track__dot" aria-hidden="true" />
            <span>{LOT_STAGE_LABELS[stage]}</span>
          </li>
        ))}
      </ol>

      {lot.forwarder && (
        <div className="card card--pad" style={{ marginTop: 6 }}>
          <div className="row row--between">
            <div>
              <span className="faint">Freight forwarder</span>
              <div className="card__title">{lot.forwarder.name}</div>
            </div>
            {lot.forwarder.forwarderUserId ? (
              <span className="badge badge--ok">On platform</span>
            ) : (
              <span className="badge">Seller's own</span>
            )}
          </div>
          {lot.forwarder.trackingReference && (
            <p className="muted" style={{ marginTop: 8 }}>
              Tracking <span className="mono">{lot.forwarder.trackingReference}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export { EmptyState };
