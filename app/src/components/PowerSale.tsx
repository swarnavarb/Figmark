import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { PostTemplate } from '@shared/templates';
import { useSession } from '../session';
import { BackLink } from './ScrollManager';
import { CONDITION_TAGS, LOT_STAGE_LABELS } from '@shared/enums';
import { CATEGORIES } from '@shared/catalog';
import {
  ApiRequestError, api, type LotSummary, type PhotoDraft, type PowerSaleDraft, type PowerSaleView,
} from '../api';
import { TermsFields, termsBody, termsDraft, type TermsDraft } from './Buy';
import { LBox, OptionTiles, SHAPE_OPTIONS, Switch, ToggleRow, type Shape } from './ListingForm';
import { PhotoManager } from './PhotoManager';
import { EmptyState, ErrorNotice, Icon } from './ui';
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
  const navigate = useNavigate();
  const build = useCallback((calcs?: SavedCalc[]) =>
    navigate(`/shop/power-sale?store=${encodeURIComponent(storeId)}`, { state: calcs?.length ? { saleCalcs: calcs } : null }),
  [navigate, storeId]);
  // Arriving with saved calculations: the builder opens with them as items.
  useEffect(() => { if (startWith?.length) build(startWith); }, [startWith, build]);

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
            <button type="button" className="btn btn--lg" style={{ justifySelf: 'start' }}
        onClick={() => build()}>
        <Icon name="plus" size={15} /> Schedule a sale
      </button>
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

/** What every item in a run shares by default - and what a saved quick fill holds. */
interface QuickFill {
  category: string;
  condition: string;
  tags: string;
  shape: Shape;
  lotId: string;
  terms: TermsDraft;
  allowMultiple: boolean;
}

/** One item of a run, carrying its own copy of the quick fill options. */
interface ItemDraft {
  key: number;
  title: string;
  description: string;
  price: string;
  listPrice: string;
  costSheet: CostSheetDraft | null;
  photos: PhotoDraft[];
  /** Folded to its name until tapped. */
  open: boolean;
  fill: QuickFill;
  /** Changed for this item alone, so the quick fill above no longer writes over it. */
  own: boolean;
  /** Its listing options unfolded. */
  optsOpen: boolean;
}

const DEFAULT_FILL_NAME = 'Quick fill for Power selling';

const blankFill = (): QuickFill => ({
  category: CATEGORIES[0]!, condition: CONDITION_TAGS[0], tags: '', shape: 'single', lotId: '',
  terms: termsDraft(), allowMultiple: false,
});

let nextKey = 1;
const blankItem = (fill: QuickFill = blankFill()): ItemDraft => ({
  key: nextKey++, title: '', description: '', price: '', listPrice: '', costSheet: null, photos: [],
  open: false, fill, own: false, optsOpen: false,
});

/** A saved quick fill back into the form. */
function fillFromTemplate(template: PostTemplate): { fill: QuickFill; description: string } {
  const terms = template.terms;
  return {
    fill: {
      category: template.category || CATEGORIES[0]!,
      condition: template.condition ?? CONDITION_TAGS[0],
      tags: template.tags.join(', '),
      shape: template.defaultLotId ? 'lot' : template.sourcing === 'import' ? 'waiting' : 'single',
      lotId: template.defaultLotId ?? '',
      terms: {
        ...termsDraft(),
        quantityMode: terms?.quantityMode ?? 'fixed',
        quantity: String(terms?.quantity ?? 1),
        advance: Boolean(terms?.advancePercent),
        advancePercent: String(terms?.advancePercent ?? 20),
        limited: Boolean(terms?.limitedDays),
        days: String(terms?.limitedDays ?? 2),
      },
      allowMultiple: Boolean(terms?.allowMultiple),
    },
    description: template.description ?? '',
  };
}

/** A saved calculation into an item: its name, its price as the members' price, and its costs. */
const itemFromCalc = (calc: SavedCalc, base: ItemDraft): ItemDraft => ({
  ...base,
  title: calc.title,
  price: calc.sellingPriceMinor ? String(calc.sellingPriceMinor / 100) : '',
  costSheet: calc.steps.length ? { templateId: calc.templateId, templateName: calc.templateName, steps: calc.steps } : null,
});

/** A line the shop has started on; untouched lines are left out of the run. */
const touched = (item: ItemDraft) =>
  Boolean(item.title.trim() || item.price || item.listPrice || item.photos.length || item.costSheet);

/** A run starts with five lines to fill; more are a tap away. */
const START_LINES = 5;

