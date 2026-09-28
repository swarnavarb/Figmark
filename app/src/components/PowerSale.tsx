import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CONDITION_TAGS } from '@shared/enums';
import { CATEGORIES } from '@shared/catalog';
import {
  ApiRequestError, api, type PhotoDraft, type PowerSaleDraft, type PowerSaleView,
} from '../api';
import { TermsFields, termsBody, termsDraft, type TermsDraft } from './Buy';
import { LBox, OptionTiles, ToggleRow } from './ListingForm';
import { PhotoManager } from './PhotoManager';
import { EmptyState, ErrorNotice, Icon, Modal } from './ui';
import type { SavedCalc } from '@shared/profit';
import { CostSheetField, type CostSheetDraft } from './CostSheetField';
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
   * A running sale moves on the server's own clock; the page asks again while
   * one is live so what it shows keeps up. Only while the tab is actually on
   * screen - a hidden tab has nobody to show it to - and once more on coming
   * back, so it is current the moment it is looked at again.
   */
  const live = Boolean(sales?.some((sale) => sale.status === 'running' || sale.status === 'scheduled'));
  useEffect(() => {
    if (!live) return;
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void load(), 30_000);
    };
    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(timer);
      } else {
        void load();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [live, load]);

  // A failed refresh keeps what was already on screen; only a first load that
  // fails has nothing else to show.
  if (error && !sales) return <ErrorNotice message={error} />;

  return (
    <div className="stack">
      {error && <ErrorNotice message={error} />}
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
            and your own grid the moment its window closes
            {sale.afterWindow.feed || sale.afterWindow.channel
              ? ` and is announced in ${sale.afterWindow.feed ? 'the feed' : 'your channel'}.`
              : '.'}
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
  // A minute apart once there is more than an hour on it: a second hand on a
  // four-hour countdown is motion for its own sake, and a render a second for
  // every card on the screen. Crossing under the hour re-arms the timer, so
  // the seconds start moving the moment they are shown.
  const long = left > 3_600_000;

  useEffect(() => {
    setLeft(Date.parse(to) - Date.now());
    const timer = window.setInterval(() => setLeft(Date.parse(to) - Date.now()), long ? 30_000 : 1_000);
    return () => window.clearInterval(timer);
  }, [to, long]);

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
  allowMultiple: boolean;
  costSheet: CostSheetDraft | null;
  photos: PhotoDraft[];
  tags: string;
  sourcing: 'in_hand' | 'import';
  /** Stock, advance and expiry, as the sell page asks them. */
  terms: TermsDraft;
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
  allowMultiple: false,
  costSheet: null,
  photos: [],
  tags: '',
  sourcing: 'in_hand',
  terms: termsDraft(),
});

/** A saved calculation as a sale item: its name, its price as the members' price, and its costs. */
const itemFromCalc = (calc: SavedCalc): ItemDraft => ({
  ...blankItem(),
  title: calc.title,
  price: calc.sellingPriceMinor ? String(calc.sellingPriceMinor / 100) : '',
  terms: termsDraft({ quantityAvailable: calc.input.quantity || 1 }),
  costSheet: calc.steps.length ? { templateId: calc.templateId, templateName: calc.templateName, steps: calc.steps } : null,
});

