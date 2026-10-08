import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError, api, type FeedListing, type SocialSearchResult } from '../api';
import { formatMoney } from '../format';
import { compressImage } from '../imageCompress';
import { Icon, Thumb, leadPhoto } from './ui';
import { SocialMatches, useSearchSheet } from './SocialChrome';

/** Items shown in the sheet; the rest are a tap away on the catalogue. */
const ITEMS_SHOWN = 6;

/**
 * Search everything, from the Buy, Sell and Services header.
 *
 * The social search's sheet - the field on the tab's own gradient, results as
 * you type - with items first, because items are what the marketplace is for,
 * and then the shops, people and forums the social search would have found.
 * Enter, or "See all", opens the full catalogue for the words, filters and all.
 *
 * The camera in the field searches with a photo instead, and the catalogue is
 * where that search shows: the sheet only takes the picture and hands it over.
 */
export function MarketSearch({ initial, onClose, onSubmit, onPhoto }: {
  initial: string;
  onClose: () => void;
  /** Show every item matching the words on the catalogue. */
  onSubmit: (term: string) => void;
  /** Show the catalogue ranked against this photo, as a data URL. Never uploaded or stored. */
  onPhoto: (dataUrl: string) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<FeedListing[] | null>(null);
  const [others, setOthers] = useState<SocialSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useSearchSheet(onClose);

  const pickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReading(true);
    try {
      onPhoto(await compressImage(file));
    } catch {
      setError('Could not read that photo. Try another one.');
      setReading(false);
    }
  };

  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setItems(null);
      setOthers(null);
      setBusy(false);
      return;
    }
    let live = true;
    setBusy(true);
    const timer = window.setTimeout(() => {
      // Either half can fail on its own; whatever came back is still shown.
      void Promise.allSettled([api.feed({ q: needle }), api.socialSearch(needle)]).then(([feed, social]) => {
        if (!live) return;
        setItems(feed.status === 'fulfilled' ? feed.value.listings : []);
        setOthers(social.status === 'fulfilled' ? social.value : null);
        const failed = feed.status === 'rejected' ? feed.reason : null;
        setError(failed ? (failed instanceof ApiRequestError ? failed.message : 'Search failed.') : null);
        setBusy(false);
      });
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  const open = (to: string) => {
    onClose();
    navigate(to);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(q.trim());
  };

  const needle = q.trim();
  const found = (items?.length ?? 0)
    + (others ? others.people.length + others.shops.length + others.forums.length : 0);
  const settled = needle && !busy && items !== null;

  return (
    <div className="socsearch mktsearch" role="dialog" aria-modal="true" aria-label="Search items, shops and people">
      <form className="socsearch__bar" onSubmit={submit} role="search">
        <label className="socsearch__field">
          <Icon name="search" size={17} />
          <input autoFocus value={q} onChange={(event) => setQ(event.target.value)} enterKeyHint="search"
            placeholder="Items, shops, people, forums…" aria-label="Search items, shops, people and forums" />
          {(busy || reading) && <span className="writer__spin socsearch__spin" aria-hidden="true" />}
          {q && !busy && (
            <button type="button" className="mktsearch__clear" aria-label="Clear search" onClick={() => setQ('')}>
              <Icon name="close" size={14} />
            </button>
          )}
          {!q && !reading && (
            <button type="button" className="mktsearch__camera" aria-label="Search with a photo"
              onClick={() => picker.current?.click()}>
              <Icon name="camera" size={18} />
            </button>
          )}
          <input ref={picker} type="file" accept="image/*" hidden onChange={(event) => void pickPhoto(event)} />
        </label>
        <button type="button" className="socsearch__close" onClick={onClose}>Cancel</button>
      </form>

      <div className="socsearch__body">
        {error && <p className="notice notice--error">{error}</p>}
        {!needle && (
          <div className="socsearch__intro">
            <span className="socsearch__glyph" aria-hidden="true"><Icon name="search" size={26} /></span>
            <strong>Find anything</strong>
            <span className="faint">Figures, kits, sneakers - and the shops, people and forums behind them.</span>
            <button type="button" className="mktsearch__byphoto" disabled={reading} onClick={() => picker.current?.click()}>
              <Icon name="camera" size={16} /> Search with a photo
            </button>
          </div>
        )}
        {settled && found === 0 && !error && <p className="socsearch__none">Nothing matches that yet.</p>}

        {items && items.length > 0 && (
          <section className="socsearch__group">
            <h2>Items</h2>
            {items.slice(0, ITEMS_SHOWN).map((item) => (
              <div key={item.id} className="socsearch__row">
                <button type="button" className="socsearch__open" onClick={() => open(`/listing/${item.id}`)}>
                  <Thumb className="thumb mktsearch__thumb" seed={item.id} label={item.title} photo={leadPhoto(item)} />
                  <span className="socsearch__who">
                    <strong>{item.title}</strong>
                    <span className="faint">
                      {item.seller ? `${item.seller.storefrontName || item.seller.displayName} · ` : ''}{item.category}
                    </span>
                  </span>
                </button>
                <span className="mktsearch__price">{formatMoney(item.priceMinor, item.currency)}</span>
              </div>
            ))}
            <button type="button" className="mktsearch__all" onClick={() => onSubmit(needle)}>
              {items.length > ITEMS_SHOWN ? `See all ${items.length} items` : 'Open in the catalogue'}
              <Icon name="right" size={14} />
            </button>
          </section>
        )}

        {others && <SocialMatches result={others} open={open} onError={setError} />}
      </div>
    </div>
  );
}
