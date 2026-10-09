import { ReportButton } from '../components/ReportButton';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api, type ListingDetail, type PreOrderRoster } from '../api';
import { Avatar, ErrorNotice, Icon, PersonLink, Thumb } from '../components/ui';
import { SkeletonText } from '../components/Feedback';
import { useSave } from '../components/useSave';
import { Canopy, DetailBlocks, Gallery, Svg, Urgency } from '../components/ListingBlocks';
import { ListingPosts } from '../components/ListingPosts';
import { Glyph, RarityRibbon } from '../components/Quest';
import { BumpHelp, InfoTip, useBump } from '../components/QuestKit';
import { listingRarity } from '@shared/quest';
import { FillBlock } from '../components/FillMeter';
import { brandHueFor, formatDate, formatMoney, timeAgo } from '../format';
import { useSession } from '../session';
import { isExpired, isMultiple } from '@shared/payments';
import { EditListingDialog, StockChip } from '../components/Buy';
import { AffiliateCard, ReferredBy, SimilarItems } from '../components/Affiliate';
import { AFFILIATE_PARAM } from '@shared/affiliate';
import { shopBadge, useShareSheet, type ShareSpec } from '../components/ShareKit';
import { themeOf } from '../components/momentCard';

/** What each verification tier means, in a line. */
const TIER_NOTES: Record<string, string> = {
  unverified: 'Not verified yet',
  verified: 'ID, phone and bank checked',
  pro: 'Registered business, deposit held',
};

