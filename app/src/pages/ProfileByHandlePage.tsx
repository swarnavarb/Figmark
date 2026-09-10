import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { checkUsername, USERNAME_PROBLEMS } from '@shared/handles';
import {
  ApiRequestError, api,
  type Credit, type PageReviews, type PublicProfile, type ReviewsAbout,
} from '../api';
import { Avatar, EmptyState, ErrorNotice, Modal, Thumb } from '../components/ui';
import { formatDate, formatMoney, timeAgo } from '../format';
import { useSession } from '../session';
import { MessageButton } from './MessagesPage';
import { Stars } from './OrderPage';

/**
 * Whatever lives at `/<username>`.
 *
 * People and shops share one namespace, so this is one page: the server says
 * which it was and the page renders accordingly. That is not a shortcut. A
 * buyer is somebody a seller decides whether to deal with, and giving them a
 * name and nothing else while shops get a whole shopfront makes one side of
 * every trade unaccountable. So both get the same page, and the difference is
 * which numbers are worth showing on it.
 *
 * The shape follows the marketplaces this is modelled on: a banner, who they
 * are in one glance, then the credit record, then the shelf. The record sits
 * above the goods on purpose — deciding whether to trust a stranger comes
 * before deciding whether you want what they are selling.
 */
type Tab = 'items' | 'reviews';

