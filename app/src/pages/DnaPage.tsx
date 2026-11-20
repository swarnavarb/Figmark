import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { DnaListingCard, DnaSummary, DnaView } from '@shared/dna';
import { ApiRequestError, api } from '../api';
import { BackLink } from '../components/ScrollManager';
import { DnaHelix, DnaPicker, DnaTile, HeatBand, Stars, dnaHref, sequenceOf } from '../components/DnaKit';
import { useToast } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { ReviewPhotoPicker, ReviewPhotoStrip } from '../components/ReviewPhotos';
import { Lightbox } from '../components/SocialPost';
import { PageError } from '../components/ui';
import { formatMoney, timeAgo } from '../format';
import { useReducedMotion } from '../motion';
import { useSession } from '../session';
import '../styles/DnaPage.css';

/**
 * A product's DNA: everything Figmark knows about one product, from every
 * shop, post, hunt and review that is about it.
 *
 * Laid out as strands down a genome map - price, shops, demand, owners,
 * community, photos, facts, history - each one a coloured band that rises
 * into place as it scrolls in. A sticky row of strand pills jumps between
 * them. Nothing here is stored for the page: it is all worked out, when it
 * is read, from what is already on Figmark.
 */

const STRANDS = [
  { id: 'price', label: 'Price', base: 'A' },
  { id: 'shops', label: 'Shops', base: 'T' },
  { id: 'demand', label: 'Demand', base: 'G' },
  { id: 'reviews', label: 'Owners', base: 'C' },
  { id: 'community', label: 'Community', base: 'A' },
  { id: 'photos', label: 'Photos', base: 'T' },
  { id: 'facts', label: 'Facts', base: 'G' },
  { id: 'history', label: 'History', base: 'C' },
] as const;
type StrandId = (typeof STRANDS)[number]['id'];

/** Adds `is-in` to each strand as it scrolls into view, once. Everything is in at once without an observer. */
function useReveal(ready: boolean) {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = root.current;
    if (!ready || !host) return undefined;
    const targets = [...host.querySelectorAll<HTMLElement>('[data-reveal]')];
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('is-in'));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ready]);
  return root;
}

/** A number that counts up to itself the first time it is drawn; just the number under reduced motion. */
function CountUp({ value, format = (n: number) => n.toLocaleString('en-IN') }: { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced || value === 0) { setShown(value); return undefined; }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <>{format(shown)}</>;
}

function Strand({ id, base, title, note, children }: { id: StrandId; base: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section id={`strand-${id}`} className="dnap__strand" data-reveal data-base={base} aria-labelledby={`strand-${id}-title`}>
      <span className="dnap__node" aria-hidden="true"><span>{base}</span></span>
      <header className="dnap__strandhead">
        <h2 id={`strand-${id}-title`} className="dnap__strandtitle">{title}</h2>
        {note && <p className="dnap__strandnote">{note}</p>}
      </header>
      {children}
    </section>
  );
}

