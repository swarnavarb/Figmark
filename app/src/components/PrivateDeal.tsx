import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Message, MessageDeal, MessageParty } from '@shared/models';
import type { SavedCalc } from '@shared/profit';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { CostSheetField, type CostSheetDraft } from './CostSheetField';
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

const sheetOf = (calc: SavedCalc): CostSheetDraft | null =>
  (calc.steps.length ? { templateId: calc.templateId, templateName: calc.templateName, steps: calc.steps } : null);

export function DealForm({ us, them, from, calc, onClose, onSent }: {
  us: MessageParty;
  them: MessageParty;
  /** The buyer's ask this answers, when it answers one. */
  from?: MessageDeal | null;
  /** A saved calculation to make the deal from. */
  calc?: SavedCalc | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const shopMaking = us.isStore && !them.isStore;
  const [title, setTitle] = useState(calc?.title ?? from?.title ?? '');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(() => {
    const minor = calc?.sellingPriceMinor || from?.priceMinor;
    return minor ? String(minor / 100) : '';
  });
  const [quantity, setQuantity] = useState(String(from?.quantity ?? 1));
  const [costSheet, setCostSheet] = useState<CostSheetDraft | null>(calc ? sheetOf(calc) : null);
  // The floating calculator's saved list, to fill the deal from.
  const [calcs, setCalcs] = useState<SavedCalc[]>([]);
  useEffect(() => {
    if (!shopMaking) return;
    void api.savedCalcs(us.userId).then((result) => setCalcs(result.calcs)).catch(() => setCalcs([]));
  }, [shopMaking, us.userId]);
  function fillFromCalc(id: string) {
    const picked = calcs.find((entry) => entry.id === id);
    if (!picked) return;
    setTitle(picked.title);
    if (picked.sellingPriceMinor) setPrice(String(picked.sellingPriceMinor / 100));
    setCostSheet(sheetOf(picked));
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priceMinor = Math.round(Number(price || 0) * 100);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (shopMaking) {
        const { listing } = await api.createListing({
          title: title.trim(),
          description: description.trim(),
          category: 'Collectibles',
          condition: 'LOOSE',
          priceMinor,
          quantityAvailable: Math.max(1, Number(quantity) || 1),
          sourcing: 'in_hand',
          lotId: null,
          preOrder: null,
          tags: [],
          photos: [],
          shareToChannel: false,
          shareToFeed: false,
          privateFor: them.userId,
          storeId: us.userId,
          costSheet,
        });
        await api.sendMessage(them.handle, '', us.handle, { kind: 'offer', listingId: listing.id });
      } else {
        await api.sendMessage(them.handle, description.trim(), us.handle, {
          kind: 'request', title: title.trim(), priceMinor, quantity: Math.max(1, Number(quantity) || 1),
        });
      }
      onSent();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that deal.');
      setBusy(false);
    }
  }

  return (
    <Modal title={shopMaking ? `Private deal for ${them.displayName}` : `Ask ${them.displayName} for a private deal`} onClose={onClose}>
      <form className="form stack" onSubmit={submit}>
        <p className="faint">
          {shopMaking
            ? `Only ${them.displayName} can see and buy this. It never appears in your shop, channel or the feed, but once bought it is a normal order - in your orders, lots and tracking.`
            : 'Say what you are after. The shop can answer with an item made just for you.'}
        </p>
        {shopMaking && calcs.length > 0 && (
          <label className="field">
            <span>🧮 From your saved calculations</span>
            <select value="" onChange={(e) => fillFromCalc(e.target.value)}>
              <option value="">Pick one to fill this in…</option>
              {calcs.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.title} · {formatMoney(entry.sellingPriceMinor)}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{shopMaking ? 'Item' : 'What you are looking for'}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>{shopMaking ? 'Price (₹)' : 'Your price (₹, optional)'}</span>
            <input type="number" inputMode="decimal" min={0} step={1} value={price} required={shopMaking}
              onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field">
            <span>Quantity</span>
            <input type="number" inputMode="numeric" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{shopMaking ? 'Details (optional)' : 'Anything else (optional)'}</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
        </label>
        {shopMaking && (
          <CostSheetField value={costSheet} onChange={setCostSheet} sellingPriceMinor={priceMinor} shop={us.userId} />
        )}
        {error && <ErrorNotice message={error} />}
        <button type="submit" className="btn" disabled={busy || !title.trim() || (shopMaking && priceMinor <= 0)}>
          {busy ? 'Sending…' : shopMaking ? '🤝 Send private deal' : '🤝 Ask for a deal'}
        </button>
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
