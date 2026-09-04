import { LOT_STAGES, LOT_STAGE_LABELS } from '@shared/enums';
import type { AuthUser } from '@shared/contracts';
import type { Lot, Order } from '@shared/models';
import type { ManifestTotals } from '../api';
import { daysUntil, formatDate, formatMoney, formatWeight } from '../format';

interface Props {
  lots: Lot[];
  user: AuthUser | null;
  manifest: { lot: Lot; orders: Order[]; totals: ManifestTotals } | null;
  manifestError: string | null;
  onOpenManifest: (lot: Lot) => void;
  onCloseManifest: () => void;
}

/**
 * The buyer-facing view of a lot plus the seller-facing manifest behind it -
 * the two halves of the lot workflow, sharing one stage timeline.
 */
export function LotsPanel({
  lots,
  user,
  manifest,
  manifestError,
  onOpenManifest,
  onCloseManifest,
}: Props) {
  if (manifest) {
    return <Manifest {...manifest} onClose={onCloseManifest} />;
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Lots</h2>
        <span className="muted">{lots.length} seeded</span>
      </div>

      {manifestError && <p className="status status--bad">{manifestError}</p>}

      <ul className="lots">
        {lots.map((lot) => {
          const fill = Math.min(100, Math.round((lot.filledCount / lot.fillThreshold) * 100));
          // Mirrors the server rule: the owner, or an admin reading across owners.
          const canOpen = user?.capabilities.isAdmin === true || user?.id === lot.sellerId;

          return (
            <li key={lot.id} className="lot">
              <div className="lot__head">
                <h3>{lot.name}</h3>
                <span className={`badge badge--${lot.status === 'open' ? 'ok' : 'muted'}`}>
                  {lot.status}
                </span>
              </div>

              <p className="muted">{lot.description}</p>

              <div className="meter" role="img" aria-label={`${fill}% filled`}>
                <div className="meter__fill" style={{ width: `${fill}%` }} />
              </div>
              <p className="lot__meta">
                <strong>
                  {lot.filledCount}/{lot.fillThreshold}
                </strong>{' '}
                units · {fill}% filled
                {lot.status === 'open' && <> · closes in {daysUntil(lot.cutoffAt)} days</>}
              </p>

              <StageTrack stage={lot.stage} />

              <p className="lot__meta muted">
                Landed cost basis {formatMoney(landedCost(lot), lot.costModel.currency)} ·{' '}
                {formatWeight(lot.costModel.totalWeightGrams)}
                {lot.estimatedDispatchAt && <> · est. dispatch {formatDate(lot.estimatedDispatchAt)}</>}
              </p>

              {lot.forwarder && (
                <p className="lot__meta muted">
                  Forwarder {lot.forwarder.name}
                  {lot.forwarder.forwarderUserId === null && ' (off-platform)'}
                  {lot.forwarder.trackingReference && ` · ${lot.forwarder.trackingReference}`}
                </p>
              )}

              {canOpen && (
                <button type="button" className="button button--ghost" onClick={() => onOpenManifest(lot)}>
                  View manifest
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Total cost of getting the batch to a domestic buyer's door. */
function landedCost(lot: Lot): number {
  const c = lot.costModel;
  return c.goodsCostMinor + c.freightMinor + c.customsDutyMinor + c.packagingMinor + c.localShippingMinor;
}

/** The buyer-visible fulfilment timeline. */
function StageTrack({ stage }: { stage: Lot['stage'] }) {
  const current = LOT_STAGES.indexOf(stage);

  return (
    <ol className="track">
      {LOT_STAGES.map((entry, index) => (
        <li
          key={entry}
          className={`track__step ${index < current ? 'is-done' : ''} ${
            index === current ? 'is-current' : ''
          }`}
          title={LOT_STAGE_LABELS[entry]}
        >
          <span className="track__dot" aria-hidden="true" />
          <span className="track__label">{LOT_STAGE_LABELS[entry]}</span>
        </li>
      ))}
    </ol>
  );
}

function Manifest({
  lot,
  orders,
  totals,
  onClose,
}: {
  lot: Lot;
  orders: Order[];
  totals: ManifestTotals;
  onClose: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Manifest</h2>
          <p className="panel__subject">{lot.name}</p>
        </div>
        <button type="button" className="button button--ghost" onClick={onClose}>
          Back to lots
        </button>
      </div>

      <p className="muted">
        {totals.lines} lines · {totals.units} units · {formatWeight(totals.weightGrams)} ·{' '}
        {formatMoney(totals.valueMinor, 'INR')}
      </p>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Item</th>
              <th scope="col">Cond.</th>
              <th scope="col">Qty</th>
              <th scope="col">Weight</th>
              <th scope="col">Payment</th>
              <th scope="col">Escrow</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="mono">{order.id}</td>
                <td>{order.itemName}</td>
                <td>
                  <span className="tag">{order.condition}</span>
                </td>
                <td>{order.quantity}</td>
                <td>{formatWeight(order.quantity * order.unitWeightGrams)}</td>
                <td>{order.paymentStatus.replace(/_/g, ' ')}</td>
                <td>{order.escrow.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
