import { useEffect, useState } from 'react';
import { GIFT_METHOD_LABELS, type GiftMethod, type GiverKind, type StoreGift } from '@shared/billing';
import { ApiRequestError, api, type GiftsView } from '../api';
import { formatMoney, timeAgo } from '../format';
import { Modal } from './ui';
import { Select } from './Select';

/**
 * A store paying or crediting anybody: a refund that was never an order, a
 * goodwill gesture, a mistake put right. Sent direct (with the UPI or bank
 * reference, and the person says it arrived), through the gateway, or as
 * store credit that comes off their next order here on its own.
 *
 * Shops, forwarders and artists alike: `kind` says which store it comes from.
 */

const STATUS_WORDS: Record<StoreGift['status'], string> = {
  sent: 'Waiting for them to confirm',
  received: 'Received',
  not_received: 'They say it has not arrived',
  credited: 'Store credit',
};

export function GiveMoneyPanel({ kind, ownerId }: { kind: GiverKind; ownerId?: string }) {
  const [view, setView] = useState<GiftsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = () => api.storeGifts(kind, ownerId).then(setView)
    .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load what this store has paid out.'));
  useEffect(() => { void load(); }, [kind, ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="notice notice--error">{error}</p>;
  return (
    <section className="card card--pad stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Pay or credit someone</h2>
          <small className="faint">A refund, a goodwill gesture, a mistake put right - to anyone, with or without an order.</small>
        </div>
        <button type="button" className="btn" disabled={!view} onClick={() => setOpen(true)}>Pay or credit</button>
      </div>
      {view && view.gifts.length > 0 && (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
          {view.gifts.slice(0, 20).map((gift) => (
            <li key={gift.id} className="row" style={{ justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <span style={{ display: 'grid', minWidth: 0 }}>
                <b>{gift.recipientName} · {formatMoney(gift.amountMinor)}</b>
                <small className="faint">
                  {gift.reason} · {GIFT_METHOD_LABELS[gift.method]}{gift.reference ? ` · ${gift.reference}` : ''}{gift.gatewayRef ? ` · ${gift.gatewayRef}` : ''} · {timeAgo(gift.at)}
                </small>
              </span>
              <span className={`badge${gift.status === 'not_received' ? ' badge--danger' : gift.status === 'sent' ? '' : ' badge--ok'}`}>{STATUS_WORDS[gift.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {open && view && (
        <GiveMoneyForm view={view} kind={kind} ownerId={ownerId} onClose={() => setOpen(false)}
          onSent={() => { setOpen(false); void load(); }} />
      )}
    </section>
  );
}

function GiveMoneyForm({ view, kind, ownerId, onClose, onSent }: {
  view: GiftsView; kind: GiverKind; ownerId?: string; onClose: () => void; onSent: () => void;
}) {
  const [recipient, setRecipient] = useState(view.people[0]?.id ?? '');
  const [handle, setHandle] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<GiftMethod>('credit');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = recipient === '@' || view.people.length === 0;
  const bare = handle.trim().replace(/^@/, '');
  const who = typed ? (bare ? `@${bare}` : '') : recipient;
  const minor = Math.round(Number(amount) * 100);
  const ready = who && minor > 0 && reason.trim() && (method !== 'direct' || reference.trim());

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.giveMoney({
        kind, owner: ownerId, recipient: who,
        amountMinor: minor, method, reason: reason.trim(), reference: reference.trim() || undefined,
      });
      onSent();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Pay or credit from ${view.store.name}`} onClose={onClose}>
      <div className="stack">
        <label className="field">
          <span>To</span>
          <Select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            {view.people.map((person) => (
              <option key={person.id} value={person.id}>{person.name}{person.handle ? ` (@${person.handle})` : ''}</option>
            ))}
            <option value="@">Someone else - type their @handle</option>
          </Select>
        </label>
        {typed && (
          <label className="field">
            <span>Their @handle</span>
            <input value={handle} onChange={(e) => { setHandle(e.target.value); setRecipient('@'); }} placeholder="@handle" autoCapitalize="none" />
          </label>
        )}
        <label className="field">
          <span>Amount (₹)</span>
          <input type="number" inputMode="decimal" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>How</span>
          <div className="stack" style={{ gap: 6 }}>
            {(['credit', 'gateway', 'direct'] as const).map((option) => (
              <label key={option} className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input type="radio" name="give-method" checked={method === option} onChange={() => setMethod(option)} />
                <span>
                  {GIFT_METHOD_LABELS[option]}
                  <small className="faint" style={{ display: 'block' }}>
                    {option === 'credit' ? 'Comes off their next order with this store, on its own.'
                      : option === 'gateway' ? 'Sent to them through the payment gateway now.'
                        : 'You have already sent it by UPI or bank - they confirm it arrived.'}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {method === 'direct' && (
          <label className="field">
            <span>UPI or bank reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
          </label>
        )}
        <label className="field">
          <span>What it is for</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Refund for the damaged box" />
        </label>
        {error && <p className="notice notice--error">{error}</p>}
        <button type="button" className="btn" disabled={!ready || busy} onClick={() => void send()}>
          {busy ? 'Sending…' : minor > 0 ? `${method === 'credit' ? 'Credit' : 'Send'} ${formatMoney(minor)}` : 'Send'}
        </button>
      </div>
    </Modal>
  );
}
