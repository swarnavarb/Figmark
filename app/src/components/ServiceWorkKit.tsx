import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BatteryContent, FreightLane, InfoRow, PriceOption, ServiceFormField, StoreWarehouse } from '@shared/models';
import { COUNTRIES, countryFlag } from '@shared/countries';
import type { StoreKind } from '@shared/service-stores';
import {
  ACTION_LABELS, BASIS_LABELS, CHANNEL_MAX_CHARS, addressComplete, addressLine, answerText, billFor, deliveryOf, emptyAddress, flowOf,
  needsDelivery, statusLabel,
  type AddressValue, type AnswerValue, type Answers, type ChannelMessage, type Dimensions, type Estimate, type ItemRow,
  type CustomQuote, type RequestAction, type RequestBill, type ServiceRequest, type Standing,
} from '@shared/service-work';
import { FREIGHT_MODE_LABELS, laneLabel, type FreightMode } from '@shared/service-stores';
import { ApiRequestError, api, type ChannelView, type RequestView, type TeamRow } from '../api';
import { useSession } from '../session';
import { formatMoney, timeAgo } from '../format';
import { EmptyState, ErrorNotice, Icon } from './ui';
import { MoneyInput } from './StoreKit';
import { markSeen } from './channelSeen';
import { shrink } from './PhotoManager';
import '../styles/ServiceWorkKit.css';

/**
 * The pieces every screen of a store's direct work is drawn from: the page a
 * customer reads, the form they send, the request they follow, and the
 * dashboard the team works from. One set, so a status reads the same on
 * either side of a request.
 */

/* ── Standing ────────────────────────────────────────────────────────── */

