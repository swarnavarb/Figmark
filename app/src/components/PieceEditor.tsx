import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { saleFee, type FeeTerms } from '@shared/billing';
import { MAX_PIECES, parsePriceList, spreadUnits } from '@shared/pieces';
import { readingOrder, sameness } from '@shared/photo-things';
import { mergeThings, overlayScan, type FoundThing } from '../photoThings';
import { api, type PhotoBox } from '../api';
import { formatMoney } from '../format';
import { haptic } from '../haptics';
import { usePricing } from './Billing';
import { PieceThumb } from './Pieces';
import { AiScan } from './AiScan';
import { PhotoMarker } from './PhotoMarker';

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
}

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
export function feeCount(group: Pick<PhotoGroup, 'pieces' | 'found'>): number {
  return Math.max(1, group.pieces.length, Math.ceil(group.found * (1 - FIND_SLACK)));
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
  pieces?: { id?: string; title: string; priceMinor: number; boxes: PhotoBox[] }[];
  bundle?: boolean; setItems?: { title: string; boxes: PhotoBox[] }[]; seen?: PhotoBox[];
} {
  const seen = group.seen ?? [];
  if (group.mode === 'pieces') {
    return {
      pieces: group.pieces.map((piece) => ({ ...(piece.id ? { id: piece.id } : {}), title: piece.title.trim(), priceMinor: rupeesToMinor(piece.price), boxes: piece.boxes })),
      seen,
    };
  }
  if (group.mode === 'lot') {
    return { bundle: true, setItems: group.pieces.map((piece) => ({ title: piece.title.trim(), boxes: piece.boxes })), seen };
  }
  return {};
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
export function PhotoGroupBox({ photoUrl, group, onChange }: {
  photoUrl: string | null;
  group: PhotoGroup;
  onChange: Dispatch<SetStateAction<PhotoGroup>>;
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
        return {
          ...now,
          reading: !final,
          found: found.length,
          seen: found.flatMap((piece) => piece.boxes),
          pieces,
          // One thing or none, and nothing chosen yet: an ordinary listing, with a way in.
          mode: final && !asked && found.length < 2 ? 'single' : now.mode,
        };
      });
    };
    const phone = import('../photoDetect').then((module) =>
      module.detectAllThings(photoUrl, (early) => { void server.then((named) => settle(named, early, false)); }))
      .catch(() => [] as PhotoBox[]);
    void Promise.all([server, phone]).then(([named, boxes]) => settle(named, boxes, true));
    return () => { live = false; };
  }, [photoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!photoUrl) return null;

  if (group.mode === 'single') {
    return (
      <button type="button" className="pcs-way" onClick={() => onChange({ ...group, mode: 'ask' })}>
        {group.found >= 2
          ? <>📦 This photo shows about <b>{group.found}</b> items. <u>Sell them individually or as a set?</u></>
          : <>📦 Selling several things in this photo? <u>Mark them and price each one</u></>}
      </button>
    );
  }

  const status = group.reading
    ? <span className="pcs-status"><span className="pcs-spin" aria-hidden="true" /> Finding the items in your photo{group.pieces.length ? ` - ${group.pieces.length} so far` : ''}…</span>
    : group.found > 0 ? <span className="pcs-status">Found <b>{group.found}</b> {group.found === 1 ? 'item' : 'items'} in your photo</span> : null;

  if (group.mode === 'ask') {
    return (
      <div className="pcs-ask">
        <h3 className="pcs-ask__title">How are you selling what is in this photo?</h3>
        {status}
        <div className="pcs-ask__ways">
          <button type="button" className="pcs-tile" onClick={() => { haptic('tap'); onChange(switchMode({ ...group, mode: 'single' }, 'pieces')); }}>
            <span className="pcs-tile__icon" aria-hidden="true">🏷️</span>
            <b>Individually</b>
            <span>Each item has its own price. Buyers pick one or several and check out once; sold ones are crossed out.</span>
            <span className="pcs-tile__fee">Fee on each item as it sells</span>
          </button>
          <button type="button" className="pcs-tile" onClick={() => { haptic('tap'); onChange(switchMode({ ...group, mode: 'single' }, 'lot')); }}>
            <span className="pcs-tile__icon" aria-hidden="true">📦</span>
            <b>As a set</b>
            <span>One price for everything in the photo. A buyer takes the whole set.</span>
            <span className="pcs-tile__fee">Fee per item in the set</span>
          </button>
        </div>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange({ ...group, mode: 'single' })}>
          It is one item
        </button>
      </div>
    );
  }

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
          onClick={() => onChange((now) => switchMode(now, 'pieces'))}>🏷️ Individually</button>
        <button type="button" role="radio" aria-checked={setMode} className={setMode ? 'is-on' : ''}
          onClick={() => onChange((now) => switchMode(now, 'lot'))}>📦 As a set</button>
        <button type="button" className="pcs-switch__off" onClick={() => onChange({ ...group, mode: 'single' })}>One item</button>
      </div>
      {setMode && (
        <label className="pcs-setprice">
          <span>Price for the whole set</span>
          <span className="pcs-setprice__box">
            <span aria-hidden="true">₹</span>
            <input id="sell-set-price" type="number" inputMode="numeric" min="1" step="1" value={group.setPrice ?? ''} placeholder="25000"
              onChange={(event) => onChange({ ...group, setPrice: event.target.value })} />
          </span>
          {priceMinor >= 100 && group.pieces.length > 0 && (
            <span className="pcs-setprice__split">About {formatMoney(Math.floor(priceMinor / group.pieces.length))} an item across {group.pieces.length}</span>
          )}
        </label>
      )}
      {status}
      {scanButton}
      <PieceList photoUrl={photoUrl} mode={setMode ? 'set' : 'each'} pieces={group.pieces}
        setPriceMinor={priceMinor}
        onPieces={(update) => onChange((now) => ({ ...now, pieces: update(now.pieces), confirmed: false }))} />

      <div className="pcs-confirm">
        {group.found > group.pieces.length && !group.reading && (
          <p className="pcs-note pcs-note--warn">
            We found {group.found} items in the photo and {group.pieces.length} are listed. Taking off a wrong find is fine,
            but the fee is never counted on fewer than {Math.ceil(group.found * (1 - FIND_SLACK))}.
          </p>
        )}
        <label className="pcs-check">
          <input type="checkbox" checked={group.confirmed} disabled={group.pieces.length < 2}
            onChange={(event) => onChange({ ...group, confirmed: event.target.checked })} />
          <span>{setMode ? 'Yes, this set is' : 'Yes, I am selling'} these <b>{group.pieces.length}</b> {group.pieces.length === 1 ? 'item' : 'items'}</span>
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
          {setFee
            ? <>{count} different {count === 1 ? 'item' : 'items'} × {formatMoney(Math.round(setFee.totalMinor / count))}, as if each sold alone at {formatMoney(Math.floor(setPriceMinor / count))}.</>
            : <>Per different item in the set, as if each sold alone. Enter the set price to see it.</>}
          {' '}The same item shown twice counts once.
        </span>
      </div>
    );
  }
  // As the server counts it: never on fewer than most of what was found, the rest spread over the rows.
  const units = spreadUnits(pieces.map(() => 1), count);
  const priced = pieces.map((piece, index) => ({ priceMinor: rupeesToMinor(piece.price), units: units[index] ?? 1 }))
    .filter((piece) => piece.priceMinor >= 100);
  const fee = terms && priced.length ? saleFee(terms, { amountMinor: 0, pieces: priced }) : null;
  const sum = priced.reduce((total, piece) => total + piece.priceMinor, 0);
  const floored = count > pieces.length;
  return (
    <div className="pcs-fee">
      <span className="pcs-fee__label">Figmark fee</span>
      <b className="pcs-fee__sum">{fee ? formatMoney(fee.totalMinor) : '₹—'}</b>
      <span className="pcs-fee__how">
        Charged on each item as it sells{fee ? <>, if all {priced.length} sell for {formatMoney(sum)}</> : null}.
        {floored
          ? <> Counted on {count} items, not the {pieces.length} listed: most of what is in the photo counts.</>
          : <> A row holding two different items is charged for both.</>}
      </span>
    </div>
  );
}

