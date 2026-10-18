import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api, type PhotoSalesResponse } from '../api';
import { formatMoney } from '../format';
import { Icon } from './Icon';
import { Avatar, Thumb, leadPhoto } from './ui';

/**
 * "Seen for sale": the bar under a photo that says whether the things in it
 * can be bought here, and the sheet it opens.
 *
 * Every full-screen photo carries one - a post's, a listing's, an order's, a
 * collection card's - because the question a photo of somebody's haul raises
 * is the same wherever it is shown. It says nothing until there is something
 * to say: a photo with no matches gets no bar, not a "nothing found".
 */

/**
 * Answers by photo address and the words with it, for this page load. A
 * photo's bytes never change, so swiping back to one is free; a reload asks
 * again, since listings do.
 */
const answers = new Map<string, Promise<PhotoSalesResponse | null>>();

function salesFor(url: string, about: string): Promise<PhotoSalesResponse | null> {
  const key = `${url}\n${about}`;
  let answer = answers.get(key);
  if (!answer) {
    // A failure is quiet - this is a hint, not the page - and is not kept, so a later look tries again.
    answer = api.photoSales(url, about || undefined).catch(() => {
      answers.delete(key);
      return null;
    });
    answers.set(key, answer);
  }
  return answer;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The bar's one line: what is in the photo, what can be bought, who has sold it. */
function summary(found: PhotoSalesResponse): string {
  const listings = found.items.flatMap((item) => item.listings);
  const live = listings.filter((listing) => listing.onSale).length;
  const parts = [
    found.items.length > 1 ? count(found.items.length, 'item') + ' spotted' : null,
    live > 0 ? `${live} for sale` : listings.length > 0 ? count(listings.length, 'past listing') : null,
    found.sellers.length > 0 ? `${count(found.sellers.length, 'seller')} sold before` : null,
    // Only worth the room when there is nothing more certain to say.
    found.sellers.length === 0 && found.likely.length > 0 ? `${count(found.likely.length, 'shop')} could get this` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function PhotoSales({ url, about = '', onLeave, tone = 'dark' }: {
  url: string | undefined;
  /** The words shown with the photo - a caption, a title - searched alongside it. */
  about?: string;
  /** Called as a link in the sheet is followed, so whatever shows the photo can close. */
  onLeave?: () => void;
  /** Over a dark photo viewer, or in a light dialog. */
  tone?: 'dark' | 'light';
}) {
  const [found, setFound] = useState<{ url: string; sales: PhotoSalesResponse | null } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!url) return;
    let live = true;
    setOpen(false);
    void salesFor(url, about).then((sales) => { if (live) setFound({ url, sales }); });
    return () => { live = false; };
  }, [url, about]);

  const sales = found && found.url === url ? found.sales : null;
  const loading = Boolean(url) && found?.url !== url;
  const any = Boolean(sales && (sales.items.length > 0 || sales.likely.length > 0));

  if (loading) {
    return (
      <div className={`psales psales--${tone} is-loading`} aria-live="polite">
        <span className="psales__dot" aria-hidden="true" />
        Looking for this on Figmark…
      </div>
    );
  }
  if (!sales || !any) return null;

  return (
    <>
      <button type="button" className={`psales psales--${tone}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="tag" size={15} />
        <span className="psales__text">{summary(sales)}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && <SalesSheet sales={sales} onClose={() => setOpen(false)} onLeave={onLeave} />}
    </>
  );
}

function SalesSheet({ sales, onClose, onLeave }: {
  sales: PhotoSalesResponse;
  onClose: () => void;
  onLeave?: () => void;
}) {
  // Escape closes the sheet, not the photo under it: caught before the viewer's own listener.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const leave = () => { onClose(); onLeave?.(); };
  const several = sales.items.length > 1;

  // Portalled above the viewer. React still bubbles its events through the
  // viewer, whose swipe would turn the photo, so they stop here.
  return createPortal(
    <div className="psheet" role="dialog" aria-modal="true" aria-label="For sale from this photo"
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}>
      <div className="psheet__box">
        <div className="psheet__head">
          <h2 className="psheet__title">From this photo</h2>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>

        {sales.items.map((item, at) => {
          const live = item.listings.filter((listing) => listing.onSale);
          const past = item.listings.filter((listing) => !listing.onSale);
          return (
            <section key={`${item.label ?? 'photo'}-${at}`} className="psheet__item">
              <h3 className="psheet__label">
                {item.label ? item.label[0]!.toUpperCase() + item.label.slice(1) : 'The same photo'}
                {several && <span className="psheet__count">{at + 1} of {sales.items.length}</span>}
              </h3>
              {live.length > 0 && (
                <>
                  <p className="psheet__sub">For sale now</p>
                  {live.map((listing) => <SaleRow key={listing.id} listing={listing} onLeave={leave} />)}
                </>
              )}
              {past.length > 0 && (
                <>
                  <p className="psheet__sub">Listed before</p>
                  {past.map((listing) => <SaleRow key={listing.id} listing={listing} onLeave={leave} />)}
                </>
              )}
            </section>
          );
        })}

        {sales.sellers.length > 0 && (
          <section className="psheet__item">
            <h3 className="psheet__label">Sellers who have sold {several ? 'these' : 'this'}</h3>
            {sales.sellers.map(({ seller, unitsSold, items }) => {
              const body = (
                <>
                  <Avatar name={seller.storefrontName} size={36} />
                  <span className="psheet__main">
                    <b className="psheet__name">{seller.storefrontName}</b>
                    <span className="psheet__meta">
                      {unitsSold > 0 ? `${unitsSold} sold` : 'Sold out'}
                      {items > 1 && ` · ${items} listings`}
                    </span>
                  </span>
                </>
              );
              return seller.username
                ? <Link key={seller.id} to={`/${seller.username}`} className="psheet__row" onClick={leave}>{body}</Link>
                : <div key={seller.id} className="psheet__row">{body}</div>;
            })}
          </section>
        )}

        {sales.likely.length > 0 && (
          <section className="psheet__item">
            <h3 className="psheet__label">Shops that could get {several || sales.items.length === 0 ? 'these' : 'this'}</h3>
            {/* By keyword first - the brand, the name - then by the kind of thing. */}
            {[...new Set(sales.likely.map((entry) => entry.because))].map((because) => {
              const shops = sales.likely.filter((entry) => entry.because === because);
              return (
                <div key={because} className="psheet__group">
                  <p className="psheet__sub">
                    <span className={`psheet__chip psheet__chip--${shops[0]!.kind}`}>{because}</span>
                  </p>
                  {shops.map(({ seller, listings, kind }) => {
                    const body = (
                      <>
                        <Avatar name={seller.storefrontName} size={36} />
                        <span className="psheet__main">
                          <b className="psheet__name">{seller.storefrontName}</b>
                          <span className="psheet__meta">
                            {kind === 'keyword'
                              ? `Has listed ${because} ${listings === 1 ? 'once' : `${listings} times`}`
                              : `${count(listings, 'listing')} in ${because}`}
                          </span>
                        </span>
                      </>
                    );
                    return seller.username
                      ? <Link key={seller.id} to={`/${seller.username}`} className="psheet__row" onClick={leave}>{body}</Link>
                      : <div key={seller.id} className="psheet__row">{body}</div>;
                  })}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SaleRow({ listing, onLeave }: {
  listing: PhotoSalesResponse['items'][number]['listings'][number];
  onLeave: () => void;
}) {
  const ended = listing.status === 'sold_out' ? 'Sold out' : 'Ended';
  return (
    <Link to={`/listing/${listing.id}`} className="psheet__row" onClick={onLeave}>
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb psheet__thumb" />
      <span className="psheet__main">
        <b className="psheet__name">{listing.title}</b>
        <span className="psheet__meta">
          {listing.seller?.storefrontName ?? 'A shop'}
          {(listing.soldCount ?? 0) > 0 && ` · ${listing.soldCount} sold`}
        </span>
      </span>
      <span className="psheet__price">
        {!listing.onSale && <span className="psheet__ended">{ended}</span>}
        {formatMoney(listing.priceMinor, listing.currency)}
      </span>
    </Link>
  );
}
