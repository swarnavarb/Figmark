import { useEffect, useRef, useState } from 'react';
import { cameFromListing } from '../dnaCameFrom';
import { Link } from 'react-router-dom';
import { ApiRequestError, api, type PhotoSalesResponse } from '../api';
import { useSession } from '../session';
import { formatMoney } from '../format';
import type { DnaSummary } from '@shared/dna';
import { Icon } from './Icon';
import { Avatar, Thumb, leadPhoto } from './ui';

/**
 * Product DNA for any photo: the button under it, and what the photo's own
 * Product DNA page shows about where the things in it can be had.
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
 * Answers by photo address and the words with it. A photo's bytes never
 * change, so swiping back to one is free; listings do, so an answer is kept
 * for a few minutes - across a reload too, in this tab's session storage -
 * and then asked again.
 */
const answers = new Map<string, Promise<PhotoSalesResponse | null>>();
const KEPT_MS = 5 * 60_000;
const STORE_KEY = 'figmark.photoSales';
/** Photos asked about together: those that come into view in the same moment go in one request. */
const BATCH_MS = 120;
const BATCH_MAX = 10;

type Kept = Record<string, { at: number; sales: PhotoSalesResponse }>;

/** The session's kept answers, read from storage once per page. */
let stored: Kept | null = null;

function readKept(): Kept {
  if (stored) return stored;
  try {
    const kept = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') as Kept;
    stored = kept && typeof kept === 'object' ? kept : {};
  } catch {
    stored = {};
  }
  return stored;
}

function keep(key: string, sales: PhotoSalesResponse): void {
  const now = Date.now();
  // The newest few dozen, none past their minutes: session storage is small.
  stored = Object.fromEntries(Object.entries(readKept()).filter(([, entry]) => now - entry.at < KEPT_MS).slice(-30));
  stored[key] = { at: now, sales };
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or off: the answer is still kept in memory for this page.
  }
}

let waiting: { key: string; ask: { url: string; about?: string; by?: string }; done: (sales: PhotoSalesResponse | null) => void }[] = [];
let timer: number | undefined;

function send(): void {
  const batch = waiting.splice(0, BATCH_MAX);
  if (waiting.length > 0) timer = window.setTimeout(send, 0);
  else timer = undefined;
  const asked = batch.length === 1
    ? api.photoSales(batch[0]!.ask.url, batch[0]!.ask.about, batch[0]!.ask.by).then((sales) => [sales])
    : api.photoSalesMany(batch.map((entry) => entry.ask)).then((reply) => reply.answers);
  // A failure is quiet - this is a hint, not the page - and is not kept, so a later look tries again.
  asked.then(
    (found) => batch.forEach((entry, at) => entry.done(found[at] ?? null)),
    () => batch.forEach((entry) => { answers.delete(entry.key); entry.done(null); }),
  );
}

/**
 * Whether the server could say anything about this address: only photos it
 * stores are looked at, so a picture inlined in the page or held in this tab
 * (`data:`, `blob:`) is not asked about at all.
 */
function askable(url: string): boolean {
  return url.startsWith('/api/photos/') || url.startsWith('https://');
}

function salesFor(url: string, about: string, by: string): Promise<PhotoSalesResponse | null> {
  if (!askable(url)) return Promise.resolve(null);
  const key = `${url}\n${about}\n${by}`;
  let answer = answers.get(key);
  if (answer) return answer;
  const kept = readKept()[key];
  if (kept && Date.now() - kept.at < KEPT_MS) {
    answer = Promise.resolve(kept.sales);
  } else {
    answer = new Promise<PhotoSalesResponse | null>((done) => {
      waiting.push({ key, ask: { url, about: about || undefined, by: by || undefined }, done });
      timer ??= window.setTimeout(send, BATCH_MS);
    }).then((sales) => {
      if (sales) keep(key, sales);
      return sales;
    });
  }
  answers.set(key, answer);
  // Forgotten in memory after the same few minutes, so a long-open page asks again.
  window.setTimeout(() => { if (answers.get(key) === answer) answers.delete(key); }, KEPT_MS);
  return answer;
}

/**
 * The product a listing sells, when it sells one thing: the photo needs no
 * reading, the system already knows. Null for a lot or a set of named things
 * (each is its own product, and the photo's page shows them all) and for a
 * listing not on a product yet. Kept per listing for a few minutes.
 */
