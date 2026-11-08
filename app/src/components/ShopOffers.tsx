import { useToast } from './Feedback';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SkelCards } from './PageSkeletons';
import { Link } from 'react-router-dom';
import { OFFER_KIND_INFO, PERK_WORDS, cleanOffers, offerLabel, offerPerk, type ListingOffer } from '@shared/offers';
import { rewardPerk, rewardWords, type LoyaltyCard } from '@shared/loyalty';
import type { Listing } from '@shared/models';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';

import { InfoTip } from './InfoTip';
import { OfferEditor } from './Offers';
import { EmptyState, ErrorNotice, Modal, PageError } from './ui';
import '../styles/ShopOffers.css';

/**
 * The loyalty rewards an item's offers clash with, in words: a reward the shop
 * keeps apart from offers, or one that gives the same kind of thing.
 */
function clashesFor(listingId: string, offers: readonly ListingOffer[], cards: readonly LoyaltyCard[]): string[] {
  if (offers.length === 0) return [];
  const perks = new Set(offers.map(offerPerk));
  const out: string[] = [];
  for (const card of cards) {
    if (!card.active || (card.listingIds && !card.listingIds.includes(listingId))) continue;
    card.rewards.forEach((reward, index) => {
      if (!reward) return;
      const perk = rewardPerk(reward.kind);
      const why = reward.withOffers === false ? 'kept apart from offers' : perk && perks.has(perk) ? `both ${PERK_WORDS[perk]}` : null;
      if (why) out.push(`${rewardWords(reward, (minor) => formatMoney(minor))} (${card.name}, stamp ${index + 1}) - ${why}`);
    });
  }
  return out;
}

/**
 * Engage → Offers: every item's offers on one screen, beside the shop's
 * loyalty cards. The same offers the item form edits, read and changed here
 * without opening each item.
 */