export function ProfileByHandlePage() {
  const { username } = useParams<{ username: string }>();
  const { user } = useSession();
  const [data, setData] = useState<PublicProfile | null>(null);
  const [reviews, setReviews] = useState<ReviewsAbout | null>(null);
  const [pageReviews, setPageReviews] = useState<PageReviews | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('items');
  const [shelf, setShelf] = useState<'all' | 'onSale' | 'sold'>('all');
  const [creditOpen, setCreditOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadReviews = useCallback(async (id: string) => {
    const [trade, page] = await Promise.all([
      api.reviewsAbout(id).catch(() => null),
      api.pageReviews(id).catch(() => null),
    ]);
    if (trade) setReviews(trade);
    if (page) setPageReviews(page);
  }, []);

  useEffect(() => {
    if (!username) return;
    // A path that could never be a username is a wrong turn, not a lookup.
    const problem = checkUsername(username);
    if (problem) {
      setError(`There is no page at /${username}. ${USERNAME_PROBLEMS[problem]}`);
      return;
    }
    setError(null);
    setData(null);
    setReviews(null);
    setPageReviews(null);
    void api
      .profile(username)
      .then((profile) => {
        setData(profile);
        // Reviews are about the account, not the handle, so they need the id the
        // profile resolves to — and a page without them still renders.
        void loadReviews(profile.sellerId);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not open that page.'),
      );
  }, [username, loadReviews]);

  if (error) {
    return (
      <main className="page tab-view">
        <ErrorNotice message={error} />
        <Link to="/" className="btn btn--ghost" style={{ marginTop: 14, justifySelf: 'start' }}>
          Back to the feed
        </Link>
      </main>
    );
  }
  if (!data) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  const isMe = user?.id === data.sellerId;
  // A shop's page is about them as a seller; a person's is about them as a
  // buyer. A review of the same account on the other side is a real review of a
  // different thing, and belongs on the page that is about that thing.
  const direction = data.isStore ? 'buyer_to_seller' : 'seller_to_buyer';
  const rating = reviews ? (data.isStore ? reviews.asSeller : reviews.asBuyer) : null;
  const listed = reviews?.reviews.filter((review) => review.direction === direction) ?? [];

  // A person has no items tab, so asking for one lands on the only tab there is.
  const shownTab: Tab = data.isStore ? tab : 'reviews';

  const shown = data.listings.filter((listing) =>
    shelf === 'all' ? true : shelf === 'sold' ? listing.quantityAvailable === 0 : listing.quantityAvailable > 0,
  );

  return (
    <main className="storefront">
      {/* The banner. A shop that has not set one still gets a band rather than
          a hard edge, so every page has the same silhouette. */}
      <div className="storefront__cover">
        {data.coverUrl && <img src={data.coverUrl} alt="" />}
      </div>

      <div className="storefront__body">
        <header className="storefront__head">
          <div className="storefront__avatar">
            {data.photoUrl ? <img src={data.photoUrl} alt="" /> : <Avatar name={data.displayName} size={76} />}
          </div>
          <div className="storefront__who">
            <h1>{data.displayName}</h1>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="faint">@{data.handle}</span>
              {data.isStore && <span className="badge badge--accent">shop</span>}
              {data.tier && <span className="badge">{data.tier}</span>}
            </div>
            <p className="faint" style={{ margin: 0 }}>
              {data.isStore && (
                <>
                  {data.followerCount} {data.followerCount === 1 ? 'follower' : 'followers'} ·{' '}
                </>
              )}
              here since {formatDate(data.memberSince)}
              {data.lastSeenAt && ` · seen ${timeAgo(data.lastSeenAt)}`}
            </p>
          </div>
          <div className="storefront__act">
            {isMe ? (
              <Link to={data.isStore ? '/shop' : '/me'} className="btn btn--ghost btn--sm">Edit</Link>
            ) : (
              <MessageButton handle={data.handle} />
            )}
          </div>
        </header>

        {data.tags.length > 0 && (
          <div className="chips chips--tight">
            {data.tags.map((tag) => <span key={tag} className="chip chip--static">{tag}</span>)}
            {data.dispatchRegion && <span className="chip chip--static">ships from {data.dispatchRegion}</span>}
          </div>
        )}

        {data.bio && (
          <p className={`storefront__bio${expanded ? ' is-open' : ''}`}>
            {data.bio}
            {data.bio.length > 120 && (
              <button type="button" className="storefront__more" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Less' : 'More'}
              </button>
            )}
          </p>
        )}

        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
          {data.link && (
            <a className="btn btn--quiet btn--sm" href={withScheme(data.link)} target="_blank" rel="noreferrer noopener">
              {data.link.replace(/^https?:\/\//, '')}
            </a>
          )}
          {/* The person behind a shop is a separate address, and worth reaching
              when the shop's own voice is not who you want. */}
          {data.isStore && data.ownerHandle && (
            <Link to={`/${data.ownerHandle}`} className="btn btn--quiet btn--sm">@{data.ownerHandle}</Link>
          )}
        </div>

        {/* The credit record. Two words and a percentage is all that fits, and
            all of it opens onto what it counted — a grade nobody can check is
            a grade nobody should believe. */}
        <button type="button" className="credit" onClick={() => setCreditOpen(true)}>
          <div className="credit__cell">
            <span className="credit__grade">{gradeFor(reviews?.asSeller.average ?? null)}</span>
            <span className="credit__label">Seller credit</span>
          </div>
          <div className="credit__cell">
            <span className="credit__grade credit__grade--buyer">
              {gradeFor(reviews?.asBuyer.average ?? null)}
            </span>
            <span className="credit__label">Buyer credit</span>
          </div>
          <div className="credit__cell">
            <span className="credit__figure">
              {rating?.average != null ? `${(rating.average / 20).toFixed(1)}` : '—'}
            </span>
            <span className="credit__label">
              {rating?.count ? `from ${rating.count}` : 'unrated'}
            </span>
          </div>
          <span className="credit__open">›</span>
        </button>

        {/* A person with no shop has no shelf, so they get no tab for one. A tab
            whose whole content is "there is nothing here" is a tab that exists
            to be disappointing. */}
        <div className="tabs" style={{ marginTop: 16 }}>
          {data.isStore && (
            <button className={`tab${shownTab === 'items' ? ' is-on' : ''}`} onClick={() => setTab('items')}>
              Items {data.counts.listings}
            </button>
          )}
          <button className={`tab${shownTab === 'reviews' ? ' is-on' : ''}`} onClick={() => setTab('reviews')}>
            Reviews {(reviews?.count ?? 0) + (pageReviews?.count ?? 0)}
          </button>
        </div>

        {shownTab === 'items' ? (
          data.listings.length === 0 ? (
            <EmptyState title="Nothing listed yet">
              This shop has not put anything up. Following it puts new items on your feed.
            </EmptyState>
          ) : (
            <>
              <div className="chips chips--tight" style={{ marginBottom: 12 }}>
                {([
                  ['all', `All ${data.counts.listings}`],
                  ['onSale', `On sale ${data.counts.onSale}`],
                  ['sold', `Sold out ${data.counts.sold}`],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" className={`chip${shelf === id ? ' is-on' : ''}`}
                    onClick={() => setShelf(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {shown.length === 0 ? (
                <p className="faint">Nothing here under that filter.</p>
              ) : (
                <div className="grid">
                  {shown.map((listing) => (
                    <Link key={listing.id} to={`/listing/${listing.id}`} className="card card--link">
                      <Thumb seed={listing.id} label={listing.title}>
                        <div className="thumb__badges">
                          <span className="badge badge--solid">{listing.condition}</span>
                        </div>
                      </Thumb>
                      <div className="listing__body">
                        <span className="listing__title">{listing.title}</span>
                        <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
                        <div className="listing__meta">
                          <span className="faint">♥ {listing.likeCount}</span>
                          <span className="faint">
                            {listing.quantityAvailable === 0 ? 'sold out' : `${listing.quantityAvailable} left`}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )
        ) : (
          <ReviewsTab
            profile={data}
            trade={reviews}
            listed={listed}
            page={pageReviews}
            canWrite={Boolean(user) && !isMe}
            onWritten={() => void loadReviews(data.sellerId)}
          />
        )}
      </div>

      {creditOpen && <CreditSheet profile={data} onClose={() => setCreditOpen(false)} />}
    </main>
  );
}

/**
 * The whole record behind two words on a card.
 *
 * Every figure here names the rows it counted. "Excellent" without what is
 * under it is a badge somebody awarded themselves, and the point of opening
 * this is that a stranger can check.
 */
function CreditSheet({ profile, onClose }: { profile: PublicProfile; onClose: () => void }) {
  const [credit, setCredit] = useState<Credit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .credit(profile.sellerId)
      .then(setCredit)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load their record.'),
      );
  }, [profile.sellerId]);

  return (
    <Modal title="Buying and selling record" onClose={onClose}>
      {error && <ErrorNotice message={error} />}
      {!credit ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="stack">
          <p className="faint" style={{ marginTop: 0 }}>
            {profile.displayName} · here since {formatDate(credit.memberSince)}
          </p>

          <div className="creditgrid">
            <CreditCard
              title="As a seller"
              grade={gradeFor(credit.seller.average)}
              rate={credit.asSeller.goodRate}
              rows={[
                ['Sold', credit.asSeller.sold],
                ['Completed', credit.asSeller.completed],
                ['Rated well', credit.asSeller.praised],
                ['Disputes lost', credit.asSeller.disputes],
              ]}
            />
            <CreditCard
              title="As a buyer"
              grade={gradeFor(credit.buyer.average)}
              rate={credit.asBuyer.goodRate}
              rows={[
                ['Bought', credit.asBuyer.bought],
                ['Completed', credit.asBuyer.completed],
                ['Rated well', credit.asBuyer.praised],
                ['Disputes lost', credit.asBuyer.disputes],
              ]}
            />
          </div>

          <section className="detail__section">
            <h3>What has been checked</h3>
            <div className="kv"><dt>Phone</dt><dd>{credit.verification.phone}</dd></div>
            <div className="kv"><dt>Email</dt><dd>{credit.verification.email}</dd></div>
            <div className="kv"><dt>Government ID</dt><dd>{credit.verification.governmentId}</dd></div>
            {credit.tier && <div className="kv"><dt>Seller tier</dt><dd>{credit.tier}</dd></div>}
          </section>

          {/* Said out loud rather than left to be inferred, because the number
              above it is only worth anything if this one cannot move it. */}
          <p className="faint">
            Everything above is counted from completed orders. Opinions left on this page
            {credit.page.count > 0
              ? ` — ${credit.page.count} of them, averaging ${(credit.page.average! / 20).toFixed(1)} —`
              : ' '}
            are shown under Reviews and are not part of any figure here.
          </p>
        </div>
      )}
    </Modal>
  );
}

function CreditCard({ title, grade, rate, rows }: {
  title: string;
  grade: string;
  rate: number | null;
  rows: [string, number][];
}) {
  return (
    <div className="creditcard">
      <div className="row row--between">
        <strong>{title}</strong>
        <span className="credit__grade">{grade}</span>
      </div>
      <div className="creditcard__rate">{rate === null ? 'unrated' : `${rate}% rated well`}</div>
      {rows.map(([label, value]) => (
        <div className="kv" key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </div>
  );
}

/**
 * Reviews, in two lists that are never added together.
 *
 * The earned ones carry the item they were written about: a five-star on a ₹200
 * keyring and one on a ₹40,000 consignment are not the same recommendation, and
 * a review with the thing next to it is evidence rather than an assertion.
 *
 * Below them, what people said about the page. Anybody may write one, which is
 * exactly why it is a separate list under its own heading and counts towards
 * nothing above.
 */
function ReviewsTab({ profile, trade, listed, page, canWrite, onWritten }: {
  profile: PublicProfile;
  trade: ReviewsAbout | null;
  listed: ReviewsAbout['reviews'];
  page: PageReviews | null;
  canWrite: boolean;
  onWritten: () => void;
}) {
  return (
    <div className="stack">
      <section className="detail__section">
        <h3>From completed orders</h3>
        {!trade ? (
          <p className="faint">Loading…</p>
        ) : listed.length === 0 ? (
          <p className="faint">
            No reviews yet{profile.isStore ? ' as a seller' : ' as a buyer'}.
            {trade.pending > 0 && ` ${trade.pending} written and waiting on the other side.`}
          </p>
        ) : (
          <div className="card card--pad">
            {listed.map((review) => (
              <article key={review.id} className="review">
                <div className="review__head">
                  <span className="review__who">{review.authorName}</span>
                  <span className="faint">{timeAgo(review.createdAt)}</span>
                </div>
                <Stars value={review.rating} />
                {review.body && <p className="muted">{review.body}</p>}
                {review.item && (
                  <Link to={`/listing/${review.item.listingId}`} className="review__item">
                    <span>{review.item.name}</span>
                    <span className="faint">
                      {formatMoney(review.item.totalMinor, review.item.currency)}
                    </span>
                  </Link>
                )}
              </article>
            ))}
            {trade.pending > 0 && (
              <p className="faint" style={{ marginTop: 10 }}>
                {trade.pending} more written and hidden until both sides have rated.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="detail__section">
        <h3>
          About this page
          {page && page.count > 0 && (
            <span className="faint" style={{ fontWeight: 400 }}>
              {' '}· {(page.average! / 20).toFixed(1)} from {page.count}
            </span>
          )}
        </h3>
        <p className="faint" style={{ marginTop: 0 }}>
          Anybody can leave one of these, so they are counted on their own and never folded into the
          record above.
        </p>

        {canWrite && <PageReviewForm subjectId={profile.sellerId} existing={page?.yours ?? null} onWritten={onWritten} />}

        {page && page.reviews.length > 0 && (
          <div className="card card--pad" style={{ marginTop: 12 }}>
            {page.reviews.map((review) => (
              <article key={review.id} className="review">
                <div className="review__head">
                  <span className="review__who">
                    {review.authorHandle ? (
                      <Link to={`/${review.authorHandle}`}>{review.authorName}</Link>
                    ) : (
                      review.authorName
                    )}
                    {review.mine && <span className="badge" style={{ marginLeft: 8 }}>yours</span>}
                  </span>
                  <span className="faint">{timeAgo(review.createdAt)}</span>
                </div>
                <Stars value={review.rating} />
                <p className="muted">{review.body}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One per person, replaced rather than added to. */
function PageReviewForm({ subjectId, existing, onWritten }: {
  subjectId: string;
  existing: number | null;
  onWritten: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(existing ?? 5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.writePageReview(subjectId, { rating, body: body.trim() });
      setOpen(false);
      setBody('');
      onWritten();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>
        {existing === null ? 'Leave a review' : 'Change your review'}
      </button>
    );
  }

  return (
    <div className="card card--pad stack">
      <label className="field">
        <span>Rating</span>
        <div className="row">
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button"
              className={`starpick${value <= rating ? ' is-on' : ''}`}
              aria-label={`${value} out of 5`}
              onClick={() => setRating(value)}>
              ★
            </button>
          ))}
        </div>
      </label>
      <label className="field">
        <span>What you want to say</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
          placeholder="Quick to reply, packs well, knows the range…" />
      </label>
      {error && <ErrorNotice message={error} />}
      <div className="row">
        <button className="btn" disabled={busy || body.trim().length < 4} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Post it'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * A score out of 100 as a word.
 *
 * Words rather than a number because the number is already beside it, and
 * because "unrated" is a real answer that 0% is not — an account nobody has
 * reviewed is not one everybody disliked.
 */
function gradeFor(average: number | null): string {
  if (average === null) return 'unrated';
  if (average >= 90) return 'excellent';
  if (average >= 75) return 'good';
  if (average >= 55) return 'mixed';
  return 'poor';
}

/** Links are stored as typed, so give a bare domain a scheme before opening it. */
function withScheme(link: string) {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}
