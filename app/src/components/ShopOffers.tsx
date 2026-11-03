import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { OFFER_KIND_INFO, cleanOffers, offerLabel, type ListingOffer } from '@shared/offers';
import type { Listing } from '@shared/models';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { Loading } from './Feedback';
import { OfferEditor } from './Offers';
import { EmptyState, ErrorNotice, Modal, PageError } from './ui';
import '../styles/ShopOffers.css';

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
  if (!listings) return <Loading />;

  return (
    <div className="shopoffr stack">
      <section className="shopoffr__hero">
        <div>
          <h2 className="shopoffr__title">Offers</h2>
          <p className="shopoffr__sub">Money off, bundles, free shipping and bulk prices - on {withOffers.length} of {live.length} items.</p>
        </div>
        <dl className="shopoffr__stats">
          <div><dt>Items with offers</dt><dd>{withOffers.length}</dd></div>
          <div><dt>Kinds in use</dt><dd>{kinds.size}</dd></div>
        </dl>
      </section>

      <p className="shopoffr__rule">
        <b>Offers and loyalty rewards never stack.</b> An order that takes an offer still earns its stamp, but any reward it
        reaches waits for the buyer&apos;s next order without an offer.
        {onLoyalty && <> <button type="button" className="shopoffr__link" onClick={onLoyalty}>Your loyalty cards →</button></>}
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
        <OffersDialog listing={editing} onClose={() => setEditing(null)}
          onSaved={(listing) => {
            setListings((rows) => (rows ?? []).map((row) => (row.id === listing.id ? listing : row)));
            setEditing(null);
          }} />
      )}
    </div>
  );
}

function OffersDialog({ listing, onClose, onSaved }: { listing: Listing; onClose: () => void; onSaved: (listing: Listing) => void }) {
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
