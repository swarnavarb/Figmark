import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AFFILIATE_STATUS_LABELS, affiliateCommissionMinor, affiliateStatus, affiliateUnitMinor } from '@shared/affiliate';
import type { Order } from '@shared/models';
import { ApiRequestError, api, type FeedListing, type PartyRef } from '../api';
import { formatMoney } from '../format';
import { useSession } from '../session';
import { Svg } from './ListingBlocks';
import { LevelChip, Thumb, leadPhoto } from './ui';

/** What sharing a listing pays per sale, in paise; zero when it pays nothing. */
export function earnOf(listing: { affiliate?: { amountMinor?: number; percent?: number } | null; priceMinor: number }): number {
  return affiliateUnitMinor(listing.affiliate, listing.priceMinor);
}

/**
 * Who sent the buyer here, shown quietly and locked.
 *
 * A fact about the sale rather than a choice: the buyer cannot change it, and
 * it does not change what they pay, so it sits small under the button with a
 * lock rather than as a field.
 */
export function ReferredBy({ party, offLabel, className = '' }: {
  party: PartyRef;
  /** The discount their link gives, already formatted, when the shop offers one. */
  offLabel?: string | null;
  className?: string;
}) {
  const who = party.handle ? `@${party.handle}` : party.name;
  return (
    <p className={`refby${offLabel ? ' refby--off' : ''} ${className}`}
      title={offLabel ? `Set by the link you followed. It takes ${offLabel} off each one.` : 'Set by the link you followed. It does not change your price.'}>
      <span className="refby__lock" aria-hidden="true">{offLabel ? '🎁' : '🔒'}</span>
      {offLabel
        ? <span><b>{offLabel} off</b> with {who}'s link</span>
        : <span>Referred by <b>{who}</b></span>}
    </p>
  );
}

/**
 * Share and earn: the reader's own short link to this item, and what it pays.
 *
 * The link is a seven-character code made by the server the first time they
 * share, so there is nothing in it to edit or trim. A guest sees the offer and
 * is asked to sign in when they reach for it.
 */
export function AffiliateCard({ listingId, amountMinor, offMinor = 0, currency, canShare, isOwn, onShare }: {
  listingId: string;
  amountMinor: number;
  /** What a buyer through a link saves per unit, in paise. */
  offMinor?: number;
  currency: string;
  canShare: boolean;
  isOwn: boolean;
  /** Open the share sheet instead of copying the bare link: the picture, WhatsApp and the rest. */
  onShare?: () => void;
}) {
  const { gate } = useSession();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const earn = formatMoney(amountMinor, currency);
  const off = offMinor > 0 ? formatMoney(offMinor, currency) : null;

  if (isOwn) {
    return (
      <section className="affcard affcard--own rise">
        <span className="affcard__icon" aria-hidden="true">🤝</span>
        <div className="affcard__text">
          <b>Affiliate on · {earn} per sale{off ? ` · ${off} off for buyers` : ''}</b>
          <span>
            Anyone who shares this item earns {earn} for every unit their link sells. You pay it once the item is delivered.
            {off && ` Buyers who come through a link pay ${off} less.`}
          </span>
        </div>
      </section>
    );
  }

  async function share() {
    setBusy(true);
    setProblem(null);
    let url: string;
    try {
      url = `${window.location.origin}${(await api.affiliateLink(listingId)).path}`;
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'Could not make your link.');
      setBusy(false);
      return;
    }
    setBusy(false);
    setShown(url);
    // The phone's own share sheet where there is one; the clipboard otherwise.
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ url, title: 'Have a look at this on Figmark' });
        return;
      } catch {
        /* cancelled - fall through to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the link is on screen to copy by hand */
    }
  }

  return (
    <section className="affcard rise">
      <span className="affcard__icon" aria-hidden="true">💸</span>
      <div className="affcard__text">
        <b>Earn {earn} per sale{off ? ` · friends save ${off}` : ''}</b>
        <span>
          Share your own link. Whenever somebody buys through it, {earn} goes to your wallet once it is delivered.
          {off && ` Your link takes ${off} off for them - it is on the picture you share.`}
        </span>
        {shown && <code className="affcard__url">{shown}</code>}
        {problem && <span className="affcard__problem">{problem}</span>}
      </div>
      <button type="button" className={`btn btn--sm affcard__btn${canShare ? '' : ' is-locked'}`} disabled={busy}
        onClick={gate(() => (onShare ? onShare() : share()), 'Sign in to get your own link and earn from sharing it.')}>
        {!canShare && <span className="lockmark" aria-hidden="true">🔒</span>}
        {busy ? 'Making your link…' : copied ? '✓ Link copied' : '🔗 Share & earn'}
      </button>
    </section>
  );
}

