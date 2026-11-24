import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AREA_NAMES, DID_YOU_KNOW, FIGGY, PRO_TOOLS, hourName, PRIVATE_ANSWER, TOOL_LABELS, answerOffline, coachBrief, isPrivateQuestion,
  type CoachAnswer, type CoachItem, type CoachPlan, type CoachSignals, type CoachTip, type CoachTool,
} from '@shared/coach';
import type { StoreAccess } from '@shared/stores';
import type { OwnResults } from '@shared/coach-log';
import { api } from '../api';
import { askCoachAi, warmCoachAi, type ChatTurn } from '../coachAi';
import { formatMoney } from '../format';
import { Icon, type IconName } from './Icon';
import { ProBadge, useProLocked } from './Billing';
import { shopBadge, useShareSheet, type ShareSpec } from './ShareKit';
import { Modal } from './ui';
import '../styles/ShopCoach.css';

/**
 * The shop coach: a card on the shop console with the one thing to do next,
 * and a panel behind it with the whole plan, the week's marketing and a chat.
 *
 * Every suggestion ends in a button that opens the app's own tool for it -
 * the sell form, the share sheet, the channel, Offers, Shipments - so the
 * coach never does the seller's work behind their back; it shows them where
 * and when. The rules (shared/coach.ts) cost nothing; the AI chat is opt-in
 * and runs on the seller's own free Puter account (coachAi.ts).
 */

type View = 'today' | 'week' | 'ask';

const HIDE_KEY = 'figmark:coach-folded';
const AI_KEY = 'figmark:coach-ai';

