import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PAYMENT_METHOD_LABELS, allocatePayment } from '@shared/payments';
import { ApiRequestError, api, type ItemGroup } from '../api';
import { MoneyBar } from '../components/Buy';
import { Modal } from '../components/LotFields';
import { ShipmentChip, StatusBanner, buyerStatus, type StatusFacts } from '../components/OrderStatus';
import { EmptyState, ErrorNotice, Thumb } from '../components/ui';
import { Svg } from '../components/ListingBlocks';
import { formatDate, formatMoney, timeAgo } from '../format';

type Item = ItemGroup['items'][number];

/** Store → lot, in the order the server ranked the lots. */
function byStore(groups: ItemGroup[]) {
  const stores = new Map<string, { name: string; handle: string | null; lots: ItemGroup[] }>();
  for (const group of groups) {
    const store = stores.get(group.sellerId) ?? { name: group.sellerName, handle: group.sellerHandle, lots: [] };
    store.lots.push(group);
    stores.set(group.sellerId, store);
  }
  return [...stores.entries()];
}

function sum(items: readonly Item[], key: 'totalMinor' | 'paidMinor' | 'outstandingMinor' | 'creditMinor') {
  return items.reduce((total, item) => total + item[key], 0);
}

/** The facts the status line is read from, off one purchase card. */
export function factsOf(item: Item): StatusFacts {
  return {
    placed: item.placed,
    status: item.status,
    paymentStatus: item.paymentStatus,
    bookingOnly: item.bookingOnly,
    accepted: item.accepted,
    canPay: item.canPay,
    claimDenied: item.claimDenied,
    outstandingMinor: item.outstandingMinor,
    currency: item.currency,
    dispatched: item.status === 'shipped' || Boolean(item.checkpoints.dispatched),
    shipment: item.shipment,
    receivedAt: item.receivedAt,
    inHand: item.inHand,
    disputed: item.disputed,
  };
}

function lotTitle(group: ItemGroup): string {
  if (group.lot) return `Lot #${group.lot.number}`;
  return group.kind === 'awaiting' ? 'Waiting for a lot' : 'In hand · ships from the seller';
}

/** Only what the buyer went ahead with; the rest is still their cart. */
function placedOnly(groups: ItemGroup[]): ItemGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.placed) }))
    .filter((group) => group.items.length > 0);
}

/** Pressed Buy, never paid or booked - one flat list, newest first. */
function cartOnly(groups: ItemGroup[]): { item: Item; group: ItemGroup }[] {
  return groups
    .flatMap((group) => group.items.filter((item) => !item.placed).map((item) => ({ item, group })))
    .sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
}

/**
 * Everything this person has bought, by store and then by lot.
 *
 * Only orders they went ahead with - paid, paid an advance, or booked. A Buy
 * they never finished is in the cart, not here. Every item leads with one
 * highlighted line saying where it stands, the same line the order itself
 * opens with.
 */
