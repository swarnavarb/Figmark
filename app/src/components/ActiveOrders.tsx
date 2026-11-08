import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ItemGroup } from '../api';
import { useSession } from '../session';
import { Thumb } from './ui';

type Row = ItemGroup['items'][number] & { sellerName: string };

/** One line on where it is, and the action word first when one is waiting on the buyer. */
function stateOf(item: Row): { text: string; act: boolean } {
  if (item.canPay) return { text: 'Pay now', act: true };
  if (item.canConfirm) return { text: 'Arrived? Confirm', act: true };
  if (item.disputed) return { text: 'In dispute', act: false };
  if (item.shipment) return { text: 'On its way 🚚', act: false };
  if (item.inHand) return { text: 'With the seller', act: false };
  if (!item.accepted) return { text: 'Waiting for seller', act: false };
  return { text: 'In progress', act: false };
}

/**
 * The buyer's orders still on their way, at the top of Shop.
 *
 * After paying, the one question is "where is it?" - and the answer used to
 * be two taps into the profile menu. Shown only when there is something in
 * flight; anything waiting on the buyer (pay, confirm) is marked and first.
 */
export function ActiveOrders() {
  const { user } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!user) { setRows(null); return; }
    let live = true;
    api.myItems()
      .then(({ groups }) => {
        if (!live) return;
        const open = groups.flatMap((group) => group.items.map((item) => ({ ...item, sellerName: group.sellerName })))
          .filter((item) => item.placed && !item.deliveredAt && !item.closure
            && !['cancelled', 'refunded', 'rejected', 'delivered', 'payment_reversal_pending', 'cancelled_reversed'].includes(item.status));
        open.sort((a, b) => Number(stateOf(b).act) - Number(stateOf(a).act) || b.createdAt.localeCompare(a.createdAt));
        setRows(open.slice(0, 10));
      })
      .catch(() => live && setRows([]));
    return () => { live = false; };
  }, [user]);

  if (!rows || rows.length === 0) return null;
  return (
    <section className="actord" aria-label="Your orders on the way">
      <div className="actord__head">
        <h2>Your orders</h2>
        <Link to="/purchases" className="actord__all">See all ›</Link>
      </div>
      <div className="actord__row">
        {rows.map((item) => {
          const state = stateOf(item);
          return (
            <Link key={item.id} to={`/order/${item.id}`} state={{ from: '/' }}
              className={`actord__card${state.act ? ' is-act' : ''}`}>
              <Thumb seed={item.listingId} label={item.itemName} photo={item.photo ? { url: item.photo } : null} className="actord__thumb" />
              <span className="actord__text">
                <b>{item.itemName}</b>
                <small>{state.act && <span className="actord__dot" aria-hidden="true" />}{state.text}</small>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
