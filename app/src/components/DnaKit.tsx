import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DnaSummary } from '@shared/dna';
import type { RegionBox } from '@shared/models';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { useToast } from './Feedback';
import { Icon } from './Icon';
import { Modal } from './ui';
import { StoryTag, useStory } from './Story';
import { DnaVote } from './DnaCheck';
import { useSession } from '../session';
import '../styles/DnaKit.css';

/**
 * Product DNA, as every other screen shows it: a card under a listing or a
 * hunt, chips under a post, tiles in Discover, and the helix they all wear.
 *
 * It looks unlike the rest of the app on purpose - a dark lab plate, a
 * turning double helix, base-pair colours and a monospaced "sequence" - so a
 * product's shared page reads as something other than one shop's listing.
 * Every animation here stops under reduced motion (the stylesheet's own
 * `prefers-reduced-motion` blocks, which follow the app's motion switch).
 */

export const dnaHref = (id: string) => `/dna/${encodeURIComponent(id)}`;

/**
 * A photo, or one thing cut out of it. With `box` - left, top, width, height
 * as fractions of the photo - the thing fills the frame, a little room round
 * it, never past the photo's edge: a piece of a lot shown by itself until a
 * photo of it alone turns up. The frame takes its size from where it sits.
 */
export function CropPic({ src, box, alt = '', className = '' }: {
  src: string;
  box?: RegionBox | null;
  alt?: string;
  className?: string;
}) {
  if (!box) return <img src={src} alt={alt} loading="lazy" decoding="async" className={className || undefined} />;
  return <Cropped src={src} box={box} alt={alt} className={className} />;
}

function Cropped({ src, box, alt, className }: { src: string; box: RegionBox; alt: string; className: string }) {
  const frame = useRef<HTMLSpanElement>(null);
  const pic = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    const el = pic.current;
    // Already loaded from the cache before React listened.
    if (el?.complete && el.naturalWidth) setNatural({ w: el.naturalWidth, h: el.naturalHeight });
  }, [src]);

  let style: CSSProperties = { opacity: 0 };
  if (natural && size && size.w > 0 && size.h > 0) {
    const room = 0.08;
    const left = Math.max(0, box[0] - box[2] * room);
    const top = Math.max(0, box[1] - box[3] * room);
    const width = Math.min(1 - left, box[2] * (1 + 2 * room));
    const height = Math.min(1 - top, box[3] * (1 + 2 * room));
    const scale = Math.max(size.w / (width * natural.w), size.h / (height * natural.h));
    const w = natural.w * scale;
    const h = natural.h * scale;
    const x = Math.min(0, Math.max(size.w - w, size.w / 2 - (left + width / 2) * w));
    const y = Math.min(0, Math.max(size.h - h, size.h / 2 - (top + height / 2) * h));
    style = {
      position: 'absolute', left: x, top: y, width: w, height: h, maxWidth: 'none', maxHeight: 'none',
      objectFit: 'fill', borderRadius: 0, opacity: 1,
    };
  }
  return (
    <span ref={frame} className={`cropic ${className}`.trim()}>
      <img ref={pic} src={src} alt={alt} loading="lazy" decoding="async" style={style}
        onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} />
    </span>
  );
}

/** A short code from the id, drawn like a gene name: FGM·P3A9·K2. Decoration, not an identifier anybody types. */
export function sequenceOf(id: string): string {
  const clean = id.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `FGM·${clean.slice(1, 5)}·${clean.slice(5, 7)}`;
}

/**
 * The double helix: rungs whose ends swing in and out of phase, which reads as
 * the strands turning. Pure CSS - each rung is delayed by its place.
 */
export function DnaHelix({ rungs = 12, className = '', still = false }: {
  rungs?: number;
  className?: string;
  /** Drawn mid-turn and left there: a small mark beside text. */
  still?: boolean;
}) {
  return (
    <span className={`dnak__helix${still ? ' is-still' : ''} ${className}`} aria-hidden="true">
      {Array.from({ length: rungs }, (_, at) => (
        <span key={at} className="dnak__rung" style={{ ['--i' as string]: at, ['--n' as string]: rungs } as CSSProperties}>
          <span className="dnak__base dnak__base--a" />
          <span className="dnak__bond" />
          <span className="dnak__base dnak__base--b" />
        </span>
      ))}
    </span>
  );
}

