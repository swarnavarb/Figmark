import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PAYMENT_METHOD_LABELS, allocatePayment } from '@shared/payments';
import { ApiRequestError, api, type ItemGroup } from '../api';
import { BuyerLotBox, ItemRow, LotPeek, ShelfTrack } from '../components/BuyerLots';
import { Modal } from '../components/LotFields';
import { EmptyState, ErrorNotice, Thumb } from '../components/ui';
import { ItemCard, Svg } from '../components/ListingBlocks';
import { formatMoney, timeAgo } from '../format';
import { useToast } from '../components/Feedback';

type Item = ItemGroup['items'][number];

function lotTitle(group: ItemGroup): string {
  if (group.lot) return group.lot.name;
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

const arrived = (item: Item) => item.status === 'delivered';

/**
 * Everything this person has bought, sorted by what it is waiting on rather
 * than by which shop it came from.
 *
 * First whatever needs them - a payment, an "it arrived". Then the boxes on
 * their way, one per lot, which open to show what of theirs is inside. Then
 * anything sold off a shop's shelf, which never rides a lot and gets its own
 * three stops, and anything still waiting for a lot to be opened. Last, the
 * shelf of what has arrived.
 */
export function PurchasesPage() {
  const [groups, setGroups] = useState<ItemGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<ItemGroup | null>(null);
  const [peeking, setPeeking] = useState<ItemGroup | null>(null);
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

  const all = groups ?? [];
  const items = all.flatMap((group) => group.items);
  const toPay = items.filter((item) => item.canPay);
  const toConfirm = items.filter((item) => item.canConfirm);
  const owedMinor = toPay.reduce((sum, item) => sum + item.outstandingMinor, 0);
  // A lot stays a box on its way until everything of theirs in it has arrived.
  const boxes = all.filter((group) => group.kind === 'lot' && group.items.some((item) => !arrived(item)));
  const shelf = all.filter((group) => group.kind === 'direct').flatMap((group) => group.items).filter((item) => !arrived(item));
  const waiting = all.filter((group) => group.kind === 'awaiting').flatMap((group) => group.items).filter((item) => !arrived(item));
  const landed = items.filter(arrived).sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? ''));
  const uncollected = landed.some((item) => !item.inCollection);

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

      {error && <ErrorNotice message={error} />}
      {!groups ? (
        <p className="muted">Loading…</p>
      ) : groups.length === 0 ? (
        <EmptyState icon="🛍️" title="No purchases yet">
          Orders you pay for or book show up here.{' '}
          {cartCount > 0 ? <Link to="/cart">Finish what is in your cart →</Link> : <Link to="/">Go find something fun →</Link>}
        </EmptyState>
      ) : (
        <div className="stack purch">
          {/* What needs them, and nothing else, first. Money is said plainly. */}
          <section className="needs" aria-label="Needs you">
            {toPay.length === 0 && toConfirm.length === 0 ? (
              <p className="needs__calm">✨ Nothing needs you right now — sit back, we will shout when something does.</p>
            ) : (
              <>
                <span className="needs__title">Needs you</span>
                {toPay.length > 0 && (
                  <div className="needs__row needs__row--pay">
                    <span>💳 Pay <b>{formatMoney(owedMinor, toPay[0]?.currency)}</b> for {toPay.length === 1 ? '1 item' : `${toPay.length} items`}</span>
                    <div className="needs__chips">
                      {toPay.map((item) => (
                        <Link key={item.id} to={`/order/${item.id}`} className="needs__chip">{item.itemName} →</Link>
                      ))}
                    </div>
                  </div>
                )}
                {toConfirm.length > 0 && (
                  <div className="needs__row needs__row--confirm">
                    <span>📬 {toConfirm.length === 1 ? '1 item has' : `${toConfirm.length} items have`} arrived — tell the shop it reached you</span>
                    <div className="needs__chips">
                      {toConfirm.map((item) => (
                        <Link key={item.id} to={`/order/${item.id}`} className="needs__chip">{item.itemName} →</Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {boxes.length > 0 && (
            <section className="purch__section">
              <h2 className="purch__h">📦 Boxes on their way <span className="faint">tap one to look inside</span></h2>
              <div className="lot-grid lot-grid--buyer">
                {boxes.map((group) => (
                  <BuyerLotBox key={group.key} group={group} onOpen={() => setPeeking(group)} />
                ))}
              </div>
            </section>
          )}

          {shelf.length > 0 && (
            <section className="purch__section">
              <h2 className="purch__h">🏠 Straight from the shop <span className="faint">in hand, no lot needed</span></h2>
              <div className="stack" style={{ gap: 10 }}>
                {shelf.map((item) => (
                  <div key={item.id} className="shelfcard">
                    <ItemRow item={item} />
                    <ShelfTrack item={item} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {waiting.length > 0 && (
            <section className="purch__section">
              <h2 className="purch__h">⏳ Waiting for a box <span className="faint">the shop puts these in a lot soon</span></h2>
              <div className="stack" style={{ gap: 10 }}>
                {waiting.map((item) => <ItemRow key={item.id} item={item} note="Not in a lot yet — you will see its box here once it is." />)}
              </div>
            </section>
          )}

          {landed.length > 0 && (
            <section className="purch__section">
              <h2 className="purch__h">🎁 Arrived</h2>
              <div className="arrived">
                {landed.map((item) => (
                  <Link key={item.id} to={`/order/${item.id}`} className="arrived__item">
                    <Thumb seed={item.id} label={item.itemName} photo={item.photo ? { url: item.photo } : null} />
                    <span className="arrived__name">{item.itemName}</span>
                    {item.canConfirm
                      ? <span className="arrived__tag arrived__tag--ask">Confirm it</span>
                      : item.inCollection
                        ? <span className="arrived__tag">On your shelf</span>
                        : <span className="arrived__tag">Unboxed ✓</span>}
                  </Link>
                ))}
              </div>
              {uncollected && (
                <Link to="/me?tab=collection" className="btn btn--quiet btn--block">🎁 Add them to your collection</Link>
              )}
            </section>
          )}
        </div>
      )}

      {peeking && (
        <LotPeek group={peeking} onClose={() => setPeeking(null)}
          onPayMore={() => { setPaying(peeking); setPeeking(null); }} />
      )}
      {paying && (
        <PayMore group={paying} onClose={() => setPaying(null)}
          onPaid={async () => { setPaying(null); await load(); }} />
      )}
    </main>
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
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  async function discard(item: Item, save: boolean) {
    setBusy(item.id);
    try {
      await api.discardCheckout(item.id, save);
      setItems((now) => now && now.filter((entry) => entry.item.id !== item.id));
      toast(save ? `${item.itemName} moved to Saved.` : `${item.itemName} removed from your cart.`, 'ok');
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not work.', 'error');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void api.myItems()
      .then((result) => setItems(cartOnly(result.groups)))
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your cart.'));
  }, []);

  const total = (items ?? []).reduce((sumMinor, { item }) => sumMinor + item.totalMinor, 0);

  return (
    <main className="page">
      <header className="cartbox rise">
        <span className="cartbox__icon"><Svg name="cart" size={24} /></span>
        <div className="cartbox__text">
          <span className="cartbox__eyebrow">Waiting for you</span>
          <h1 className="cartbox__title">Your cart</h1>
          <p className="cartbox__lede">Things you pressed Buy on. Nothing is ordered until you pay or book.</p>
        </div>
        {items && items.length > 0 && (
          <div className="cartbox__sum">
            <span>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
            <b>{formatMoney(total, items[0]?.item.currency)}</b>
          </div>
        )}
      </header>

      {error && <ErrorNotice message={error} />}
      {!items ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState icon={<Svg name="cart" size={26} />} title="Your cart is empty">
          Press Buy on anything you like and it waits here. <Link to="/">Go find something fun →</Link>
        </EmptyState>
      ) : (
        <div className="stack">
          {items.map(({ item, group }, n) => (
            <ItemCard key={item.id} i={n + 1}
              to={`/listing/${item.listingId}`}
              photo={item.photo ?? null}
              name={item.itemName}
              eyebrow={<><Svg name="cart" size={13} /> In your cart</>}
              meta={<>From {group.sellerName} · added {timeAgo(item.createdAt)}</>}
              facts={[
                { label: 'Total', value: formatMoney(item.totalMinor, item.currency), tone: 'accent' },
                { label: 'Qty', value: item.quantity },
                { label: 'Stock', value: item.inHand ? <><Svg name="home" size={13} /> In hand</> : <><Svg name="ship" size={13} /> Import</>, tone: item.inHand ? 'ok' : undefined },
                { label: 'Status', value: 'Not placed', tone: 'warn' },
              ]}>
              <Link to={`/order/${item.id}`} className="btn btn--sm icard__go">Checkout →</Link>
              <Link to={`/listing/${item.listingId}`} className="icard__open">View listing <Svg name="open" size={14} /></Link>
              <span className="cartacts">
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy === item.id}
                  onClick={() => void discard(item, true)}><Svg name="heart" size={13} /> Move to saved</button>
                <button type="button" className="btn btn--quiet btn--sm is-danger" disabled={busy === item.id}
                  onClick={() => void discard(item, false)}>Remove</button>
              </span>
            </ItemCard>
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
export function PayMore({ group, onClose, onPaid }: {
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
