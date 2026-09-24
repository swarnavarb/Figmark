import { useEffect, useMemo, useState } from 'react';
import type { StoreAccess } from '@shared/stores';
import {
  BASIS_LABELS, COMMON_CURRENCIES, COST_STAGES, KIND_LABELS, STAGE_LABELS, calculateProfit, stepsFromResult,
  type CostBasis, type ProfitResult, type CostKind, type CostLine, type CostStage, type ProfitInput, type ProfitTemplate,
} from '@shared/profit';
import { ApiRequestError, api, type SheetItem } from '../api';
import { formatMoney } from '../format';
import { EmptyState, ErrorNotice } from '../components/ui';

/**
 * The profit calculator (Pro).
 *
 * A shop keeps one cost sheet per way it brings stock in. Pick a sheet, type
 * what the item costs abroad, what it weighs and what you will sell it for,
 * and the landed cost, profit and margin come back as you type. The sheet
 * already lists every charge an import can pick up; switching a line on is
 * how a seller says "this one applies to me".
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
const inr = (value: number) =>
  `${value < 0 ? '−' : ''}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 })}`;
const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);

function freshTemplate(starter: CostLine[], name: string): ProfitTemplate {
  const now = new Date().toISOString();
  return {
    id: '', name, currency: 'USD', rate: 0, volumetricDivisor: 5000, targetMarginPercent: 25,
    isDefault: false, lines: starter.map((line) => ({ ...line })), createdAt: now, updatedAt: now,
  };
}

export function ProfitCalculator({ store }: { store: StoreAccess }) {
  const shop = store.isOwner ? undefined : store.ownerId;
  const [templates, setTemplates] = useState<ProfitTemplate[] | null>(null);
  const [starter, setStarter] = useState<CostLine[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** The sheet being edited, unsaved. The results follow it live. */
  const [draft, setDraft] = useState<ProfitTemplate | null>(null);
  const [input, setInput] = useState<ProfitInput>(readInput);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);

  useEffect(() => {
    void api.profitTemplates(shop)
      .then((result) => {
        setTemplates(result.templates);
        setStarter(result.starter);
        const first = result.templates.find((entry) => entry.isDefault) ?? result.templates[0];
        if (first) setActiveId(first.id);
        // Nothing saved yet: open a full sheet to fill in rather than an empty page.
        else setDraft(freshTemplate(result.starter, 'My calculator'));
      })
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your calculators.'));
  }, [shop]);

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
  if (!templates) return <p className="muted">Loading…</p>;

  const set = (patch: Partial<ProfitInput>) => setInput((current) => ({ ...current, ...patch }));

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
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that calculator.');
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
      if (next.length === 0) setDraft(freshTemplate(starter, 'My calculator'));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete that calculator.');
    } finally {
      setBusy(false);
    }
  }

  const target = active?.targetMarginPercent ?? 0;
  const losing = result !== null && input.sellingPrice > 0 && result.profit < 0;
  const underTarget = result !== null && !losing && result.marginPercent !== null && result.marginPercent < target;

  return (
    <div className="stack royal">
      <section className="inshero">
        <div className="inshero__title">
          <h2>🧮 Profit calculator <span className="probadge">PRO</span></h2>
          <p>Your rates, your charges. Enter the price abroad, the weight and your selling price - the margin follows.</p>
        </div>
        <div className="inssegs" role="tablist" aria-label="Calculators">
          {templates.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={!draft && entry.id === activeId}
              className={`inscat${!draft && entry.id === activeId ? ' is-on' : ''}`}
              onClick={() => { setDraft(null); setActiveId(entry.id); setFlash(null); }}>
              {entry.isDefault && <span aria-hidden="true">★</span>} {entry.name}
              <span className="inscat__n">{entry.currency}</span>
            </button>
          ))}
          {draft && !draft.id && <span className="inscat is-on">✏️ {draft.name || 'New calculator'}</span>}
          <button type="button" className="inscat" disabled={busy}
            onClick={() => { setDraft(freshTemplate(starter, `Calculator ${templates.length + 1}`)); setFlash(null); }}>
            ＋ New
          </button>
        </div>
      </section>

      {flash && <p className="notice notice--ok">{flash}</p>}
      {error && <ErrorNotice message={error} />}

      {!active ? (
        <EmptyState icon="🧮" title="No calculator yet">Make one with ＋ New.</EmptyState>
      ) : (
        <>
          <div className="pc__grid">
            <section className="card card--pad stack">
              <h2>This item</h2>
              <div className="pc__fields">
                <Num label={`Price abroad (${active.currency})`} value={input.itemPrice} onChange={(itemPrice) => set({ itemPrice })} />
                <Num label="Quantity" value={input.quantity} step={1} onChange={(quantity) => set({ quantity: Math.max(1, Math.round(quantity)) })} />
                <Num label="Weight per item (kg)" value={input.weightKg} step={0.05} onChange={(weightKg) => set({ weightKg })} />
                <Num label="Selling price (₹ each)" value={input.sellingPrice} onChange={(sellingPrice) => set({ sellingPrice })} />
              </div>
              <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }} onClick={() => setSizeOpen((open) => !open)}>
                {sizeOpen ? '▾' : '▸'} Packed size, for volumetric weight
              </button>
              {sizeOpen && (
                <div className="pc__fields pc__fields--three">
                  <Num label="Length (cm)" value={input.lengthCm ?? 0} onChange={(lengthCm) => set({ lengthCm })} />
                  <Num label="Width (cm)" value={input.widthCm ?? 0} onChange={(widthCm) => set({ widthCm })} />
                  <Num label="Height (cm)" value={input.heightCm ?? 0} onChange={(heightCm) => set({ heightCm })} />
                </div>
              )}
              <small className="faint">
                1 {active.currency} = ₹{active.rate || 0} on this calculator.
                {result && result.volumetricKg > 0 && ` Volumetric ${result.volumetricKg.toFixed(2)} kg against ${result.actualKg.toFixed(2)} kg actual.`}
              </small>
              <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} onClick={() => setInput(BLANK_INPUT)}>
                Clear
              </button>
            </section>

            {result && (
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
              </section>
            )}
          </div>

          {result && (
            <section className="card card--pad stack">
              <h2>Where the money goes</h2>
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
                    {stage === 'buying' && (
                      <div className="pc__line">
                        <span>Item ({input.itemPrice || 0} {active.currency} × ₹{active.rate || 0})</span>
                        <span>{inr(result.itemCost)}</span>
                      </div>
                    )}
                    {rows.map((line) => (
                      <div key={line.id} className="pc__line">
                        <span>{line.label}</span>
                        <span>{inr(line.perItem)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="pc__line pc__line--total"><span>Landed cost per item</span><span>{inr(result.landed)}</span></div>
            </section>
          )}

          {result && !draft && active.id && (
            <SaveToItem template={active} result={result} shop={shop}
              onPrice={(price) => set({ sellingPrice: price })} />
          )}

          {templates.length > 1 && !draft && (
            <Compare templates={templates} input={input} activeId={activeId} onPick={setActiveId} />
          )}

          {draft ? (
            <Editor draft={draft} onChange={setDraft} busy={busy} onSave={save}
              onCancel={templates.length ? () => setDraft(null) : undefined} />
          ) : (
            <div className="pc__actions">
              <button type="button" className="btn btn--sm" onClick={() => setDraft(structuredClone(active))}>✏️ Edit rates and costs</button>
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => setDraft({ ...structuredClone(active), id: '', name: `${active.name} (copy)`, isDefault: false })}>
                Duplicate
              </button>
              {!active.isDefault && (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
                  onClick={() => { setDraft({ ...structuredClone(active), isDefault: true }); }}>
                  ★ Make default
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void remove(active.id)}>Delete</button>
            </div>
          )}
        </>
      )}
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
 * The cost sheet itself: the rate, then every line, grouped by where in the
 * journey it is paid. A switched-off line stays on the sheet, greyed, so the
 * seller can see what they chose to leave out.
 */
function Editor({ draft, onChange, busy, onSave, onCancel }: {
  draft: ProfitTemplate; onChange: (next: ProfitTemplate) => void; busy: boolean;
  onSave: () => void; onCancel?: () => void;
}) {
  const patch = (next: Partial<ProfitTemplate>) => onChange({ ...draft, ...next });
  const setLine = (id: string, next: Partial<CostLine>) =>
    patch({ lines: draft.lines.map((line) => (line.id === id ? { ...line, ...next } : line)) });

  /** Keep the sheet in journey order: a line joins the end of its stage. */
  const ordered = (lines: CostLine[]) => COST_STAGES.flatMap((stage) => lines.filter((line) => line.stage === stage));

  const move = (id: string, by: -1 | 1) => {
    const lines = [...draft.lines];
    const at = lines.findIndex((line) => line.id === id);
    const to = at + by;
    if (to < 0 || to >= lines.length || lines[to]!.stage !== lines[at]!.stage) return;
    [lines[at], lines[to]] = [lines[to]!, lines[at]!];
    patch({ lines });
  };
  const add = (stage: CostStage) => patch({
    lines: ordered([...draft.lines, { id: newLineId(), label: 'New cost', stage, kind: 'per_item', amount: 0, currency: 'INR', enabled: true }]),
  });
  const drop = (id: string) => patch({ lines: draft.lines.filter((line) => line.id !== id) });

  return (
    <section className="card card--pad stack pc__editor">
      <div>
        <h2>✏️ {draft.id ? 'Edit calculator' : 'New calculator'}</h2>
        <span className="field__hint">Tick the costs that apply to you. Everything updates the result above as you type; save to keep it.</span>
      </div>

      <div className="pc__fields">
        <label className="field">
          <span>Name</span>
          <input value={draft.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} placeholder="Japan by air" />
        </label>
        <label className="field">
          <span>Buying currency</span>
          <input list="pc-currencies" value={draft.currency} maxLength={6}
            onChange={(e) => patch({ currency: e.target.value.toUpperCase() })} />
          <datalist id="pc-currencies">{COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}</datalist>
        </label>
        <Num label={`Your rate (₹ for 1 ${draft.currency || '…'})`} value={draft.rate} step={0.0001} onChange={(rate) => patch({ rate })} />
        <Num label="Target margin (%)" value={draft.targetMarginPercent} step={1} onChange={(targetMarginPercent) => patch({ targetMarginPercent })} />
        <Num label="Volumetric divisor (L×W×H ÷)" value={draft.volumetricDivisor} step={100} onChange={(volumetricDivisor) => patch({ volumetricDivisor })} />
        <label className="field pc__check">
          <input type="checkbox" checked={draft.isDefault} onChange={(e) => patch({ isDefault: e.target.checked })} />
          <span>Open this one first</span>
        </label>
      </div>

      {COST_STAGES.map((stage) => {
        const lines = draft.lines.filter((line) => line.stage === stage);
        return (
          <fieldset key={stage} className="pc__group">
            <legend><span className={`pc__dot pc__dot--${STAGE_TONES[stage]}`} /> {STAGE_LABELS[stage]}</legend>
            {lines.map((line, index) => {
              const earlier = draft.lines.slice(0, draft.lines.indexOf(line));
              return (
                <div key={line.id} className={`pc__row${line.enabled ? '' : ' is-off'}`}>
                  <div className="pc__rowtop">
                    <input type="checkbox" aria-label={`Include ${line.label}`} checked={line.enabled}
                      onChange={(e) => setLine(line.id, { enabled: e.target.checked })} />
                    <input className="pc__label" value={line.label} maxLength={80} aria-label="Cost name"
                      onChange={(e) => setLine(line.id, { label: e.target.value })} />
                    <span className="pc__tools">
                      <button type="button" className="btn btn--quiet btn--sm" aria-label="Move up" disabled={index === 0} onClick={() => move(line.id, -1)}>↑</button>
                      <button type="button" className="btn btn--quiet btn--sm" aria-label="Move down" disabled={index === lines.length - 1} onClick={() => move(line.id, 1)}>↓</button>
                      <button type="button" className="btn btn--quiet btn--sm" aria-label="Remove" onClick={() => drop(line.id)}>✕</button>
                    </span>
                  </div>
                  {line.enabled && (
                    <div className="pc__rowbody">
                      <select value={line.kind} aria-label="How it is charged"
                        onChange={(e) => setLine(line.id, { kind: e.target.value as CostKind, basis: line.basis ?? 'item' })}>
                        {(Object.keys(KIND_LABELS) as CostKind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                      </select>
                      <span className="pc__amount">
                        <input type="number" inputMode="decimal" min={0} step={0.01} aria-label="Amount"
                          value={line.amount === 0 ? '' : line.amount} placeholder="0"
                          onChange={(e) => setLine(line.id, { amount: e.target.value === '' ? 0 : Number(e.target.value) })} />
                        {line.kind === 'percent' ? (
                          <span className="pc__unit">%</span>
                        ) : (
                          <select value={line.currency} aria-label="Currency"
                            onChange={(e) => setLine(line.id, { currency: e.target.value as 'foreign' | 'INR' })}>
                            <option value="INR">₹</option>
                            <option value="foreign">{draft.currency || 'Foreign'}</option>
                          </select>
                        )}
                        {line.kind === 'per_kg' && <span className="pc__unit">/ kg</span>}
                      </span>
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
                      {line.kind === 'per_kg' && (
                        <span className="pc__kg">
                          <label>Min kg <input type="number" min={0} step={0.5} value={line.minKg ?? 0}
                            onChange={(e) => setLine(line.id, { minKg: Number(e.target.value) || 0 })} /></label>
                          <label>Round up to <input type="number" min={0} step={0.5} value={line.stepKg ?? 0}
                            onChange={(e) => setLine(line.id, { stepKg: Number(e.target.value) || 0 })} /> kg</label>
                          <label className="pc__check"><input type="checkbox" checked={Boolean(line.volumetric)}
                            onChange={(e) => setLine(line.id, { volumetric: e.target.checked })} /> Use volumetric if heavier</label>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => add(stage)}>＋ Add a cost</button>
          </fieldset>
        );
      })}

      <div className="pc__actions pc__actions--sticky">
        <button type="button" className="btn" disabled={busy || !draft.name.trim()} onClick={onSave}>
          {busy ? 'Saving…' : 'Save calculator'}
        </button>
        {onCancel && <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
    </section>
  );
}

/**
 * Keep this result as an item's own costs. Only the lines switched on come
 * across, and each can be changed afterwards under Insights → Real profit.
 */
function SaveToItem({ template, result, shop, onPrice }: {
  template: ProfitTemplate; result: ProfitResult; shop?: string; onPrice: (price: number) => void;
}) {
  const [items, setItems] = useState<SheetItem[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void api.costs(shop).then((data) => setItems(data.sheets)).catch(() => setItems([]));
  }, [shop]);

  if (!items || items.length === 0) return null;
  const item = items.find((row) => row.listingId === pick);
  const steps = stepsFromResult(result);

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
        <h2>Save to an item</h2>
        <span className="field__hint">Keeps these costs on the item, so Insights can show its real profit per lot, item and customer.</span>
      </div>
      <label className="field">
        <span>Item</span>
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
      {note && <p className="faint">{note}</p>}
    </section>
  );
}