export function DnaPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<DnaView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const answer = await api.dna(id);
      if ('moved' in answer) {
        navigate(dnaHref(answer.moved), { replace: true });
        return;
      }
      setView(answer);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this product.');
    }
  }, [id, navigate]);

  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  const root = useReveal(Boolean(view));
  const reviewAsked = params.get('review') === '1';

  // Sent here to review it: straight to the form.
  useEffect(() => {
    if (!view || !reviewAsked) return;
    const target = document.getElementById('strand-reviews');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [view, reviewAsked]);

  if (error) return <main className="page"><BackLink to="/discover" title="Product DNA" /><PageError message={error} /></main>;
  if (!view) return <DnaSkeleton />;

  const { dna, price } = view;
  return (
    <main className="page dnap" ref={root}>
      <BackLink to="/discover?lens=products" title={<span className="dnap__backtitle"><Icon name="dna" size={15} /> Product DNA</span>} />
      <Hero view={view} />
      <StrandNav view={view} />

      <div className="dnap__genome">
        <span className="dnap__spine" aria-hidden="true" />

        <Strand id="price" base="A" title="What it sells for"
          note={price ? `${price.onSale} on sale now${price.shippingMinor !== null ? ` · shipping usually ${price.shippingMinor === 0 ? 'free' : formatMoney(price.shippingMinor, price.currency)}` : ''}` : 'Nobody has it on sale right now.'}>
          <PriceStrand view={view} />
        </Strand>

        <Strand id="shops" base="T" title="Who has it" note="Selling now, sold it before, and shops that could get it.">
          <ShopsStrand view={view} />
        </Strand>

        <Strand id="demand" base="G" title="How wanted it is" note="From what people do here: hunts, saves, views, sales.">
          <DemandStrand view={view} />
        </Strand>

        <Strand id="reviews" base="C" title="What owners say"
          note="Anyone can review it. People who bought it on Figmark are marked as owners.">
          <ReviewsStrand view={view} dnaId={dna.id} open={reviewAsked} onWritten={async () => {
            if (reviewAsked) { const next = new URLSearchParams(params); next.delete('review'); setParams(next, { replace: true }); }
            await load();
          }} />
        </Strand>

        {(view.posts.length > 0 || view.hunts.length > 0) && (
          <Strand id="community" base="A" title="Talked about" note="Posts that show it, and people hunting for one.">
            <CommunityStrand view={view} />
          </Strand>
        )}

        {view.gallery.length > 0 && (
          <Strand id="photos" base="T" title="Seen in the wild" note="From listings, posts, hunts and buyers' own photos.">
            <GalleryStrand view={view} />
          </Strand>
        )}

        <Strand id="facts" base="G" title="Facts" note="Pieced together from every listing of it.">
          <FactsStrand view={view} />
        </Strand>

        {view.timeline.length > 0 && (
          <Strand id="history" base="C" title="Its story here">
            <Timeline view={view} />
          </Strand>
        )}
      </div>

      <FixPanel view={view} onChanged={load} />

      {view.related.length > 0 && (
        <section className="dnap__related" data-reveal>
          <h2 className="dnap__relatedtitle"><DnaHelix rungs={6} still /> More in {dna.category}</h2>
          <div className="dnap__relatedrow">
            {view.related.map((summary, at) => <DnaTile key={summary.id} summary={summary} index={at} />)}
          </div>
        </section>
      )}
    </main>
  );
}

/* ---- hero ------------------------------------------------------------------ */

function Hero({ view }: { view: DnaView }) {
  const { dna, price, rating, demand } = view;
  return (
    <header className="dnap__hero">
      <div className="dnap__heroplate" aria-hidden="true">
        <span className="dnap__orb dnap__orb--a" />
        <span className="dnap__orb dnap__orb--b" />
      </div>
      <div className="dnap__specimen">
        {dna.cover ? <img src={dna.cover} alt="" decoding="async" /> : <DnaHelix rungs={14} className="dnap__specimenhelix" />}
        <span className="dnap__scanline" aria-hidden="true" />
        <span className="dnap__corner dnap__corner--tl" aria-hidden="true" />
        <span className="dnap__corner dnap__corner--br" aria-hidden="true" />
      </div>
      <div className="dnap__herotext">
        <p className="dnap__seqline">
          <span className="dnap__seq">{sequenceOf(dna.id)}</span>
          <span className="dnap__cat">{dna.category}</span>
        </p>
        <h1 className="dnap__name">
          {dna.name.split(' ').map((word, at) => (
            <span key={`${word}${at}`} className="dnap__word" style={{ ['--i' as string]: at } as CSSProperties}>{word} </span>
          ))}
        </h1>
        <div className="dnap__vitals">
          <div className="dnap__vital">
            <span className="dnap__vitallabel">Typical price</span>
            <span className="dnap__vitalvalue dnap__mono">
              {price ? <CountUp value={price.typicalMinor} format={(n) => formatMoney(n, price.currency)} /> : '—'}
            </span>
          </div>
          <div className="dnap__vital">
            <span className="dnap__vitallabel">Shops now</span>
            <span className="dnap__vitalvalue"><CountUp value={view.sellingNow.length} /></span>
          </div>
          <div className="dnap__vital">
            <span className="dnap__vitallabel">Owners rate it</span>
            <span className="dnap__vitalvalue">
              {rating.average !== null ? <><Stars value={rating.average} size={14} /> {rating.average.toFixed(1)}</> : <span className="dnap__dim">No reviews</span>}
            </span>
          </div>
        </div>
        <HeatBand heat={demand.heat} label={demand.label} />
      </div>
    </header>
  );
}

