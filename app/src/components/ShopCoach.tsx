import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AREA_NAMES, PRO_TOOLS, TOOL_LABELS, answerOffline, coachBrief,
  type CoachAnswer, type CoachItem, type CoachPlan, type CoachSignals, type CoachTip, type CoachTool,
} from '@shared/coach';
import type { StoreAccess } from '@shared/stores';
import { api } from '../api';
import { askCoachAi, warmCoachAi, type ChatTurn } from '../coachAi';
import { formatMoney } from '../format';
import { Icon } from './Icon';
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
    <button type="button" className={`btn btn--sm${quiet ? ' btn--quiet' : ''}`} onClick={onRun}>
      {label ?? TOOL_LABELS[tool]}
      {locked && <span className="probadge">PRO</span>}
    </button>
  );
}

function TipRow({ tip, pro, onRun }: { tip: CoachTip; pro: boolean; onRun: () => void }) {
  return (
    <li className={`shopcoach__tip shopcoach__tip--${tip.area}`}>
      <div className="shopcoach__tiptext">
        <span className="shopcoach__area">{AREA_NAMES[tip.area]}</span>
        <b>{tip.title}</b>
        <p>{tip.why}</p>
      </div>
      <ToolButton tool={tip.tool} label={tip.label} pro={pro} onRun={onRun} quiet={tip.area !== 'urgent'} />
    </li>
  );
}

/**
 * The card on the console: the headline and the first thing to do, folded to
 * one line once the seller says so.
 */
export function ShopCoach({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<{ signals: CoachSignals; plan: CoachPlan } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<View | null>(null);
  const [folded, setFolded] = useState(() => readFlag(HIDE_KEY, store.ownerId));

  const load = useCallback(() => {
    void api.coach(store.ownerId)
      .then((next) => { setData(next); setFailed(false); })
      .catch(() => setFailed(true));
  }, [store.ownerId]);
  useEffect(load, [load]);

  const { run, sheet } = useCoachTools(store, data?.signals ?? null, () => setOpen(null));
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
          <span>Coach{top ? `: ${top.title}` : ''}</span>
          <Icon name="down" size={14} />
        </button>
      ) : (
        <section className="shopcoach" aria-label="Shop coach">
          <div className="shopcoach__head">
            <span className="shopcoach__mark" aria-hidden="true"><Icon name="spark" size={16} /></span>
            <div className="shopcoach__headtext">
              <b>Shop coach</b>
              <span>{plan.headline}</span>
            </div>
            <button type="button" className="iconbtn shopcoach__fold" aria-label="Fold the coach" title="Fold" onClick={() => fold(true)}>
              <Icon name="up" size={14} />
            </button>
          </div>
          {top && (
            <div className="shopcoach__next">
              <div>
                <b>{top.title}</b>
                <p>{top.why}</p>
              </div>
              <ToolButton tool={top.tool} label={top.label} pro={signals.shop.pro} onRun={() => run(top.tool, top.item)} />
            </div>
          )}
          <div className="shopcoach__acts">
            <button type="button" className="btn btn--sm btn--quiet" onClick={() => setOpen('today')}>
              {plan.tips.length > 1 ? `All ${plan.tips.length} tips` : 'Full plan'}
            </button>
            <button type="button" className="btn btn--sm btn--quiet" onClick={() => setOpen('week')}>
              Post at {plan.bestTime.window}
            </button>
            <button type="button" className="btn btn--sm btn--quiet" onClick={() => setOpen('ask')}>
              <Icon name="message" size={14} /> Ask the coach
            </button>
          </div>
        </section>
      )}
      {open && (
        <Modal title="Shop coach" layout="panel" onClose={() => { setOpen(null); load(); }}>
          <CoachPanel store={store} signals={signals} plan={plan} view={open} onView={setOpen} run={run} />
        </Modal>
      )}
      {sheet}
    </>
  );
}

