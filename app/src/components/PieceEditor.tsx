import { useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { saleFee, type FeeTerms } from '@shared/billing';
import { MAX_PIECES, chargedUnits, parsePriceList } from '@shared/pieces';
import { api, type PhotoBox } from '../api';
import { formatMoney } from '../format';
import { haptic } from '../haptics';
import { usePricing } from './Billing';
import { PiecePhoto, PieceThumb, boxStyle } from './Pieces';

/*
 * The sell form's answer to a photo of several things.
 *
 * When the lead photo goes in, the things in it are found - by the server
 * (Claude when it is on, and whatever stands off a plain backdrop) and by the
 * phone's own detector - and if there is more than one the seller is asked:
 * sell them separately, each with its own price, or all together for one?
 *
 * Separately, every thing found is a row to give a title and a price, and
 * anything missed is marked by dragging a box round it on the photo (or a tap
 * on it). The same thing shown twice - front and back - is joined into one
 * row, which is one fee. A pasted price list fills the rows in order.
 *
 * Together, the seller says how many things are in the lot. Figmark counts
 * them as well, and the fee is worked out on the larger number - shown here,
 * before publishing, with the reason.
 */

export interface DraftPiece {
  key: string;
  title: string;
  /** In rupees, as typed. */
  price: string;
  boxes: PhotoBox[];
  /** What the photo reader called it, when it named it. */
  label?: string | null;
}

export type GroupMode = 'ask' | 'single' | 'pieces' | 'lot';

export interface PhotoGroup {
  /** The photo this was read from; a new lead photo is read again. */
  photoUrl: string | null;
  reading: boolean;
  /** Distinct things found in the photo. */
  found: number;
  mode: GroupMode;
  pieces: DraftPiece[];
  /** A lot's count, as typed. */
  lotCount: string;
  /** The seller has confirmed the count. */
  confirmed: boolean;
}

export const emptyGroup = (): PhotoGroup => ({
  photoUrl: null, reading: false, found: 0, mode: 'single', pieces: [], lotCount: '', confirmed: false,
});

let counter = 0;
const newKey = () => `p${Date.now().toString(36)}${(counter += 1)}`;

const rupeesToMinor = (value: string) => Math.round(Number(value || 0) * 100);

/** Two boxes round mostly the same place. */
function overlap(a: PhotoBox, b: PhotoBox): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const shared = w * h;
  return Math.max(shared / (a[2] * a[3]), shared / (b[2] * b[3]));
}

/** Top row first, then left to right: how the rows are numbered. */
function byReading(a: { boxes: PhotoBox[] }, b: { boxes: PhotoBox[] }): number {
  const [ax, ay, , ah] = a.boxes[0] ?? [0, 0, 0, 0];
  const [bx, by, , bh] = b.boxes[0] ?? [0, 0, 0, 0];
  const acy = ay + ah / 2; const bcy = by + bh / 2;
  if (Math.abs(acy - bcy) > Math.min(ah, bh) / 2) return acy - bcy;
  return ax - bx;
}

/** What still stands between this group and publishing, in words; empty when nothing does. */
export function groupProblems(group: PhotoGroup): string[] {
  if (group.mode === 'pieces') {
    const out: string[] = [];
    if (group.pieces.length < 2) out.push('at least two items marked on the photo');
    if (group.pieces.length > MAX_PIECES) out.push(`at most ${MAX_PIECES} items`);
    const unnamed = group.pieces.filter((piece) => piece.title.trim().length < 2).length;
    if (unnamed) out.push(`a title for ${unnamed} ${unnamed === 1 ? 'item' : 'items'}`);
    const unpriced = group.pieces.filter((piece) => rupeesToMinor(piece.price) < 100).length;
    if (unpriced) out.push(`a price for ${unpriced} ${unpriced === 1 ? 'item' : 'items'}`);
    const unmarked = group.pieces.filter((piece) => piece.boxes.length === 0).length;
    if (unmarked) out.push(`${unmarked} ${unmarked === 1 ? 'item' : 'items'} marked on the photo`);
    if (!group.confirmed) out.push('a tick to confirm the number of items');
    return out;
  }
  if (group.mode === 'lot') {
    const out: string[] = [];
    const count = Math.round(Number(group.lotCount));
    if (!Number.isFinite(count) || count < 1) out.push('how many items are in the lot');
    if (!group.confirmed) out.push('a tick to confirm the number of items');
    return out;
  }
  return [];
}