function StrandNav({ view }: { view: DnaView }) {
  const shown = STRANDS.filter((strand) => (strand.id !== 'community' || view.posts.length + view.hunts.length > 0)
    && (strand.id !== 'photos' || view.gallery.length > 0) && (strand.id !== 'history' || view.timeline.length > 0));
  return (
    <nav className="dnap__nav" aria-label="Strands">
      {shown.map((strand, at) => (
        <a key={strand.id} href={`#strand-${strand.id}`} className="dnap__navpill" data-base={strand.base}
          style={{ ['--i' as string]: at } as CSSProperties}
          onClick={(event) => {
            event.preventDefault();
            document.getElementById(`strand-${strand.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>
          <span className="dnap__navbase">{strand.base}</span>{strand.label}
        </a>
      ))}
    </nav>
  );
}

/* ---- price ----------------------------------------------------------------- */

function PriceStrand({ view }: { view: DnaView }) {
  const { price, trend, gap, sellingNow } = view;
  if (!price) return <p className="dnap__empty">When a shop lists it again, its price shows here.</p>;
  const span = Math.max(1, price.highMinor - price.lowMinor);
  const at = (minor: number) => `${((minor - price.lowMinor) / span) * 100}%`;
  return (
    <div className="dnap__price">
      <div className="dnap__range" role="img"
        aria-label={`From ${formatMoney(price.lowMinor, price.currency)} to ${formatMoney(price.highMinor, price.currency)}, typically ${formatMoney(price.typicalMinor, price.currency)}`}>
        <div className="dnap__rangetrack">
          {sellingNow.map((listing, n) => (
            <span key={listing.id} className="dnap__rangedot" data-deal={listing.deal ?? 'fair'}
              style={{ left: price.highMinor === price.lowMinor ? '50%' : at(listing.priceMinor), ['--i' as string]: n } as CSSProperties} />
          ))}
          <span className="dnap__rangetypical" style={{ left: price.highMinor === price.lowMinor ? '50%' : at(price.typicalMinor) }}>
            <span>typical</span>
          </span>
        </div>
        <div className="dnap__rangeends dnap__mono">
          <span>{formatMoney(price.lowMinor, price.currency)}</span>
          <span>{formatMoney(price.highMinor, price.currency)}</span>
        </div>
      </div>
      {trend.length > 0 ? <TrendChart trend={trend} currency={price.currency} /> : (
        <p className="dnap__empty">No sales here yet: its price trend starts with the first one.</p>
      )}
      {gap && (
        <div className="dnap__gap">
          <div><span className="dnap__vitallabel">Hunters offer</span><b className="dnap__mono">{formatMoney(gap.offerMinor, price.currency)}</b></div>
          <span className="dnap__gaparrow" aria-hidden="true">{gap.offerMinor >= gap.askMinor ? '⇄' : '→'}</span>
          <div><span className="dnap__vitallabel">Shops ask</span><b className="dnap__mono">{formatMoney(gap.askMinor, price.currency)}</b></div>
          <p className="dnap__gapnote">
            {gap.offerMinor >= gap.askMinor
              ? `${gap.hunts} hunter${gap.hunts === 1 ? ' would' : 's would'} pay what shops ask.`
              : `A ${Math.round((1 - gap.offerMinor / gap.askMinor) * 100)}% gap between ${gap.hunts} hunter${gap.hunts === 1 ? '' : 's'} and the shops.`}
          </p>
        </div>
      )}
    </div>
  );
}

function TrendChart({ trend, currency }: { trend: DnaView['trend']; currency: string }) {
  const width = 320;
  const height = 120;
  const values = trend.map((point) => point.minor);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max(1, (high - low) * 0.15);
  const y = (value: number) => height - 14 - ((value - (low - pad)) / (high - low + pad * 2)) * (height - 28);
  const x = (index: number) => (trend.length === 1 ? width / 2 : 12 + (index / (trend.length - 1)) * (width - 24));
  const line = trend.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.minor).toFixed(1)}`).join(' ');
  const area = `${line} L${x(trend.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  const last = trend[trend.length - 1]!;
  const first = trend[0]!;
  const change = first.minor ? Math.round(((last.minor - first.minor) / first.minor) * 100) : 0;
  return (
    <figure className="dnap__trend">
      <figcaption className="dnap__trendhead">
        <span>Sold for, week by week</span>
        {trend.length > 1 && (
          <span className={`dnap__trendchange${change > 0 ? ' is-up' : change < 0 ? ' is-down' : ''}`}>
            {change > 0 ? '▲' : change < 0 ? '▼' : '■'} {Math.abs(change)}%
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="dnap__trendsvg" role="img"
        aria-label={`Latest week sold for ${formatMoney(last.minor, currency)}, ${last.sales} sale${last.sales === 1 ? '' : 's'}`}>
        <defs>
          <linearGradient id="dnap-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(6,214,231,0.35)" />
            <stop offset="100%" stopColor="rgba(6,214,231,0)" />
          </linearGradient>
          <linearGradient id="dnap-trend-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#06D6E7" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#dnap-trend-fill)" className="dnap__trendarea" />
        <path d={line} fill="none" stroke="url(#dnap-trend-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} className="dnap__trendline" />
        {trend.map((point, index) => (
          <circle key={point.at} cx={x(index)} cy={y(point.minor)} r={index === trend.length - 1 ? 4.5 : 2.5}
            className={index === trend.length - 1 ? 'dnap__trendlast' : 'dnap__trenddot'}>
            <title>{`Week of ${point.at}: ${formatMoney(point.minor, currency)} · ${point.sales} sold`}</title>
          </circle>
        ))}
      </svg>
      <div className="dnap__trendfoot dnap__mono">
        <span>{first.at}</span>
        <span>{formatMoney(last.minor, currency)} · {last.sales} sold</span>
      </div>
    </figure>
  );
}

/* ---- shops ------------------------------------------------------------------ */

const DEAL_WORDS: Record<NonNullable<DnaListingCard['deal']>, string> = { low: 'Below typical', fair: 'Typical', high: 'Above typical' };

function ShopsStrand({ view }: { view: DnaView }) {
  const { sellingNow, soldBefore, couldGet } = view;
  return (
    <div className="dnap__shops">
      {sellingNow.length > 0 ? (
        <ol className="dnap__offers">
          {sellingNow.map((listing, at) => (
            <li key={listing.id} style={{ ['--i' as string]: at } as CSSProperties}>
              <Link to={`/listing/${encodeURIComponent(listing.id)}`} className="dnap__offer">
                <span className="dnap__offerpic">{listing.photoUrl ? <img src={listing.photoUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="box" size={20} />}</span>
                <span className="dnap__offertext">
                  <b>{listing.shop?.name ?? 'A shop'}</b>
                  <small>{listing.condition}{listing.shippingMinor !== null ? ` · ${listing.shippingMinor === 0 ? 'free shipping' : `+${formatMoney(listing.shippingMinor, listing.currency)} shipping`}` : ''}</small>
                </span>
                <span className="dnap__offerprice">
                  <b className="dnap__mono">{formatMoney(listing.priceMinor, listing.currency)}</b>
                  {listing.deal && <span className="dnap__deal" data-deal={listing.deal}>{DEAL_WORDS[listing.deal]}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : <p className="dnap__empty">Nobody has it on sale right now.</p>}
      {soldBefore.length > 0 && (
        <div className="dnap__shopgroup">
          <h3 className="dnap__subhead">Sold it before</h3>
          <div className="dnap__shopchips">
            {soldBefore.map(({ shop, units }) => (
              <ShopChip key={shop.id} shop={shop} note={`${units} sold`} />
            ))}
          </div>
        </div>
      )}
      {couldGet.length > 0 && (
        <div className="dnap__shopgroup">
          <h3 className="dnap__subhead">Could get it</h3>
          <div className="dnap__shopchips">
            {couldGet.map(({ shop, because }) => <ShopChip key={shop.id} shop={shop} note={because} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ShopChip({ shop, note }: { shop: DnaView['soldBefore'][number]['shop']; note: string }) {
  const body = (
    <>
      <span className="dnap__shopavatar">{shop.photoUrl ? <img src={shop.photoUrl} alt="" loading="lazy" decoding="async" /> : shop.name.charAt(0)}</span>
      <span className="dnap__shoptext"><b>{shop.name}</b><small>{note}</small></span>
    </>
  );
  return shop.handle
    ? <Link to={`/${encodeURIComponent(shop.handle)}`} className="dnap__shopchip">{body}</Link>
    : <span className="dnap__shopchip">{body}</span>;
}

/* ---- demand ----------------------------------------------------------------- */

function DemandStrand({ view }: { view: DnaView }) {
  const { demand } = view;
  const cells: { label: string; value: number; icon: Parameters<typeof Icon>[0]['name'] }[] = [
    { label: 'Hunting it', value: demand.hunting, icon: 'target' },
    { label: 'Saved', value: demand.saves, icon: 'heart' },
    { label: 'Views', value: demand.views, icon: 'eye' },
    { label: 'Sold here', value: demand.sold, icon: 'check' },
    { label: 'Pre-ordered', value: demand.pledged, icon: 'box' },
    { label: 'Waiting for restock', value: demand.waiting, icon: 'bell' },
  ];
  return (
    <div className="dnap__demand">
      <div className="dnap__gauge" data-level={demand.heat >= 80 ? 4 : demand.heat >= 55 ? 3 : demand.heat >= 25 ? 2 : 1}
        style={{ ['--heat' as string]: demand.heat } as CSSProperties} role="img" aria-label={`Demand ${demand.heat} out of 100: ${demand.label}`}>
        <svg viewBox="0 0 120 70" aria-hidden="true">
          <path d="M10 64 A50 50 0 0 1 110 64" className="dnap__gaugetrack" pathLength={100} />
          <path d="M10 64 A50 50 0 0 1 110 64" className="dnap__gaugefill" pathLength={100} />
        </svg>
        <span className="dnap__gaugevalue"><CountUp value={demand.heat} /></span>
        <span className="dnap__gaugelabel">{demand.label}</span>
      </div>
      <ul className="dnap__cells">
        {cells.map((cell, at) => (
          <li key={cell.label} className={cell.value === 0 ? 'is-zero' : ''} style={{ ['--i' as string]: at } as CSSProperties}>
            <Icon name={cell.icon} size={15} />
            <b><CountUp value={cell.value} /></b>
            <span>{cell.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- reviews ---------------------------------------------------------------- */

function ReviewsStrand({ view, dnaId, open, onWritten }: { view: DnaView; dnaId: string; open: boolean; onWritten: () => Promise<void> }) {
  const { rating, reviews } = view;
  const { user, promptAuth } = useSession();
  const [writing, setWriting] = useState(open);
  useEffect(() => { if (open) setWriting(true); }, [open]);
  const spread = useMemo(() => [5, 4, 3, 2, 1].map((stars) => ({ stars, count: reviews.filter((review) => review.rating === stars).length })), [reviews]);
  return (
    <div className="dnap__reviews">
      {rating.count > 0 && <div className="dnap__score">
        <div className="dnap__scorebig">
          <b>{rating.average !== null ? rating.average.toFixed(1) : '–'}</b>
          {rating.average !== null && <Stars value={rating.average} size={16} />}
          <small>{rating.count} review{rating.count === 1 ? '' : 's'}{rating.owners > 0 ? ` · ${rating.owners} from owners` : ''}</small>
        </div>
        {rating.count > 0 && (
          <ul className="dnap__bars">
            {spread.map((row) => (
              <li key={row.stars}>
                <span>{row.stars}★</span>
                <span className="dnap__bar"><span style={{ ['--w' as string]: `${(row.count / Math.max(1, rating.count)) * 100}%` } as CSSProperties} /></span>
                <span className="dnap__barcount">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>}
      {writing ? (
        <ReviewForm dnaId={dnaId} view={view} onDone={async () => { setWriting(false); await onWritten(); }} onCancel={() => setWriting(false)} />
      ) : (
        <button type="button" className="dnap__write" onClick={() => (user ? setWriting(true) : promptAuth('Sign in to review this product.'))}>
          <Icon name="compose" size={15} /> {view.yours ? 'Edit your review' : 'Review this product'}
        </button>
      )}
      {reviews.length === 0 ? <p className="dnap__empty">No reviews yet. Have one? Be the first.</p> : (
        <ul className="dnap__reviewlist">
          {reviews.map((review, at) => (
            <li key={review.id} id={`review-${review.id}`} className="dnap__review" style={{ ['--i' as string]: Math.min(at, 8) } as CSSProperties}>
              <header className="dnap__reviewhead">
                <span className="dnap__reviewer">
                  {review.authorHandle ? <Link to={`/${encodeURIComponent(review.authorHandle)}`}>{review.authorName}</Link> : review.authorName}
                </span>
                {review.owner && (
                  <span className="dnap__owner" title={`Bought on Figmark from ${review.owner.shop}`}>
                    <Icon name="check" size={11} /> Owner · bought from {review.owner.handle
                      ? <Link to={`/${encodeURIComponent(review.owner.handle)}`}>{review.owner.shop}</Link> : review.owner.shop}
                  </span>
                )}
                {review.mine && <span className="dnap__mine">You</span>}
              </header>
              <div className="dnap__reviewstars"><Stars value={review.rating} size={13} /> <time dateTime={review.createdAt}>{timeAgo(review.createdAt)}</time></div>
              <p className="dnap__reviewbody">{review.body}</p>
              <ReviewPhotoStrip photos={review.photoUrls} about={view.dna.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewForm({ dnaId, view, onDone, onCancel }: { dnaId: string; view: DnaView; onDone: () => Promise<void>; onCancel: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(view.yours?.rating ?? 0);
  const [text, setText] = useState(view.yours?.body ?? '');
  const [photos, setPhotos] = useState<string[]>(view.yours?.photoUrls ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (rating < 1) { setError('Pick how many stars.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.reviewDna(dnaId, { rating, body: text.trim(), photoUrls: photos });
      toast(view.yours ? 'Review updated' : 'Thanks - your review is up');
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="dnap__form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <p className="dnap__formnote">
        {view.youOwn
          ? <><Icon name="check" size={13} /> You bought this from {view.youOwn.shop}: your review shows you as an owner.</>
          : 'Reviewing the product itself. The shop you bought from is reviewed on your order, as always.'}
      </p>
      <div className="dnap__starpick" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className={`dnap__starbtn${n <= rating ? ' is-on' : ''}`} style={{ ['--i' as string]: n } as CSSProperties}
            onClick={() => setRating(n)}>★</button>
        ))}
      </div>
      <textarea className="dnap__textarea" value={text} onChange={(event) => setText(event.target.value)} maxLength={800} rows={4}
        placeholder="How is it in hand? Quality, size, anything you wish you had known." aria-label="Your review" />
      <ReviewPhotoPicker value={photos} onChange={setPhotos} disabled={busy} />
      {error && <p className="dnap__error" role="alert">{error}</p>}
      <div className="dnap__formacts">
        <button type="button" className="btn btn--quiet" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Sending…' : view.yours ? 'Update review' : 'Post review'}</button>
      </div>
    </form>
  );
}

/* ---- community, photos, facts, history ------------------------------------- */

function CommunityStrand({ view }: { view: DnaView }) {
  return (
    <div className="dnap__community">
      {view.hunts.length > 0 && (
        <ul className="dnap__hunts">
          {view.hunts.map((hunt) => (
            <li key={hunt.id}>
              <Link to={`/social?view=wanted&want=${encodeURIComponent(hunt.id)}&buyer=${encodeURIComponent(hunt.buyerId)}`} className="dnap__hunt">
                <Icon name="target" size={15} />
                <span className="dnap__hunttext"><b>{hunt.title}</b><small>{hunt.hunters} hunting · {timeAgo(hunt.createdAt)}</small></span>
                <span className="dnap__mono dnap__huntbudget">{hunt.budgetMinor ? formatMoney(hunt.budgetMinor, hunt.currency) : 'Open budget'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {view.posts.length > 0 && (
        <div className="dnap__posts">
          {view.posts.map((post, at) => (
            <Link key={post.id} to={`/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`} className="dnap__post"
              style={{ ['--i' as string]: Math.min(at, 8) } as CSSProperties}>
              {post.photoUrl && <img src={post.photoUrl} alt="" loading="lazy" decoding="async" />}
              <span className="dnap__postbody">
                <b>{post.authorName}</b>
                <span>{post.body}</span>
                <small><Icon name="heart" size={11} /> {post.likeCount} · <Icon name="message" size={11} /> {post.replyCount} · {timeAgo(post.createdAt)}</small>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const FROM_WORDS: Record<DnaView['gallery'][number]['from'], string> = {
  listing: 'Listing', post: 'Post', review: 'Owner', hunt: 'Hunt', buyer: 'Buyer',
};

/**
 * Each photo opens what it came from - the listing, the post, the hunt - and
 * an owner's photo scrolls to their review. Only a photo with nowhere to go
 * opens full screen.
 */
function GalleryStrand({ view }: { view: DnaView }) {
  const [open, setOpen] = useState<{ at: number; origin: DOMRect } | null>(null);
  const loose = view.gallery.filter((photo) => !photo.href);
  const toReview = (hash: string) => {
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('is-flash');
    void target.offsetWidth;
    target.classList.add('is-flash');
  };
  return (
    <>
      <div className="dnap__gallery">
        {view.gallery.map((photo, at) => {
          const inner = (
            <>
              <img src={photo.url} alt="" loading="lazy" decoding="async" />
              <span className="dnap__shottag" data-from={photo.from}>{FROM_WORDS[photo.from]}<Icon name="right" size={10} /></span>
            </>
          );
          const style = { ['--i' as string]: Math.min(at, 12) } as CSSProperties;
          const label = `${FROM_WORDS[photo.from]}: open where this photo is from`;
          if (photo.href?.startsWith('#')) {
            return <button key={photo.url} type="button" className="dnap__shot" style={style} aria-label={label}
              onClick={() => toReview(photo.href!)}>{inner}</button>;
          }
          if (photo.href) return <Link key={photo.url} to={photo.href} className="dnap__shot" style={style} aria-label={label}>{inner}</Link>;
          return (
            <button key={photo.url} type="button" className="dnap__shot dnap__shot--zoom" style={style} aria-label="Open photo"
              onClick={(event) => setOpen({ at: loose.indexOf(photo), origin: event.currentTarget.getBoundingClientRect() })}>{inner}</button>
          );
        })}
      </div>
      {open && <Lightbox photos={loose.map((photo) => photo.url)} start={open.at} origin={open.origin} about={view.dna.name} onClose={() => setOpen(null)} />}
    </>
  );
}

function FactsStrand({ view }: { view: DnaView }) {
  return (
    <div className="dnap__facts">
      <dl className="dnap__factlist">
        {view.facts.map((fact, at) => (
          <div key={fact.label} style={{ ['--i' as string]: at } as CSSProperties}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {view.background && (
        <blockquote className="dnap__background">
          <p>{view.background.text}</p>
          <footer>Source: {view.background.source}</footer>
        </blockquote>
      )}
    </div>
  );
}

const KIND_ICONS: Record<DnaView['timeline'][number]['kind'], Parameters<typeof Icon>[0]['name']> = {
  born: 'spark', listed: 'tag', sold: 'check', low: 'down', high: 'up', post: 'camera', hunt: 'target', review: 'star',
};

function Timeline({ view }: { view: DnaView }) {
  return (
    <ol className="dnap__timeline">
      {view.timeline.map((entry, at) => (
        <li key={`${entry.kind}${entry.at}`} style={{ ['--i' as string]: at } as CSSProperties}>
          <span className="dnap__tick" data-kind={entry.kind}><Icon name={KIND_ICONS[entry.kind]} size={12} /></span>
          <span className="dnap__tickbody"><b>{entry.label}</b><time dateTime={entry.at}>{new Date(entry.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</time></span>
        </li>
      ))}
    </ol>
  );
}

/* ---- owners and staff fix what is linked --------------------------------- */

function FixPanel({ view, onChanged }: { view: DnaView; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [moving, setMoving] = useState<DnaView['yourLinks'][number] | null>(null);
  const [merging, setMerging] = useState(false);
  if (view.yourLinks.length === 0 && !view.staff) return null;
  const here: DnaSummary = {
    id: view.dna.id, name: view.dna.name, category: view.dna.category, cover: view.dna.cover,
    lowMinor: view.price?.lowMinor ?? null, highMinor: view.price?.highMinor ?? null, currency: view.price?.currency ?? 'INR',
    sellers: view.sellingNow.length, heat: view.demand.heat, heatLabel: view.demand.label,
    rating: view.rating.average, ratings: view.rating.count, mentions: view.posts.length + view.hunts.length,
  };
  const words = { listing: 'Your listing', post: 'Your post', want: 'Your hunt' } as const;
  return (
    <section className="dnap__fix" data-reveal>
      <h2 className="dnap__fixtitle"><Icon name="settings" size={15} /> Is this right?</h2>
      {view.yourLinks.map((own) => (
        <div key={`${own.kind}${own.id}`} className="dnap__fixrow">
          <span><b>{words[own.kind]}</b> “{own.title}” is on this product.</span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setMoving(own)}>
            {own.kind === 'listing' ? 'Wrong product?' : 'Change'}
          </button>
        </div>
      ))}
      {view.staff && (
        <div className="dnap__fixrow">
          <span><b>Staff</b> Two DNAs for one product? Fold this one into the right one.</span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setMerging(true)}>Merge into…</button>
        </div>
      )}
      {moving && (
        <DnaPicker title={moving.kind === 'listing' ? 'Which product is your listing?' : 'Which product is it?'}
          seed={moving.title} current={[here]} listingId={moving.kind === 'listing' ? moving.id : undefined}
          onClose={() => setMoving(null)}
          onRemove={moving.kind === 'listing' ? undefined : async (from) => {
            await api.fixDna({ kind: moving.kind, id: moving.id, partition: moving.partition, action: 'remove', from: from.id });
            setMoving(null);
            await onChanged();
          }}
          onPick={async (to) => {
            if (to.id === view.dna.id) return;
            await api.fixDna({ kind: moving.kind, id: moving.id, partition: moving.partition, action: 'move', to: to.id });
            setMoving(null);
            await onChanged();
          }}
          extra={moving.kind === 'listing' ? (
            <button type="button" className="dnap__newdna" onClick={async () => {
              try {
                const made = await api.fixDna({ kind: 'listing', id: moving.id, partition: moving.partition, action: 'new' });
                setMoving(null);
                toast('Your listing has its own Product DNA now');
                if (made.dna) navigate(dnaHref(made.dna));
              } catch (err) {
                toast(err instanceof ApiRequestError ? err.message : 'That did not go through.', 'error');
              }
            }}>
              <Icon name="plus" size={14} /> None of these - it is a product of its own
            </button>
          ) : undefined} />
      )}
      {merging && (
        <DnaPicker title="Fold this into which product?" seed={view.dna.name} current={[]}
          onClose={() => setMerging(false)}
          onPick={async (into) => {
            if (into.id === view.dna.id) return;
            await api.mergeDna(view.dna.id, into.id);
            setMerging(false);
            navigate(dnaHref(into.id), { replace: true });
          }} />
      )}
    </section>
  );
}

function DnaSkeleton() {
  return (
    <main className="page dnap" aria-busy="true">
      <div className="dnap__skelhero">
        <DnaHelix rungs={16} className="dnap__skelhelix" />
        <p className="dnap__skeltext">Sequencing this product…</p>
      </div>
    </main>
  );
}