/** Demand as a gel band: the further it runs, the hotter. */
export function HeatBand({ heat, label, compact = false }: { heat: number; label: string; compact?: boolean }) {
  return (
    <span className={`dnak__heat${compact ? ' dnak__heat--compact' : ''}`} data-level={heat >= 80 ? 4 : heat >= 55 ? 3 : heat >= 25 ? 2 : 1}
      title={`Demand ${heat}/100`}>
      <span className="dnak__heattrack"><span className="dnak__heatfill" style={{ ['--heat' as string]: `${heat}%` } as CSSProperties} /></span>
      <span className="dnak__heatlabel">{label}</span>
    </span>
  );
}

export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="dnak__stars" aria-label={`${value} out of 5`} style={{ ['--fill' as string]: `${(value / 5) * 100}%`, fontSize: size } as CSSProperties}>
      <span aria-hidden="true">★★★★★</span>
    </span>
  );
}

export function priceSpan(summary: DnaSummary): string | null {
  if (summary.lowMinor === null || summary.highMinor === null) return null;
  return summary.lowMinor === summary.highMinor
    ? formatMoney(summary.lowMinor, summary.currency)
    : `${formatMoney(summary.lowMinor, summary.currency)} – ${formatMoney(summary.highMinor, summary.currency)}`;
}

/**
 * The card a listing or a hunt carries: this product's shared page, with the
 * four things worth a glance - what it goes for, how many shops have it, how
 * wanted it is, and what people who have it say.
 */
export function DnaCard({ summary, lead = 'Product DNA' }: { summary: DnaSummary; lead?: string }) {
  const span = priceSpan(summary);
  return (
    <Link to={dnaHref(summary.id)} className="dnak__card" aria-label={`${lead}: ${summary.name}`}>
      <span className="dnak__cardglow" aria-hidden="true" />
      <DnaHelix rungs={9} className="dnak__cardhelix" />
      <span className="dnak__cardbody">
        <span className="dnak__eyebrow">
          <Icon name="dna" size={12} /> {lead} <span className="dnak__seq">{sequenceOf(summary.id)}</span>
        </span>
        <span className="dnak__cardname">{summary.name}</span>
        <span className="dnak__cardstats">
          {span && <span className="dnak__chip dnak__chip--price">{span}</span>}
          <span className="dnak__chip">{summary.sellers === 1 ? '1 shop' : `${summary.sellers} shops`}</span>
          {summary.rating !== null && (
            <span className="dnak__chip"><Stars value={summary.rating} /> {summary.rating.toFixed(1)}</span>
          )}
          {summary.mentions > 0 && <span className="dnak__chip">{summary.mentions} mention{summary.mentions === 1 ? '' : 's'}</span>}
        </span>
        <HeatBand heat={summary.heat} label={summary.heatLabel} compact />
      </span>
      <span className="dnak__cardgo" aria-hidden="true"><Icon name="right" size={16} /></span>
    </Link>
  );
}

/**
 * The DNA under a listing: one card, or one per named thing when its photo
 * holds several - a lot sold piece by piece, a set - each that thing's own
 * product page. Nothing at all for a listing that has none (a private deal).
 */
