import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { DnaListingCard, DnaSummary, DnaView } from '@shared/dna';
import { ApiRequestError, api } from '../api';
import { BackLink } from '../components/ScrollManager';
import { CropPic, DnaHelix, DnaPicker, DnaTile, HeatBand, Stars, dnaHref, sequenceOf } from '../components/DnaKit';
import { MergeSheet, MovePreview, SplitSheet } from '../components/DnaUpkeep';
import { DnaAskPopup } from '../components/DnaCheck';
import { useToast } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { ReviewPhotoPicker, ReviewPhotoStrip } from '../components/ReviewPhotos';
import { Lightbox } from '../components/SocialPost';
import { Modal, PageError } from '../components/ui';
import { TimedPicker } from '../components/TimedPicker';
import { DEFAULT_TIMED_DAYS, timeLeft } from '@shared/timed';
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

  // Opened from a review post: to that review, flashed so the eye finds it.
  useEffect(() => {
    if (!view || !location.hash.startsWith('#review-')) return undefined;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('is-flash');
    }, 250);
    return () => window.clearTimeout(timer);
  }, [view]);

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
      <Hero view={view} onChanged={load} />
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

        <Strand id="demand" base="G" title="How wanted it is" note="A score out of 100 from what people do here: hunts, saves, views, sales.">
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
      {/* A few seconds in: does one of its listings really match? */}
      <DnaAskPopup dnaId={dna.id} dnaName={dna.name} cover={dna.cover} coverBox={dna.coverBox} />

      {view.related.length > 0 && (
        <section className="dnap__related" data-reveal aria-labelledby="dnap-related-title">
          <FleaMarket />
          <header className="dnap__relatedhead">
            <h2 id="dnap-related-title" className="dnap__relatedtitle"><DnaHelix rungs={6} still /> More in {dna.category}</h2>
            <p className="dnap__relatednote">Wander the stalls: more like it, from shops on Figmark.</p>
          </header>
          <div className="dnap__relatedrow">
            {view.related.map((summary, at) => <DnaTile key={summary.id} summary={summary} index={at} />)}
          </div>
        </section>
      )}
    </main>
  );
}

/* ---- hero ------------------------------------------------------------------ */

function Hero({ view, onChanged }: { view: DnaView; onChanged: () => Promise<void> }) {
  const { dna, price, rating, demand } = view;
  return (
    <header className="dnap__hero">
      <div className="dnap__heroplate" aria-hidden="true">
        <span className="dnap__orb dnap__orb--a" />
        <span className="dnap__orb dnap__orb--b" />
      </div>
      <div className="dnap__specimen">
        {dna.cover ? <CropPic src={dna.cover} box={dna.coverBox} /> : <DnaHelix rungs={14} className="dnap__specimenhelix" />}
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
          {view.staff && <RenameDna view={view} onChanged={onChanged} />}
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
        <HeroActions view={view} onChanged={onChanged} />
      </div>
    </header>
  );
}

/* ---- follow, and "I want this" ---------------------------------------------- */

/**
 * The two things a reader can do with a product besides buying it: follow it
 * for a while and hear when its market moves, or put a hunt for it on the
 * Wanted board. Both run for as long as they pick, up to three months, and
 * are then deleted.
 */
