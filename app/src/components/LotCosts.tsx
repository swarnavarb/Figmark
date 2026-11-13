import { useMemo, useState } from 'react';
import { LOT_COST_FIELDS, splitLotCosts, type LotCostKey, type LotCostLine, type LotSplit } from '@shared/lot-costs';
import { isStopped } from '@shared/orders';
import { sheetTotal } from '@shared/profit';
import { orderTotalMinor } from '@shared/service-stores';
import type { Listing, Lot, Order } from '@shared/models';
import { ApiRequestError, api, type LotItem } from '../api';
import { formatMoney } from '../format';
import { ErrorNotice } from './ui';
import '../styles/LotCosts.css';

const SPLITS: { id: LotSplit; label: string }[] = [
  { id: 'value', label: 'By price' },
  { id: 'weight', label: 'By weight' },
  { id: 'units', label: 'Per unit' },
];

/**
 * The lot's shared costs, typed once, and what they make each item cost.
 *
 * Freight and duty arrive as one bill for the whole run; this is where they
 * stop being a number on paper and become a landed cost and a margin beside
 * every buyer's item. An item whose listing carries a cost sheet counts its
 * own price too; one without says so instead of pretending it was free.
 */
export function LotCostCard({ lot, orders, listings, items, onSaved }: {
  lot: Lot;
  orders: readonly Order[];
  listings: readonly Listing[];
  items: readonly LotItem[];
  onSaved: () => void;
}) {
  const model = lot.costModel;
  const [draft, setDraft] = useState<Record<LotCostKey, string>>(() => Object.fromEntries(
    LOT_COST_FIELDS.map((field) => [field.key, model?.[field.key] ? String(model[field.key]! / 100) : '']),
  ) as Record<LotCostKey, string>);
  const [split, setSplit] = useState<LotSplit>(model?.splitBy ?? 'value');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const lines = useMemo<LotCostLine[]>(() => {
    const byListing = new Map(listings.map((listing) => [listing.id, listing]));
    const names = new Map(items.map((item) => [item.id, item.buyerName]));
    return orders.filter((order) => !isStopped(order.status)).map((order) => {
      const sheet = byListing.get(order.listingId)?.costSheet;
      return {
        orderId: order.id,
        itemName: order.itemName,
        buyerName: names.get(order.id) ?? 'Buyer',
        quantity: order.quantity,
        revenueMinor: orderTotalMinor(order),
        unitWeightGrams: order.unitWeightGrams ?? 0,
        unitCostMinor: sheet && sheet.steps.length > 0 ? sheetTotal(sheet) : null,
      };
    });
  }, [orders, listings, items]);

  const typed = Object.fromEntries(LOT_COST_FIELDS.map((field) => {
    const rupees = Number(draft[field.key] || 0);
    return [field.key, Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : 0];
  })) as Record<LotCostKey, number>;
  const result = splitLotCosts({ ...typed, splitBy: split }, lines);
  const currency = model?.currency ?? 'INR';
  const money = (minor: number) => formatMoney(minor, currency);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateLotDetails(lot.id, { costs: { ...typed, splitBy: split } });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the costs.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card--pad stack lotcost">
      <div className="row row--between">
        <div>
          <h2>Costs &amp; margin</h2>
          <span className="field__hint">
            The run&apos;s bills, split across its items: what each one really cost you to land, and what you keep.
          </span>
        </div>
      </div>

        <div className="lotcost__fields">
          {LOT_COST_FIELDS.map((field) => (
            <label key={field.key} className="field lotcost__field">
              <span>{field.label}</span>
              <span className="lotcost__money">
                <span aria-hidden="true">₹</span>
                <input inputMode="decimal" value={draft[field.key]} placeholder="0"
                  onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, [field.key]: event.target.value.replace(/[^\d.]/g, '') })); }} />
              </span>
            </label>
          ))}
        </div>

        <div className="lotcost__split" role="radiogroup" aria-label="Split the costs">
          <span>Split</span>
          {SPLITS.map((entry) => (
            <button key={entry.id} type="button" role="radio" aria-checked={split === entry.id}
              className={`chip${split === entry.id ? ' is-on' : ''}`} onClick={() => { setSaved(false); setSplit(entry.id); }}>
              {entry.label}
            </button>
          ))}
          {split === 'weight' && result.split !== 'weight' && (
            <span className="faint">Some items have no weight, so this splits by price.</span>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="muted">No orders in this lot yet - the split appears as they come in.</p>
        ) : (
          <div className="lotcost__table" role="table" aria-label="Landed cost per item">
            <div className="lotcost__row lotcost__row--head" role="row">
              <span role="columnheader">Item</span>
              <span role="columnheader">Sold for</span>
              <span role="columnheader">Lot share</span>
              <span role="columnheader">Landed</span>
              <span role="columnheader">Margin</span>
            </div>
            {result.rows.map((row) => (
              <div key={row.orderId} className="lotcost__row" role="row">
                <span role="cell" className="lotcost__item">
                  <b>{row.itemName}</b>{row.quantity > 1 ? ` ×${row.quantity}` : ''}
                  <small>{row.buyerName}{row.unitCostMinor === null ? ' · item cost not set' : ''}</small>
                </span>
                <span role="cell" data-label="Sold for">{money(row.revenueMinor)}</span>
                <span role="cell" data-label="Lot share">{money(row.shareMinor)}</span>
                <span role="cell" data-label="Landed">{money(row.landedMinor)}</span>
                <span role="cell" data-label="Margin" className={row.marginMinor < 0 ? 'is-loss' : 'is-gain'}>{money(row.marginMinor)}</span>
              </div>
            ))}
            <div className="lotcost__row lotcost__row--total" role="row">
              <span role="cell">Whole lot</span>
              <span role="cell" data-label="Sold for">{money(result.totals.revenueMinor)}</span>
              <span role="cell" data-label="Lot share">{money(result.sharedMinor)}</span>
              <span role="cell" data-label="Landed">{money(result.totals.landedMinor)}</span>
              <span role="cell" data-label="Margin" className={result.totals.marginMinor < 0 ? 'is-loss' : 'is-gain'}>{money(result.totals.marginMinor)}</span>
            </div>
          </div>
        )}
        {result.totals.unknownCost > 0 && (
          <p className="field__hint">
            {result.totals.unknownCost === 1 ? '1 item has' : `${result.totals.unknownCost} items have`} no cost sheet on
            its listing, so its margin is before what the item itself cost you. Add one from the listing&apos;s Edit.
          </p>
        )}

        {error && <ErrorNotice message={error} />}
        <div className="row row--tight">
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save costs'}
          </button>
          {saved && <span className="faint" role="status">Saved. Only you see these.</span>}
        </div>
    </div>
  );
}
