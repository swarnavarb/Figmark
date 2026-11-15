import { useEffect, useState } from 'react';
import { dayRangeLabel, type DayRange, type DaySource, type ShopDays } from '@shared/step-days';
import { api } from '../api';

/**
 * How long a step usually takes, as the system measured it: "3–5 days", and
 * "Market trend" when it is every shop's history rather than this one's.
 * Nobody types it, so nobody can make it read better than it is.
 */
export function DaysChip({ range, lead, className = '' }: {
  range: Pick<DayRange, 'low' | 'high' | 'source'>;
  /** Words before the range: "Usually", "About … to go". */
  lead?: string;
  className?: string;
}) {
  return (
    <span className={`dayschip${range.source === 'market' ? ' dayschip--market' : ''}${className ? ` ${className}` : ''}`}
      title={range.source === 'market'
        ? 'Worked out from how long this step takes for other shops - this shop has no history of its own for it yet.'
        : "Worked out from how long this step has taken on this shop's own lots, leaving out the odd delay."}>
      <span aria-hidden="true">⏱</span>
      {lead ? `${lead} ` : ''}{dayRangeLabel(range)}
      {range.source === 'market' && <span className="dayschip__src">Market trend</span>}
    </span>
  );
}

export function sourceNote(source: DaySource): string {
  return source === 'market' ? 'Market trend' : 'From your past orders';
}

const loaded = new Map<string, Promise<ShopDays | null>>();

/** A shop's measured step and delivery times, read once per page load. */
export function useShopDays(sellerId: string | null | undefined): ShopDays | null {
  const [days, setDays] = useState<ShopDays | null>(null);
  useEffect(() => {
    if (!sellerId) return;
    let live = true;
    let work = loaded.get(sellerId);
    if (!work) {
      work = api.stepDays(sellerId).catch(() => null);
      loaded.set(sellerId, work);
    }
    void work.then((value) => { if (live) setDays(value); });
    return () => { live = false; };
  }, [sellerId]);
  return days;
}