export function Stars({ value, size = 14, onPick }: { value: number; size?: number; onPick?: (stars: number) => void }) {
  return (
    <span className={`svk-stars${onPick ? ' svk-stars--pick' : ''}`} role={onPick ? 'radiogroup' : 'img'}
      aria-label={onPick ? 'Rating' : `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const on = star <= Math.round(value);
        return onPick ? (
          <button key={star} type="button" role="radio" aria-checked={star === value} aria-label={`${star} star${star === 1 ? '' : 's'}`}
            className={on ? 'is-on' : ''} onClick={() => onPick(star)} style={{ fontSize: size }}>★</button>
        ) : <span key={star} className={on ? 'is-on' : ''} style={{ fontSize: size }} aria-hidden="true">★</span>;
      })}
    </span>
  );
}

/** Level, rating and reliability, as chips under a store's name. */
export function StandingChips({ standing, followers }: { standing: Standing; followers?: number }) {
  return (
    <>
      <span className="svk-chip svk-chip--level" title={standing.next ? `${standing.points} of ${standing.next} points to the next level` : 'Top level'}>
        Lv {standing.level} · {standing.title}
      </span>
      {standing.rating !== null ? (
        <span className="svk-chip"><span className="svk-chip__star">★</span> {standing.rating.toFixed(1)} <span className="faint">({standing.reviews})</span></span>
      ) : <span className="svk-chip faint">No ratings yet</span>}
      {standing.reliability !== null && <span className="svk-chip svk-chip--ok">{standing.reliability}% delivered</span>}
      {followers !== undefined && <span className="svk-chip">{followers} {followers === 1 ? 'follower' : 'followers'}</span>}
    </>
  );
}

/* ── Prices ──────────────────────────────────────────────────────────── */

/** The product-specific prices on a route or service, pickable when `onPick` is given. */
export function PriceOptions({ options, picked, onPick, baseLabel, baseMinor, baseBasis = 'kg' }: {
  options: readonly PriceOption[]; picked?: string | null; onPick?: (id: string | null) => void;
  baseLabel: string; baseMinor: number; baseBasis?: PriceOption['basis'];
}) {
  const rows: { id: string | null; name: string; basis: PriceOption['basis']; priceMinor: number; note: string }[] = [
    ...(baseMinor > 0 ? [{ id: null, name: baseLabel, basis: baseBasis, priceMinor: baseMinor, note: '' }] : []),
    ...options,
  ];
  if (rows.length === 0) return null;
  return (
    <div className="svk-prices" role={onPick ? 'radiogroup' : undefined}>
      {rows.map((row) => {
        const on = onPick ? (picked ?? null) === row.id : false;
        const inner = (
          <>
            <span className="svk-price__name">{row.name}{row.note && <small>{row.note}</small>}</span>
            <span className="svk-price__amount">{formatMoney(row.priceMinor)}<small> {BASIS_LABELS[row.basis]}</small></span>
          </>
        );
        return onPick ? (
          <button key={row.id ?? 'base'} type="button" role="radio" aria-checked={on}
            className={`svk-price svk-price--tap${on ? ' is-on' : ''}`} onClick={() => onPick(row.id)}>{inner}</button>
        ) : <div key={row.id ?? 'base'} className="svk-price">{inner}</div>;
      })}
    </div>
  );
}

/**
 * Where a customer sends their goods - every address, set apart from the rest
 * of the page, each with a button to copy it whole.
 */
export function WarehouseCards({ warehouses, reference }: { warehouses: readonly StoreWarehouse[]; reference?: string | null }) {
  const [copied, setCopied] = useState<number | null>(null);
  if (warehouses.length === 0) return null;
  async function copy(index: number, row: StoreWarehouse) {
    const text = [reference ? `${reference}` : '', row.address, row.contact].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      window.setTimeout(() => setCopied((current) => (current === index ? null : current)), 1800);
    } catch { /* nothing to copy to */ }
  }
  return (
    <div className="svk-wh">
      {warehouses.map((row, index) => (
        <div key={`${row.address}-${index}`} className="svk-wh__card">
          <span className="svk-wh__head">
            <Icon name="home" size={14} />
            <b>{row.name || (warehouses.length > 1 ? `Warehouse ${index + 1}` : 'Warehouse')}</b>
            <button type="button" className="btn btn--ghost btn--sm svk-wh__copy" onClick={() => void copy(index, row)}>
              {copied === index ? <><Icon name="check" size={12} /> Copied</> : 'Copy'}
            </button>
          </span>
          {reference && <span className="svk-wh__ref">Mark it <b>{reference}</b></span>}
          <p>{row.address}</p>
          {(row.contact || row.hours) && <span className="faint">{[row.contact, row.hours].filter(Boolean).join(' · ')}</span>}
        </div>
      ))}
    </div>
  );
}

/** Short rows of name and price - cover plans, extras - with "Free" where it is. */
export function PriceRows({ rows }: { rows: readonly { id: string; name: string; price: string; note?: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="svk-rows">
      {rows.map((row) => (
        <li key={row.id}><span>{row.name}{row.note && <small>{row.note}</small>}</span><b>{row.price}</b></li>
      ))}
    </ul>
  );
}

export function InfoRows({ rows }: { rows: readonly InfoRow[] | undefined }) {
  if (!rows || rows.length === 0) return null;
  return (
    <dl className="svk-info">
      {rows.map((row) => (
        <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
      ))}
    </dl>
  );
}

export function EstimateBox({ estimate, note, totalLabel = 'Estimate' }: { estimate: Estimate; note?: ReactNode; totalLabel?: string }) {
  return (
    <div className="svk-estimate" aria-live="polite">
      {estimate.lines.map((line) => (
        <span key={line.label} className="svk-estimate__line"><span>{line.label}</span><b>{line.minor === 0 ? 'Free' : formatMoney(line.minor)}</b></span>
      ))}
      <span className="svk-estimate__total"><span>{totalLabel}</span><b>{formatMoney(estimate.totalMinor)}</b></span>
      {note && <span className="faint svk-estimate__note">{note}</span>}
    </div>
  );
}

/* ── The form ────────────────────────────────────────────────────────── */

function ItemsInput({ value, onChange }: { value: ItemRow[]; onChange: (rows: ItemRow[]) => void }) {
  const rows = value.length > 0 ? value : [{ name: '', qty: 1, valueMinor: 0 }];
  const set = (index: number, patch: Partial<ItemRow>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <div className="svk-itemlist">
      {rows.map((row, index) => (
        <div key={index} className="svk-itemlist__row">
          <input value={row.name} placeholder="Item" aria-label={`Item ${index + 1}`} onChange={(e) => set(index, { name: e.target.value })} />
          <input inputMode="numeric" value={row.qty || ''} aria-label="How many" placeholder="Qty" className="svk-itemlist__qty"
            onChange={(e) => set(index, { qty: Number(e.target.value) || 0 })} />
          <MoneyInput label="Value each" value={row.valueMinor} onChange={(valueMinor) => set(index, { valueMinor })} placeholder="Value" />
          {rows.length > 1 && (
            <button type="button" className="btn btn--quiet btn--sm" aria-label="Remove item" onClick={() => onChange(rows.filter((_, at) => at !== index))}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([...rows, { name: '', qty: 1, valueMinor: 0 }])}>
        <Icon name="plus" size={13} /> Add an item
      </button>
    </div>
  );
}

export function AddressInput({ value, onChange }: { value: AddressValue | null; onChange: (next: AddressValue) => void }) {
  const a = value ?? emptyAddress();
  const set = (patch: Partial<AddressValue>) => onChange({ ...a, ...patch });
  return (
    <div className="svk-address">
      <input value={a.name} placeholder="Full name" aria-label="Full name" autoComplete="name" onChange={(e) => set({ name: e.target.value })} />
      <input value={a.phone} placeholder="Phone" aria-label="Phone" inputMode="tel" autoComplete="tel" onChange={(e) => set({ phone: e.target.value })} />
      <input className="svk-address__wide" value={a.line} placeholder="House, street, area" aria-label="Address" autoComplete="street-address"
        onChange={(e) => set({ line: e.target.value })} />
      <input value={a.city} placeholder="City" aria-label="City" autoComplete="address-level2" onChange={(e) => set({ city: e.target.value })} />
      <input value={a.state} placeholder="State" aria-label="State" autoComplete="address-level1" onChange={(e) => set({ state: e.target.value })} />
      <input value={a.pincode} placeholder="PIN code" aria-label="PIN code" inputMode="numeric" autoComplete="postal-code"
        onChange={(e) => set({ pincode: e.target.value })} />
    </div>
  );
}

function DimensionsInput({ value, onChange }: { value: Dimensions | null; onChange: (next: Dimensions) => void }) {
  const d = value ?? { l: 0, w: 0, h: 0 };
  return (
    <span className="svk-dims">
      {(['l', 'w', 'h'] as const).map((side, index) => (
        <span key={side} className="svk-dims__cell">
          <input inputMode="decimal" value={d[side] || ''} placeholder={['L', 'W', 'H'][index]} aria-label={['Length', 'Width', 'Height'][index]}
            onChange={(e) => onChange({ ...d, [side]: Number(e.target.value) || 0 })} />
          {index < 2 && <span aria-hidden="true">×</span>}
        </span>
      ))}
      <span className="faint">cm</span>
    </span>
  );
}

/** One field, drawn for its type. */
export function FieldInput({ field, value, onChange }: { field: ServiceFormField; value: AnswerValue; onChange: (next: AnswerValue) => void }) {
  const label = <span>{field.label}{field.required ? <b className="svk-req" aria-label="required"> *</b> : <span className="faint"> (optional)</span>}</span>;
  const hint = field.help ? <span className="field__hint">{field.help}</span> : null;
  switch (field.type) {
    case 'items':
      return <div className="field">{label}{hint}<ItemsInput value={(value as ItemRow[] | null) ?? []} onChange={onChange} /></div>;
    case 'address':
      return <div className="field">{label}{hint}<AddressInput value={value as AddressValue | null} onChange={onChange} /></div>;
    case 'dimensions':
      return <div className="field">{label}{hint}<DimensionsInput value={value as Dimensions | null} onChange={onChange} /></div>;
    case 'yesno':
      return (
        <div className="field">{label}{hint}
          <div className="seg" role="radiogroup" aria-label={field.label}>
            {[true, false].map((answer) => (
              <button key={String(answer)} type="button" role="radio" aria-checked={value === answer}
                className={value === answer ? 'is-on' : ''} onClick={() => onChange(answer)}>{answer ? 'Yes' : 'No'}</button>
            ))}
          </div>
        </div>
      );
    case 'choice':
      return (
        <label className="field">{label}{hint}
          <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose…</option>
            {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      );
    case 'longtext':
      return <label className="field">{label}{hint}<textarea rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} /></label>;
    case 'number':
      return <label className="field">{label}{hint}<DecimalInput value={value as number | null} onChange={onChange} /></label>;
    case 'date':
      return <label className="field">{label}{hint}<input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} /></label>;
    default:
      return <label className="field">{label}{hint}<input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} /></label>;
  }
}

export function FormFields({ fields, answers, onChange }: { fields: ServiceFormField[]; answers: Answers; onChange: (id: string, value: AnswerValue) => void }) {
  return (
    <div className="svk-form">
      {fields.map((field) => (
        <div key={field.id} className={['items', 'address', 'longtext'].includes(field.type) ? 'svk-form__wide' : ''}>
          <FieldInput field={field} value={answers[field.id] ?? null} onChange={(value) => onChange(field.id, value)} />
        </div>
      ))}
    </div>
  );
}

/**
 * A number field that keeps what is typed - "3." on the way to "3.2" - and
 * reports the number. Reading it straight back from the number drops the point.
 */
function DecimalInput({ value, onChange }: { value: number | null; onChange: (next: number | null) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  return (
    <input inputMode="decimal" value={text} onChange={(e) => {
      const next = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
      setText(next);
      onChange(Number(next) || null);
    }} />
  );
}

/** What a customer said, read back. */
export function AnswerList({ fields, answers }: { fields: ServiceFormField[]; answers: Answers }) {
  if (fields.length === 0) return null;
  return (
    <dl className="svk-info svk-info--answers">
      {fields.map((field) => (
        <div key={field.id}><dt>{field.label}</dt><dd>{answerText(field, answers[field.id] ?? null)}</dd></div>
      ))}
    </dl>
  );
}

/* ── A request ───────────────────────────────────────────────────────── */

type StatusOf = Pick<ServiceRequest, 'kind' | 'status' | 'billing'>;

export function RequestBadge({ request }: { request: StatusOf }) {
  const label = statusLabel(request);
  return <span className={`badge badge--${label.tone === 'quiet' ? 'quiet' : label.tone}`}>{label.label}</span>;
}

export function RequestProgress({ request }: { request: StatusOf }) {
  const flow = flowOf(request);
  const at = flow.indexOf(request.status);
  return (
    <span className={`svk-flow${at < 0 ? ' is-off' : ''}`} aria-hidden="true">
      {flow.map((step, index) => <span key={step} className={index <= at ? 'is-on' : ''} />)}
    </span>
  );
}

/** The tracking number a parcel is matched by: from "I've sent it", or the form. */
export function awbOf(request: Pick<ServiceRequest, 'inbound' | 'fields' | 'answers'>): string {
  if (request.inbound?.awb) return request.inbound.awb;
  const field = request.fields.find((row) => row.key === 'awb');
  const value = field ? request.answers[field.id] : null;
  return typeof value === 'string' ? value : '';
}

/** What the money line says: the bill once weighed, the quote once given, the estimate before either. */
export function priceWord(request: Pick<ServiceRequest, 'billing' | 'bill' | 'quoteMinor'>): string {
  if (request.billing === 'arrival') return request.bill ? 'Bill' : 'Estimate';
  return request.quoteMinor !== null ? 'Quote' : 'Estimate';
}

/**
 * Asking a forwarder for a custom quote: on one of their routes, or a pair of
 * countries they do not list, with what is being sent. The forwarder replies
 * with a rate the customer can ship on until the date they set.
 */
export function QuoteAskSheet({ store, lane, onClose }: {
  store: { kind: StoreKind; ownerId: string; name: string; accent: string; lanes: FreightLane[] };
  lane: FreightLane | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [laneId, setLaneId] = useState<string>(lane?.id ?? '');
  const [from, setFrom] = useState(lane?.originCountry ?? 'China');
  const [to, setTo] = useState(lane?.destinationCountry ?? 'India');
  const [mode, setMode] = useState<FreightMode>((lane?.mode as FreightMode) ?? 'air');
  const [what, setWhat] = useState('');
  const [weight, setWeight] = useState('');
  const [battery, setBattery] = useState<BatteryContent>('none');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = store.lanes.find((row) => row.id === laneId) ?? null;

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', close); document.body.style.overflow = ''; };
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!what.trim()) { setError('Say what you are sending.'); return; }
    setBusy(true);
    setError(null);
    try {
      const view = await api.askQuote(store.kind, store.ownerId, {
        laneId: picked?.id ?? null, originCountry: from, destinationCountry: to, mode,
        what, weightKg: Number(weight) || null, battery, notes,
      });
      navigate(`/services/quotes/${store.kind}/${store.ownerId}/${view.quote.id}?sent=1`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
      setBusy(false);
    }
  }

  const countrySelect = (value: string, onChange: (next: string) => void, label: string) => (
    <label className="field"><span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {COUNTRIES.map((country) => <option key={country} value={country}>{countryFlag(country)} {country}</option>)}
      </select></label>
  );

  return (
    <div className="svk-sheet" role="dialog" aria-modal="true" aria-label={`Ask ${store.name} for a quote`}>
      <button type="button" className="svk-sheet__scrim" aria-label="Close" onClick={onClose} />
      <form className="svk-sheet__panel" onSubmit={(event) => void submit(event)}>
        <div className="svk-sheet__head">
          <span><span className="faint">{store.name}</span><h2>Ask for a custom quote</h2></span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="svk-sheet__body stack">
          <p className="faint">For a route they do not list, a regular volume, or goods that need a word first. They reply with a rate you can ship on until the date they set — up to three months.</p>
          <label className="field"><span>Route</span>
            <select value={laneId} onChange={(e) => setLaneId(e.target.value)}>
              <option value="">Another route…</option>
              {store.lanes.map((row) => <option key={row.id} value={row.id}>{laneLabel(row)} · {FREIGHT_MODE_LABELS[row.mode as FreightMode]?.label}</option>)}
            </select></label>
          {!picked && (
            <div className="svk-sheet__pair">
              {countrySelect(from, setFrom, 'From')}
              {countrySelect(to, setTo, 'To')}
              <label className="field"><span>Mode</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as FreightMode)}>
                  {(Object.keys(FREIGHT_MODE_LABELS) as FreightMode[]).map((value) => <option key={value} value={value}>{FREIGHT_MODE_LABELS[value].glyph} {FREIGHT_MODE_LABELS[value].label}</option>)}
                </select></label>
            </div>
          )}
          <label className="field"><span>What are you sending?</span>
            <textarea rows={3} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Boxed figures and model kits, about 20 kg every month." /></label>
          <label className="field"><span>About how much (kg)</span>
            <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Optional" /></label>
          <div className="field"><span>Batteries</span>
            <div className="svk-sheet__radios" role="radiogroup" aria-label="Batteries">
              {([['none', 'No battery'], ['in_device', 'Inside an item'], ['loose', 'Loose / power bank']] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={battery === value} className={`chip${battery === value ? ' is-on' : ''}`} onClick={() => setBattery(value)}>{label}</button>
              ))}
            </div>
          </div>
          <label className="field"><span>Anything else</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="svk-sheet__foot">
          <span className="faint">The whole team is told at once.</span>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Sending…' : 'Ask for a quote'}</button>
        </div>
      </form>
    </div>
  );
}

/** Days left on a quote, in words. */
export function expiresIn(quote: Pick<CustomQuote, 'expiresAt'>): string {
  const days = Math.ceil((Date.parse(quote.expiresAt) - Date.now()) / 86_400_000);
  return days <= 1 ? 'expires today' : `${days} days left`;
}

/** A custom quote as a row: the route, the rate once given, and how long it stands. */
export function QuoteRowCard({ quote, usable, side, to }: { quote: CustomQuote; usable: boolean; side: 'store' | 'customer'; to?: string }) {
  const tone = quote.status === 'declined' ? 'danger' : usable ? 'ok' : 'warn';
  const word = quote.status === 'declined' ? 'Declined' : usable ? 'Ready to ship on' : 'Waiting for a price';
  const body = (
    <>
      <span className="svk-row__top">
        <span className="svk-row__title">
          <b>{laneLabel(quote.route)}</b>
          <span className="faint">{quote.number} · {side === 'store' ? quote.customerName : quote.storeName} · {timeAgo(quote.updatedAt)}</span>
        </span>
        <span className={`badge badge--${tone}`}>{word}</span>
      </span>
      <span className="svk-row__facts">
        {quote.offer ? <span><b>{formatMoney(quote.offer.ratePerKgMinor)}</b>/kg{quote.offer.minChargeKg ? ` · min ${quote.offer.minChargeKg} kg` : ''}</span>
          : <span className="faint">{quote.ask.what.slice(0, 80)}</span>}
        <span className="faint">{expiresIn(quote)}</span>
        {quote.used > 0 && <span className="faint">{quote.used} {quote.used === 1 ? 'parcel' : 'parcels'} on it</span>}
        {side === 'store' && quote.status === 'asked' && <span className="svk-row__ping">Needs a price</span>}
      </span>
    </>
  );
  return to ? <Link to={to} className="svk-row svk-row--tap">{body}</Link> : <div className="svk-row">{body}</div>;
}

/** The bill for a weighed parcel: the scale photo, the weight, and every line. */
export function BillCard({ bill }: { bill: RequestBill }) {
  return (
    <div className="svk-bill">
      <div className="svk-bill__photos">
        {bill.photoUrls.map((url) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="The parcel on the scale" loading="lazy" decoding="async" /></a>
        ))}
      </div>
      <div className="svk-bill__body">
        <span className="svk-bill__kg"><b>{bill.weightKg} kg</b> on the scale
          {bill.by !== 'actual' && <span className="faint"> · billed {bill.chargeableKg} kg {bill.by === 'volumetric' ? 'by size' : 'minimum'}</span>}
          {bill.box && <span className="faint"> · {bill.box.l}×{bill.box.w}×{bill.box.h} cm</span>}
        </span>
        <div className="svk-estimate">
          {bill.lines.map((line, index) => (
            <span key={`${line.label}-${index}`} className="svk-estimate__line"><span>{line.label}</span><b>{line.minor === 0 ? 'Free' : formatMoney(line.minor)}</b></span>
          ))}
          <span className="svk-estimate__total"><span>To pay</span><b>{formatMoney(bill.totalMinor)}</b></span>
          {bill.note && <span className="faint svk-estimate__note">“{bill.note}” — {bill.byName}</span>}
        </div>
      </div>
    </div>
  );
}

/** One request as a row in a list, opening wherever `to` says. */
export function RequestRowCard({ request, due, to, side, actions }: {
  request: ServiceRequest; due: number; to?: string; side: 'store' | 'customer'; actions: RequestAction[];
}) {
  const body = (
    <>
      <span className="svk-row__top">
        <span className="svk-row__title">
          <b>{request.origin === 'link' ? request.title : request.subject?.label ?? request.title}</b>
          <span className="faint">
            {request.number} · {side === 'store' ? request.customerName : request.storeName} · {timeAgo(request.updatedAt)}
            {side === 'store' && request.assigneeName ? ` · ${request.assigneeName}` : ''}
          </span>
        </span>
        <RequestBadge request={request} />
      </span>
      <RequestProgress request={request} />
      <span className="svk-row__facts">
        <span>{priceWord(request)} <b>{formatMoney(due)}</b></span>
        {request.chargeableKg ? <span><b>{request.chargeableKg}</b> kg</span> : null}
        {request.billing === 'arrival' && awbOf(request) && <span>AWB <b>{awbOf(request)}</b></span>}
        {side === 'store' && request.payment && !request.payment.confirmedAt && <span className="svk-row__ping">Payment to confirm</span>}
        {side === 'store' && request.coverPayment && !request.coverPayment.confirmedAt && <span className="svk-row__ping">Cover to confirm</span>}
        {side === 'store' && actions.includes('bill') && request.status !== 'billed' && <span className="svk-row__ping">Weigh & bill</span>}
        {side === 'customer' && (actions.includes('pay') || actions.includes('pay_cover')) && <span className="svk-row__ping">Pay now</span>}
        {side === 'customer' && actions.includes('send_in') && <span className="svk-row__ping">Send your parcel</span>}
        {side === 'customer' && actions.includes('address') && needsDelivery(request) && <span className="svk-row__ping">Add delivery address</span>}
        {side === 'store' && request.billing === 'arrival' && request.kind === 'forwarder' && needsDelivery(request) && <span className="faint">No delivery address yet</span>}
        {actions.length > 0 && side === 'store' && !request.payment?.confirmedAt && request.status === 'submitted' && <span className="svk-row__ping">Needs a quote</span>}
        {request.review && <Stars value={request.review.stars} size={12} />}
      </span>
    </>
  );
  return to ? <Link to={to} className="svk-row svk-row--tap">{body}</Link> : <div className="svk-row">{body}</div>;
}

/**
 * The moves on a request, for whichever side is looking.
 *
 * Every button comes from the shared move table, so the store never sees a
 * customer's button and neither sees one the server would refuse.
 */
export function RequestActions({ view, team, onChanged }: {
  view: RequestView; team?: TeamRow[]; onChanged: (next: RequestView & { team?: TeamRow[] }) => void;
}) {
  const { request, actions, side } = view;
  const kind = request.kind;
  // The quote is the work itself: cover the customer chose is added on top, so it starts from the estimate without it.
  const [quote, setQuote] = useState(request.quoteMinor ?? Math.max(0, request.estimateMinor - (request.plan?.premiumMinor ?? 0)));
  const [days, setDays] = useState(String(request.turnaroundDays ?? ''));
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  // "I've sent it" starts from the tracking number given on the form.
  const given = (key: 'awb' | 'origin_courier') => {
    const field = request.fields.find((row) => row.key === key);
    const value = field ? request.answers[field.id] : null;
    return request.status === 'booked' && typeof value === 'string' ? value : '';
  };
  const [courier, setCourier] = useState(given('origin_courier'));
  const [awb, setAwb] = useState(given('awb'));
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  // Where it is delivered: the buyer may add or change it until they pay, and paying asks for it if missing.
  const delivery = request.kind === 'forwarder' && request.billing === 'arrival' ? deliveryOf(request) : null;
  const missingAddress = side === 'customer' && needsDelivery(request);
  const [address, setAddress] = useState<AddressValue | null>(() => delivery);
  const [editingAddress, setEditingAddress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = ACTION_LABELS[kind];

  async function act(action: RequestAction, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.actOnServiceRequest(kind, request.ownerId, request.id, { action, ...extra });
      setNote('');
      if (action === 'address') setEditingAddress(false);
      onChanged(next);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }
  const submit = (action: RequestAction, extra: Record<string, unknown> = {}) => (event: FormEvent) => {
    event.preventDefault();
    void act(action, extra);
  };

  const simple = (['receive', 'start', 'deliver', 'complete', 'accept', 'confirm_payment', 'confirm_cover'] as const).filter((action) => actions.includes(action));

  return (
    <div className="svk-acts stack">
      {actions.includes('quote') && (
        <form className="svk-acts__form" onSubmit={submit('quote', { quoteMinor: quote, days: Number(days) || undefined, note })}>
          <label className="field"><span>Your price</span><MoneyInput label="Quote" value={quote} onChange={setQuote} /></label>
          <label className="field"><span>Days</span><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
          <label className="field svk-acts__wide"><span>Note to the customer</span>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={kind === 'forwarder' ? 'Billed on volumetric 6.2 kg. Flies Saturday.' : 'Includes priming and a gloss coat.'} /></label>
          <div className="row svk-acts__wide">
            <button type="submit" className="btn" disabled={busy || !quote}>{request.status === 'quoted' ? 'Update quote' : words.quote}</button>
            {actions.includes('decline') && (
              <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void act('decline', { note })}>{words.decline}</button>
            )}
          </div>
        </form>
      )}
      {actions.includes('send_in') && (
        <form className="svk-acts__form" onSubmit={submit('send_in', { courier, awb })}>
          <label className="field"><span>Courier to the warehouse</span><input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="SF Express" /></label>
          <label className="field"><span>Tracking number / AWB *</span><input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="On the box" required /></label>
          <button type="submit" className="btn svk-acts__wide" disabled={busy || !awb.trim()}>{words.send_in}</button>
        </form>
      )}
      {actions.includes('pay_cover') && (
        <form className="svk-acts__form" onSubmit={submit('pay_cover', { reference })}>
          <label className="field svk-acts__wide"><span>Payment reference for the cover</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref / UTR" /></label>
          <button type="submit" className="btn svk-acts__wide" disabled={busy}>{words.pay_cover} · {formatMoney(view.coverDue)}</button>
        </form>
      )}
      {actions.includes('bill') && <BillForm request={request} busy={busy} onSend={(extra) => void act('bill', extra)} />}
      {actions.includes('address') && !(missingAddress && actions.includes('pay')) && (
        <div className="svk-deliver">
          <div className="svk-deliver__head">
            <span><span className="faint">Deliver to</span>
              <b>{delivery ? addressLine(delivery) : 'No address yet'}</b></span>
            {!editingAddress && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setAddress(delivery); setEditingAddress(true); }}>
                {delivery ? 'Change' : 'Add address'}
              </button>
            )}
          </div>
          {!editingAddress && (
            <p className="faint">
              {request.status === 'billed' ? 'Check it before you pay — it goes out to this address once paid.' : 'You can change it here until you pay the bill.'}
            </p>
          )}
          {editingAddress && (
            <form className="stack" onSubmit={submit('address', { address })}>
              <AddressInput value={address} onChange={setAddress} />
              <div className="row">
                <button type="submit" className="btn btn--sm" disabled={busy || !addressComplete(address)}>{words.address ?? 'Save address'}</button>
                <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => setEditingAddress(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
      {actions.includes('pay') && (
        <form className="svk-acts__form" onSubmit={submit('pay', missingAddress ? { reference, address } : { reference })}>
          {missingAddress && (
            <div className="field svk-acts__wide"><span>Deliver to *</span>
              <AddressInput value={address} onChange={setAddress} />
              <span className="field__hint">Where it goes once you have paid.</span></div>
          )}
          <label className="field svk-acts__wide"><span>Payment reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref / UTR" /></label>
          <button type="submit" className="btn svk-acts__wide" disabled={busy || (missingAddress && !addressComplete(address))}>{words.pay} · {formatMoney(view.due)}</button>
        </form>
      )}
      {actions.includes('ship') && (
        <form className="svk-acts__form" onSubmit={submit('ship', { courier, awb })}>
          <label className="field"><span>Courier</span><input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Delhivery" /></label>
          <label className="field"><span>Tracking / AWB</span><input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="1234567890" /></label>
          <button type="submit" className="btn svk-acts__wide" disabled={busy || !awb.trim()}>{words.ship}</button>
        </form>
      )}
      {simple.length > 0 && (
        <div className="row svk-acts__row">
          {simple.map((action) => (
            <button key={action} type="button" className="btn" disabled={busy} onClick={() => void act(action)}>
              {action === 'confirm_payment' && <Icon name="check" size={14} />} {words[action]}
            </button>
          ))}
        </div>
      )}
      {actions.includes('review') && (
        <form className="svk-acts__form" onSubmit={submit('review', { stars, text: review })}>
          <div className="field svk-acts__wide"><span>How did it go?</span><Stars value={stars} size={26} onPick={setStars} /></div>
          <label className="field svk-acts__wide"><span>A few words for others</span>
            <textarea rows={2} value={review} onChange={(e) => setReview(e.target.value)} /></label>
          <button type="submit" className="btn svk-acts__wide" disabled={busy || !stars}>Post rating</button>
        </form>
      )}
      {actions.includes('cancel') && (
        <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void act('cancel')}>{words.cancel}</button>
      )}
      {actions.includes('assign') && team && team.length > 1 && (
        <label className="field svk-acts__assign"><span>Who is on it</span>
          <select value={request.assigneeId ?? ''} disabled={busy} onChange={(e) => void act('assign', { assigneeId: e.target.value || null })}>
            <option value="">Nobody yet</option>
            {team.map((row) => <option key={row.userId} value={row.userId}>{row.name}{row.tag ? ` · ${row.tag}` : ''}</option>)}
          </select>
        </label>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/**
 * Weighing a parcel at the destination: the scale's weight and a photo of it
 * (no photo, no bill), the box if it is charged by size, and anything added by
 * hand. The bill is worked out as they type, from the rate it was booked at.
 */
function BillForm({ request, busy, onSend }: {
  request: ServiceRequest; busy: boolean; onSend: (extra: Record<string, unknown>) => void;
}) {
  const [weight, setWeight] = useState(request.bill ? String(request.bill.weightKg) : '');
  const [box, setBox] = useState<Dimensions>(request.bill?.box ?? { l: 0, w: 0, h: 0 });
  const [photos, setPhotos] = useState<string[]>(request.bill?.photoUrls ?? []);
  const [extraLabel, setExtraLabel] = useState('');
  const [extraMinor, setExtraMinor] = useState(0);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kg = Number(weight) || 0;
  const hasBox = box.l > 0 && box.w > 0 && box.h > 0;
  const added = extraLabel.trim() && extraMinor ? [{ label: extraLabel.trim(), minor: extraMinor }] : [];
  const preview = kg > 0 ? billFor(request, kg, hasBox ? box : null, added) : null;

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const urls: string[] = [];
      for (const file of [...files].slice(0, 4 - photos.length)) urls.push((await api.uploadPhoto(await shrink(file))).url);
      setPhotos((now) => [...now, ...urls].slice(0, 4));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That photo did not upload.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="svk-acts__form svk-billform" onSubmit={(event) => {
      event.preventDefault();
      onSend({ weightKg: kg, box: hasBox ? box : null, photoUrls: photos, added, note });
    }}>
      <h3 className="svk-acts__wide">{request.bill ? 'Change the bill' : 'Arrived? Weigh it and send the bill'}</h3>
      <label className="field"><span>Weight on the scale (kg)</span>
        <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="6.4" required /></label>
      <div className="field"><span>Box (cm) · if charged by size</span>
        <span className="svk-billform__box">
          {(['l', 'w', 'h'] as const).map((side) => (
            <input key={side} inputMode="numeric" aria-label={side === 'l' ? 'Length' : side === 'w' ? 'Width' : 'Height'} placeholder={side.toUpperCase()}
              value={box[side] || ''} onChange={(e) => setBox({ ...box, [side]: Number(e.target.value) || 0 })} />
          ))}
        </span>
      </div>
      <div className="field svk-acts__wide"><span>Photo of the parcel on the scale <b>· required</b></span>
        <div className="svk-billform__photos">
          {photos.map((url) => (
            <span key={url} className="svk-billform__photo">
              <img src={url} alt="" />
              <button type="button" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((row) => row !== url))}><Icon name="close" size={12} /></button>
            </span>
          ))}
          {photos.length < 4 && (
            <label className={`svk-billform__add${uploading ? ' is-busy' : ''}`}>
              <input type="file" accept="image/*" capture="environment" multiple disabled={uploading} onChange={(e) => void pick(e.target.files)} />
              <Icon name="camera" size={18} /><span>{uploading ? 'Uploading…' : 'Add photo'}</span>
            </label>
          )}
        </div>
      </div>
      <label className="field"><span>Anything added</span><input value={extraLabel} onChange={(e) => setExtraLabel(e.target.value)} placeholder="Duty at actuals" /></label>
      <label className="field"><span>Amount</span><MoneyInput label="Amount added" value={extraMinor} onChange={setExtraMinor} /></label>
      <label className="field svk-acts__wide"><span>Note to the customer</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Repacked to cut the size." /></label>
      {preview && (
        <div className="svk-estimate svk-acts__wide">
          {preview.lines.map((line, index) => (
            <span key={`${line.label}-${index}`} className="svk-estimate__line"><span>{line.label}</span><b>{line.minor === 0 ? 'Free' : formatMoney(line.minor)}</b></span>
          ))}
          <span className="svk-estimate__total"><span>Bill</span><b>{formatMoney(preview.totalMinor)}</b></span>
        </div>
      )}
      {error && <span className="svk-acts__wide"><ErrorNotice message={error} /></span>}
      <button type="submit" className="btn svk-acts__wide" disabled={busy || uploading || !kg || photos.length === 0}>
        {photos.length === 0 ? 'Add the scale photo to send' : `Send the bill${preview ? ` · ${formatMoney(preview.totalMinor)}` : ''}`}
      </button>
    </form>
  );
}

export function RequestLog({ request }: { request: ServiceRequest }) {
  return (
    <ol className="svk-log">
      {[...request.history].reverse().map((event, index) => (
        <li key={`${event.at}-${index}`}><span><b>{event.byName}</b> {event.note}</span><span className="faint">{timeAgo(event.at)}</span></li>
      ))}
    </ol>
  );
}

/* ── The channel ─────────────────────────────────────────────────────── */

/**
 * A store's channel: the company's announcements, its team talking as
 * themselves under their tags, and customers asking. Members choose, per
 * message, whether they are speaking for the company - when the owner lets them.
 */
export function StoreChannel({ kind, ownerId, storeName, accentLogo }: { kind: StoreKind; ownerId: string; storeName: string; accentLogo?: ReactNode }) {
  const { user } = useSession();
  const [view, setView] = useState<ChannelView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [asCompany, setAsCompany] = useState(false);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.storeChannel(kind, ownerId));
      // The Social channel list counts what is new here since this moment.
      markSeen(`${kind}:${ownerId}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the channel.');
    }
  }, [kind, ownerId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [view?.messages.length]);
  useEffect(() => { if (view?.me?.canSpeakAsCompany) setAsCompany(true); }, [view?.me?.canSpeakAsCompany]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { message } = await api.postStoreChannel(kind, ownerId, { body: draft, asCompany, announcement: asCompany && share, toSocial: asCompany && share });
      setView((current) => current ? { ...current, messages: [...current.messages, message] } : current);
      setDraft('');
      setShare(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(message: ChannelMessage) {
    try {
      await api.deleteStoreChannel(kind, ownerId, message.id);
      setView((current) => current ? { ...current, messages: current.messages.filter((row) => row.id !== message.id) } : current);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not go.');
    }
  }

  if (!view) return error ? <ErrorNotice message={error} /> : <div className="svk-channel svk-channel--loading" aria-busy="true" />;
  const me = view.me;

  return (
    <section className="svk-channel" aria-label={`${storeName} channel`}>
      <div className="svk-channel__list">
        {view.messages.length === 0 && (
          <EmptyState icon={<Icon name="forum" size={24} />} title="Nothing said yet">
            {me?.isMember ? 'Post an update, a cut-off date, a new route.' : 'Ask the team anything — they are all told.'}
          </EmptyState>
        )}
        {view.messages.map((message) => (
          <article key={message.id} className={`svk-msg svk-msg--${message.voice}${message.announcement ? ' is-announce' : ''}${message.authorId === user?.id ? ' is-mine' : ''}`}>
            <span className="svk-msg__head">
              {message.voice === 'company' && accentLogo}
              <b>{message.authorName}</b>
              {message.voice === 'company' && <span className="svk-tag svk-tag--company">Company</span>}
              {message.tag && <span className="svk-tag">{message.tag}</span>}
              {message.postId ? (
                <Link to={`/social/p/${encodeURIComponent(message.storeId)}/${encodeURIComponent(message.postId)}`} className="svk-tag svk-tag--announce">
                  <Icon name="megaphone" size={11} /> On Social
                </Link>
              ) : message.announcement && <span className="svk-tag svk-tag--announce"><Icon name="megaphone" size={11} /> Announcement</span>}
              <span className="faint">{timeAgo(message.createdAt)}</span>
              {(message.authorId === user?.id || me?.moderates) && (
                <button type="button" className="svk-msg__del" aria-label="Remove message" onClick={() => void remove(message)}><Icon name="trash" size={12} /></button>
              )}
            </span>
            <p>{message.body}</p>
          </article>
        ))}
        <div ref={end} />
      </div>
      {me ? (
        <form className="svk-channel__compose" onSubmit={(event) => void send(event)}>
          {me.canSpeakAsCompany && (
            <div className="svk-channel__voice" role="radiogroup" aria-label="Post as">
              <button type="button" role="radio" aria-checked={asCompany} className={asCompany ? 'is-on' : ''} onClick={() => setAsCompany(true)}>As {storeName}</button>
              <button type="button" role="radio" aria-checked={!asCompany} className={!asCompany ? 'is-on' : ''} onClick={() => setAsCompany(false)}>
                As me{me.tag ? ` · ${me.tag}` : ''}
              </button>
              {asCompany && (
                <label className="svk-channel__announce">
                  <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Also post to Social
                </label>
              )}
            </div>
          )}
          <div className="svk-channel__send">
            <textarea rows={1} value={draft} maxLength={CHANNEL_MAX_CHARS} onChange={(e) => setDraft(e.target.value)}
              placeholder={me.isMember ? (asCompany ? `Post as ${storeName}…` : 'Say something to the team and customers…') : `Ask ${storeName} something…`}
              aria-label="Message" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(e as unknown as FormEvent); } }} />
            <button type="submit" className="btn" disabled={busy || !draft.trim()} aria-label="Send"><Icon name="send" size={15} /></button>
          </div>
          {error && <ErrorNotice message={error} />}
        </form>
      ) : <p className="faint svk-channel__signin"><Link to="/">Sign in</Link> to join the conversation.</p>}
    </section>
  );
}
