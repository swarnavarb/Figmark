import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CHECKPOINT_LABELS,
  CHECKPOINT_SIDE,
  ORDER_CHECKPOINTS,
  type OrderCheckpoint,
} from '@shared/enums';
import { countOf } from '@shared/board';
import { ApiRequestError, api, type BoardCustomer, type LotBoard } from '../api';
import { EmptyState, Icon } from './ui';
import { formatWeight } from '../format';

/**
 * One lot, worked customer by customer.
 *
 * A parcel goes to a person rather than to a line item, so the unit here is a
 * customer with all of their orders under them: that is how a lot gets packed,
 * and how it gets dispatched. Ticking is per item, because that is the level at
 * which things actually arrive.
 *
 * Shared between the packing board, which is this and nothing else, and the
 * People section of a lot - so the two can never drift into disagreeing about
 * whose parcel is whose.
 */
export function LotPeople({ board, onChanged, onError }: {
  board: LotBoard;
  /** A tick landed: the caller owns the data and re-reads it. */
  onChanged: (next: LotBoard) => void;
  onError: (message: string) => void;
}) {
  /** Ticks in flight, so a row cannot be clicked twice into a race. */
  const [busy, setBusy] = useState<Set<string>>(new Set());

  /**
   * Tick one item, and show it immediately.
   *
   * Optimistic because a packing floor works down a list at speed and a
   * round-trip per tick would be felt. The server's tally is authoritative and
   * replaces the guess when it lands; a failure puts the row back.
   */
  async function toggle(orderId: string, checkpoint: OrderCheckpoint, on: boolean) {
    const key = `${orderId}:${checkpoint}`;
    if (busy.has(key)) return;
    setBusy((current) => new Set(current).add(key));

    const before = board;
    onChanged({
      ...before,
      customers: before.customers.map((customer) => ({
        ...customer,
        orders: customer.orders.map((order) =>
          order.id === orderId
            ? { ...order, checkpoints: { ...order.checkpoints, [checkpoint]: on ? new Date().toISOString() : null } }
            : order,
        ),
      })),
    });

    try {
      const result = await api.setCheckpoint(orderId, checkpoint, on);
      onChanged({ ...before, tally: result.tally });
    } catch (err) {
      onChanged(before);
      onError(err instanceof ApiRequestError ? err.message : 'Could not save that tick.');
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  const { tally } = board;
  const china = ORDER_CHECKPOINTS.filter((entry) => CHECKPOINT_SIDE[entry] === 'china');
  const india = ORDER_CHECKPOINTS.filter((entry) => CHECKPOINT_SIDE[entry] === 'india');

  return (
    <div className="stack">
      {/* Two bands, because the two sides of the water are worked by different
          people on different days. */}
      <div className="bands">
        <div className="band band--china">
          <span className="band__side">China</span>
          {china.map((checkpoint) => (
            <span key={checkpoint} className="band__count">
              <strong>{countOf(tally, checkpoint).done}</strong> {CHECKPOINT_LABELS[checkpoint].toLowerCase()}
            </span>
          ))}
        </div>
        <div className="band band--india">
          <span className="band__side">India</span>
          {india.map((checkpoint) => (
            <span key={checkpoint} className="band__count">
              <strong>{countOf(tally, checkpoint).done}</strong> {CHECKPOINT_LABELS[checkpoint].toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {board.customers.length === 0 ? (
        <EmptyState title="Nobody in this lot yet">
          Customers appear here as they buy the items tagged into it.
        </EmptyState>
      ) : (
        board.customers.map((customer) => (
          <CustomerCard key={customer.buyerId} customer={customer} busy={busy} onToggle={toggle} />
        ))
      )}
    </div>
  );
}

/** One customer's parcel: their orders, and the ticks that move them. */
function CustomerCard({ customer, busy, onToggle }: {
  customer: BoardCustomer;
  busy: Set<string>;
  onToggle: (orderId: string, checkpoint: OrderCheckpoint, on: boolean) => void | Promise<void>;
}) {
  const allReady = customer.orders.every((order) => Boolean(order.checkpoints.ready_to_dispatch));

  return (
    <article className="cust">
      <div className="cust__head">
        <span className="cust__name">{customer.name}</span>
        <span className="cust__meta">
          {customer.phone ?? 'No phone'} · {customer.orders.length}{' '}
          {customer.orders.length === 1 ? 'order' : 'orders'}
        </span>
        <span className="cust__track">
          {<Icon name="truck" size={19} />} {customer.trackingReference ?? 'None yet'}
        </span>
      </div>

      {/* One tick for the whole parcel, because that is how it is actually
          decided: everything of theirs is ready, or it is not. */}
      <label className="cust__all">
        <input
          type="checkbox"
          checked={allReady}
          onChange={(event) => {
            for (const order of customer.orders) {
              void onToggle(order.id, 'ready_to_dispatch', event.target.checked);
            }
          }}
        />
        <span>Ready to dispatch all {customer.orders.length}</span>
      </label>

      {customer.orders.map((order, index) => (
        <div key={order.id} className="orderrow">
          <div className="orderrow__top">
            <span className="orderrow__index">{index + 1}.</span>
            <span className="orderrow__item">{order.itemName}</span>
          </div>
          <div className="orderrow__meta">
            <span className="badge badge--solid">{order.condition}</span>
            <span className="faint">{formatWeight(order.unitWeightGrams * order.quantity)}</span>
            {order.quantity > 1 && <span className="faint">× {order.quantity}</span>}
          </div>
          <div className="orderrow__ticks">
            {ORDER_CHECKPOINTS.map((checkpoint) => {
              const on = Boolean(order.checkpoints[checkpoint]);
              const key = `${order.id}:${checkpoint}`;
              return (
                <label key={checkpoint} className={`tick${on ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy.has(key)}
                    onChange={(event) => void onToggle(order.id, checkpoint, event.target.checked)}
                  />
                  <span>{CHECKPOINT_LABELS[checkpoint]}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </article>
  );
}
