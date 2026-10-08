import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiRequestError, api, type FeedListing, type PhotoMatch, type PhotoSearchResponse, type SocialSearchResult,
} from '../api';
import { formatMoney } from '../format';
import { compressImage } from '../imageCompress';
import { Icon, Thumb, leadPhoto } from './ui';
import { SocialMatches, useSearchSheet } from './SocialChrome';

/** Items shown in the sheet; the rest are a tap away on the catalogue. */
const ITEMS_SHOWN = 6;

const MATCH_LABEL: Record<PhotoMatch, string> = {
  same_photo: 'Same photo',
  looks_alike: 'Looks alike',
  described: 'Matches',
};

/** A search by photo: the picture as picked, and what came back for it. */
interface PhotoQuery {
  preview: string;
  result: PhotoSearchResponse | null;
}

/**
 * Search everything, from the Buy, Sell and Services header.
 *
 * The social search's sheet - the field on the tab's own gradient, results as
 * you type - with items first, because items are what the marketplace is for,
 * and then the shops, people and forums the social search would have found.
 * Enter, or "See all", opens the full catalogue for the words, filters and all.
 *
 * The camera in the field searches with a photo instead: the same picture
 * listed somewhere, or - where the API can read photos - the same item in
 * another picture. What it read is offered back as words, one tap from an
 * ordinary search.
 */
export function MarketSearch({ initial, onClose, onSubmit }: {
  initial: string;
  onClose: () => void;
  /** Show every item matching the words on the catalogue. */
  onSubmit: (term: string) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<FeedListing[] | null>(null);
  const [others, setOthers] = useState<SocialSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoQuery | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  /** Which photo search is current, so a slow earlier one cannot land over it. */
  const photoRun = useRef(0);

  useSearchSheet(onClose);

  const searchPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const run = ++photoRun.current;
    setQ('');
    setError(null);
    setPhotoBusy(true);
    try {
      const dataUrl = await compressImage(file);
      if (run !== photoRun.current) return;
      setPhoto({ preview: dataUrl, result: null });
      const result = await api.photoSearch(dataUrl);
      if (run !== photoRun.current) return;
      setPhoto({ preview: dataUrl, result });
    } catch (failed) {
      if (run !== photoRun.current) return;
      setPhoto(null);
      setError(failed instanceof ApiRequestError ? failed.message : 'Could not search with that photo.');
    } finally {
      if (run === photoRun.current) setPhotoBusy(false);
    }
  };

  const clearPhoto = () => {
    photoRun.current += 1;
    setPhoto(null);
    setPhotoBusy(false);
  };

  /** Leave the photo for words: typing, or a tap on what the photo was read as. */
  const searchWords = (words: string) => {
    clearPhoto();
    setQ(words);
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
  const photoItems = photo?.result?.listings ?? null;
  const described = photo?.result?.described ?? null;
  const spinning = busy || photoBusy;
  const found = (items?.length ?? 0)
    + (others ? others.people.length + others.shops.length + others.forums.length : 0);
  const settled = needle && !busy && items !== null;

  return (
    <div className="socsearch mktsearch" role="dialog" aria-modal="true" aria-label="Search items, shops and people">
      <form className="socsearch__bar" onSubmit={submit} role="search">
        <label className="socsearch__field">
          <Icon name="search" size={17} />
          {photo ? (
            <span className="mktsearch__shot">
              <img src={photo.preview} alt="" />
              <span>Your photo</span>
            </span>
          ) : (
            <input autoFocus value={q} onChange={(event) => setQ(event.target.value)} enterKeyHint="search"
              placeholder="Items, shops, people, forums…" aria-label="Search items, shops, people and forums" />
          )}
          {spinning && <span className="writer__spin socsearch__spin" aria-hidden="true" />}
          {(q || photo) && !spinning && (
            <button type="button" className="mktsearch__clear" aria-label="Clear search"
              onClick={() => (photo ? clearPhoto() : setQ(''))}>
              <Icon name="close" size={14} />
            </button>
          )}
          {!q && !photo && !spinning && (
            <button type="button" className="mktsearch__camera" aria-label="Search with a photo"
              onClick={() => picker.current?.click()}>
              <Icon name="camera" size={18} />
            </button>
          )}
          <input ref={picker} type="file" accept="image/*" hidden onChange={(event) => void searchPhoto(event)} />
        </label>
        <button type="button" className="socsearch__close" onClick={onClose}>Cancel</button>
      </form>

      <div className="socsearch__body">
        {error && <p className="notice notice--error">{error}</p>}
        {!needle && !photo && (
          <div className="socsearch__intro">
            <span className="socsearch__glyph" aria-hidden="true"><Icon name="search" size={26} /></span>
            <strong>Find anything</strong>
            <span className="faint">Figures, kits, sneakers - and the shops, people and forums behind them.</span>
            <button type="button" className="mktsearch__byphoto" onClick={() => picker.current?.click()}>
              <Icon name="camera" size={16} /> Search with a photo
            </button>
          </div>
        )}

        {photo && !photo.result && (
          <p className="socsearch__none">Looking for items like your photo…</p>
        )}
        {photo?.result && (
          <>
            {described && (
              <section className="socsearch__group">
                <h2>Looks like</h2>
                <div className="mktsearch__reads">
                  {described.query && (
                    <button type="button" className="mktsearch__read is-lead" onClick={() => searchWords(described.query)}>
                      <Icon name="search" size={13} /> {described.query}
                    </button>
                  )}
                  {described.keywords.filter((word) => word !== described.query).slice(0, 5).map((word) => (
                    <button key={word} type="button" className="mktsearch__read" onClick={() => searchWords(word)}>
                      {word}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {photoItems && photoItems.length === 0 && (
              <p className="socsearch__none">
                {photo.result.vision
                  ? 'Nothing like that is listed yet. Try a word search instead.'
                  : 'No item uses that photo yet. Try a word search instead.'}
              </p>
            )}
            {photoItems && photoItems.length > 0 && (
              <section className="socsearch__group">
                <h2>Items like your photo</h2>
                {photoItems.map((item) => (
                  <div key={item.id} className="socsearch__row">
                    <button type="button" className="socsearch__open" onClick={() => open(`/listing/${item.id}`)}>
                      <Thumb className="thumb mktsearch__thumb" seed={item.id} label={item.title} photo={leadPhoto(item)} />
                      <span className="socsearch__who">
                        <strong>{item.title}</strong>
                        <span className="faint">
                          <span className={`mktsearch__match is-${item.photoMatch}`}>{MATCH_LABEL[item.photoMatch]}</span>
                          {item.seller ? ` ${item.seller.storefrontName || item.seller.displayName} · ` : ' '}{item.category}
                        </span>
                      </span>
                    </button>
                    <span className="mktsearch__price">{formatMoney(item.priceMinor, item.currency)}</span>
                  </div>
                ))}
              </section>
            )}
          </>
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