/** The body the listing is published with, for the group's choice. */
export function groupBody(group: PhotoGroup): {
  pieces?: { title: string; priceMinor: number; boxes: PhotoBox[] }[]; bundle?: boolean; bundleItems?: number; bundleSeen?: number;
} {
  if (group.mode === 'pieces') {
    return { pieces: group.pieces.map((piece) => ({ title: piece.title.trim(), priceMinor: rupeesToMinor(piece.price), boxes: piece.boxes })) };
  }
  if (group.mode === 'lot') {
    return { bundle: true, bundleItems: Math.round(Number(group.lotCount)), bundleSeen: group.found };
  }
  return {};
}

/** The cheapest piece: what the listing's own price is while sold separately. */
export function groupFromMinor(group: PhotoGroup): number {
  const prices = group.pieces.map((piece) => rupeesToMinor(piece.price)).filter((minor) => minor >= 100);
  return prices.length ? Math.min(...prices) : 0;
}

function useFeeTerms(): FeeTerms | null {
  const pricing = usePricing();
  if (!pricing) return null;
  const gst = pricing.gst.enabled && pricing.gst.applyTo.platform ? { rateBp: pricing.gst.rateBp, mode: pricing.gst.mode } : null;
  return { kind: 'shop', feeBands: pricing.fees.shop, discountBp: 0, gst, at: '' };
}

/**
 * Reads the lead photo when it changes and asks how to sell what is in it.
 * `lotPriceMinor` is the form's own price, which a lot sells for.
 */
export function PhotoGroupBox({ photoUrl, group, onChange, lotPriceMinor }: {
  photoUrl: string | null;
  group: PhotoGroup;
  onChange: Dispatch<SetStateAction<PhotoGroup>>;
  lotPriceMinor: number;
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
    onChange((now) => ({ ...now, photoUrl, reading: true }));
    const server = api.detectPieces(photoUrl).then((result) => result.pieces).catch(() => []);
    const phone = import('../photoDetect').then((module) => module.detectAllThings(photoUrl)).catch(() => [] as PhotoBox[]);
    void Promise.all([server, phone]).then(([named, boxes]) => {
      if (!live) return;
      // The server's first - it knows names and which boxes are one thing -
      // then whatever the phone found where the server found nothing.
      const found: DraftPiece[] = named.map((piece) => ({
        key: newKey(), title: piece.label ?? '', price: '', boxes: piece.boxes, label: piece.label,
      }));
      for (const box of boxes) {
        if (!found.some((piece) => piece.boxes.some((known) => overlap(known, box) >= 0.6))) {
          found.push({ key: newKey(), title: '', price: '', boxes: [box], label: null });
        }
      }
      found.sort(byReading);
      onChange((now) => (now.photoUrl !== photoUrl ? now : {
        ...now,
        reading: false,
        found: found.length,
        pieces: found.slice(0, MAX_PIECES),
        // More than one thing: ask. One or none: an ordinary listing, with a way in.
        mode: found.length >= 2 ? 'ask' : 'single',
        lotCount: found.length >= 2 ? String(found.length) : '',
        confirmed: false,
      }));
    });
    return () => { live = false; };
  }, [photoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!photoUrl) return null;

  if (group.reading) {
    return (
      <div className="pcs-ask pcs-ask--reading" role="status">
        <span className="pcs-spin" aria-hidden="true" /> Looking for the items in your photo…
      </div>
    );
  }

  if (group.mode === 'single') {
    return (
      <button type="button" className="pcs-way" onClick={() => onChange({ ...group, mode: 'ask' })}>
        {group.found >= 2
          ? <>📦 This photo shows about <b>{group.found}</b> items. <u>Sell them separately or as a lot?</u></>
          : <>📦 Selling several things in this photo? <u>Mark them and price each one</u></>}
      </button>
    );
  }

  if (group.mode === 'ask') {
    return (
      <div className="pcs-ask">
        <h3 className="pcs-ask__title">
          {group.found >= 2 ? <>We spotted <b>{group.found} items</b> in this photo</> : 'Several things in this photo?'}
        </h3>
        <p className="pcs-ask__lede">How do you want to sell them?</p>
        {group.pieces.length > 0 && (
          <div className="pcs-ask__peek"><PiecePhoto src={photoUrl} pieces={group.pieces.map((piece) => ({ id: piece.key, title: piece.title || 'Item', boxes: piece.boxes }))} alt="Your photo" /></div>
        )}
        <div className="pcs-ask__ways">
          <button type="button" className="pcs-tile" onClick={() => { haptic('tap'); onChange({ ...group, mode: 'pieces', confirmed: false }); }}>
            <span className="pcs-tile__icon" aria-hidden="true">🏷️</span>
            <b>Separately</b>
            <span>Each item has its own title and price. Buyers pick one or several and check out once. Sold items get crossed out on the photo.</span>
            <span className="pcs-tile__fee">Fee per item sold</span>
          </button>
          <button type="button" className="pcs-tile" onClick={() => { haptic('tap'); onChange({ ...group, mode: 'lot', confirmed: false }); }}>
            <span className="pcs-tile__icon" aria-hidden="true">📦</span>
            <b>All together</b>
            <span>One price for the whole lot. A buyer takes everything in the photo.</span>
            <span className="pcs-tile__fee">Fee per item in the lot</span>
          </button>
        </div>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange({ ...group, mode: 'single' })}>
          No, it is one item
        </button>
      </div>
    );
  }

  if (group.mode === 'lot') {
    const declared = Math.round(Number(group.lotCount)) || 0;
    const charged = chargedUnits(declared, group.found);
    const fee = terms && lotPriceMinor > 0 ? saleFee(terms, { amountMinor: lotPriceMinor, units: charged }) : null;
    return (
      <div className="pcs-lot">
        <div className="pcs-head">
          <b>📦 Sold all together</b>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange({ ...group, mode: 'ask' })}>Change</button>
        </div>
        <label className="field">
          <span>How many items are in this lot?</span>
          <input type="number" inputMode="numeric" min="1" max="500" step="1" value={group.lotCount}
            onChange={(event) => onChange({ ...group, lotCount: event.target.value, confirmed: false })} />
        </label>
        {group.found > 0 && declared > 0 && declared < group.found && (
          <p className="pcs-note pcs-note--warn">
            We count about <b>{group.found}</b> items in your photos, so the platform fee is worked out on {group.found}.
            The count is checked again when you publish.
          </p>
        )}
        {group.found > 0 && declared >= group.found && (
          <p className="pcs-note">We spotted about {group.found} in the photo. Duplicates of the same item are counted once.</p>
        )}
        <label className="pcs-check">
          <input type="checkbox" checked={group.confirmed} onChange={(event) => onChange({ ...group, confirmed: event.target.checked })} />
          Yes, there are {declared > 0 ? declared : '…'} items in this lot
        </label>
        <p className="feehint">
          {fee
            ? <>Figmark fee: <b>{formatMoney(fee.totalMinor)}</b> on {formatMoney(lotPriceMinor)} - charged per item in the lot ({charged} × {formatMoney(Math.round(fee.totalMinor / charged))}), as if each sold alone.</>
            : <>Figmark fee is charged per item in the lot, as if each sold alone. Enter the lot price below to see it.</>}
        </p>
      </div>
    );
  }

  return <PieceRows photoUrl={photoUrl} group={group} onChange={onChange} terms={terms} />;
}

