import { lotNo } from '@shared/routes';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '../components/ScrollManager';
import { LOT_CARD_LABELS } from '@shared/enums';
import { ApiRequestError, api, type LotBoard } from '../api';
import { PageError } from '../components/ui';
import { LotPeople } from '../components/LotPeople';
import { PageLoading } from '../components/Feedback';
import '../styles/LotBoardPage.css';

/**
 * The packing board: one lot, worked customer by customer.
 *
 * The board itself lives in `LotPeople`, because the lot's own screen shows
 * the same thing under People - and a packing floor and a seller looking at
 * the same lot must never be shown two different answers about whose parcel
 * is whose.
 */
export function LotBoardPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const storeId = params.get('store') ?? undefined;

  const [data, setData] = useState<LotBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.lotBoard(id, storeId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this lot.');
    }
  }, [id, storeId]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <PageError message={error} />;
  if (!data) return <PageLoading />;

  const { lot, tally } = data;

  return (
    <main className="page tab-view">
      <BackLink to="/shop?tab=lots">Track</BackLink>

      <div className="lothead">
        <span className="lothead__name">{lot.name}</span>
        {lot.lotNumber && <span className="lothead__no">LOT {lotNo(lot.lotNumber)}</span>}
        <span className="badge">{tally.customers} cust</span>
        <span className="badge">{tally.orders} orders</span>
        <span className="faint">{LOT_CARD_LABELS[lot.stage as keyof typeof LOT_CARD_LABELS]}</span>
      </div>

      <LotPeople board={data} onChanged={setData} onError={setError} />
    </main>
  );
}
