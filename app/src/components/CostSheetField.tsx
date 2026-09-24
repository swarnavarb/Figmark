import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COST_STAGES, STAGE_LABELS, calculateProfit, stepsFromResult,
  type CostStage, type CostStep, type ProfitInput, type ProfitResult, type ProfitTemplate,
} from '@shared/profit';
import { api } from '../api';
import { formatMoney } from '../format';
import { STAGE_TONES } from '../pages/ProfitCalculator';

/**
 * An item's costs (Pro), wherever an item is made or kept.
 *
 * One component for every place costs are entered - listing an item, a power
 * sale item, a private deal, and the item cost editor under Insights - so the
 * steps look and work the same everywhere. Fill from a calculator (only the
 * lines switched on there come across), then change, remove or add any step.
 */

export interface CostSheetDraft {
  templateId: string | null;
  templateName: string | null;
  steps: CostStep[];
}

let stepCounter = 0;
const newStepId = () => `own_${Date.now().toString(36)}_${(stepCounter += 1)}`;

export function CostSheetField({ value, onChange, sellingPriceMinor, shop, collapsible = true }: {
  value: CostSheetDraft | null;
  onChange: (next: CostSheetDraft | null) => void;
  /** Percentages of the selling price are worked out at this price. */
  sellingPriceMinor: number;
  shop?: string;
  /** Folded away behind a "PRO" line until opened - for forms with other work on them. */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible || Boolean(value));
  const [templates, setTemplates] = useState<ProfitTemplate[] | null>(null);
  const [pick, setPick] = useState('');
  const [input, setInput] = useState<ProfitInput>({ itemPrice: 0, quantity: 1, weightKg: 0, sellingPrice: 0 });

  useEffect(() => {
    if (!open || templates) return;
    void api.profitTemplates(shop).then((result) => {
      setTemplates(result.templates);
      const first = result.templates.find((entry) => entry.id === value?.templateId)
        ?? result.templates.find((entry) => entry.isDefault) ?? result.templates[0];
      if (first) setPick(first.id);
    }).catch(() => setTemplates([]));
  }, [open, templates, shop, value?.templateId]);

  const steps = value?.steps ?? [];
  const template = templates?.find((entry) => entry.id === pick);
  const total = steps.reduce((sum, step) => sum + step.amountMinor, 0);
  const profit = sellingPriceMinor - total;
  const worked = template ? { ...input, sellingPrice: sellingPriceMinor / 100 } : null;
  const preview = template && worked ? calculateProfit(template, worked) : null;

  const setSteps = (next: CostStep[]) =>
    onChange(next.length ? { templateId: value?.templateId ?? null, templateName: value?.templateName ?? null, steps: next } : null);
  const change = (at: number, patch: Partial<CostStep>) =>
    setSteps(steps.map((step, index) => (index === at ? { ...step, ...patch } : step)));

  function fill() {
    if (!template || !preview) return;
    const next = stepsFromResult(preview);
    onChange(next.length ? { templateId: template.id, templateName: template.name, steps: next } : null);
  }

  if (!open) {
    return (
      <button type="button" className="costfield__open" onClick={() => setOpen(true)}>
        <span aria-hidden="true">🧮</span> Add what it cost you <span className="probadge">PRO</span>
        <small>Tracks real profit per lot, item and customer</small>
      </button>
    );
  }

  return (
    <div className="costfield stack">
      <div className="costfield__head">
        <b><span aria-hidden="true">🧮</span> Costs per unit <span className="probadge">PRO</span></b>
        {collapsible && !value && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(false)}>Not now</button>
        )}
      </div>

      {templates === null ? <p className="faint">Loading your calculators…</p> : templates.length > 0 ? (
        <div className="stack" style={{ gap: 10 }}>
          <label className="field">
            <span>Calculator</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          {template && (
            <>
              <CalcInputs template={template} input={input} onChange={setInput} />
              {preview && <CalcLines template={template} input={input} result={preview} />}
              <button type="button" className="btn btn--sm" style={{ justifySelf: 'start' }} onClick={fill}>
                {steps.length ? 'Refill the steps' : 'Use these as the steps'}
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="faint">No calculators yet. <Link to="/shop?tab=calculator">Set one up</Link>, or add the steps yourself.</p>
      )}

      {value?.templateName && <span className="field__hint">From “{value.templateName}”. Every step below is this item's own.</span>}
      {steps.map((step, at) => (
        <div key={step.id} className="pc__steprow">
          <span className={`pc__dot pc__dot--${STAGE_TONES[step.stage]}`} />
          <input aria-label="Step" value={step.label} onChange={(e) => change(at, { label: e.target.value })} />
          <select aria-label="Stage" value={step.stage} onChange={(e) => change(at, { stage: e.target.value as CostStage })}>
            {COST_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
          </select>
          <label className="pc__stepamt">
            <span>₹</span>
            <input type="number" inputMode="decimal" min={0} step={0.01} aria-label="Amount per unit"
              value={step.amountMinor ? step.amountMinor / 100 : ''} placeholder="0"
              onChange={(e) => change(at, { amountMinor: Math.round((Number(e.target.value) || 0) * 100) })} />
          </label>
          <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove ${step.label}`}
            onClick={() => setSteps(steps.filter((_, index) => index !== at))}>✕</button>
        </div>
      ))}
      <div className="costfield__row">
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => setSteps([...steps, { id: newStepId(), label: 'Other cost', stage: 'selling', amountMinor: 0 }])}>
          ＋ Add a step
        </button>
        {steps.length > 0 && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange(null)}>Remove all costs</button>
        )}
      </div>
      {steps.length > 0 && (
        <>
          <div className="pc__line pc__line--total"><span>Cost per unit</span><span>{formatMoney(total)}</span></div>
          {sellingPriceMinor > 0 && (
            <div className={`pc__line pc__line--total${profit < 0 ? ' is-loss' : ''}`}>
              <span>Profit at {formatMoney(sellingPriceMinor)}</span>
              <span>{formatMoney(profit)} · {Math.round((profit / sellingPriceMinor) * 100)}%</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Every figure a calculator is worked from, as the calculator page asks for
 * them - price abroad, how many, weight, and the packed size when any of its
 * lines charges by volumetric weight. The selling price is left to the form
 * that holds this, when it has its own.
 */
export function CalcInputs({ template, input, onChange, withSelling = false }: {
  template: ProfitTemplate;
  input: ProfitInput;
  onChange: (next: ProfitInput) => void;
  withSelling?: boolean;
}) {
  const set = (patch: Partial<ProfitInput>) => onChange({ ...input, ...patch });
  const sized = template.lines.some((line) => line.enabled && line.kind === 'per_kg' && line.volumetric);
  const num = (label: string, value: number | undefined, patch: (value: number) => Partial<ProfitInput>, step = 0.01) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" min={0} step={step} value={value ? value : ''} placeholder="0"
        onChange={(e) => set(patch(e.target.value === '' ? 0 : Number(e.target.value)))} />
    </label>
  );
  return (
    <>
      <div className="costfield__fill">
        {num(`Price abroad (${template.currency})`, input.itemPrice, (itemPrice) => ({ itemPrice }))}
        {num('Quantity', input.quantity, (quantity) => ({ quantity: Math.max(1, Math.round(quantity)) }), 1)}
        {num('Weight per item (kg)', input.weightKg, (weightKg) => ({ weightKg }), 0.05)}
        {withSelling && num('Selling price (₹ each)', input.sellingPrice, (sellingPrice) => ({ sellingPrice }))}
      </div>
      {sized && (
        <div className="costfield__fill">
          {num('Length (cm)', input.lengthCm, (lengthCm) => ({ lengthCm }))}
          {num('Width (cm)', input.widthCm, (widthCm) => ({ widthCm }))}
          {num('Height (cm)', input.heightCm, (heightCm) => ({ heightCm }))}
        </div>
      )}
      <small className="faint">1 {template.currency} = ₹{template.rate || 0} on “{template.name}”.</small>
    </>
  );
}

const rupees = (value: number) =>
  `${value < 0 ? '−' : ''}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 })}`;

/** Each line the seller switched on in that calculator, and what it comes to per item. */
export function CalcLines({ template, input, result }: { template: ProfitTemplate; input: ProfitInput; result: ProfitResult }) {
  return (
    <div className="calclines">
      {COST_STAGES.map((stage) => {
        const rows = result.lines.filter((line) => line.stage === stage && line.enabled);
        if (stage !== 'buying' && rows.length === 0) return null;
        return (
          <div key={stage} className="pc__stage">
            <div className="pc__stagehead">
              <span className={`pc__dot pc__dot--${STAGE_TONES[stage]}`} />
              <b>{STAGE_LABELS[stage]}</b>
              <span>{rupees(result.stages[stage])}</span>
            </div>
            {stage === 'buying' && (
              <div className="pc__line">
                <span>Item ({input.itemPrice || 0} {template.currency} × ₹{template.rate || 0})</span>
                <span>{rupees(result.itemCost)}</span>
              </div>
            )}
            {rows.map((line) => (
              <div key={line.id} className="pc__line"><span>{line.label}</span><span>{rupees(line.perItem)}</span></div>
            ))}
          </div>
        );
      })}
      <div className="pc__line pc__line--total"><span>Landed cost per item</span><span>{rupees(result.landed)}</span></div>
    </div>
  );
}
