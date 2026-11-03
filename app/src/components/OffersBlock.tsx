import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { STAMPS } from '@shared/loyalty';
import {
  nextStepFor, offerLabel, offerSummary, offerTerms, type ListingOffer, type OfferKind,
} from '@shared/offers';
import { api, type Checkout, type ShopLoyalty } from '../api';
import type { Order } from '@shared/models';
import { formatMoney } from '../format';
import { useSession } from '../session';
import { CheckoutLoyalty, LoyaltyHow, StampCard, StampDots, nextLine } from './LoyaltyCard';
import { PriceBreakdown } from './Offers';
import { Modal } from './ui';
import '../styles/OffersBlock.css';

/**
 * Every offer on an item and the shop's loyalty card, in one block: a line
 * each, short, and "More" for the rest. The details, the terms and the
 * buyer's own card open in one sheet.
 */

const ICON: Record<OfferKind, string> = {
  free_shipping: '🚚', spend_free_shipping: '🚚', discount: '🏷️', bundle: '🧺', wholesale: '📦', early_bird: '🐦',
  group_fill: '👥', buy_x_get_y: '🎁', repeat_buyer: '🔁', first_order: '👋', prepay: '💳',
};

/** Offers that apply by themselves when more goes in the same lot or the same basket. */
const GROWS = new Set<OfferKind>(['free_shipping', 'discount', 'spend_free_shipping', 'bundle', 'buy_x_get_y', 'wholesale']);

type Card = ShopLoyalty['cards'][number];

function useShopLoyalty(ownerId: string, listingId?: string): ShopLoyalty | null {
  const { user } = useSession();
  const [data, setData] = useState<ShopLoyalty | null>(null);
  useEffect(() => {
    let live = true;
    api.shopLoyalty(ownerId, listingId).then((body) => live && setData(body)).catch(() => undefined);
    return () => { live = false; };
  }, [ownerId, listingId, user?.id]);
  return data && data.live && data.cards.length > 0 ? data : null;
}

/** The short line under an offer: what it takes from here, or that it is on. */
function hintFor(offer: ListingOffer, quantity: number, priceMinor: number, short = false): string | null {
  const next = nextStepFor(offer, { items: quantity, spendMinor: priceMinor * quantity });
  if (next && short) return next.replace(/^Add (\d+) more items? .*$/, 'Add $1 more').replace(/^Spend (\S+) more.*$/, '$1 more');
  if (next) return next.replace(' with this shop to get this.', ' with this shop').replace(' to get this.', '');
  if (offer.kind === 'bundle' || offer.kind === 'buy_x_get_y') {
    const need = (offer.minItems ?? 2) - quantity;
    return need > 0 ? `Add ${need} more` : null;
  }
  return null;
}

