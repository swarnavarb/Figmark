import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AFFILIATE_PARAM, AFFILIATE_STATUS_LABELS, affiliateCommissionMinor, affiliateStatus } from '@shared/affiliate';
import type { Order } from '@shared/models';
import { ApiRequestError, api, type FeedListing, type PartyRef } from '../api';
import { formatMoney } from '../format';
import { Svg } from './ListingBlocks';
import { Thumb, leadPhoto } from './ui';

/** The full link to an item that credits whoever shares it. */
export function affiliateUrl(listingId: string, ref: string): string {
  return `${window.location.origin}/listing/${encodeURIComponent(listingId)}?${AFFILIATE_PARAM}=${encodeURIComponent(ref)}`;
}

/**
 * Who sent the buyer here, shown quietly and locked.
 *
 * A fact about the sale rather than a choice: the buyer cannot change it, and
 * it does not change what they pay, so it sits small under the button with a
 * lock rather than as a field.
 */
export function ReferredBy({ party, className = '' }: { party: PartyRef; className?: string }) {
  return (
    <p className={`refby ${className}`} title="Set by the link you followed. It does not change your price.">
      <span className="refby__lock" aria-hidden="true">🔒</span>
      <span>Referred by <b>{party.handle ? `@${party.handle}` : party.name}</b></span>
    </p>
  );
}

/**
 * Share and earn: the reader's own link to this item, and what it pays.
 *
 * The shop sees that the item is on affiliate and at what rate; everybody
 * else gets the link itself. The link is made by the server and signed, so
 * there is nothing here to edit.
 */
export function AffiliateCard({ listingId, percent, refToken, priceMinor, currency, isOwn }: {
  listingId: string;
  percent: number;
  refToken: string | null;
  priceMinor: number;
  currency: string;
  isOwn: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const earn = formatMoney(Math.round((priceMinor * percent) / 100), currency);

  if (isOwn) {
    return (
      <section className="affcard affcard--own rise">
        <span className="affcard__icon" aria-hidden="true">🤝</span>
        <div className="affcard__text">
          <b>Affiliate on · {percent}% commission</b>
          <span>Anyone who shares this item earns {earn} per sale their link brings. You pay it once the item is delivered.</span>
        </div>
      </section>
    );
  }
  if (!refToken) return null;
  const url = affiliateUrl(listingId, refToken);

  async function share() {
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
      setShown(url);
    }
  }

  return (
    <section className="affcard rise">
      <span className="affcard__icon" aria-hidden="true">💸</span>
      <div className="affcard__text">
        <b>Earn {earn} per sale</b>
        <span>Share your own link. Whenever somebody buys through it, {percent}% goes to your wallet once it is delivered.</span>
        {shown && <code className="affcard__url">{shown}</code>}
      </div>
      <button type="button" className="btn btn--sm affcard__btn" onClick={() => void share()}>
        {copied ? '✓ Link copied' : '🔗 Share & earn'}
      </button>
    </section>
  );
}

/** A small mark on a thumbnail: buying or sharing this pays a commission. */
export function AffiliateBadge({ percent }: { percent: number }) {
  return (
    <span className="affbadge" title={`Share it and earn ${percent}% of each sale`}>
      💸 Earn {percent}%
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
              <Thumb seed={item.id} label={item.title} photo={leadPhoto(item)} className="thumb simcard__photo">
                {item.affiliate && <AffiliateBadge percent={item.affiliate.percent} />}
              </Thumb>
              <span className="simcard__body">
                <span className="simcard__title">{item.title}</span>
                <b className="simcard__price">{formatMoney(item.priceMinor, item.currency)}</b>
                <small className="simcard__shop">{item.seller?.storefrontName ?? item.category}</small>
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
        🤝 <b>{who}</b> referred this buyer · {order.affiliate.percent}% commission{' '}
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
