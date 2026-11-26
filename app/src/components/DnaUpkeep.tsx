import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DnaManage, DnaSummary, DnaThing, DnaTwinWhy, DnaView } from '@shared/dna';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { CropPic, DnaPicker, dnaHref, priceSpan } from './DnaKit';
import { useToast } from './Feedback';
import { Icon } from './Icon';
import { Modal } from './ui';
import '../styles/DnaUpkeep.css';

/**
 * Keeping products one-to-one with real things: staff folding two DNAs of one
 * product together, staff splitting things that are another product off one,
 * and an owner moving their own listing, post or hunt.
 *
 * Every one of them shows what will happen before it does: both products side
 * by side, what moves, and what each is left with.
 */

const WHY: Record<DnaTwinWhy, string> = {
  'same-photo': 'Same photo',
  'same-thing-in-photo': 'Same thing in the photos',
  'same-name': 'Names match',
  'same-name-other-maker': 'Same name, maker said differently',
};

const KIND: Record<DnaThing['kind'], string> = { listing: 'Listing', post: 'Post', want: 'Hunt' };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What a product holds, in a line: listings, shops, posts, hunts. */
function tally(things: DnaThing[]) {
  const listings = things.filter((thing) => thing.kind === 'listing');
  return {
    listings: listings.length,
    selling: listings.filter((thing) => thing.onSale).length,
    shops: new Set(listings.map((thing) => thing.partition)).size,
    posts: things.filter((thing) => thing.kind === 'post').length,
    hunts: things.filter((thing) => thing.kind === 'want').length,
    prices: listings.filter((thing) => thing.onSale && thing.priceMinor !== null).map((thing) => thing.priceMinor!),
    currency: listings[0]?.currency ?? 'INR',
  };
}

function tallyLine(things: DnaThing[]): string {
  const counts = tally(things);
  return [
    plural(counts.listings, 'listing'),
    counts.shops ? plural(counts.shops, 'shop') : null,
    counts.posts ? plural(counts.posts, 'post') : null,
    counts.hunts ? plural(counts.hunts, 'hunt') : null,
  ].filter(Boolean).join(' · ');
}

function spanOf(things: DnaThing[]): string | null {
  const { prices, currency } = tally(things);
  if (prices.length === 0) return null;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? formatMoney(low, currency) : `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`;
}

function Pic({ src, box, size = 'md' }: { src: string | null; box?: DnaSummary['coverBox']; size?: 'sm' | 'md' }) {
  return (
    <span className={`dnau__pic dnau__pic--${size}`}>
      {src ? <CropPic src={src} box={box ?? null} /> : <Icon name="dna" size={size === 'sm' ? 12 : 18} />}
    </span>
  );
}

/** One product as a small plate: photo, name, and a line of what it holds. */
function Plate({ name, cover, coverBox, line, sub, tone }: {
  name: string; cover: string | null; coverBox?: DnaSummary['coverBox']; line: string; sub?: string | null; tone: 'from' | 'to' | 'after';
}) {
  return (
    <div className={`dnau__plate dnau__plate--${tone}`}>
      <Pic src={cover} box={coverBox} />
      <span className="dnau__platetext">
        <b>{name}</b>
        <small>{line}</small>
        {sub && <small>{sub}</small>}
      </span>
    </div>
  );
}

/** A strip of the things that move, a few shown and the rest counted. */
function Movers({ things, label, empty = 'Nothing' }: { things: DnaThing[]; label: string; empty?: string }) {
  const shown = things.slice(0, 8);
  return (
    <div className="dnau__movers">
      <p className="dnau__label">{label}</p>
      {things.length === 0 ? <p className="dnau__none">{empty}</p> : (
        <ul className="dnau__thinglist">
          {shown.map((thing) => (
            <li key={`${thing.kind}${thing.id}${thing.piece ?? ''}`}>
              <Pic src={thing.photoUrl} box={thing.photoBox} size="sm" />
              <span className="dnau__thingtext">
                <b>{thing.title}</b>
                <small>{[KIND[thing.kind], thing.who, thing.priceMinor !== null && thing.kind === 'listing' ? formatMoney(thing.priceMinor, thing.currency) : null].filter(Boolean).join(' · ')}</small>
              </span>
            </li>
          ))}
          {things.length > shown.length && <li className="dnau__more">and {things.length - shown.length} more</li>}
        </ul>
      )}
    </div>
  );
}