/** Separately: the photo to mark things on, and a row for each. */
function PieceRows({ photoUrl, group, onChange, terms }: {
  photoUrl: string;
  group: PhotoGroup;
  onChange: Dispatch<SetStateAction<PhotoGroup>>;
  terms: FeeTerms | null;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** A row waiting for its place on the photo: the next box drawn is its. */
  const [placing, setPlacing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [allPrice, setAllPrice] = useState('');
  const { pieces } = group;

  const set = (next: DraftPiece[], extra: Partial<PhotoGroup> = {}) => onChange((now) => ({ ...now, pieces: next, confirmed: false, ...extra }));
  const update = (key: string, patch: Partial<DraftPiece>) =>
    onChange((now) => ({ ...now, pieces: now.pieces.map((piece) => (piece.key === key ? { ...piece, ...patch } : piece)) }));

  const at = (event: ReactPointerEvent) => {
    const rect = stage.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };
  function down(event: ReactPointerEvent) {
    if (event.button !== 0) return;
    const { x, y } = at(event);
    stage.current?.setPointerCapture(event.pointerId);
    setDrawing({ x0: x, y0: y, x1: x, y1: y });
  }
  function move(event: ReactPointerEvent) {
    if (!drawing) return;
    const { x, y } = at(event);
    setDrawing({ ...drawing, x1: x, y1: y });
  }
  function up() {
    if (!drawing) return;
    const { x0, y0, x1, y1 } = drawing;
    setDrawing(null);
    let box: PhotoBox;
    if (Math.abs(x1 - x0) < 0.03 && Math.abs(y1 - y0) < 0.03) {
      // A tap: a box of a figure's usual size round where it landed.
      const w = 0.12; const h = 0.2;
      box = [Math.min(1 - w, Math.max(0, x0 - w / 2)), Math.min(1 - h, Math.max(0, y0 - h / 2)), w, h];
    } else {
      box = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
    }
    box = box.map((part) => Math.round(part * 1000) / 1000) as PhotoBox;
    haptic('tap');
    if (placing) {
      update(placing, { boxes: [...(pieces.find((piece) => piece.key === placing)?.boxes ?? []), box] });
      setSelected(placing);
      setPlacing(null);
      return;
    }
    if (pieces.length >= MAX_PIECES) return;
    const key = newKey();
    set([...pieces, { key, title: '', price: allPrice, boxes: [box], label: null }]);
    setSelected(key);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`#pcs-title-${key}`)?.focus());
  }

  function remove(key: string) {
    set(pieces.filter((piece) => piece.key !== key));
    if (selected === key) setSelected(null);
  }
  /** Two rows that are one thing shown twice: one row, one fee. */
  function join(key: string, into: string) {
    const from = pieces.find((piece) => piece.key === key);
    if (!from) return;
    set(pieces.filter((piece) => piece.key !== key).map((piece) => (piece.key === into
      ? { ...piece, boxes: [...piece.boxes, ...from.boxes].slice(0, 4), title: piece.title || from.title, price: piece.price || from.price }
      : piece)));
    setSelected(into);
  }
  function split(key: string) {
    const piece = pieces.find((entry) => entry.key === key);
    if (!piece || piece.boxes.length < 2) return;
    const [first, ...rest] = piece.boxes;
    set([
      ...pieces.map((entry) => (entry.key === key ? { ...entry, boxes: [first!] } : entry)),
      ...rest.map((box) => ({ key: newKey(), title: '', price: piece.price, boxes: [box], label: null })),
    ]);
  }
  function applyList() {
    const lines = parsePriceList(pasted);
    if (lines.length === 0) {
      setPasteNote('No prices found. Put each item on a line with its price, like "Wasp 1850", or the price on the next line.');
      return;
    }
    const next = pieces.map((piece, index) => (lines[index]
      ? { ...piece, title: lines[index]!.title, price: String(lines[index]!.priceMinor / 100) }
      : piece));
    const extra = lines.slice(pieces.length).map((line) => ({
      key: newKey(), title: line.title, price: String(line.priceMinor / 100), boxes: [] as PhotoBox[], label: null,
    }));
    set([...next, ...extra].slice(0, MAX_PIECES));
    const unmarked = extra.length;
    setPasteNote(`Filled ${Math.min(lines.length, pieces.length + extra.length)} items in photo order.${unmarked
      ? ` ${unmarked} ${unmarked === 1 ? 'is' : 'are'} not on the photo yet: press "Mark" on ${unmarked === 1 ? 'it' : 'each'} and tap where it is.`
      : ' Check each one matches its number on the photo.'}`);
    setPasting(false);
  }
  function priceAll() {
    if (rupeesToMinor(allPrice) < 100) return;
    set(pieces.map((piece) => (piece.price ? piece : { ...piece, price: allPrice })));
  }

  const fees = terms
    ? saleFee(terms, { amountMinor: 0, pieces: pieces.map((piece) => ({ priceMinor: rupeesToMinor(piece.price) })).filter((piece) => piece.priceMinor >= 100) })
    : null;
  const sum = pieces.reduce((total, piece) => total + rupeesToMinor(piece.price), 0);
  const views = pieces.reduce((total, piece) => total + piece.boxes.length, 0);
  const box = drawing && [Math.min(drawing.x0, drawing.x1), Math.min(drawing.y0, drawing.y1), Math.abs(drawing.x1 - drawing.x0), Math.abs(drawing.y1 - drawing.y0)] as PhotoBox;

  return (
    <div className="pcs-edit">
      <div className="pcs-head">
        <b>🏷️ Sold separately · {pieces.length} {pieces.length === 1 ? 'item' : 'items'}</b>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange({ ...group, mode: 'ask' })}>Change</button>
      </div>
      <p className="pcs-note">
        {placing
          ? <><b>Now drag a box round it on the photo</b>, or tap on it. <button type="button" className="pcs-link" onClick={() => setPlacing(null)}>Cancel</button></>
          : <>Missed one? <b>Drag a box round it</b> on the photo, or tap on it. Tap a number to find its row.</>}
      </p>
      <div ref={stage} className={`pcs-stage${placing ? ' is-placing' : ''}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrawing(null)}>
        <img src={photoUrl} alt="Your photo: drag round an item to mark it" draggable={false} />
        {pieces.map((piece, index) => piece.boxes.map((at, view) => (
          <span key={`${piece.key}-${view}`}
            className={`pcs-ebox${selected === piece.key ? ' is-on' : ''}${piece.title && rupeesToMinor(piece.price) >= 100 ? ' is-done' : ''}`}
            style={boxStyle(at)}
            onPointerDown={(event) => {
              event.stopPropagation();
              setSelected(piece.key);
              document.querySelector(`#pcs-row-${piece.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}>
            <span className="pcs-ebox__n">{index + 1}</span>
          </span>
        )))}
        {box && <span className="pcs-ebox is-new" style={boxStyle(box)} />}
      </div>

      <div className="pcs-tools">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPasting(!pasting)}>📋 Paste price list</button>
        <span className="pcs-tools__all">
          <input type="number" inputMode="numeric" min="1" placeholder="₹ same price" value={allPrice}
            onChange={(event) => setAllPrice(event.target.value)} aria-label="One price for every item without one" />
          <button type="button" className="btn btn--ghost btn--sm" onClick={priceAll} disabled={rupeesToMinor(allPrice) < 100}>Fill empty prices</button>
        </span>
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

      <ol className="pcs-erows">
        {pieces.map((piece, index) => (
          <li key={piece.key} id={`pcs-row-${piece.key}`} className={`pcs-erow${selected === piece.key ? ' is-on' : ''}`}
            onFocus={() => setSelected(piece.key)}>
            <span className="pcs-row__n">{index + 1}</span>
            {piece.boxes.length > 0
              ? <PieceThumb src={photoUrl} box={piece.boxes[0]!} size={52} />
              : <button type="button" className="pcs-erow__mark" onClick={() => setPlacing(piece.key)}>Mark</button>}
            <div className="pcs-erow__fields">
              <input id={`pcs-title-${piece.key}`} value={piece.title} placeholder={piece.label ?? 'What is it?'}
                aria-label={`Title of item ${index + 1}`} onChange={(event) => update(piece.key, { title: event.target.value })} />
              <span className="pcs-erow__price">
                <span aria-hidden="true">₹</span>
                <input type="number" inputMode="numeric" min="1" step="1" value={piece.price} placeholder="Price"
                  aria-label={`Price of item ${index + 1}`} onChange={(event) => update(piece.key, { price: event.target.value })} />
              </span>
              <span className="pcs-erow__more">
                {piece.boxes.length > 1 && (
                  <span className="pcs-chip" title="The same item shown more than once is one item and one fee">
                    Shown {piece.boxes.length}× · counted once
                    <button type="button" className="pcs-link" onClick={() => split(piece.key)}>Split</button>
                  </span>
                )}
                {pieces.length > 1 && (
                  <select value="" aria-label={`Item ${index + 1} is the same as`}
                    onChange={(event) => event.target.value && join(piece.key, event.target.value)}>
                    <option value="">Same item as…</option>
                    {pieces.filter((other) => other.key !== piece.key).map((other) => (
                      <option key={other.key} value={other.key}>
                        #{pieces.indexOf(other) + 1} {other.title || ''}
                      </option>
                    ))}
                  </select>
                )}
                {piece.boxes.length > 0 && piece.boxes.length < 4 && (
                  <button type="button" className="pcs-link" onClick={() => setPlacing(piece.key)}>+ another view</button>
                )}
              </span>
            </div>
            <button type="button" className="pcs-erow__x" aria-label={`Remove item ${index + 1}`} onClick={() => remove(piece.key)}>✕</button>
          </li>
        ))}
      </ol>
      {pieces.length === 0 && <p className="pcs-note">Nothing marked yet. Drag a box round each item on the photo.</p>}

      <div className="pcs-confirm">
        {group.found > pieces.length && (
          <p className="pcs-note pcs-note--warn">We spotted about {group.found} things in the photo and {pieces.length} are marked. Mark any others that are for sale.</p>
        )}
        <label className="pcs-check">
          <input type="checkbox" checked={group.confirmed} disabled={pieces.length < 2}
            onChange={(event) => onChange({ ...group, confirmed: event.target.checked })} />
          Yes, I am selling these <b>{pieces.length}</b> items{views > pieces.length ? ` (${views - pieces.length} shown twice, counted once)` : ''}
        </label>
        <p className="feehint">
          {sum > 0 ? <>All {pieces.length} together: <b>{formatMoney(sum)}</b>. </> : null}
          Figmark fee is charged on each item as it sells{fees && fees.totalMinor > 0 ? <> - <b>{formatMoney(fees.totalMinor)}</b> if everything sells</> : null}.
        </p>
      </div>
    </div>
  );
}
