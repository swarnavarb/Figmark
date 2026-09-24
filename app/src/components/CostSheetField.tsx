import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COST_STAGES, STAGE_LABELS, calculateProfit, stepsFromResult,
  type CostStage, type CostStep, type ProfitTemplate,
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
  const [abroad, setAbroad] = useState(0);
  const [weight, setWeight] = useState(0);

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

  const setSteps = (next: CostStep[]) =>
    onChange(next.length ? { templateId: value?.templateId ?? null, templateName: value?.templateName ?? null, steps: next } : null);
  const change = (at: number, patch: Partial<CostStep>) =>
    setSteps(steps.map((step, index) => (index === at ? { ...step, ...patch } : step)));

  function fill() {
    if (!template) return;
    const result = calculateProfit(template, { itemPrice: abroad, quantity: 1, weightKg: weight, sellingPrice: sellingPriceMinor / 100 });
    const next = stepsFromResult(result);
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
        <div className="costfield__fill">
          <label className="field">
            <span>Calculator</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Price abroad ({template?.currency ?? ''})</span>
            <input type="number" inputMode="decimal" min={0} value={abroad || ''} placeholder="0"
              onChange={(e) => setAbroad(Number(e.target.value) || 0)} />
          </label>
          <label className="field">
            <span>Weight (kg)</span>
            <input type="number" inputMode="decimal" min={0} step={0.01} value={weight || ''} placeholder="0"
              onChange={(e) => setWeight(Number(e.target.value) || 0)} />
          </label>
          <button type="button" className="btn btn--sm" disabled={!template} onClick={fill}>
            {steps.length ? 'Refill' : 'Fill the steps'}
          </button>
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
