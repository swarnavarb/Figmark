import type { LotCostModel } from './models.js';

/**
 * What a lot's shared costs come to per item.
 *
 * Freight, duty, packing, the forwarder's fee and the last mile are paid once
 * for the whole run, but a seller prices and judges each item on its own. This
 * splits the run's costs across the items in it - by weight when every item
 * has one, otherwise by what each sold for, or evenly per unit - and adds the
 * item's own cost where its listing carries a cost sheet, so the seller reads
 * a landed cost and a margin per buyer instead of working it out on paper.
 *
 * One function for the screen and the tests, so the per-item shares always add
 * back up to the total the seller typed: the rounding remainder goes to the
 * largest share rather than vanishing.
 */

export type LotSplit = NonNullable<LotCostModel['splitBy']>;

export const LOT_COST_FIELDS = [
  { key: 'freightMinor', label: 'Freight' },
  { key: 'customsDutyMinor', label: 'Customs duty' },
  { key: 'forwarderFeeMinor', label: 'Forwarder fee' },
  { key: 'packagingMinor', label: 'Packing' },
  { key: 'localShippingMinor', label: 'Last-mile shipping' },
] as const;

export type LotCostKey = (typeof LOT_COST_FIELDS)[number]['key'];

/** Everything the run cost to move, in paise. Goods are not in it: each item's own cost is. */
export function sharedCostMinor(model: Partial<LotCostModel> | null | undefined): number {
  if (!model) return 0;
  return LOT_COST_FIELDS.reduce((sum, field) => sum + Math.max(0, Math.round(model[field.key] ?? 0)), 0);
}

export interface LotCostLine {
  orderId: string;
  itemName: string;
  buyerName: string;
  quantity: number;
  /** What the buyer pays for this line, in paise. */
  revenueMinor: number;
  /** Per unit; zero when not known. */
  unitWeightGrams: number;
  /** The item's own cost per unit from its listing's cost sheet, or null when it has none. */
  unitCostMinor: number | null;
}

export interface LotCostRow extends LotCostLine {
  /** This line's part of the run's shared costs. */
  shareMinor: number;
  /** Own cost (when known) plus share. */
  landedMinor: number;
  /** Revenue less landed cost. */
  marginMinor: number;
}

/** Weight only splits fairly when every line has one; otherwise price does. */
export function effectiveSplit(asked: LotSplit | undefined, lines: readonly LotCostLine[]): LotSplit {
  if (asked === 'weight' && lines.length > 0 && lines.every((line) => line.unitWeightGrams > 0)) return 'weight';
  if (asked === 'units') return 'units';
  return 'value';
}

export function splitLotCosts(
  model: Partial<LotCostModel> | null | undefined,
  lines: readonly LotCostLine[],
): { split: LotSplit; sharedMinor: number; rows: LotCostRow[]; totals: { revenueMinor: number; landedMinor: number; marginMinor: number; unknownCost: number } } {
  const split = effectiveSplit(model?.splitBy, lines);
  const sharedMinor = sharedCostMinor(model);
  const weightOf = (line: LotCostLine) =>
    split === 'weight' ? line.unitWeightGrams * line.quantity
      : split === 'units' ? line.quantity
        : line.revenueMinor;
  const totalWeight = lines.reduce((sum, line) => sum + Math.max(0, weightOf(line)), 0);
  const shares = lines.map((line) => (totalWeight > 0
    ? Math.floor((sharedMinor * Math.max(0, weightOf(line))) / totalWeight)
    : lines.length > 0 ? Math.floor(sharedMinor / lines.length) : 0));
  // The paise lost to rounding go to the biggest share, so the column adds up.
  const left = sharedMinor - shares.reduce((sum, share) => sum + share, 0);
  if (left > 0 && shares.length > 0) {
    const biggest = shares.indexOf(Math.max(...shares));
    shares[biggest] = shares[biggest]! + left;
  }
  const rows = lines.map((line, index) => {
    const shareMinor = shares[index] ?? 0;
    const landedMinor = shareMinor + (line.unitCostMinor ?? 0) * line.quantity;
    return { ...line, shareMinor, landedMinor, marginMinor: line.revenueMinor - landedMinor };
  });
  return {
    split,
    sharedMinor,
    rows,
    totals: {
      revenueMinor: rows.reduce((sum, row) => sum + row.revenueMinor, 0),
      landedMinor: rows.reduce((sum, row) => sum + row.landedMinor, 0),
      marginMinor: rows.reduce((sum, row) => sum + row.marginMinor, 0),
      unknownCost: rows.filter((row) => row.unitCostMinor === null).length,
    },
  };
}

/** A costs body from the browser, made safe: whole paise, nothing negative, nothing absurd. */
export function cleanLotCosts(value: unknown, now: string): Partial<LotCostModel> | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const out: Partial<LotCostModel> = {};
  for (const field of LOT_COST_FIELDS) {
    const amount = Math.round(Number(body[field.key] ?? 0));
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_00) return null;
    out[field.key] = amount;
  }
  const split = body.splitBy;
  out.splitBy = split === 'weight' || split === 'units' ? split : 'value';
  out.costedAt = now;
  return out;
}