const listingDnas = new Map<string, Promise<DnaSummary | null>>();
function singleDna(listingId: string): Promise<DnaSummary | null> {
  let answer = listingDnas.get(listingId);
  if (!answer) {
    answer = api.dnaOfListing(listingId)
      .then((found) => (found.items.length === 1 ? found.items[0]!.dna : null))
      .catch(() => null);
    listingDnas.set(listingId, answer);
    window.setTimeout(() => listingDnas.delete(listingId), KEPT_MS);
  }
  return answer;
}

/** The line under a single product's button: its price across shops, and how many shops. */
function productLine(dna: DnaSummary): string {
  const price = dna.lowMinor === null || dna.highMinor === null ? null
    : dna.lowMinor === dna.highMinor ? formatMoney(dna.lowMinor, dna.currency)
      : `${formatMoney(dna.lowMinor, dna.currency)} – ${formatMoney(dna.highMinor, dna.currency)}`;
  const line = [price, dna.sellers > 0 ? count(dna.sellers, 'shop') : null, dna.heatLabel !== 'Quiet' ? dna.heatLabel : null];
  return line.some(Boolean) ? line.filter(Boolean).join(' · ') : 'Prices, shops and owners';
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
    Math.max(found.things?.length ?? 0, found.items.length) > 1
      ? count(Math.max(found.things?.length ?? 0, found.items.length), 'product') + ' spotted' : null,
    live > 0 ? `${live} for sale` : listings.length > 0 ? count(listings.length, 'past listing') : null,
    found.sellers.length > 0 ? `${count(found.sellers.length, 'past seller')}` : null,
    probable > 0 ? `${count(probable, 'probable match', 'probable matches')}` : null,
    // Only worth the room when there is nothing more certain to say.
    listings.length === 0 && found.likely.length > 0 ? `${count(found.likely.length, 'shop')} could get this` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Who posted a photo, for "ask them about it". */
export interface PhotoPoster {
  name: string;
  handle: string | null;
  /** Where the photo is, so the question can point at it. */
  link?: string;
}

/** The questions a viewer most often has about somebody's photo, one tap each. */
const QUICK_ASKS = [
  'Can you bring it for me?',
  'Do you know who sells it?',
  'Where did you get it?',
  'Would you sell it?',
];

/** Where a photo's Product DNA page is: the photo, the words with it, and who posted it. */
export function photoDnaHref(url: string, about = '', by = '', poster: PhotoPoster | null = null): string {
  const query = new URLSearchParams({ u: url });
  if (about) query.set('a', about.slice(0, 300));
  if (by) query.set('b', by);
  if (poster?.name) query.set('pn', poster.name);
  if (poster?.handle) query.set('ph', poster.handle);
  if (poster?.link) query.set('pl', poster.link);
  return `/dna/photo?${query.toString()}`;
}

/**
 * The Product DNA button under a photo: every photo on Figmark carries one,
 * once it is known to hold something - a thing for sale, a shop that has
 * sold it, a likely match, or a poster to ask. It opens the photo's own
 * Product DNA page, where each thing in it is cut out and followed to its
 * product, and everything about where to get it is laid out.
 */
export function PhotoSales({ url, about = '', by = '', poster = null, onLeave, tone = 'dark', listingId }: {
  url: string | undefined;
  /**
   * The listing the photo is of. When it sells one thing, the button goes
   * straight to that product's DNA page; a lot or a set of several things
   * keeps the photo's own page, which shows each of them.
   */
  listingId?: string;
  /**
   * Who posted it. With nothing of theirs tagged on it, the page offers a
   * quick message to ask them - before it lists anybody else's.
   */
  poster?: PhotoPoster | null;
  /** The words shown with the photo - a caption, a title - searched alongside it. */
  about?: string;
  /** Who posted it: their own listings are the likelier guesses. */
  by?: string;
  /** Called as the button is followed, so whatever shows the photo can close. */
  onLeave?: () => void;
  /**
   * Over a dark photo viewer, in a light dialog, or under a photo in the feed -
   * where it waits until it is on screen and shows nothing while it looks.
   */
  tone?: 'dark' | 'light' | 'inline';
}) {
  const [found, setFound] = useState<{ url: string; sales: PhotoSalesResponse | null } | null>(null);
  const inline = tone === 'inline';
  const slot = useRef<HTMLDivElement>(null);
  // A feed is scrolled past far more than it is read: only ask about photos
  // within a screen of the view - far enough ahead that a scroll's worth go in one request.
  const [inView, setInView] = useState(!inline);

  useEffect(() => {
    const el = slot.current;
    if (inView || !el) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setInView(true); watch.disconnect(); }
    }, { rootMargin: '800px 0px' });
    watch.observe(el);
    return () => watch.disconnect();
  }, [inView]);

  // undefined: not known yet; null: not one thing (or no listing), so the photo is read.
  const [product, setProduct] = useState<{ id: string; dna: DnaSummary | null } | undefined>(undefined);
  useEffect(() => {
    if (!listingId || !inView) return;
    let live = true;
    void singleDna(listingId).then((dna) => { if (live) setProduct({ id: listingId, dna }); });
    return () => { live = false; };
  }, [listingId, inView]);
  const single = listingId && product?.id === listingId ? product.dna : null;
  const settled = !listingId || product?.id === listingId;

  useEffect(() => {
    if (!url || !inView || !settled || single) return;
    let live = true;
    void salesFor(url, about, by).then((sales) => { if (live) setFound({ url, sales }); });
    return () => { live = false; };
  }, [url, about, by, inView, settled, single]);

  const sales = found && found.url === url ? found.sales : null;
  const loading = !settled || (!single && Boolean(url) && found?.url !== url);
  const { user } = useSession();
  const own = sales?.own ?? [];
  // Somebody else's photo with nothing of theirs on it: they can be asked.
  const askable = Boolean(poster?.handle && by && user?.id !== by && own.length === 0);
  const any = Boolean(sales && (own.length > 0 || sales.items.length > 0 || sales.likely.length > 0
    || sales.probable.length > 0 || (sales.things?.length ?? 0) > 0));
  const line = sales ? (askable ? [any ? summary(sales) : '', `Ask ${poster!.name.split(' ')[0]}`].filter(Boolean).join(' · ') : barLine(sales, poster)) : '';
  const button = (
    <Link to={photoDnaHref(url ?? '', about, by, askable ? poster : null)} className={`pdna pdna--${tone}${own.length > 0 ? ' pdna--tagged' : ''}`}
      onClick={(event) => { event.stopPropagation(); onLeave?.(); }}
      onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>
      <span className="pdna__mark" aria-hidden="true">
        <span className="pdna__strand" /><span className="pdna__strand pdna__strand--b" />
        <Icon name="dna" size={16} />
      </span>
      <span className="pdna__text">
        <b>Product DNA</b>
        {line && <small>{line}</small>}
      </span>
      <Icon name="right" size={15} />
    </Link>
  );

  if (single) {
    // One thing, already known: its own product page, nothing to spot.
    const direct = (
      <Link to={`/dna/${encodeURIComponent(single.id)}`} className={`pdna pdna--${tone}`}
        onClick={(event) => { event.stopPropagation(); cameFromListing(listingId!); onLeave?.(); }}
        onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>
        <span className="pdna__mark" aria-hidden="true">
          <span className="pdna__strand" /><span className="pdna__strand pdna__strand--b" />
          <Icon name="dna" size={16} />
        </span>
        <span className="pdna__text">
          <b>Product DNA</b>
          <small>{productLine(single)}</small>
        </span>
        <Icon name="right" size={15} />
      </Link>
    );
    return inline ? <div ref={slot} className="psales-slot">{direct}</div> : direct;
  }
  if (inline) {
    return <div ref={slot} className="psales-slot">{!loading && sales && (any || askable) && button}</div>;
  }
  if (loading) {
    return (
      <div className={`psales psales--${tone} is-loading`} aria-live="polite">
        <span className="psales__dot" aria-hidden="true" />
        Reading this photo…
      </div>
    );
  }
  if (!url || !sales || !(any || askable)) return null;
  return button;
}