/**
 * The photo to mark things on, and a row for each: what the sell form shows
 * for both ways of selling, and what a published listing's edit shows.
 */
export function PieceList({ photoUrl, mode, pieces, onPieces, setPriceMinor = 0 }: {
  photoUrl: string;
  mode: 'each' | 'set';
  pieces: DraftPiece[];
  onPieces: (update: (now: DraftPiece[]) => DraftPiece[]) => void;
  setPriceMinor?: number;
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
        ...rest.map((box) => ({ key: newKey(), title: '', price: piece.price, boxes: [box], label: null })),
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
  function priceAll() {
    if (rupeesToMinor(allPrice) < 100) return;
    onPieces((now) => now.map((piece) => (piece.price || piece.sold ? piece : { ...piece, price: allPrice })));
  }

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
        {placing && <p className="pcs-note pcs-note--ok">Marking where item {pieces.findIndex((piece) => piece.key === placing) + 1} is: drag round it on the photo.</p>}
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
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPasting(!pasting)}>📋 Paste {each ? 'price list' : 'item names'}</button>
        {each && (
          <span className="pcs-tools__all">
            <span className="pcs-pricebox pcs-pricebox--sm">
              <span aria-hidden="true">₹</span>
              <input type="number" inputMode="numeric" min="1" placeholder="Same price" value={allPrice}
                onChange={(event) => setAllPrice(event.target.value)} aria-label="One price for every item without one" />
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={priceAll} disabled={rupeesToMinor(allPrice) < 100}>Fill empty</button>
          </span>
        )}
      </div>
      {pasting && (
        <div className="pcs-paste">
          <textarea rows={6} value={pasted} onChange={(event) => setPasted(event.target.value)}
            placeholder={'Paste your sale post, e.g.\nMarvel Legends Wasp\n1850\nThing first appearance - 3000'} />
          <div className="pcs-paste__go">
            <span className="faint">Fills the rows in photo order: 1, 2, 3…</span>
            <button type="button" className="btn btn--sm" onClick={applyList} disabled={!pasted.trim()}>Fill items</button>
          </div>
        </div>
      )}
      {pasteNote && <p className="pcs-note pcs-note--ok" role="status">{pasteNote}</p>}

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
          </li>
        ))}
      </ol>
      {pieces.length === 0 && <p className="pcs-note">Nothing marked yet. Press "＋ Add item" and drag round each item on the photo.</p>}
    </div>
  );
}
