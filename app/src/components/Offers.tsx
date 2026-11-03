import { useState } from 'react';
import {
  OFFER_KIND_INFO, OFFER_KINDS, MAX_OFFERS_PER_ITEM, MAX_WHOLESALE_TIERS, cleanOffers, nextStepFor, offerLabel,
  offerSummary, offerTerms, wholesaleHint,
  type AppliedOffer, type ListingOffer, type OfferKind, type OfferScope, type OfferValue, type WholesaleTier,
} from '@shared/offers';
import { formatMoney } from '../format';
import { InfoTip } from './InfoTip';
import { Modal } from './ui';
import '../styles/Offers.css';

/**
 * Shipping and offers, as a buyer reads them and a seller writes them.
 *
 * Every word on the buyer's side comes from `shared/offers.ts`, the same place
 * the server prices from, so what an offer says and what it does cannot drift.
 */

/* ── Buyer side ─────────────────────────────────────────────────────────── */

/** "Free shipping" or "Shipping extra": the small tag on a card. Nothing when the shop said nothing. */
export function ShippingChip({ shippingMinor }: { shippingMinor?: number | null }) {
  if (shippingMinor === null || shippingMinor === undefined) return null;
  return shippingMinor === 0
    ? <span className="offr-chip offr-chip--free">Free shipping</span>
    : <span className="offr-chip">Shipping extra</span>;
}

/** The small "Wholesale" highlight on a card, with the best bulk price. */
export function WholesaleChip({ offers, priceMinor, currency }: {
  offers?: ListingOffer[]; priceMinor: number; currency: string;
}) {
  const hint = wholesaleHint(offers, priceMinor);
  if (!hint) return null;
  return (
    <span className="offr-chip offr-chip--wholesale" title={`Buy ${hint.minQty} or more`}>
      Wholesale from {formatMoney(hint.priceMinor, currency)}
    </span>
  );
}

/** Group offers in a short line: what it takes, and where the items have to be. */
function groupLine(offer: ListingOffer): string | null {
  const where = offer.scope === 'shop' ? 'from this shop' : 'in the same lot';
  if (offer.kind === 'free_shipping') return `Free shipping on ${offer.minItems ?? 2}+ items ${where}`;
  if (offer.kind === 'spend_free_shipping') return `Free shipping over ${formatMoney(offer.minSpendMinor ?? 0)}`;
  return null;
}

/**
 * Shipping, said plainly under the price on the item page: the fee per item,
 * and any way the shop makes it free. Never added to the price above it.
 */
export function ShippingLine({ shippingMinor, offers, currency }: {
  shippingMinor?: number | null; offers?: ListingOffer[]; currency: string;
}) {
  if (shippingMinor === null || shippingMinor === undefined) return null;
  const ways = (offers ?? []).map(groupLine).filter((line): line is string => Boolean(line));
  return (
    <div className="offr-ship">
      <span className={`offr-ship__fee${shippingMinor === 0 ? ' is-free' : ''}`}>
        {shippingMinor === 0 ? 'Free shipping' : `+ ${formatMoney(shippingMinor, currency)} shipping per item`}
      </span>
      {shippingMinor > 0 && ways.map((line) => <span key={line} className="offr-ship__way">{line}</span>)}
    </div>
  );
}

