import { useState, type ReactNode } from 'react';
import { isDirect } from '@shared/fulfilment';
import { isStopped } from '@shared/orders';
import { ApiRequestError, api, type OrderState } from '../api';
import { formatDate } from '../format';
import { ShipmentChip } from './OrderStatus';
import { ErrorNotice, Modal } from './ui';
import type { TrackStyle } from './trackStyle';

/** The id the "update this item" links scroll to. */
export const ITEM_DISPATCH_ID = 'item-dispatch';

/**
 * The seller's own last-mile controls for one item.
 *
 * One card, whichever way the item came: off the shelf (in hand), or out of a
 * lot that has been unpacked. Both end the same way - a courier, an AWB, a
 * door - so both are worked with the same three moves in the same place, and
 * a seller who has done one has done the other.
 *
 * Marking dispatched starts the buyer-protection clock; marking delivered lets
 * the buyer add it to their collection and review it. Marking delivered never
 * releases held money - that stays with the buyer, a dispute, or the
 * auto-release window.
 */
export function ItemDispatch({ state, onDone, skin = 'classic', withLot }: {
  state: OrderState;
  onDone: () => void | Promise<void>;
  skin?: TrackStyle;
  /**
   * The lot an import is still riding, when it has not been unpacked yet.
   * Nothing is locked by it - a piece pulled out early still goes out - but
   * the card says so, because the usual next move is the lot's, not this.
   */
  withLot?: ReactNode;
}) {
  const { order } = state;
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  /** The courier-and-AWB dialog: opened to dispatch, or to fix the details after. */
  const [shipping, setShipping] = useState(false);
  const [courier, setCourier] = useState(order.shipment?.courier ?? '');
  const [awb, setAwb] = useState(order.shipment?.awb ?? '');
  const [error, setError] = useState<string | null>(null);

  if (state.side !== 'seller' || order.placedAt === null || isStopped(order.status)) return null;
  const inHand = isDirect(order);

  async function ship() {
    setBusy('ship');
    setError(null);
    try {
      await api.setCheckpoint(order.id, 'dispatched', true, { courier: courier.trim(), awb: awb.trim() });
      setShipping(false);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }
  const dispatched = Boolean(order.checkpoints?.dispatched);
  const delivered = order.status === 'delivered';
  const released = order.escrow.state === 'released';
  const held = order.escrow.state === 'held';
  const received = Boolean(order.receivedAt);

  async function tick(checkpoint: 'dispatched' | 'delivered', on: boolean) {
    setBusy(checkpoint);
    setError(null);
    try {
      await api.setCheckpoint(order.id, checkpoint, on);
      setAsking(false);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  const hint = delivered
    ? received
      ? `The buyer confirmed they received it on ${formatDate(order.receivedAt!)}.`
      : held
        ? `Delivered. Waiting for the buyer to confirm - that releases the payment${order.escrow.autoReleaseAt ? `, or it releases on ${formatDate(order.escrow.autoReleaseAt)}` : ''} if they raise no dispute.`
        : released
          ? 'Delivered, and the payment has been released.'
          : 'Delivered. Waiting for the buyer to confirm they received it.'
    : dispatched
      ? 'On its way. Mark it delivered once it reaches the buyer.'
      : `Mark it dispatched when it leaves you${held ? ` - that starts the ${state.autoReleaseDays}-day protection window` : ''}.`;

  const dialogs = (
    <>
      {shipping && (
        <Modal title={dispatched ? '🚚 Courier & AWB' : '📦 Dispatch it'} onClose={() => setShipping(false)}>
          <form className="stack" onSubmit={(event) => { event.preventDefault(); void ship(); }}>
            <p style={{ margin: 0 }}>
              {inHand
                ? 'Add the courier and AWB so the buyer can track their parcel.'
                : 'Add the courier and AWB for this parcel, if you have them.'}
            </p>
            <label className="field">
              <span>Courier name</span>
              <input value={courier} onChange={(event) => setCourier(event.target.value)} maxLength={80}
                placeholder="Delhivery, Blue Dart, DTDC…" autoFocus />
            </label>
            <label className="field">
              <span>AWB / tracking number</span>
              <input value={awb} onChange={(event) => setAwb(event.target.value)} maxLength={80}
                placeholder="e.g. 1234567890" inputMode="text" className="mono" />
            </label>
            {!dispatched && (
              <span className="field__hint">
                No AWB yet? Dispatch now and add it later.
                {held ? ` This starts the ${state.autoReleaseDays}-day protection window.` : ''}
              </span>
            )}
            {error && <ErrorNotice message={error} />}
            <button type="submit" className="btn btn--block"
              disabled={busy !== null || (dispatched && !courier.trim() && !awb.trim())}>
              {busy === 'ship' ? 'Saving…' : dispatched ? 'Save details' : '📦 Mark dispatched'}
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setShipping(false)}>Cancel</button>
          </form>
        </Modal>
      )}

      {asking && (
        <Modal title="Mark delivered?" onClose={() => setAsking(false)}>
          <div className="stack">
            <p style={{ margin: 0 }}>
              This tells <strong>{state.counterparty.name}</strong> that <strong>{order.itemName}</strong> has
              reached them. They can then add it to their collection and review the order.
              {held && ' It does not release the held payment - the buyer confirms that, or it releases on its own if they raise no dispute.'}
            </p>
            <button type="button" className="btn btn--block" disabled={busy !== null}
              onClick={() => void tick('delivered', true)}>
              {busy ? 'Marking…' : 'Mark delivered'}
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  );

  const origin = inHand
    ? <span className="dispatch__from">🏠 In hand · ships from your shelf</span>
    : <span className="dispatch__from">📦 Import · ships on its own once the lot is unpacked</span>;

  if (skin !== 'quest') {
    return (
      <div id={ITEM_DISPATCH_ID} className="card card--pad stack dispatch" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--t-md)' }}>🚚 Getting it to {state.counterparty.name}</h2>
        {origin}
        {withLot && <span className="dispatch__lot">{withLot}</span>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {!delivered && (
            <button type="button" className={`btn${dispatched ? ' btn--quiet' : ''}`} disabled={busy !== null}
              onClick={() => (dispatched ? void tick('dispatched', false) : setShipping(true))}>
              {busy === 'dispatched' ? 'Saving…' : dispatched ? '↩︎ Not dispatched yet' : '📦 Mark dispatched'}
            </button>
          )}
          {dispatched && (
            <button type="button" className="btn btn--quiet" disabled={busy !== null} onClick={() => setShipping(true)}>
              {order.shipment ? '✏️ Edit courier & AWB' : '➕ Add courier & AWB'}
            </button>
          )}
          {!delivered ? (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => setAsking(true)}>
              ✅ Mark delivered
            </button>
          ) : !received && !released ? (
            <button type="button" className="btn btn--quiet" disabled={busy !== null}
              onClick={() => void tick('delivered', false)}>
              {busy === 'delivered' ? 'Saving…' : '↩︎ Undo delivered'}
            </button>
          ) : (
            <span className="badge badge--ok">
              {received ? '📬 Buyer confirmed receipt' : 'Delivered'}{released ? ' · paid out' : ''}
            </span>
          )}
        </div>
        {order.shipment && <ShipmentChip shipment={order.shipment} />}
        <span className="field__hint">{hint}</span>
        {error && <ErrorNotice message={error} />}
        {dialogs}
      </div>
    );
  }

  /*
   * The quest layout: the same three moves as tiles on a track, each worth
   * something, the next one lit. Pressing a tile is the move - there is no
   * second row of buttons repeating them.
   */
  const stage = received ? 3 : delivered ? 2 : dispatched ? 1 : 0;
  const tiles: { key: string; icon: string; label: string; xp: number; state: 'done' | 'next' | 'locked'; onPress?: () => void; press?: string }[] = [
    {
      key: 'dispatch', icon: '📦', label: 'Dispatch', xp: 50,
      state: stage >= 1 ? 'done' : 'next',
      onPress: stage === 0 ? () => setShipping(true) : undefined, press: 'Add courier & AWB',
    },
    {
      key: 'deliver', icon: '✅', label: 'Delivered', xp: 50,
      state: stage >= 2 ? 'done' : 'next',
      onPress: stage < 2 ? () => setAsking(true) : undefined, press: 'Mark delivered',
    },
    {
      key: 'confirm', icon: '📬', label: 'Buyer confirms', xp: 100,
      state: stage >= 3 ? 'done' : 'locked',
    },
  ];
  const earned = tiles.filter((tile) => tile.state === 'done').reduce((sum, tile) => sum + tile.xp, 0);

  return (
    <div id={ITEM_DISPATCH_ID} className="card card--pad stack dispatch dispatch--quest" style={{ marginBottom: 20 }}>
      <div className="dispatch__head">
        <span>
          <span className="dispatch__eyebrow">Last-mile quest</span>
          <h2 className="dispatch__title">🚚 Get it to {state.counterparty.name}</h2>
        </span>
        <span className="dispatch__xp"><b>{earned}</b>/200 XP</span>
      </div>
      {origin}
      {withLot && <span className="dispatch__lot">{withLot}</span>}

      <ol className="dispatch__track">
        {tiles.map((tile, index) => {
          const current = tile.state === 'next' && tiles.slice(0, index).every((before) => before.state === 'done');
          const body = (
            <>
              <span className="dispatch__tile-icon" aria-hidden="true">{tile.state === 'done' ? '✔' : tile.state === 'locked' ? '🔒' : tile.icon}</span>
              <span className="dispatch__tile-label">{tile.label}</span>
              <span className="dispatch__tile-xp">+{tile.xp} XP</span>
            </>
          );
          return (
            <li key={tile.key} className={`dispatch__tile is-${tile.state}${current ? ' is-current' : ''}`}>
              {tile.onPress ? (
                <button type="button" disabled={busy !== null} onClick={tile.onPress}
                  aria-label={`${tile.press} (+${tile.xp} XP)`}>
                  {body}
                </button>
              ) : <span className="dispatch__tile-static">{body}</span>}
            </li>
          );
        })}
      </ol>

      {order.shipment && <ShipmentChip shipment={order.shipment} />}
      <div className="dispatch__acts">
        {dispatched && !delivered && (
          <button type="button" className="ladder__act" disabled={busy !== null} onClick={() => setShipping(true)}>
            {order.shipment ? '✏️ Edit courier & AWB' : '➕ Add courier & AWB'}
          </button>
        )}
        {dispatched && !delivered && (
          <button type="button" className="ladder__act" disabled={busy !== null}
            onClick={() => void tick('dispatched', false)}>
            {busy === 'dispatched' ? 'Saving…' : '↩︎ Not dispatched yet'}
          </button>
        )}
        {delivered && !received && !released && (
          <button type="button" className="ladder__act" disabled={busy !== null}
            onClick={() => void tick('delivered', false)}>
            {busy === 'delivered' ? 'Saving…' : '↩︎ Undo delivered'}
          </button>
        )}
        {released && <span className="badge badge--ok">💸 Paid out</span>}
      </div>
      <span className="field__hint">{hint}</span>
      {error && <ErrorNotice message={error} />}
      {dialogs}
    </div>
  );
}
