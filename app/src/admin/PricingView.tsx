import { useEffect, useState } from 'react';
import {
  FEE_KIND_LABELS, GST_SCOPES, GST_SCOPE_LABELS, PRO_FEATURES,
  type FeeBand, type Pricing,
} from '@shared/billing';
import { ApiRequestError, admin } from './api';
import { formatMoney, timeAgo } from '../format';
import { Loading } from '../components/Feedback';

/**
 * How Figmark earns, set in one place: the platform fee on every sale (by
 * price band, a percentage or a flat fee), per kg on forwarding, the days a
 * month's fees may still be paid, GST, and everything about Pro.
 *
 * A change applies to sales made from now on: each order and booking keeps
 * the fee it was made on.
 */

type Draft = Omit<Pricing, 'updatedAt' | 'updatedBy'>;
const rupees = (minor: number) => String(minor / 100);
const toMinor = (text: string) => Math.round(Number(text || 0) * 100);
const pct = (bp: number) => String(bp / 100);
const toBp = (text: string) => Math.round(Number(text || 0) * 100);

function BandsEditor({ label, bands, onChange }: { label: string; bands: FeeBand[]; onChange: (next: FeeBand[]) => void }) {
  const set = (index: number, patch: Partial<FeeBand>) => onChange(bands.map((band, at) => (at === index ? { ...band, ...patch } : band)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <b>{label}</b>
      {bands.map((band, index) => {
        const last = index === bands.length - 1;
        const from = index === 0 ? 0 : bands[index - 1]!.upToMinor ?? 0;
        return (
          <div key={index} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <span className="faint" style={{ minWidth: 120 }}>
              {formatMoney(from)} {last ? 'and above' : 'up to'}
            </span>
            {!last && (
              <label className="field" style={{ maxWidth: 140 }}>
                <span>Up to ₹</span>
                <input type="number" inputMode="decimal" value={band.upToMinor === null ? '' : rupees(band.upToMinor)}
                  onChange={(e) => set(index, { upToMinor: toMinor(e.target.value) })} />
              </label>
            )}
            <label className="field" style={{ maxWidth: 150 }}>
              <span>Fee is</span>
              <select value={band.mode} onChange={(e) => set(index, { mode: e.target.value as FeeBand['mode'] })}>
                <option value="percent">A percentage</option>
                <option value="flat">A flat amount</option>
              </select>
            </label>
            <label className="field" style={{ maxWidth: 120 }}>
              <span>{band.mode === 'percent' ? '%' : '₹'}</span>
              <input type="number" inputMode="decimal" step="0.01"
                value={band.mode === 'percent' ? pct(band.value) : rupees(band.value)}
                onChange={(e) => set(index, { value: band.mode === 'percent' ? toBp(e.target.value) : toMinor(e.target.value) })} />
            </label>
            {bands.length > 1 && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => {
                const next = bands.filter((_, at) => at !== index);
                next[next.length - 1] = { ...next[next.length - 1]!, upToMinor: null };
                onChange(next);
              }}>Remove</button>
            )}
          </div>
        );
      })}
      {bands.length < 8 && (
        <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} onClick={() => {
          const lastBand = bands[bands.length - 1]!;
          const previous = bands.length > 1 ? bands[bands.length - 2]!.upToMinor ?? 0 : 0;
          const cut = previous + 1_00_000;
          onChange([...bands.slice(0, -1), { ...lastBand, upToMinor: cut }, { upToMinor: null, mode: lastBand.mode, value: lastBand.value }]);
        }}>Add a price band</button>
      )}
    </div>
  );
}