export function PurchasesPage() {
  const [groups, setGroups] = useState<ItemGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<ItemGroup | null>(null);
  const [cartCount, setCartCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const all = (await api.myItems()).groups;
      setGroups(placedOnly(all));
      setCartCount(cartOnly(all).length);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your purchases.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toPay = (groups ?? []).flatMap((group) => group.items).filter((item) => item.canPay && item.accepted);

  return (
    <main className="page">
      <div className="purch__hero">
        <h1>🛍️ My Purchases</h1>
        <p>Everything you ordered or booked, and where it is.</p>
      </div>

      {cartCount > 0 && (
        <Link to="/cart" className="cartnudge">
          🛒 <b>{cartCount} {cartCount === 1 ? 'item' : 'items'} in your cart</b>
          <span>Finish checkout →</span>
        </Link>
      )}

      {toPay.length > 0 && (
        <StatusBanner line={{
          tone: 'urgent', icon: '🔔',
          title: toPay.length === 1 ? '1 item is waiting for your payment' : `${toPay.length} items are waiting for your payment`,
          note: 'The seller accepted. Pay now to lock it in.',
        }} />
      )}

      {error && <ErrorNotice message={error} />}
      {!groups ? (
        <p className="muted">Loading…</p>
      ) : groups.length === 0 ? (
        <EmptyState icon="🛍️" title="No purchases yet">
          Orders you pay for or book show up here.{' '}
          {cartCount > 0 ? <Link to="/cart">Finish what is in your cart →</Link> : <Link to="/">Go find something fun →</Link>}
        </EmptyState>
      ) : (
        <div className="stack">
          {byStore(groups).map(([sellerId, store]) => (
            <section key={sellerId} className="purch__store">
              <h2 className="purch__storename">
                🏪 {store.handle ? <Link to={`/${store.handle}`}>{store.name}</Link> : store.name}
              </h2>
              {store.lots.map((group) => {
                const owing = group.items.some((item) => item.canPayMore);
                const step = group.lot ? group.lot.steps[group.lot.currentStep] : null;
                return (
                  <article key={group.key} className="purch__lot">
                    <div className="row row--between">
                      <span className="purch__lotname">{group.kind === 'direct' ? '🏠' : '📦'} {lotTitle(group)}</span>
                      {step && <span className="badge badge--aqua">{step.name}</span>}
                    </div>

                    <div className="purch__items">
                      {group.items.map((item) => <PurchaseCard key={item.id} item={item} />)}
                    </div>

                    <MoneyBar
                      totalMinor={sum(group.items, 'totalMinor')}
                      paidMinor={sum(group.items, 'paidMinor')}
                      outstandingMinor={sum(group.items, 'outstandingMinor')}
                      creditMinor={sum(group.items, 'creditMinor')}
                      currency={group.items[0]?.currency}
                    />
                    {group.items.some((item) => item.status === 'delivered' && !item.inCollection) && (
                      <Link to="/me?tab=collection" className="btn btn--quiet btn--block">🎁 Add delivered items to your collection</Link>
                    )}
                    {owing && (
                      <button type="button" className="btn btn--lg btn--block purch__paymore" onClick={() => setPaying(group)}>
                        💳 Pay More
                      </button>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {paying && (
        <PayMore group={paying} onClose={() => setPaying(null)}
          onPaid={async () => { setPaying(null); await load(); }} />
      )}
    </main>
  );
}

/**
 * One purchase: the picture and the money, and above them the one line that
 * says what is happening - highlighted, and loud when it needs the buyer.
 */
function PurchaseCard({ item }: { item: Item }) {
  const line = buyerStatus(factsOf(item));
  const urgent = line.tone === 'urgent';
  return (
    <div className={`pcard pcard--${line.tone}`}>
      <Link to={`/order/${item.id}`} className="pcard__main">
        <Thumb seed={item.id} label={item.itemName} photo={item.photo ? { url: item.photo } : null} />
        <span className="pcard__body">
          <b className="pcard__name">{item.itemName}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</b>
          <span className="pcard__money">
            <span><b>{formatMoney(item.totalMinor, item.currency)}</b></span>
            {item.paidMinor > 0 && <span className="purch__paid">Paid {formatMoney(item.paidMinor, item.currency)}</span>}
            {item.outstandingMinor > 0 && item.paidMinor > 0 && (
              <span className="purch__due">Due {formatMoney(item.outstandingMinor, item.currency)}</span>
            )}
          </span>
          <span className="pcard__tags">
            {item.inHand && <span className="badge badge--ok">🏠 In hand</span>}
            {item.deliveredAt && <span className="badge badge--ok">📬 {formatDate(item.deliveredAt)}</span>}
            {item.creditMinor > 0 && (
              <span className="badge badge--pink">💰 Credit {formatMoney(item.creditMinor, item.currency)}</span>
            )}
            {item.status === 'delivered' && !item.inCollection && (
              <span className="purch__collect">🎁 Ready for your collection</span>
            )}
          </span>
        </span>
      </Link>

      <StatusBanner line={line} compact>
        {urgent && <Link to={`/order/${item.id}`} className="sbanner__cta">Pay now</Link>}
      </StatusBanner>
      {item.shipment && <ShipmentChip shipment={item.shipment} />}

      <div className="pcard__foot">
        <Link to={`/listing/${item.listingId}`} className="pcard__link"><Svg name="open" size={13} /> View listing</Link>
        {item.canConfirm && <span className="faint">Tap to confirm it arrived</span>}
        <Link to={`/order/${item.id}`} className="pcard__link pcard__link--go">Open order →</Link>
      </div>
    </div>
  );
}

/**
 * The cart: every Buy that was never paid or booked.
 *
 * Nothing here is an order yet - the seller has not been told, and no stock is
 * held. Finishing checkout is what moves an item across to My Purchases.
 */
export function CartPage() {
  const [items, setItems] = useState<{ item: Item; group: ItemGroup }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.myItems()
      .then((result) => setItems(cartOnly(result.groups)))
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your cart.'));
  }, []);

  const total = (items ?? []).reduce((sumMinor, { item }) => sumMinor + item.totalMinor, 0);

  return (
    <main className="page">
      <div className="cart__hero">
        <h1>🛒 Your cart</h1>
        <p>Things you pressed Buy on. Pay or book to place the order.</p>
      </div>

      {error && <ErrorNotice message={error} />}
      {!items ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState icon="🛒" title="Your cart is empty">
          Press Buy on anything you like and it waits here. <Link to="/">Go find something fun →</Link>
        </EmptyState>
      ) : (
        <div className="stack">
          <div className="cart__sum">
            <span>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
            <b>{formatMoney(total, items[0]?.item.currency)}</b>
          </div>
          {items.map(({ item, group }) => (
            <article key={item.id} className="cart__item">
              <Link to={`/listing/${item.listingId}`} className="cart__thumb" aria-label="See the listing">
                <Thumb seed={item.id} label={item.itemName} photo={item.photo ? { url: item.photo } : null} />
              </Link>
              <div className="cart__body">
                <Link to={`/listing/${item.listingId}`} className="cart__name">
                  {item.itemName}{item.quantity > 1 ? ` ×${item.quantity}` : ''}
                </Link>
                <span className="faint">
                  🏪 {group.sellerName} · added {timeAgo(item.createdAt)}
                  {item.inHand ? ' · 🏠 In hand' : ''}
                </span>
                <b className="cart__price">{formatMoney(item.totalMinor, item.currency)}</b>
                <div className="cart__acts">
                  <Link to={`/order/${item.id}`} className="btn btn--sm">💳 Checkout</Link>
                  <Link to={`/listing/${item.listingId}`} className="btn btn--quiet btn--sm"><Svg name="open" size={13} /> View listing</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

/**
 * Choose items, enter an amount, see exactly where it goes, then confirm.
 *
 * The preview runs the same allocation the server records, so what is shown
 * before Confirm is what happens after it.
 */
function PayMore({ group, onClose, onPaid }: {
  group: ItemGroup; onClose: () => void; onPaid: () => void | Promise<void>;
}) {
  const eligible = group.items.filter((item) => item.canPayMore);
  const [picked, setPicked] = useState<string[]>(() => eligible.slice(0, 1).map((item) => item.id));
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = eligible[0]?.currency ?? 'INR';
  const byId = new Map(eligible.map((item) => [item.id, item]));
  const selected = picked.map((id) => byId.get(id)!).filter(Boolean);
  const methods = new Set(selected.map((item) => item.method));
  const method = selected[0]?.method ?? eligible[0]?.method ?? 'direct';
  const amountMinor = Math.round((Number(amount) || 0) * 100);
  const plan = allocatePayment(
    amountMinor,
    selected.map((item) => ({ id: item.id, outstandingMinor: item.outstandingMinor })),
    eligible.filter((item) => item.method === method)
      .map((item) => ({ id: item.id, outstandingMinor: item.outstandingMinor })),
  );

  const toggle = (id: string) =>
    setPicked((now) => (now.includes(id) ? now.filter((entry) => entry !== id) : [...now, id]));

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.payMore({ orderIds: picked, amountMinor, reference: reference.trim() || undefined });
      await onPaid();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That payment did not go through.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`💳 Pay more · ${lotTitle(group)}`} onClose={onClose}>
      <div className="stack">
        <span className="faint">Tap items in the order you want them paid off.</span>
        <div className="stack" style={{ gap: 8 }}>
          {eligible.map((item) => {
            const order = picked.indexOf(item.id);
            return (
              <button key={item.id} type="button" className={`alloc__pick${order >= 0 ? ' is-on' : ''}`}
                onClick={() => toggle(item.id)} aria-pressed={order >= 0}>
                <span className="alloc__num">{order >= 0 ? order + 1 : '+'}</span>
                <span className="alloc__name">{item.itemName}</span>
                <span className="alloc__nums">
                  <small>Total {formatMoney(item.totalMinor, currency)}</small>
                  <small>Paid {formatMoney(item.paidMinor, currency)}</small>
                  <b>Due {formatMoney(item.outstandingMinor, currency)}</b>
                </span>
              </button>
            );
          })}
        </div>

        <label className="field">
          <span>Payment amount (₹)</span>
          <input type="number" min="1" inputMode="decimal" value={amount} placeholder="6000"
            onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Transaction reference (optional)</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / UPI ref" />
        </label>

        {amountMinor > 0 && selected.length > 0 && (
          <div className="alloc">
            <b>Where it goes</b>
            {plan.lines.map((line) => (
              <div key={line.orderId} className="alloc__line">
                <span>{byId.get(line.orderId)?.itemName}{line.spill ? ' ↪︎' : ''}</span>
                <span>
                  {formatMoney(line.amountMinor, currency)}{' '}
                  <span className={`badge badge--${line.completes ? 'ok' : 'warn'}`}>{line.completes ? 'Complete' : 'Partial'}</span>
                </span>
              </div>
            ))}
            {plan.extraMinor > 0 && (
              <div className="alloc__line alloc__line--extra">
                <span>💰 Extra payment / credit</span>
                <span>{formatMoney(plan.extraMinor, currency)}</span>
              </div>
            )}
            <div className="alloc__line alloc__line--total">
              <span>Total payment</span><b>{formatMoney(amountMinor, currency)}</b>
            </div>
            <div className="alloc__line">
              <span>Payment method</span><span className="badge badge--aqua">{PAYMENT_METHOD_LABELS[method]}</span>
            </div>
          </div>
        )}

        {methods.size > 1 && (
          <p className="notice notice--warn">These items were paid different ways. Pay them one method at a time.</p>
        )}
        {error && <ErrorNotice message={error} />}
        <button type="button" className="btn btn--lg btn--block"
          disabled={busy || amountMinor <= 0 || selected.length === 0 || methods.size > 1}
          onClick={() => void confirm()}>
          {busy ? 'Paying…' : `Confirm ${amountMinor > 0 ? formatMoney(amountMinor, currency) : ''}`}
        </button>
      </div>
    </Modal>
  );
}
