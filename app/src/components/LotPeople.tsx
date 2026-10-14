import { useState } from 'react';
import {
  CHECKPOINT_LABELS,
  CHECKPOINT_SIDE,
  ORDER_CHECKPOINTS,
  type OrderCheckpoint,
} from '@shared/enums';
import { countOf } from '@shared/board';
import type { OrderPhoto, PhotoAudience } from '@shared/models';
import { ApiRequestError, api, type BoardCustomer, type LotBoard } from '../api';
import { EmptyState, Icon } from './ui';
import { formatWeight } from '../format';
import { useUndo } from './Undo';
import { OrderPhotos } from './OrderPhotos';
import { ConditionTag } from './ConditionTag';
import { Spinner } from './Spinner';

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
  const offerUndo = useUndo();
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
    await toggleMany([orderId], checkpoint, on);
  }

  /**
   * Several items at once - a whole parcel made ready - as one optimistic
   * change, so the presses cannot each start from the same stale board and
   * leave only the last one showing.
   */
  async function toggleMany(orderIds: string[], checkpoint: OrderCheckpoint, on: boolean) {
    const keys = orderIds.map((orderId) => `${orderId}:${checkpoint}`);
    if (keys.some((key) => busy.has(key))) return;
    setBusy((current) => new Set([...current, ...keys]));

    const before = board;
    const stamp = on ? new Date().toISOString() : null;
    const optimistic: LotBoard = {
      ...before,
      customers: before.customers.map((customer) => ({
        ...customer,
        orders: customer.orders.map((order) =>
          orderIds.includes(order.id)
            ? { ...order, checkpoints: { ...order.checkpoints, [checkpoint]: stamp } }
            : order,
        ),
      })),
    };
    onChanged(optimistic);

    try {
      let latest = before.tally;
      let undo: { id: string; until: string } | undefined;
      for (const orderId of orderIds) {
        const result = await api.setCheckpoint(orderId, checkpoint, on);
        latest = result.tally;
        undo = result.undo;
      }
      onChanged({ ...optimistic, tally: latest });
      // One press, one undo: a parcel's worth is put right from the board.
      if (undo && orderIds.length === 1) {
        const orderId = orderIds[0]!;
        const tag = undo;
        offerUndo({
          label: 'Tick saved',
          until: tag.until,
          undo: async () => {
            const back = await api.setCheckpoint(orderId, checkpoint, !on, undefined, tag.id);
            onChanged({ ...before, tally: back.tally });
          },
        });
      }
    } catch (err) {
      onChanged(before);
      onError(err instanceof ApiRequestError ? err.message : 'Could not save that tick.');
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        keys.forEach((key) => next.delete(key));
        return next;
      });
    }
  }

  const { tally } = board;
  const china = ORDER_CHECKPOINTS.filter((entry) => CHECKPOINT_SIDE[entry] === 'china');
  const india = ORDER_CHECKPOINTS.filter((entry) => CHECKPOINT_SIDE[entry] === 'india');
  // The buyer always; the crew only where somebody is tagged to see it.
  const audiences: PhotoAudience[] = [
    'buyer',
    ...(board.crew?.supplier ? ['supplier' as const] : []),
    ...(board.crew?.handler ? ['handler' as const] : []),
  ];

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
          <CustomerCard key={customer.buyerId} customer={customer} busy={busy} onToggle={toggle} onToggleAll={toggleMany}
            handlerName={board.crew?.handlerName ?? null} audiences={audiences}
            onPhotos={(orderId, photos) => onChanged({
              ...board,
              customers: board.customers.map((each) => ({
                ...each,
                orders: each.orders.map((order) => (order.id === orderId ? { ...order, photos } : order)),
              })),
            })} />
        ))
      )}
    </div>
  );
}

/** One customer's parcel: their orders, and the ticks that move them. */
function CustomerCard({ customer, busy, onToggle, onToggleAll, handlerName, audiences, onPhotos }: {
  customer: BoardCustomer;
  busy: Set<string>;
  onToggle: (orderId: string, checkpoint: OrderCheckpoint, on: boolean) => void | Promise<void>;
  onToggleAll: (orderIds: string[], checkpoint: OrderCheckpoint, on: boolean) => void | Promise<void>;
  /** Who Ready to dispatch tells to send it, when the lot names one. */
  handlerName: string | null;
  audiences: PhotoAudience[];
  onPhotos: (orderId: string, photos: OrderPhoto[]) => void;
}) {
  /* Only what has reached the destination can be cleared to go. */
  const here = customer.orders.filter((order) => order.arrived !== false);
  const allReady = here.length > 0 && here.every((order) => Boolean(order.checkpoints.ready_to_dispatch));
  const waiting = customer.orders.length - here.length;
  /** The items a ready press changes: the ones not yet in the state it asks for. */
  /** Their ready press is on its way to the server. */
  const saving = customer.orders.some((order) => busy.has(`${order.id}:ready_to_dispatch`));
  const readyIds = (on: boolean) => here
    .filter((order) => Boolean(order.checkpoints.ready_to_dispatch) !== on).map((order) => order.id);

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

      {/* One press for the whole parcel, because that is how it is actually
          decided: everything of theirs is ready, or it is not. It is the
          seller's go-ahead, and the handler cannot dispatch before it. */}
      <button type="button" className={`cust__ready${allReady ? ' is-on' : ''}`} aria-pressed={allReady}
        aria-busy={saving} disabled={saving || here.length === 0}
        onClick={() => void onToggleAll(readyIds(!allReady), 'ready_to_dispatch', !allReady)}>
        {saving && <Spinner size={16} label="Saving" />}
        {saving ? 'Saving…' : here.length === 0 ? 'Not arrived yet' : allReady
          ? `✓ Ready to dispatch${waiting ? ` (${here.length} of ${customer.orders.length})` : ''}`
          : here.length > 1
            ? `Ready to dispatch ${waiting ? `${here.length} of ${customer.orders.length}` : `all ${here.length}`} orders`
            : waiting ? `Ready to dispatch 1 of ${customer.orders.length} orders` : 'Ready to dispatch'}
        <span>
          {here.length === 0
            ? 'You can mark it ready once it reaches the destination.'
            : allReady
            ? `${handlerName ?? 'The handler'} can dispatch ${waiting ? 'what has arrived' : 'this parcel'}. Press again to hold it.`
            : `Tells ${handlerName ? `your domestic handler, ${handlerName},` : 'your domestic handler'} to dispatch ${customer.orders.length > 1 ? 'them' : 'it'} to ${customer.name}.`}
        </span>
      </button>

      {customer.orders.map((order, index) => (
        <div key={order.id} className="orderrow">
          <div className="orderrow__top">
            <span className="orderrow__index">{index + 1}.</span>
            <span className="orderrow__item">{order.itemName}</span>
          </div>
          <div className="orderrow__meta">
            <ConditionTag condition={order.condition} />
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
          <OrderPhotos orderId={order.id} photos={order.photos ?? []} seller audiences={audiences}
            onChange={(photos) => onPhotos(order.id, photos)} />
        </div>
      ))}
    </article>
  );
}
