import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Message, MessageDeal, MessageParty } from '@shared/models';
import type { DealState } from '@shared/deals';
import type { SavedCalc } from '@shared/profit';
import { ApiRequestError, api, type DealItem } from '../api';
import { formatMoney } from '../format';
import { ErrorNotice, Icon, Modal, Thumb } from './ui';

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
 * from: one of the shop's own items, the buyer's ask, or a saved calculation.
 */
export function useMakeDeal() {
  const navigate = useNavigate();
  return (us: MessageParty, them: MessageParty, start: { from?: MessageDeal | null; calc?: SavedCalc | null; item?: DealItem | null } = {}) => {
    const { from, calc, item } = start;
    navigate(`/sell?store=${encodeURIComponent(us.userId)}`, {
      state: {
        title: calc?.title ?? item?.title ?? from?.title ?? '',
        priceMinor: calc?.sellingPriceMinor || item?.priceMinor || from?.priceMinor || undefined,
        // A sold out item is the one being asked for again: one, unless they said more.
        quantity: from?.quantity ?? (item ? Math.max(1, item.quantityAvailable) : undefined),
        costSheet: calc?.steps.length ? { templateId: calc.templateId, templateName: calc.templateName, steps: calc.steps } : null,
        calc: calc ?? undefined,
        ...(item ? {
          description: item.description, category: item.category, condition: item.condition,
          tags: item.tags, photos: item.photos,
          fromItem: { id: item.id, title: item.title, priceMinor: item.priceMinor, state: item.state },
        } : {}),
        privateDeal: { userId: them.userId, handle: them.handle, displayName: them.displayName, as: us.handle },
      },
    });
  };
}

const STATE_LABEL: Record<DealState, string> = { live: 'On sale', bought: 'Sold out', expired: 'Expired', gone: 'Taken down' };

/**
 * Pick what a private deal starts from: one of the shop's items - sold out and
 * expired ones too, since those are what buyers come asking for - or nothing.
 *
 * Opened on a particular item (from a message about it), it goes straight
 * there when that item is found.
 */