export function ListingDna({ listingId, onFound, vote = false }: {
  listingId: string;
  /** Ask the reader whether it is the right product (never the shop itself). */
  vote?: boolean;
  /** Told which DNA the listing is part of (the first, for a lot), so the page can point at it elsewhere. */
  onFound?: (dna: DnaSummary | null) => void;
}) {
  const [items, setItems] = useState<{ piece: string | null; title: string; dna: DnaSummary }[]>([]);
  const { user, promptAuth } = useSession();
  const tell = useRef(onFound);
  tell.current = onFound;
  useEffect(() => {
    let live = true;
    setItems([]);
    tell.current?.(null);
    void api.dnaOfListing(listingId).then((found) => {
      if (!live) return;
      setItems(found.items ?? (found.dna ? [{ piece: null, title: found.dna.name, dna: found.dna }] : []));
      tell.current?.(found.dna);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [listingId]);
  if (items.length === 0) return null;
  // One tile for every thing the listing sells, as many as its photo holds.
  if (!items.some((item) => item.piece !== null) || items.length === 1) {
    return (
      <div className="dnak__slot">
        <DnaCard summary={items[0]!.dna} />
        {vote && items[0]!.piece === null && <DnaVote listingId={listingId} signedIn={Boolean(user)}
          onSignIn={() => promptAuth('Sign in to say whether this is the right product.')} />}
      </div>
    );
  }
  return <div className="dnak__slot"><DnaShelf products={items.map((item) => item.dna)} /></div>;
}

/** Things on a shelf before "All": one row's worth on a phone. */
const SHELF_FIRST = 8;

/**
 * Every product in one photo, as a shelf: each thing cut out of the photo (or
 * shown by a better photo of it alone, once there is one), its name and what
 * it goes for, in one swipeable row - or all of them as a grid.
 */
export function DnaShelf({ products, title = 'In this photo' }: { products: DnaSummary[]; title?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? products : products.slice(0, SHELF_FIRST);
  return (
    <section className="dnak__shelf" aria-label={`Product DNA: ${title.toLowerCase()}`}>
      <header className="dnak__shelfhead">
        <DnaHelix rungs={5} still />
        <span className="dnak__shelftitle">
          <span className="dnak__eyebrow">Product DNA</span>
          <b>{products.length} {products.length === 1 ? 'thing' : 'things'} {title.toLowerCase()}</b>
        </span>
        {products.length > SHELF_FIRST && (
          <button type="button" className="dnak__shelfall" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? 'Fewer' : `All ${products.length}`}
          </button>
        )}
      </header>
      <ol className={`dnak__shelfrow${all ? ' is-all' : ''}`}>
        {shown.map((dna, at) => (
          <li key={`${dna.id}:${at}`} style={{ ['--i' as string]: Math.min(at, 8) } as CSSProperties}>
            <Link to={dnaHref(dna.id)} className="dnak__thing">
              <span className="dnak__thingpic">
                {dna.cover ? <CropPic src={dna.cover} box={dna.coverBox} /> : <DnaHelix rungs={6} still />}
                <span className="dnak__thingheat" data-heat={dna.heatLabel} title={dna.heatLabel} />
              </span>
              <span className="dnak__thingname">{dna.name}</span>
              <span className="dnak__thingmeta">
                {dna.lowMinor !== null ? <b>{formatMoney(dna.lowMinor, dna.currency)}</b> : <span>Not on sale</span>}
                <span>{dna.sellers === 1 ? '1 shop' : `${dna.sellers} shops`}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The DNA a hunt is for, when one stands out. Its hunter can point it at another. */
export function WantDna({ buyerId, wantId, title }: { buyerId: string; wantId: string; title: string }) {
  const [state, setState] = useState<{ dna: DnaSummary | null; yours: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const load = () => api.dnaOfWant(buyerId, wantId).then(setState).catch(() => undefined);
  useEffect(() => { void load(); }, [buyerId, wantId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null;
  return (
    <div className="dnak__slot">
      {state.dna && <DnaCard summary={state.dna} lead="Hunting this product" />}
      {state.yours && (
        <button type="button" className="dnak__fixbtn" onClick={() => setPicking(true)}>
          <Icon name="dna" size={13} /> {state.dna ? 'Not this product?' : 'Point this hunt at a product'}
        </button>
      )}
      {picking && (
        <DnaPicker title="Which product are you hunting?" seed={title} current={state.dna ? [state.dna] : []}
          onClose={() => setPicking(false)}
          onPick={async (to) => {
            await api.fixDna({ kind: 'want', id: wantId, partition: buyerId, action: 'move', to: to.id });
            setPicking(false);
            await load();
          }}
          onRemove={state.dna ? async (from) => {
            await api.fixDna({ kind: 'want', id: wantId, partition: buyerId, action: 'remove', from: from.id });
            await load();
          } : undefined} />
      )}
    </div>
  );
}

/**
 * The products a post is about, as chips under it: each thing its photos show
 * or its words name, up to five. Its author can tag more or take one off.
 */
export function PostDna({ channelId, postId, about }: { channelId: string; postId: string; about: string }) {
  const [state, setState] = useState<{ dnas: DnaSummary[]; yours: boolean } | null>(null);
  const [tagging, setTagging] = useState(false);
  const load = () => api.dnaOfPost(channelId, postId).then(setState).catch(() => undefined);
  useEffect(() => { void load(); }, [channelId, postId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state || (state.dnas.length === 0 && !state.yours)) return null;
  return (
    <div className="dnak__postrow" aria-label="Products in this post">
      <span className="dnak__postlabel"><DnaHelix rungs={5} still /> In this post</span>
      <div className="dnak__chips">
        {state.dnas.map((dna, at) => (
          <Link key={dna.id} to={dnaHref(dna.id)} className="dnak__pchip" style={{ ['--i' as string]: at } as CSSProperties}>
            {dna.cover ? <CropPic src={dna.cover} box={dna.coverBox} /> : <Icon name="dna" size={14} />}
            <span className="dnak__pchipname">{dna.name}</span>
            {dna.lowMinor !== null && <span className="dnak__pchipprice">{formatMoney(dna.lowMinor, dna.currency)}</span>}
          </Link>
        ))}
        {state.yours && (
          <button type="button" className="dnak__pchip dnak__pchip--add" onClick={() => setTagging(true)}>
            <Icon name="plus" size={13} /> {state.dnas.length ? 'Tag' : 'Tag products'}
          </button>
        )}
      </div>
      {tagging && (
        <DnaPicker title="What's in your post?" seed={about} current={state.dnas} many
          onClose={() => setTagging(false)}
          onPick={async (to) => {
            await api.fixDna({ kind: 'post', id: postId, partition: channelId, action: 'tag', to: to.id });
            await load();
          }}
          onRemove={async (from) => {
            await api.fixDna({ kind: 'post', id: postId, partition: channelId, action: 'remove', from: from.id });
            await load();
          }} />
      )}
    </div>
  );
}

/**
 * Find a product by name and pick it: tagging a post, pointing a hunt, or a
 * seller moving their listing. What it is on now is listed first, with a way
 * off where that is allowed.
 */
export function DnaPicker({
  title, seed, current, many = false, listingId, piece, onPick, onRemove, onClose, extra,
  exclude = [], suggested, suggestedLabel = 'Likely the same product', preview, confirmLabel = 'Confirm',
}: {
  title: string;
  seed: string;
  current: DnaSummary[];
  many?: boolean;
  /** Moving a listing: only products on the line its seller gave it. */
  listingId?: string;
  /** Moving one thing in a listing of several: the line that thing is on. */
  piece?: string | null;
  onPick: (dna: DnaSummary) => Promise<void>;
  onRemove?: (dna: DnaSummary) => Promise<void>;
  onClose: () => void;
  extra?: ReactNode;
  /** Never offered: the product this is about, for one. */
  exclude?: string[];
  /** Offered before any search, each with a short reason. */
  suggested?: { dna: DnaSummary; why: string }[] | null;
  suggestedLabel?: string;
  /** When set, picking shows this first: what will change, with Back and a confirm button. */
  preview?: (dna: DnaSummary) => ReactNode;
  confirmLabel?: string | ((dna: DnaSummary) => string);
}) {
  const toast = useToast();
  const [query, setQuery] = useState(() => seed.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' '));
  const [found, setFound] = useState<DnaSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [chosen, setChosen] = useState<DnaSummary | null>(null);

  useEffect(() => {
    const words = query.trim();
    if (!words) { setFound([]); return undefined; }
    const timer = window.setTimeout(() => {
      void api.dnaSearch(words, listingId, piece).then((answer) => setFound(answer.products)).catch(() => setFound([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, listingId, piece]);

  const run = async (id: string, work: () => Promise<void>, said: string) => {
    setBusy(id);
    try {
      await work();
      toast(said);
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not go through.', 'error');
    } finally {
      setBusy(null);
    }
  };
  const on = new Set(current.map((dna) => dna.id));
  const hidden = new Set(exclude);
  const tips = (suggested ?? []).filter((entry) => !hidden.has(entry.dna.id) && !on.has(entry.dna.id));
  const tipIds = new Set(tips.map((entry) => entry.dna.id));
  const shown = found?.filter((dna) => !hidden.has(dna.id) && !tipIds.has(dna.id));
  const choose = (dna: DnaSummary) => {
    if (preview) { setChosen(dna); return; }
    void run(dna.id, () => onPick(dna), many ? 'Tagged' : 'Done');
  };
  const row = (dna: DnaSummary, why?: string) => (
    <li key={dna.id}>
      <button type="button" className="dnak__result" disabled={busy !== null || on.has(dna.id)} onClick={() => choose(dna)}>
        {dna.cover ? <CropPic src={dna.cover} box={dna.coverBox} /> : <span className="dnak__resultblank"><Icon name="dna" size={16} /></span>}
        <span className="dnak__resulttext">
          <b>{dna.name}</b>
          <small>{[priceSpan(dna), `${dna.sellers} shop${dna.sellers === 1 ? '' : 's'}`, dna.category].filter(Boolean).join(' · ')}</small>
          {why && <span className="dnak__why">{why}</span>}
        </span>
        {on.has(dna.id) ? <Icon name="check" size={15} /> : preview ? <Icon name="right" size={15} /> : <Icon name="plus" size={15} />}
      </button>
    </li>
  );

  if (chosen && preview) {
    const label = typeof confirmLabel === 'function' ? confirmLabel(chosen) : confirmLabel;
    return (
      <Modal title={title} onClose={onClose}>
        <div className="dnak__picker">
          {preview(chosen)}
          <div className="dnak__confirm">
            <button type="button" className="btn btn--quiet" disabled={busy !== null} onClick={() => setChosen(null)}>Back</button>
            <button type="button" className="btn" disabled={busy !== null}
              onClick={() => void run(chosen.id, () => onPick(chosen), 'Done')}>
              {busy ? 'Working…' : label}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="dnak__picker">
        {current.length > 0 && (
          <ul className="dnak__pickcurrent">
            {current.map((dna) => (
              <li key={dna.id}>
                <span className="dnak__pickname"><Icon name="dna" size={13} /> {dna.name}</span>
                {onRemove && (
                  <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null}
                    onClick={() => void run(dna.id, () => onRemove(dna), 'Taken off')}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {suggested === null && <p className="dnak__hint">Looking for likely twins…</p>}
        {tips.length > 0 && (
          <div className="dnak__tips">
            <p className="dnak__tipslabel">{suggestedLabel}</p>
            <ul className="dnak__results">{tips.map((entry) => row(entry.dna, entry.why))}</ul>
          </div>
        )}
        <label className="dnak__search">
          <Icon name="search" size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name the product" aria-label="Product name" autoFocus={!tips.length} />
        </label>
        <ul className="dnak__results">
          {shown === undefined && <li className="dnak__hint">Looking…</li>}
          {shown?.length === 0 && <li className="dnak__hint">{tips.length ? 'Nothing else by that name.' : 'Nothing by that name yet. Products start when somebody lists one.'}</li>}
          {shown?.map((dna) => row(dna))}
        </ul>
        {extra}
      </div>
    </Modal>
  );
}

/**
 * Each kind of thing dressed as itself: a foil shimmer for cards, a blueprint
 * grid for model kits, stitching for sneakers, a pixel grid for games. Unknown
 * categories wear the plain lab plate.
 */
const THEMES: Record<string, { key: string; glyph: string }> = {
  Figures: { key: 'figures', glyph: '🦸' },
  'Model kits': { key: 'kits', glyph: '🛠️' },
  'Trading cards': { key: 'cards', glyph: '🃏' },
  'Anime merch': { key: 'anime', glyph: '🌸' },
  Sneakers: { key: 'sneakers', glyph: '👟' },
  Streetwear: { key: 'street', glyph: '🧢' },
  'Bags & watches': { key: 'luxe', glyph: '⌚' },
  Electronics: { key: 'tech', glyph: '⚡' },
  Beauty: { key: 'beauty', glyph: '💄' },
  Collectibles: { key: 'collect', glyph: '🏆' },
  'Books & manga': { key: 'books', glyph: '📚' },
  'Games & consoles': { key: 'games', glyph: '🎮' },
  'Home & decor': { key: 'home', glyph: '🪴' },
};
export const themeOf = (category: string) => THEMES[category] ?? { key: 'lab', glyph: '🧬' };

/** A product as a tile, for Discover's grid and rail, themed by its category. */
export function DnaTile({ summary, index = 0 }: { summary: DnaSummary; index?: number }) {
  const span = priceSpan(summary);
  const theme = themeOf(summary.category);
  return (
    <Link to={dnaHref(summary.id)} className="dnak__tile" data-theme={theme.key} style={{ ['--i' as string]: index } as CSSProperties}>
      <span className="dnak__tilepic">
        <span className="dnak__tilepattern" aria-hidden="true" />
        {summary.cover ? <CropPic src={summary.cover} box={summary.coverBox} /> : <DnaHelix rungs={10} />}
        <span className="dnak__tilescan" aria-hidden="true" />
        <span className="dnak__tileseq">{sequenceOf(summary.id)}</span>
        <span className="dnak__tileglyph" aria-hidden="true">{theme.glyph}</span>
      </span>
      <span className="dnak__tilebody">
        <span className="dnak__tilecat">{summary.category}</span>
        <span className="dnak__tilename">{summary.name}</span>
        {span && <span className="dnak__tileprice">{span}</span>}
        <span className="dnak__tilemeta">
          <span>{summary.sellers} shop{summary.sellers === 1 ? '' : 's'}</span>
          {summary.rating !== null && <span><Stars value={summary.rating} size={10} /> {summary.rating.toFixed(1)}</span>}
        </span>
        <HeatBand heat={summary.heat} label={summary.heatLabel} compact />
      </span>
    </Link>
  );
}

/** Discover's row of products people are after. Draws nothing until there are some. */
export function DnaRail({ category, onAll }: { category?: string | null; onAll: () => void }) {
  const [products, setProducts] = useState<DnaSummary[]>([]);
  const story = useStory('lab');
  useEffect(() => {
    void api.dnaTrending(category).then((answer) => setProducts(answer.products.slice(0, 12))).catch(() => undefined);
  }, [category]);
  if (products.length < 2) return null;
  return (
    <section ref={story.ref} className={`dnak__rail ${story.className}`} aria-label="Products">
      {story.scene}
      <StoryTag>Chapter · The lab</StoryTag>
      <h2 className="dnak__railhead">
        <DnaHelix rungs={6} still /> Product DNA
        <span className="dnak__railsub">what people are after</span>
        <button type="button" className="dnak__railall" onClick={onAll}>See all <Icon name="right" size={12} /></button>
      </h2>
      <div className="dnak__railrow story__row">
        {products.map((summary, at) => <DnaJar key={summary.id} summary={summary} index={at} />)}
      </div>
    </section>
  );
}

/**
 * A product on the lab bench: kept in a glass beaker - rim and spout, sheen,
 * measuring marks, a tinted liquid sloshing with bubbles rising, the product
 * floating in it - with what it is written on a specimen label stuck to the
 * glass. The lab rail's tile; the Products lens keeps the plain one.
 */
function DnaJar({ summary, index }: { summary: DnaSummary; index: number }) {
  const span = priceSpan(summary);
  const theme = themeOf(summary.category);
  return (
    <Link to={dnaHref(summary.id)} className="dnak__tile dnak__jar" data-theme={theme.key}
      style={{ ['--i' as string]: index } as CSSProperties}>
      <span className="dnak__jarrim" aria-hidden="true" />
      <span className="dnak__jarglass">
        <span className="dnak__jarliquid" aria-hidden="true"><i /></span>
        <span className="dnak__jarspecimen">
          {summary.cover ? <CropPic src={summary.cover} box={summary.coverBox} /> : <DnaHelix rungs={10} />}
        </span>
        <span className="dnak__jarbubbles" aria-hidden="true">{[0, 1, 2, 3].map((n) => <i key={n} />)}</span>
        <span className="dnak__jarticks" aria-hidden="true"><i>250</i><i>150</i><i>50</i></span>
        <span className="dnak__jarlabel">
          <span className="dnak__jarno">No. {sequenceOf(summary.id)} <span aria-hidden="true">{theme.glyph}</span></span>
          <span className="dnak__tilecat">{summary.category}</span>
          <span className="dnak__tilename">{summary.name}</span>
          {span && <span className="dnak__tileprice">{span}</span>}
          <span className="dnak__tilemeta">
            <span>{summary.sellers} shop{summary.sellers === 1 ? '' : 's'}</span>
            {summary.rating !== null && <span><Stars value={summary.rating} size={10} /> {summary.rating.toFixed(1)}</span>}
          </span>
          <HeatBand heat={summary.heat} label={summary.heatLabel} compact />
        </span>
        <span className="dnak__jarsheen" aria-hidden="true" />
      </span>
    </Link>
  );
}

/** Discover's Products lens: every product with something on it, hottest first. */
export function DnaProductsView({ category }: { category?: string | null }) {
  const [products, setProducts] = useState<DnaSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setProducts(null);
    void api.dnaTrending(category).then((answer) => setProducts(answer.products))
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load products.'));
  }, [category]);
  return (
    <section className="dnak__lens">
      <header className="dnak__lenshead">
        <DnaHelix rungs={14} className="dnak__lenshelix" />
        <div>
          <p className="dnak__eyebrow"><Icon name="dna" size={12} /> Product DNA</p>
          <h2 className="dnak__lenstitle">Every product, all in one place</h2>
          <p className="dnak__lenstext">Every shop selling it, what it sells for, who is hunting it and what owners say: one page per product.</p>
        </div>
      </header>
      {error && <p className="dnak__hint">{error}</p>}
      {!products && !error && (
        <div className="dnak__grid">{Array.from({ length: 6 }, (_, at) => <span key={at} className="dnak__tile dnak__tile--ghost" />)}</div>
      )}
      {products?.length === 0 && <p className="dnak__hint">No products yet. Each one starts the first time somebody lists it.</p>}
      {products && products.length > 0 && (
        <div className="dnak__grid">
          {products.map((summary, at) => <DnaTile key={summary.id} summary={summary} index={at} />)}
        </div>
      )}
    </section>
  );
}

/**
 * "Review this item" beside an order: the shop is reviewed where it always
 * was; the product itself is reviewed on its DNA.
 */
export function ReviewItemLink({ listingId, pieces }: {
  listingId: string;
  /** The things bought out of a lot: each is reviewed on its own product. */
  pieces?: string[] | null;
}) {
  const [found, setFound] = useState<{ id: string; title: string }[]>([]);
  const key = (pieces ?? []).join(',');
  useEffect(() => {
    void api.dnaOfListing(listingId).then((answer) => {
      const bought = new Set(key ? key.split(',') : []);
      const things = (answer.items ?? []).filter((item) => bought.size === 0 || (item.piece !== null && bought.has(item.piece)));
      const unique = new Map<string, string>();
      for (const item of things) if (!unique.has(item.dna.id)) unique.set(item.dna.id, item.title);
      // A set bought whole, or nothing said: each thing in it, else the listing's one.
      if (unique.size === 0 && answer.dna) unique.set(answer.dna.id, answer.dna.name);
      setFound([...unique].map(([id, title]) => ({ id, title })));
    }).catch(() => undefined);
  }, [listingId, key]);
  if (found.length === 0) return null;
  return (
    <>
      {found.map((thing) => (
        <Link key={thing.id} to={`${dnaHref(thing.id)}?review=1`} className="dnak__reviewlink">
          <DnaHelix rungs={5} still /> {found.length > 1 ? `Review ${thing.title}` : 'Review this item'}
          <small>on its Product DNA, for everyone who has one</small>
          <Icon name="right" size={14} />
        </Link>
      ))}
    </>
  );
}