function readFlag(key: string, id: string): boolean {
  try {
    return localStorage.getItem(`${key}:${id}`) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, id: string, on: boolean) {
  try {
    localStorage.setItem(`${key}:${id}`, on ? '1' : '0');
  } catch {
    /* A private window: it lasts for this page only. */
  }
}

/** Opens a coach tool: a screen in the app, or the share sheet. */
function useCoachTools(store: StoreAccess, signals: CoachSignals | null, onLeave: () => void) {
  const navigate = useNavigate();
  const { open, sheet } = useShareSheet();
  const base = store.isOwner ? '/shop' : `/services/manage/${encodeURIComponent(store.ownerId)}`;
  const storeQuery = `store=${encodeURIComponent(store.ownerId)}`;

  const shopSpec = (): ShareSpec | null => {
    const shop = signals?.shop;
    if (!shop?.handle) return null;
    return {
      kind: 'shop',
      moment: {
        photo: shop.photoUrl, title: shop.name, detail: shop.followers ? `${shop.followers} followers` : 'Imports with Buyer Protection',
        headline: 'Shop with us', byline: `@${shop.handle} on Figmark`,
        badge: shopBadge({ storefrontName: shop.name, photoUrl: shop.photoUrl }, shop.name),
      },
      link: { to: 'page', handle: shop.handle },
      caption: `We're on Figmark 🏪 Follow ${shop.name} for pre-orders and new drops.`,
      target: shop.handle,
      storeId: store.ownerId,
    };
  };

  const itemSpec = (item: CoachItem): ShareSpec => {
    const price = formatMoney(item.priceMinor, item.currency);
    const filling = item.fill !== null && item.fill < 1;
    return {
      kind: filling ? 'fill' : 'item',
      moment: {
        photo: item.photo, title: item.title, price, seed: item.id,
        detail: filling ? 'Pre-order · Buyer Protection' : 'Buyer Protection on Figmark',
        headline: filling ? 'Join our pre-order' : 'New drop', byline: '',
        badge: signals ? shopBadge({ storefrontName: signals.shop.name, photoUrl: signals.shop.photoUrl }, signals.shop.name) : null,
      },
      link: { to: 'item', listingId: item.id, moment: filling ? 'fill' : undefined, own: true },
      caption: item.expiresAt
        ? `Last call: ${item.title} at ${price} - closing soon 👇`
        : `${item.title} at ${price} 🔥`,
      target: item.id,
      storeId: store.ownerId,
    };
  };

  const go = (to: string) => { onLeave(); navigate(to); };
  const tab = (name: string) => go(`${base}?tab=${name}`);

  const run = (tool: CoachTool, item?: CoachItem) => {
    const pro = signals?.shop.pro ?? false;
    switch (tool) {
      case 'list': case 'drafts': return go(`/sell?${storeQuery}`);
      case 'items': case 'affiliate': return tab('items');
      case 'edit_item': return item ? go(`/listing/${encodeURIComponent(item.id)}`) : tab('items');
      case 'share_shop': {
        const spec = shopSpec();
        return spec ? open(spec) : tab('storefront');
      }
      case 'share_item': {
        const pick = item ?? signals?.listings.best ?? null;
        return pick ? open(itemSpec(pick)) : tab('items');
      }
      case 'post': return go(`/social/c/${encodeURIComponent(store.ownerId)}`);
      case 'live_drop': return go(pro ? `/shop/power-sale?${storeQuery}` : '/pro');
      case 'offers': return tab('offers');
      case 'loyalty': return tab('loyalty');
      case 'engage': return tab('engage');
      case 'orders': return tab('payments');
      case 'refunds': return tab('refunds');
      case 'lots': {
        // Straight to what still needs filing, as the "not in a lot" chip does.
        const unlotted = (signals?.orders?.noLot ?? 0) + (signals?.listings.importsNoLot ?? 0) > 0;
        return go(`${base}?tab=lots${unlotted ? '&view=unlotted' : ''}`);
      }
      case 'routes': return tab('routes');
      case 'storefront': return tab('storefront');
      case 'templates': return tab('templates');
      case 'insights': return tab('overview');
      case 'customers': return tab('customers');
      case 'money': return tab('analytics');
      case 'calculator': return tab('calculator');
      case 'quests': return go('/quests');
      case 'pro': return go('/pro');
      case 'learn': return go('/learn');
      case 'verify': return go('/verify');
      case 'forwarders': return go('/services/forwarder');
    }
  };

  return { run, sheet };
}

/** A tool's button, marked Pro where the shop does not have it. */
function ToolButton({ tool, label, pro, onRun, quiet }: {
  tool: CoachTool; label?: string; pro: boolean; onRun: () => void; quiet?: boolean;
}) {
  const locked = !pro && PRO_TOOLS.includes(tool);
  return (
    <button type="button" className={`btn btn--sm shopcoach__go${quiet ? ' btn--quiet' : ''}`} onClick={onRun}>
      {label ?? TOOL_LABELS[tool]}
      {locked && <span className="probadge">PRO</span>}
    </button>
  );
}

/** Each kind of tip wears its own drawn icon, in its own tint. */
const AREA_ICONS: Record<CoachTip['area'], IconName> = {
  urgent: 'bell', listing: 'tag', marketing: 'megaphone', sales: 'rising', shop: 'home',
};

function AreaMark({ area }: { area: CoachTip['area'] }) {
  return (
    <span className={`shopcoach__areamark shopcoach__areamark--${area}`} title={AREA_NAMES[area]}>
      <Icon name={AREA_ICONS[area]} size={16} />
      <span className="sr-only">{AREA_NAMES[area]}: </span>
    </span>
  );
}

function TipRow({ tip, pro, onRun }: { tip: CoachTip; pro: boolean; onRun: () => void }) {
  return (
    <li className="shopcoach__tip">
      <AreaMark area={tip.area} />
      <div className="shopcoach__tiptext">
        <b>{tip.title}</b>
        <p>{tip.why}</p>
      </div>
      <ToolButton tool={tip.tool} label={tip.label} pro={pro} onRun={onRun} quiet={tip.area !== 'urgent'} />
    </li>
  );
}

/**
 * The card on the console: the headline and the first thing to do, folded to
 * one line once the seller says so. A Pro tool: a shop without Pro sees what
 * it does and how to unlock it, and the server refuses the coach's data too.
 */
type CoachData = Awaited<ReturnType<typeof api.coach>>;

/*
 * Fast to show. The last answer for each shop is kept for this tab (memory,
 * then sessionStorage), so the card draws at once and refreshes behind it;
 * and the read starts as the console opens, alongside the Pro check, rather
 * than after it.
 */
const CACHE_KEY = 'figmark:coach-data';
const remembered = new Map<string, CoachData>();
const reading = new Map<string, Promise<CoachData>>();

function cachedCoach(id: string): CoachData | null {
  const held = remembered.get(id);
  if (held) return held;
  try {
    const raw = sessionStorage.getItem(`${CACHE_KEY}:${id}`);
    if (raw) {
      const data = JSON.parse(raw) as CoachData;
      remembered.set(id, data);
      return data;
    }
  } catch {
    /* Private window or a full store: just no head start. */
  }
  return null;
}

function keepCoach(id: string, data: CoachData) {
  remembered.set(id, data);
  try {
    sessionStorage.setItem(`${CACHE_KEY}:${id}`, JSON.stringify(data));
  } catch {
    /* As above. */
  }
}

/** One read per shop at a time, however many places ask. */
function readCoach(id: string): Promise<CoachData> {
  let read = reading.get(id);
  if (!read) {
    read = api.coach(id).then((data) => { keepCoach(id, data); return data; })
      .finally(() => reading.delete(id));
    reading.set(id, read);
  }
  return read;
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function ShopCoach({ store }: { store: StoreAccess }) {
  // Start the read now; a shop without Pro is simply refused, and nothing shows it.
  useEffect(() => { void readCoach(store.ownerId).catch(() => undefined); }, [store.ownerId]);
  const locked = useProLocked('coach', store.ownerId);
  if (locked === null) return null;
  return locked ? <CoachLocked store={store} /> : <CoachCard store={store} />;
}

function CoachLocked({ store }: { store: StoreAccess }) {
  const navigate = useNavigate();
  const [folded, setFolded] = useState(() => readFlag(HIDE_KEY, store.ownerId));
  const fold = (next: boolean) => { setFolded(next); writeFlag(HIDE_KEY, store.ownerId, next); };
  if (folded) {
    return (
      <button type="button" className="shopcoach shopcoach--folded" onClick={() => fold(false)}>
        <span className="shopcoach__mark" aria-hidden="true"><Icon name="spark" size={14} /></span>
        <span>Shop coach and {FIGGY} - part of Pro</span>
        <Icon name="down" size={14} />
      </button>
    );
  }
  return (
    <section className="shopcoach shopcoach--locked" aria-label="Shop coach, part of Pro">
      <div className="shopcoach__head">
        <span className="shopcoach__mark" aria-hidden="true"><Icon name="spark" size={16} /></span>
        <div className="shopcoach__headtext">
          <h2 className="shopcoach__title">Shop coach <ProBadge title="Part of Pro" /></h2>
          <p>AI-powered shop assistance that helps you market and grow your shop, with simple plans and clear actions to take.</p>
        </div>
        <button type="button" className="iconbtn shopcoach__fold" aria-label="Fold the coach" title="Fold" onClick={() => fold(true)}>
          <Icon name="up" size={14} />
        </button>
      </div>
      <ul className="shopcoach__perks">
        <li><Icon name="check" size={14} /> Marketing ideas and a weekly plan</li>
        <li><Icon name="check" size={14} /> {FIGGY}, an AI chatbot that answers your questions</li>
        <li><Icon name="check" size={14} /> A daily recommendation for your next best step, based on your shop's data</li>
      </ul>
      <button type="button" className="btn shopcoach__unlock" onClick={() => navigate('/pro')}>
        <Icon name="lock" size={14} /> Unlock with Pro
      </button>
    </section>
  );
}

function CoachCard({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<CoachData | null>(() => cachedCoach(store.ownerId));
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<View | null>(null);
  const [folded, setFolded] = useState(() => readFlag(HIDE_KEY, store.ownerId));
  // Where the page was when the panel opened, so closing it puts the seller back there.
  const scrollAt = useRef(0);

  const load = useCallback(() => {
    void readCoach(store.ownerId)
      .then((next) => { setData(next); setFailed(false); })
      // A refresh that fails keeps what is on screen; only a coach with nothing to show hides.
      .catch(() => setFailed(!cachedCoach(store.ownerId)));
  }, [store.ownerId]);
  useEffect(load, [load]);

  const show = (view: View | null) => {
    if (view && !open) scrollAt.current = window.scrollY;
    setOpen(view);
  };
  const close = () => {
    setOpen(null);
    const at = scrollAt.current;
    requestAnimationFrame(() => window.scrollTo({ top: at, behavior: 'instant' as ScrollBehavior }));
    load();
  };

  const { run, sheet } = useCoachTools(store, data?.signals ?? null, () => setOpen(null));

  /* What was on screen, so a tip's week can be measured. Never in the way:
     a record that fails to send costs nothing on screen. */
  const record = useCallback((body: { seen?: string[]; pressed?: string }) => {
    void api.coachEvents(store.ownerId, body).catch(() => undefined);
  }, [store.ownerId]);
  const topId = data?.plan.tips[0]?.id;
  useEffect(() => {
    if (topId && !folded) record({ seen: [topId] });
  }, [topId, folded, record]);
  const press = (tip: CoachTip) => { record({ pressed: tip.id }); run(tip.tool, tip.item); };
  // A coach that cannot read the shop says nothing rather than something wrong.
  if (failed || !data) return null;
  const { plan, signals } = data;
  const top = plan.tips[0];
  const fold = (next: boolean) => { setFolded(next); writeFlag(HIDE_KEY, store.ownerId, next); };

  return (
    <>
      {folded ? (
        <button type="button" className="shopcoach shopcoach--folded" onClick={() => { fold(false); }}>
          <span className="shopcoach__mark" aria-hidden="true"><Icon name="spark" size={14} /></span>
          <span>{top ? top.title : 'Shop coach'}</span>
          <Icon name="down" size={14} />
        </button>
      ) : (
        <section className="shopcoach" aria-label="Shop coach">
          <div className="shopcoach__head">
            <span className="shopcoach__mark" aria-hidden="true"><Icon name="spark" size={16} /></span>
            <div className="shopcoach__headtext">
              <h2 className="shopcoach__title">Shop coach <ProBadge title="Part of Pro" /></h2>
              <p>{plan.headline}</p>
            </div>
            <button type="button" className="iconbtn shopcoach__fold" aria-label="Fold the coach" title="Fold" onClick={() => fold(true)}>
              <Icon name="up" size={14} />
            </button>
          </div>
          {top && (
            <div className="shopcoach__next">
              <AreaMark area={top.area} />
              <div className="shopcoach__tiptext">
                <b>{top.title}</b>
                <p>{top.why}</p>
              </div>
              <ToolButton tool={top.tool} label={top.label} pro={signals.shop.pro} onRun={() => press(top)} />
            </div>
          )}
          <DidYouKnowStrip pro={signals.shop.pro} run={run} />
          <div className="shopcoach__acts">
            <button type="button" className="shopcoach__act" onClick={() => show('today')}>
              <Icon name="check" size={14} /><span>{plan.tips.length > 1 ? `All ${plan.tips.length} tips` : 'Full plan'}</span>
            </button>
            <button type="button" className="shopcoach__act" onClick={() => show('week')}>
              <Icon name="bell" size={14} /><span>Post by {hourName(plan.bestTime.postHour)}</span>
            </button>
            <button type="button" className="shopcoach__act" onClick={() => show('ask')}>
              <Icon name="message" size={14} /><span>Ask {FIGGY}</span>
            </button>
          </div>
        </section>
      )}
      {open && (
        <Modal title="Shop coach" layout="panel" onClose={close} badge={<ProBadge title="Part of Pro" />}>
          <CoachPanel store={store} signals={signals} plan={plan} results={data.results} guides={data.learned?.guides ?? {}}
            view={open} onView={show} run={run} press={press} record={record} />
        </Modal>
      )}
      {sheet}
    </>
  );
}

/**
 * One small fact about Figmark's own tools, with arrows to the rest. Starts on
 * a different one each day, so the card has something new without anyone
 * pressing anything.
 */
function DidYouKnowStrip({ pro, run }: { pro: boolean; run: (tool: CoachTool) => void }) {
  const total = DID_YOU_KNOW.length;
  const [at, setAt] = useState(() => Math.floor(Date.now() / 86_400_000) % total);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);
  const tip = DID_YOU_KNOW[at]!;
  const step = (by: number) => { setDir(by > 0 ? 'next' : 'prev'); setAt((now) => (now + by + total) % total); };
  return (
    <section className="shopcoach__dyk" aria-label="Did you know?" aria-roledescription="carousel">
      <span className="shopcoach__dykmark" aria-hidden="true"><Icon name="spark" size={15} /></span>
      <div key={at} className={`shopcoach__dyktext${dir ? ` shopcoach__dyktext--${dir}` : ''}`} aria-live="polite">
        <b>Did you know?</b>
        <p>{tip.text}</p>
        {tip.tool && (
          <button type="button" className="shopcoach__dyklink" onClick={() => run(tip.tool!)}>
            {TOOL_LABELS[tip.tool]}{!pro && PRO_TOOLS.includes(tip.tool) && <span className="probadge">PRO</span>}
            <Icon name="right" size={12} />
          </button>
        )}
      </div>
      <div className="shopcoach__dyknav">
        <button type="button" aria-label="Previous tip" onClick={() => step(-1)}><Icon name="left" size={14} /></button>
        <span aria-label={`Tip ${at + 1} of ${total}`}>{at + 1}/{total}</span>
        <button type="button" aria-label="Next tip" onClick={() => step(1)}><Icon name="right" size={14} /></button>
      </div>
    </section>
  );
}

/**
 * Shop health in colour: the number counts up and the marker slides along a
 * red-to-green scale as the panel opens - the one moment of motion here.
 */
function HealthScore({ health, tone }: { health: number; tone: 'good' | 'fair' | 'low' }) {
  const still = reducedMotion();
  const [shown, setShown] = useState(still ? health : 0);
  useEffect(() => {
    if (still) { setShown(health); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      // Ease out: quick at first, settling on the number.
      setShown(Math.round(health * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [health, still]);
  const label = tone === 'good' ? 'Strong' : tone === 'fair' ? 'Getting there' : 'Needs work';
  // Says what the score means - not the urgent-or-not headline, which can read
  // "all good" beside a low score.
  const meaning = tone === 'good'
    ? 'Your shop is in great shape. Keep following the plan.'
    : tone === 'fair'
      ? 'A good start. The tips below will raise your score.'
      : 'Some basics are missing. Do the tips below to raise your score.';
  return (
    <div className={`shopcoach__health shopcoach__health--${tone}`}>
      <div className="shopcoach__score">
        <span className="shopcoach__ring"><b className={`shopcoach__num shopcoach__num--${tone}`}>{shown}</b></span>
        <span>shop health</span>
      </div>
      <div className="shopcoach__healthtext">
        <span className={`shopcoach__tone shopcoach__tone--${tone}`}>{label}</span>
        <div className="shopcoach__scale" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={health} aria-label="Shop health">
          <i style={{ left: `${shown}%` }} />
        </div>
        <p>{meaning}</p>
      </div>
    </div>
  );
}

function CoachPanel({ store, signals, plan, results, guides, view, onView, run, press, record }: {
  store: StoreAccess;
  signals: CoachSignals;
  plan: CoachPlan;
  results: OwnResults | null;
  guides: Record<string, number>;
  view: View;
  onView: (view: View) => void;
  run: (tool: CoachTool, item?: CoachItem) => void;
  press: (tip: CoachTip) => void;
  record: (body: { seen?: string[] }) => void;
}) {
  const pro = signals.shop.pro;
  const tipIds = plan.tips.map((tip) => tip.id).join(',');
  useEffect(() => {
    if (view === 'today' && tipIds) record({ seen: tipIds.split(',') });
  }, [view, tipIds, record]);
  const tone = plan.health >= 75 ? 'good' : plan.health >= 45 ? 'fair' : 'low';
  return (
    <div className={`shopcoach__panel shopcoach__panel--${view}`}>
      <div className="seg shopcoach__seg" role="tablist" aria-label="Coach">
        {([['today', 'Today'], ['week', 'This week'], ['ask', `Ask ${FIGGY}`]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'is-on' : ''}
            onClick={() => onView(id)}>{label}</button>
        ))}
      </div>

      {view === 'today' && (
        <>
          <HealthScore health={plan.health} tone={tone} />
          {plan.tips.length > 0 ? (
            <ul className="shopcoach__tips">
              {plan.tips.map((tip) => <TipRow key={tip.id} tip={tip} pro={pro} onRun={() => press(tip)} />)}
            </ul>
          ) : <p className="shopcoach__empty">Nothing to fix. Follow the weekly plan.</p>}
          {results && <Results results={results} />}
        </>
      )}

      {view === 'week' && (
        <>
          <div className="shopcoach__when">
            <span className="shopcoach__whenmark" aria-hidden="true"><Icon name="bell" size={18} /></span>
            <div>
              <b>{plan.bestTime.fromShop ? 'Your busy time' : 'Usual busy time'}: {plan.bestTime.window}, {plan.bestTime.dayName}s</b>
              <p>{plan.bestTime.advice}</p>
            </div>
          </div>
          {signals.timing.sample >= 1 && <HourBars hours={signals.timing.hours} peak={plan.bestTime.peakHour} />}
          <ol className="shopcoach__week">
            {plan.week.map((day) => (
              <li key={day.day} className={day.isToday ? 'is-today' : ''}>
                <div className="shopcoach__day">
                  <b>{day.isToday ? 'Today' : day.dayName.slice(0, 3)}</b>
                  <span>{day.at}</span>
                </div>
                <div className="shopcoach__tiptext">
                  <b>{day.title}</b>
                  <p>{day.detail}</p>
                </div>
                <ToolButton tool={day.tool} pro={pro} quiet={!day.isToday} onRun={() => run(day.tool)} />
              </li>
            ))}
          </ol>
        </>
      )}

      {view === 'ask' && <CoachChat store={store} signals={signals} plan={plan} guides={guides} run={run} />}
    </div>
  );
}

/**
 * What the tips did for this shop: its own record, nothing from any other
 * shop. Each tip is given a week; until then it is "watching".
 */
function Results({ results }: { results: OwnResults }) {
  if (results.settled === 0) {
    return (
      <section className="shopcoach__results" aria-label="Did the tips help?">
        <h3>Did the tips help?</h3>
        <p className="shopcoach__muted">
          Use a tip. After one week, you will see here what changed: views, orders and sales.
          {results.watching > 0 && ` ${results.watching} tip${results.watching === 1 ? ' is' : 's are'} being checked now.`}
        </p>
      </section>
    );
  }
  const { acted, actedSalesBefore: before, actedSalesAfter: after } = results;
  return (
    <section className="shopcoach__results" aria-label="Did the tips help?">
      <h3>Did the tips help? <span>last 90 days</span></h3>
      <p className="shopcoach__muted">
        You used <b>{acted}</b> of {results.settled} tips.
        {acted > 0 && <> One week after, you had <b>{after}</b> order{after === 1 ? '' : 's'} ({before} the week before).</>}
      </p>
      <ul className="shopcoach__outcomes">
        {results.recent.map((entry) => (
          <li key={`${entry.firstSeen}:${entry.title}`}>
            <span className={`shopcoach__badge${entry.pressed ? ' is-acted' : ''}`}>{entry.pressed ? 'Used' : 'Skipped'}</span>
            <div className="shopcoach__tiptext">
              <b>{entry.title}</b>
              <p>{entry.summary}{entry.cleared ? ' Fixed.' : ''}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Orders by Indian hour, so "post at 7 pm" has something to stand on. */
function HourBars({ hours, peak }: { hours: number[]; peak: number }) {
  const top = Math.max(1, ...hours);
  return (
    <div className="shopcoach__hours" role="img" aria-label="Orders by hour of day, busiest hours highlighted">
      <div className="shopcoach__bars">
        {hours.map((value, hour) => (
          <span key={hour} className={hour === peak || hour === (peak + 1) % 24 ? 'is-peak' : ''}
            title={`${hour}:00 - ${value} order${value === 1 ? '' : 's'}`}>
            <i style={{ transform: `scaleY(${Math.max(0.04, value / top)})` }} />
          </span>
        ))}
      </div>
      <div className="shopcoach__hourlabels" aria-hidden="true"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span></div>
    </div>
  );
}

/** A drawn thumb, up or down, in the app's icon stroke. */
function Thumb({ down = false }: { down?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" style={down ? { transform: 'rotate(180deg)' } : undefined}>
      <path d="M7 10v11" />
      <path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H7V10l4.3-7.2A1.7 1.7 0 0 1 14.4 3a1.9 1.9 0 0 1 .6 2.9Z" />
      <path d="M7 10H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
    </svg>
  );
}

type Assistant = 'figgy' | 'puter';

interface Said {
  role: 'user' | 'assistant';
  text: string;
  tools?: CoachTool[];
  follow?: string[];
  /** Who answered, what kind of answer it was, and the question it answered. */
  by?: Assistant;
  source?: string;
  question?: string;
  vote?: 'up' | 'down';
}

const STARTERS = ['What should I do today?', 'How do I get more buyers?', 'How do I sell on WhatsApp and Instagram?', 'What can you help with?'];

const ASSISTANTS: Record<Assistant, { name: string; blurb: string; icon: IconName }> = {
  figgy: { name: FIGGY, blurb: 'Instant · knows your shop', icon: 'spark' },
  puter: { name: 'Puter AI', blurb: 'Free · needs a Puter sign-in', icon: 'message' },
};

function CoachChat({ store, signals, plan, guides, run }: {
  store: StoreAccess; signals: CoachSignals; plan: CoachPlan; guides: Record<string, number>;
  run: (tool: CoachTool, item?: CoachItem) => void;
}) {
  const [said, setSaid] = useState<Said[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState<Assistant>(() => (readFlag(AI_KEY, store.ownerId) ? 'puter' : 'figgy'));
  // The picker shows under the box once it is clicked, as in Claude.
  const [engaged, setEngaged] = useState(false);
  const [picking, setPicking] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  // Which question is current: a Stop, or a newer question, makes a late answer stale.
  const turn = useRef(0);

  useEffect(() => { if (who === 'puter') warmCoachAi(); }, [who]);
  // Scroll the conversation only. scrollIntoView also scrolled the page behind
  // the panel, which is why the page sat at the bottom after it closed.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [said, busy]);
  useEffect(() => {
    if (!picking) return;
    const away = (event: Event) => { if (!picker.current?.contains(event.target as Node)) setPicking(false); };
    // Escape closes the picker only, not the coach panel around it (that listens on window).
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setPicking(false); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [picking]);

  const choose = (next: Assistant) => { setWho(next); writeFlag(AI_KEY, store.ownerId, next === 'puter'); setPicking(false); };
  const report = (body: { source: string; helpful: boolean } | { missed: string }) => {
    void api.coachAnswer(store.ownerId, body).catch(() => undefined);
  };

  async function ask(question: string, using: Assistant = who) {
    const text = question.trim();
    if (!text || busy) return;
    const mine = ++turn.current;
    const history = [...said, { role: 'user' as const, text }];
    setSaid(history);
    setDraft('');
    // Declined the same way by either assistant, and never sent to Puter.
    if (using === 'figgy' || isPrivateQuestion(text)) {
      const answer = isPrivateQuestion(text) ? PRIVATE_ANSWER : answerOffline(text, plan, guides);
      setSaid([...history, { role: 'assistant', ...answer, by: 'figgy', question: text }]);
      // Nothing matched: its words are counted, so staff can see what guide to write next.
      if (answer.source === 'menu') report({ missed: text });
      return;
    }
    setBusy(true);
    try {
      const turns: ChatTurn[] = history.map((entry) => ({ role: entry.role, content: entry.text }));
      const answer: CoachAnswer = await askCoachAi(coachBrief(signals, plan), turns);
      if (mine !== turn.current) return;
      setSaid([...history, { role: 'assistant', ...answer, by: 'puter', source: 'puter', question: text }]);
    } catch (err) {
      if (mine !== turn.current) return;
      // Figgy answers instead, and says why.
      const fallback = answerOffline(text, plan, guides);
      const reason = err instanceof Error ? err.message : 'Puter AI could not answer - Figgy has answered instead.';
      setSaid([...history, { role: 'assistant', ...fallback, text: `${reason}\n\n${fallback.text}`, by: 'figgy', question: text }]);
    } finally {
      if (mine === turn.current) setBusy(false);
    }
  }

  /** Gives up on Puter's answer: the chat is free again at once. */
  function stop() {
    turn.current += 1;
    setBusy(false);
    setSaid((now) => [...now, { role: 'assistant', text: 'Stopped. Ask again, or switch to Figgy for a quick answer.', by: 'figgy' }]);
  }

  function vote(index: number, helpful: boolean) {
    const entry = said[index];
    if (!entry || entry.vote || !entry.source) return;
    report({ source: entry.source, helpful });
    setSaid(said.map((item, at) => (at === index ? { ...item, vote: helpful ? 'up' : 'down' } : item)));
  }

  const submit = (event: FormEvent) => { event.preventDefault(); if (busy) stop(); else void ask(draft); };
  const last = said[said.length - 1];
  const chips = busy ? [] : last?.role === 'assistant' && last.follow?.length ? last.follow : said.length === 0 ? STARTERS : [];

  return (
    <div className="shopcoach__chat">
      <div className="shopcoach__log" ref={log} aria-live="polite">
        {said.length === 0 && (
          <div className="shopcoach__hello">
            <span className="shopcoach__mark" aria-hidden="true"><Icon name="spark" size={18} /></span>
            <p>
              <b>Hi, I'm {FIGGY}, the Figmark Coach.</b> I know {signals.shop.name}'s listings, orders and timing. Ask how to list, price, ship or run a pre-order - or how to bring in buyers, grow your business or market your products.
            </p>
          </div>
        )}
        {said.map((entry, index) => {
          const other: Assistant = entry.by === 'puter' ? 'figgy' : 'puter';
          return (
            <div key={index} className={`shopcoach__msg shopcoach__msg--${entry.role}`}>
              <p>{entry.text}</p>
              {entry.tools && entry.tools.length > 0 && (
                <div className="shopcoach__msgacts">
                  {entry.tools.map((tool) => <ToolButton key={tool} tool={tool} pro={signals.shop.pro} quiet onRun={() => run(tool)} />)}
                </div>
              )}
              {entry.role === 'assistant' && entry.by && (
                <div className="shopcoach__by">
                  <span>{ASSISTANTS[entry.by].name}{entry.by === 'puter' ? ' · check before you act' : ''}</span>
                  {entry.source && entry.source !== 'private' && (entry.vote ? (
                    <span className="shopcoach__thanks">{entry.vote === 'up' ? 'Thanks!' : 'Thanks. This helps Figgy get better.'}</span>
                  ) : (
                    <span className="shopcoach__votes">
                      <button type="button" aria-label="Helpful" title="Helpful" onClick={() => vote(index, true)}><Thumb /></button>
                      <button type="button" aria-label="Not helpful" title="Not helpful" onClick={() => vote(index, false)}><Thumb down /></button>
                    </span>
                  ))}
                </div>
              )}
              {entry.vote === 'down' && entry.question && index === said.length - 1 && (
                <button type="button" className="chip shopcoach__retry" onClick={() => { choose(other); void ask(entry.question!, other); }}>
                  Ask {ASSISTANTS[other].name} instead
                </button>
              )}
            </div>
          );
        })}
        {busy && <div className="shopcoach__msg shopcoach__msg--assistant shopcoach__typing" aria-label="Puter AI is writing"><i /><i /><i /></div>}
      </div>

      <div className="shopcoach__compose">
        {chips.length > 0 && (
          <div className="shopcoach__chips">
            {chips.map((chip) => <button key={chip} type="button" className="chip" onClick={() => void ask(chip)}>{chip}</button>)}
          </div>
        )}

        <form className="shopcoach__form" onSubmit={submit}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500}
            onFocus={() => setEngaged(true)} onPointerDown={() => setEngaged(true)}
            placeholder={`Ask ${ASSISTANTS[who].name} anything…`} aria-label={`Ask ${ASSISTANTS[who].name}`} />
          {busy ? (
            <button type="submit" className="btn btn--sm btn--quiet shopcoach__send" aria-label="Stop">
              <span className="shopcoach__stop" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="btn btn--sm shopcoach__send" aria-label="Send" aria-disabled={!draft.trim()}>
              <Icon name="send" size={16} />
            </button>
          )}
        </form>

        {(engaged || who === 'puter' || said.length > 0) && (
          <div className="shopcoach__picker" ref={picker}>
            <button type="button" className="shopcoach__pick" aria-haspopup="listbox" aria-expanded={picking}
              onClick={() => setPicking(!picking)}>
              <span className={`shopcoach__who shopcoach__who--${who}`} aria-hidden="true"><Icon name={ASSISTANTS[who].icon} size={11} /></span>
              {ASSISTANTS[who].name} <Icon name="down" size={12} />
            </button>
            {picking && (
              <div className="shopcoach__menu" role="listbox" aria-label="Who answers">
                {(['figgy', 'puter'] as const).map((id) => (
                  <button key={id} type="button" role="option" aria-selected={who === id}
                    className={`shopcoach__option${who === id ? ' is-on' : ''}`} onClick={() => choose(id)}>
                    <span className={`shopcoach__who shopcoach__who--${id}`} aria-hidden="true"><Icon name={ASSISTANTS[id].icon} size={14} /></span>
                    <span className="shopcoach__optiontext">
                      <b>{ASSISTANTS[id].name}</b>
                      <span>{ASSISTANTS[id].blurb}</span>
                    </span>
                    {who === id && <Icon name="check" size={16} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