function CoachPanel({ store, signals, plan, view, onView, run }: {
  store: StoreAccess;
  signals: CoachSignals;
  plan: CoachPlan;
  view: View;
  onView: (view: View) => void;
  run: (tool: CoachTool, item?: CoachItem) => void;
}) {
  const pro = signals.shop.pro;
  return (
    <div className="shopcoach__panel">
      <div className="seg shopcoach__seg" role="tablist" aria-label="Coach">
        {([['today', 'Today'], ['week', 'This week'], ['ask', 'Ask']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'is-on' : ''}
            onClick={() => onView(id)}>{label}</button>
        ))}
      </div>

      {view === 'today' && (
        <>
          <div className="shopcoach__health">
            <div className="shopcoach__meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.health}
              aria-label="Shop health">
              <span style={{ transform: `scaleX(${plan.health / 100})` }} />
            </div>
            <span><b>{plan.health}</b>/100 shop health</span>
          </div>
          <p className="shopcoach__lead">{plan.headline}</p>
          {plan.tips.length > 0 ? (
            <ul className="shopcoach__tips">
              {plan.tips.map((tip) => <TipRow key={tip.id} tip={tip} pro={pro} onRun={() => run(tip.tool, tip.item)} />)}
            </ul>
          ) : <p className="shopcoach__empty">Nothing needs fixing. Keep to the weekly plan.</p>}
        </>
      )}

      {view === 'week' && (
        <>
          <div className="shopcoach__when">
            <Icon name="bell" size={16} />
            <div>
              <b>{plan.bestTime.fromShop ? 'Your buyers\' rush' : 'The usual rush'}: {plan.bestTime.window}, {plan.bestTime.dayName}s</b>
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

      {view === 'ask' && <CoachChat store={store} signals={signals} plan={plan} run={run} />}
    </div>
  );
}

/** Orders by Indian hour, so "post at 7 pm" has something to stand on. */
function HourBars({ hours, peak }: { hours: number[]; peak: number }) {
  const top = Math.max(1, ...hours);
  return (
    <div className="shopcoach__hours" aria-label="Orders by hour of day">
      {hours.map((value, hour) => (
        <span key={hour} className={hour === peak || hour === (peak + 1) % 24 ? 'is-peak' : ''}
          title={`${hour}:00 - ${value} order${value === 1 ? '' : 's'}`}>
          <i style={{ transform: `scaleY(${Math.max(0.04, value / top)})` }} />
        </span>
      ))}
      <div className="shopcoach__hourlabels" aria-hidden="true"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span></div>
    </div>
  );
}

interface Said { role: 'user' | 'assistant'; text: string; tools?: CoachTool[]; follow?: string[]; ai?: boolean }

const STARTERS = ['What should I do today?', 'When should I post?', 'How do I get more buyers?', 'How do I list an item?'];

function CoachChat({ store, signals, plan, run }: {
  store: StoreAccess; signals: CoachSignals; plan: CoachPlan; run: (tool: CoachTool, item?: CoachItem) => void;
}) {
  const [said, setSaid] = useState<Said[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(() => readFlag(AI_KEY, store.ownerId));
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (ai) warmCoachAi(); }, [ai]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [said, busy]);

  const toggleAi = (on: boolean) => { setAi(on); writeFlag(AI_KEY, store.ownerId, on); };

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history = [...said, { role: 'user' as const, text }];
    setSaid(history);
    setDraft('');
    if (!ai) {
      const answer = answerOffline(text, plan);
      setSaid([...history, { role: 'assistant', ...answer }]);
      return;
    }
    setBusy(true);
    try {
      const turns: ChatTurn[] = history.map((entry) => ({ role: entry.role, content: entry.text }));
      const answer: CoachAnswer = await askCoachAi(coachBrief(signals, plan), turns);
      setSaid([...history, { role: 'assistant', ...answer, ai: true }]);
    } catch (err) {
      // The built-in coach answers instead, and says why.
      const fallback = answerOffline(text, plan);
      const reason = err instanceof Error ? err.message : 'The AI coach could not answer.';
      setSaid([...history, { role: 'assistant', ...fallback, text: `${reason}\n\n${fallback.text}` }]);
    } finally {
      setBusy(false);
    }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void ask(draft); };
  const last = said[said.length - 1];
  const chips = last?.role === 'assistant' && last.follow?.length ? last.follow : said.length === 0 ? STARTERS : [];

  return (
    <div className="shopcoach__chat">
      <label className="shopcoach__aiswitch">
        <input type="checkbox" checked={ai} onChange={(event) => toggleAi(event.target.checked)} />
        <span>
          <b>AI chat</b> - free, through your own Puter account.
          {ai ? ' Only your shop\'s counts are sent, never a buyer\'s details.' : ' Off: the built-in coach answers instantly, offline.'}
        </span>
      </label>

      <div className="shopcoach__log" aria-live="polite">
        {said.length === 0 && (
          <p className="shopcoach__hello">
            Hi! I know {signals.shop.name}'s listings, orders and timing. Ask how to list, price, ship, run a pre-order or market the shop - or what to do today.
          </p>
        )}
        {said.map((entry, index) => (
          <div key={index} className={`shopcoach__msg shopcoach__msg--${entry.role}`}>
            <p>{entry.text}</p>
            {entry.tools && entry.tools.length > 0 && (
              <div className="shopcoach__msgacts">
                {entry.tools.map((tool) => <ToolButton key={tool} tool={tool} pro={signals.shop.pro} quiet onRun={() => run(tool)} />)}
              </div>
            )}
            {entry.ai && <span className="shopcoach__by">AI · check before you act</span>}
          </div>
        ))}
        {busy && <div className="shopcoach__msg shopcoach__msg--assistant shopcoach__typing" aria-label="The coach is writing"><i /><i /><i /></div>}
        <div ref={end} />
      </div>

      {chips.length > 0 && (
        <div className="shopcoach__chips">
          {chips.map((chip) => <button key={chip} type="button" className="chip" onClick={() => void ask(chip)}>{chip}</button>)}
        </div>
      )}

      <form className="shopcoach__form" onSubmit={submit}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500}
          placeholder="Ask about listing, orders, marketing…" aria-label="Ask the coach" />
        <button type="submit" className="btn btn--sm" disabled={busy} aria-label="Send">
          <Icon name="send" size={16} />
        </button>
      </form>
    </div>
  );
}
