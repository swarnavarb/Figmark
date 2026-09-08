import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LOT_CARD_LABELS } from '@shared/enums';
import { countOf } from '@shared/board';
import { ApiRequestError, api, type ExporterItem, type ExporterLot, type ExporterStore } from '../api';
import { EmptyState, ErrorNotice, Icon, Tile } from '../components/ui';
import { formatWeight } from '../format';

/**
 * The supplier's side of a lot.
 *
 * Someone abroad packing a crate needs one thing: the list of pieces going into
 * it, and a way to say each one is in. So this is a flat grid of items with a
 * single button on each — no customers, no prices, no checkpoints beyond their
 * own. What they tick shows up on the owner's board as "ch packed", which is
 * the whole point of giving them a way in.
 */
export function ExporterPage() {
  return (
    <main className="page tab-view">
      <div className="page__head">
        <div>
          <h1>Packing</h1>
          <p className="muted">Lots you pack for. Open one to work through it piece by piece.</p>
        </div>
      </div>
      <PackingList />
    </main>
  );
}

/**
 * The lots waiting on a packer.
 *
 * Also the sell tab's Packing section, hence the store filter: from inside one
 * shop's console the other shops you pack for are noise.
 */
export function PackingList({ storeId }: { storeId?: string } = {}) {
  const [rows, setRows] = useState<
    { store: ExporterStore; lot: ExporterLot['lot']; tally: ExporterLot['tally'] }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .exporterLots()
      .then((result) =>
        setRows(storeId ? result.lots.filter((row) => row.store.ownerId === storeId) : result.lots),
      )
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your lots.'),
      );
  }, [storeId]);

  if (error) return <ErrorNotice message={error} />;
  if (!rows) return <p className="muted">Loading…</p>;

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState title="No lots to pack">
          A shop owner gives you packing access from their People screen, and their open lots appear here.
        </EmptyState>
      ) : (
        <div className="stack">
          {rows.map((row) => {
            const packed = countOf(row.tally, 'china_packed');
            return (
              <div key={row.lot.id} className="lotcard">
                <div className="lotcard__head">
                  <span className="lotcard__name">{row.lot.name}</span>
                  <span className="lotcard__state">
                    {/* Inside one shop's console the shop's own name on every
                        card is noise; across shops it is the thing you need. */}
                    {storeId ? '' : `${row.store.name} — `}
                    {LOT_CARD_LABELS[row.lot.stage as keyof typeof LOT_CARD_LABELS]}
                  </span>
                  <Link
                    to={`/packing/${encodeURIComponent(row.lot.id)}`}
                    className="lotcard__go"
                    aria-label={`Pack ${row.lot.name}`}
                  >
                    →
                  </Link>
                </div>

                <div className="lotcard__body">
                  <div className="tiles tiles--big">
                    <Tile value={String(packed.total)} label="Items" />
                    <Tile value={`${packed.done}/${packed.total}`} label="Packed" />
                  </div>
                  {row.lot.origin && <span className="faint">From {row.lot.origin}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * One lot as a packing list.
 *
 * Ticking is optimistic: a packing floor works at speed and a round-trip per
 * piece would be felt. The server's tally replaces the guess when it lands, and
 * a refusal puts the card back.
 */
export function PackingLotPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ExporterLot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [only, setOnly] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.exporterLot(id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not open this lot.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <main className="page tab-view"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  async function mark(order: ExporterItem, packed: boolean) {
    if (busy.has(order.id)) return;
    setBusy((current) => new Set(current).add(order.id));

    const before = data!;
    setData({ ...before, items: before.items.map((item) => (item.id === order.id ? { ...item, packed } : item)) });

    try {
      const result = await api.setCheckpoint(order.id, 'china_packed', packed);
      setData((current) => (current ? { ...current, tally: result.tally } : current));
      setError(null);
    } catch (err) {
      setData(before);
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
    }
  }

  const packed = countOf(data.tally, 'china_packed');
  const items = only ? data.items.filter((item) => !item.packed) : data.items;

  return (
    <main className="page tab-view">
      <Link to="/packing" className="btn btn--quiet" style={{ marginBottom: 14 }}>
        <Icon name="back" size={14} /> Lots
      </Link>

      <div className="lothead">
        <span className="lothead__name">{data.lot.name}</span>
        <span className="badge">{data.tally.orders} items</span>
        <span className="faint">{data.store.name}</span>
      </div>

      {/* The crate landing at the warehouse is not something this screen can
          know: the packer tells the shop, and the shop ticks it. So the way to
          tell them is here, next to the work. */}
      {data.store.handle && (
        <Link
          to={`/messages/${encodeURIComponent(data.store.handle)}`}
          className="btn btn--quiet btn--sm"
          style={{ justifySelf: 'start', marginTop: 12 }}
        >
          💬 Message {data.store.name}
        </Link>
      )}

      {/* One number, large, because it is the only one that matters while
          packing: how much is still on the floor. */}
      <div className="packbar">
        <span className="packbar__count"><strong>{packed.done}</strong> / {packed.total} packed</span>
        <label className="packbar__filter">
          <input type="checkbox" checked={only} onChange={(event) => setOnly(event.target.checked)} />
          <span>Hide packed</span>
        </label>
      </div>

      {error && <ErrorNotice message={error} />}

      {items.length === 0 ? (
        <EmptyState title={only ? 'Everything is packed' : 'Nothing in this lot yet'}>
          {only ? 'Untick "hide packed" to see the whole list again.' : 'Orders land here as buyers take the items tagged into it.'}
        </EmptyState>
      ) : (
        <div className="packgrid">
          {items.map((item) => (
            <article key={item.id} className={`packcard${item.packed ? ' is-packed' : ''}`}>
              <div className="packcard__name">{item.itemName}</div>
              <div className="packcard__meta">
                <span className="badge badge--solid">{item.condition}</span>
                {item.quantity > 1 && <span className="faint">× {item.quantity}</span>}
                <span className="faint">{formatWeight(item.unitWeightGrams * item.quantity)}</span>
              </div>
              {/* What the owner has said about this piece, so the packer knows
                  whether it is even on the shelf yet. */}
              <div className="packcard__state">
                {item.received ? '✓ received' : 'not received yet'}
              </div>
              <button
                type="button"
                className={`packbtn${item.packed ? ' is-on' : ''}`}
                disabled={busy.has(item.id)}
                aria-pressed={item.packed}
                onClick={() => void mark(item, !item.packed)}
              >
                {item.packed ? 'PACKED' : 'MARK PACKED'}
              </button>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
