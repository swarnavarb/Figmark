import { useEffect, useState } from 'react';
import { PAUSE_MAX_DAYS, timeLeft } from '@shared/shop-status';
import { ApiRequestError, api, type ShopStatusView } from '../api';
import { useToast } from './Feedback';
import { haptic } from '../haptics';

type State = ShopStatusView['state'];

/** Said on the window when a shop's open/paused/closed state is changed here. */
export const SHOP_STATUS_EVENT = 'figmark:shop-status';

/** Left to right: closed, pause, open - the switch reads like a traffic light on its side. */
const STEPS: { id: State; label: string; hint: string }[] = [
  { id: 'stopped', label: 'Closed', hint: 'Hidden from the marketplace. Nobody can buy.' },
  { id: 'paused', label: 'Pause', hint: `Still visible. No orders for up to ${PAUSE_MAX_DAYS} days.` },
  { id: 'open', label: 'Open', hint: 'Listed and taking orders.' },
];

const DAYS = [1, 2, 3] as const;

/** What the shop reads once a change has gone through. */
function changedText(status: ShopStatusView): string {
  if (status.state === 'open') return 'Your shop is open. Buyers can order again.';
  if (status.state === 'paused') {
    const left = status.until ? timeLeft(status.until) : `${PAUSE_MAX_DAYS} days`;
    return `Orders paused for ${left}. Your items are visible in the marketplace, but nobody can buy until it reopens on its own.`;
  }
  return 'Shop closed. Your items are not visible in the marketplace and nobody can buy from your shop.';
}

/**
 * Open, paused or stopped for orders: the three-way switch on the Sell tab.
 *
 * - Green, open: everything as normal.
 * - Amber, paused: a break of one to three days. Items stay on the Shop feed,
 *   nobody can buy, and the shop reopens by itself when the time is up.
 * - Red, closed (stored as 'stopped'): items leave the Shop feed (the shop's own page keeps them)
 *   and nobody can buy until the shop opens again.
 */
export function ShopStatusSwitch({ storeId }: { storeId: string }) {
  const toast = useToast();
  const [status, setStatus] = useState<ShopStatusView | null>(null);
  // A pause starts at one day; the shop stretches it to three if it needs to.
  const [days, setDays] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    void api.shopPulse(storeId).then((pulse) => {
      setStatus(pulse.orderStatus);
      // A pause already running shows the days it has left.
      const until = pulse.orderStatus.until ? Date.parse(pulse.orderStatus.until) : NaN;
      if (pulse.orderStatus.state === 'paused' && Number.isFinite(until)) {
        setDays(Math.min(PAUSE_MAX_DAYS, Math.max(1, Math.ceil((until - Date.now()) / 86_400_000))));
      }
    }).catch(() => setStatus({ state: 'open', until: null }));
  }, [storeId]);

  const choose = async (state: State, pauseDays = days) => {
    if (busy || !status) return;
    if (state === status.state && state !== 'paused') {
      toast(changedText(status), state === 'open' ? 'ok' : 'info');
      return;
    }
    haptic();
    setBusy(true);
    const before = status;
    // Moved at once, put back if the server says no.
    setStatus({ state, until: null });
    try {
      const result = await api.setShopStatus({ storeId, state, days: state === 'paused' ? pauseDays : undefined });
      setStatus(result.orderStatus);
      // The pill in the Sell tab's header reads the same answer.
      window.dispatchEvent(new CustomEvent(SHOP_STATUS_EVENT, { detail: { storeId, status: result.orderStatus } }));
      toast(changedText(result.orderStatus), result.orderStatus.state === 'stopped' ? 'error' : result.orderStatus.state === 'paused' ? 'info' : 'ok');
    } catch (err) {
      setStatus(before);
      toast(err instanceof ApiRequestError ? err.message : 'Could not change that. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const current = status?.state ?? 'open';
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <section className={`shopswitch shopswitch--${current}${status ? '' : ' is-loading'}`} aria-label="Taking orders">
      <div className="shopswitch__head">
        <span className="shopswitch__title">
          <i aria-hidden="true" />
          {current === 'open' ? 'Open for orders' : current === 'paused' ? 'Orders paused' : 'Shop closed'}
        </span>
        <small className="shopswitch__note">
          {current === 'paused' && status?.until ? `Reopens in ${timeLeft(status.until)}` : STEPS[index]!.hint}
        </small>
      </div>
      <div className="shopswitch__track" role="radiogroup" aria-label="Shop status" style={{ ['--i' as string]: index }}>
        <span className="shopswitch__thumb" aria-hidden="true" />
        {STEPS.map((step) => (
          <button key={step.id} type="button" role="radio" aria-checked={current === step.id} disabled={busy || !status}
            className={`shopswitch__step shopswitch__step--${step.id}${current === step.id ? ' is-on' : ''}`}
            onClick={() => void choose(step.id)}>
            {step.label}
          </button>
        ))}
      </div>
      {current === 'paused' && (
        <div className="shopswitch__days" role="group" aria-label="Pause for">
          <span>Pause for</span>
          {DAYS.map((count) => (
            <button key={count} type="button" disabled={busy}
              className={`shopswitch__day${days === count ? ' is-on' : ''}`}
              onClick={() => { setDays(count); void choose('paused', count); }}>
              {count} day{count === 1 ? '' : 's'}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
