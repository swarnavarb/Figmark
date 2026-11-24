import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { saleFee, type FeeTerms } from '@shared/billing';
import { MAX_PIECES, parsePriceList, spreadUnits } from '@shared/pieces';
import { photoVerdict, titleHint, viewsLineup, type PhotoAnalysis, type PhotoVerdict } from '@shared/photo-scan';
import { readingOrder, sameness } from '@shared/photo-things';
import { mergeThings, overlayScan, type FoundThing } from '../photoThings';
import { api, type PhotoBox } from '../api';
import { formatMoney } from '../format';
import { haptic } from '../haptics';
import { usePricing } from './Billing';
import { PieceThumb } from './Pieces';
import { AiScan } from './AiScan';
import { PhotoMarker } from './PhotoMarker';
import { Select } from './Select';
import { MIXED } from '@shared/catalog';

/*
 * The sell form's answer to a photo of several things.
 *
 * The seller is asked first how they are selling what is in it: each item on
 * its own, or all of it as one set. Meanwhile the things in the photo are
 * found - on the phone and on the server, by the one method photo search uses
 * too (shared/photo-things.ts) - and listed either way, for the seller to put
 * right: mark what was missed by dragging round it, take off what is not for
 * sale, join two rows that are one thing seen twice.
 *
 * - Individually, each row has its title and its price.
 * - As a set, the seller gives one price and it is shared out over the rows.
 *
 * The fee follows what Figmark sees in the photo, not what is typed: each
 * different thing is a fee, the same thing seen twice is one, and taking
 * most of what was found off the list does not count it lower. The editor
 * shows the fee that comes to before publishing; the server works it out
 * again from the picture.
 */

export interface DraftPiece {
  key: string;
  /** Ours, when the row is a piece already published: kept so an edit keeps what sold. */
  id?: string;
  title: string;
  /** In rupees, as typed. */
  price: string;
  boxes: PhotoBox[];
  /** What the photo reader called it, when it named it. */
  label?: string | null;
  /** Sold already: shown, never changed. */
  sold?: boolean;
  /** Its own condition, when the listing's is "Mixed". */
  condition?: string;
  /** Original or copy, its own, when the listing's is "Mixed". */
  authenticity?: string;
}

/** A question the listing answered "Mixed": each row picks its own answer from these. */
export interface MixedFact {
  key: 'condition' | 'authenticity';
  label: string;
  options: readonly { value: string; label: string }[];
}

/**
 * Condition or original-or-copy, asked once for every item in the photo: any
 * answer covers them all, and "Mixed" lets each item say its own.
 */
export interface BulkFact {
  key: 'condition' | 'authenticity';
  label: string;
  required: boolean;
  /** The listing's answer, "Mixed" included; empty when not answered. */
  value: string;
  options: readonly { value: string; label: string }[];
  /** After a first try at publishing, still unanswered. */
  missing?: boolean;
}

/** The mixed questions some rows still have to answer, in words; empty when none. */
export function mixedProblems(pieces: readonly DraftPiece[], facts: readonly MixedFact[]): string[] {
  return facts.flatMap((fact) => {
    const open = pieces.filter((piece) => !piece.sold && !piece[fact.key]).length;
    return open ? [`${fact.label.replace(/\?$/, '').toLowerCase()} for ${open} ${open === 1 ? 'item' : 'items'}`] : [];
  });
}

/** A row's own answers to the mixed questions, for publishing. */
const factsBody = (piece: DraftPiece) => ({
  ...(piece.condition ? { condition: piece.condition } : {}),
  ...(piece.authenticity ? { authenticity: piece.authenticity } : {}),
});

export type GroupMode = 'ask' | 'single' | 'pieces' | 'lot';

export interface PhotoGroup {
  /** The photo this was read from; a new lead photo is read again. */
  photoUrl: string | null;
  reading: boolean;
  /** Different things found in the photo. */
  found: number;
  /** Every place they were found: sent with the listing, part of what the fee is counted from. */
  seen?: PhotoBox[];
  mode: GroupMode;
  pieces: DraftPiece[];
  /** A set's price, in rupees, as typed. */
  setPrice?: string;
  /** Older drafts: a lot's count, as typed. */
  lotCount?: string;
  /** The seller has confirmed the items. */
  confirmed: boolean;
  /** What the things found make up, as the server read them: one item, copies of one, different things. */
  analysis?: PhotoAnalysis | null;
  /** The seller said they are different things, whatever the photo looked like. */
  different?: boolean;
  /** Copies of one item, sold from stock: how many. */
  copies?: number | null;
  /** The seller chose how this photo is sold. */
  chosen?: boolean;
}

export const emptyGroup = (): PhotoGroup => ({
  photoUrl: null, reading: false, found: 0, mode: 'single', pieces: [], setPrice: '', confirmed: false,
});