function useManage(id: string | null) {
  const [data, setData] = useState<DnaManage | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    setData(null);
    setFailed(null);
    api.manageDna(id).then((answer) => { if (live) setData(answer); })
      .catch((err) => { if (live) setFailed(err instanceof ApiRequestError ? err.message : 'Could not load this product.'); });
    return () => { live = false; };
  }, [id]);
  return { data, failed };
}

/* ---- staff: fold this product into another --------------------------------- */

function MergePreview({ from, into }: { from: DnaManage; into: DnaSummary }) {
  const { data: target, failed } = useManage(into.id);
  if (failed) return <p className="dnau__warn">{failed}</p>;
  if (!target) return <p className="dnau__hint">Reading both products…</p>;
  const have = new Set(target.things.map((thing) => `${thing.kind}${thing.id}${thing.piece ?? ''}`));
  const moving = from.things.filter((thing) => !have.has(`${thing.kind}${thing.id}${thing.piece ?? ''}`));
  const after = [...target.things, ...moving];
  const reviews = from.reviews + target.reviews;
  const warnings = [
    from.dna.category !== target.dna.category ? `Different categories: ${from.dna.category} and ${target.dna.category}. It keeps ${target.dna.category}.` : null,
    from.dna.line !== target.dna.line ? 'One is listed as originals and the other as copies - this will be refused.' : null,
  ].filter(Boolean);
  return (
    <div className="dnau__preview">
      <div className="dnau__flow">
        <Plate tone="from" name={from.dna.name} cover={from.dna.cover} coverBox={from.dna.coverBox} line={tallyLine(from.things)} sub={spanOf(from.things)} />
        <span className="dnau__arrow" aria-hidden="true"><Icon name="down" size={16} /> folds into</span>
        <Plate tone="to" name={target.dna.name} cover={target.dna.cover} coverBox={target.dna.coverBox} line={tallyLine(target.things)} sub={spanOf(target.things)} />
      </div>
      <Movers things={moving} label={`Moves across (${moving.length})`} empty="Nothing new: everything is already on it." />
      <div className="dnau__after">
        <p className="dnau__label">After</p>
        <Plate tone="after" name={target.dna.name} cover={target.dna.cover ?? from.dna.cover} coverBox={target.dna.coverBox}
          line={tallyLine(after)}
          sub={[spanOf(after), reviews ? plural(reviews, 'review') : null].filter(Boolean).join(' · ') || null} />
        <p className="dnau__note">“{from.dna.name}” sends its readers here, and its followers and reviews come along.</p>
      </div>
      {warnings.map((text) => <p key={text} className="dnau__warn"><Icon name="bolt" size={13} /> {text}</p>)}
    </div>
  );
}

export function MergeSheet({ view, onClose }: { view: DnaView; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: from, failed } = useManage(view.dna.id);
  const suggested = useMemo(() => (from ? from.twins.map((twin) => ({ dna: twin.dna, why: WHY[twin.why] })) : null), [from]);
  if (failed) {
    return (
      <Modal title="Merge into another product" onClose={onClose}>
        <p className="dnau__warn">{failed}</p>
      </Modal>
    );
  }
  return (
    <DnaPicker title="Merge into which product?" seed={view.dna.name} current={[]} exclude={[view.dna.id]}
      suggested={suggested} suggestedLabel="Likely the same product"
      onClose={onClose}
      preview={(into) => (from ? <MergePreview from={from} into={into} /> : <p className="dnau__hint">Reading this product…</p>)}
      confirmLabel={(into) => `Merge into “${into.name.length > 28 ? `${into.name.slice(0, 27)}…` : into.name}”`}
      onPick={async (into) => {
        await api.mergeDna(view.dna.id, into.id);
        onClose();
        navigate(dnaHref(into.id), { replace: true });
      }} />
  );
}