/** Staff: the name buyers know the product by, edited in place. */
function RenameDna({ view, onChanged }: { view: DnaView; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(view.dna.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.renameDna(view.dna.id, name);
      setOpen(false);
      toast('Renamed');
      await onChanged();
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not go through.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="dnap__rename" aria-label="Rename this product" title="Rename (staff)"
        onClick={() => { setName(view.dna.name); setOpen(true); }}>
        <Icon name="compose" size={15} />
      </button>
      {open && (
        <Modal title="Rename this product" onClose={() => setOpen(false)}>
          <form className="dnap__renameform" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <input value={name} maxLength={90} autoFocus aria-label="Product name" onChange={(event) => setName(event.target.value)} />
            <p className="dnap__renamenote">Every shop's listing on it shows this name. Its old name still finds it.</p>
            <div className="dnap__renameactions">
              <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={busy || name.trim().length < 2 || name.trim() === view.dna.name}>
                {busy ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function HeroActions({ view, onChanged }: { view: DnaView; onChanged: () => Promise<void> }) {
  const { user, promptAuth } = useSession();
  const [sheet, setSheet] = useState<'follow' | 'want' | null>(null);
  const open = (which: 'follow' | 'want') => (user
    ? setSheet(which)
    : promptAuth(which === 'follow' ? 'Sign in to follow this product.' : 'Sign in to post a hunt for this product.'));
  const others = view.watchers - (view.follow ? 1 : 0);
  return (
    <div className="dnap__acts">
      <button type="button" className={`dnap__act${view.follow ? ' is-on' : ''}`} aria-pressed={Boolean(view.follow)} onClick={() => open('follow')}>
        <Icon name="bell" size={15} />
        <span className="dnap__actlabel">{view.follow ? 'Following' : 'Follow'}</span>
        {view.follow && <span className="dnap__actnote">{timeLeft(view.follow.until)}</span>}
      </button>
      {view.hunting ? (
        <Link className="dnap__act is-on" to={`/social?view=wanted&want=${encodeURIComponent(view.hunting.id)}&buyer=${encodeURIComponent(view.hunting.buyerId)}`}>
          <Icon name="target" size={15} />
          <span className="dnap__actlabel">You're hunting it</span>
          <span className="dnap__actnote">{timeLeft(view.hunting.expiresAt)}</span>
        </Link>
      ) : (
        <button type="button" className="dnap__act dnap__act--want" onClick={() => open('want')}>
          <Icon name="target" size={15} />
          <span className="dnap__actlabel">I want this</span>
        </button>
      )}
      {others > 0 && <p className="dnap__watchers">{others} {others === 1 ? 'other person follows' : 'others follow'} it</p>}
      {sheet === 'follow' && <FollowSheet view={view} onClose={() => setSheet(null)} onDone={async () => { setSheet(null); await onChanged(); }} />}
      {sheet === 'want' && <WantSheet view={view} onClose={() => setSheet(null)} onDone={async () => { setSheet(null); await onChanged(); }} />}
    </div>
  );
}

function FollowSheet({ view, onClose, onDone }: { view: DnaView; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [days, setDays] = useState(DEFAULT_TIMED_DAYS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function save(next: number | null) {
    setBusy(true);
    setProblem(null);
    try {
      await api.followDna(view.dna.id, next);
      toast(next === null ? 'Stopped following.' : 'Following. You will hear when the price or stock moves.');
      await onDone();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'That did not save.');
      setBusy(false);
    }
  }
  return (
    <Modal title={view.follow ? 'You follow this product' : 'Follow this product'} onClose={onClose}>
      <p className="dnap__sheettext">
        Hear when its lowest price goes up or down, when it comes back on sale or sells out, and when a new shop starts selling it.
      </p>
      {view.follow && <p className="dnap__sheettext dnap__dim">Now until {new Date(view.follow.until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {timeLeft(view.follow.until)}. Pick again to change it.</p>}
      <div className="dnap__sheetfield">
        <span className="dnap__sheetlabel">For how long</span>
        <TimedPicker days={days} onChange={setDays} label="Follow for how long" />
        <span className="dnap__sheethint">Then the follow ends by itself and is deleted.</span>
      </div>
      {problem && <p className="dnap__problem" role="alert">{problem}</p>}
      <div className="dnap__sheetbtns">
        {view.follow
          ? <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void save(null)}>Stop following</button>
          : <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>}
        <button type="button" className="btn" disabled={busy} onClick={() => void save(days)}>
          {busy ? 'Saving…' : view.follow ? 'Change' : 'Follow'}
        </button>
      </div>
    </Modal>
  );
}

function WantSheet({ view, onClose, onDone }: { view: DnaView; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [days, setDays] = useState(DEFAULT_TIMED_DAYS);
  const [budget, setBudget] = useState('');
  // Behind a tap, so the sheet opens without the keyboard covering the choices.
  const [budgeting, setBudgeting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function post() {
    setBusy(true);
    setProblem(null);
    try {
      const amount = budget.trim() ? Math.round(Number(budget.replace(/,/g, '')) * 100) : null;
      await api.wantDna(view.dna.id, { days, budgetMinor: amount && amount > 0 ? amount : null });
      toast('On the Wanted board. Shops can answer your hunt now.');
      await onDone();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'That did not post.');
      setBusy(false);
    }
  }
  return (
    <Modal title="I want this" onClose={onClose}>
      <div className="dnap__wantcard">
        {view.dna.cover && <CropPic src={view.dna.cover} box={view.dna.coverBox} />}
        <div>
          <strong>{view.dna.name}</strong>
          <span className="dnap__dim">{view.dna.category} · goes on the Wanted board</span>
        </div>
      </div>
      <div className="dnap__sheetfield">
        <span className="dnap__sheetlabel">Keep it up for</span>
        <TimedPicker days={days} onChange={setDays} label="Keep the hunt up for" />
        <span className="dnap__sheethint">Then it is deleted, with its answers and photos.</span>
      </div>
      {budgeting ? (
        <label className="dnap__sheetfield">
          <span className="dnap__sheetlabel">Budget</span>
          <input className="dnap__sheetinput" value={budget} inputMode="decimal" autoFocus
            placeholder={view.price ? `Shops ask around ${formatMoney(view.price.typicalMinor, view.price.currency)}` : 'What you would pay'}
            onChange={(event) => setBudget(event.target.value.replace(/[^\d.,]/g, ''))} />
        </label>
      ) : (
        <button type="button" className="dnap__addbudget" onClick={() => setBudgeting(true)}>
          <Icon name="plus" size={14} /> Add a budget <span className="dnap__dim">(optional, otherwise open to offers)</span>
        </button>
      )}
      {problem && <p className="dnap__problem" role="alert">{problem}</p>}
      <div className="dnap__sheetbtns">
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void post()}>{busy ? 'Posting…' : 'Post to Wanted'}</button>
      </div>
    </Modal>
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
            <span key={`${listing.id}${listing.piece?.id ?? ''}`} className="dnap__rangedot" data-deal={listing.deal ?? 'fair'}
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
            <li key={`${listing.id}${listing.piece?.id ?? ''}`} style={{ ['--i' as string]: at } as CSSProperties}>
              <Link to={`/listing/${encodeURIComponent(listing.id)}`} className="dnap__offer">
                <span className="dnap__offerpic">{listing.photoUrl ? <CropPic src={listing.photoUrl} box={listing.photoBox} /> : <Icon name="box" size={20} />}</span>
                <span className="dnap__offertext">
                  <b>{listing.shop?.name ?? 'A shop'}</b>
                  {listing.piece && (
                    <small>
                      {listing.piece.set ? 'Sold as part of a set' : 'One of several in'} “{listing.piece.listingTitle}”
                    </small>
                  )}
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
          <h3 className="dnap__subhead">Probably could get it</h3>
          <p className="dnap__subnote">Not selling it here, but they deal in this line or this kind of thing. Ask them.</p>
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
        <span className="dnap__gaugevalue"><CountUp value={demand.heat} /><small>/100</small></span>
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
      <details className="dnap__how">
        <summary>What is this number?</summary>
        <p>
          A demand score from 0 to 100. Each hunt counts 6 points, each sale 5, each pre-order 4, each person waiting
          for a restock 3, each save 2 and every ten views 1. The total goes on a log scale, so one busy listing cannot
          max it out: about 10 points makes 26, 100 makes 50, 1,000 makes 75.
        </p>
        <p className="dnap__howscale">
          <span data-level="1">0-24 Quiet</span><span data-level="2">25-54 Warm</span>
          <span data-level="3">55-79 Hot</span><span data-level="4">80+ On fire</span>
        </p>
      </details>
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
      <div className="dnap__gallery" data-count={Math.min(view.gallery.length, 5)}>
        {view.gallery.map((photo, at) => {
          const inner = (
            <>
              <img src={photo.url} alt="" loading="lazy" decoding="async" />
              <span className="dnap__shotshade" aria-hidden="true" />
              <span className="dnap__shottag" data-from={photo.from}><span className="dnap__shotdot" />{FROM_WORDS[photo.from]}<Icon name="right" size={10} /></span>
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
          <div key={fact.label} className="dnap__fact" style={{ ['--i' as string]: at } as CSSProperties}>
            <span className="dnap__factno" aria-hidden="true">{String(at + 1).padStart(2, '0')}</span>
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
  const [splitting, setSplitting] = useState(false);
  if (view.yourLinks.length === 0 && !view.staff) return null;
  const here: DnaSummary = {
    id: view.dna.id, name: view.dna.name, category: view.dna.category, cover: view.dna.cover, coverBox: view.dna.coverBox,
    lowMinor: view.price?.lowMinor ?? null, highMinor: view.price?.highMinor ?? null, currency: view.price?.currency ?? 'INR',
    sellers: view.sellingNow.length, heat: view.demand.heat, heatLabel: view.demand.label,
    rating: view.rating.average, ratings: view.rating.count, mentions: view.posts.length + view.hunts.length,
  };
  const words = { listing: 'Your listing', post: 'Your post', want: 'Your hunt' } as const;
  return (
    <section className="dnap__fix" data-reveal>
      <header className="dnap__fixhead">
        <span className="dnap__fixicon" aria-hidden="true"><Icon name="settings" size={16} /></span>
        <span>
          <h2 className="dnap__fixtitle">Is this right?</h2>
          <p className="dnap__fixnote">Something on the wrong product? Put it where it belongs.</p>
        </span>
      </header>
      <ul className="dnap__fixrows">
        {view.yourLinks.map((own) => (
          <li key={`${own.kind}${own.id}${own.piece ?? ''}`} className="dnap__fixrow">
            <span className="dnap__fixtag">{words[own.kind]}</span>
            <span className="dnap__fixtext">“{own.title}” is on this product.</span>
            <button type="button" className="dnap__fixbtn" onClick={() => setMoving(own)}>
              {own.kind === 'listing' ? 'Wrong product?' : 'Change'}
            </button>
          </li>
        ))}
        {view.staff && (
          <>
            <li className="dnap__fixrow">
              <span className="dnap__fixtag dnap__fixtag--staff">Staff</span>
              <span className="dnap__fixtext">Two DNAs for one product? Fold this one into the right one.</span>
              <button type="button" className="dnap__fixbtn" onClick={() => setMerging(true)}><Icon name="link" size={14} /> Merge into…</button>
            </li>
            <li className="dnap__fixrow">
              <span className="dnap__fixtag dnap__fixtag--staff">Staff</span>
              <span className="dnap__fixtext">A clearer name for it?</span>
              <RenameDna view={view} onChanged={onChanged} />
            </li>
            <li className="dnap__fixrow">
              <span className="dnap__fixtag dnap__fixtag--staff">Staff</span>
              <span className="dnap__fixtext">Something here is another product? Split it off.</span>
              <button type="button" className="dnap__fixbtn" onClick={() => setSplitting(true)}><Icon name="copy" size={14} /> Split off…</button>
            </li>
          </>
        )}
      </ul>
      {moving && (
        <DnaPicker title={moving.kind === 'listing' ? 'Which product is your listing?' : 'Which product is it?'}
          seed={moving.title} current={[here]} listingId={moving.kind === 'listing' ? moving.id : undefined} piece={moving.piece}
          exclude={[view.dna.id]}
          preview={(to) => <MovePreview view={view} kind={moving.kind} title={moving.title} to={to} />}
          confirmLabel="Move it"
          onClose={() => setMoving(null)}
          onRemove={moving.kind === 'listing' ? undefined : async (from) => {
            await api.fixDna({ kind: moving.kind, id: moving.id, partition: moving.partition, action: 'remove', from: from.id });
            setMoving(null);
            await onChanged();
          }}
          onPick={async (to) => {
            if (to.id === view.dna.id) return;
            await api.fixDna({ kind: moving.kind, id: moving.id, partition: moving.partition, action: 'move', to: to.id, piece: moving.piece });
            setMoving(null);
            await onChanged();
          }}
          extra={moving.kind === 'listing' ? (
            <button type="button" className="dnap__newdna" onClick={async () => {
              try {
                const made = await api.fixDna({ kind: 'listing', id: moving.id, partition: moving.partition, action: 'new', piece: moving.piece });
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
      {merging && <MergeSheet view={view} onClose={() => setMerging(false)} />}
      {splitting && <SplitSheet view={view} onClose={() => setSplitting(false)} onDone={onChanged} />}
    </section>
  );
}

/* ---- more in the category: a flea market at dusk ------------------------- */

/** One stall's awning colours, a stripe each. */
const STALLS: { a: string; b: string; x: number; w: number }[] = [
  { a: '#FF5A5F', b: '#FFE4E4', x: 0, w: 120 },
  { a: '#06D6E7', b: '#E0FBFD', x: 140, w: 100 },
  { a: '#A3E635', b: '#F4FFE0', x: 260, w: 130 },
  { a: '#A78BFA', b: '#F1ECFF', x: 410, w: 110 },
  { a: '#F59E0B', b: '#FFF4DC', x: 540, w: 120 },
  { a: '#EC4899', b: '#FFE6F3', x: 680, w: 100 },
];

/**
 * Behind "More in…": a night flea market that tells a short story on a loop.
 * The lights come on bulb by bulb, the bunting sways, the row of stalls
 * drifts past, price tags swing, and a shopper's cart rolls through and stops
 * at a stall before moving on. Decoration only: hidden from screen readers,
 * and still under reduced motion.
 */
function FleaMarket() {
  const bulbs = Array.from({ length: 16 }, (_, at) => at);
  const flags = Array.from({ length: 14 }, (_, at) => at);
  const stalls = (shift: number) => STALLS.map((stall, at) => {
    const stripes = Math.ceil(stall.w / 20);
    return (
      <g key={`${shift}-${at}`} transform={`translate(${stall.x + shift} 0)`}>
        {/* posts and table */}
        <rect x="6" y="62" width="4" height="58" fill="#1B2236" />
        <rect x={stall.w - 10} y="62" width="4" height="58" fill="#1B2236" />
        <rect x="0" y="96" width={stall.w} height="10" rx="2" fill="#2A2140" />
        <rect x="4" y="106" width={stall.w - 8} height="14" fill="#1A1430" />
        {/* wares on the table */}
        <rect x="14" y="84" width="16" height="12" rx="2" fill={stall.a} opacity="0.85" />
        <circle cx={stall.w / 2} cy="88" r="8" fill={stall.b} opacity="0.75" />
        <rect x={stall.w - 34} y="78" width="12" height="18" rx="2" fill="#8B5CF6" opacity="0.8" />
        {/* striped awning with a scalloped edge */}
        {Array.from({ length: stripes }, (_, n) => (
          <rect key={n} x={n * 20} y="44" width="20" height="18" fill={n % 2 ? stall.b : stall.a} />
        ))}
        {Array.from({ length: stripes }, (_, n) => (
          <circle key={`s${n}`} cx={n * 20 + 10} cy="62" r="10" fill={n % 2 ? stall.b : stall.a} />
        ))}
        <rect x="-4" y="40" width={stall.w + 8} height="6" rx="3" fill="#0F1424" />
        {/* a hanging price tag */}
        <g className="dnap__fleatag" style={{ ['--i' as string]: at } as CSSProperties}>
          <line x1={stall.w - 22} y1="72" x2={stall.w - 22} y2="80" stroke="#94A3B8" strokeWidth="1" />
          <rect x={stall.w - 32} y="80" width="20" height="12" rx="2" fill="#FDE68A" />
          <circle cx={stall.w - 28} cy="86" r="1.4" fill="#0B1020" />
        </g>
      </g>
    );
  });
  return (
    <div className="dnap__flea" aria-hidden="true">
      <span className="dnap__fleasky" />
      <svg className="dnap__fleabunting" viewBox="0 0 400 40" preserveAspectRatio="none">
        <path d="M0 4 Q200 34 400 4" fill="none" stroke="#475569" strokeWidth="1" />
        {flags.map((at) => {
          const x = 14 + at * 27.5;
          const y = 4 + Math.sin((x / 400) * Math.PI) * 15;
          const colour = ['#FF5A5F', '#06D6E7', '#A3E635', '#A78BFA', '#F59E0B'][at % 5];
          return <path key={at} className="dnap__fleaflag" d={`M${x - 7} ${y} L${x + 7} ${y} L${x} ${y + 13} Z`} fill={colour}
            style={{ ['--i' as string]: at } as CSSProperties} />;
        })}
      </svg>
      <svg className="dnap__fleabulbs" viewBox="0 0 400 30" preserveAspectRatio="none">
        <path d="M0 2 Q200 26 400 2" fill="none" stroke="#334155" strokeWidth="1" />
        {bulbs.map((at) => {
          const x = 12 + at * 25;
          const y = 2 + Math.sin((x / 400) * Math.PI) * 12 + 3;
          return <circle key={at} className="dnap__fleabulb" cx={x} cy={y} r="2.6" style={{ ['--i' as string]: at } as CSSProperties} />;
        })}
      </svg>
      <div className="dnap__fleastalls">
        <svg viewBox="0 0 1600 124" preserveAspectRatio="xMinYMax meet">{stalls(0)}{stalls(800)}</svg>
      </div>
      <svg className="dnap__fleacart" viewBox="0 0 48 34">
        <path d="M2 6h7l5 16h22l5-12H12" fill="none" stroke="#E2E8F0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="16" y="4" width="9" height="8" rx="1.5" fill="#FF5A5F" />
        <rect x="26" y="2" width="8" height="10" rx="1.5" fill="#06D6E7" />
        <circle cx="17" cy="28" r="3" fill="#A3E635" />
        <circle cx="33" cy="28" r="3" fill="#A3E635" />
      </svg>
      <span className="dnap__fleaground" />
    </div>
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