let counter = 0;
const newKey = () => `p${Date.now().toString(36)}${(counter += 1)}`;
export const rupeesToMinor = (value: string | undefined) => Math.round(Number(value || 0) * 100);

/** Of what was found, the share a seller may take off as wrong finds without lowering the fee (api/src/pieces.ts). */
const FIND_SLACK = 0.15;

/** The count the fee comes to, as the editor can tell: the rows, or most of what was found, whichever is more. */
export function feeCount(group: Pick<PhotoGroup, 'pieces' | 'found' | 'analysis'>): number {
  return Math.max(1, group.pieces.length, Math.ceil(photoFloor(group) * (1 - FIND_SLACK)));
}

/** What the photo holds for the fee: only a photo that clearly shows several things sets a floor (api/src/pieces.ts). */
function photoFloor(group: Pick<PhotoGroup, 'found' | 'analysis'>): number {
  return group.analysis?.several ? group.analysis.found : 0;
}

/** Each row's share of a set's price: spread evenly, the odd paise on the first. */
export function sharesOf(totalMinor: number, rows: number): number[] {
  if (rows <= 0) return [];
  const share = Math.floor(totalMinor / rows);
  return Array.from({ length: rows }, (_, index) => share + (index === 0 ? totalMinor - share * rows : 0));
}

/** What still stands between this group and publishing, in words; empty when nothing does. */
export function groupProblems(group: PhotoGroup): string[] {
  if (group.mode !== 'pieces' && group.mode !== 'lot') return [];
  const out: string[] = [];
  if (group.pieces.length < 2) out.push('at least two items marked on the photo');
  if (group.pieces.length > MAX_PIECES) out.push(`at most ${MAX_PIECES} items`);
  const unmarked = group.pieces.filter((piece) => piece.boxes.length === 0).length;
  if (unmarked) out.push(`${unmarked} ${unmarked === 1 ? 'item' : 'items'} marked on the photo`);
  if (group.mode === 'pieces') {
    const unnamed = group.pieces.filter((piece) => piece.title.trim().length < 2).length;
    if (unnamed) out.push(`a title for ${unnamed} ${unnamed === 1 ? 'item' : 'items'}`);
    const unpriced = group.pieces.filter((piece) => rupeesToMinor(piece.price) < 100).length;
    if (unpriced) out.push(`a price for ${unpriced} ${unpriced === 1 ? 'item' : 'items'}`);
  } else if (rupeesToMinor(group.setPrice) < 100) {
    out.push('a price for the set');
  }
  if (!group.confirmed) out.push('a tick to confirm the items');
  return out;
}

/** The body the listing is published with, for the group's choice. */
export function groupBody(group: PhotoGroup): {
  pieces?: { id?: string; title: string; priceMinor: number; boxes: PhotoBox[]; condition?: string; authenticity?: string }[];
  bundle?: boolean; setItems?: { title: string; boxes: PhotoBox[]; condition?: string; authenticity?: string }[]; seen?: PhotoBox[];
} {
  const seen = group.seen ?? [];
  if (group.mode === 'pieces') {
    return {
      pieces: group.pieces.map((piece) => ({ ...(piece.id ? { id: piece.id } : {}), title: piece.title.trim(), priceMinor: rupeesToMinor(piece.price), boxes: piece.boxes, ...factsBody(piece) })),
      seen,
    };
  }
  if (group.mode === 'lot') {
    return { bundle: true, setItems: group.pieces.map((piece) => ({ title: piece.title.trim(), boxes: piece.boxes, ...factsBody(piece) })), seen };
  }
  // Sold as one item, the photo is still counted: what was found goes with it.
  return seen.length ? { seen } : {};
}

/** The listing's own price: the cheapest piece while sold individually, the set's price as a set. */
export function groupPriceMinor(group: PhotoGroup): number {
  if (group.mode === 'lot') return rupeesToMinor(group.setPrice);
  const prices = group.pieces.map((piece) => rupeesToMinor(piece.price)).filter((minor) => minor >= 100);
  return prices.length ? Math.min(...prices) : 0;
}

export function useFeeTerms(): FeeTerms | null {
  const pricing = usePricing();
  if (!pricing) return null;
  const gst = pricing.gst.enabled && pricing.gst.applyTo.platform ? { rateBp: pricing.gst.rateBp, mode: pricing.gst.mode } : null;
  return { kind: 'shop', feeBands: pricing.fees.shop, discountBp: 0, gst, at: '' };
}

/** Switching between selling individually and as a set carries the prices across. */
function switchMode(group: PhotoGroup, mode: 'pieces' | 'lot'): PhotoGroup {
  if (mode === group.mode) return group;
  if (mode === 'lot') {
    const sum = group.pieces.reduce((total, piece) => total + rupeesToMinor(piece.price), 0);
    return { ...group, mode, confirmed: false, setPrice: group.setPrice || (sum > 0 ? String(sum / 100) : '') };
  }
  const shares = sharesOf(rupeesToMinor(group.setPrice), group.pieces.length);
  return {
    ...group, mode, confirmed: false,
    pieces: group.pieces.map((piece, index) => (piece.price || !shares[index] ? piece : { ...piece, price: String(Math.round(shares[index]! / 100)) })),
  };
}