export function OffersBlock({ offers = [], priceMinor, currency, quantity, sellerId, listingId }: {
  offers?: ListingOffer[]; priceMinor: number; currency: string; quantity: number; sellerId: string; listingId: string;
}) {
  const { user } = useSession();
  const loyalty = useShopLoyalty(sellerId, listingId);
  const [open, setOpen] = useState<string | null>(null);
  if (offers.length === 0 && !loyalty) return null;
  const shown = offers.slice(0, 2);
  const card = loyalty?.cards[0];
  const mine = user?.id === sellerId;
  const count = offers.length + (loyalty?.cards.length ?? 0);

  return (
    <section className="dealsblk" aria-label="Offers">
      <button type="button" className="dealsblk__head" onClick={() => setOpen('top')}>
        <span className="dealsblk__badge" aria-hidden="true">%</span>
        <span className="dealsblk__title">
          <b>Offers</b>
          <small>{[offers.length ? `${offers.length} on this item` : null, loyalty ? 'loyalty card' : null].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="dealsblk__more">{count > 1 ? 'More' : 'Details'} <span aria-hidden="true">›</span></span>
      </button>

      {shown.length > 0 && (
        <ul className="dealsblk__lines">
          {shown.map((offer, index) => {
            const hint = hintFor(offer, quantity, priceMinor, true);
            return (
              <li key={offer.id} style={{ '--i': index } as CSSProperties}>
                <button type="button" className="dealsblk__line" onClick={() => setOpen(offer.id)}>
                  <span className="dealsblk__icon" aria-hidden="true">{ICON[offer.kind]}</span>
                  <span className="dealsblk__label">{offerLabel(offer)}</span>
                  {hint && <span className="dealsblk__hint">{hint}</span>}
                </button>
              </li>
            );
          })}
          {offers.length > shown.length && (
            <li><button type="button" className="dealsblk__extra" onClick={() => setOpen('top')}>+{offers.length - shown.length} more</button></li>
          )}
        </ul>
      )}

      {card && (
        <button type="button" className="dealsblk__loyal" onClick={() => setOpen('loyalty')}>
          <StampDots theme={card.card.theme} stamps={card.stamps} />
          <span className="dealsblk__loyaltext">
            <b>{card.card.name}</b>
            <small>
              {mine ? 'Your buyers see their card here'
                : !card.signedIn ? 'A stamp for every item you buy'
                  : `${card.stamps}/${STAMPS} · ${nextLine(card.stamps, card.next, card.waiting)}`}
            </small>
          </span>
        </button>
      )}

      {open && (
        <DealsSheet offers={offers} priceMinor={priceMinor} currency={currency} quantity={quantity}
          loyalty={loyalty} mine={mine} focus={open} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

/**
 * Everything in one sheet: each offer with what it takes and its terms, then
 * the buyer's own loyalty card, stamped in as it opens.
 */
export function DealsSheet({ offers, priceMinor, currency, quantity, loyalty, mine = false, focus, onClose }: {
  offers: ListingOffer[]; priceMinor: number; currency: string; quantity: number;
  loyalty: ShopLoyalty | null; mine?: boolean; focus?: string; onClose: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus || focus === 'top') return;
    const target = body.current?.querySelector<HTMLElement>(`[data-ditem="${CSS.escape(focus)}"]`);
    if (target) setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  }, [focus]);
  const grows = offers.some((offer) => GROWS.has(offer.kind));

  return (
    <Modal title="Offers & rewards" onClose={onClose} layout="panel">
      <div className="dsheet" ref={body}>
        {offers.length > 0 && (
          <section className="dsheet__group">
            {grows && (
              <p className="dsheet__auto">
                <span aria-hidden="true">✨</span> Offers apply on their own. Add more to the same lot and the price drops at checkout.
              </p>
            )}
            <ul className="dsheet__list">
              {offers.map((offer, index) => {
                const hint = hintFor(offer, quantity, priceMinor);
                return (
                  <li key={offer.id} data-ditem={offer.id} className={`ditem${focus === offer.id ? ' is-focus' : ''}`}
                    style={{ '--i': index } as CSSProperties}>
                    <div className="ditem__head">
                      <span className="ditem__icon" aria-hidden="true">{ICON[offer.kind]}</span>
                      <span className="ditem__titles">
                        <b className="ditem__name">{offerLabel(offer)}</b>
                        <span className={`ditem__state${hint ? '' : ' is-on'}`}>{hint ?? '✓ Applies'}</span>
                      </span>
                    </div>
                    <p className="ditem__sum">{offerSummary(offer)}</p>
                    {offer.kind === 'wholesale' && (
                      <table className="ditem__tiers">
                        <thead><tr><th>Buy</th><th>Each</th><th>Save</th></tr></thead>
                        <tbody>
                          {(offer.tiers ?? []).map((tier) => {
                            const each = tier.type === 'price' ? tier.value : Math.round(priceMinor * (100 - tier.value) / 100);
                            return (
                              <tr key={tier.minQty}>
                                <td>{tier.minQty}+</td>
                                <td>{formatMoney(each, currency)}</td>
                                <td>{formatMoney(Math.max(0, priceMinor - each), currency)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <details className="ditem__terms">
                      <summary>Terms &amp; conditions</summary>
                      <ul>{offerTerms(offer).map((line) => <li key={line}>{line}</li>)}</ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {loyalty && (
          <section className="dsheet__group dsheet__loyalty" data-ditem="loyalty" style={{ '--i': offers.length } as CSSProperties}>
            <h3 className="dsheet__h">{mine ? 'Your loyalty card' : loyalty.cards.length > 1 ? 'Your loyalty cards' : 'Your loyalty card'}</h3>
            {loyalty.cards.map((row: Card) => (
              <StampCard key={row.card.id} animate name={row.card.name} shopName={loyalty.shopName ?? ''} theme={row.card.theme}
                rewards={row.card.rewards} stamps={row.stamps} round={Math.floor(row.total / STAMPS) + 1}
                footer={mine ? 'Your buyers see their own card here.'
                  : !row.signedIn ? <>Sign in to collect stamps.</>
                    : (
                      <>
                        {nextLine(row.stamps, row.next, row.waiting)}
                        {row.ready > 0 && <> · <Link to="/wallet?tab=loyalty">{row.ready} reward{row.ready > 1 ? 's' : ''} to use</Link></>}
                      </>
                    )} />
            ))}
            <LoyaltyHow />
            <details className="ditem__terms">
              <summary>Loyalty terms</summary>
              <ul>
                <li>Every item in a delivered order earns one stamp. A cancelled or returned item earns none.</li>
                <li>Cashback is credited to your wallet as store credit at this shop when the order arrives, and comes off your next order here.</li>
                <li>Money off (like 15% off) is taken off the price at checkout of the order that reaches that stamp.</li>
                <li>A free item, free shipping or the shop&apos;s own reward is kept in your wallet until the shop gives it.</li>
                <li>A reward and an offer that give the same thing cannot both be used on one order - you pick at checkout. A reward you skip waits for your next order.</li>
                <li>After 8 stamps a new card starts.{loyalty.cards.some((row) => row.card.minOrderMinor > 0) ? ' Orders under the shop’s minimum do not stamp.' : ''}</li>
              </ul>
            </details>
          </section>
        )}
        <div className="dsheet__acts">
          <button type="button" className="btn" onClick={onClose}>Got it</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The checkout's price and everything that moved it, in one block: goods,
 * shipping, each offer, loyalty money off, any reward this order brings (and
 * the pick when one clashes with an offer) - and one link to every offer's
 * details, its terms and the buyer's own loyalty card.
 */
export function CheckoutDeals({ order, quote, payingFull, onRepriced }: {
  order: Order; quote: Checkout; payingFull: boolean; onRepriced: () => void;
}) {
  const [open, setOpen] = useState(false);
  const loyalty = useShopLoyalty(order.sellerId, order.listingId);
  const rules = quote.offerRules ?? [];
  const hasMore = rules.length > 0 || loyalty !== null;
  return (
    <div className={hasMore || quote.loyalty ? 'ckdeals' : undefined}>
      <PriceBreakdown goodsMinor={quote.goodsMinor ?? quote.itemMinor} shippingMinor={quote.shippingMinor}
        discountMinor={quote.offerDiscountMinor} applied={quote.appliedOffers} rules={rules}
        totalMinor={quote.itemMinor} currency={quote.currency} loyalty={quote.loyaltyApplied}
        prepaySavingMinor={payingFull ? quote.prepaySavingMinor : 0} onTerms={hasMore ? () => setOpen(true) : undefined} />
      {quote.loyalty && <CheckoutLoyalty orderId={order.id} loyalty={quote.loyalty} onChanged={onRepriced} />}
      {hasMore && (
        <button type="button" className="ckdeals__more" onClick={() => setOpen(true)}>
          Offer details, T&amp;Cs{loyalty ? ' & your loyalty card' : ''} <span aria-hidden="true">›</span>
        </button>
      )}
      {open && (
        <DealsSheet offers={rules} priceMinor={order.unitPriceMinor} currency={quote.currency} quantity={order.quantity}
          loyalty={loyalty} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