/**
 * Building a run.
 *
 * Three questions in order, because that is the order a shop thinks in: what
 * you say to open it, what you are selling, and when it all goes out. Each
 * item is listed with the same boxes as the sell page - everything but "tell
 * people", because a sale item is told to the channel by the sale itself.
 * Where it is announced once its window closes is asked once, for the run.
 */
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
  const [startNow, setStartNow] = useState<'now' | 'later'>('now');
  const [startAt, setStartAt] = useState('');
  const [lead, setLead] = useState('0');
  const [every, setEvery] = useState('5');
  const [window_, setWindow] = useState('60');
  const [afterChannel, setAfterChannel] = useState(true);
  const [afterFeed, setAfterFeed] = useState(true);
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
        openingAt: startNow === 'now' || !startAt ? null : new Date(startAt).toISOString(),
        leadMinutes: Math.max(0, Number(lead) || 0),
        everyMinutes: Math.max(1, Number(every) || 5),
        windowMinutes: Math.max(5, Number(window_) || 60),
        closingBody: closing.trim(),
        afterWindow: { channel: afterChannel, feed: afterFeed },
        items: items.map((item) => {
          const terms = termsBody(item.terms);
          return {
            title: item.title.trim(),
            description: item.description.trim(),
            category: item.category,
            condition: item.condition,
            priceMinor: Math.round(Number(item.price) * 100),
            listPriceMinor: Math.round(Number(item.listPrice) * 100),
            quantity: Math.max(1, terms.quantityAvailable),
            allowMultiple: item.allowMultiple,
            costSheet: item.costSheet,
            photos: item.photos.map(({ blobName, url, isPrimary }) => ({ blobName, url, isPrimary })),
            tags: item.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
            sourcing: item.sourcing,
            quantityMode: terms.quantityMode,
            expiresAt: terms.expiresAt,
            advancePercent: terms.advancePercent,
          };
        }),
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
    <Modal title="⚡ Power selling" onClose={onClose}>
      <form className="sellform" onSubmit={submit}>
        <LBox icon="📝" title="The sale" hint="The name is only for you; the channel sees the message.">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday drop" maxLength={80} />
          </label>
          <label className="field">
            <span>Opening message</span>
            <textarea value={opening} onChange={(e) => setOpening(e.target.value)} rows={3}
              placeholder="Friday drop starts now — members get an hour on each piece." />
          </label>
        </LBox>

        {items.map((item, index) => (
          <div key={item.key} className="saleitem">
            <div className="saleitem__head">
              <span className="saleitem__num">{index + 1}</span>
              <b>{item.title.trim() || `Item ${index + 1}`}</b>
              {items.length > 1 && (
                <button type="button" className="btn btn--quiet btn--sm"
                  onClick={() => setItems((rows) => rows.filter((row) => row.key !== item.key))}>
                  Remove
                </button>
              )}
            </div>

            <LBox icon="📸" title="Photos">
              <PhotoManager photos={item.photos} onChange={(photos) => set(item.key, { photos })} label={null} />
            </LBox>

            <LBox icon="🏷️" title="The item">
              <label className="field">
                <span>Title</span>
                <input value={item.title} onChange={(e) => set(item.key, { title: e.target.value })}
                  placeholder="What it is" maxLength={120} />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea value={item.description} rows={2} placeholder="Condition, what's included…"
                  onChange={(e) => set(item.key, { description: e.target.value })} />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Category</span>
                  <select value={item.category} onChange={(e) => set(item.key, { category: e.target.value })}>
                    {CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Condition</span>
                  <select value={item.condition} onChange={(e) => set(item.key, { condition: e.target.value })}>
                    {CONDITION_TAGS.map((tag) => <option key={tag}>{tag}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Tags</span>
                <input value={item.tags} onChange={(e) => set(item.key, { tags: e.target.value })} placeholder="resin, sealed" />
              </label>
            </LBox>

            <LBox icon="💰" title="Price" hint="Members get the first price while the window is open.">
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
              {Number(item.listPrice) > 0 && Number(item.listPrice) <= Number(item.price) && (
                <span className="field__hint" style={{ color: 'var(--danger)' }}>
                  The price after the window has to be above the members&rsquo; price.
                </span>
              )}
            </LBox>

            <LBox icon="🚚" title="Ships from">
              <OptionTiles label="Ships from" value={item.sourcing} onChange={(sourcing) => set(item.key, { sourcing })}
                options={[
                  { id: 'in_hand', icon: '🏠', title: 'In hand', note: 'Ships from your shelf' },
                  { id: 'import', icon: '✈️', title: 'Import', note: 'Lot added later' },
                ]} />
            </LBox>

            <TermsFields value={item.terms} onChange={(terms) => set(item.key, { terms })} />
            <ToggleRow icon="🛍️" title="One buyer may take several" checked={item.allowMultiple}
              onChange={(allowMultiple) => set(item.key, { allowMultiple })} />

            <CostSheetField value={item.costSheet} onChange={(costSheet) => set(item.key, { costSheet })}
              sellingPriceMinor={Math.round(Number(item.price || 0) * 100)} shop={storeId} />
          </div>
        ))}

        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn--ghost btn--sm"
            onClick={() => setItems((rows) => [...rows, blankItem()])}>
            <Icon name="plus" size={13} /> Another item
          </button>
          {calcs.length > 0 && (
            <select value="" aria-label="Add from your saved calculations" style={{ flex: 1, minWidth: 180 }}
              onChange={(e) => {
                const calc = calcs.find((entry) => entry.id === e.target.value);
                if (calc) setItems((rows) => [...rows.filter((row) => row.title.trim() || row.price), itemFromCalc(calc)]);
              }}>
              <option value="">🧮 Add from a saved calculation…</option>
              {calcs.map((calc) => (
                <option key={calc.id} value={calc.id}>
                  {calc.title} · {formatMoney(calc.sellingPriceMinor)}{calc.listingId ? ' (listed)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <LBox icon="⏱️" title="Timing">
          <OptionTiles label="When it starts" value={startNow} onChange={setStartNow}
            options={[
              { id: 'now', icon: '▶️', title: 'Start now' },
              { id: 'later', icon: '🗓️', title: 'At a time' },
            ]} />
          {startNow === 'later' && (
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-label="Start at" />
          )}
          <div className="field-row field-row--3">
            <label className="field">
              <span>Wait before item 1 (min)</span>
              <input type="number" min="0" value={lead} onChange={(e) => setLead(e.target.value)} />
            </label>
            <label className="field">
              <span>Between items (min)</span>
              <input type="number" min="1" value={every} onChange={(e) => setEvery(e.target.value)} />
            </label>
            <label className="field">
              <span>Members&rsquo; window (min)</span>
              <input type="number" min="5" value={window_} onChange={(e) => setWindow(e.target.value)} />
            </label>
          </div>
        </LBox>

        {/* During the window an item is the channel's alone - that is what the
            members' price is for. Once it closes the item is everybody's, and
            this is where the shop says whether to tell everybody. */}
        <LBox icon="📣" title="When the window closes" hint="Each item goes public at the higher price. Announce it:">
          <ToggleRow icon="💬" title="Post in your channel" checked={afterChannel} onChange={setAfterChannel} />
          <ToggleRow icon="🌐" title="Post in the feed" checked={afterFeed} onChange={setAfterFeed} />
        </LBox>

        <LBox icon="👋" title="Closing message" hint="Optional. Goes out once every window has closed.">
          <textarea value={closing} onChange={(e) => setClosing(e.target.value)} rows={2} aria-label="Closing message"
            placeholder="That's the lot — thanks everyone!" />
        </LBox>

        {error && <p className="notice notice--error">{error}</p>}

        <button type="submit" className="btn btn--lg btn--block sellform__go" disabled={busy || !ready}>
          {busy ? 'Scheduling…' : startNow === 'now' ? '⚡ Start the sale' : '🗓️ Schedule it'}
        </button>
      </form>
    </Modal>
  );
}