/**
 * The bar's words: the poster's own item when it is tagged - that is the
 * photo's answer - and otherwise what can be bought from anybody.
 */
function barLine(sales: PhotoSalesResponse, poster: PhotoPoster | null): string {
  const own = sales.own ?? [];
  if (own.length > 0) {
    const first = own[0]!;
    const more = own.length > 1 ? ` +${own.length - 1} more` : '';
    return `${first.title} · ${formatMoney(first.priceMinor, first.currency)}${more}${poster ? ` · from ${poster.name}` : ''}`;
  }
  return summary(sales);
}

/** A few words to the poster about their photo, sent as a message with the photo's link. */
function AskPoster({ poster, onLeave }: { poster: PhotoPoster; onLeave: () => void }) {
  const { user, promptAuth } = useSession();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(words: string) {
    const body = words.trim();
    if (!body || busy || !poster.handle) return;
    if (!user) { promptAuth(`Sign in to ask ${poster.name}.`); return; }
    setBusy(true);
    setError(null);
    try {
      const where = poster.link ? `\n\nAbout your photo: ${window.location.origin}${poster.link}` : '';
      await api.sendMessage(poster.handle, `${body}${where}`);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="psheet__asked" role="status">
        ✓ Sent to {poster.name}.{' '}
        <Link to={`/messages/${encodeURIComponent(poster.handle!)}`} onClick={onLeave}>Open the chat</Link>
      </p>
    );
  }
  return (
    <div className="psheet__ask">
      <div className="psheet__chips">
        {QUICK_ASKS.map((ask) => (
          <button key={ask} type="button" className="psheet__chip psheet__chip--ask" disabled={busy} onClick={() => void send(ask)}>
            {ask}
          </button>
        ))}
      </div>
      <form className="psheet__askrow" onSubmit={(event) => { event.preventDefault(); void send(text); }}>
        <input value={text} maxLength={500} onChange={(event) => setText(event.target.value)}
          placeholder={`Ask ${poster.name.split(' ')[0]} something else…`} aria-label={`Message ${poster.name}`} />
        <button type="submit" className="btn btn--sm" disabled={busy || !text.trim()}>
          <Icon name="send" size={14} /> Send
        </button>
      </form>
      {error && <p className="psheet__note" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Everything about where a photo's things can be had: the poster's own tagged
 * items, a quick question to the poster, every thing's listings on sale now
 * and before, the shops that sold them, the probable matches and the shops
 * likely to get them. The photo's Product DNA page lays it out.
 */
export function SalesDetails({ sales, poster, by, onLeave }: {
  sales: PhotoSalesResponse;
  /** Set when nothing of the poster's is tagged and they can be asked. */
  poster: PhotoPoster | null;
  by: string;
  onLeave?: () => void;
}) {
  const leave = () => onLeave?.();
  const several = sales.items.length > 1;
  const own = sales.own ?? [];
  const ownIds = new Set(own.map((listing) => listing.id));
  // Everybody else's items on sale now, from whatever matched: the next place to look.
  const othersNow = [
    ...sales.items.flatMap((item) => item.listings),
    ...sales.probable,
  ].filter((listing, at, all) => listing.onSale && listing.sellerId !== by && !ownIds.has(listing.id)
    && all.findIndex((other) => other.id === listing.id) === at).slice(0, 8);

  return (
    <div className="psheet__details">
        {own.length > 0 && (
          <section className="psheet__item psheet__item--own">
            <h3 className="psheet__label">🏷️ Tagged in this photo</h3>
            <p className="psheet__note">Matched to what {own[0]!.seller?.storefrontName ?? 'the poster'} sells.</p>
            {own.map((listing) => <SaleRow key={listing.id} listing={listing} onLeave={leave} />)}
          </section>
        )}

        {poster && (
          <section className="psheet__item psheet__item--ask">
            <h3 className="psheet__label">💬 Ask {poster.name}</h3>
            <p className="psheet__note">Nothing of theirs is tagged here. Ask them in a tap - it goes as a message with this photo.</p>
            <AskPoster poster={poster} onLeave={leave} />
          </section>
        )}

        {poster && othersNow.length > 0 && (
          <section className="psheet__item">
            <h3 className="psheet__label">Others selling it now</h3>
            {othersNow.map((listing) => <SaleRow key={listing.id} listing={listing} onLeave={leave} />)}
          </section>
        )}

        {!poster && sales.items.map((item, at) => {
          const live = item.listings.filter((listing) => listing.onSale && !ownIds.has(listing.id));
          const past = item.listings.filter((listing) => !listing.onSale && !ownIds.has(listing.id));
          if (live.length === 0 && past.length === 0) return null;
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

        {!poster && sales.probable.length > 0 && (
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
