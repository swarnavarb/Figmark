import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api, type ListingDetail, type PreOrderRoster } from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, PersonLink, Thumb, TrustBadge } from '../components/ui';
import { FillBlock } from '../components/FillMeter';
import { formatDate, formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

export function ListingPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  // Who sent them here, if anybody. Carried into the pledge and the order so
  // whoever recruited them is credited for it - the only thing that makes
  // sharing a group-buy worth a person's own reputation.
  const [params] = useSearchParams();
  const via = params.get('via');

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

  const { listing, seller, comments } = data;

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

  // Buying opens the checkout; it does not complete a purchase. The order is
  // created unpaid, which is what makes the next screen possible at all - how
  // to pay is a question about a specific order, and the two answers differ in
  // who ends up holding the money. Landing the buyer on their purchases list
  // instead skipped that question entirely and left an unpaid order behind
  // looking like a completed one.
  const buy = () =>
    run('', async () => {
      const placed = await api.order(listing.id, 1, via);
      navigate(`/order/${placed.order.id}`);
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
              {listing.preOrder && <span className="badge badge--accent">Pre-order</span>}
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

          {data.preOrder && (
            <PreOrderPanel
              listingId={listing.id}
              roster={data.preOrder}
              estimatedDispatchAt={data.estimatedDispatchAt}
              canJoin={Boolean(user) && !data.isOwn}
              meId={user?.id ?? null}
              via={via}
              onChange={(roster) => setData((prev) => (prev ? { ...prev, preOrder: roster } : prev))}
            />
          )}

          <section className="detail__section">
            <h2>Questions</h2>
            <p className="muted">Public — anyone browsing this listing can read these.</p>
            {comments.length === 0 && <p className="muted">No questions yet.</p>}
            <div>
              {comments.filter((c) => !c.replyToId).map((comment) => (
                <div key={comment.id}>
                  <div className="comment">
                    <div className="comment__head">
                      <PersonLink party={comment.author} className="comment__who" />
                      <span className="faint">{timeAgo(comment.createdAt)}</span>
                    </div>
                    <p style={{ fontSize: 'var(--t-sm)' }}>{comment.body}</p>
                  </div>
                  {comments.filter((reply) => reply.replyToId === comment.id).map((reply) => (
                    <div key={reply.id} className="comment comment--reply">
                      <div className="comment__head">
                        <PersonLink party={reply.author} className="comment__who" />
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
                  {listing.preOrder ? 'Book a place' : 'Buy now'}
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
              Nothing is charged here. The next screen is where you choose how to pay: directly to the
              seller, or through an escrow who holds it until you confirm the item arrived.
            </p>
          </div>

          {seller && (
            <div className="card card--pad stack">
              <div className="row">
                <Avatar name={seller.storefrontName} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* The shop's name is its address: tapping it opens its page. */}
                  <PersonLink party={{ name: seller.storefrontName, handle: seller.username }}
                    className="card__title" />
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

              {/* A question about an item is asked of the shop, not of whoever
                  happens to own it — so the message goes to the shop's handle. */}
              {user && !data.isOwn && seller.username && (
                <Link to={`/messages/${encodeURIComponent(seller.username)}`} className="btn btn--quiet btn--block">
                  💬 Message {seller.storefrontName}
                </Link>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

/**
 * Demand pooling, as the buyer sees it - and as a group rather than a bar.
 *
 * Says nothing about shipment batches: which consignment this rides in, who
 * else is in it and where it currently sits are the seller's business. What a
 * buyer needs is how close this is to going ahead, who else is in, when booking
 * closes, and roughly when it ships.
 *
 * The free step is deliberately first and deliberately smaller than the paid
 * one. Somebody who pledges has told the seller something true at no cost to
 * themselves; somebody who is asked to pay into a batch that may never happen
 * mostly just leaves, and a bar at zero recruits nobody.
 */
function PreOrderPanel({
  listingId,
  roster,
  estimatedDispatchAt,
  canJoin,
  meId,
  via,
  onChange,
}: {
  listingId: string;
  roster: PreOrderRoster;
  estimatedDispatchAt: string | null;
  canJoin: boolean;
  /** The reader's own id, which is what a share link credits. */
  meId: string | null;
  via: string | null;
  onChange: (roster: PreOrderRoster) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const view = roster.preOrder;
  const mine = roster.mine;
  const open = view.state === 'open' || view.state === 'nearly';

  const BADGE: Record<PreOrderRoster['preOrder']['state'], { tone: string; label: string }> = {
    open: { tone: 'warn', label: 'Booking open' },
    nearly: { tone: 'warn', label: 'Nearly there' },
    called: { tone: 'ok', label: 'Going ahead' },
    going: { tone: 'ok', label: 'Going ahead' },
    closed: { tone: 'danger', label: "Didn't fill" },
  };
  const badge = BADGE[view.state];

  async function change(body: { units?: number; listed?: boolean } = {}) {
    setBusy(true);
    setProblem(null);
    try {
      onChange(await api.pledge(listingId, { ...body, via }));
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'Could not do that.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The share link, carrying who is sharing it.
   *
   * Written as a full URL rather than a route because it leaves the app: the
   * point of sharing a group-buy is the people who are not in it yet.
   */
  async function share() {
    // Credited only when the person sharing it is actually in the thing they
    // are recommending. Recruiting for a batch you would not join yourself is
    // how somebody spends their reputation without noticing.
    const url = `${window.location.origin}/listing/${listingId}${
      mine && meId ? `?via=${encodeURIComponent(meId)}` : ''
    }`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setProblem(url);
    }
  }

  return (
    <section className="detail__section">
      <div className="row row--between">
        <h2>Pre-order</h2>
        <span className={`badge badge--${badge.tone}`}>{badge.label}</span>
      </div>

      <FillBlock view={view} people={roster.people} unlisted={roster.unlisted} />

      <p className="muted">
        {view.state === 'closed' ? (
          <>
            It closed {view.fillThreshold - view.committed} short, so the seller placed no order.
            Bookings are refunded in full and pledges were never charged.
          </>
        ) : view.state === 'called' || view.state === 'going' ? (
          <>
            It reached {view.fillThreshold}, so the seller is placing the order.
            {view.pledgedCount > 0 && ' Pledges are being called in for payment now.'}
            {estimatedDispatchAt && ` Ships around ${formatDate(estimatedDispatchAt)}.`}
          </>
        ) : (
          <>
            The seller places the order at {view.fillThreshold}. Pledging costs nothing now and is
            called in for payment — within a day — the moment it fills. Nobody pays for a batch that
            does not happen.
          </>
        )}
      </p>

      {problem && <p className="notice notice--error">{problem}</p>}

      {canJoin && open && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <button className={`btn${mine?.pledged ? ' btn--ghost' : ''}`} style={{ flex: 1 }}
              onClick={() => void change()} disabled={busy}>
              {mine?.pledged ? (
                <><Icon name="check" size={14} /> You&rsquo;re in</>
              ) : mine?.booked ? (
                '+ One more'
              ) : (
                "+ I'm in"
              )}
            </button>
            <button className="btn btn--ghost" onClick={() => void share()} disabled={busy}>
              {copied ? 'Link copied' : '↗ Bring someone in'}
            </button>
          </div>

          {mine?.pledged && (
            <label className="row" style={{ gap: 8, fontSize: 'var(--t-sm)', color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={mine.listed} disabled={busy}
                onChange={(event) => void change({ listed: event.target.checked })} />
              Show my name to other people looking at this
            </label>
          )}
        </div>
      )}

      {roster.brought.length > 0 && (
        <p className="notice notice--info">
          You brought {roster.brought.length}{' '}
          {roster.brought.length === 1 ? 'person' : 'people'} in:{' '}
          {roster.brought.map((ref, index) => (
            <span key={`${ref.name}-${index}`}>
              {index > 0 && ', '}
              <PersonLink party={ref} />
            </span>
          ))}
          .
        </p>
      )}

      <Roster roster={roster} />
    </section>
  );
}

/**
 * Who is in, and who is only counted.
 *
 * Naming is opt in and off by default. Being one of twenty is a fact about a
 * group; being named tells strangers what you buy and roughly what you spend,
 * and which of those somebody is comfortable with is not a decision to make on
 * their behalf by displaying it.
 */
function Roster({ roster }: { roster: PreOrderRoster }) {
  if (roster.people.length === 0 && roster.unlisted === 0) {
    return <p className="faint">Nobody yet. Whoever goes first gets the bar off zero.</p>;
  }

  return (
    <div className="roster">
      {roster.people.map((person, index) => (
        <div key={`${person.ref.name}-${index}`} className="roster__row">
          <Avatar name={person.ref.name} size={30} />
          <div className="roster__who">
            <PersonLink party={person.ref} className="roster__name" />
            <span className="faint">
              {person.booked ? 'Booked' : 'In if it fills'} · {person.units}{' '}
              {person.units === 1 ? 'unit' : 'units'} · {timeAgo(person.joinedAt)}
            </span>
          </div>
          {/* Three states, not two: an order exists, the money arrived, or
              neither yet. Calling an unpaid order "Paid" would tell the other
              nineteen people something false about how safe this is. */}
          <span className={`badge${person.paid ? ' badge--ok' : ''}`}>
            {person.paid ? 'Paid' : person.booked ? 'Booked' : 'Pledged'}
          </span>
        </div>
      ))}
      {roster.unlisted > 0 && (
        <div className="roster__row">
          <span className="roster__quiet">{roster.unlisted}</span>
          <div className="roster__who">
            <span className="roster__name muted">
              {roster.unlisted} {roster.unlisted === 1 ? 'other' : 'others'}, not listed
            </span>
            <span className="faint">They chose to be counted rather than named</span>
          </div>
        </div>
      )}
    </div>
  );
}

export { EmptyState };
