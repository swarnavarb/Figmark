import { LOT_PHASE_LABELS, type LotBuyerPhase } from '@shared/fulfilment';

/**
 * A lot as people say it: its name, then the number the shop gave it, small
 * and quiet beside it. The name is what a seller recognises; the number is
 * for telling two with similar names apart.
 */
export function LotName({ name, number, className }: {
  name: string;
  number?: number | string | null;
  className?: string;
}) {
  return (
    <span className={`lotname${className ? ` ${className}` : ''}`}>
      <span className="lotname__name">{name}</span>
      {number ? <span className="lotname__no">LOT {number}</span> : null}
    </span>
  );
}

/** The same, as plain words, for messages and labels. */
export function lotLabel(lot: { name: string; lotNumber?: number | string | null }): string {
  return lot.lotNumber ? `${lot.name} (LOT ${lot.lotNumber})` : lot.name;
}

/** The lot as its buyers see it: one word-picture of where the box is. */
const PHASE_ICON: Record<LotBuyerPhase, string> = {
  filling: '📥',
  closed: '📦',
  in_transit: '🚚',
  received: '🏁',
  delivered: '✅',
  cancelled: '✖',
};

export function LotPhaseBadge({ phase }: { phase: LotBuyerPhase }) {
  return (
    <span className={`lotphase lotphase--${phase}`}>
      <span aria-hidden="true">{PHASE_ICON[phase]}</span> {LOT_PHASE_LABELS[phase]}
    </span>
  );
}