export function DealPicker({ us, them, onClose, focus = null }: {
  us: MessageParty;
  them: MessageParty;
  onClose: () => void;
  /** An item to start from without asking, when the chat is already about it. */
  focus?: string | null;
}) {
  const makeDeal = useMakeDeal();
  const [items, setItems] = useState<DealItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'all' | DealState>('all');

  useEffect(() => {
    let cancelled = false;
    void api.dealItems(them.handle, us.handle)
      .then(({ items: found }) => {
        if (cancelled) return;
        const hit = focus ? found.find((item) => item.id === focus) : null;
        if (hit) makeDeal(us, them, { item: hit });
        else setItems(found);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof ApiRequestError ? err.message : 'Could not load your items.'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [them.handle, us.handle, focus]);

  const needle = query.trim().toLowerCase();
  const shown = (items ?? [])
    .filter((item) => show === 'all' || item.state === show)
    .filter((item) => !needle || item.title.toLowerCase().includes(needle) || item.tags.some((tag) => tag.toLowerCase().includes(needle)));
  const count = (state: DealState) => (items ?? []).filter((item) => item.state === state).length;

  return (
    <Modal title={`Private deal for ${them.displayName}`} onClose={onClose}>
      <div className="dealpick">
        <button type="button" className="dealpick__fresh" onClick={() => makeDeal(us, them)}>
          <span className="dealpick__freshicon" aria-hidden="true">＋</span>
          <span><b>Start from scratch</b><small>A new item, just for them</small></span>
        </button>
        <p className="dealpick__or">or start from one of your items - change anything before sending</p>
        {error && <ErrorNotice message={error} />}
        {!items && !error && <div className="dealpick__loading"><span className="skel" /><span className="skel" /><span className="skel" /></div>}
        {items && (
          <>
            {items.length > 5 && (
              <label className="chlist__search">
                <Icon name="search" size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your items" aria-label="Search your items" />
              </label>
            )}
            <div className="dealpick__tabs" role="tablist">
              {(['all', 'live', 'bought', 'expired'] as const).map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={show === tab}
                  className={`chip${show === tab ? ' is-on' : ''}`} onClick={() => setShow(tab)}>
                  {tab === 'all' ? 'All' : STATE_LABEL[tab]}
                  {tab !== 'all' && count(tab) > 0 && <span className="chip__count">{count(tab)}</span>}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="faint dealpick__none">{items.length === 0 ? 'No items yet.' : 'Nothing here.'}</p>
            ) : (
              <div className="dealpick__list">
                {shown.map((item) => (
                  <button key={item.id} type="button" className={`dealpick__row is-${item.state}`}
                    onClick={() => makeDeal(us, them, { item })}>
                    <Thumb seed={item.id} label={item.title} photo={item.photos.find((photo) => photo.isPrimary) ?? item.photos[0]}
                      className="thumb dealpick__photo" />
                    <span className="dealpick__body">
                      <b>{item.title}</b>
                      <span>{formatMoney(item.priceMinor, item.currency)} · {item.condition}</span>
                    </span>
                    <span className={`dealstate dealstate--${item.state}`}>{STATE_LABEL[item.state]}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** The buyer's side: ask a shop for a deal - what, how many, at what price. */
export function DealForm({ us, them, onClose, onSent, initialTitle = '' }: {
  us: MessageParty;
  them: MessageParty;
  onClose: () => void;
  onSent: () => void;
  /** What they are asking about, when they came from a post about it. */
  initialTitle?: string;
}) {
  const [title, setTitle] = useState(initialTitle.slice(0, 120));
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

/** "1h 42m left", "8m left", ticking. */
function useCountdown(until: string | null | undefined): { left: number; label: string } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(tick);
  }, [until]);
  if (!until) return { left: Infinity, label: '' };
  const left = Date.parse(until) - now;
  if (left <= 0) return { left: 0, label: 'Ended' };
  const minutes = Math.ceil(left / 60_000);
  const label = minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''} left`
    : `${minutes}m left`;
  return { left, label };
}

/**
 * A deal inside a chat bubble: the item, the price made for this buyer and
 * what it took off, and a clock running down to when it closes.
 */
export function DealCard({ message, mine, us, onAnswer }: {
  message: Message;
  mine: boolean;
  us: MessageParty;
  onAnswer: (deal: MessageDeal) => void;
}) {
  const deal = message.deal!;
  const offer = deal.kind === 'offer';
  const clock = useCountdown(offer ? deal.expiresAt : null);
  const state: DealState = !offer ? 'live'
    : deal.state && deal.state !== 'live' ? deal.state
    : clock.left <= 0 ? 'expired' : 'live';
  const saved = offer && deal.wasMinor && deal.wasMinor > deal.priceMinor ? deal.wasMinor - deal.priceMinor : 0;
  // How much of the clock is left, against what it started with.
  const span = offer && deal.expiresAt ? Date.parse(deal.expiresAt) - Date.parse(message.createdAt) : 0;
  const fraction = span > 0 && Number.isFinite(clock.left) ? Math.max(0, Math.min(1, clock.left / span)) : 0;
  const urgent = state === 'live' && clock.left < 20 * 60_000;

  if (!offer) {
    return (
      <div className="dealcard dealcard--ask">
        <span className="dealcard__tag">🤝 Asking for a private deal</span>
        <b className="dealcard__title">{deal.title}</b>
        <span className="dealcard__meta">
          {deal.priceMinor > 0 ? <>Hoping for <b>{formatMoney(deal.priceMinor)}</b></> : 'Open to offers'}
          {' · '}{deal.quantity} {deal.quantity === 1 ? 'unit' : 'units'}
        </span>
        {!mine && us.isStore && (
          <button type="button" className="btn btn--sm dealcard__go" onClick={() => onAnswer(deal)}>Make this deal</button>
        )}
      </div>
    );
  }

  return (
    <div className={`dealcard dealcard--offer is-${state}${urgent ? ' is-urgent' : ''}`}>
      <div className="dealcard__head">
        <span className="dealcard__tag">🤝 {mine ? 'Private deal' : 'Just for you'}</span>
        <span className={`dealcard__clock${state === 'live' ? '' : ' is-done'}`}>
          {state === 'live' ? <>⏱ {clock.label}</> : state === 'bought' ? '✓ Bought' : state === 'expired' ? 'Deal ended' : 'Withdrawn'}
        </span>
      </div>
      <div className="dealcard__item">
        {deal.photo
          ? <img className="dealcard__photo" src={deal.photo} alt="" loading="lazy" />
          : <Thumb seed={deal.listingId ?? deal.title} label={deal.title} className="thumb dealcard__photo" />}
        <span className="dealcard__body">
          <b className="dealcard__title">{deal.title}</b>
          <span className="dealcard__price">
            {formatMoney(deal.priceMinor)}
            {saved > 0 && <s>{formatMoney(deal.wasMinor!)}</s>}
          </span>
          <span className="dealcard__meta">
            {saved > 0 && <span className="dealcard__save">You save {formatMoney(saved)}</span>}
            {deal.quantity} {deal.quantity === 1 ? 'unit' : 'units'}
          </span>
        </span>
      </div>
      {state === 'live' && span > 0 && (
        <span className="dealcard__bar" aria-hidden="true"><i style={{ width: `${fraction * 100}%` }} /></span>
      )}
      {deal.listingId && (
        mine ? (
          <Link to={`/listing/${deal.listingId}`} className="btn btn--sm btn--ghost dealcard__go">
            {state === 'expired' ? 'Reopen with a new clock' : 'Open the deal'}
          </Link>
        ) : state === 'live' ? (
          <Link to={`/listing/${deal.listingId}`} className="btn btn--sm dealcard__go">View and buy</Link>
        ) : state === 'bought' ? (
          <Link to={`/listing/${deal.listingId}`} className="btn btn--sm btn--ghost dealcard__go">View</Link>
        ) : (
          <span className="dealcard__ended">Ask {message.from.displayName} to open it again</span>
        )
      )}
    </div>
  );
}

/**
 * The item a message is about, the way both sides see it: so a question, a
 * bargain or a "still there?" is never about the wrong thing. The shop gets a
 * way to answer it with a private deal made from that very item.
 */
export function ItemRefCard({ message, mine, us, onDealFrom }: {
  message: Message;
  mine: boolean;
  us: MessageParty;
  /** The shop's answer: a private deal made from this item. */
  onDealFrom: (listingId: string) => void;
}) {
  const item = message.item!;
  const state = item.state ?? 'live';
  const changed = item.nowMinor != null && item.nowMinor !== item.priceMinor;
  // The shop's side of the conversation: it sells this, so it can make a deal of it.
  const shopSide = us.isStore && (mine ? message.from.isStore : message.to.isStore);
  return (
    <div className={`itemref is-${state}`}>
      <Link to={`/listing/${item.listingId}`} className="itemref__item">
        {item.photo
          ? <img className="itemref__photo" src={item.photo} alt="" loading="lazy" />
          : <Thumb seed={item.listingId} label={item.title} className="thumb itemref__photo" />}
        <span className="itemref__body">
          <span className="itemref__tag">{mine && !shopSide ? 'You asked about' : 'About this item'}</span>
          <b className="itemref__title">{item.title}</b>
          <span className="itemref__meta">
            <span className="itemref__price">
              {formatMoney(changed ? item.nowMinor! : item.priceMinor, item.currency)}
              {changed && <s>{formatMoney(item.priceMinor, item.currency)}</s>}
            </span>
            <span className="faint">{item.condition}</span>
            {state !== 'live' && <span className={`dealstate dealstate--${state}`}>{STATE_LABEL[state]}</span>}
          </span>
        </span>
        <Icon name="right" size={14} />
      </Link>
      {shopSide && (
        <button type="button" className="itemref__deal" onClick={() => onDealFrom(item.listingId)}>
          🤝 Make a private deal from this
        </button>
      )}
    </div>
  );
}
