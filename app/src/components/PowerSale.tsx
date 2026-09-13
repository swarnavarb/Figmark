import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CONDITION_TAGS } from '@shared/enums';
import { CATEGORIES } from '@shared/catalog';
import {
  ApiRequestError, api, type PowerSaleDraft, type PowerSaleView,
} from '../api';
import { EmptyState, ErrorNotice, Icon, Modal } from './ui';
import { formatMoney, timeAgo } from '../format';

/**
 * Power selling: a channel sale a shop schedules once and walks away from.
 *
 * The shape a group-buy shop already works in by hand - a message saying the
 * sale is on, items one at a time, a message saying it is over - with the
 * sitting-there part taken out. The reason it is worth building rather than
 * leaving to a person with a phone is the window: each item opens at a price
 * only the channel gets, for as long as the shop says, and then goes public at
 * the ordinary price. That is a reason to be in the channel that does not
 * depend on anybody being fast.
 */

const STATUS_LABEL: Record<PowerSaleView['status'], string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  running: 'Running',
  done: 'Finished',
  cancelled: 'Stopped',
};

const STATUS_TONE: Record<PowerSaleView['status'], string> = {
  draft: '',
  scheduled: 'badge--warn',
  running: 'badge--accent',
  done: 'badge--ok',
  cancelled: 'badge--danger',
};

export function PowerSalePanel({ storeId }: { storeId: string }) {
  const [sales, setSales] = useState<PowerSaleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSales((await api.powerSales(storeId)).sales);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your sales.');
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * A running sale moves on the server when somebody asks for it, so the page
   * asks again while one is live. Not a poll for its own sake: this is the only
   * thing that makes the next item go out while the shop is watching.
   */
  useEffect(() => {
    if (!sales?.some((sale) => sale.status === 'running' || sale.status === 'scheduled')) return;
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [sales, load]);

  if (error) return <ErrorNotice message={error} />;

  return (
    <div className="stack">
      {sales && sales.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          {sales.map((sale) => (
            <SaleCard key={sale.id} sale={sale} storeId={storeId} onChanged={load} />
          ))}
        </div>
      )}

      {sales && sales.length === 0 && (
        <EmptyState icon="⚡" title="No sales scheduled">
          Write the message that opens it, add what you are selling, and set how far apart the
          posts go out. It runs itself from there.
        </EmptyState>
      )}

      <button type="button" className="btn btn--lg" style={{ justifySelf: 'start' }}
        onClick={() => setBuilding(true)}>
        <Icon name="plus" size={15} /> Schedule a sale
      </button>

      {building && (
        <SaleBuilder
          storeId={storeId}
          onClose={() => setBuilding(false)}
          onSaved={() => { setBuilding(false); void load(); }}
        />
      )}
    </div>
  );
}

