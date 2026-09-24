import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CONDITION_TAGS } from '@shared/enums';
import { CATEGORIES } from '@shared/catalog';
import {
  ApiRequestError, api, type PowerSaleDraft, type PowerSaleView,
} from '../api';
import { EmptyState, ErrorNotice, Icon, Modal } from './ui';
import type { SavedCalc } from '@shared/profit';
import { CostSheetField, type CostSheetDraft } from './CostSheetField';
import { formatMoney, timeAgo } from '../format';
import { CalcIcon } from './CalcIcon';

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

export function PowerSalePanel({ storeId, startWith }: { storeId: string; startWith?: SavedCalc[] }) {
  const [sales, setSales] = useState<PowerSaleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Arriving with saved calculations: the builder opens with them as items.
  const [building, setBuilding] = useState(Boolean(startWith?.length));

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
        <EmptyState icon={<Icon name="bolt" size={26} />} title="No sales scheduled">
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
          startWith={startWith}
          onClose={() => setBuilding(false)}
          onSaved={() => { setBuilding(false); void load(); }}
        />
      )}
    </div>
  );
}

/**
 * A run, collapsed to one line until it is asked for.
 *
 * A shop with four sales scheduled wants to know two things at a glance: is it
 * running, and when is it over. Everything else - which item is live, what it
 * costs, how long its window has left - is the answer to a question they are
 * only sometimes asking, so it waits behind a tap.
 *
 * Open by default while it is running, because that is the one a shop is
 * actually watching.
 */
function SaleCard({ sale, storeId, onChanged }: {
  sale: PowerSaleView;
  storeId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(sale.status === 'running');
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

  const pct = Math.round((sale.posted / Math.max(1, sale.total)) * 100);

  return (
    <article className={`runcard${open ? ' is-open' : ''}`}>
      <button type="button" className="runcard__head" onClick={() => setOpen((was) => !was)}
        aria-expanded={open}>
        <span className="runcard__chevron" aria-hidden="true" />
        <span className="runcard__title">
          <span className="runcard__name">{sale.name}</span>
          <span className="faint">
            {sale.posted} of {sale.total} out
            {sale.status === 'done' && ' · all public'}
            {sale.status === 'cancelled' && ' · stopped'}
          </span>
        </span>
        <span className="runcard__right">
          {/* The one number worth carrying on a collapsed row: when it is over. */}
          {sale.finishesAt
            ? <Countdown to={sale.finishesAt} />
            : <span className={`badge ${STATUS_TONE[sale.status]}`}>{STATUS_LABEL[sale.status]}</span>}
        </span>
      </button>

      <div className="runcard__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>

      {open && (
        <div className="runcard__body">
          <div className="row row--between">
            <span className="faint">
              one every {sale.everyMinutes} min · {sale.windowMinutes} min at the members&rsquo; price
            </span>
            <span className={`badge ${STATUS_TONE[sale.status]}`}>{STATUS_LABEL[sale.status]}</span>
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
                <span className={`badge${item.liftedAt ? ' badge--ok' : item.postedAt ? ' badge--accent' : ''}`}>
                  {item.liftedAt
                    ? 'In the shop'
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

          <p className="faint">
            Items are in your channel only while their window is open. Each one joins the buy page
            and your own grid the moment its window closes.
          </p>
        </div>
      )}
    </article>
  );
}

/**
 * Time left, ticking.
 *
 * The deadline comes from the server, because the schedule is the server's: a
 * browser left open overnight with a stale copy would count down to the wrong
 * minute. Only the ticking is local.
 */
function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState(() => Date.parse(to) - Date.now());

  useEffect(() => {
    setLeft(Date.parse(to) - Date.now());
    // A minute apart once there is more than an hour on it: a second hand on a
    // four-hour countdown is motion for its own sake, and a render a second for
    // every card on the screen.
    const step = Date.parse(to) - Date.now() > 3_600_000 ? 30_000 : 1_000;
    const timer = window.setInterval(() => setLeft(Date.parse(to) - Date.now()), step);
    return () => window.clearInterval(timer);
  }, [to]);

  if (left <= 0) return <span className="countdown countdown--done">handing over…</span>;

  const total = Math.floor(left / 1000);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  return (
    <span className="countdown" title={`All public by ${new Date(to).toLocaleString()}`}>
      <span className="countdown__value">
        {hours > 0 ? `${hours}h ${String(mins).padStart(2, '0')}m` : `${mins}m ${String(secs).padStart(2, '0')}s`}
      </span>
      <span className="countdown__label">to all public</span>
    </span>
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
  costSheet: CostSheetDraft | null;
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
  costSheet: null,
});

/**
 * Building a run.
 *
 * Three questions in order, because that is the order a shop thinks in: what
 * you say to open it, what you are selling, and when it all goes out. The
 * timing is last on purpose - it is the part that has a sensible default, and
 * the part nobody wants to think about before they have decided what to sell.
 */
/** A saved calculation as a sale item: its name, its price as the members' price, and its costs. */
const itemFromCalc = (calc: SavedCalc): ItemDraft => ({
  ...blankItem(),
  title: calc.title,
  price: calc.sellingPriceMinor ? String(calc.sellingPriceMinor / 100) : '',
  quantity: String(calc.input.quantity || 1),
  costSheet: calc.steps.length ? { templateId: calc.templateId, templateName: calc.templateName, steps: calc.steps } : null,
});

function SaleBuilder({ storeId, startWith, onClose, onSaved }: {
  storeId: string;
  startWith?: SavedCalc[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [calcs, setCalcs] = useState<SavedCalc[]>([]);
  useEffect(() => {
    void api.savedCalcs(storeId).then((result) => setCalcs(result.calcs)).catch(() => setCalcs([]));
  }, [storeId]);
  const [name, setName] = useState('');
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [startNow, setStartNow] = useState(true);
  const [startAt, setStartAt] = useState('');
  const [lead, setLead] = useState('0');
  const [every, setEvery] = useState('5');
  const [window_, setWindow] = useState('60');
  const [items, setItems] = useState<ItemDraft[]>(() => (startWith?.length ? startWith.map(itemFromCalc) : [blankItem()]));
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
          costSheet: item.costSheet,
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
                <CostSheetField value={item.costSheet} onChange={(costSheet) => set(item.key, { costSheet })}
                  sellingPriceMinor={Math.round(Number(item.price || 0) * 100)} shop={storeId} />
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
            {calcs.length > 0 && (
              <label className="field">
                <span><CalcIcon size={15} /> Add from your saved calculations</span>
                <select value="" onChange={(e) => {
                  const calc = calcs.find((entry) => entry.id === e.target.value);
                  if (calc) setItems((rows) => [...rows.filter((row) => row.title.trim() || row.price), itemFromCalc(calc)]);
                }}>
                  <option value="">Pick one…</option>
                  {calcs.map((calc) => (
                    <option key={calc.id} value={calc.id}>
                      {calc.title} · {formatMoney(calc.sellingPriceMinor)}{calc.listingId ? ' (listed)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