/** The public price, or the members' price when it is left empty (no discount, it just goes public). */
const publicPrice = (item: ItemDraft) => Number(item.listPrice) || Number(item.price);

const itemReady = (item: ItemDraft) =>
  item.title.trim().length > 0 && Number(item.price) > 0 && publicPrice(item) >= Number(item.price);

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long' });

/**
 * The options every item has - category, condition, tags, where it ships from,
 * stock, advance, limited deal - shown once as the quick fill and again, folded,
 * inside each item.
 */
function FillFields({ value, onChange, lots }: {
  value: QuickFill;
  onChange: (next: QuickFill) => void;
  lots: LotSummary[];
}) {
  const set = (patch: Partial<QuickFill>) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Category</span>
          <select value={value.category} onChange={(e) => set({ category: e.target.value })}>
            {CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Condition</span>
          <select value={value.condition} onChange={(e) => set({ condition: e.target.value })}>
            {CONDITION_TAGS.map((tag) => <option key={tag}>{tag}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Tags</span>
        <input value={value.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="resin, sealed" />
      </label>
      <OptionTiles label="Ships from" value={value.shape} onChange={(shape) => set({ shape })} options={SHAPE_OPTIONS} />
      {value.shape === 'lot' && (
        lots.length === 0 ? (
          <Link to="/shop?tab=lots&spotlight=new" className="lotpick__new">
            + New lot <span aria-hidden="true">→</span> <small>no open lots yet</small>
          </Link>
        ) : (
          <div className="lotpick" role="radiogroup" aria-label="Lot">
            {lots.map(({ lot, listingCount }) => (
              <button key={lot.id} type="button" role="radio" aria-checked={value.lotId === lot.id}
                className={`lotpick__row${value.lotId === lot.id ? ' is-on' : ''}`} onClick={() => set({ lotId: lot.id })}>
                <b>{lot.name}</b>
                <span className="lotpick__meta">
                  {[LOT_STAGE_LABELS[lot.stage], `${listingCount} item${listingCount === 1 ? '' : 's'}`].join(' · ')}
                </span>
              </button>
            ))}
          </div>
        )
      )}
      <TermsFields value={value.terms} onChange={(terms) => set({ terms })} publicLater />
      <ToggleRow icon="🛍️" title="One buyer may take several" checked={value.allowMultiple}
        onChange={(allowMultiple) => set({ allowMultiple })} />
    </>
  );
}

/**
 * Building a run, as a page of its own - it is too long for a pop-up.
 *
 * In the order a shop thinks in: what opens it, the quick fill (saveable for
 * next time, and copied into every item it is switched on for), the items -
 * five lines to start, each unfolding to a form - and then when it all goes
 * out and how it closes.
 */
export function PowerSaleBuilderPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const startWith = (useLocation().state as { saleCalcs?: SavedCalc[] } | null)?.saleCalcs;
  const { user } = useSession();
  const storeId = params.get('store') ?? user?.id ?? '';
  const back = `/shop?tab=items&view=power${params.get('store') ? `&store=${encodeURIComponent(storeId)}` : ''}`;

  const [calcs, setCalcs] = useState<SavedCalc[]>([]);
  const [fills, setFills] = useState<PostTemplate[]>([]);
  const [lots, setLots] = useState<LotSummary[]>([]);
  useEffect(() => {
    void api.savedCalcs(storeId).then((result) => setCalcs(result.calcs)).catch(() => setCalcs([]));
    void api.templates().then((result) => setFills(result.templates.filter((row) => row.kind === 'power'))).catch(() => undefined);
    void api.myLots(storeId).then((result) => setLots(result.lots.filter((entry) => entry.lot.status === 'open'))).catch(() => undefined);
  }, [storeId]);

  const [name, setName] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [closing, setClosing] = useState('');
  const [fill, setFill] = useState<QuickFill>(blankFill);
  const [fillOn, setFillOn] = useState(true);
  const [fillDescription, setFillDescription] = useState('');
  const [fillId, setFillId] = useState('');
  const [fillName, setFillName] = useState(DEFAULT_FILL_NAME);
  const [fillOpen, setFillOpen] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [startNow, setStartNow] = useState<'now' | 'later'>('now');
  const [startHours, setStartHours] = useState('2');
  const [lead, setLead] = useState('30');
  const [every, setEvery] = useState('1');
  const [window_, setWindow] = useState('60');
  const [afterChannel, setAfterChannel] = useState(true);
  const [afterFeed, setAfterFeed] = useState(true);
  const [items, setItems] = useState<ItemDraft[]>(() => {
    const rows = (startWith ?? []).map((calc) => itemFromCalc(calc, blankItem()));
    return [...rows, ...Array.from({ length: Math.max(0, START_LINES - rows.length) }, () => blankItem())];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Named for the day it opens on, until the shop writes its own.
  const startsAt = new Date(Date.now() + (startNow === 'later' ? Math.max(0, Number(startHours) || 0) : 0) * 3_600_000);
  const day = WEEKDAY.format(startsAt);
  const windowText = Number(window_) >= 60 && Number(window_) % 60 === 0
    ? `${Number(window_) / 60} hour${Number(window_) === 60 ? '' : 's'}` : `${Number(window_) || 0} minutes`;
  const saleName = name ?? `${day} drop`;
  const openingText = opening ?? `⚡ ${day} drop starts now — members get ${windowText} on each piece at the channel price.`;

  const set = (key: number, patch: Partial<ItemDraft>) =>
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  /** The quick fill changed: every item still following it follows. */
  function applyFill(next: QuickFill, on = fillOn) {
    setFill(next);
    if (on) setItems((rows) => rows.map((row) => (row.own ? row : { ...row, fill: next })));
  }

  function pickFill(id: string) {
    setFillId(id);
    const template = fills.find((row) => row.id === id);
    if (template) {
      const read = fillFromTemplate(template);
      applyFill(read.fill);
      setFillDescription(read.description);
      setFillName(template.name);
    }
  }

  async function saveFill() {
    setFillNote(null);
    const terms = termsBody(fill.terms);
    try {
      const { template } = await api.saveTemplate({
        id: fillId || undefined,
        name: fillName.trim() || DEFAULT_FILL_NAME,
        description: fillDescription.trim(),
        kind: 'power',
        category: fill.category,
        condition: fill.condition,
        tags: fill.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        sourcing: fill.shape === 'single' ? 'in_hand' : 'import',
        defaultLotId: fill.shape === 'lot' && fill.lotId ? fill.lotId : null,
        terms: {
          quantityMode: terms.quantityMode,
          quantity: Math.max(1, terms.quantityAvailable),
          advancePercent: terms.advancePercent,
          limitedDays: fill.terms.limited ? Number(fill.terms.days) || 2 : null,
          allowMultiple: fill.allowMultiple,
        },
      });
      setFills((rows) => [template, ...rows.filter((row) => row.id !== template.id)]);
      setFillId(template.id);
      setFillName(template.name);
      setFillNote('Saved to your quick fills.');
    } catch (err) {
      setFillNote(err instanceof ApiRequestError ? err.message : 'That did not save.');
    }
  }

  const filled = items.filter(touched);
  const ready = openingText.trim().length > 3 && filled.length > 0 && filled.every(itemReady);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const draft: PowerSaleDraft = {
        storeId,
        name: saleName.trim(),
        openingBody: openingText.trim(),
        openingAt: startNow === 'now' ? null : startsAt.toISOString(),
        leadMinutes: Math.max(30, Number(lead) || 30),
        everyMinutes: Math.max(1, Number(every) || 1),
        windowMinutes: Math.max(5, Number(window_) || 60),
        closingBody: closing.trim(),
        afterWindow: { channel: afterChannel, feed: afterFeed },
        items: filled.map((item) => {
          const own = item.fill;
          const terms = termsBody(own.terms);
          return {
            title: item.title.trim(),
            description: item.description.trim() || fillDescription.trim(),
            category: own.category,
            condition: own.condition,
            priceMinor: Math.round(Number(item.price) * 100),
            listPriceMinor: Math.round(publicPrice(item) * 100),
            quantity: Math.max(1, terms.quantityAvailable),
            allowMultiple: own.allowMultiple,
            costSheet: item.costSheet,
            photos: item.photos.map(({ blobName, url, isPrimary }) => ({ blobName, url, isPrimary })),
            tags: own.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
            sourcing: own.shape === 'single' ? 'in_hand' : 'import',
            lotId: own.shape === 'lot' && own.lotId ? own.lotId : null,
            quantityMode: terms.quantityMode,
            expiresAt: null,
            limitedDays: own.terms.limited ? Math.max(1, Number(own.terms.days) || 2) : null,
            advancePercent: terms.advancePercent,
          };
        }),
      };
      await api.createPowerSale(draft);
      navigate(back);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not schedule that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="page__head">
        <BackLink to={back}>‹ Back</BackLink>
        <h1>⚡ Power selling</h1>
      </div>
      <form className="sellform psform" onSubmit={submit}>
        <LBox icon="📝" title="The sale" hint="The name is only for you; the channel sees the message.">
          <label className="field">
            <span>Name</span>
            <input value={saleName} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
          <label className="field">
            <span>Opening message</span>
            <textarea value={openingText} onChange={(e) => setOpening(e.target.value)} rows={3} />
          </label>
        </LBox>

        <LBox icon="⚡" title="Quick fill" hint={fillOn ? 'Fills every item below; change any item on its own.' : 'Off: each item keeps its own options.'}
          right={(
            <>
              <span className="probadge">PRO</span>
              <Switch checked={fillOn} label="Use the quick fill for every item"
                onChange={(on) => { setFillOn(on); if (on) applyFill(fill, true); }} />
              <button type="button" className="psfold" aria-expanded={fillOpen}
                aria-label={fillOpen ? 'Collapse quick fill' : 'Expand quick fill'} onClick={() => setFillOpen((v) => !v)}>
                <Icon name="chevron" size={16} />
              </button>
            </>
          )}>
          {fillOpen && (<>
            {fills.length > 0 && (
              <select value={fillId} onChange={(e) => pickFill(e.target.value)} aria-label="Saved quick fill">
                <option value="">Start from a saved quick fill…</option>
                {fills.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            )}
            <label className="field">
              <span>Description</span>
              <textarea value={fillDescription} rows={2} onChange={(e) => setFillDescription(e.target.value)}
                placeholder="Used for any item without its own description" />
            </label>
            <FillFields value={fill} onChange={(next) => applyFill(next)} lots={lots} />
            <div className="row" style={{ gap: 8 }}>
              <input value={fillName} onChange={(e) => setFillName(e.target.value)} placeholder={DEFAULT_FILL_NAME}
                aria-label="Quick fill name" style={{ flex: 1, minWidth: 0 }} />
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => void saveFill()}>
                {fillId ? 'Update' : 'Save'} quick fill
              </button>
            </div>
            {fillNote && <span className="lbox__hint">{fillNote}</span>}
          </>)}
        </LBox>

        <LBox icon="🧾" title="Items" hint={`${filled.length} of ${items.length} filled · posted in this order`}>
          {items.map((item, index) => item.open ? (
            <div key={item.key} className="saleitem">
              <div className="saleitem__head">
                <span className="saleitem__num">{index + 1}</span>
                <b>{item.title.trim() || `Item ${index + 1}`}</b>
                {!touched(item) && calcs.length > 0 && (
                  <select value="" aria-label={`Fill item ${index + 1} from a saved calculation`} className="saleitem__calc"
                    onChange={(e) => {
                      const calc = calcs.find((entry) => entry.id === e.target.value);
                      if (calc) set(item.key, itemFromCalc(calc, item));
                    }}>
                    <option value="">🧮 Add from saved calculations…</option>
                    {calcs.map((calc) => (
                      <option key={calc.id} value={calc.id}>
                        {calc.title} · {formatMoney(calc.sellingPriceMinor)}{calc.listingId ? ' (listed)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <PhotoManager photos={item.photos} onChange={(photos) => set(item.key, { photos })} label={null} />
              <label className="field">
                <span>Title</span>
                <input value={item.title} onChange={(e) => set(item.key, { title: e.target.value })}
                  placeholder="What it is" maxLength={120} />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea value={item.description} rows={2}
                  placeholder={fillDescription.trim() || "Condition, what's included…"}
                  onChange={(e) => set(item.key, { description: e.target.value })} />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Member price (₹)</span>
                  <input type="number" min="1" value={item.price} onChange={(e) => set(item.key, { price: e.target.value })} />
                </label>
                <label className="field">
                  <span>Public price (₹)</span>
                  <input type="number" min="1" value={item.listPrice} placeholder={item.price || ''}
                    onChange={(e) => set(item.key, { listPrice: e.target.value })} />
                </label>
              </div>
              {Number(item.price) > 0 && (
                publicPrice(item) < Number(item.price) ? (
                  <span className="field__hint" style={{ color: 'var(--danger)' }}>
                    The public price can&rsquo;t be below the member price.
                  </span>
                ) : publicPrice(item) === Number(item.price) ? (
                  <span className="field__hint">Same price: no member discount — it simply goes public after the member window.</span>
                ) : (
                  <span className="field__hint">Members save {formatMoney(Math.round((publicPrice(item) - Number(item.price)) * 100))}; the price goes up when the window closes.</span>
                )
              )}
              <CostSheetField value={item.costSheet} onChange={(costSheet) => set(item.key, { costSheet })}
                sellingPriceMinor={Math.round(Number(item.price || 0) * 100)} shop={storeId} />

              <button type="button" className={`saleopts${item.optsOpen ? ' is-open' : ''}`} aria-expanded={item.optsOpen}
                onClick={() => set(item.key, { optsOpen: !item.optsOpen })}>
                <span aria-hidden="true">⚙️</span>
                <b>Listing options</b>
                <small>{item.own ? 'edited for this item' : fillOn ? 'from quick fill' : 'this item'}</small>
                <Icon name="chevron" size={15} />
              </button>
              {item.optsOpen && (
                <div className="saleopts__body">
                  <FillFields value={item.fill} lots={lots}
                    onChange={(next) => set(item.key, { fill: next, own: true })} />
                  {item.own && fillOn && (
                    <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }}
                      onClick={() => set(item.key, { fill, own: false })}>
                      ↺ Use the quick fill again
                    </button>
                  )}
                </div>
              )}

              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn--sm" disabled={touched(item) && !itemReady(item)}
                  onClick={() => set(item.key, { open: false, optsOpen: false })}>
                  {touched(item) ? '✓ Save item' : 'Close'}
                </button>
                <button type="button" className="btn btn--ghost btn--sm"
                  onClick={() => setItems((rows) => rows.filter((row) => row.key !== item.key))}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div key={item.key} className={`saleline${!touched(item) ? ' saleline--blank' : itemReady(item) ? '' : ' saleline--todo'}`}>
              <span className="saleitem__num">{index + 1}</span>
              <button type="button" className="saleline__name" onClick={() => set(item.key, { open: true })}>
                {item.title.trim() || `Item ${index + 1}`}
                {touched(item) && !itemReady(item) && <small> · needs prices</small>}
                {!touched(item) && <small className="saleline__tap"> · tap to fill</small>}
                {touched(item) && item.own && <small className="saleline__tap"> · own options</small>}
              </button>
              <button type="button" className="saleline__x" aria-label={`Delete ${item.title || 'item'}`}
                onClick={() => setItems((rows) => rows.filter((row) => row.key !== item.key))}>✕</button>
            </div>
          ))}
          <button type="button" className="saleadd" aria-label="Add more items" style={{ justifySelf: 'start' }}
            onClick={() => setItems((rows) => [...rows.map((row) => ({ ...row, open: false })), { ...blankItem(fillOn ? fill : blankFill()), open: true }])}>
            <Icon name="plus" size={16} /> Add more
          </button>
        </LBox>

        <LBox icon="⏱️" title="Timing">
          <OptionTiles label="When it starts" value={startNow} onChange={setStartNow}
            options={[
              { id: 'now', icon: '▶️', title: 'Start now' },
              { id: 'later', icon: '🗓️', title: 'At a time' },
            ]} />
          {startNow === 'later' && (
            <label className="field">
              <span>The opening message is dropped in</span>
              <span className="psunit">
                <input type="number" min="0" step="0.5" value={startHours} onChange={(e) => setStartHours(e.target.value)} />
                <span>hrs from now</span>
              </span>
              <span className="field__hint">
                {startsAt.toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              </span>
            </label>
          )}
          <label className="field">
            <span>Wait for the 1st item to drop</span>
            <span className="psunit">
              <input type="number" min="30" value={lead} onChange={(e) => setLead(e.target.value)} />
              <span>min after the opening message</span>
            </span>
            <span className="field__hint">
              At least 30. The drop shows on the Buy tab with this countdown, and people can set a reminder.
            </span>
          </label>
          <div className="field-row">
            <label className="field">
              <span>Wait between each drop</span>
              <span className="psunit">
                <input type="number" min="1" value={every} onChange={(e) => setEvery(e.target.value)} />
                <span>min</span>
              </span>
            </label>
            <label className="field">
              <span>Member price</span>
              <span className="psunit">
                <input type="number" min="5" value={window_} onChange={(e) => setWindow(e.target.value)} />
                <span>min</span>
              </span>
            </label>
          </div>
        </LBox>

        {/* During the window an item is the channel's alone - that is what the
            member price is for. Once it closes the item is everybody's, and
            this is where the shop says whether to tell everybody. */}
        <LBox icon="📣" title="When the member price ends" hint="Each item goes public, labelled as an exclusive channel drop. Announce it:">
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
    </main>
  );
}