function SaleCard({ sale, storeId, onChanged }: {
  sale: PowerSaleView;
  storeId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const live = sale.status === 'running' || sale.status === 'scheduled';

  async function stop() {
    setBusy(true);
    try {
      await api.stopPowerSale(sale.id, storeId);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card card--pad stack" style={{ gap: 11 }}>
      <div className="row row--between">
        <div style={{ minWidth: 0 }}>
          <span className="card__title">{sale.name}</span>
          <span className="faint">
            {sale.posted} of {sale.total} posted · one every {sale.everyMinutes} min ·{' '}
            {sale.windowMinutes} min at the members&rsquo; price
          </span>
        </div>
        <span className={`badge ${STATUS_TONE[sale.status]}`}>{STATUS_LABEL[sale.status]}</span>
      </div>

      {/* How far through it is, at a glance. The same bar as everywhere else. */}
      <div className="meter">
        <div className="meter__fill" style={{ width: `${Math.round((sale.posted / Math.max(1, sale.total)) * 100)}%` }} />
      </div>

      <div className="runlist">
        {sale.items.map((item) => (
          <div key={item.id} className="runlist__row">
            <span className="runlist__dot" data-state={item.postedAt ? (item.liftedAt ? 'done' : 'live') : 'waiting'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {item.listingId ? (
                <Link to={`/listing/${item.listingId}`} className="runlist__name personlink">{item.title}</Link>
              ) : (
                <span className="runlist__name">{item.title}</span>
              )}
              <span className="faint">
                {formatMoney(item.priceMinor)} for members · {formatMoney(item.listPriceMinor)} after
                {item.quantity > 1 && ` · ${item.quantity} up`}
                {item.allowMultiple && ' · multiples allowed'}
              </span>
            </div>
            <span className={`badge${item.liftedAt ? '' : item.postedAt ? ' badge--accent' : ''}`}>
              {item.liftedAt
                ? 'Public price'
                : item.postedAt
                  ? `${item.windowLeft} min left`
                  : 'Queued'}
            </span>
          </div>
        ))}
      </div>

      <div className="row row--between">
        <span className="faint">
          {sale.openedAt
            ? `Opened ${timeAgo(sale.openedAt)}`
            : `Opens ${new Date(sale.openingAt).toLocaleString()}`}
        </span>
        {live && (
          <button className="btn btn--ghost btn--sm" onClick={() => void stop()} disabled={busy}>
            Stop it
          </button>
        )}
      </div>
    </article>
  );
}

/** A row in the builder, before it is a sale. */
interface ItemDraft {
  key: number;
  title: string;
  description: string;
  category: string;
  condition: string;
  price: string;
  listPrice: string;
  quantity: string;
  allowMultiple: boolean;
}

let nextKey = 1;
const blankItem = (): ItemDraft => ({
  key: nextKey++,
  title: '',
  description: '',
  category: CATEGORIES[0]!,
  condition: CONDITION_TAGS[0],
  price: '',
  listPrice: '',
  quantity: '1',
  allowMultiple: false,
});

/**
 * Building a run.
 *
 * Three questions in order, because that is the order a shop thinks in: what
 * you say to open it, what you are selling, and when it all goes out. The
 * timing is last on purpose - it is the part that has a sensible default, and
 * the part nobody wants to think about before they have decided what to sell.
 */
function SaleBuilder({ storeId, onClose, onSaved }: {
  storeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [startNow, setStartNow] = useState(true);
  const [startAt, setStartAt] = useState('');
  const [lead, setLead] = useState('0');
  const [every, setEvery] = useState('5');
  const [window_, setWindow] = useState('60');
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: number, patch: Partial<ItemDraft>) =>
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const ready =
    opening.trim().length > 3 &&
    items.length > 0 &&
    items.every((item) => item.title.trim() && Number(item.price) > 0 && Number(item.listPrice) > Number(item.price));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const draft: PowerSaleDraft = {
        storeId,
        name: name.trim(),
        openingBody: opening.trim(),
        openingAt: startNow || !startAt ? null : new Date(startAt).toISOString(),
        leadMinutes: Math.max(0, Number(lead) || 0),
        everyMinutes: Math.max(1, Number(every) || 5),
        windowMinutes: Math.max(5, Number(window_) || 60),
        closingBody: closing.trim(),
        items: items.map((item) => ({
          title: item.title.trim(),
          description: item.description.trim(),
          category: item.category,
          condition: item.condition,
          priceMinor: Math.round(Number(item.price) * 100),
          listPriceMinor: Math.round(Number(item.listPrice) * 100),
          quantity: Math.max(1, Number(item.quantity) || 1),
          allowMultiple: item.allowMultiple,
        })),
      };
      await api.createPowerSale(draft);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not schedule that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Schedule a sale" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name it, for you</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Friday drop" maxLength={80} />
          <span className="field__hint">Only you see this. The channel sees the message below.</span>
        </label>

        <label className="field">
          <span>The message that opens it</span>
          <textarea value={opening} onChange={(e) => setOpening(e.target.value)} rows={3}
            placeholder="Friday drop starts now — members get an hour on each piece before it goes public." />
        </label>

        <div className="field">
          <span>What you are selling</span>
          <div className="stack" style={{ gap: 10 }}>
            {items.map((item, index) => (
              <div key={item.key} className="runitem">
                <div className="row row--between">
                  <span className="faint">Item {index + 1}</span>
                  {items.length > 1 && (
                    <button type="button" className="btn btn--quiet btn--sm"
                      onClick={() => setItems((rows) => rows.filter((row) => row.key !== item.key))}>
                      Remove
                    </button>
                  )}
                </div>
                <input value={item.title} onChange={(e) => set(item.key, { title: e.target.value })}
                  placeholder="What it is" maxLength={120} />
                <div className="field-row">
                  <label className="field">
                    <span>Members pay (₹)</span>
                    <input type="number" min="1" value={item.price}
                      onChange={(e) => set(item.key, { price: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>After the window (₹)</span>
                    <input type="number" min="1" value={item.listPrice}
                      onChange={(e) => set(item.key, { listPrice: e.target.value })} />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>How many</span>
                    <input type="number" min="1" value={item.quantity}
                      onChange={(e) => set(item.key, { quantity: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Category</span>
                    <select value={item.category} onChange={(e) => set(item.key, { category: e.target.value })}>
                      {CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
                    </select>
                  </label>
                </div>
                <label className="row" style={{ gap: 8, fontSize: 'var(--t-sm)', color: 'var(--text-dim)' }}>
                  <input type="checkbox" checked={item.allowMultiple}
                    onChange={(e) => set(item.key, { allowMultiple: e.target.checked })} />
                  One buyer may take more than one
                </label>
                {Number(item.listPrice) > 0 && Number(item.listPrice) <= Number(item.price) && (
                  <span className="field__hint" style={{ color: 'var(--danger)' }}>
                    The price after the window has to be above the members&rsquo; price — otherwise the
                    window is not worth being in the channel for.
                  </span>
                )}
              </div>
            ))}
            <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }}
              onClick={() => setItems((rows) => [...rows, blankItem()])}>
              <Icon name="plus" size={13} /> Another item
            </button>
          </div>
        </div>

        <div className="field">
          <span>When it runs</span>
          <div className="seg" role="radiogroup" aria-label="When it starts">
            <button type="button" role="radio" aria-checked={startNow}
              className={startNow ? 'is-on' : ''} onClick={() => setStartNow(true)}>
              Start now
            </button>
            <button type="button" role="radio" aria-checked={!startNow}
              className={!startNow ? 'is-on' : ''} onClick={() => setStartNow(false)}>
              At a time
            </button>
          </div>
          {!startNow && (
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}
              style={{ marginTop: 8 }} />
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span>Wait before item 1 (min)</span>
            <input type="number" min="0" value={lead} onChange={(e) => setLead(e.target.value)} />
            <span className="field__hint">
              Its own number: how long to let the room read &ldquo;we are starting&rdquo; is a
              different question from how fast to drop things once it has. Zero sends the first
              item with the announcement.
            </span>
          </label>
          <label className="field">
            <span>Minutes between items</span>
            <input type="number" min="1" value={every} onChange={(e) => setEvery(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Members&rsquo; price lasts (min)</span>
          <input type="number" min="5" value={window_} onChange={(e) => setWindow(e.target.value)} />
          <span className="field__hint">
            Each item holds its members&rsquo; price for this long, counted from when it posts.
          </span>
        </label>

        <label className="field">
          <span>The message that closes it</span>
          <textarea value={closing} onChange={(e) => setClosing(e.target.value)} rows={2}
            placeholder="That's the lot — thanks everyone. Anything left is at the public price now." />
          <span className="field__hint">Optional. Goes out once every window has closed.</span>
        </label>

        {error && <p className="notice notice--error">{error}</p>}

        <p className="faint">
          Posts go out in your channel, not to everyone&rsquo;s feed — that is what makes the
          members&rsquo; price worth having. Each item is listed publicly at the higher price once
          its window closes, so nothing is lost by being late.
        </p>

        <button type="submit" className="btn btn--lg btn--block" disabled={busy || !ready}>
          {busy ? 'Scheduling…' : startNow ? 'Start the sale' : 'Schedule it'}
        </button>
      </form>
    </Modal>
  );
}
