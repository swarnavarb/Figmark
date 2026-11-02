import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { InfoRow, PriceOption, ServiceFormField } from '@shared/models';
import type { StoreKind } from '@shared/service-stores';
import {
  ACTION_LABELS, BASIS_LABELS, CHANNEL_MAX_CHARS, REQUEST_FLOW, REQUEST_LABELS, answerText, emptyAddress,
  type AddressValue, type AnswerValue, type Answers, type ChannelMessage, type Dimensions, type Estimate, type ItemRow,
  type RequestAction, type RequestStatus, type ServiceRequest, type Standing,
} from '@shared/service-work';
import { ApiRequestError, api, type ChannelView, type RequestView, type TeamRow } from '../api';
import { useSession } from '../session';
import { formatMoney, timeAgo } from '../format';
import { EmptyState, ErrorNotice, Icon } from './ui';
import { MoneyInput } from './StoreKit';
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

export function EstimateBox({ estimate, note }: { estimate: Estimate; note?: ReactNode }) {
  return (
    <div className="svk-estimate" aria-live="polite">
      {estimate.lines.map((line) => (
        <span key={line.label} className="svk-estimate__line"><span>{line.label}</span><b>{formatMoney(line.minor)}</b></span>
      ))}
      <span className="svk-estimate__total"><span>Estimate</span><b>{formatMoney(estimate.totalMinor)}</b></span>
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

function AddressInput({ value, onChange }: { value: AddressValue | null; onChange: (next: AddressValue) => void }) {
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
      return <label className="field">{label}{hint}<input inputMode="decimal" value={(value as number) || ''} onChange={(e) => onChange(Number(e.target.value) || null)} /></label>;
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

export function RequestBadge({ kind, status }: { kind: StoreKind; status: RequestStatus }) {
  const label = REQUEST_LABELS[kind][status];
  return <span className={`badge badge--${label.tone === 'quiet' ? 'quiet' : label.tone}`}>{label.label}</span>;
}

export function RequestProgress({ status }: { status: RequestStatus }) {
  const at = REQUEST_FLOW.indexOf(status);
  return (
    <span className={`svk-flow${at < 0 ? ' is-off' : ''}`} aria-hidden="true">
      {REQUEST_FLOW.map((step, index) => <span key={step} className={index <= at ? 'is-on' : ''} />)}
    </span>
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
        <RequestBadge kind={request.kind} status={request.status} />
      </span>
      <RequestProgress status={request.status} />
      <span className="svk-row__facts">
        <span>{request.quoteMinor !== null ? 'Quote' : 'Estimate'} <b>{formatMoney(due)}</b></span>
        {request.chargeableKg ? <span><b>{request.chargeableKg}</b> kg</span> : null}
        {request.payment && !request.payment.confirmedAt && <span className="svk-row__ping">Payment to confirm</span>}
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
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = ACTION_LABELS[kind];

  async function act(action: RequestAction, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.actOnServiceRequest(kind, request.ownerId, request.id, { action, ...extra });
      setNote('');
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

  const simple = (['receive', 'start', 'deliver', 'complete', 'accept', 'confirm_payment'] as const).filter((action) => actions.includes(action));

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
      {actions.includes('pay') && (
        <form className="svk-acts__form" onSubmit={submit('pay', { reference })}>
          <label className="field svk-acts__wide"><span>Payment reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref / UTR" /></label>
          <button type="submit" className="btn svk-acts__wide" disabled={busy}>{words.pay} · {formatMoney(view.due)}</button>
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
  const [announce, setAnnounce] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.storeChannel(kind, ownerId));
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
      const { message } = await api.postStoreChannel(kind, ownerId, { body: draft, asCompany, announcement: asCompany && announce });
      setView((current) => current ? { ...current, messages: [...current.messages, message] } : current);
      setDraft('');
      setAnnounce(false);
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
              {message.announcement && <span className="svk-tag svk-tag--announce"><Icon name="megaphone" size={11} /> Announcement</span>}
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
                  <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Announce to followers
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