/**
 * "Earn ₹50", beside the price on a thumbnail: buying through somebody's link
 * pays them, and sharing it pays you. Its border runs round it, so it reads
 * as an offer rather than another fact about the item.
 */
export function EarnPill({ amountMinor, currency = 'INR', bare }: { amountMinor: number; currency?: string; bare?: boolean }) {
  if (amountMinor <= 0) return null;
  return (
    <span className="earnpill" title={`Share it and earn ${formatMoney(amountMinor, currency)} per sale`}>
      <span className="earnpill__text">{bare ? '' : '💸 '}Earn {formatMoney(amountMinor, currency)}</span>
    </span>
  );
}

/**
 * More like this, under the item: same category first, then shared tags,
 * then the same shop. A shelf that scrolls sideways, so it never pushes the
 * comments further than one row down.
 */
export function SimilarItems({ listingId }: { listingId: string }) {
  const [items, setItems] = useState<FeedListing[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    void api.similar(listingId)
      .then((result) => !cancelled && setItems(result.listings))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (items && items.length === 0) return null;

  return (
    <section className="similar" aria-label="Similar items">
      <header className="similar__head">
        <span className="similar__icon" aria-hidden="true"><Svg name="star" size={16} /></span>
        <span className="similar__titles">
          <h2>You might also like</h2>
          <small>Picked for being like this one</small>
        </span>
      </header>
      <div className="similar__track">
        {items === null
          ? Array.from({ length: 4 }, (_, n) => <span key={n} className="simcard simcard--ghost" aria-hidden="true" />)
          : items.map((item, n) => (
            <Link key={item.id} to={`/listing/${item.id}`} className={`simcard${item.affiliate ? ' is-affiliate' : ''}`}
              style={{ ['--i' as string]: n }}>
              <Thumb seed={item.id} label={item.title} photo={leadPhoto(item)} className="thumb simcard__photo" />
              <span className="simcard__body">
                <span className="simcard__title">{item.title}</span>
                <span className="pricerow">
                  <b className="simcard__price">{formatMoney(item.priceMinor, item.currency)}</b>
                  <EarnPill amountMinor={earnOf(item)} currency={item.currency} />
                </span>
                <small className="simcard__shop">{item.seller?.storefrontName ?? item.category}<LevelChip tag={item.seller?.level} inline /></small>
              </span>
            </Link>
          ))}
      </div>
    </section>
  );
}

/**
 * The shop's side of a referred sale: who brought the buyer, what that
 * earns them, and - once the item is delivered - a way to say it was paid.
 */
export function AffiliateOwed({ order, onDone }: { order: Order; onDone: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!order.affiliate) return null;
  const status = affiliateStatus(order);
  const who = order.affiliate.referrerHandle ? `@${order.affiliate.referrerHandle}` : order.affiliate.referrerName;

  async function markPaid() {
    const reference = window.prompt(`Paid ${who} their commission? Add a payment reference if you have one.`, '');
    if (reference === null) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.markAffiliatePaid(order.id, reference);
      await onDone();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="affowed">
      <span>
        🤝 <b>{who}</b> referred this buyer · commission{' '}
        <b>{formatMoney(affiliateCommissionMinor(order), order.currency)}</b>
        {' '}<span className={`badge ${status === 'earned' ? 'badge--lime' : status === 'paid' ? 'badge--ok' : status === 'void' ? 'badge--danger' : 'badge--warn'}`}>
          {status === 'earned' ? 'Owed now' : AFFILIATE_STATUS_LABELS[status]}
        </span>
      </span>
      {status === 'earned' && (
        <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void markPaid()}>
          {busy ? 'Saving…' : 'Mark commission paid'}
        </button>
      )}
      {problem && <p className="notice notice--error">{problem}</p>}
    </div>
  );
}
