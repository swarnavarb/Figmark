import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DnaSummary } from '@shared/dna';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { useToast } from './Feedback';
import { Icon } from './Icon';
import { Modal } from './ui';
import { StoryTag, useStory } from './Story';
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

function priceSpan(summary: DnaSummary): string | null {
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

/** The DNA under a listing. Nothing at all for a listing that has none (a private deal). */
export function ListingDna({ listingId, onFound }: {
  listingId: string;
  /** Told which DNA the listing is part of, so the page can point at it elsewhere. */
  onFound?: (dna: DnaSummary | null) => void;
}) {
  const [summary, setSummary] = useState<DnaSummary | null>(null);
  const tell = useRef(onFound);
  tell.current = onFound;
  useEffect(() => {
    let live = true;
    setSummary(null);
    tell.current?.(null);
    void api.dnaOfListing(listingId).then((found) => {
      if (!live) return;
      setSummary(found.dna);
      tell.current?.(found.dna);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [listingId]);
  if (!summary) return null;
  return <div className="dnak__slot"><DnaCard summary={summary} /></div>;
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
            {dna.cover ? <img src={dna.cover} alt="" loading="lazy" decoding="async" /> : <Icon name="dna" size={14} />}
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
export function DnaPicker({ title, seed, current, many = false, listingId, onPick, onRemove, onClose, extra }: {
  title: string;
  seed: string;
  current: DnaSummary[];
  many?: boolean;
  /** Moving a listing: only products on the line its seller gave it. */
  listingId?: string;
  onPick: (dna: DnaSummary) => Promise<void>;
  onRemove?: (dna: DnaSummary) => Promise<void>;
  onClose: () => void;
  extra?: ReactNode;
}) {
  const toast = useToast();
  const [query, setQuery] = useState(() => seed.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' '));
  const [found, setFound] = useState<DnaSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const words = query.trim();
    if (!words) { setFound([]); return undefined; }
    const timer = window.setTimeout(() => {
      void api.dnaSearch(words, listingId).then((answer) => setFound(answer.products)).catch(() => setFound([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, listingId]);

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
        <label className="dnak__search">
          <Icon name="search" size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name the product" aria-label="Product name" autoFocus />
        </label>
        <ul className="dnak__results">
          {found === null && <li className="dnak__hint">Looking…</li>}
          {found?.length === 0 && <li className="dnak__hint">Nothing by that name yet. Products start when somebody lists one.</li>}
          {found?.map((dna) => (
            <li key={dna.id}>
              <button type="button" className="dnak__result" disabled={busy !== null || (on.has(dna.id) && !many) || on.has(dna.id)}
                onClick={() => void run(dna.id, () => onPick(dna), many ? 'Tagged' : 'Done')}>
                {dna.cover ? <img src={dna.cover} alt="" loading="lazy" decoding="async" /> : <span className="dnak__resultblank"><Icon name="dna" size={16} /></span>}
                <span className="dnak__resulttext">
                  <b>{dna.name}</b>
                  <small>{[priceSpan(dna), `${dna.sellers} shop${dna.sellers === 1 ? '' : 's'}`, dna.category].filter(Boolean).join(' · ')}</small>
                </span>
                {on.has(dna.id) ? <Icon name="check" size={15} /> : <Icon name="plus" size={15} />}
              </button>
            </li>
          ))}
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
        {summary.cover ? <img src={summary.cover} alt="" loading="lazy" decoding="async" /> : <DnaHelix rungs={10} />}
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
  const story = useStory('helix');
  useEffect(() => {
    void api.dnaTrending(category).then((answer) => setProducts(answer.products.slice(0, 12))).catch(() => undefined);
  }, [category]);
  if (products.length < 2) return null;
  return (
    <section ref={story.ref} className={`dnak__rail ${story.className}`} aria-label="Products">
      <StoryTag>Chapter · The lab</StoryTag>
      <h2 className="dnak__railhead">
        <DnaHelix rungs={6} still /> Product DNA
        <span className="dnak__railsub">what people are after</span>
        <button type="button" className="dnak__railall" onClick={onAll}>See all <Icon name="right" size={12} /></button>
      </h2>
      <div className="dnak__railrow story__row">
        {products.map((summary, at) => <DnaTile key={summary.id} summary={summary} index={at} />)}
      </div>
    </section>
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
export function ReviewItemLink({ listingId }: { listingId: string }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void api.dnaOfListing(listingId).then((found) => setId(found.dna?.id ?? null)).catch(() => undefined);
  }, [listingId]);
  if (!id) return null;
  return (
    <Link to={`${dnaHref(id)}?review=1`} className="dnak__reviewlink">
      <DnaHelix rungs={5} still /> Review this item
      <small>on its Product DNA, for everyone who has one</small>
      <Icon name="right" size={14} />
    </Link>
  );
}
