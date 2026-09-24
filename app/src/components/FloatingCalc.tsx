import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { calculateProfit, stepsFromResult, type ProfitInput, type ProfitTemplate, type SavedCalc } from '@shared/profit';
import type { StoreAccess } from '@shared/stores';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { CalcInputs, CalcLines } from './CostSheetField';
import { ErrorNotice } from './ui';

/**
 * The calculator, one tap from anywhere (Pro).
 *
 * Switched on from the calculator page. A small button floats at the bottom
 * right of every screen; it opens the calculator over whatever the seller is
 * looking at, so a price can be worked out mid-chat. Each result can be kept
 * in a list to list later, or listed now, added to a power sale, or sent to
 * the channel or the feed - every one of those through the usual listing form.
 */

const FLOAT_KEY = 'figmark:float-calc';
const FLOAT_EVENT = 'figmark:float-calc';

function readFloating() {
  try {
    return localStorage.getItem(FLOAT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the floating button is on, on this device. */
export function useFloatingCalc(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readFloating);
  useEffect(() => {
    const sync = () => setOn(readFloating());
    window.addEventListener(FLOAT_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(FLOAT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const set = (next: boolean) => {
    try {
      localStorage.setItem(FLOAT_KEY, next ? '1' : '0');
    } catch {
      /* A private window: it lasts for this page only. */
    }
    setOn(next);
    window.dispatchEvent(new Event(FLOAT_EVENT));
  };
  return [on, set];
}

export type CalcAction = 'list' | 'channel' | 'feed' | 'sale';

const ACTIONS: { id: CalcAction; icon: string; label: string }[] = [
  { id: 'list', icon: '🏷️', label: 'List now' },
  { id: 'sale', icon: '⚡', label: 'Power sale' },
  { id: 'channel', icon: '📣', label: 'Channel' },
  { id: 'feed', icon: '📰', label: 'Feed' },
];

/** Where each action goes: the listing form, prefilled, or a power sale with it as an item. */
export function useCalcAction(store: StoreAccess | null) {
  const navigate = useNavigate();
  return (calc: SavedCalc, action: CalcAction) => {
    if (!store) return;
    if (action === 'sale') {
      navigate('/shop?tab=items', { state: { saleCalcs: [calc], store: store.ownerId } });
      return;
    }
    navigate(store.isOwner ? '/sell' : `/sell?store=${encodeURIComponent(store.ownerId)}`, {
      state: {
        title: calc.title,
        priceMinor: calc.sellingPriceMinor,
        costSheet: calc.steps.length ? { templateId: calc.templateId, templateName: calc.templateName, steps: calc.steps } : null,
        share: { channel: action === 'channel', feed: action === 'feed' },
        calc,
      },
    });
  };
}

/** Saved calculations, each one tap from being listed. */
export function SavedCalcList({ calcs, store, onChanged, onAct }: {
  calcs: SavedCalc[];
  store: StoreAccess | null;
  onChanged: (next: SavedCalc[]) => void;
  /** Called before leaving the screen - so a popup can close itself. */
  onAct?: () => void;
}) {
  const act = useCalcAction(store);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(calc: SavedCalc) {
    if (asking !== calc.id) {
      setAsking(calc.id);
      return;
    }
    setError(null);
    try {
      onChanged((await api.deleteCalc(calc.id, store?.ownerId)).calcs);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete that.');
    }
    setAsking(null);
  }

  if (calcs.length === 0) {
    return <p className="muted">Nothing saved yet. Work an item out, then save it here to list later.</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {error && <ErrorNotice message={error} />}
      {calcs.map((calc) => {
        const cost = calc.steps.reduce((sum, step) => sum + step.amountMinor, 0);
        const profit = calc.sellingPriceMinor - cost;
        const margin = calc.sellingPriceMinor > 0 ? Math.round((profit / calc.sellingPriceMinor) * 100) : null;
        return (
          <article key={calc.id} className="savedcalc">
            <div className="savedcalc__head">
              <b>{calc.title}</b>
              {calc.listingId && <span className="badge badge--ok">Listed</span>}
            </div>
            <small className="faint">
              Sell {formatMoney(calc.sellingPriceMinor)} · cost {formatMoney(cost)}
              {margin !== null && <> · <span className={profit < 0 ? 'pc__neg' : ''}>profit {formatMoney(profit)} ({margin}%)</span></>}
              {calc.templateName ? ` · ${calc.templateName}` : ''}
            </small>
            <div className="savedcalc__acts">
              {ACTIONS.map((action) => (
                <button key={action.id} type="button" className="btn btn--ghost btn--sm"
                  onClick={() => { onAct?.(); act(calc, action.id); }}>
                  <span aria-hidden="true">{action.icon}</span> {action.label}
                </button>
              ))}
              <button type="button" className={`btn btn--sm ${asking === calc.id ? 'btn--danger' : 'btn--quiet'}`}
                onBlur={() => setAsking(null)} onClick={() => void remove(calc)}>
                {asking === calc.id ? 'Tap to delete' : 'Delete'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

const BLANK: ProfitInput = { itemPrice: 0, quantity: 1, weightKg: 0, sellingPrice: 0 };

/** The button and the calculator it opens. Mounted once, in the app shell. */
export function FloatingCalc() {
  const [on] = useFloatingCalc();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    // The sheet folds back into the button before it goes.
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, 220);
  }

  if (!on) return null;
  return (
    <>
      <button type="button" className={`fcalc__fab${open ? ' is-open' : ''}`} aria-label={open ? 'Close the calculator' : 'Open the calculator'}
        aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <span aria-hidden="true">{open ? '✕' : '🧮'}</span>
      </button>
      {open && (
        <div className={`fcalc${closing ? ' is-closing' : ''}`}>
          <button type="button" className="fcalc__scrim" aria-label="Close the calculator" onClick={close} />
          <section className="fcalc__sheet prozone" role="dialog" aria-modal="true" aria-label="Profit calculator">
            <QuickCalc onLeave={close} />
          </section>
        </div>
      )}
    </>
  );
}

function QuickCalc({ onLeave }: { onLeave: () => void }) {
  const [stores, setStores] = useState<StoreAccess[] | null>(null);
  const [storeId, setStoreId] = useState('');
  const [templates, setTemplates] = useState<ProfitTemplate[] | null>(null);
  const [pick, setPick] = useState('');
  const [calcs, setCalcs] = useState<SavedCalc[]>([]);
  const [tab, setTab] = useState<'calc' | 'saved'>('calc');
  const [title, setTitle] = useState('');
  const [input, setInput] = useState<ProfitInput>(BLANK);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.stores().then((result) => {
      const mine = result.stores.filter((entry) => entry.permissions.includes('analytics'));
      setStores(mine);
      if (mine[0]) setStoreId(mine[0].ownerId);
    }).catch(() => setStores([]));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    setTemplates(null);
    void api.profitTemplates(storeId).then((result) => {
      setTemplates(result.templates);
      setPick((result.templates.find((entry) => entry.isDefault) ?? result.templates[0])?.id ?? '');
    }).catch(() => setTemplates([]));
    void api.savedCalcs(storeId).then((result) => setCalcs(result.calcs)).catch(() => setCalcs([]));
  }, [storeId]);

  const store = stores?.find((entry) => entry.ownerId === storeId) ?? null;
  const template = templates?.find((entry) => entry.id === pick) ?? null;
  const result = useMemo(() => (template ? calculateProfit(template, input) : null), [template, input]);
  const act = useCalcAction(store);

  async function keep(then?: 'list' | 'channel' | 'feed' | 'sale') {
    if (!template || !result) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveCalc({
        title: title.trim(),
        templateId: template.id,
        templateName: template.name,
        input,
        steps: stepsFromResult(result),
        sellingPriceMinor: Math.round(input.sellingPrice * 100),
      }, storeId);
      setCalcs(saved.calcs);
      if (then) {
        onLeave();
        act(saved.calc, then);
        return;
      }
      setFlash(`Saved “${saved.calc.title}” to your list.`);
      setTitle('');
      setInput(BLANK);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <div className="fcalc__head">
      <b>🧮 Calculator <span className="probadge">PRO</span></b>
      <div className="inssegs" role="tablist" aria-label="Calculator">
        <button type="button" role="tab" aria-selected={tab === 'calc'} className={`inscat${tab === 'calc' ? ' is-on' : ''}`}
          onClick={() => setTab('calc')}>Work out</button>
        <button type="button" role="tab" aria-selected={tab === 'saved'} className={`inscat${tab === 'saved' ? ' is-on' : ''}`}
          onClick={() => setTab('saved')}>Saved <span className="inscat__n">{calcs.length}</span></button>
      </div>
    </div>
  );

  if (stores === null) return <>{head}<p className="muted">Loading…</p></>;
  if (stores.length === 0) return <>{head}<p className="muted">The calculator is for shops. Open a shop to use it.</p></>;

  return (
    <>
      {head}
      <div className="fcalc__body stack">
        {stores.length > 1 && (
          <label className="field">
            <span>Shop</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {stores.map((entry) => <option key={entry.ownerId} value={entry.ownerId}>{entry.name}</option>)}
            </select>
          </label>
        )}
        {tab === 'saved' ? (
          <SavedCalcList calcs={calcs} store={store} onChanged={setCalcs} onAct={onLeave} />
        ) : templates === null ? <p className="muted">Loading your calculators…</p> : !template ? (
          <p className="muted">No calculator saved yet. Set one up under Sell → 🧮 Calculator first.</p>
        ) : (
          <>
            <div className="costfield__fill">
              <label className="field">
                <span>What is it?</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Item name" />
              </label>
              <label className="field">
                <span>Calculator</span>
                <select value={pick} onChange={(e) => setPick(e.target.value)}>
                  {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
            </div>
            <CalcInputs template={template} input={input} onChange={setInput} withSelling />
            {result && (
              <>
                <div className={`fcalc__result${input.sellingPrice > 0 && result.profit < 0 ? ' is-loss' : ''}`}>
                  <span><small>Profit per item</small><b>{formatMoney(Math.round(result.profit * 100))}</b></span>
                  <span><small>Margin</small><b>{result.marginPercent === null ? '—' : `${result.marginPercent.toFixed(1)}%`}</b></span>
                  <span><small>Landed</small><b>{formatMoney(Math.round(result.landed * 100))}</b></span>
                </div>
                <CalcLines template={template} input={input} result={result} />
              </>
            )}
            {flash && <p className="notice notice--ok">{flash}</p>}
            {error && <ErrorNotice message={error} />}
            <button type="button" className="btn" disabled={busy || !title.trim()} onClick={() => void keep()}>
              💾 Save to my list
            </button>
            <div className="savedcalc__acts">
              {ACTIONS.map((action) => (
                <button key={action.id} type="button" className="btn btn--ghost btn--sm"
                  disabled={busy || !title.trim() || input.sellingPrice <= 0} onClick={() => void keep(action.id)}>
                  <span aria-hidden="true">{action.icon}</span> {action.label}
                </button>
              ))}
            </div>
            {!title.trim() && <small className="faint">Name the item to save it or send it on.</small>}
          </>
        )}
      </div>
    </>
  );
}
