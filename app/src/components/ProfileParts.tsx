import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { StickerView } from '@shared/quest';
import type { MergedRating, StoreLevel } from '@shared/storefront';
import {
  ApiRequestError, api,
  type Credit, type PageReviews, type PageSide, type PublicProfile, type ReviewsAbout,
} from '../api';
import { formatMoney, timeAgo } from '../format';
import { useSession } from '../session';
import { EarnPill, earnOf } from './Affiliate';
import { SkeletonText, useToast } from './Feedback';
import { useShareSheet, type ShareSpec } from './ShareKit';
import { Icon } from './Icon';
import { StarRow } from './ListingBlocks';
import { LevelRing, Sticker, StickerSheet, XpBar } from './Quest';
import { ReportButton } from './ReportButton';
import { Avatar, ErrorNotice, Modal, PersonLink, Thumb, leadPhoto } from './ui';

/**
 * The parts a person's page and a shop's page share: the buttons under the
 * name, the bio, the one rating and what is behind it, and the reviews.
 *
 * The shop and the person behind it are two pages on one account, so every
 * part here takes which side it is about and never mixes the two.
 */

/* ── Follow, message, share ─────────────────────────────────────────────── */

export function FollowButton({ id, following, onChange }: {
  /** The account id for a shop, `person:<id>` for a person. */
  id: string;
  following: boolean;
  onChange: (following: boolean, followers?: number) => void;
}) {
  const { user, gate } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    onChange(!following);
    try {
      const result = await api.follow(id);
      onChange(result.following, result.followerCount);
    } catch (err) {
      onChange(following);
      toast(err instanceof ApiRequestError ? err.message : 'That did not save.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={`pbtn pbtn--follow${following ? ' is-on' : ''}`} aria-pressed={following}
      disabled={busy} onClick={gate(() => void toggle(), 'Sign in to follow.')}>
      {user ? <Icon name={following ? 'check' : 'plus'} size={15} /> : <span aria-hidden="true">🔒</span>}
      {following ? 'Following' : 'Follow'}
    </button>
  );
}

export function MessagePill({ handle }: { handle: string }) {
  const { user, gate } = useSession();
  return (
    <Link to={`/messages/${encodeURIComponent(handle)}`} className="pbtn pbtn--message"
      onClick={gate(() => undefined, 'Sign in to send a message.')}>
      {user ? <Icon name="message" size={15} /> : <span aria-hidden="true">🔒</span>}
      Message
    </Link>
  );
}

type SharedProfile = Pick<PublicProfile, 'sellerId' | 'isStore' | 'handle' | 'displayName' | 'photoUrl' | 'followerCount' | 'levelTag' | 'counts'>;

/**
 * The page as a picture to share: a shop's photo and standing, or a
 * collector's level - with the sharer's invite on the link either way.
 */
function profileShareSpec(profile: SharedProfile, isMe: boolean): ShareSpec {
  const level = `Level ${profile.levelTag.level} ${profile.levelTag.title}`;
  const followers = profile.followerCount > 0 ? ` · ${profile.followerCount.toLocaleString('en-IN')} followers` : '';
  if (profile.isStore) {
    return {
      kind: 'shop',
      moment: {
        photo: profile.photoUrl,
        title: profile.displayName,
        detail: `${level}${followers}`,
        headline: isMe ? 'Shop with us' : 'My go-to shop',
        cta: 'Follow for the next drop',
        ...(isMe ? { byline: `@${profile.handle} on Figmark` } : {}),
      },
      link: { to: 'page', handle: profile.handle },
      caption: isMe
        ? `We're on Figmark 🏪 Follow ${profile.displayName} for group buys and new drops.`
        : `Check out ${profile.displayName} on Figmark - my go-to for imports 🏪`,
      target: profile.handle,
      storeId: isMe ? profile.sellerId : null,
    };
  }
  return {
    kind: 'profile',
    moment: {
      level: { level: profile.levelTag.level, title: profile.levelTag.title },
      title: profile.displayName,
      detail: `@${profile.handle}${followers}`,
      headline: isMe ? 'My collection' : `Meet ${profile.displayName.split(/\s+/)[0]}`,
      cta: 'Collect with me on Figmark',
    },
    link: { to: 'page', handle: profile.handle },
    caption: isMe ? `My collection on Figmark 💎 Come see - and collect with me.` : `${profile.displayName}'s collection on Figmark 💎`,
    target: profile.handle,
  };
}

function ShareProfileButton({ profile, isMe }: { profile: SharedProfile; isMe: boolean }) {
  const { open, sheet } = useShareSheet();
  return (
    <>
      <button type="button" className="pbtn pbtn--icon" aria-label="Share this page" onClick={() => open(profileShareSpec(profile, isMe))}>
        <Icon name="share" size={16} />
      </button>
      {sheet}
    </>
  );
}

/** Follow then Message, or Edit on your own page; Share either way. */
export function PageActions({ profile, isMe, edit, onFollow }: {
  profile: SharedProfile & Pick<PublicProfile, 'following'>;
  isMe: boolean;
  edit: ReactNode;
  onFollow: (following: boolean, followers?: number) => void;
}) {
  return (
    <div className="pacts">
      {isMe ? edit : (
        <>
          <FollowButton id={profile.isStore ? profile.sellerId : `person:${profile.sellerId}`}
            following={profile.following} onChange={onFollow} />
          <MessagePill handle={profile.handle} />
        </>
      )}
      <ShareProfileButton profile={profile} isMe={isMe} />
    </div>
  );
}

/* ── Bio ────────────────────────────────────────────────────────────────── */

/** Their own words, with @handles as links and #tags lit, cut at four lines. */
export function Bio({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  const long = text.length > 180 || text.split('\n').length > 4;
  return (
    <section className={`pbio${open ? ' is-open' : ''}`}>
      <p className="pbio__text">
        {text.split(/([@#][\w-]{2,30})/g).map((part, i) =>
          part.startsWith('@') ? <Link key={i} to={`/${part.slice(1)}`} className="pbio__at">{part}</Link>
            : part.startsWith('#') ? <span key={i} className="pbio__tag">{part}</span>
              : part)}
      </p>
      {long && (
        <button type="button" className="pbio__more" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </section>
  );
}

/* ── The one rating ────────────────────────────────────────────────────── */

/** A score out of 100 as a word; "unrated" is a real answer that 0 is not. */
export function gradeFor(average: number | null): string {
  if (average === null) return 'Unrated';
  if (average >= 90) return 'Excellent';
  if (average >= 75) return 'Good';
  if (average >= 55) return 'Mixed';
  return 'Poor';
}

const stars = (average: number | null) => (average === null ? null : average / 20);

/**
 * Ratings after a trade and ratings left on the page, as one figure. A shop's
 * is as a seller and a person's as a buyer; tapping it shows what it is made of.
 */
export function RatingSlab({ rating, side, onOpen }: { rating: MergedRating; side: PageSide; onOpen: () => void }) {
  const score = stars(rating.average);
  const most = Math.max(1, ...rating.stars);
  return (
    <section className={`rslab rslab--${side}`}>
      <button type="button" className="rslab__top" onClick={onOpen}
        aria-label={`${side === 'store' ? 'Seller' : 'Buyer'} rating ${score?.toFixed(1) ?? 'unrated'}. Show details`}>
        <span className="rslab__score">
          <b>{score?.toFixed(1) ?? '—'}</b>
          <StarRow value={score ?? 0} size={13} />
        </span>
        <span className="rslab__mid">
          <b>{gradeFor(rating.average)} <span>{side === 'store' ? 'seller' : 'buyer'}</span></b>
          <small>{rating.count ? `${rating.count} ${rating.count === 1 ? 'rating' : 'ratings'} · orders and page` : 'No ratings yet'}</small>
        </span>
        <span className="rslab__bars" aria-hidden="true">
          {rating.stars.map((count, i) => (
            <i key={i} style={{ ['--h' as string]: `${(count / most) * 100}%`, ['--i' as string]: i }} />
          ))}
        </span>
        <span className="rslab__open" aria-hidden="true"><Icon name="right" size={16} /></span>
      </button>
    </section>
  );
}

/** What the one figure is made of, and the record behind it. */
export function RatingSheet({ profile, rating, onClose, onReviews, record: given }: {
  profile: Pick<PublicProfile, 'sellerId' | 'isStore' | 'displayName' | 'ownerHandle' | 'trustScore' | 'memberSince'>;
  rating: MergedRating;
  onClose: () => void;
  onReviews: () => void;
  /** A record of their own to show in place of the counted one: a buyer's six boxes. */
  record?: ReactNode;
}) {
  const side: PageSide = profile.isStore ? 'store' : 'person';
  const [credit, setCredit] = useState<Credit | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.credit(profile.sellerId, side).then(setCredit)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load their record.'));
  }, [profile.sellerId, side]);

  const score = stars(rating.average);
  const record = credit && (profile.isStore
    ? [['Sold', credit.asSeller.sold], ['Delivered', credit.asSeller.completed],
      ['Rated 4★+', credit.asSeller.praised], ['Disputes lost', credit.asSeller.disputes]]
    : [['Bought', credit.asBuyer.bought], ['Received', credit.asBuyer.completed],
      ['Rated 4★+', credit.asBuyer.praised], ['Disputes lost', credit.asBuyer.disputes]]) as [string, number][] | null;

  return (
    <Modal title={profile.isStore ? 'Seller rating' : 'Buyer rating'} onClose={onClose}>
      <div className="rsheet">
        <div className="rsheet__hero">
          <span className="rsheet__ring" style={{ ['--p' as string]: `${((score ?? 0) / 5) * 100}%` }}>
            <b>{score?.toFixed(1) ?? '—'}</b>
            <small>of 5</small>
          </span>
          <span className="rsheet__sum">
            <b>{gradeFor(rating.average)}</b>
            <StarRow value={score ?? 0} size={18} />
            <small className="faint">
              {rating.count ? `${rating.count} ${rating.count === 1 ? 'rating' : 'ratings'}` : 'Nobody has rated yet'}
              {profile.isStore ? ' as a seller' : ' as a buyer'}
            </small>
          </span>
        </div>

        <div className="rsheet__bars">
          {rating.stars.map((count, i) => (
            <span key={i} className="rsheet__bar" style={{ ['--i' as string]: i }}>
              <small>{5 - i}★</small>
              <span className="rsheet__track">
                <span className={i >= 3 ? 'is-low' : ''} style={{ width: `${rating.count ? (count / rating.count) * 100 : 0}%` }} />
              </span>
              <small>{count}</small>
            </span>
          ))}
        </div>

        <div className="rsheet__parts">
          <RatingPart icon="check" title="After orders" sub={profile.isStore ? 'from buyers who received' : 'from sellers they bought from'}
            part={rating.trade} />
          <RatingPart icon="users" title="On this page" sub="from anyone who visits" part={rating.page} />
        </div>

        <section className="rsheet__block">
          <h4>Record</h4>
          {error && <ErrorNotice message={error} />}
          {given ?? (
            <div className="rsheet__record">
              {(record ?? [['', 0], ['', 0], ['', 0], ['', 0]] as [string, number][]).map(([label, value], i) => (
                <span key={i} className={`rsheet__stat${record ? '' : ' is-loading'}${label === 'Disputes lost' && value > 0 ? ' is-bad' : ''}`}>
                  <b>{record ? value : ' '}</b><small>{label || ' '}</small>
                </span>
              ))}
            </div>
          )}
          {profile.isStore && profile.trustScore !== null && (
            <p className="rsheet__trust">
              Trust <b>{profile.trustScore}</b>/100 <span className="faint">· from completed, undisputed orders</span>
            </p>
          )}
        </section>

        {credit && (
          <section className="rsheet__verified">
            <h4><Icon name="check" size={14} /> Verified</h4>
            <div className="rsheet__checks">
              {([['Phone', credit.verification.phone], ['Email', credit.verification.email], ['Government ID', credit.verification.governmentId]] as const)
                .map(([label, state]) => (
                  <span key={label} className={`rsheet__check${state === 'verified' ? ' is-ok' : ''}`}>
                    <Icon name={state === 'verified' ? 'check' : 'close'} size={13} /> {label}
                  </span>
                ))}
              {profile.isStore && credit.tier && <span className="rsheet__check is-ok">{credit.tier} tier</span>}
            </div>
          </section>
        )}

        {profile.isStore && profile.ownerHandle && (
          <p className="faint rsheet__note">
            How the owner buys is on their own page, <Link to={`/${profile.ownerHandle}`} onClick={onClose}>@{profile.ownerHandle}</Link>.
          </p>
        )}
        <button type="button" className="btn rsheet__cta" onClick={() => { onClose(); onReviews(); }}>Read the reviews</button>
      </div>
    </Modal>
  );
}

function RatingPart({ icon, title, sub, part }: {
  icon: 'check' | 'users';
  title: string;
  sub: string;
  part: MergedRating['trade'];
}) {
  const score = stars(part.average);
  return (
    <div className="rsheet__part">
      <span className="rsheet__parthead"><Icon name={icon} size={14} /> {title}</span>
      <b>{score === null ? '—' : <>{score.toFixed(1)}<small>★</small></>}</b>
      <small className="faint">{part.count} · {sub}</small>
    </div>
  );
}

/* ── A shop's level and stickers ───────────────────────────────────────── */

export function StoreLevelCard({ level, stickers }: { level: StoreLevel; stickers: StickerView[] }) {
  const [open, setOpen] = useState<StickerView | null>(null);
  const earned = stickers.filter((sticker) => sticker.earned).length;
  // In the order the server gave: earned first, Trusted and Top rated leading.
  const sorted = stickers;
  return (
    <section className="slevel">
      <div className="slevel__head">
        <span className="slevel__ring"><LevelRing level={level.level} progress={level.progress} size={58} /></span>
        <span className="slevel__who">
          <b>Level {level.level} · {level.title}</b>
          <small className="faint">
            {level.next === null ? `${level.points} points · top level` : `${level.points} points · ${level.next - level.points} to level ${level.level + 1}`}
          </small>
          <XpBar progress={level.progress} tone="gold" />
        </span>
        <span className="slevel__count"><b>{earned}</b><small>of {stickers.length}<br />stickers</small></span>
      </div>
      <div className="qstickers qstickers--row slevel__stickers">
        {sorted.map((sticker) => <Sticker key={sticker.id} sticker={sticker} onOpen={() => setOpen(sticker)} />)}
      </div>
      <details className="slevel__how">
        <summary>How levels work</summary>
        <p className="faint">
          Shops and buyers level on the same scale, and every way of earning pays the same: 20 XP per action
          (up to 100 of each kind) and the same amount per sticker step. Marketing - affiliate sales, followers,
          channel posts - counts first.
        </p>
        <ul>
          {level.breakdown.map((line) => (
            <li key={line.label} className={line.xp < 0 ? 'is-minus' : ''}>
              <span>{line.label}<small className="faint"> · {line.detail}</small></span>
              <b>{line.xp > 0 ? '+' : ''}{line.xp}</b>
            </li>
          ))}
        </ul>
      </details>
      {open && <StickerSheet sticker={open} whose="theirs" onClose={() => setOpen(null)} />}
    </section>
  );
}

/* ── The shelf ─────────────────────────────────────────────────────────── */

const STAMPS = { sold: 'Sold out', expired: 'Expired' } as const;

export function ShelfCard({ listing, index }: { listing: PublicProfile['listings'][number]; index: number }) {
  const over = listing.state !== 'active';
  return (
    <Link to={`/listing/${listing.id}`} style={{ ['--i' as string]: Math.min(index, 12) }}
      className={`card card--link shelfcard${over ? ' is-over' : ''}${listing.affiliate ? ' is-affiliate' : ''}`}>
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)}>
        <div className="thumb__badges"><span className="badge badge--solid">{listing.condition}</span></div>
        {listing.state !== 'active' && (
          <span className={`stamp stamp--${listing.state}`}><span>{STAMPS[listing.state]}</span></span>
        )}
      </Thumb>
      <div className="listing__body">
        <span className="listing__title">{listing.title}</span>
        <span className="pricerow">
          <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
          {!over && <EarnPill amountMinor={earnOf(listing)} currency={listing.currency} />}
        </span>
        <div className="listing__meta">
          <span className="faint">♥ {listing.likeCount}</span>
          {!over && <span className="faint">{listing.quantityAvailable} left</span>}
        </div>
      </div>
    </Link>
  );
}

/* ── Reviews ───────────────────────────────────────────────────────────── */

/**
 * The reviews behind the one rating: those written after a completed order,
 * with the item beside them, then those left on this page. Read when the tab
 * is opened, not with the page.
 */
export function ReviewsTab({ profile, canWrite, onWritten }: {
  profile: Pick<PublicProfile, 'sellerId' | 'isStore'>;
  canWrite: boolean;
  onWritten?: () => void;
}) {
  const side: PageSide = profile.isStore ? 'store' : 'person';
  const [trade, setTrade] = useState<ReviewsAbout | null>(null);
  const [page, setPage] = useState<PageReviews | null>(null);

  const load = useCallback(() => {
    void api.reviewsAbout(profile.sellerId).then(setTrade).catch(() => setTrade(NO_TRADE));
    void api.pageReviews(profile.sellerId, side).then(setPage).catch(() => setPage({ reviews: [], average: null, count: 0, yours: null }));
  }, [profile.sellerId, side]);
  useEffect(load, [load]);

  const direction = profile.isStore ? 'buyer_to_seller' : 'seller_to_buyer';
  const listed = trade?.reviews.filter((review) => review.direction === direction) ?? [];

  if (!trade || !page) return <SkeletonText lines={4} />;

  return (
    <div className="stack">
      <section className="stack">
        <h3 className="revhead">After orders <span className="badge badge--ok">Verified</span></h3>
        {listed.length === 0 ? (
          <p className="faint">
            No reviews yet{profile.isStore ? ' as a seller' : ' as a buyer'}.
            {trade.pending > 0 && ` ${trade.pending} written and waiting on the other side.`}
          </p>
        ) : (
          <div className="revlist">
            {listed.map((review, i) => (
              <article key={review.id} className="revcard" style={{ ['--i' as string]: i }}>
                <div className="revcard__head">
                  <Avatar name={review.author.name} size={36} />
                  <span className="revcard__who">
                    <PersonLink party={review.author} />
                    <span className="faint">{timeAgo(review.createdAt)}</span>
                  </span>
                  <StarRow value={review.rating} />
                </div>
                {review.body && <p className="revcard__body">{review.body}</p>}
                <div className="revcard__foot">
                  {review.item && (
                    <Link to={`/listing/${review.item.listingId}`} className="revcard__item">
                      <span>{review.item.name}</span>
                      <b>{formatMoney(review.item.totalMinor, review.item.currency)}</b>
                    </Link>
                  )}
                  <ReportButton targetType="review" targetId={review.id} parentId={profile.sellerId}
                    mine={Boolean(review.mine)} moderation={review.moderation} />
                </div>
              </article>
            ))}
            {trade.pending > 0 && <p className="faint">{trade.pending} more hidden until both sides have rated.</p>}
          </div>
        )}
      </section>

      <section className="stack">
        <h3 className="revhead">On this page</h3>
        {canWrite && (
          <PageReviewForm subjectId={profile.sellerId} side={side} existing={page.yours}
            onWritten={() => { load(); onWritten?.(); }} />
        )}
        {page.reviews.length === 0 ? (
          <p className="faint">Nobody has left one here yet.</p>
        ) : (
          <div className="revlist">
            {page.reviews.map((review, i) => (
              <article key={review.id} className="revcard" style={{ ['--i' as string]: i }}>
                <div className="revcard__head">
                  <Avatar name={review.authorName} size={36} />
                  <span className="revcard__who">
                    <span>
                      <PersonLink party={{ name: review.authorName, handle: review.authorHandle }} />
                      {review.mine && <span className="badge" style={{ marginLeft: 8 }}>yours</span>}
                    </span>
                    <span className="faint">{timeAgo(review.createdAt)}</span>
                  </span>
                  <StarRow value={review.rating} />
                </div>
                <p className="revcard__body">{review.body}</p>
                <div className="revcard__foot">
                  <ReportButton targetType="store_review" targetId={review.id} parentId={profile.sellerId}
                    mine={review.mine} moderation={review.moderation} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const NONE = { average: null, count: 0, stars: [] };
const NO_TRADE: ReviewsAbout = { reviews: [], asBuyer: NONE, asSeller: NONE, count: 0, pending: 0 };

/** One per person per page, replaced rather than added to. */
function PageReviewForm({ subjectId, side, existing, onWritten }: {
  subjectId: string;
  side: PageSide;
  existing: number | null;
  onWritten: () => void;
}) {
  const { user, gate } = useSession();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(existing ?? 5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.writePageReview(subjectId, { rating, body: body.trim(), side });
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
      <button className={`btn btn--quiet btn--sm${user ? '' : ' is-locked'}`} style={{ justifySelf: 'start' }}
        onClick={gate(() => setOpen(true), 'Sign in to leave a rating.')}>
        {!user && <span className="lockmark" aria-hidden="true">🔒</span>}
        {existing === null ? '★ Rate this page' : 'Change your rating'}
      </button>
    );
  }

  return (
    <div className="card card--pad stack">
      <div className="field">
        <span>Rating</span>
        <div className="row">
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" className={`starpick${value <= rating ? ' is-on' : ''}`}
              aria-label={`${value} out of 5`} onClick={() => setRating(value)}>★</button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>What you want to say</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
          placeholder={side === 'store' ? 'Quick to reply, packs well, knows the range…' : 'Paid on time, easy to deal with…'} />
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