/**
 * Reads the lead photo when it changes, asks how its things are sold, and
 * lists them either way.
 */
export function PhotoGroupBox({ photoUrl, group, onChange, title = '', onStock, onContinue, mixed = [], bulk, onBulk }: {
  photoUrl: string | null;
  group: PhotoGroup;
  onChange: Dispatch<SetStateAction<PhotoGroup>>;
  /** The listing's title, read for a hint of how many things it sells. */
  title?: string;
  /** Copies of one item: list them as this many in stock. */
  onStock?: (count: number) => void;
  /** A way of selling was chosen: the rest of the form can follow. */
  onContinue?: () => void;
  /** Questions the listing answered "Mixed": each row answers its own. */
  mixed?: readonly MixedFact[];
  /** Condition and original-or-copy for every item at once. */
  bulk?: readonly BulkFact[];
  onBulk?: (key: BulkFact['key'], value: string) => void;
}) {
  const terms = useFeeTerms();

  // A new lead photo is read again; the same one, coming back to a draft, is not.
  useEffect(() => {
    if (!photoUrl) {
      if (group.photoUrl) onChange(emptyGroup());
      return;
    }
    if (photoUrl === group.photoUrl) return;
    let live = true;
    // Asked straight away; the items arrive while the seller decides.
    onChange((now) => ({ ...emptyGroup(), mode: now.mode === 'pieces' || now.mode === 'lot' ? now.mode : 'ask', setPrice: now.setPrice, photoUrl, reading: true }));
    const server = api.detectPieces(photoUrl).then((result) => result.pieces).catch(() => []);
    const settle = (named: { label: string | null; boxes: PhotoBox[] }[], boxes: PhotoBox[], final: boolean) => {
      if (!live) return;
      // Put together as photo search does (photoThings.ts), so a photo shows the same things in both.
      const found: DraftPiece[] = mergeThings(named, boxes, MAX_PIECES)
        .map((thing) => ({ key: newKey(), title: thing.label ?? '', price: '', boxes: thing.boxes, label: thing.label }));
      onChange((now) => {
        if (now.photoUrl !== photoUrl) return now;
        // Rows the seller already touched are kept; the rest follow the better reading.
        const touched = now.pieces.filter((piece) => piece.title !== (piece.label ?? '') || piece.price);
        const fresh = found.filter((piece) => !touched.some((kept) => kept.boxes.some((box) => piece.boxes.some((other) => sameness(box, other) >= 0.45))));
        const pieces = [...touched, ...fresh].sort(readingOrder).slice(0, MAX_PIECES);
        const asked = now.mode === 'pieces' || now.mode === 'lot';
        // Views of one thing side by side - a product's collage - are one item (shared/photo-things.ts).
        const count = viewsLineup(found.map((piece) => piece.boxes[0]!)) ? 1 : found.length;
        return {
          ...now,
          reading: !final,
          found: count,
          seen: found.flatMap((piece) => piece.boxes),
          pieces,
          // One thing or none, and nothing chosen yet: an ordinary listing, with a way in.
          mode: final && !asked && count < 2 ? 'single' : now.mode,
        };
      });
    };
    const phone = import('../photoDetect').then((module) =>
      module.detectAllThings(photoUrl, (early) => { void server.then((named) => settle(named, early, false)); }))
      .catch(() => [] as PhotoBox[]);
    void Promise.all([server, phone]).then(([named, boxes]) => {
      settle(named, boxes, true);
      if (!live) return;
      // Then what they make up - one item, copies of one, different things - before any choice is offered.
      const places = mergeThings(named, boxes, MAX_PIECES).flatMap((thing) => thing.boxes);
      const fallback: PhotoAnalysis = { found: Math.min(1, places.length), kinds: Math.min(1, places.length), largest: Math.min(1, places.length), lineup: viewsLineup(places), several: false };
      onChange((now) => (now.photoUrl === photoUrl ? { ...now, analysis: null, reading: true } : now));
      void (places.length >= 2 ? api.analysePieces(photoUrl, places).then((result) => result.analysis) : Promise.resolve(fallback))
        .catch(() => fallback)
        .then((analysis) => {
          if (!live) return;
          onChange((now) => {
            if (now.photoUrl !== photoUrl) return now;
            const asked = now.mode === 'pieces' || now.mode === 'lot';
            return { ...now, reading: false, analysis, mode: asked ? now.mode : 'ask' };
          });
        });
    });
    return () => { live = false; };
  }, [photoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!photoUrl) return null;

  // What the photo holds, with the title's hint where the photo leaves it open.
  const hint = titleHint(title);
  const analysis: PhotoAnalysis = group.analysis
    ?? { found: Math.min(1, group.found), kinds: Math.min(1, group.found), largest: Math.min(1, group.found), lineup: false, several: false };
  const verdict: PhotoVerdict = photoVerdict(analysis, hint);
  const shown = verdict.kind === 'one' ? 1 : verdict.count;
  const titleNote = !group.reading && analysis.several && hint.count !== null && hint.count !== shown && analysis.found > 0
    ? <p className="pcs-note">Title says {hint.count}, photo shows {shown}.</p>
    : null;
  const go = (next: PhotoGroup) => { haptic('tap'); onChange({ ...next, chosen: true }); onContinue?.(); };
  const choosing = (group.mode === 'ask' || group.mode === 'single') && !group.chosen;
  const change = () => onChange({ ...group, chosen: false, copies: null, mode: 'ask' });

  if (choosing && group.reading) {
    return <div className="pcs-read"><span className="pcs-spin" aria-hidden="true" /> Scanning your photo…</div>;
  }
  if (choosing && title.trim().length < 3) {
    return <div className="pcs-read">Add a title to continue.</div>;
  }

  if (group.mode === 'single' && !choosing) {
    return (
      <div className="pcs-read is-done">
        <span>✓ {group.copies ? <><b>{group.copies}</b> in stock</> : <b>One item</b>}</span>
        <button type="button" className="pcs-link" onClick={change}>Change</button>
      </div>
    );
  }

  const pickOne = () => go({ ...group, copies: null, mode: 'single' });
  const pickEach = () => go(switchMode({ ...group, copies: null, mode: 'single' }, 'pieces'));
  const pickSet = () => go(switchMode({ ...group, copies: null, mode: 'single' }, 'lot'));

  // Sure of several copies of one item: from stock, or all together.
  if (choosing && verdict.kind === 'copies') {
    const n = verdict.count;
    return (
      <div className="pcs-pick">
        <p className="pcs-pick__q">We found approx. <b>{n}</b> of the same item in this photo</p>
        <p className="pcs-pick__sub">How many items in this photo are you listing?</p>
        {titleNote}
        <div className="pcs-pick__ways">
          <button type="button" className="pcs-tile" onClick={() => { onStock?.(n); go({ ...group, copies: n, mode: 'single' }); }}>
            <b>{n} in stock</b><span>Buyers choose how many</span>
          </button>
          <button type="button" className="pcs-tile" onClick={pickSet}>
            <b>All {n} together</b><span>One price for the lot</span>
          </button>
        </div>
      </div>
    );
  }

  // Sure of several different items: each on its own, or as a set.
  if (choosing && verdict.kind === 'different') {
    return (
      <div className="pcs-pick">
        <p className="pcs-pick__q">We found approx. <b>{shown}</b> different items in this photo</p>
        <p className="pcs-pick__sub">How many items in this photo are you listing?</p>
        {titleNote}
        <div className="pcs-pick__ways">
          <button type="button" className="pcs-tile" onClick={pickSet}><b>Multiple items as a set</b><span>One price for all</span></button>
          <button type="button" className="pcs-tile" onClick={pickEach}><b>Multiple items individually</b><span>A price for each</span></button>
        </div>
      </div>
    );
  }

  // Not sure: the seller says. One item first - what most photos are.
  if (choosing) {
    return (
      <div className="pcs-pick">
        <p className="pcs-pick__q">How many items in this photo are you listing?</p>
        <div className="pcs-pick__ways pcs-pick__ways--3">
          <button type="button" className="pcs-tile is-first" onClick={pickOne}><b>1 item to sell</b></button>
          <button type="button" className="pcs-tile" onClick={pickSet}><b>Multiple items as a set</b><span>One price for all</span></button>
          <button type="button" className="pcs-tile" onClick={pickEach}><b>Multiple items individually</b><span>A price for each</span></button>
        </div>
      </div>
    );
  }

  const status = group.reading
    ? <span className="pcs-status"><span className="pcs-spin" aria-hidden="true" /> Scanning{group.pieces.length ? ` - ${group.pieces.length} so far` : ''}…</span>
    : null;

  // What the AI found goes first; rows the seller touched stay, and so does any other find it missed.
  const takeScan = (things: FoundThing[]) => onChange((now) => {
    if (now.photoUrl !== photoUrl) return now;
    const same = (a: PhotoBox[], b: PhotoBox[]) => a.some((box) => b.some((other) => sameness(box, other) >= 0.45));
    const touched = now.pieces.filter((piece) => piece.title !== (piece.label ?? '') || piece.price);
    const scanned: DraftPiece[] = things
      .filter((thing) => !touched.some((kept) => same(kept.boxes, thing.boxes)))
      .map((thing) => ({ key: newKey(), title: thing.label ?? '', price: '', boxes: thing.boxes, label: thing.label }));
    const rest = now.pieces.filter((piece) => !touched.includes(piece));
    const pieces = [...touched, ...overlayScan(scanned, rest)].sort(readingOrder).slice(0, MAX_PIECES);
    return { ...now, pieces, found: pieces.length, seen: pieces.flatMap((piece) => piece.boxes), confirmed: false };
  });
  const scanButton = !group.reading && <AiScan photoUrl={photoUrl} onFound={takeScan} />;

  const setMode = group.mode === 'lot';
  const priceMinor = rupeesToMinor(group.setPrice);
  const count = feeCount(group);
  const setFee = terms && setMode && priceMinor >= 100 ? saleFee(terms, { amountMinor: priceMinor, units: count }) : null;

  return (
    <div className="pcs-edit">
      <div className="pcs-switch" role="radiogroup" aria-label="How these are sold">
        <button type="button" role="radio" aria-checked={!setMode} className={!setMode ? 'is-on' : ''}
          onClick={() => onChange((now) => switchMode(now, 'pieces'))}>Individually</button>
        <button type="button" role="radio" aria-checked={setMode} className={setMode ? 'is-on' : ''}
          onClick={() => onChange((now) => switchMode(now, 'lot'))}>As a set</button>
      </div>
      {!analysis.several && <button type="button" className="pcs-link pcs-edit__back" onClick={change}>Back</button>}
      {setMode && (
        <label className="pcs-setprice">
          <span>Set price</span>
          <span className="pcs-setprice__box">
            <span aria-hidden="true">₹</span>
            <input id="sell-set-price" type="number" inputMode="numeric" min="1" step="1" value={group.setPrice ?? ''} placeholder="25000"
              onChange={(event) => onChange({ ...group, setPrice: event.target.value })} />
          </span>
          {priceMinor >= 100 && group.pieces.length > 0 && (
            <span className="pcs-setprice__split">≈ {formatMoney(Math.floor(priceMinor / group.pieces.length))} each</span>
          )}
        </label>
      )}
      {status}
      {scanButton}
      <PieceList photoUrl={photoUrl} mode={setMode ? 'set' : 'each'} pieces={group.pieces}
        setPriceMinor={priceMinor} mixed={mixed} bulk={bulk} onBulk={onBulk}
        onPieces={(update) => onChange((now) => ({ ...now, pieces: update(now.pieces), confirmed: false }))} />

      <div className="pcs-confirm">
        {photoFloor(group) > group.pieces.length && !group.reading && (
          <p className="pcs-note pcs-note--warn">
            {group.pieces.length} of {photoFloor(group)} listed. Fee counts at least {Math.ceil(photoFloor(group) * (1 - FIND_SLACK))}.
          </p>
        )}
        <label className="pcs-check">
          <input type="checkbox" checked={group.confirmed} disabled={group.pieces.length < 2}
            onChange={(event) => onChange({ ...group, confirmed: event.target.checked })} />
          <span>Selling these <b>{group.pieces.length}</b> {group.pieces.length === 1 ? 'item' : 'items'}</span>
        </label>
        <FeeSummary terms={terms} setMode={setMode} pieces={group.pieces} count={count} setPriceMinor={priceMinor} setFee={setFee} />
      </div>
    </div>
  );
}

function FeeSummary({ terms, setMode, pieces, count, setPriceMinor, setFee }: {
  terms: FeeTerms | null; setMode: boolean; pieces: DraftPiece[]; count: number; setPriceMinor: number;
  setFee: ReturnType<typeof saleFee> | null;
}) {
  if (setMode) {
    return (
      <div className="pcs-fee">
        <span className="pcs-fee__label">Figmark fee</span>
        <b className="pcs-fee__sum">{setFee ? formatMoney(setFee.totalMinor) : '₹—'}</b>
        <span className="pcs-fee__how">
          {setFee ? <>{count} {count === 1 ? 'item' : 'items'} × {formatMoney(Math.round(setFee.totalMinor / count))}</> : <>Per item in the set</>}
        </span>
      </div>
    );
  }
  // As the server counts it: never on fewer than most of what was found, the rest spread over the rows.
  const units = spreadUnits(pieces.map(() => 1), count);
  const priced = pieces.map((piece, index) => ({ priceMinor: rupeesToMinor(piece.price), units: units[index] ?? 1 }))
    .filter((piece) => piece.priceMinor >= 100);
  const fee = terms && priced.length ? saleFee(terms, { amountMinor: 0, pieces: priced }) : null;
  const floored = count > pieces.length;
  return (
    <div className="pcs-fee">
      <span className="pcs-fee__label">Figmark fee</span>
      <b className="pcs-fee__sum">{fee ? formatMoney(fee.totalMinor) : '₹—'}</b>
      <span className="pcs-fee__how">
        If all sell{floored ? <> · counted on {count} items</> : null}
      </span>
    </div>
  );
}

/**
 * The photo to mark things on, and a row for each: what the sell form shows
 * for both ways of selling, and what a published listing's edit shows.
 */
export function PieceList({ photoUrl, mode, pieces, onPieces, setPriceMinor = 0, mixed = [], bulk = [], onBulk }: {
  photoUrl: string;
  mode: 'each' | 'set';
  pieces: DraftPiece[];
  onPieces: (update: (now: DraftPiece[]) => DraftPiece[]) => void;
  setPriceMinor?: number;
  /** Questions the listing answered "Mixed": a small menu for each on every row. */
  mixed?: readonly MixedFact[];
  /** Condition and original-or-copy for every item at once, under the tools. */
  bulk?: readonly BulkFact[];
  onBulk?: (key: BulkFact['key'], value: string) => void;
}) {
  /** Drawing a new box: for a new row, or for the row being marked (`placing`). */
  const [adding, setAdding] = useState(false);
  /** A row waiting for its place on the photo: the next box drawn is its. */
  const [placing, setPlacing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [allPrice, setAllPrice] = useState('');
  const each = mode === 'each';
  const shares = sharesOf(setPriceMinor, pieces.length);

  const update = (key: string, patch: Partial<DraftPiece>) =>
    onPieces((now) => now.map((piece) => (piece.key === key ? { ...piece, ...patch } : piece)));
  const remove = (key: string) => {
    onPieces((now) => now.filter((entry) => entry.key !== key));
    if (selected === key) setSelected(null);
  };

  /** Pick a row: its box lights up on the photo, and its name can be typed under it. */
  const pick = (key: string | null) => {
    setSelected(key);
    if (key) document.querySelector(`#pcs-row-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  function addBox(box: PhotoBox) {
    setAdding(false);
    if (placing) {
      const key = placing;
      onPieces((now) => now.map((piece) => (piece.key === key ? { ...piece, boxes: [...piece.boxes, box].slice(0, 4) } : piece)));
      setPlacing(null);
      setSelected(key);
      return;
    }
    if (pieces.length >= MAX_PIECES) return;
    const key = newKey();
    onPieces((now) => [...now, { key, title: '', price: allPrice, boxes: [box], label: null }]);
    setSelected(key);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#pcs-tag-title')?.focus({ preventScroll: true }));
  }

  /** Two rows that are one thing shown twice: one row, one fee. */
  function join(key: string, into: string) {
    onPieces((now) => {
      const from = now.find((piece) => piece.key === key);
      if (!from || from.sold) return now;
      return now.filter((piece) => piece.key !== key).map((piece) => (piece.key === into
        ? { ...piece, boxes: [...piece.boxes, ...from.boxes].slice(0, 4), title: piece.title || from.title, price: piece.price || from.price }
        : piece));
    });
    setSelected(into);
  }
  function split(key: string) {
    onPieces((now) => {
      const piece = now.find((entry) => entry.key === key);
      if (!piece || piece.boxes.length < 2 || piece.sold) return now;
      const [first, ...rest] = piece.boxes;
      return [
        ...now.map((entry) => (entry.key === key ? { ...entry, boxes: [first!] } : entry)),
        ...rest.map((box) => ({ key: newKey(), title: '', price: piece.price, boxes: [box], label: null, condition: piece.condition, authenticity: piece.authenticity })),
      ];
    });
  }
  function more(piece: DraftPiece, pick: string) {
    if (pick === 'view') { setPlacing(piece.key); setAdding(true); } else if (pick === 'split') split(piece.key);
    else if (pick === 'remove') remove(piece.key);
    else if (pick) join(piece.key, pick);
  }
  function applyList() {
    const lines = parsePriceList(pasted);
    if (lines.length === 0) {
      setPasteNote('No prices found. Put each item on a line with its price, like "Wasp 1850", or the price on the next line.');
      return;
    }
    const open = pieces.filter((piece) => !piece.sold);
    onPieces((now) => {
      let line = 0;
      const next = now.map((piece) => {
        if (piece.sold || !lines[line]) return piece;
        const entry = lines[line++]!;
        return { ...piece, title: entry.title, price: each ? String(entry.priceMinor / 100) : piece.price };
      });
      const extra = lines.slice(line).map((entry) => ({
        key: newKey(), title: entry.title, price: each ? String(entry.priceMinor / 100) : '', boxes: [] as PhotoBox[], label: null,
      }));
      return [...next, ...extra].slice(0, MAX_PIECES);
    });
    const extra = Math.max(0, lines.length - open.length);
    setPasteNote(`Filled ${Math.min(lines.length, open.length)} items in photo order.${extra
      ? ` ${extra} more ${extra === 1 ? 'is' : 'are'} not on the photo yet: press "Mark" on ${extra === 1 ? 'it' : 'each'} and tap where it is.`
      : ' Check each one matches its number on the photo.'}`);
    setPasting(false);
  }
  /** One price for every item still for sale, over whatever each had. */
  function priceAll() {
    if (rupeesToMinor(allPrice) < 100) return;
    haptic('tap');
    onPieces((now) => now.map((piece) => (piece.sold ? piece : { ...piece, price: allPrice })));
  }
  /** Every price cleared, to start the prices again. */
  function resetPrices() {
    haptic('tap');
    setAllPrice('');
    onPieces((now) => now.map((piece) => (piece.sold ? piece : { ...piece, price: '' })));
  }
  const anyPriced = pieces.some((piece) => !piece.sold && piece.price);

  const isDone = (piece: DraftPiece) => (each ? piece.title.trim().length >= 2 && rupeesToMinor(piece.price) >= 100 : true);
  const chosen = pieces.find((piece) => piece.key === selected) ?? null;
  const chosenAt = chosen ? pieces.indexOf(chosen) : -1;

  /** What else can be done with a row: another view of it, its views apart, it is the same as another, take it off. */
  const moreMenu = (piece: DraftPiece, index: number) => (
    <select className="pcs-more" value="" aria-label={`More for item ${index + 1}`} onChange={(event) => more(piece, event.target.value)}>
      <option value="">⋯</option>
      <option value="remove">Remove this item</option>
      {piece.boxes.length > 0 && piece.boxes.length < 4 && <option value="view">Mark another view of it</option>}
      {piece.boxes.length > 1 && <option value="split">Split its views into items</option>}
      {pieces.length > 1 && (
        <optgroup label="It is the same item as">
          {pieces.filter((other) => other.key !== piece.key && !other.sold).map((other) => (
            <option key={other.key} value={other.key}>#{pieces.indexOf(other) + 1} {other.title || ''}</option>
          ))}
        </optgroup>
      )}
    </select>
  );

  return (
    <div className="pcs-items">
      <PhotoMarker photoUrl={photoUrl} selected={selected} onSelect={pick}
        things={pieces.map((piece) => ({ key: piece.key, boxes: piece.boxes, done: isDone(piece), sold: piece.sold }))}
        adding={adding} onAdding={(on) => { setAdding(on); if (!on) setPlacing(null); }}
        onAdd={addBox}
        onBox={(key, view, box) => onPieces((now) => now.map((piece) => (piece.key === key
          ? { ...piece, boxes: piece.boxes.map((place, index) => (index === view ? box : place)) }
          : piece)))}>
        {placing && <p className="pcs-note pcs-note--ok">Drag round item {pieces.findIndex((piece) => piece.key === placing) + 1}.</p>}
        {chosen && (
          <div className="pcs-tag" role="group" aria-label={`Item ${chosenAt + 1}`}>
            <span className="pcs-tag__n">#{chosenAt + 1}</span>
            <input id="pcs-tag-title" className="pcs-tag__title" value={chosen.title} disabled={chosen.sold}
              placeholder={chosen.label ?? (each ? 'Name this item' : 'Name (optional)')}
              aria-label={`Title of item ${chosenAt + 1}`} onChange={(event) => update(chosen.key, { title: event.target.value })} />
            {each && !chosen.sold && (
              <span className="pcs-pricebox pcs-pricebox--tag">
                <span aria-hidden="true">₹</span>
                <input type="number" inputMode="numeric" min="1" step="1" value={chosen.price} placeholder="Price"
                  aria-label={`Price of item ${chosenAt + 1}`} onChange={(event) => update(chosen.key, { price: event.target.value })} />
              </span>
            )}
            {!chosen.sold && moreMenu(chosen, chosenAt)}
            <button type="button" className="pcs-tag__done" onClick={() => setSelected(null)} aria-label="Done with this item">✓</button>
          </div>
        )}
      </PhotoMarker>

      <div className="pcs-tools">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPasting(!pasting)}>Paste {each ? 'price list' : 'names'}</button>
        {each && (
          <span className="pcs-tools__all">
            <span className="pcs-pricebox pcs-pricebox--sm">
              <span aria-hidden="true">₹</span>
              <input type="number" inputMode="numeric" min="1" placeholder="Same price" value={allPrice}
                onChange={(event) => setAllPrice(event.target.value)} aria-label="One price for every item" />
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={priceAll} disabled={rupeesToMinor(allPrice) < 100}>Fill all</button>
            <button type="button" className="pcs-reset" onClick={resetPrices} disabled={!anyPriced && !allPrice}
              aria-label="Reset all prices" title="Reset all prices">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
              </svg>
            </button>
          </span>
        )}
      </div>
      {pasting && (
        <div className="pcs-paste">
          <textarea rows={6} value={pasted} onChange={(event) => setPasted(event.target.value)}
            placeholder={'Paste your sale post, e.g.\nMarvel Legends Wasp\n1850\nThing first appearance - 3000'} />
          <div className="pcs-paste__go">
            <span className="faint">Fills 1, 2, 3… in order</span>
            <button type="button" className="btn btn--sm" onClick={applyList} disabled={!pasted.trim()}>Fill items</button>
          </div>
        </div>
      )}
      {pasteNote && <p className="pcs-note pcs-note--ok" role="status">{pasteNote}</p>}

      {bulk.length > 0 && onBulk && (
        <div className="pcs-bulk">
          {bulk.map((fact) => {
            const isMixed = fact.value === MIXED;
            const name = fact.label.replace(/\?$/, '');
            return (
              <div key={fact.key} className={`attr pcs-bulk__row${fact.missing ? ' is-missing' : ''}`} role="group" aria-label={fact.label}>
                <div className="pcs-bulk__head">
                  <span className="attr__label">
                    {name}{fact.required && <span className="attr__req" aria-hidden="true"> *</span>}
                  </span>
                  {isMixed && (
                    <Select className="pcs-bulk__all" value="" aria-label={`${name} for every item`}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value) return;
                        haptic('tap');
                        onPieces((now) => now.map((piece) => (piece.sold ? piece : { ...piece, [fact.key]: value })));
                      }}>
                      <option value="">Set all…</option>
                      {fact.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </Select>
                  )}
                </div>
                {fact.options.length === 0 ? (
                  <span className="field__hint">Pick what kind it is first.</span>
                ) : (
                  <div className="tags">
                    {[...fact.options, { value: MIXED, label: MIXED }].map((option) => (
                      <button key={option.value} type="button" className={`tag${fact.value === option.value ? ' is-on' : ''}`}
                        aria-pressed={fact.value === option.value}
                        onClick={() => { haptic('tap'); onBulk(fact.key, fact.value === option.value ? '' : option.value); }}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                <span className="field__hint">
                  {isMixed ? 'Choose for each item below, or set them all at once.' : fact.value ? 'Applies to every item.' : 'One answer for every item, or Mixed.'}
                </span>
                {fact.missing && <span className="attr__ask">Choose one to publish.</span>}
              </div>
            );
          })}
        </div>
      )}

      <ol className={`pcs-erows${each ? '' : ' pcs-erows--set'}`}>
        {pieces.map((piece, index) => (
          <li key={piece.key} id={`pcs-row-${piece.key}`}
            className={`pcs-erow${selected === piece.key ? ' is-on' : ''}${piece.sold ? ' is-sold' : ''}${isDone(piece) ? ' is-done' : ''}`}
            onFocus={() => setSelected(piece.key)}>
            <button type="button" className="pcs-erow__pic" aria-label={`Show item ${index + 1} on the photo`}
              onClick={() => (piece.boxes.length ? setSelected(piece.key) : (setPlacing(piece.key), setAdding(true)))}>
              {piece.boxes.length > 0
                ? <PieceThumb src={photoUrl} box={piece.boxes[0]!} size={44} sold={piece.sold} />
                : <span className="pcs-erow__mark">Mark</span>}
              <span className="pcs-erow__n">{index + 1}</span>
              {piece.boxes.length > 1 && (
                <span className="pcs-erow__views" title="The same item shown more than once is one item and one fee">×{piece.boxes.length}</span>
              )}
            </button>
            <input id={`pcs-title-${piece.key}`} className="pcs-erow__title" value={piece.title} disabled={piece.sold}
              placeholder={piece.label ?? (each ? 'Name this item' : `Item ${index + 1}`)}
              aria-label={`Title of item ${index + 1}`} onChange={(event) => update(piece.key, { title: event.target.value })} />
            {piece.sold ? (
              <span className="pcs-erow__sold">Sold</span>
            ) : each ? (
              <span className="pcs-pricebox pcs-pricebox--row">
                <span aria-hidden="true">₹</span>
                <input type="number" inputMode="numeric" min="1" step="1" value={piece.price} placeholder="Price"
                  aria-label={`Price of item ${index + 1}`} onChange={(event) => update(piece.key, { price: event.target.value })} />
              </span>
            ) : (
              <span className="pcs-erow__share">{shares[index] ? formatMoney(shares[index]!) : '—'}</span>
            )}
            {piece.sold ? <span /> : moreMenu(piece, index)}
            {mixed.length > 0 && (
              // Not picking the row on the photo: that moves the list under the finger and the menu never opens.
              <span className="pcs-erow__facts" onFocus={(event) => event.stopPropagation()}>
                {mixed.map((fact) => (
                  <Select key={fact.key} className="pcs-fact" value={piece[fact.key] ?? ''} disabled={piece.sold}
                    aria-label={`${fact.label.replace(/\?$/, '')} of item ${index + 1}`}
                    onChange={(event) => update(piece.key, { [fact.key]: event.target.value || undefined })}>
                    <option value="">{fact.key === 'condition' ? 'Condition' : 'Original or copy'}</option>
                    {fact.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                ))}
              </span>
            )}
          </li>
        ))}
      </ol>
      {pieces.length === 0 && <p className="pcs-note">Press ＋ Add item and drag round each one.</p>}
    </div>
  );
}
