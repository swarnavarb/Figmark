import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Message, MessageDeal, MessageParty } from '@shared/models';
import type { SavedCalc } from '@shared/profit';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { ErrorNotice, Modal } from './ui';

/**
 * Private deals, made in a chat, either way round.
 *
 * A shop makes one for a buyer: an item only that buyer can see or buy. It is
 * listed through the same listing route as every other item - so once bought
 * it is an ordinary order, in the order book, lots and tracking - but it is
 * never in the catalog, the shop's grid, a channel or the feed.
 *
 * A buyer asks a shop for one: what they want, how many, and what they would
 * pay. The shop answers by making the deal, prefilled from the ask.
 */

/**
 * The shop's side: the full listing form - templates, photos, terms, lots,
 * costs - in private-deal mode, prefilled from whatever the deal started
 * from: the buyer's ask, or a saved calculation.
 */
export function useMakeDeal() {
  const navigate = useNavigate();
  return (us: MessageParty, them: MessageParty, start: { from?: MessageDeal | null; calc?: SavedCalc | null } = {}) => {
    const { from, calc } = start;
    navigate(`/sell?store=${encodeURIComponent(us.userId)}`, {
      state: {
        title: calc?.title ?? from?.title ?? '',
        priceMinor: calc?.sellingPriceMinor || from?.priceMinor || undefined,
        quantity: from?.quantity,
        costSheet: calc?.steps.length ? { templateId: calc.templateId, templateName: calc.templateName, steps: calc.steps } : null,
        calc: calc ?? undefined,
        privateDeal: { userId: them.userId, handle: them.handle, displayName: them.displayName, as: us.handle },
      },
    });
  };
}

/** The buyer's side: ask a shop for a deal - what, how many, at what price. */
export function DealForm({ us, them, onClose, onSent }: {
  us: MessageParty;
  them: MessageParty;
  onClose: () => void;
  onSent: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priceMinor = Math.round(Number(price || 0) * 100);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.sendMessage(them.handle, description.trim(), us.handle, {
        kind: 'request', title: title.trim(), priceMinor, quantity: Math.max(1, Number(quantity) || 1),
      });
      onSent();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that.');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Ask ${them.displayName} for a private deal`} onClose={onClose}>
      <form className="form stack" onSubmit={submit}>
        <p className="faint">Say what you are after. The shop can answer with an item made just for you.</p>
        <label className="field">
          <span>What you are looking for</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Your price (₹, optional)</span>
            <input type="number" inputMode="decimal" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field">
            <span>Quantity</span>
            <input type="number" inputMode="numeric" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Anything else (optional)</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
        </label>
        {error && <ErrorNotice message={error} />}
        <button type="submit" className="btn" disabled={busy || !title.trim()}>{busy ? 'Sending…' : '🤝 Ask for a deal'}</button>
      </form>
    </Modal>
  );
}

/** A deal inside a chat bubble. */
export function DealCard({ message, mine, us, onAnswer }: {
  message: Message;
  mine: boolean;
  us: MessageParty;
  onAnswer: (deal: MessageDeal) => void;
}) {
  const deal = message.deal!;
  const offer = deal.kind === 'offer';
  return (
    <div className={`dealcard${offer ? ' dealcard--offer' : ''}`}>
      <span className="dealcard__tag">{offer ? '🤝 Private deal' : '🤝 Private deal request'}</span>
      <b className="dealcard__title">{deal.title}</b>
      <span className="dealcard__meta">
        {deal.priceMinor > 0 ? formatMoney(deal.priceMinor) : 'Open to offers'} · {deal.quantity} {deal.quantity === 1 ? 'unit' : 'units'}
      </span>
      {offer && deal.listingId && (
        <Link to={`/listing/${deal.listingId}`} className="btn btn--sm">{mine ? 'Open the deal' : 'View and buy'}</Link>
      )}
      {!offer && !mine && us.isStore && (
        <button type="button" className="btn btn--sm" onClick={() => onAnswer(deal)}>Make this deal</button>
      )}
    </div>
  );
}