export function ListingPage() {
  const { id = '' } = useParams();
  const { user, gate } = useSession();
  const navigate = useNavigate();
  const bumpItem = useBump();
  const location = useLocation();
  // Anything here a guest reaches for opens the sign-in popup; they stay on this item.
  const lock = user ? '' : ' is-locked';
  const lockMark = user ? null : <span className="lockmark" aria-hidden="true">🔒</span>;
  // Who sent them here, if anybody. Carried into the pledge and the order so
  // whoever recruited them is credited for it - the only thing that makes
  // sharing a group-buy worth a person's own reputation.
  const [params] = useSearchParams();
  const via = params.get('via');
  // Arrived from a post's Buy button: the post gets the credit for the sale.
  const fromPost = (() => {
    const [channelId, postId] = (params.get('post') ?? '').split(':');
    return channelId && postId ? { channelId, postId } : null;
  })();
  // An affiliate's signed link. The server checks it and remembers it against
  // this account, so it is passed through rather than trusted here.
  const ref = params.get(AFFILIATE_PARAM);

  const [data, setData] = useState<ListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the last press said, and whether it went through. */
  const [action, setAction] = useState<{ text: string; ok: boolean } | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setAction(null);
    setQuantity(1);
    void api
      .listing(id, ref)
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id, ref]);

  const onSaved = useCallback((liked: boolean) => setData((prev) => (prev ? { ...prev, liked } : prev)), []);
  const [liked, toggleLike] = useSave(id, data?.liked ?? false, onSaved);
  const shareSheet = useShareSheet();

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) {
    return (
      <main className="page lp" role="status" aria-label="Loading the item">
        <div className="detail">
          <div>
            <div className="skel skel-thumb" style={{ borderRadius: 18 }} />
            <div style={{ marginTop: 18 }}><SkeletonText lines={5} /></div>
          </div>
        </div>
      </main>
    );
  }

  const { listing, seller, comments } = data;
  // The primary photo first, then the rest in the order they were added.
  const rarity = listingRarity(listing);
  const photos = [...(listing.photos ?? [])]
    .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)))
    .map((photo) => photo.url)
    .filter((url): url is string => Boolean(url));

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setAction(null);
    try {
      await fn();
      if (label) setAction({ text: label, ok: true });
    } catch (err) {
      setAction({ text: err instanceof ApiRequestError ? err.message : 'Something went wrong.', ok: false });
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
      const placed = await api.order(listing.id, quantity, via, ref, fromPost);
      navigate(`/order/${placed.order.id}`);
    });

  const toggleFollow = () =>
    run('', async () => {
      if (!seller) return;
      const result = await api.follow(seller.id);
      setData((prev) => (prev ? { ...prev, following: result.following } : prev));
    });

  // Spends a bump point; with none left, useBump goes to the quests that earn them.
  const bump = () =>
    run('', async () => {
      const result = await bumpItem(listing);
      if (result) setAction({ text: `Bumped to the top of the feed. ${result.bumps} bump point${result.bumps === 1 ? '' : 's'} left.`, ok: true });
    });

  const shareSpec = listingShareSpec(data);
  // A link that takes money off is the price this reader pays.
  const linkOff = data.affiliate?.referredBy && !data.isOwn ? data.affiliate.buyerOffMinor ?? 0 : 0;

  // A pre-order books one place at a time; anything else up to what is left.
  const maxQuantity = listing.preOrder ? 1 : isMultiple(listing) ? 20 : Math.min(20, listing.quantityAvailable);

  const buyBox = (
    <div className="buybox rise" style={{ ['--i' as string]: 1 }}>
      <div className="buybox__top">
        {linkOff > 0 ? (
          <span className="buybox__price">
            {formatMoney(Math.max(100, listing.priceMinor - linkOff), listing.currency)}{' '}
            <s className="buybox__was">{formatMoney(listing.priceMinor, listing.currency)}</s>
          </span>
        ) : <span className="buybox__price">{formatMoney(listing.priceMinor, listing.currency)}</span>}
        {isMultiple(listing) || listing.quantityAvailable > 0
          ? <StockChip listing={listing} />
          : <span className="badge badge--danger">Sold out</span>}
      </div>
      {listing.advancePercent ? (
        <p className="buybox__adv">
          <Svg name="coin" size={15} /> Book with{' '}
          <b>{formatMoney(Math.round(listing.priceMinor * listing.advancePercent / 100), listing.currency)}</b>{' '}
          ({listing.advancePercent}%) now, the rest later
        </p>
      ) : null}

      {action && <p className={`notice ${action.ok ? 'notice--ok' : 'notice--error'}`}>{action.text}</p>}

      {data.isOwn ? (
        <div className="buybox__acts">
          <button className="btn buybox__buy" onClick={() => setEditing(true)}>
            {isExpired(listing) ? 'Make available again' : 'Edit, quantity or delete'}
          </button>
          <span className="buybox__bump">
            <button className="btn btn--ghost" onClick={() => void bump()} disabled={busy}>
              <Glyph name="bolt" size={14} /> Bump
            </button>
            <InfoTip label="What Bump does"><BumpHelp /></InfoTip>
          </span>
        </div>
      ) : isExpired(listing) ? (
        <p className="notice notice--warn">This item has expired and can no longer be bought.</p>
      ) : (
        <div className="buybox__acts">
          {/* More than one to be had: how many, before the checkout opens. */}
          {maxQuantity > 1 && (
            <span className="qtystep" role="group" aria-label="Quantity">
              <button type="button" onClick={() => setQuantity((n) => Math.max(1, n - 1))}
                disabled={busy || quantity <= 1} aria-label="One fewer">−</button>
              <b aria-live="polite">{quantity}</b>
              <button type="button" onClick={() => setQuantity((n) => Math.min(maxQuantity, n + 1))}
                disabled={busy || quantity >= maxQuantity} aria-label="One more">+</button>
            </span>
          )}
          {/* No purchase on an expired item. The server refuses it too. */}
          <button className={`btn btn--lg buybox__buy${lock}`} onClick={gate(() => buy(), 'Sign in to buy this item.')}
            disabled={busy || (!isMultiple(listing) && listing.quantityAvailable === 0)}>
            {busy ? <span className="buybox__opening">Opening checkout</span> : <>{lockMark}{listing.preOrder ? 'Book a place' : 'Buy now'}</>}
          </button>
          <button className={`btn btn--ghost buybox__save${liked ? ' is-on' : ''}${lock}`} aria-label={liked ? 'Saved' : 'Save'}
            aria-pressed={liked} onClick={gate(() => void toggleLike(), 'Sign in to save items.')} disabled={busy}>
            <Icon name="heart" size={18} />
          </button>
        </div>
      )}
      {/* A question, a bargain, "is it still there" - asked with the item
          attached, so the shop knows exactly which one. */}
      {!data.isOwn && seller?.username && (
        <Link to={`/messages/${encodeURIComponent(seller.username)}?about=${encodeURIComponent(listing.id)}`}
          className={`buybox__ask${lock}`} onClick={gate(() => undefined, 'Sign in to message the shop.')}>
          <Icon name="message" size={15} /> Message about this item
          <small>Ask a question or make an offer</small>
        </Link>
      )}
      <p className="buybox__fine">
        {!user && !data.isOwn ? '🔒 Sign in to buy or save. ' : ''}Nothing is charged yet — you choose how to pay on the next screen.
      </p>
      {data.affiliate?.referredBy && !data.isOwn && <ReferredBy party={data.affiliate.referredBy}
        offLabel={linkOff > 0 ? formatMoney(linkOff, listing.currency) : null} />}
    </div>
  );

  return (
    <main className="page lp">
      {/* Back to where they were - filters, search and scroll - when they came
          from inside the app; a link opened cold goes to the catalogue. */}
      <Link to="/" className="btn btn--quiet lp__back" onClick={(event) => {
        if (location.key === 'default') return;
        event.preventDefault();
        navigate(-1);
      }}>
        <Icon name="back" size={14} /> Back to browse
      </Link>

      <div className="detail">
        <div>
          <Gallery photos={photos} title={listing.title}
            fallback={<Thumb seed={listing.id} label={listing.title} className="thumb gallery__fallback" />}>
            <span className="gallery__badges">
              {rarity.tier && <RarityRibbon tier={rarity.tier} />}
              <span className="badge badge--solid">{listing.condition}</span>
              {listing.preOrder && <span className="badge badge--accent">Pre-order</span>}
            </span>
          </Gallery>

          <div className="detail__section rise" style={{ marginTop: 18, ['--i' as string]: 1 }}>
            <h1 className="lp__title">{listing.title}</h1>
            {listing.privateFor && (
              <div className="lp__private">
                <span className="lp__privateicon" aria-hidden="true">🤝</span>
                <span>
                  <b>Private deal{user?.id === listing.privateFor ? ' - made just for you' : ''}</b>
                  <small>
                    {user?.id === listing.privateFor
                      ? 'Only you can see or buy this, at this price, until the clock runs out. It cannot be shared.'
                      : 'Only your buyer can see this. It is never in your shop, the feed or anyone\'s share links.'}
                  </small>
                </span>
              </div>
            )}
            <Urgency listing={listing} />
            {buyBox}
            {/* A price made for one buyer is not a price to pass round. */}
            {/* With a commission on, the affiliate card is the share block; two would say the same thing twice. */}
            {!listing.privateFor && !data.affiliate && <ListingShare spec={shareSpec} onOpen={() => shareSheet.open(shareSpec)} />}
            {data.affiliate && !listing.privateFor && (
              <AffiliateCard listingId={listing.id} amountMinor={data.affiliate.amountMinor} offMinor={data.affiliate.buyerOffMinor}
                canShare={data.affiliate.canShare} currency={listing.currency} isOwn={data.isOwn}
                onShare={() => shareSheet.open(shareSpec)} />
            )}
            {shareSheet.sheet}
            <DetailBlocks listing={listing} />
            <div className="lp__about">
              <span className="dtile__label">About this item · listed {timeAgo(listing.createdAt)}</span>
              <p>{listing.description}</p>
              {/* Each tag is a search: tapping one shows everything else tagged
                  the same. Inside the card, so they get its padding below too. */}
              {listing.tags.length > 0 && (
                <div className="hashtags">
                  {listing.tags.map((tag, n) => (
                    <Link key={tag} to={`/?q=${encodeURIComponent(tag)}`} className="hashtag" style={{ ['--i' as string]: n }}>
                      <span className="hashtag__hash">#</span>{tag}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {data.preOrder && (
            <PreOrderPanel
              listingId={listing.id}
              roster={data.preOrder}
              estimatedDispatchAt={data.estimatedDispatchAt}
              canJoin={!data.isOwn}
              meId={user?.id ?? null}
              via={via}
              onChange={(roster) => setData((prev) => (prev ? { ...prev, preOrder: roster } : prev))}
            />
          )}

          <ListingPosts listingId={listing.id} sellerId={listing.sellerId} posts={comments}
            onChange={(posts) => setData((prev) => (prev ? { ...prev, comments: posts } : prev))} />
        </div>

        {/* ── Purchase rail ── */}
        <aside className="stack lp__rail">
          {seller && (
            <div className={`lp__seller sellercard storefront__cover--${brandHueFor(seller.username ?? seller.storefrontName)} rise`}
              style={{ ['--i' as string]: 2 }}>
              {/* The shop's own cover runs from the top of the card down to the
                  bottom edge of its photo, under the same awning its shop page
                  hangs out, so a seller looks like themselves everywhere. */}
              <div className={`sellercard__hero${seller.coverUrl ? ' has-cover' : ''}`}
                style={seller.coverUrl ? { ['--cover' as string]: `url("${seller.coverUrl.replace(/"/g, '%22')}")` } : undefined}>
              <div className="sellercard__awning"><Canopy stripes={10} /></div>
              <div className="sellercard__sign">
                <span className="sellercard__avatar">
                  {seller.photoUrl ? <img src={seller.photoUrl} alt="" /> : <Avatar name={seller.storefrontName} size={64} />}
                </span>
                <div className="sellercard__who">
                  <span className="dtile__label">Posted by</span>
                  {/* The shop's name is its address: tapping it opens its page. */}
                  <PersonLink party={{ name: seller.storefrontName, handle: seller.username, level: seller.level }} className="sellercard__name" />
                  <span className="sellercard__where"><Svg name="pin" size={13} /> {seller.dispatchRegion ?? 'Location not set'}</span>
                </div>
                <span className="sellercard__tier" title={TIER_NOTES[seller.tier] ?? 'Verification level'}>
                  <Svg name="shield" size={13} /> {seller.tier}
                </span>
              </div>
              </div>

              <dl className="sellercard__stats">
                <div className={`sellercard__stat sellercard__stat--${seller.trustScore >= 80 ? 'ok' : seller.trustScore >= 50 ? 'warn' : 'low'}`}>
                  <dt><Svg name="star" size={13} /> Trust</dt>
                  <dd>{seller.trustScore}<small>/100</small></dd>
                  <span>From buyer reviews</span>
                </div>
                <div className="sellercard__stat">
                  <dt><Svg name="users" size={13} /> Followers</dt>
                  <dd>{seller.followerCount}</dd>
                  <span>Get their new drops</span>
                </div>
                <div className="sellercard__stat">
                  <dt><Svg name="box" size={13} /> Sales</dt>
                  <dd>{seller.completedSales}</dd>
                  <span>Delivered, no lost disputes</span>
                </div>
                <div className="sellercard__stat">
                  <dt><Svg name="calendar" size={13} /> Here since</dt>
                  <dd>{new Date(seller.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</dd>
                  <span>On Figmark</span>
                </div>
              </dl>

              {!data.isOwn && (
                <div className="sellercard__acts">
                  <button className={`btn btn--sm ${data.following ? 'btn--ghost' : ''}${lock}`}
                    onClick={gate(() => toggleFollow(), 'Sign in to follow shops.')} disabled={busy}>
                    {data.following ? <><Icon name="check" size={14} /> Following</> : <>{lockMark}Follow</>}
                  </button>
                  {/* A question about an item is asked of the shop, not of whoever
                      happens to own it — so the message goes to the shop's handle. */}
                  {seller.username && (
                    <Link to={`/messages/${encodeURIComponent(seller.username)}?about=${encodeURIComponent(listing.id)}`} className={`btn btn--ghost btn--sm${lock}`}
                      onClick={gate(() => undefined, 'Sign in to message the shop.')}>
                      {lockMark ?? <Icon name="message" size={14} />} Message
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      <SimilarItems listingId={listing.id} />
      {editing && (
        <EditListingDialog listing={listing} onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            if (!saved) navigate('/shop');
            else setData((prev) => (prev ? { ...prev, listing: { ...prev.listing, ...saved } } : prev));
          }} />
      )}
    </main>
  );
}

/**
 * Demand pooling, as the buyer sees it - and as a group rather than a bar.
 *
 * Says nothing about shipment lots: which consignment this rides in, who
 * else is in it and where it currently sits are the seller's business. What a
 * buyer needs is how close this is to going ahead, who else is in, when booking
 * closes, and roughly when it ships.
 *
 * The free step is deliberately first and deliberately smaller than the paid
 * one. Somebody who pledges has told the seller something true at no cost to
 * themselves; somebody who is asked to pay into a lot that may never happen
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
  const { user, gate } = useSession();

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
    // are recommending. Recruiting for a lot you would not join yourself is
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
    <section className="pocard rise" style={{ ['--i' as string]: 2 }}>
      <div className="pocard__head">
        <FillRing done={view.committed} of={view.fillThreshold} />
        <div className="pocard__what">
          <span className="pocard__eyebrow"><Svg name="users" size={13} /> Group pre-order</span>
          <b className="pocard__title">{view.committed} of {view.fillThreshold} joined</b>
          <span className="faint">
            {view.committed >= view.fillThreshold ? 'Filled' : `${view.fillThreshold - view.committed} more to go`}
          </span>
        </div>
        <span className={`badge badge--${badge.tone}`}>{badge.label}</span>
      </div>

      <FillBlock view={view} people={roster.people} unlisted={roster.unlisted} />

      <p className="pocard__note">
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
            called in for payment — within a day — the moment it fills. Nobody pays for a lot that
            does not happen.
          </>
        )}
      </p>

      {problem && <p className="notice notice--error">{problem}</p>}

      {canJoin && open && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <button className={`btn${mine?.pledged ? ' btn--ghost' : ''}${user ? '' : ' is-locked'}`} style={{ flex: 1 }}
              onClick={gate(() => change(), 'Sign in to join this pre-order.')} disabled={busy}>
              {!user && <span className="lockmark" aria-hidden="true">🔒</span>}
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

/** How full the group buy is, as a ring that fills in when it arrives. */
function FillRing({ done, of }: { done: number; of: number }) {
  const share = of > 0 ? Math.min(1, done / of) : 0;
  const c = 2 * Math.PI * 26;
  return (
    <span className="fillring" aria-hidden="true">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="26" className="fillring__track" />
        <circle cx="32" cy="32" r="26" className="fillring__bar" strokeDasharray={c}
          style={{ ['--from' as string]: c, strokeDashoffset: c * (1 - share) }} />
      </svg>
      <b>{Math.round(share * 100)}%</b>
    </span>
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


/**
 * The item as a picture to share. A pre-order still filling asks for help
 * filling it - the reason a friend would open it; the shop's own item reads
 * as a new drop; anything else as a find. When the shop gives buyers money
 * off through a link, the sharer's picture and message lead with it.
 */
function listingShareSpec(data: ListingDetail): ShareSpec {
  const { listing, seller } = data;
  const lead = [...(listing.photos ?? [])].sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)))[0]?.url ?? null;
  const pre = listing.preOrder && listing.preOrder.fillThreshold > 0 ? listing.preOrder : null;
  const joined = pre ? Math.min(pre.fillThreshold, pre.filledCount + (pre.pledgedCount ?? 0)) : 0;
  const left = pre ? pre.fillThreshold - joined : 0;
  const filling = Boolean(pre && left > 0);
  const shop = seller?.storefrontName ?? 'Figmark';
  const price = formatMoney(listing.priceMinor, listing.currency);
  // Only a sharer's own affiliate link takes money off; the shop sharing its own item sends a plain one.
  const viaLink = Boolean(data.affiliate?.canShare) && !data.isOwn;
  const off = viaLink && data.affiliate?.buyerOffMinor ? formatMoney(data.affiliate.buyerOffMinor, listing.currency) : null;
  const caption = filling
    ? `${left} spot${left === 1 ? '' : 's'} left in this pre-order: ${listing.title} at ${price}. It ships when it fills 👇`
    : data.isOwn ? `New drop: ${listing.title} at ${price} 🔥` : `Found this on Figmark: ${listing.title} at ${price} ✨`;
  return {
    kind: filling ? 'fill' : 'item',
    moment: {
      photo: lead,
      title: listing.title,
      detail: pre ? 'Pre-order · Buyer Protection' : 'Buyer Protection on Figmark',
      price,
      fill: pre ? { joined, threshold: pre.fillThreshold } : null,
      headline: filling ? 'Help fill this pre-order' : data.isOwn ? 'New drop' : off ? 'Grab this with me' : 'Look what I found',
      discount: off,
      deal: off && data.affiliate?.buyerOffMinor ? formatMoney(Math.max(100, listing.priceMinor - data.affiliate.buyerOffMinor), listing.currency) : null,
      seed: listing.id,
      badge: shopBadge(seller, shop),
    },
    link: { to: 'item', listingId: listing.id, moment: filling ? 'fill' : undefined, affiliate: viaLink, own: data.isOwn },
    caption: off ? `🎁 Get ${off} off with my link! ${caption}` : caption,
    target: listing.id,
    storeId: data.isOwn ? listing.sellerId : null,
  };
}

/** A share bar under the buy box: WhatsApp-first, because that is where pre-orders fill. */
function ListingShare({ spec, onOpen }: { spec: ShareSpec; onOpen: () => void }) {
  const theme = themeOf(spec.kind);
  const filling = spec.kind === 'fill';
  return (
    <button type="button" className={`lshare${filling ? ' lshare--fill' : ''}`} onClick={onOpen}
      style={{ ['--lshare-from' as string]: theme.from, ['--lshare-to' as string]: theme.to }}>
      <span className="lshare__icon" aria-hidden="true">{filling ? '⏳' : '📣'}</span>
      <span className="lshare__text">
        <b>{filling ? `${spotsLeft(spec)} left - help fill it` : 'Share this'}</b>
        <small>{filling ? 'Send it to a WhatsApp group - friends who join fill it faster.' : 'A picture for your Status or story, or straight to WhatsApp.'}</small>
      </span>
      <span className="lshare__go">Share</span>
    </button>
  );
}

function spotsLeft(spec: ShareSpec): string {
  const left = spec.moment.fill ? spec.moment.fill.threshold - spec.moment.fill.joined : 0;
  return `${left} spot${left === 1 ? '' : 's'}`;
}