export function PricingView() {
  const [saved, setSaved] = useState<Pricing | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const fill = (pricing: Pricing) => {
    setSaved(pricing);
    const { updatedAt: _at, updatedBy: _by, ...rest } = pricing;
    setDraft(structuredClone(rest));
  };
  useEffect(() => {
    void admin.pricing().then(fill).catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the pricing.'));
  }, []);

  if (!draft && !error) return <Loading />;
  if (!draft) return <p className="notice notice--error">{error}</p>;

  const change = (next: Partial<Draft>) => { setDraft({ ...draft, ...next }); setOk(false); };
  const changed = saved && JSON.stringify((({ updatedAt: _a, updatedBy: _b, ...rest }) => rest)(saved)) !== JSON.stringify(draft);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      fill(await admin.savePricing(draft!));
      setOk(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card card--pad stack">
        <h2>Platform fee</h2>
        <p className="field__hint" style={{ margin: 0 }}>
          What Figmark takes from each sale. Charged on direct sales too: paid through the gateway it comes out of the
          payment; paid direct to the seller it is added to their monthly statement. Sellers see the fee while they list.
        </p>
        {(['shop', 'artist'] as const).map((kind) => (
          <BandsEditor key={kind} label={FEE_KIND_LABELS[kind]} bands={draft.fees[kind]}
            onChange={(bands) => change({ fees: { ...draft.fees, [kind]: bands } })} />
        ))}
        <label className="field" style={{ maxWidth: 260 }}>
          <span>{FEE_KIND_LABELS.forwarder} - ₹ per chargeable kg</span>
          <input type="number" inputMode="decimal" step="0.01" value={rupees(draft.fees.forwarderPerKgMinor)}
            onChange={(e) => change({ fees: { ...draft.fees, forwarderPerKgMinor: toMinor(e.target.value) } })} />
        </label>
        <label className="field" style={{ maxWidth: 260 }}>
          <span>Grace days into the next month</span>
          <input type="number" inputMode="numeric" value={draft.graceDays}
            onChange={(e) => change({ graceDays: Math.round(Number(e.target.value) || 0) })} />
          <span className="field__hint">A month&apos;s direct-sale fees are due by day {draft.graceDays + 1} of the next. Past that the account locks: its listings and stores are hidden until it pays.</span>
        </label>
      </div>

      <div className="card card--pad stack">
        <h2>GST</h2>
        <p className="field__hint" style={{ margin: 0 }}>
          Only a GST-registered business may charge GST. Registration is required once turnover passes the threshold
          (₹20 lakh for services in most states, ₹10 lakh in special-category states) - Figmark&apos;s fees are services.
          Below it, leave GST off. Separately, as a marketplace Figmark may need to collect TCS on sellers&apos; sales and
          sellers of goods through a marketplace may need to register whatever their turnover; check with your CA.
        </p>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={draft.gst.enabled} onChange={(e) => change({ gst: { ...draft.gst, enabled: e.target.checked } })} />
          <span>Charge GST</span>
        </label>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ maxWidth: 120 }}>
            <span>Rate %</span>
            <input type="number" inputMode="decimal" step="0.01" value={pct(draft.gst.rateBp)}
              onChange={(e) => change({ gst: { ...draft.gst, rateBp: toBp(e.target.value) } })} />
          </label>
          <label className="field" style={{ maxWidth: 240 }}>
            <span>GSTIN</span>
            <input value={draft.gst.gstin} placeholder="29ABCDE1234F1Z5" onChange={(e) => change({ gst: { ...draft.gst, gstin: e.target.value.toUpperCase() } })} />
          </label>
        </div>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <b>The price</b>
          <label className="row" style={{ gap: 8 }}>
            <input type="radio" name="gst-mode" checked={draft.gst.mode === 'inclusive'} onChange={() => change({ gst: { ...draft.gst, mode: 'inclusive' } })} />
            <span>Includes GST - ₹118 charged is ₹100 + ₹18 GST</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="radio" name="gst-mode" checked={draft.gst.mode === 'exclusive'} onChange={() => change({ gst: { ...draft.gst, mode: 'exclusive' } })} />
            <span>GST added on top - ₹100 charged as ₹118</span>
          </label>
        </fieldset>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <b>Charge GST on</b>
          {GST_SCOPES.map((scope) => (
            <label key={scope} className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={draft.gst.applyTo[scope]}
                onChange={(e) => change({ gst: { ...draft.gst, applyTo: { ...draft.gst.applyTo, [scope]: e.target.checked } } })} />
              <span>{GST_SCOPE_LABELS[scope]}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="card card--pad stack">
        <h2>Pro</h2>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={draft.pro.enabled} onChange={(e) => change({ pro: { ...draft.pro, enabled: e.target.checked } })} />
          <span>Sell Pro - lock the Pro tools for shops without it (off opens every tool to everybody)</span>
        </label>
        <div className="stack" style={{ gap: 8 }}>
          <b>Plans</b>
          {draft.pro.plans.map((plan, index) => (
            <div key={plan.months} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="row" style={{ gap: 6, minWidth: 110 }}>
                <input type="checkbox" checked={plan.enabled}
                  onChange={(e) => change({ pro: { ...draft.pro, plans: draft.pro.plans.map((row, at) => (at === index ? { ...row, enabled: e.target.checked } : row)) } })} />
                <span>{plan.months} months</span>
              </label>
              <label className="field" style={{ maxWidth: 140 }}>
                <span>Price ₹</span>
                <input type="number" inputMode="decimal" value={rupees(plan.priceMinor)}
                  onChange={(e) => change({ pro: { ...draft.pro, plans: draft.pro.plans.map((row, at) => (at === index ? { ...row, priceMinor: toMinor(e.target.value) } : row)) } })} />
              </label>
              <label className="field" style={{ maxWidth: 140 }}>
                <span>Free bump points</span>
                <input type="number" inputMode="numeric" value={plan.bumpPoints}
                  onChange={(e) => change({ pro: { ...draft.pro, plans: draft.pro.plans.map((row, at) => (at === index ? { ...row, bumpPoints: Math.round(Number(e.target.value) || 0) } : row)) } })} />
              </label>
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ maxWidth: 200 }}>
            <span>Lower platform fee - % off</span>
            <input type="number" inputMode="decimal" value={pct(draft.pro.feeDiscountBp)}
              onChange={(e) => change({ pro: { ...draft.pro, feeDiscountBp: toBp(e.target.value) } })} />
          </label>
          <label className="field" style={{ maxWidth: 200 }}>
            <span>For how many days</span>
            <input type="number" inputMode="numeric" value={draft.pro.feeDiscountDays}
              onChange={(e) => change({ pro: { ...draft.pro, feeDiscountDays: Math.round(Number(e.target.value) || 0) } })} />
            <span className="field__hint">After each purchase. 0 keeps it for the whole subscription.</span>
          </label>
          <label className="field" style={{ maxWidth: 200 }}>
            <span>Free trial days</span>
            <input type="number" inputMode="numeric" value={draft.pro.trialDays}
              onChange={(e) => change({ pro: { ...draft.pro, trialDays: Math.round(Number(e.target.value) || 0) } })} />
            <span className="field__hint">Once per account. 0 for no trial.</span>
          </label>
        </div>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <b>Which tools are Pro</b>
          {PRO_FEATURES.map((feature) => (
            <label key={feature.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={draft.pro.features[feature.id]}
                onChange={(e) => change({ pro: { ...draft.pro, features: { ...draft.pro.features, [feature.id]: e.target.checked } } })} />
              <span>{feature.icon} <b>{feature.title}</b><small className="faint" style={{ display: 'block' }}>{feature.line}</small></span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="card card--pad stack">
        {saved?.updatedAt && <p className="faint" style={{ margin: 0 }}>Last changed {timeAgo(saved.updatedAt)}{saved.updatedBy ? ` by ${saved.updatedBy}` : ''}.</p>}
        {error && <p className="notice notice--error">{error}</p>}
        {ok && <p className="notice notice--ok">Saved. New sales use it from now on.</p>}
        <button className="btn" style={{ justifySelf: 'start' }} disabled={busy || !changed} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save pricing'}
        </button>
      </div>
    </div>
  );
}
