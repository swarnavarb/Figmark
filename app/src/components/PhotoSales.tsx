import { useEffect, useRef, useState } from 'react';
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
 * is the same wherever it is shown. Posts and channel messages also carry one
 * under their photo in the feed, asked for only once it scrolls into view. It
 * says nothing until there is something to say: a photo with no matches gets
 * no bar, not a "nothing found".
 *
 * Under the certain matches come the probable ones - a guess at what the
 * photo shows, from its colours, its caption and who posted it - with the
 * shops that could get it, so a photo the catalogue cannot name still leads
 * somewhere.
 */

/**
 * Answers by photo address and the words with it, for this page load. A
 * photo's bytes never change, so swiping back to one is free; a reload asks
 * again, since listings do.
 */
const answers = new Map<string, Promise<PhotoSalesResponse | null>>();

function salesFor(url: string, about: string, by: string): Promise<PhotoSalesResponse | null> {
  const key = `${url}\n${about}\n${by}`;
  let answer = answers.get(key);
  if (!answer) {
    // A failure is quiet - this is a hint, not the page - and is not kept, so a later look tries again.
    answer = api.photoSales(url, about || undefined, by || undefined).catch(() => {
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

/** The bar's one line: what is in the photo, what can be bought, who has sold it, what it may be. */
function summary(found: PhotoSalesResponse): string {
  const listings = found.items.flatMap((item) => item.listings);
  const live = listings.filter((listing) => listing.onSale).length;
  const probable = found.probable.length;
  const parts = [
    found.items.length > 1 ? count(found.items.length, 'item') + ' spotted' : null,
    live > 0 ? `${live} for sale` : listings.length > 0 ? count(listings.length, 'past listing') : null,
    found.sellers.length > 0 ? `${count(found.sellers.length, 'past seller')}` : null,
    probable > 0 ? `${count(probable, 'probable match', 'probable matches')}` : null,
    // Only worth the room when there is nothing more certain to say.
    listings.length === 0 && found.likely.length > 0 ? `${count(found.likely.length, 'shop')} could get this` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function PhotoSales({ url, about = '', by = '', onLeave, tone = 'dark' }: {
  url: string | undefined;
  /** The words shown with the photo - a caption, a title - searched alongside it. */
  about?: string;
  /** Who posted it: their own listings are the likelier guesses. */
  by?: string;
  /** Called as a link in the sheet is followed, so whatever shows the photo can close. */
  onLeave?: () => void;
  /**
   * Over a dark photo viewer, in a light dialog, or under a photo in the feed -
   * where it waits until it is on screen and shows nothing while it looks.
   */
  tone?: 'dark' | 'light' | 'inline';
}) {
  const [found, setFound] = useState<{ url: string; sales: PhotoSalesResponse | null } | null>(null);
  const [open, setOpen] = useState(false);
  const inline = tone === 'inline';
  const slot = useRef<HTMLDivElement>(null);
  // A feed is scrolled past far more than it is read: only ask about photos that come into view.
  const [inView, setInView] = useState(!inline);

  useEffect(() => {
    const el = slot.current;
    if (inView || !el) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setInView(true); watch.disconnect(); }
    }, { rootMargin: '200px 0px' });
    watch.observe(el);
    return () => watch.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!url || !inView) return;
    let live = true;
    setOpen(false);
    void salesFor(url, about, by).then((sales) => { if (live) setFound({ url, sales }); });
    return () => { live = false; };
  }, [url, about, by, inView]);

  const sales = found && found.url === url ? found.sales : null;
  const loading = Boolean(url) && found?.url !== url;
  const any = Boolean(sales && (sales.items.length > 0 || sales.likely.length > 0 || sales.probable.length > 0));

  if (inline) {
    return (
      <div ref={slot} className="psales-slot">
        {!loading && sales && any && (
          <>
            <button type="button" className="psales psales--inline" aria-haspopup="dialog"
              onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
              <Icon name="tag" size={15} />
              <span className="psales__text">{summary(sales)}</span>
              <Icon name="right" size={14} />
            </button>
            {open && <SalesSheet sales={sales} onClose={() => setOpen(false)} onLeave={onLeave} />}
          </>
        )}
      </div>
    );
  }
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

        {sales.probable.length > 0 && (
          <section className="psheet__item">
            <h3 className="psheet__label">{count(sales.probable.length, 'probable listing')}</h3>
            <p className="psheet__note">A guess from the photo's colours, the words with it and who posted it.</p>
            {sales.probable.map((listing) => (
              <SaleRow key={listing.id} listing={listing} chance={listing.chance} onLeave={leave} />
            ))}
          </section>
        )}

        {sales.likely.length > 0 && (
          <section className="psheet__item">
            <h3 className="psheet__label">
              {count(sales.likely.length, 'probable shop')} that can get {several || sales.items.length === 0 ? 'these' : 'this'}
            </h3>
            {/* By keyword first - the brand, the name - then shops with similar listings, then by the kind of thing. */}
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
                              : kind === 'similar'
                                ? `${count(listings, 'probable match', 'probable matches')} above`
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

function SaleRow({ listing, chance, onLeave }: {
  listing: PhotoSalesResponse['items'][number]['listings'][number];
  /** For a probable match: how likely, 0 to 1. */
  chance?: number;
  onLeave: () => void;
}) {
  const ended = listing.status === 'sold_out' ? 'Sold out' : 'Ended';
  return (
    <Link to={`/listing/${listing.id}`} className="psheet__row" onClick={onLeave}>
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb psheet__thumb" />
      <span className="psheet__main">
        <b className="psheet__name">{listing.title}</b>
        <span className="psheet__meta">
          {chance !== undefined && <span className="psheet__chance">{Math.round(chance * 100)}% likely</span>}
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
