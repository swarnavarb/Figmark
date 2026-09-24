import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PAYMENT_METHOD_LABELS, allocatePayment } from '@shared/payments';
import { ApiRequestError, api, type ItemGroup } from '../api';
import { MoneyBar } from '../components/Buy';
import { Modal } from '../components/LotFields';
import { EmptyState, ErrorNotice, Thumb } from '../components/ui';
import { formatMoney } from '../format';

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

function lotTitle(group: ItemGroup): string {
  if (group.lot) return `Lot #${group.lot.number}`;
  return group.kind === 'awaiting' ? 'Waiting for a lot' : 'Shipped direct';
}

/**
 * Everything this person has bought, by store and then by lot, with the money
 * on every item and a Pay More on every group that still owes something.
 */
export function PurchasesPage() {
  const [groups, setGroups] = useState<ItemGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<ItemGroup | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups((await api.myItems()).groups);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your purchases.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <main className="page">
      <div className="purch__hero">
        <h1>🛍️ My Purchases</h1>
        <p>Everything you bought, what is paid and what is left.</p>
      </div>

      {error && <ErrorNotice message={error} />}
      {!groups ? (
        <p className="muted">Loading…</p>
      ) : groups.length === 0 ? (
        <EmptyState icon="🛒" title="Nothing here yet!">
          Your haul shows up here the moment you buy something. <Link to="/">Go find something fun →</Link>
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
                      <span className="purch__lotname">📦 {lotTitle(group)}</span>
                      {step && <span className="badge badge--aqua">{step.name}</span>}
                    </div>

                    <div className="purch__items">
                      {group.items.map((item) => (
                        <Link key={item.id} to={`/order/${item.id}`} className="purch__item">
                          <Thumb seed={item.id} label={item.itemName} photo={item.photo ? { url: item.photo } : null} />
                          <div className="purch__itembody">
                            <b>{item.itemName}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</b>
                            <span>Total <b>{formatMoney(item.totalMinor, item.currency)}</b></span>
                            <span>Paid <b className="purch__paid">{formatMoney(item.paidMinor, item.currency)}</b></span>
                            {item.outstandingMinor > 0 ? (
                              <span>Balance <b className="purch__due">{formatMoney(item.outstandingMinor, item.currency)}</b></span>
                            ) : item.paidMinor > 0 ? (
                              <span className="badge badge--ok">✅ Paid in full</span>
                            ) : !item.placed ? (
                              <span className="badge badge--warn">🛒 Checkout not finished — pay or book to place it</span>
                            ) : (
                              <span className="badge badge--warn">Awaiting payment</span>
                            )}
                            {item.creditMinor > 0 && (
                              <span className="badge badge--pink">💰 Credit {formatMoney(item.creditMinor, item.currency)}</span>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>

                    <MoneyBar
                      totalMinor={sum(group.items, 'totalMinor')}
                      paidMinor={sum(group.items, 'paidMinor')}
                      outstandingMinor={sum(group.items, 'outstandingMinor')}
                      creditMinor={sum(group.items, 'creditMinor')}
                      currency={group.items[0]?.currency}
                    />
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
