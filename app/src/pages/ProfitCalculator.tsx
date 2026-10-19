import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { StoreAccess } from '@shared/stores';
import {
  BASIS_LABELS, COMMON_CURRENCIES, COST_STAGES, KIND_LABELS, SCENARIOS, STAGE_LABELS, calculateProfit, inrPerUnit, paysVia, stepsFromResult, symbolOf,
  type CostBasis, type ProfitResult, type SavedCalc, type CostKind, type CostLine, type CostStage, type LineCurrency,
  type ProfitInput, type ProfitTemplate, type Scenario,
} from '@shared/profit';
import { ApiRequestError, api, type SheetItem } from '../api';
import { formatMoney, formatRupees } from '../format';
import { EmptyState, ErrorNotice } from '../components/ui';
import { SavedCalcList, useFloatingCalc } from '../components/FloatingCalc';
import { scrollToTopOf, useGoBack } from '../components/ScrollManager';
import { CalcIcon } from '../components/CalcIcon';
import { PriceRoute } from '../components/CostSheetField';
import { Loading } from '../components/Feedback';

/**
 * The profit calculator (Pro).
 *
 * A shop keeps one cost sheet per way it brings stock in, started from the
 * scenario closest to it. Type the price abroad and the route to rupees shows
 * hop by hop - yuan to the dollars the supplier is paid, to rupees - with the
 * profit beside it. The rates and charges sit underneath, edited in place:
 * any change is a draft until saved.
 */

const STORAGE_KEY = 'figmark:profit-input';

const BLANK_INPUT: ProfitInput = { itemPrice: 0, quantity: 1, weightKg: 0, sellingPrice: 0 };

export const STAGE_TONES: Record<CostStage, string> = {
  buying: 'pink', origin: 'aqua', international: 'violet', customs: 'warn', domestic: 'ok', selling: 'coral',
};

function readInput(): ProfitInput {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as ProfitInput | null;
    return saved ? { ...BLANK_INPUT, ...saved } : BLANK_INPUT;
  } catch {
    return BLANK_INPUT;
  }
}

/** Rupees, to the paisa when small enough for paise to matter. */
const inr = formatRupees;
const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);

function freshTemplate(starter: CostLine[], name: string): ProfitTemplate {
  const now = new Date().toISOString();
  return {
    id: '', name, currency: 'USD', payCurrency: null, payRate: 0, rate: 0, volumetricDivisor: 5000, targetMarginPercent: 25,
    isDefault: false, lines: starter.map((line) => ({ ...line })), createdAt: now, updatedAt: now,
  };
}

/** A new, unsaved calculator from a scenario, named so it does not clash with one already kept. */
function fromScenario(scenario: Scenario, taken: ProfitTemplate[]): ProfitTemplate {
  const now = new Date().toISOString();
  const sheet = scenario.sheet();
  const names = new Set(taken.map((entry) => entry.name));
  let name = sheet.name;
  for (let n = 2; names.has(name); n += 1) name = `${sheet.name} ${n}`;
  return { ...sheet, name, id: '', isDefault: false, createdAt: now, updatedAt: now };
}