/* ---- staff: split some things off this product ----------------------------- */

const thingKey = (thing: DnaThing) => `${thing.kind}:${thing.id}#${thing.piece ?? ''}`;

export function SplitSheet({ view, onClose, onDone }: { view: DnaView; onClose: () => void; onDone: () => Promise<void> }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, failed } = useManage(view.dna.id);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<DnaSummary | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState(false);

  const things = data?.things ?? [];
  const leaving = things.filter((thing) => picked.has(thingKey(thing)));
  const staying = things.filter((thing) => !picked.has(thingKey(thing)));
  const firstListing = leaving.find((thing) => thing.kind === 'listing');
  // The new product's name follows the first listing picked until staff type their own.
  useEffect(() => {
    // The part before a dash or a bar: shops put the size and the state of their copy after it.
    if (!named) setName((firstListing?.title ?? '').split(/\s+[—–|-]\s+|\s*\|\s*/)[0]!.trim());
  }, [firstListing?.title, named]);

  const toggle = (thing: DnaThing) => setPicked((now) => {
    const next = new Set(now);
    const key = thingKey(thing);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const problem = leaving.length === 0 ? 'Tick what is another product.'
    : !target && !firstListing ? 'A new product needs at least one listing - or move them to an existing product.'
      : null;
  const emptyAfter = staying.filter((thing) => thing.kind === 'listing').length === 0;

  const go = async () => {
    if (problem) return;
    setBusy(true);
    try {
      const done = await api.splitDna(view.dna.id, {
        links: leaving.map((thing) => ({ kind: thing.kind, id: thing.id, piece: thing.piece })),
        into: target?.id ?? null,
        name: target ? null : name.trim() || null,
      });
      toast(target ? `Moved to ${target.name}` : 'Split off into a new product');
      onClose();
      if (emptyAfter) navigate(dnaHref(done.dna), { replace: true });
      else await onDone();
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not go through.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (choosing) {
    return (
      <DnaPicker title="Move them to which product?" seed={firstListing?.title ?? view.dna.name} current={[]} exclude={[view.dna.id]}
        suggested={data ? data.twins.map((twin) => ({ dna: twin.dna, why: WHY[twin.why] })) : null} suggestedLabel="Products with a similar name"
        onClose={() => setChoosing(false)}
        onPick={async (dna) => { setTarget(dna); setChoosing(false); }} />
    );
  }

  return (
    <Modal title="Split off another product" onClose={onClose}>
      <div className="dnau__split">
        {failed && <p className="dnau__warn">{failed}</p>}
        {!data && !failed && <p className="dnau__hint">Reading what is on this product…</p>}
        {data && (
          <>
            <p className="dnau__lead">Tick everything here that is <em>not</em> “{data.dna.name}”.</p>
            <ul className="dnau__checks">
              {things.map((thing) => {
                const key = thingKey(thing);
                return (
                  <li key={key}>
                    <label className={`dnau__check${picked.has(key) ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(thing)} />
                      <Pic src={thing.photoUrl} box={thing.photoBox} size="sm" />
                      <span className="dnau__thingtext">
                        <b>{thing.title}</b>
                        <small>
                          {[KIND[thing.kind], thing.who,
                            thing.priceMinor !== null && thing.kind === 'listing' ? formatMoney(thing.priceMinor, thing.currency) : null,
                            thing.by === 'auto' ? 'matched automatically' : thing.by === 'owner' ? 'linked by its owner' : 'linked by staff',
                          ].filter(Boolean).join(' · ')}
                        </small>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <fieldset className="dnau__dest">
              <legend className="dnau__label">Where they go</legend>
              <label className="dnau__radio">
                <input type="radio" name="dest" checked={!target} onChange={() => setTarget(null)} />
                <span>A new product</span>
              </label>
              {!target && (
                <input className="dnau__name" value={name} maxLength={90} placeholder="Its name"
                  aria-label="New product name" onChange={(event) => { setName(event.target.value); setNamed(true); }} />
              )}
              <label className="dnau__radio">
                <input type="radio" name="dest" checked={Boolean(target)} onChange={() => setChoosing(true)} />
                <span>{target ? <>Another product: <b>{target.name}</b></> : 'Another product…'}</span>
                {target && <button type="button" className="btn btn--quiet btn--sm" onClick={() => setChoosing(true)}>Change</button>}
              </label>
            </fieldset>

            {leaving.length > 0 && (
              <div className="dnau__preview">
                <p className="dnau__label">Preview</p>
                <div className="dnau__two">
                  <Plate tone="from" name={data.dna.name} cover={data.dna.cover} coverBox={data.dna.coverBox}
                    line={`Keeps ${tallyLine(staying)}`} sub={spanOf(staying)} />
                  {target ? (
                    <Plate tone="to" name={target.name} cover={target.cover} coverBox={target.coverBox}
                      line={`Gains ${tallyLine(leaving)}`} sub={priceSpan(target)} />
                  ) : (
                    <Plate tone="to" name={name.trim() || firstListing?.title || 'New product'} cover={firstListing?.photoUrl ?? null}
                      coverBox={firstListing?.photoBox} line={`Starts with ${tallyLine(leaving)}`} sub={spanOf(leaving)} />
                  )}
                </div>
                {emptyAfter && <p className="dnau__warn"><Icon name="bolt" size={13} /> Nothing for sale stays on “{data.dna.name}”: it leaves Discover until something is listed again.</p>}
                <p className="dnau__note">The matcher will not put what moves back here.</p>
              </div>
            )}
            {problem && leaving.length > 0 && <p className="dnau__warn">{problem}</p>}
            <div className="dnau__actions">
              <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="btn" disabled={busy || Boolean(problem)} onClick={() => void go()}>
                {busy ? 'Working…' : leaving.length ? `Split ${plural(leaving.length, 'thing')} off` : 'Split off'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ---- an owner moves their own thing ---------------------------------------- */

/** What an owner sees before their listing, post or hunt moves: from here, to there. */
export function MovePreview({ view, kind, title, to }: {
  view: DnaView; kind: DnaThing['kind']; title: string; to: DnaSummary;
}) {
  const what = { listing: 'Your listing', post: 'Your post', want: 'Your hunt' }[kind];
  const left = view.sellingNow.length - (kind === 'listing' ? 1 : 0);
  const span = priceSpan(to);
  return (
    <div className="dnau__preview">
      <p className="dnau__lead"><b>{what}</b> “{title}”</p>
      <div className="dnau__flow">
        <Plate tone="from" name={view.dna.name} cover={view.dna.cover} coverBox={view.dna.coverBox}
          line={kind === 'listing' ? `${plural(Math.max(0, left), 'listing')} left on sale here` : 'It comes off this product'} />
        <span className="dnau__arrow" aria-hidden="true"><Icon name="down" size={16} /> moves to</span>
        <Plate tone="to" name={to.name} cover={to.cover} coverBox={to.coverBox}
          line={kind === 'listing' ? `Shown beside ${plural(to.sellers, 'shop')}` : `${plural(to.sellers, 'shop')} selling it`}
          sub={span ? `Now ${span}` : null} />
      </div>
      <p className="dnau__note">Figmark will not move it back. You can change it again any time.</p>
    </div>
  );
}