function OfferSheet({ offer, priceMinor, currency, quantity, onClose }: {
  offer: ListingOffer; priceMinor: number; currency: string; quantity: number; onClose: () => void;
}) {
  const next = nextStepFor(offer, { items: quantity, spendMinor: priceMinor * quantity });
  return (
    <Modal title={offerLabel(offer)} onClose={onClose}>
      <div className="offr-sheet">
        <p className="offr-sheet__summary">{offerSummary(offer)}</p>
        {offer.kind === 'wholesale' && (
          <table className="offr-tiers">
            <thead><tr><th>Buy</th><th>Each</th><th>You save</th></tr></thead>
            <tbody>
              {(offer.tiers ?? []).map((tier) => {
                const each = tier.type === 'price' ? tier.value : Math.round(priceMinor * (100 - tier.value) / 100);
                return (
                  <tr key={tier.minQty}>
                    <td>{tier.minQty}+</td>
                    <td>{formatMoney(each, currency)}</td>
                    <td>{formatMoney(Math.max(0, priceMinor - each), currency)} each</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {next && <p className="offr-sheet__next">{next}</p>}
        <h4 className="offr-sheet__h">Terms</h4>
        <ul className="offr-sheet__terms">
          {offerTerms(offer).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <div className="offr-sheet__acts">
          <button type="button" className="btn" onClick={onClose}>Got it</button>
        </div>
      </div>
    </Modal>
  );
}

/** What is working on an order, and the terms it was bought under, for the checkout and order pages. */
export function OfferTermsNote({ offers, priceMinor, currency }: { offers: ListingOffer[]; priceMinor: number; currency: string }) {
  const [open, setOpen] = useState<ListingOffer | null>(null);
  if (offers.length === 0) return null;
  return (
    <div className="offr-note">
      <p className="offr-note__line">
        Price follows what is in your order.
        <InfoTip label="How offers follow your order">
          <p>Offers are worked out from what is in your order. If an item is cancelled or called off and the rest no longer qualify, the offer ends and the price goes back up.</p>
        </InfoTip>
      </p>
      <div className="offr-rail__row">
        {offers.map((offer) => (
          <button key={offer.id} type="button" className="offr-pill" onClick={() => setOpen(offer)}>
            <span className="offr-pill__label">{offerLabel(offer)}</span>
            <span className="offr-pill__more">Terms</span>
          </button>
        ))}
      </div>
      {open && <OfferSheet offer={open} priceMinor={priceMinor} currency={currency} quantity={1} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ── Seller side ────────────────────────────────────────────────────────── */

const rupeesIn = (minor: number | undefined): string => (minor ? String(minor / 100) : '');
const minorOf = (rupees: string): number => Math.max(0, Math.round((Number(rupees) || 0) * 100));
const newId = (kind: OfferKind): string => `${kind}_${Math.random().toString(36).slice(2, 8)}`;

function defaultOffer(kind: OfferKind, priceMinor: number): ListingOffer {
  const id = newId(kind);
  switch (kind) {
    case 'free_shipping': return { id, kind, scope: 'lot', minItems: 2 };
    case 'discount': return { id, kind, scope: 'lot', minItems: 2, discount: { type: 'fixed', value: Math.max(100, Math.round(priceMinor * 0.05 / 100) * 100) } };
    case 'bundle': return { id, kind, minItems: 3, bundlePriceMinor: Math.max(100, Math.round(priceMinor * 3 * 0.9 / 100) * 100) };
    case 'wholesale': return { id, kind, tiers: [{ minQty: 10, type: 'percent', value: 10 }] };
    case 'spend_free_shipping': return { id, kind, minSpendMinor: Math.max(100, priceMinor * 2) };
    case 'early_bird': return { id, kind, limit: 10, discount: { type: 'percent', value: 10 } };
    case 'group_fill': return { id, kind, freeShipping: true };
    case 'buy_x_get_y': return { id, kind, minItems: 2, freeQty: 1 };
    case 'repeat_buyer': return { id, kind, discount: { type: 'percent', value: 5 } };
    case 'first_order': return { id, kind, discount: { type: 'percent', value: 5 } };
    case 'prepay': return { id, kind, discount: { type: 'percent', value: 3 } };
  }
}

function ValueFields({ value, onChange, label }: {
  value: OfferValue | undefined;
  onChange: (next: OfferValue) => void;
  label: string;
}) {
  const current = value ?? { type: 'percent' as const, value: 5 };
  return (
    <div className="offr-edit__pair">
      <label className="field">
        <span>{label}</span>
        <select value={current.type}
          onChange={(e) => onChange({ type: e.target.value as 'fixed' | 'percent', value: e.target.value === 'percent' ? 5 : 5000 })}>
          <option value="percent">% off</option>
          <option value="fixed">₹ off</option>
        </select>
      </label>
      <label className="field">
        <span>{current.type === 'percent' ? 'Percent' : 'Rupees'}</span>
        <input type="number" min="1" step="1"
          value={current.type === 'percent' ? current.value || '' : rupeesIn(current.value)}
          onChange={(e) => onChange({
            ...current,
            value: current.type === 'percent' ? Math.round(Number(e.target.value) || 0) : minorOf(e.target.value),
          })} />
      </label>
      {current.type === 'percent' && (
        <CapField capMinor={current.capMinor} onChange={(capMinor) => onChange({ ...current, capMinor })} />
      )}
    </div>
  );
}

/** "Up to ₹120", or no cap: a percentage that stops at an amount. */
export function CapField({ capMinor, onChange }: { capMinor?: number; onChange: (next: number | undefined) => void }) {
  return (
    <div className="field offr-cap">
      <span>Cap</span>
      <div className="offr-cap__row" role="radiogroup" aria-label="Cap">
        <button type="button" role="radio" aria-checked={!capMinor} className={`offr-cap__opt${capMinor ? '' : ' is-on'}`}
          onClick={() => onChange(undefined)}>No cap</button>
        <button type="button" role="radio" aria-checked={Boolean(capMinor)} className={`offr-cap__opt${capMinor ? ' is-on' : ''}`}
          onClick={() => onChange(capMinor || 10_000)}>Up to ₹</button>
        {Boolean(capMinor) && (
          <input type="number" min="1" step="1" aria-label="Cap in rupees" value={rupeesIn(capMinor)}
            onChange={(e) => onChange(minorOf(e.target.value) || 100)} />
        )}
      </div>
    </div>
  );
}

const ScopeField = ({ value, onChange }: { value: OfferScope | undefined; onChange: (next: OfferScope) => void }) => (
  <label className="field">
    <span>Items count together when they are</span>
    <select value={value ?? 'lot'} onChange={(e) => onChange(e.target.value as OfferScope)}>
      <option value="lot">In the same lot</option>
      <option value="shop">Anywhere in one order from your shop (different lots, sent together)</option>
    </select>
  </label>
);

function OfferFields({ offer, onChange }: { offer: ListingOffer; onChange: (next: ListingOffer) => void }) {
  const set = (patch: Partial<ListingOffer>) => onChange({ ...offer, ...patch });
  const minItems = (label = 'How many items') => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min="1" step="1" value={offer.minItems ?? ''} onChange={(e) => set({ minItems: Math.round(Number(e.target.value) || 0) })} />
    </label>
  );
  switch (offer.kind) {
    case 'free_shipping':
      return <>{minItems('Free shipping when they buy this many items')}<ScopeField value={offer.scope} onChange={(scope) => set({ scope })} /></>;
    case 'discount':
      return <>{minItems('Discount when they buy this many items')}<ScopeField value={offer.scope} onChange={(scope) => set({ scope })} />
        <ValueFields label="Take off each item" value={offer.discount} onChange={(discount) => set({ discount })} /></>;
    case 'bundle':
      return <>{minItems('Bundle size')}
        <label className="field"><span>Bundle price (₹, for the whole bundle)</span>
          <input type="number" min="1" step="1" value={rupeesIn(offer.bundlePriceMinor)} onChange={(e) => set({ bundlePriceMinor: minorOf(e.target.value) })} /></label></>;
    case 'wholesale':
      return <WholesaleFields tiers={offer.tiers ?? []} onChange={(tiers) => set({ tiers })} />;
    case 'spend_free_shipping':
      return <label className="field"><span>Free shipping when the order from your shop reaches (₹)</span>
        <input type="number" min="1" step="1" value={rupeesIn(offer.minSpendMinor)} onChange={(e) => set({ minSpendMinor: minorOf(e.target.value) })} /></label>;
    case 'early_bird':
      return <>
        <label className="field"><span>For the first this many buyers (leave empty for no limit)</span>
          <input type="number" min="1" step="1" value={offer.limit ?? ''} onChange={(e) => set({ limit: e.target.value ? Math.round(Number(e.target.value)) : undefined })} /></label>
        <label className="field"><span>Or until this date (optional)</span>
          <input type="date" value={offer.until ? offer.until.slice(0, 10) : ''}
            onChange={(e) => set({ until: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null })} /></label>
        <ValueFields label="Take off" value={offer.discount} onChange={(discount) => set({ discount })} />
      </>;
    case 'group_fill':
      return <>
        <label className="field"><span>When the group buy fills, everyone gets</span>
          <select value={offer.freeShipping ? 'ship' : 'off'} onChange={(e) => set(e.target.value === 'ship' ? { freeShipping: true, discount: undefined } : { freeShipping: false, discount: { type: 'percent', value: 5 } })}>
            <option value="ship">Free shipping</option>
            <option value="off">Money off</option>
          </select></label>
        {!offer.freeShipping && <ValueFields label="Take off" value={offer.discount} onChange={(discount) => set({ discount })} />}
        <p className="field__hint">Works on pre-orders and group buys; it applies once the group goes ahead.</p>
      </>;
    case 'buy_x_get_y':
      return <>{minItems('Buy this many')}
        <label className="field"><span>Get this many free</span>
          <input type="number" min="1" step="1" value={offer.freeQty ?? ''} onChange={(e) => set({ freeQty: Math.round(Number(e.target.value) || 0) })} /></label></>;
    case 'repeat_buyer':
    case 'first_order':
    case 'prepay':
      return <ValueFields label="Take off" value={offer.discount} onChange={(discount) => set({ discount })} />;
  }
}

function WholesaleFields({ tiers, onChange }: { tiers: WholesaleTier[]; onChange: (next: WholesaleTier[]) => void }) {
  const update = (index: number, patch: Partial<WholesaleTier>) =>
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  return (
    <div className="offr-edit__tiers">
      {tiers.map((tier, index) => (
        <div key={index} className="offr-edit__tier">
          <label className="field"><span>Buy at least</span>
            <input type="number" min="2" step="1" value={tier.minQty || ''} onChange={(e) => update(index, { minQty: Math.round(Number(e.target.value) || 0) })} /></label>
          <label className="field"><span>Price</span>
            <select value={tier.type} onChange={(e) => update(index, { type: e.target.value as 'percent' | 'price', value: e.target.value === 'percent' ? 10 : 0 })}>
              <option value="percent">% off</option>
              <option value="price">Dropped price (₹ each)</option>
            </select></label>
          <label className="field"><span>{tier.type === 'percent' ? 'Percent' : 'Rupees each'}</span>
            <input type="number" min="1" step="1" value={tier.type === 'percent' ? tier.value || '' : rupeesIn(tier.value)}
              onChange={(e) => update(index, { value: tier.type === 'percent' ? Math.round(Number(e.target.value) || 0) : minorOf(e.target.value) })} /></label>
          {tiers.length > 1 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(tiers.filter((_, i) => i !== index))}>Remove step</button>
          )}
        </div>
      ))}
      {tiers.length < MAX_WHOLESALE_TIERS && (
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => onChange([...tiers, { minQty: (tiers[tiers.length - 1]?.minQty ?? 5) * 2, type: 'percent', value: 15 }])}>
          Add a bigger-quantity step
        </button>
      )}
    </div>
  );
}

/**
 * The seller's offer picker: add the offers that suit the item, set each one,
 * and see straight away if one cannot be priced. What is saved is exactly what
 * the buyer is shown.
 */
export function OfferEditor({ offers, onChange, priceMinor }: {
  offers: ListingOffer[]; onChange: (next: ListingOffer[]) => void; priceMinor: number;
}) {
  const problem = priceMinor > 0 ? cleanOffers(offers, priceMinor).error : cleanOffers(offers).error;
  // One of each kind, except the two that are about different numbers of items.
  const available = OFFER_KINDS.filter((kind) =>
    kind === 'free_shipping' || kind === 'discount' || !offers.some((offer) => offer.kind === kind));
  return (
    <div className="offr-edit">
      {offers.map((offer, index) => (
        <div key={offer.id} className="offr-edit__card">
          <div className="offr-edit__head">
            <b>{OFFER_KIND_INFO[offer.kind].name}</b>
            <button type="button" className="btn btn--ghost btn--sm"
              onClick={() => onChange(offers.filter((_, i) => i !== index))}>Remove</button>
          </div>
          <OfferFields offer={offer} onChange={(next) => onChange(offers.map((entry, i) => (i === index ? next : entry)))} />
          <p className="offr-edit__preview">Buyers will see: <b>{offerSummary(offer)}</b></p>
        </div>
      ))}
      {problem && <p className="notice notice--error">{problem}</p>}
      {offers.length < MAX_OFFERS_PER_ITEM && available.length > 0 && (
        <label className="field">
          <span>Add an offer</span>
          <select value="" onChange={(e) => {
            if (e.target.value) onChange([...offers, defaultOffer(e.target.value as OfferKind, priceMinor)]);
          }}>
            <option value="">Choose an offer to add…</option>
            {available.map((kind) => <option key={kind} value={kind}>{OFFER_KIND_INFO[kind].name}</option>)}
          </select>
          <span className="field__hint">
            Buyers see these under Offers on the item. They get the best money-off, not every one added together.
          </span>
        </label>
      )}
    </div>
  );
}

/**
 * What an order costs, line by line: the seller's price for the goods, then
 * shipping, then what each offer took off. Shipping is never part of the
 * price above it, and an order with neither shipping nor an offer reads as a
 * single line, the way it always did.
 */
export function PriceBreakdown({ goodsMinor, shippingMinor = 0, discountMinor = 0, applied = [], rules = [], totalMinor, currency, prepaySavingMinor = 0, loyalty = [], onTerms }: {
  goodsMinor: number; shippingMinor?: number; discountMinor?: number; applied?: AppliedOffer[]; rules?: ListingOffer[];
  totalMinor: number; currency: string;
  /** Shown as a saving line when the buyer is paying everything. */
  prepaySavingMinor?: number;
  /** Loyalty money off, already inside the total. */
  loyalty?: { rewardId: string; label: string; valueMinor: number }[];
  /** Opens every offer's details and terms in one place, instead of the terms note. */
  onTerms?: () => void;
}) {
  const plain = shippingMinor === 0 && discountMinor === 0 && applied.length === 0 && rules.length === 0 && prepaySavingMinor === 0 && loyalty.length === 0;
  if (plain) return <div className="kv"><dt>Item</dt><dd>{formatMoney(totalMinor, currency)}</dd></div>;
  const shippingSaved = applied.filter((offer) => offer.savedMinor > 0 && shippingMinor === 0 && /shipping/i.test(offer.label));
  return (
    <div className="offr-sum">
      <div className="offr-sum__row"><span>Items</span><span>{formatMoney(goodsMinor, currency)}</span></div>
      <div className="offr-sum__row">
        <span>Shipping</span>
        <span>{shippingMinor === 0 ? 'Free' : formatMoney(shippingMinor, currency)}</span>
      </div>
      {applied.map((offer) => (
        <div key={offer.offerId} className="offr-sum__row offr-sum__row--off">
          <span>{offer.label}</span>
          <span>{shippingSaved.includes(offer) ? `saves ${formatMoney(offer.savedMinor, currency)}` : `−${formatMoney(offer.savedMinor, currency)}`}</span>
        </div>
      ))}
      {loyalty.map((row) => (
        <div key={row.rewardId} className="offr-sum__row offr-sum__row--off offr-sum__row--loyal">
          <span>★ {row.label}</span><span>−{formatMoney(row.valueMinor, currency)}</span>
        </div>
      ))}
      {prepaySavingMinor > 0 && (
        <div className="offr-sum__row offr-sum__row--off"><span>Pay-in-full offer</span><span>−{formatMoney(prepaySavingMinor, currency)}</span></div>
      )}
      <div className="offr-sum__row offr-sum__row--total"><span>Total</span><span>{formatMoney(totalMinor - prepaySavingMinor, currency)}</span></div>
      {onTerms ? null : <OfferTermsNote offers={rules} priceMinor={goodsMinor} currency={currency} />}
    </div>
  );
}