export function ShopOffers({ onLoyalty }: { onLoyalty?: () => void }) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'with' | 'without'>('with');
  const [editing, setEditing] = useState<Listing | null>(null);
  const [cards, setCards] = useState<LoyaltyCard[]>([]);
  useEffect(() => { api.myLoyaltyCards().then((body) => setCards(body.cards)).catch(() => undefined); }, []);

  const load = useCallback(async () => {
    try {
      setListings((await api.myListings()).listings);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your items.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const live = useMemo(() => (listings ?? []).filter((listing) => listing.status === 'active'), [listings]);
  const withOffers = live.filter((listing) => (listing.offers?.length ?? 0) > 0);
  const shown = filter === 'with' ? withOffers : live.filter((listing) => !(listing.offers?.length));
  const kinds = new Set(withOffers.flatMap((listing) => (listing.offers ?? []).map((offer) => offer.kind)));

  if (!listings && error) return <PageError message={error} />;
  if (!listings) return <SkelCards n={2} h={96} />;

  return (
    <div className="shopoffr stack">
      <section className="shopoffr__hero">
        <div>
          <h2 className="shopoffr__title">Offers</h2>
          <p className="shopoffr__sub">On {withOffers.length} of {live.length} items. They apply on their own at checkout.</p>
        </div>
        <dl className="shopoffr__stats">
          <div><dt>Items with offers</dt><dd>{withOffers.length}</dd></div>
          <div><dt>Kinds in use</dt><dd>{kinds.size}</dd></div>
        </dl>
      </section>

      <p className="shopoffr__rule">
        <b>Offers and loyalty rewards add up.</b> Same kind? The buyer picks one.
        <InfoTip label="How offers and loyalty rewards work together">
          <p>An offer and a reward clash when both give the same thing - money off or back, a free item, free shipping - or when the reward is set to stay apart from offers. The buyer picks one at checkout; a reward they skip waits for their next order.</p>
          <p>Offers apply on their own: when a buyer adds more to the same lot, the price drops at checkout.</p>
          <p>Keep loyalty rewards bigger than your offers - they thank people for coming back. Store credit and refunds always work with both.</p>
        </InfoTip>
        {onLoyalty && <button type="button" className="shopoffr__link" onClick={onLoyalty}>Loyalty cards →</button>}
      </p>

      <div className="shopoffr__tabs" role="tablist" aria-label="Which items">
        <button type="button" role="tab" aria-selected={filter === 'with'} className={filter === 'with' ? 'is-on' : ''}
          onClick={() => setFilter('with')}>With offers <span>{withOffers.length}</span></button>
        <button type="button" role="tab" aria-selected={filter === 'without'} className={filter === 'without' ? 'is-on' : ''}
          onClick={() => setFilter('without')}>No offers yet <span>{live.length - withOffers.length}</span></button>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="🏷️" title={filter === 'with' ? 'No offers running' : 'Every item has an offer'}>
          {filter === 'with' ? 'Add one to an item: a bundle price, free shipping over a spend, or a first-order discount.' : 'Nice - nothing left to add.'}
        </EmptyState>
      ) : (
        <ul className="shopoffr__list">
          {shown.map((listing) => {
            const photo = listing.photos.find((row) => row.isPrimary) ?? listing.photos[0];
            const src = photo?.thumbUrl || photo?.url;
            return (
              <li key={listing.id} className="shopoffr__row">
                {src ? <img className="shopoffr__photo" src={src} alt="" loading="lazy" decoding="async" />
                  : <span className="shopoffr__photo" aria-hidden="true" />}
                <div className="shopoffr__body">
                  <Link to={`/listing/${listing.id}`} className="shopoffr__name">{listing.title}</Link>
                  <small className="faint">{formatMoney(listing.priceMinor, listing.currency)}</small>
                  {(() => {
                    const clashes = clashesFor(listing.id, listing.offers ?? [], cards).map((line) => line.split(' (')[0]);
                    const unique = [...new Set(clashes)];
                    return unique.length > 0 && (
                      <small className="shopoffr__clash">
                        ⚠ Clashes with {unique.slice(0, 2).join(', ')}{unique.length > 2 ? ` +${unique.length - 2} more` : ''} - buyer picks one
                      </small>
                    );
                  })()}
                  {(listing.offers?.length ?? 0) > 0 && (
                    <div className="shopoffr__chips">
                      {listing.offers!.map((offer) => (
                        <span key={offer.id} className="shopoffr__chip" title={OFFER_KIND_INFO[offer.kind].blurb}>{offerLabel(offer)}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" className="btn btn--sm btn--quiet" onClick={() => setEditing(listing)}>
                  {(listing.offers?.length ?? 0) > 0 ? 'Edit' : '+ Offer'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <OffersDialog listing={editing} cards={cards} onClose={() => setEditing(null)}
          onSaved={(listing) => {
            setListings((rows) => (rows ?? []).map((row) => (row.id === listing.id ? listing : row)));
            setEditing(null);
          }} />
      )}
    </div>
  );
}

function OffersDialog({ listing, cards, onClose, onSaved }: {
  listing: Listing; cards: LoyaltyCard[]; onClose: () => void; onSaved: (listing: Listing) => void;
}) {
  const toast = useToast();
  const [offers, setOffers] = useState<ListingOffer[]>(listing.offers ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = cleanOffers(offers, listing.priceMinor).error;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { offers } as unknown as Parameters<typeof api.editListing>[1];
      onSaved((await api.editListing(listing.id, body)).listing);
      toast('Offer saved.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the offers.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Offers · ${listing.title}`} onClose={onClose} layout="panel">
      <div className="stack">
        <OfferEditor offers={offers} onChange={setOffers} priceMinor={listing.priceMinor} />
        {clashesFor(listing.id, offers, cards).length > 0 && (
          <div className="shopoffr__clashes">
            <b>⚠ Clashes with your loyalty rewards - the buyer picks one</b>
            {clashesFor(listing.id, offers, cards).map((line) => <small key={line}>{line}</small>)}
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={busy || Boolean(problem)} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save offers'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