export function ProfitCalculator({ store }: { store: StoreAccess }) {
  const shop = store.isOwner ? undefined : store.ownerId;
  const [templates, setTemplates] = useState<ProfitTemplate[] | null>(null);
  const [starter, setStarter] = useState<CostLine[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** The sheet being edited, unsaved. The results follow it live. */
  const [draft, setDraft] = useState<ProfitTemplate | null>(null);
  /** Choosing how a new calculator starts. */
  const [picking, setPicking] = useState(false);
  const [input, setInput] = useState<ProfitInput>(readInput);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [floating, setFloating] = useFloatingCalc();
  const [params] = useSearchParams();
  const goBack = useGoBack('/sell');
  const [calcs, setCalcs] = useState<SavedCalc[]>([]);
  const [keepTitle, setKeepTitle] = useState('');

  useEffect(() => {
    void api.profitTemplates(shop)
      .then((result) => {
        setTemplates(result.templates);
        setStarter(result.starter);
        // "Edit calculator" from a listing form: open that one, ready to edit.
        const editing = result.templates.find((entry) => entry.id === params.get('edit'));
        const first = editing ?? result.templates.find((entry) => entry.isDefault) ?? result.templates[0];
        if (editing) {
          setDraft(structuredClone(editing));
          window.setTimeout(() => scrollToTopOf(document.querySelector('.pc__editback') ?? document.querySelector('.pc__editor')), 120);
        }
        if (first) setActiveId(first.id);
        // Nothing saved yet: start by choosing how stock comes in.
        else setPicking(true);
      })
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your calculators.'));
    void api.savedCalcs(store.ownerId).then((result) => setCalcs(result.calcs)).catch(() => setCalcs([]));
  }, [shop, store.ownerId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
    } catch {
      /* A private window: the numbers just are not remembered. */
    }
  }, [input]);

  const active = draft ?? templates?.find((entry) => entry.id === activeId) ?? null;
  const result = useMemo(() => (active ? calculateProfit(active, input) : null), [active, input]);

  if (error && !templates) return <ErrorNotice message={error} />;
  if (!templates) return <Loading />;

  const set = (patch: Partial<ProfitInput>) => setInput((current) => ({ ...current, ...patch }));
  /** Any change to the sheet makes it a draft, kept on screen until saved or dropped. */
  const edit = (patch: Partial<ProfitTemplate>) => active && setDraft({ ...(draft ?? structuredClone(active)), ...patch });

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const { template, templates: next } = await api.saveProfitTemplate({ ...draft, id: draft.id || undefined }, shop);
      setTemplates(next);
      setActiveId(template.id);
      setDraft(null);
      setFlash(`Saved "${template.name}".`);
      // Opened from a listing: saving is done, so back to it, as it was left.
      if (params.get('edit')) goBack();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that calculator.');
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!active?.id || !result) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveCalc({
        title: keepTitle.trim(), templateId: active.id, templateName: active.name, input,
        steps: stepsFromResult(result, active, input.itemPrice, input), sellingPriceMinor: Math.round(input.sellingPrice * 100),
      }, store.ownerId);
      setCalcs(saved.calcs);
      setKeepTitle('');
      setFlash(`Saved “${saved.calc.title}” to your list.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this calculator? Its rates and costs go with it.')) return;
    setBusy(true);
    try {
      const { templates: next } = await api.deleteProfitTemplate(id, shop);
      setTemplates(next);
      setDraft(null);
      setActiveId(next.find((entry) => entry.isDefault)?.id ?? next[0]?.id ?? null);
      if (next.length === 0) setPicking(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete that calculator.');
    } finally {
      setBusy(false);
    }
  }

  function start(scenario: Scenario | null) {
    setDraft(scenario ? fromScenario(scenario, templates ?? []) : freshTemplate(starter, `Calculator ${(templates?.length ?? 0) + 1}`));
    setPicking(false);
    setFlash(null);
  }

  const target = active?.targetMarginPercent ?? 0;
  const losing = result !== null && input.sellingPrice > 0 && result.profit < 0;
  const underTarget = result !== null && !losing && result.marginPercent !== null && result.marginPercent < target;
  const changed = draft !== null;

  return (
    <div className="stack prozone">
      {params.get('edit') && (
        // Opened from "Edit calculator" on a listing: back to it, as it was left.
        <button type="button" className="backlink" onClick={goBack}>← Back to your listing</button>
      )}
      <section className="inshero pc__top">
        <div className="inshero__title">
          <h2><CalcIcon size={24} /> Profit calculator <span className="probadge">PRO</span></h2>
          <p>Price abroad in, profit out. Each calculator keeps its own rates.</p>
        </div>
        <div className="inssegs" role="tablist" aria-label="Calculators">
          {templates.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={!picking && active?.id === entry.id}
              className={`inscat${!picking && active?.id === entry.id ? ' is-on' : ''}`}
              onClick={() => { setDraft(null); setPicking(false); setActiveId(entry.id); setFlash(null); }}>
              {entry.isDefault && <span aria-hidden="true">★</span>} {entry.name}
              <span className="inscat__n">{paysVia(entry) ? `${entry.currency}→${entry.payCurrency}` : entry.currency}</span>
            </button>
          ))}
          {draft && !draft.id && !picking && <span className="inscat is-on">✏️ {draft.name || 'New calculator'}</span>}
          <button type="button" className={`inscat${picking ? ' is-on' : ''}`} disabled={busy} onClick={() => setPicking(true)}>
            ＋ New
          </button>
        </div>
      </section>

      {flash && <p className="notice notice--ok">{flash}</p>}
      {error && <ErrorNotice message={error} />}

      {picking ? (
        <ScenarioPicker onPick={start} onCancel={templates.length ? () => setPicking(false) : undefined} />
      ) : !active || !result ? (
        <EmptyState icon={<CalcIcon size={26} />} title="No calculator yet">Make one with ＋ New.</EmptyState>
      ) : (
        <>
          <div className="pc__grid">
            <section className="card card--pad stack pc__calc">
              <label className="pc__price">
                <span>Price abroad</span>
                <span className="pc__pricebox">
                  <span className="pc__sym" aria-hidden="true">{symbolOf(active.currency).trim()}</span>
                  <input type="number" inputMode="decimal" min={0} step={0.01} aria-label={`Price abroad (${active.currency})`}
                    value={input.itemPrice || ''} placeholder="0" onChange={(e) => set({ itemPrice: e.target.value === '' ? 0 : Number(e.target.value) })} />
                  <span className="pc__code">{active.currency}</span>
                </span>
              </label>
              <PriceRoute template={active} input={input} result={result} />
              <div className="pc__fields pc__fields--three">
                <Num label="Selling price ₹" value={input.sellingPrice} onChange={(sellingPrice) => set({ sellingPrice })} />
                <Num label="Quantity" value={input.quantity} step={1} onChange={(quantity) => set({ quantity: Math.max(1, Math.round(quantity)) })} />
                <Num label="Weight kg" value={input.weightKg} step={0.05} onChange={(weightKg) => set({ weightKg })} />
              </div>
              <div className="pc__links">
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSizeOpen((open) => !open)}>
                  {sizeOpen ? '▾' : '▸'} Packed size
                </button>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setInput(BLANK_INPUT)}>Clear</button>
              </div>
              {sizeOpen && (
                <>
                  <div className="pc__fields pc__fields--three">
                    <Num label="Length cm" value={input.lengthCm ?? 0} onChange={(lengthCm) => set({ lengthCm })} />
                    <Num label="Width cm" value={input.widthCm ?? 0} onChange={(widthCm) => set({ widthCm })} />
                    <Num label="Height cm" value={input.heightCm ?? 0} onChange={(heightCm) => set({ heightCm })} />
                  </div>
                  {result.volumetricKg > 0 && (
                    <small className="faint">Volumetric {result.volumetricKg.toFixed(2)} kg against {result.actualKg.toFixed(2)} kg actual.</small>
                  )}
                </>
              )}
            </section>

            <section className={`card card--pad stack pc__result${losing ? ' is-loss' : ''}`}>
              <div className="pc__headline">
                <small>Profit per item</small>
                <b>{inr(result.profit)}</b>
                <span className="pc__pills">
                  <span className="badge">Margin {pct(result.marginPercent)}</span>
                  <span className="badge">Markup {pct(result.markupPercent)}</span>
                </span>
              </div>
              {losing && <p className="pc__warn">⚠️ This price loses {inr(-result.profit)} on every item.</p>}
              {underTarget && <p className="pc__warn pc__warn--soft">Below your {target}% target margin.</p>}
              <dl className="pc__facts">
                <div><dt>Landed cost</dt><dd>{inr(result.landed)}</dd></div>
                <div><dt>Break-even price</dt><dd>{result.breakEven === null ? '—' : inr(result.breakEven)}</dd></div>
                <div>
                  <dt>Price for {target}% margin</dt>
                  <dd>
                    {result.suggested === null ? '—' : inr(result.suggested)}
                    {result.suggested !== null && (
                      <button type="button" className="btn btn--quiet btn--sm pc__use"
                        onClick={() => set({ sellingPrice: Math.ceil(result.suggested!) })}>Use</button>
                    )}
                  </dd>
                </div>
                {input.quantity > 1 && (
                  <>
                    <div><dt>Revenue × {input.quantity}</dt><dd>{inr(result.totalRevenue)}</dd></div>
                    <div><dt>Cost × {input.quantity}</dt><dd>{inr(result.totalCost)}</dd></div>
                    <div><dt>Profit × {input.quantity}</dt><dd>{inr(result.totalProfit)}</dd></div>
                  </>
                )}
              </dl>
              <StageBar stages={result.stages} selling={input.sellingPrice} profit={result.profit} />
              <details className="pc__more">
                <summary>Where the money goes</summary>
                <Breakdown result={result} />
              </details>
            </section>
          </div>

          {draft && params.get('edit') && (
            <button type="button" className="backlink pc__editback" onClick={goBack}>← Back to your listing, without saving</button>
          )}

          <Rates sheet={active} onChange={edit} />
          <Charges sheet={active} result={result} onChange={edit} />

          {changed ? (
            <div className="pc__savebar">
              <span>{draft.id ? 'Unsaved changes' : `New: ${draft.name || 'calculator'}`}</span>
              <button type="button" className="btn btn--sm" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              {(templates.length > 0) && (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
                  onClick={() => { setDraft(null); if (!templates.some((entry) => entry.id === activeId)) setPicking(true); }}>
                  Discard
                </button>
              )}
            </div>
          ) : (
            <div className="pc__actions">
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => setDraft({ ...structuredClone(active), id: '', name: `${active.name} (copy)`, isDefault: false })}>
                Duplicate
              </button>
              {!active.isDefault && (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => edit({ isDefault: true })}>
                  ★ Open this one first
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void remove(active.id)}>Delete</button>
            </div>
          )}

          {!draft && active.id && (
            <SaveToItem template={active} result={result} shop={shop} itemPrice={input.itemPrice} quantity={input.quantity} sellingPrice={input.sellingPrice}
              onPrice={(price) => set({ sellingPrice: price })} />
          )}

          <section className="card card--pad stack">
            <div>
              <h2>Saved to list later <span className="inscat__n">{calcs.length}</span></h2>
              <span className="field__hint">Keep a worked-out item, then list it, add it to a power sale, or send it to the channel or the feed.</span>
            </div>
            {!draft && active.id && (
              <div className="pc__keep">
                <input aria-label="Item name" placeholder="Name this item to save it" value={keepTitle} maxLength={120}
                  onChange={(e) => setKeepTitle(e.target.value)} />
                <button type="button" className="btn btn--sm" disabled={busy || !keepTitle.trim()} onClick={() => void keep()}>💾 Save</button>
              </div>
            )}
            <SavedCalcList calcs={calcs} store={store} onChanged={setCalcs} />
          </section>

          {templates.length > 1 && !draft && (
            <Compare templates={templates} input={input} activeId={activeId} onPick={setActiveId} />
          )}
        </>
      )}

      <label className="pc__float">
        <input type="checkbox" checked={floating} onChange={(e) => setFloating(e.target.checked)} />
        <span>
          <b>Floating calculator button</b>
          <small>A <CalcIcon size={13} /> button on every screen, bottom right. Opens this calculator over whatever you are doing.</small>
        </span>
      </label>
    </div>
  );
}

/** How a new calculator starts: one of the usual ways stock comes in, or nothing at all. */
function ScenarioPicker({ onPick, onCancel }: { onPick: (scenario: Scenario | null) => void; onCancel?: () => void }) {
  return (
    <section className="card card--pad stack">
      <div>
        <h2>How does this stock come in?</h2>
        <span className="field__hint">Pick the closest. Every rate and charge stays yours to change.</span>
      </div>
      <div className="pc__scens">
        {SCENARIOS.map((scenario) => (
          <button key={scenario.id} type="button" className="pc__scen" onClick={() => onPick(scenario)}>
            <span className="pc__scenicon" aria-hidden="true">{scenario.icon}</span>
            <b>{scenario.name}</b>
            <small>{scenario.blurb}</small>
          </button>
        ))}
        <button type="button" className="pc__scen pc__scen--blank" onClick={() => onPick(null)}>
          <span className="pc__scenicon" aria-hidden="true">＋</span>
          <b>Start blank</b>
          <small>Every charge listed, all at zero. Fill in your own.</small>
        </button>
      </div>
      {onCancel && <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} onClick={onCancel}>Cancel</button>}
    </section>
  );
}

/**
 * The numbers a seller changes most - the rates - one tap away and always in
 * view. The price currency, whether the supplier is paid in another one, and
 * what each converts at.
 */
function Rates({ sheet, onChange }: { sheet: ProfitTemplate; onChange: (patch: Partial<ProfitTemplate>) => void }) {
  const via = Boolean(sheet.payCurrency) && sheet.payCurrency !== sheet.currency;
  const pay = via ? sheet.payCurrency! : sheet.currency;
  return (
    <section className="card card--pad stack">
      <div className="pc__ratehead">
        <h2>Rates</h2>
        <input className="pc__name" aria-label="Calculator name" value={sheet.name} maxLength={60}
          onChange={(e) => onChange({ name: e.target.value })} placeholder="Name this calculator" />
      </div>
      <div className="pc__ratechain">
        <label className="field">
          <span>Item priced in</span>
          <select value={sheet.currency}
            onChange={(e) => onChange({ currency: e.target.value, ...(e.target.value === sheet.payCurrency ? { payCurrency: null } : {}) })}>
            {/* A code saved before the list had it stays pickable. */}
            {[...new Set([...COMMON_CURRENCIES, sheet.currency])].filter(Boolean).map((code) => (
              <option key={code} value={code}>{currencyName(code)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Supplier paid in</span>
          <select value={via ? sheet.payCurrency! : ''}
            onChange={(e) => onChange(e.target.value
              ? { payCurrency: e.target.value, payRate: sheet.payRate || 1 }
              : { payCurrency: null })}>
            <option value="">{currencyName(sheet.currency)} (same)</option>
            {COMMON_CURRENCIES.filter((code) => code !== sheet.currency).map((code) => <option key={code} value={code}>{currencyName(code)}</option>)}
          </select>
        </label>
        {via && (
          <Num label={`${sheet.currency} for 1 ${pay}`} value={sheet.payRate ?? 0} step={0.01} onChange={(payRate) => onChange({ payRate })} />
        )}
        <Num label={`₹ for 1 ${pay || '…'}`} value={sheet.rate} step={0.01} onChange={(rate) => onChange({ rate })} />
        <Num label="Target margin %" value={sheet.targetMarginPercent} step={1} onChange={(targetMarginPercent) => onChange({ targetMarginPercent })} />
      </div>
    </section>
  );
}

/** "¥ CNY", "$ USD" - or just the code where it is its own symbol. */
function currencyName(code: string) {
  const symbol = symbolOf(code).trim();
  return symbol === code ? code : `${symbol} ${code}`;
}

/** Each line switched on, and what it came to per item. */
function Breakdown({ result }: { result: ProfitResult }) {
  return (
    <div className="stack" style={{ gap: 8, marginTop: 10 }}>
      {COST_STAGES.map((stage) => {
        const rows = result.lines.filter((line) => line.stage === stage && line.enabled);
        if (stage !== 'buying' && rows.length === 0) return null;
        return (
          <div key={stage} className="pc__stage">
            <div className="pc__stagehead">
              <span className={`pc__dot pc__dot--${STAGE_TONES[stage]}`} />
              <b>{STAGE_LABELS[stage]}</b>
              <span>{inr(result.stages[stage])}</span>
            </div>
            {stage === 'buying' && <div className="pc__line"><span>Item</span><span>{inr(result.itemCost)}</span></div>}
            {rows.map((line) => (
              <div key={line.id} className="pc__line"><span>{line.label}</span><span>{inr(line.perItem)}</span></div>
            ))}
          </div>
        );
      })}
      <div className="pc__line pc__line--total"><span>Landed cost per item</span><span>{inr(result.landed)}</span></div>
    </div>
  );
}

function Num({ label, value, onChange, step = 0.01 }: {
  label: string; value: number; onChange: (value: number) => void; step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" min={0} step={step} value={value === 0 ? '' : value} placeholder="0"
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </label>
  );
}

/** The selling price, split into where each rupee goes, with profit (or the loss) at the end. */
export function StageBar({ stages, selling, profit }: { stages: Record<CostStage, number>; selling: number; profit: number }) {
  const whole = Math.max(selling, Object.values(stages).reduce((sum, value) => sum + value, 0), 1);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="pc__bar" role="img" aria-label="Where the selling price goes">
        {COST_STAGES.map((stage) => stages[stage] > 0 && (
          <span key={stage} className={`pc__seg pc__seg--${STAGE_TONES[stage]}`} style={{ width: `${(stages[stage] / whole) * 100}%` }}
            title={`${STAGE_LABELS[stage]}: ${inr(stages[stage])}`} />
        ))}
        {profit > 0 && <span className="pc__seg pc__seg--profit" style={{ width: `${(profit / whole) * 100}%` }} title={`Profit: ${inr(profit)}`} />}
      </span>
      <span className="pc__legend">
        {COST_STAGES.map((stage) => stages[stage] > 0 && (
          <span key={stage}><span className={`pc__dot pc__dot--${STAGE_TONES[stage]}`} />{STAGE_LABELS[stage]}</span>
        ))}
        {profit > 0 && <span><span className="pc__dot pc__dot--profit" />Profit</span>}
      </span>
    </div>
  );
}

/** Every calculator on the same item, side by side - which route pays best. */
function Compare({ templates, input, activeId, onPick }: {
  templates: ProfitTemplate[]; input: ProfitInput; activeId: string | null; onPick: (id: string) => void;
}) {
  const rows = templates.map((template) => ({ template, result: calculateProfit(template, input) }))
    .sort((a, b) => b.result.profit - a.result.profit);
  return (
    <section className="card card--pad stack">
      <div>
        <h2>Compare your calculators</h2>
        <span className="field__hint">The same item through each of them. Assumes the same price abroad in each one's own currency.</span>
      </div>
      {rows.map(({ template, result }, at) => (
        <button key={template.id} type="button" className={`pc__cmp${template.id === activeId ? ' is-on' : ''}`} onClick={() => onPick(template.id)}>
          <span className="pc__cmpname">{at === 0 && '🏆 '}{template.name}</span>
          <span className="faint">cost {inr(result.landed)}</span>
          <b className={result.profit < 0 ? 'pc__neg' : ''}>{inr(result.profit)}</b>
          <span className="badge">{pct(result.marginPercent)}</span>
        </button>
      ))}
    </section>
  );
}

const newLineId = () => `c_${Math.random().toString(36).slice(2, 9)}`;

/**
 * The charges on the sheet. Only the ones switched on are laid out, grouped by
 * where in the journey they are paid; the rest wait below as one-tap chips,
 * so the sheet reads as what this seller pays rather than everything anyone might.
 */
function Charges({ sheet, result, onChange }: {
  sheet: ProfitTemplate; result: ProfitResult | null; onChange: (patch: Partial<ProfitTemplate>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const setLine = (id: string, next: Partial<CostLine>) =>
    onChange({ lines: ordered(sheet.lines.map((line) => (line.id === id ? { ...line, ...next } : line))) });

  /** Keep the sheet in journey order: a line joins the end of its stage. */
  function ordered(lines: CostLine[]) {
    return COST_STAGES.flatMap((stage) => lines.filter((line) => line.stage === stage));
  }

  const on = sheet.lines.filter((line) => line.enabled);
  const off = sheet.lines.filter((line) => !line.enabled);
  const via = paysVia(sheet);
  const sized = on.some((line) => line.kind === 'per_kg' && line.volumetric);
  const shown = COST_STAGES.filter((stage) => on.some((line) => line.stage === stage));

  /**
   * Up or down the sheet. Past the top or bottom of its group a line moves
   * into the next group - which is all "where it is paid" ever needed to be.
   */
  const move = (id: string, by: -1 | 1) => {
    const lines = [...sheet.lines];
    const at = lines.findIndex((line) => line.id === id);
    const line = lines[at]!;
    let to = at + by;
    // Step over switched-off lines: they are not on screen to be stepped past.
    while (to >= 0 && to < lines.length && !lines[to]!.enabled && lines[to]!.stage === line.stage) to += by;
    if (to >= 0 && to < lines.length && lines[to]!.stage === line.stage) {
      [lines[at], lines[to]] = [lines[to]!, lines[at]!];
      onChange({ lines });
      return;
    }
    const next = COST_STAGES[COST_STAGES.indexOf(line.stage) + by];
    if (next) setLine(id, { stage: next });
  };
  const addOwn = (stage: CostStage) => onChange({
    lines: ordered([...sheet.lines, { id: newLineId(), label: 'New charge', stage, kind: 'per_item', amount: 0, currency: 'INR', enabled: true }]),
  });
  const drop = (id: string) => onChange({ lines: sheet.lines.filter((line) => line.id !== id) });

  // What one unit of each currency a line can be paid in is worth in rupees.
  const inrPer: Record<LineCurrency, number> = { INR: 1, foreign: inrPerUnit(sheet), pay: Math.max(0, sheet.rate || 0) };
  const codeOf = (currency: LineCurrency) => (currency === 'INR' ? 'INR' : currency === 'pay' && via ? sheet.payCurrency! : sheet.currency);
  const sign = (currency: LineCurrency) => symbolOf(codeOf(currency)).trim();
  const amountIn = (rupees: number, currency: LineCurrency) => (inrPer[currency] > 0 ? rupees / inrPer[currency] : 0);
  const fmt = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  /** One line's cost per item, in what it is paid in and on into rupees: "¥12 → $1.79 → ₹157.61". */
  function conversion(line: CostLine): string | null {
    const rupees = result?.lines.find((entry) => entry.id === line.id)?.perItem ?? 0;
    if (!rupees) return null;
    const currency: LineCurrency = line.currency === 'pay' && !via ? 'foreign' : line.currency;
    if (currency === 'INR') return `₹${fmt(rupees)} per item`;
    const chain = currency === 'foreign' && via
      ? [`${sign('foreign')}${fmt(amountIn(rupees, 'foreign'))}`, `${sign('pay')}${fmt(amountIn(rupees, 'pay'))}`]
      : [`${sign(currency)}${fmt(amountIn(rupees, currency))}`];
    return `${[...chain, `₹${fmt(rupees)}`].join(' → ')} per item`;
  }

  const unitOf = (line: CostLine) => {
    if (line.kind === 'percent') return '%';
    const per = line.kind === 'per_kg' ? '/kg' : line.kind === 'per_shipment' ? '/shipment' : '';
    return `${sign(line.currency === 'pay' && !via ? 'foreign' : line.currency)}${per}`;
  };

  return (
    <section className="card card--pad stack pc__editor">
      <div>
        <h2>Charges</h2>
        <span className="field__hint">Everything added on top of the item, each in the currency you pay it in. Results above follow as you type.</span>
      </div>

      {shown.map((stage, groupAt) => {
        const lines = on.filter((line) => line.stage === stage);
        return (
          <div key={stage} className="pc__group">
            <span className="pc__grouphead">
              <span className={`pc__dot pc__dot--${STAGE_TONES[stage]}`} /> {STAGE_LABELS[stage]}
              <button type="button" className="pc__addhere" aria-label={`Add a charge to ${STAGE_LABELS[stage]}`} onClick={() => addOwn(stage)}>＋</button>
            </span>
            {lines.map((line, index) => {
              const earlier = sheet.lines.slice(0, sheet.lines.indexOf(line)).filter((prior) => prior.enabled);
              const first = groupAt === 0 && index === 0 && COST_STAGES.indexOf(stage) === 0;
              const last = groupAt === shown.length - 1 && index === lines.length - 1 && stage === COST_STAGES[COST_STAGES.length - 1];
              const converted = conversion(line);
              return (
                <div key={line.id} className="pc__row">
                  <div className="pc__rowtop">
                    <input className="pc__label" value={line.label} maxLength={80} aria-label="Charge name"
                      onChange={(e) => setLine(line.id, { label: e.target.value })} />
                    <span className="pc__amount">
                      <input type="number" inputMode="decimal" min={0} step={0.01} aria-label={`${line.label} amount`}
                        value={line.amount === 0 ? '' : line.amount} placeholder="0"
                        onChange={(e) => setLine(line.id, { amount: e.target.value === '' ? 0 : Number(e.target.value) })} />
                      <span className="pc__unit">{unitOf(line)}</span>
                    </span>
                    <button type="button" className="btn btn--quiet btn--sm" aria-label={`Switch off ${line.label}`}
                      onClick={() => (line.id.startsWith('c_') ? drop(line.id) : setLine(line.id, { enabled: false }))}>✕</button>
                  </div>
                  <div className="pc__rowbody">
                    <select value={line.kind} aria-label="How it is charged"
                      onChange={(e) => setLine(line.id, { kind: e.target.value as CostKind, basis: line.basis ?? 'item' })}>
                      {(Object.keys(KIND_LABELS) as CostKind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                    </select>
                    {line.kind === 'percent' && (
                      <select value={line.basis ?? 'item'} aria-label="Percent of"
                        onChange={(e) => setLine(line.id, { basis: e.target.value as CostBasis })}>
                        {(Object.keys(BASIS_LABELS) as CostBasis[]).map((basis) => <option key={basis} value={basis}>{BASIS_LABELS[basis]}</option>)}
                      </select>
                    )}
                    {line.kind === 'percent' && line.basis === 'line' && (
                      <select value={line.basisLineId ?? ''} aria-label="Which line"
                        onChange={(e) => setLine(line.id, { basisLineId: e.target.value })}>
                        <option value="">Pick a line above…</option>
                        {earlier.map((prior) => <option key={prior.id} value={prior.id}>{prior.label}</option>)}
                      </select>
                    )}
                    <label className="pc__paidin">
                      paid in
                      <select value={line.currency === 'pay' && !via ? 'foreign' : line.currency} aria-label="Paid in"
                        onChange={(e) => setLine(line.id, { currency: e.target.value as LineCurrency })}>
                        <option value="INR">₹ INR</option>
                        <option value="foreign">{symbolOf(sheet.currency).trim()} {sheet.currency}</option>
                        {via && <option value="pay">{symbolOf(sheet.payCurrency!).trim()} {sheet.payCurrency}</option>}
                      </select>
                    </label>
                    <span className="pc__tools">
                      <button type="button" className="btn btn--quiet btn--sm" aria-label="Move up" disabled={first}
                        title={index === 0 ? 'Move to the group above' : 'Move up'} onClick={() => move(line.id, -1)}>↑</button>
                      <button type="button" className="btn btn--quiet btn--sm" aria-label="Move down" disabled={last}
                        title={index === lines.length - 1 ? 'Move to the group below' : 'Move down'} onClick={() => move(line.id, 1)}>↓</button>
                    </span>
                  </div>
                  {converted && <span className="pc__conv">{converted}</span>}
                  {line.kind === 'per_kg' && (
                    <details className="pc__more">
                      <summary>
                        Weight rules{line.minKg || line.stepKg || line.volumetric
                          ? ` · ${[line.minKg ? `min ${line.minKg} kg` : '', line.stepKg ? `rounded to ${line.stepKg} kg` : '', line.volumetric ? 'volumetric' : '']
                            .filter(Boolean).join(' · ')}`
                          : ''}
                      </summary>
                      <span className="pc__kg">
                        <label>Min kg <input type="number" min={0} step={0.5} value={line.minKg ?? 0}
                          onChange={(e) => setLine(line.id, { minKg: Number(e.target.value) || 0 })} /></label>
                        <label>Round up to <input type="number" min={0} step={0.5} value={line.stepKg ?? 0}
                          onChange={(e) => setLine(line.id, { stepKg: Number(e.target.value) || 0 })} /> kg</label>
                        <label className="pc__check"><input type="checkbox" checked={Boolean(line.volumetric)}
                          onChange={(e) => setLine(line.id, { volumetric: e.target.checked })} /> Volumetric if heavier</label>
                      </span>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {on.length === 0 && <p className="faint">No charges yet - the item price is all it costs.</p>}

      {sized && (
        <div className="pc__fields">
          <Num label="Volumetric divisor (L×W×H ÷)" value={sheet.volumetricDivisor} step={100}
            onChange={(volumetricDivisor) => onChange({ volumetricDivisor })} />
        </div>
      )}

      <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} aria-expanded={adding}
        onClick={() => setAdding((open) => !open)}>
        {adding ? '▾' : '＋'} Add a charge
      </button>
      {adding && (
        <div className="pc__chips">
          {off.map((line) => (
            <button key={line.id} type="button" className="pc__chip" onClick={() => setLine(line.id, { enabled: true })}>
              <span className={`pc__dot pc__dot--${STAGE_TONES[line.stage]}`} /> {line.label}
            </button>
          ))}
          <button type="button" className="pc__chip pc__chip--own" onClick={() => addOwn('domestic')}>＋ Your own</button>
        </div>
      )}
    </section>
  );
}

/**
 * Keep this result as an item's own costs. Only the lines switched on come
 * across, and each can be changed afterwards under Insights → Real profit.
 */
function SaveToItem({ template, result, shop, itemPrice, quantity, sellingPrice, onPrice }: {
  template: ProfitTemplate; result: ProfitResult; shop?: string; itemPrice: number; quantity: number; sellingPrice: number;
  onPrice: (price: number) => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SheetItem[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void api.costs(shop).then((data) => setItems(data.sheets)).catch(() => setItems([]));
  }, [shop]);

  const item = items?.find((row) => row.listingId === pick);
  const steps = stepsFromResult(result, template, itemPrice, { quantity, sellingPrice });

  // A new item through the ordinary listing form, with this price and these
  // costs already filled in - everything else about listing stays the same.
  function listNew() {
    navigate(shop ? `/sell?store=${encodeURIComponent(shop)}` : '/sell', {
      state: {
        priceMinor: Math.round(sellingPrice * 100),
        costSheet: { templateId: template.id, templateName: template.name, steps },
      },
    });
  }

  function choose(id: string) {
    setPick(id);
    setNote(null);
    const chosen = items?.find((row) => row.listingId === id);
    // Percentages of the selling price only mean something at the item's own price.
    if (chosen) onPrice(chosen.priceMinor / 100);
  }

  async function save() {
    if (!item) return;
    if (item.sheet && !window.confirm(`Replace the costs already saved for ${item.title}?`)) return;
    setBusy(true);
    setNote(null);
    try {
      const saved = await api.saveCostSheet(item.listingId, { templateId: template.id, templateName: template.name, steps }, shop);
      setItems((current) => current?.map((row) => (row.listingId === item.listingId ? { ...row, sheet: saved.sheet, costMinor: saved.costMinor } : row)) ?? null);
      setNote(`Saved ${steps.length} steps to ${item.title}. Edit them any time in Insights → Real profit.`);
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : 'Could not save those costs.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card--pad stack">
      <div>
        <h2>Use these costs</h2>
        <span className="field__hint">Keep them on an item, so Insights can show its real profit per lot, item and customer.</span>
      </div>
      <button type="button" className="btn" disabled={steps.length === 0} onClick={listNew}>
        ＋ List a new item with these costs
      </button>
      {items && items.length > 0 && <>
      <label className="field">
        <span>Or save them to an item you already have</span>
        <select value={pick} onChange={(e) => choose(e.target.value)}>
          <option value="">Choose an item…</option>
          {items.map((row) => (
            <option key={row.listingId} value={row.listingId}>
              {row.sheet ? '✓ ' : ''}{row.title} · {formatMoney(row.priceMinor, row.currency)}
            </option>
          ))}
        </select>
      </label>
      {item && <span className="field__hint">{steps.length} steps · {inr(result.landed)} per unit · selling price set to the item's</span>}
      <button type="button" className="btn btn--sm" disabled={!item || busy || steps.length === 0} onClick={() => void save()}>
        Save costs to this item
      </button>
      </>}
      {note && <p className="faint">{note}</p>}
    </section>
  );
}
