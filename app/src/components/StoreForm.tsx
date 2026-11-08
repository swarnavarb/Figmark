import { FeeHint } from './Billing';
import { useState } from 'react';
import { COUNTRIES, countryFlag } from '@shared/countries';
import type { ArtistOffering, BatteryRule, FreightLane, InfoRow, InsurancePlan, PortfolioPiece, PriceOption, ServiceAddon, ServiceFormField, StoreLink, StoreWarehouse } from '@shared/models';
import { BASIS_LABELS, BATTERY_RULE_LABELS, CUSTOM_FIELD_TYPES, FIELD_TYPE_LABELS, LOCKED_FIELDS, batteryRuleOf, formOf, volumetricLabel } from '@shared/service-work';
import {
  FREIGHT_MODES, FREIGHT_MODE_LABELS, STORE_ACCENTS, insuranceQuote, partId, type StoreKind,
} from '@shared/service-stores';
import type { StoreDraft } from '../api';
import { formatMoney } from '../format';
import { Icon } from './ui';
import { LaneTicket, MoneyInput, OfferingCard, PlanCard, PortfolioGrid, StoreCover, StoreMark, accentStyle } from './StoreKit';
import '../styles/StoreApplyPage.css';

/**
 * The sections a service store is written in.
 *
 * Shared by the application wizard, which shows them one at a time, and the
 * store console, which shows the one being edited - so a field you can apply
 * with is always a field you can correct later, in the same words.
 *
 * Every section edits a draft through `set`, and the draft is the request
 * body: nothing here holds a second copy of the store.
 */

export interface SectionProps {
  kind: StoreKind;
  draft: StoreDraft;
  set: (patch: Partial<StoreDraft>) => void;
}

/* ── The face of it ──────────────────────────────────────────────────── */

export function BasicsSection({ kind, draft, set }: SectionProps) {
  return (
    <div className="sf-grid">
      <div className="stack">
        <label className="field">
          <span>{kind === 'forwarder' ? 'Company name' : 'Studio name'}</span>
          <input value={draft.companyName ?? ''} maxLength={80}
            onChange={(e) => set({ companyName: e.target.value })}
            placeholder={kind === 'forwarder' ? 'Lotus Freight' : 'Inkwell Figure Studio'} />
        </label>
        <label className="field">
          <span>Tagline</span>
          <input value={draft.tagline ?? ''} maxLength={120} onChange={(e) => set({ tagline: e.target.value })}
            placeholder={kind === 'forwarder' ? 'Guangzhou → India, consolidated weekly' : 'Repaints, custom sculpts & restoration'} />
          <span className="field__hint">One line under your name, everywhere it appears.</span>
        </label>
        <label className="field">
          <span>About</span>
          <textarea rows={5} value={draft.description ?? ''} maxLength={2000}
            onChange={(e) => set({ description: e.target.value })}
            placeholder={kind === 'forwarder'
              ? 'What you move, from where, how often, and what you handle at customs.'
              : 'Your style, your tools, how long you have been at it, and how you keep a buyer in the loop.'} />
          <span className="field__hint">{(draft.description ?? '').trim().length} / 30 characters at least</span>
        </label>
        <div className="field-row">
          <label className="field">
            <span>City</span>
            <input value={draft.city ?? ''} onChange={(e) => set({ city: e.target.value })}
              placeholder={kind === 'forwarder' ? 'Guangzhou' : 'Pune'} />
          </label>
          <label className="field">
            <span>Country</span>
            <input value={draft.country ?? ''} onChange={(e) => set({ country: e.target.value })}
              placeholder={kind === 'forwarder' ? 'China' : 'India'} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Logo (image link)</span>
            <input value={draft.logoUrl ?? ''} onChange={(e) => set({ logoUrl: e.target.value || null })} placeholder="https://…" />
          </label>
          <label className="field">
            <span>Cover (image link)</span>
            <input value={draft.coverUrl ?? ''} onChange={(e) => set({ coverUrl: e.target.value || null })} placeholder="https://…" />
          </label>
        </div>
        <div className="field">
          <span>Store colour</span>
          <div className="sf-swatches" role="radiogroup" aria-label="Store colour">
            {STORE_ACCENTS.map((accent) => (
              <button key={accent} type="button" role="radio" aria-checked={draft.accent === accent} aria-label={accent}
                className={`sf-swatch${draft.accent === accent ? ' is-on' : ''}`} style={accentStyle(accent)}
                onClick={() => set({ accent })} />
            ))}
          </div>
        </div>
      </div>
      <StorePreview kind={kind} draft={draft} />
    </div>
  );
}

/** How the store will look on its own page, as it is typed. */
export function StorePreview({ kind, draft }: { kind: StoreKind; draft: StoreDraft }) {
  const name = draft.companyName?.trim() || (kind === 'forwarder' ? 'Your company' : 'Your studio');
  return (
    <div className="sf-preview" style={accentStyle(draft.accent)} aria-label="Preview">
      <span className="sf-preview__label">Preview</span>
      <StoreCover kind={kind} coverUrl={draft.coverUrl} accent={draft.accent} />
      <div className="sf-preview__body">
        <StoreMark name={name} logoUrl={draft.logoUrl} accent={draft.accent} size={56} />
        <span className="sf-preview__name">{name}</span>
        <span className="sf-preview__tag">{draft.tagline || 'Your tagline goes here'}</span>
        <span className="faint">
          {[draft.city, draft.country].filter(Boolean).join(', ') || 'Where you are'}{draft.since ? ` · since ${draft.since}` : ''}
        </span>
      </div>
    </div>
  );
}

/* ── The paperwork ───────────────────────────────────────────────────── */

export function BusinessSection({ kind, draft, set }: SectionProps) {
  const links = draft.links ?? [];
  const setLink = (index: number, patch: Partial<StoreLink>) =>
    set({ links: links.map((link, at) => (at === index ? { ...link, ...patch } : link)) });
  return (
    <div className="stack">
      <div className="field-row">
        <label className="field">
          <span>Email</span>
          <input type="email" value={draft.contactEmail ?? ''} onChange={(e) => set({ contactEmail: e.target.value })} placeholder="ops@…" />
        </label>
        <label className="field">
          <span>Phone / WhatsApp</span>
          <input type="tel" inputMode="tel" autoComplete="tel" value={draft.contactPhone ?? ''} onChange={(e) => set({ contactPhone: e.target.value })} placeholder="+91 …" />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>{kind === 'forwarder' ? 'Company registration / GST' : 'Registration (MSME, GST) — optional'}</span>
          <input value={draft.businessId ?? ''} onChange={(e) => set({ businessId: e.target.value || null })} placeholder="Only Figmark sees this" />
          <span className="field__hint">Read by the reviewer. Your page only says “Registered”.</span>
        </label>
        <label className="field">
          <span>Trading since</span>
          <input inputMode="numeric" value={draft.since ?? ''} placeholder="2018"
            onChange={(e) => set({ since: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || null })} />
        </label>
      </div>
      <div className="field">
        <span>Links</span>
        <span className="field__hint">Website, Instagram, WhatsApp — whatever a reviewer and a customer should see.</span>
        <div className="stack sf-links">
          {links.map((link, index) => (
            <div key={index} className="sf-link">
              <input value={link.label} onChange={(e) => setLink(index, { label: e.target.value })} placeholder="Instagram" aria-label="Link label" />
              <input value={link.url} onChange={(e) => setLink(index, { url: e.target.value })} placeholder="https://…" aria-label="Link address" />
              <button type="button" className="btn btn--quiet btn--sm" aria-label="Remove link"
                onClick={() => set({ links: links.filter((_, at) => at !== index) })}><Icon name="close" size={14} /></button>
            </div>
          ))}
          {links.length < 6 && (
            <button type="button" className="btn btn--ghost btn--sm sf-add" onClick={() => set({ links: [...links, { label: '', url: '' }] })}>
              <Icon name="plus" size={14} /> Add a link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Forwarder: lanes ────────────────────────────────────────────────── */

export function emptyLane(): FreightLane {
  return {
    id: partId('lane'), originCity: '', originCountry: 'China', destinationCity: '', destinationCountry: 'India',
    mode: 'air', ratePerKgMinor: 0, minChargeKg: 5, transitDaysMin: 8, transitDaysMax: 12, customsIncluded: true, note: '', active: true,
  };
}

export function LanesSection({ draft, set }: SectionProps) {
  const lanes = draft.lanes ?? [];
  const [open, setOpen] = useState<string | null>(lanes.length === 0 ? null : null);
  const update = (id: string, patch: Partial<FreightLane>) =>
    set({ lanes: lanes.map((lane) => (lane.id === id ? { ...lane, ...patch } : lane)) });

  return (
    <div className="stack">
      {lanes.length === 0 && (
        <p className="sf-empty">No lanes yet. A lane is one route you run, priced per kilo — shops pick one when they book you on a lot.</p>
      )}
      {lanes.map((lane) => (
        <div key={lane.id} className={`sf-lane${lane.active ? '' : ' is-off'}`}>
          <LaneTicket lane={lane} accent={draft.accent} />
          <div className="sf-lane__bar">
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(open === lane.id ? null : lane.id)}>
              {open === lane.id ? 'Done' : 'Edit lane'}
            </button>
            <label className="sf-toggle">
              <input type="checkbox" checked={lane.active} onChange={(e) => update(lane.id, { active: e.target.checked })} />
              <span>{lane.active ? 'Bookable' : 'Paused'}</span>
            </label>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => set({ lanes: lanes.filter((row) => row.id !== lane.id) })}>
              <Icon name="trash" size={14} /> Remove
            </button>
          </div>
          {open === lane.id && <LaneEditor lane={lane} onChange={(patch) => update(lane.id, patch)} />}
        </div>
      ))}
      <button type="button" className="btn btn--ghost sf-add" onClick={() => {
        const lane = emptyLane();
        set({ lanes: [...lanes, lane] });
        setOpen(lane.id);
      }}>
        <Icon name="plus" size={14} /> Add a lane
      </button>
    </div>
  );
}

function LaneEditor({ lane, onChange }: { lane: FreightLane; onChange: (patch: Partial<FreightLane>) => void }) {
  return (
    <div className="sf-editor stack">
      <div className="field-row">
        <label className="field"><span>From</span>
          <CountrySelect value={lane.originCountry} onChange={(originCountry) => onChange({ originCountry })} /></label>
        <label className="field"><span>To</span>
          <CountrySelect value={lane.destinationCountry} onChange={(destinationCountry) => onChange({ destinationCountry })} /></label>
      </div>
      <div className="field">
        <span>How it travels</span>
        <div className="seg" role="radiogroup" aria-label="Mode">
          {FREIGHT_MODES.map((mode) => (
            <button key={mode} type="button" role="radio" aria-checked={lane.mode === mode}
              className={lane.mode === mode ? 'is-on' : ''} onClick={() => onChange({ mode })}>
              {FREIGHT_MODE_LABELS[mode].glyph} {FREIGHT_MODE_LABELS[mode].label}
            </button>
          ))}
        </div>
      </div>
      <div className="sf-cols3">
        <label className="field"><span>Rate per kg</span>
          <MoneyInput label="Rate per kilogram" value={lane.ratePerKgMinor} onChange={(ratePerKgMinor) => onChange({ ratePerKgMinor })} />
          <FeeHint kind="forwarder" perKg /></label>
        <label className="field"><span>Minimum kg *</span>
          <input inputMode="decimal" required aria-invalid={!(lane.minChargeKg > 0)} value={lane.minChargeKg || ''} placeholder="5"
            onChange={(e) => onChange({ minChargeKg: Number(e.target.value) || 0 })} />
          <span className="field__hint">{lane.minChargeKg > 0 ? `Parcels under ${lane.minChargeKg} kg are billed as ${lane.minChargeKg} kg.` : 'Required — the least weight you bill on this route.'}</span></label>
        <label className="field"><span>Days (min–max)</span>
          <span className="sf-pair">
            <input inputMode="numeric" aria-label="Fewest days" value={lane.transitDaysMin || ''} onChange={(e) => onChange({ transitDaysMin: Number(e.target.value) || 0 })} />
            <span>–</span>
            <input inputMode="numeric" aria-label="Most days" value={lane.transitDaysMax || ''} onChange={(e) => onChange({ transitDaysMax: Number(e.target.value) || 0 })} />
          </span>
        </label>
      </div>
      <label className="tick">
        <input type="checkbox" checked={lane.customsIncluded} onChange={(e) => onChange({ customsIncluded: e.target.checked })} />
        <span>Customs clearance included <span className="faint">— duty and clearance handled by you at destination</span></span>
      </label>
      <label className="field"><span>Note for shops</span>
        <input value={lane.note} maxLength={200} onChange={(e) => onChange({ note: e.target.value })} placeholder="Flies Saturday, cut-off Thursday 3pm" /></label>

      <OptionsEditor title="Product prices" hint="Different prices by what is sent — boxed figures, statues, battery items. The rate above stays the “from” price."
        options={lane.products ?? []} onChange={(products) => onChange({ products })} defaultBasis="kg" placeholder="Boxed figures" />

      <WarehousesEditor value={lane.warehouses?.length ? lane.warehouses : lane.warehouse ? [lane.warehouse] : []}
        onChange={(warehouses) => onChange({ warehouses, warehouse: null })} />

      <details className="sf-more">
        <summary>Volumetric weight, batteries, terms and more</summary>
      <div className="sf-subcard stack">
        <label className="tick">
          <input type="checkbox" checked={Boolean(lane.volumetric)}
            onChange={(e) => onChange({ volumetric: e.target.checked ? { divisor: 6000, mode: 'greater', note: '' } : null })} />
          <span>Charge by volumetric weight when it is more <span className="faint">— L × W × H ÷ divisor</span></span>
        </label>
        {lane.volumetric && (
          <>
            <div className="sf-cols3">
              <label className="field"><span>Divisor</span>
                <input inputMode="numeric" value={lane.volumetric.divisor || ''} onChange={(e) => onChange({ volumetric: { ...lane.volumetric!, divisor: Number(e.target.value) || 0 } })} />
                <span className="field__hint">5000 or 6000 for air, 1000 for sea</span></label>
              <label className="field"><span>Switches</span>
                <select value={lane.volumetric.mode} onChange={(e) => onChange({ volumetric: { ...lane.volumetric!, mode: e.target.value as 'greater' | 'over' } })}>
                  <option value="greater">Whenever it is more</option>
                  <option value="over">Only past a factor</option>
                </select></label>
              {lane.volumetric.mode === 'over' && (
                <label className="field"><span>Factor</span>
                  <input inputMode="decimal" value={lane.volumetric.overFactor ?? 1.5} onChange={(e) => onChange({ volumetric: { ...lane.volumetric!, overFactor: Number(e.target.value) || 1 } })} /></label>
              )}
            </div>
            <label className="field"><span>Anything else about size</span>
              <input value={lane.volumetric.note} onChange={(e) => onChange({ volumetric: { ...lane.volumetric!, note: e.target.value } })}
                placeholder="Statue boxes are re-packed to cut volume, free." /></label>
            <p className="faint">{volumetricLabel(lane.volumetric)}</p>
          </>
        )}
      </div>

      <label className="field"><span>Batteries on this route</span>
        <select value={batteryRuleOf(lane)} onChange={(e) => onChange({ batteries: e.target.value as BatteryRule })}>
          {(Object.keys(BATTERY_RULE_LABELS) as BatteryRule[]).map((value) => <option key={value} value={value}>{BATTERY_RULE_LABELS[value]}</option>)}
        </select>
        <small className="faint">“In devices” means fitted inside an item — an LED base, a light-up figure. Not loose cells or power banks.</small>
      </label>

      <label className="field"><span>How to send a parcel</span>
        <textarea rows={3} value={lane.orderInfo ?? ''} onChange={(e) => onChange({ orderInfo: e.target.value })}
          placeholder="Write your request number on the box. Cut-off Thursday 3pm for Saturday's flight. We repack for free." /></label>
      <label className="field"><span>Terms for this route</span>
        <textarea rows={3} value={lane.terms ?? ''} onChange={(e) => onChange({ terms: e.target.value })}
          placeholder="Liquids, powders and counterfeit goods are refused. Storage free for 14 days." /></label>
      <InfoRowsEditor rows={lane.extras ?? []} onChange={(extras) => onChange({ extras })} />
      </details>
    </div>
  );
}

/** A country, with its flag, from the full list - plus whatever an older lane had typed. */
function CountrySelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const known = COUNTRIES.includes(value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && <option value={value}>{value}</option>}
      {COUNTRIES.map((country) => <option key={country} value={country}>{countryFlag(country)} {country}</option>)}
    </select>
  );
}

/** Every origin address customers may send to on a route - more than one is fine. */
function WarehousesEditor({ value, onChange }: { value: StoreWarehouse[]; onChange: (next: StoreWarehouse[]) => void }) {
  const update = (index: number, patch: Partial<StoreWarehouse>) => onChange(value.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <div className="field">
      <span>Origin warehouses</span>
      <span className="field__hint">Where customers send parcels for this route. Leave empty to use your main warehouse.</span>
      <div className="sf-options">
        {value.map((row, index) => (
          <div key={index} className="sf-whrow">
            <div className="field-row">
              <input value={row.name ?? ''} onChange={(e) => update(index, { name: e.target.value })} placeholder="Name, e.g. Guangzhou · Baiyun" aria-label="Warehouse name" />
              <button type="button" className="btn btn--quiet btn--sm" aria-label="Remove warehouse" onClick={() => onChange(value.filter((_, at) => at !== index))}><Icon name="trash" size={13} /></button>
            </div>
            <textarea rows={2} value={row.address} onChange={(e) => update(index, { address: e.target.value })} placeholder="Full address customers write on the parcel" aria-label="Warehouse address" />
            <div className="field-row">
              <input value={row.contact} onChange={(e) => update(index, { contact: e.target.value })} placeholder="Contact name & phone" aria-label="Warehouse contact" />
              <input value={row.hours} onChange={(e) => update(index, { hours: e.target.value })} placeholder="Mon–Sat 9–6" aria-label="Warehouse hours" />
            </div>
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm sf-add" onClick={() => onChange([...value, { name: '', address: '', contact: '', hours: '' }])}>
          <Icon name="plus" size={13} /> Add a warehouse
        </button>
      </div>
    </div>
  );
}

/* ── Pieces the editors share ────────────────────────────────────────── */

function OptionsEditor({ title, hint, options, onChange, defaultBasis, placeholder }: {
  title: string; hint: string; options: PriceOption[]; onChange: (next: PriceOption[]) => void; defaultBasis: PriceOption['basis']; placeholder: string;
}) {
  const update = (id: string, patch: Partial<PriceOption>) => onChange(options.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <div className="field">
      <span>{title}</span>
      <span className="field__hint">{hint}</span>
      <div className="sf-options">
        {options.map((row) => (
          <div key={row.id} className="sf-option">
            <input value={row.name} placeholder={placeholder} aria-label="Product" onChange={(e) => update(row.id, { name: e.target.value })} />
            <MoneyInput label="Price" value={row.priceMinor} onChange={(priceMinor) => update(row.id, { priceMinor })} />
            <select value={row.basis} aria-label="Charged" onChange={(e) => update(row.id, { basis: e.target.value as PriceOption['basis'] })}>
              {(['kg', 'piece', 'flat'] as const).map((basis) => <option key={basis} value={basis}>{BASIS_LABELS[basis]}</option>)}
            </select>
            <input className="sf-option__note" value={row.note} placeholder="Note (optional)" aria-label="Note" onChange={(e) => update(row.id, { note: e.target.value })} />
            <button type="button" className="btn btn--quiet btn--sm" aria-label="Remove price" onClick={() => onChange(options.filter((other) => other.id !== row.id))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm sf-add" onClick={() => onChange([...options, { id: partId('opt'), name: '', basis: defaultBasis, priceMinor: 0, note: '' }])}>
          <Icon name="plus" size={13} /> Add a price
        </button>
      </div>
    </div>
  );
}

function InfoRowsEditor({ rows, onChange }: { rows: InfoRow[]; onChange: (next: InfoRow[]) => void }) {
  const update = (index: number, patch: Partial<InfoRow>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <div className="field">
      <span>More details</span>
      <span className="field__hint">Anything else customers ask about — packaging, storage days, prohibited items.</span>
      <div className="sf-options">
        {rows.map((row, index) => (
          <div key={index} className="sf-option sf-option--info">
            <input value={row.label} placeholder="Label" aria-label="Label" onChange={(e) => update(index, { label: e.target.value })} />
            <input value={row.value} placeholder="Value" aria-label="Value" onChange={(e) => update(index, { value: e.target.value })} />
            <button type="button" className="btn btn--quiet btn--sm" aria-label="Remove" onClick={() => onChange(rows.filter((_, at) => at !== index))}><Icon name="trash" size={13} /></button>
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm sf-add" onClick={() => onChange([...rows, { label: '', value: '' }])}><Icon name="plus" size={13} /> Add a detail</button>
      </div>
    </div>
  );
}

/* ── Forwarder: transit cover ────────────────────────────────────────── */

const EXAMPLE_VALUE = 10_000_00;

export function CoverSection({ draft, set }: SectionProps) {
  const plans = draft.insurance ?? [];
  const update = (id: string, patch: Partial<InsurancePlan>) =>
    set({ insurance: plans.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan)) });
  return (
    <div className="stack">
      <p className="sf-lede">
        Plans customers pick when they book a parcel, or add to an item when a shop books you. Free cover is
        picked for them by default.
      </p>
      <div className="field"><span>When customers pay for paid cover</span>
        <div className="sf-choice" role="radiogroup" aria-label="When cover is paid">
          {([['with_bill', 'On the bill', 'Added to the bill when the parcel is weighed at the destination.'],
            ['upfront', 'Upfront', 'Paid before the parcel is sent to your warehouse.']] as const).map(([value, label, note]) => (
            <label key={value} className={`tick sf-choice__row${(draft.coverPayment ?? 'with_bill') === value ? ' is-on' : ''}`}>
              <input type="radio" name="cover-payment" checked={(draft.coverPayment ?? 'with_bill') === value} onChange={() => set({ coverPayment: value })} />
              <span><b>{label}</b> <span className="faint">— {note}</span></span>
            </label>
          ))}
        </div>
      </div>
      {plans.map((plan) => {
        const quote = insuranceQuote(plan, EXAMPLE_VALUE);
        return (
          <div key={plan.id} className={`sf-planedit${plan.active ? '' : ' is-off'}`}>
            <PlanCard plan={plan} premiumMinor={quote.premiumMinor} coverMinor={quote.coverMinor} />
            <span className="faint sf-example">Priced on a {formatMoney(EXAMPLE_VALUE)} item</span>
            <div className="sf-editor stack">
              <div className="field-row">
                <label className="field"><span>Plan name</span>
                  <input value={plan.name} onChange={(e) => update(plan.id, { name: e.target.value })} /></label>
                <label className="field"><span>Pays out (% of value)</span>
                  <input inputMode="numeric" value={plan.coverPercent || ''} onChange={(e) => update(plan.id, { coverPercent: Number(e.target.value) || 0 })} /></label>
              </div>
              <label className="tick">
                <input type="checkbox" checked={!plan.premiumBasisPoints && !plan.minPremiumMinor}
                  onChange={(e) => update(plan.id, e.target.checked ? { premiumBasisPoints: 0, minPremiumMinor: 0 } : { premiumBasisPoints: 150, minPremiumMinor: 4_900 })} />
                <span>Free — included on every parcel</span>
              </label>
              {(plan.premiumBasisPoints > 0 || plan.minPremiumMinor > 0) && (
              <div className="sf-cols3">
                <label className="field"><span>Premium (% of value)</span>
                  <input inputMode="decimal" value={plan.premiumBasisPoints ? plan.premiumBasisPoints / 100 : ''}
                    onChange={(e) => update(plan.id, { premiumBasisPoints: Math.round((Number(e.target.value) || 0) * 100) })} /></label>
                <label className="field"><span>Least premium</span>
                  <MoneyInput label="Least premium" value={plan.minPremiumMinor} onChange={(minPremiumMinor) => update(plan.id, { minPremiumMinor })} /></label>
                <label className="field"><span>Most it pays</span>
                  <MoneyInput label="Most it pays" value={plan.maxCoverMinor ?? 0} placeholder="No cap"
                    onChange={(value) => update(plan.id, { maxCoverMinor: value || null })} /></label>
              </div>
              )}
              <label className="field"><span>What it covers, and how to claim</span>
                <textarea rows={3} value={plan.terms} onChange={(e) => update(plan.id, { terms: e.target.value })}
                  placeholder="Loss and visible transit damage from our warehouse to landing. Claims within 72 hours with unboxing photos." /></label>
              <div className="row">
                <label className="sf-toggle">
                  <input type="checkbox" checked={plan.active} onChange={(e) => update(plan.id, { active: e.target.checked })} />
                  <span>{plan.active ? 'On sale' : 'Paused'}</span>
                </label>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => set({ insurance: plans.filter((row) => row.id !== plan.id) })}>
                  <Icon name="trash" size={14} /> Remove
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {plans.length < 8 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn--ghost sf-add" onClick={() => set({
            insurance: [...plans, {
              id: partId('plan'), name: plans.length ? 'Full cover' : 'Transit cover', coverPercent: 100,
              premiumBasisPoints: 150, minPremiumMinor: 4_900, maxCoverMinor: null, terms: '', active: true,
            }],
          })}>
            <Icon name="plus" size={14} /> Add a cover plan
          </button>
          {!plans.some((plan) => !plan.premiumBasisPoints && !plan.minPremiumMinor) && (
            <button type="button" className="btn btn--ghost sf-add" onClick={() => set({
              insurance: [{
                id: partId('plan'), name: 'Basic cover', coverPercent: 100,
                premiumBasisPoints: 0, minPremiumMinor: 0, maxCoverMinor: 2_000_00, terms: 'Included on every parcel.', active: true,
              }, ...plans],
            })}>
              <Icon name="plus" size={14} /> Add free cover
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function WarehouseSection({ draft, set }: SectionProps) {
  const warehouse = draft.warehouse ?? { address: '', contact: '', hours: '' };
  const put = (patch: Partial<typeof warehouse>) => set({ warehouse: { ...warehouse, ...patch } });
  return (
    <div className="stack">
      <label className="field"><span>Origin warehouse address</span>
        <textarea rows={2} value={warehouse.address} onChange={(e) => put({ address: e.target.value })}
          placeholder="Where suppliers drop goods for you to consolidate" /></label>
      <div className="field-row">
        <label className="field"><span>Warehouse contact</span>
          <input value={warehouse.contact} onChange={(e) => put({ contact: e.target.value })} placeholder="Name · phone · WeChat" /></label>
        <label className="field"><span>Hours and cut-offs</span>
          <input value={warehouse.hours} onChange={(e) => put({ hours: e.target.value })} placeholder="Mon–Sat 9–6, cut-off Thu 3pm" /></label>
      </div>
      <label className="field"><span>Monthly capacity (kg)</span>
        <input inputMode="numeric" value={draft.claimedMonthlyCapacityKg ?? ''}
          onChange={(e) => set({ claimedMonthlyCapacityKg: Number(e.target.value.replace(/\D/g, '')) || null })} placeholder="8000" /></label>
      <div className="sf-switchcard">
        <label className="sf-toggle sf-toggle--big">
          <input type="checkbox" checked={draft.autoAccept !== false} onChange={(e) => set({ autoAccept: e.target.checked })} />
          <span>
            <b>Accept every booking automatically</b>
            <span className="faint">
              {draft.autoAccept !== false
                ? 'A shop picks you on a lot and it is yours at once — your team can start pressing buttons.'
                : 'Each lot arrives as a request. Your team accepts or declines it before working it.'}
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

/* ── Artist: the menu ────────────────────────────────────────────────── */

export function MenuSection({ draft, set }: SectionProps) {
  const offerings = draft.offerings ?? [];
  const [tag, setTag] = useState('');
  const tags = draft.specialties ?? [];
  const update = (id: string, patch: Partial<ArtistOffering>) =>
    set({ offerings: offerings.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  const addTag = () => {
    const value = tag.trim();
    if (value && !tags.includes(value)) set({ specialties: [...tags, value].slice(0, 12) });
    setTag('');
  };
  return (
    <div className="stack">
      <div className="field">
        <span>Specialties</span>
        <div className="sf-tags">
          {tags.map((value) => (
            <button key={value} type="button" className="sf-tag" onClick={() => set({ specialties: tags.filter((row) => row !== value) })}>
              {value} <Icon name="close" size={11} />
            </button>
          ))}
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Repaint, sculpt…" aria-label="Add a specialty"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }} onBlur={addTag} />
        </div>
      </div>
      {offerings.map((offering) => (
        <div key={offering.id} className={`sf-offeredit${offering.active ? '' : ' is-off'}`}>
          <div className="field-row">
            <label className="field"><span>Service</span>
              <input value={offering.name} onChange={(e) => update(offering.id, { name: e.target.value })} placeholder="Full repaint" /></label>
            <div className="field-row">
              <label className="field"><span>Price from</span>
                <MoneyInput label="Price from" value={offering.priceFromMinor} onChange={(priceFromMinor) => update(offering.id, { priceFromMinor })} />
                <FeeHint kind="artist" priceMinor={offering.priceFromMinor} /></label>
              <label className="field"><span>Days</span>
                <input inputMode="numeric" value={offering.turnaroundDays || ''} onChange={(e) => update(offering.id, { turnaroundDays: Number(e.target.value) || 0 })} /></label>
            </div>
          </div>
          <label className="field"><span>What they get</span>
            <input value={offering.description} onChange={(e) => update(offering.id, { description: e.target.value })}
              placeholder="Strip, prime and airbrush to your reference, sealed." /></label>
          <details className="sf-more">
            <summary>Prices by piece, what is included, terms</summary>
            <div className="stack">
              <OptionsEditor title="Prices by piece" hint="When one price does not fit all — by scale, by size, by how much work."
                options={offering.products ?? []} onChange={(products) => update(offering.id, { products })} defaultBasis="flat" placeholder="1/6 scale" />
              <label className="field"><span>What is included</span>
                <textarea rows={2} value={offering.includes ?? ''} onChange={(e) => update(offering.id, { includes: e.target.value })}
                  placeholder="Stripping, priming, airbrushed base and two rounds of changes." /></label>
              <label className="field"><span>How to send the piece</span>
                <textarea rows={2} value={offering.orderInfo ?? ''} onChange={(e) => update(offering.id, { orderInfo: e.target.value })}
                  placeholder="Double box it, request number inside. Accessories in a separate bag." /></label>
              <label className="field"><span>Terms</span>
                <textarea rows={2} value={offering.terms ?? ''} onChange={(e) => update(offering.id, { terms: e.target.value })}
                  placeholder="50% is non-refundable once work starts." /></label>
              <InfoRowsEditor rows={offering.extras ?? []} onChange={(extras) => update(offering.id, { extras })} />
            </div>
          </details>
          <div className="row">
            <label className="sf-toggle">
              <input type="checkbox" checked={offering.active} onChange={(e) => update(offering.id, { active: e.target.checked })} />
              <span>{offering.active ? 'On the menu' : 'Hidden'}</span>
            </label>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => set({ offerings: offerings.filter((row) => row.id !== offering.id) })}>
              <Icon name="trash" size={14} /> Remove
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn--ghost sf-add" onClick={() => set({
        offerings: [...offerings, { id: partId('svc'), name: '', description: '', priceFromMinor: 0, turnaroundDays: 14, active: true }],
      })}>
        <Icon name="plus" size={14} /> Add a service
      </button>
      {offerings.some((row) => row.name) && (
        <div className="sf-menu-preview">
          {offerings.filter((row) => row.name && row.active).map((row) => <OfferingCard key={row.id} offering={row} />)}
        </div>
      )}
      <div className="sf-switchcard">
        <label className="sf-toggle sf-toggle--big">
          <input type="checkbox" checked={draft.acceptingWork !== false} onChange={(e) => set({ acceptingWork: e.target.checked })} />
          <span>
            <b>Taking commissions</b>
            <span className="faint">Off keeps your page up but closes new requests — for when the queue is full.</span>
          </span>
        </label>
      </div>
    </div>
  );
}

export function PortfolioSection({ draft, set }: SectionProps) {
  const pieces = draft.portfolio ?? [];
  const [link, setLink] = useState('');
  const [caption, setCaption] = useState('');
  const payment = draft.payment ?? {};
  const pay = (patch: Record<string, string>) => set({ payment: { ...payment, ...patch } });
  return (
    <div className="stack">
      <div className="field">
        <span>Portfolio</span>
        <span className="field__hint">Links to pictures of your work. The first one leads your page.</span>
        <div className="sf-link">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… .jpg" aria-label="Picture link" />
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption" aria-label="Caption" />
          <button type="button" className="btn btn--ghost btn--sm" disabled={!/^https?:\/\//.test(link.trim())} onClick={() => {
            set({ portfolio: [...pieces, { id: partId('pic'), url: link.trim(), caption: caption.trim() } as PortfolioPiece].slice(0, 24) });
            setLink('');
            setCaption('');
          }}>Add</button>
        </div>
      </div>
      {pieces.length > 0 && (
        <>
          <PortfolioGrid pieces={pieces} />
          <div className="sf-tags">
            {pieces.map((piece) => (
              <button key={piece.id} type="button" className="sf-tag" onClick={() => set({ portfolio: pieces.filter((row) => row.id !== piece.id) })}>
                {piece.caption || 'Picture'} <Icon name="close" size={11} />
              </button>
            ))}
          </div>
        </>
      )}
      <label className="field"><span>Studio address</span>
        <textarea rows={2} value={draft.studioAddress ?? ''} onChange={(e) => set({ studioAddress: e.target.value })}
          placeholder="Where shops send a piece to be worked on. Shown only once a commission is paid." /></label>
      <div className="field">
        <span>Direct payment details</span>
        <span className="field__hint">Optional. Without them, buyers can only pay you with Buyer Protection.</span>
        <div className="field-row">
          <input value={payment.upiId ?? ''} onChange={(e) => pay({ upiId: e.target.value })} placeholder="UPI ID" aria-label="UPI ID" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <input value={payment.accountName ?? ''} onChange={(e) => pay({ accountName: e.target.value })} placeholder="Account name" aria-label="Account name" />
        </div>
        <input value={payment.instructions ?? ''} onChange={(e) => pay({ instructions: e.target.value })} placeholder="Anything to quote when paying" aria-label="Payment instructions" />
      </div>
    </div>
  );
}

/* ── The request form ────────────────────────────────────────────────── */

/**
 * The form customers fill in, as the store arranges it.
 *
 * It opens with the default for the kind of store. The fields the request
 * cannot be priced or delivered without are locked in place - they can be
 * relabelled, not removed - and anything else can be added: a question, a
 * choice, a date.
 */
export function RequestFormSection({ kind, draft, set }: SectionProps) {
  const form = formOf(kind, draft.requestForm);
  const locked = LOCKED_FIELDS[kind];
  const put = (next: ServiceFormField[]) => set({ requestForm: next });
  const update = (id: string, patch: Partial<ServiceFormField>) => put(form.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const move = (index: number, by: number) => {
    const next = [...form];
    const [row] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, row!);
    put(next);
  };
  return (
    <div className="stack">
      <label className="field"><span>Use your own form instead</span>
        <span className="field__hint">A Google Form or similar. Customers open it from the order sheet, then send you the request here so it is tracked. Leave empty to use the form below.</span>
        <input type="url" value={draft.formUrl ?? ''} onChange={(e) => set({ formUrl: e.target.value.trim() || null })} placeholder="https://forms.gle/…" /></label>
      {draft.formUrl ? <p className="faint">Your form link is on. The questions below are kept for when you switch back.</p> : null}
      <p className="faint">This is what a customer fills in when they {kind === 'forwarder' ? 'ship with you' : 'request a service'}. Fields marked
        <span className="sf-lock"> <Icon name="lock" size={11} /> </span> are needed to price and deliver it and stay on the form.</p>
      {form.map((field, index) => {
        const isLocked = Boolean(field.key && locked.includes(field.key));
        return (
          <div key={field.id} className="sf-fieldrow">
            <div className="sf-fieldrow__move">
              <button type="button" className="btn btn--quiet btn--sm" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><Icon name="up" size={13} /></button>
              <button type="button" className="btn btn--quiet btn--sm" aria-label="Move down" disabled={index === form.length - 1} onClick={() => move(index, 1)}><Icon name="down" size={13} /></button>
            </div>
            <div className="sf-fieldrow__body">
              <div className="field-row">
                <label className="field"><span>Question {isLocked && <Icon name="lock" size={11} />}</span>
                  <input value={field.label} onChange={(e) => update(field.id, { label: e.target.value })} /></label>
                <label className="field"><span>Type</span>
                  {field.key ? <input value={FIELD_TYPE_LABELS[field.type]} disabled /> : (
                    <select value={field.type} onChange={(e) => update(field.id, { type: e.target.value as ServiceFormField['type'] })}>
                      {CUSTOM_FIELD_TYPES.map((type) => <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>)}
                    </select>
                  )}</label>
              </div>
              <label className="field"><span>Help text</span>
                <input value={field.help ?? ''} onChange={(e) => update(field.id, { help: e.target.value })} placeholder="Shown under the question" /></label>
              {field.type === 'choice' && (
                <label className="field"><span>Choices, one per line</span>
                  <textarea rows={3} value={(field.options ?? []).join('\n')} onChange={(e) => update(field.id, { options: e.target.value.split('\n') })} /></label>
              )}
              <div className="row">
                <label className="sf-toggle">
                  <input type="checkbox" checked={field.required} disabled={isLocked} onChange={(e) => update(field.id, { required: e.target.checked })} />
                  <span>{field.required ? 'Required' : 'Optional'}</span>
                </label>
                {!isLocked && (
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => put(form.filter((row) => row.id !== field.id))}>
                    <Icon name="trash" size={13} /> Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn btn--ghost sf-add" onClick={() => put([...form, { id: partId('f'), label: '', type: 'text', required: false }])}>
          <Icon name="plus" size={14} /> Add a question
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => set({ requestForm: null })}>Back to the default form</button>
      </div>
    </div>
  );
}

/** Extras a customer can tick on any order - door-to-door delivery, rush work - each with a price, or free. */
export function ExtrasSection({ kind, draft, set }: SectionProps) {
  const rows = draft.serviceOptions ?? [];
  const update = (id: string, patch: Partial<ServiceAddon>) => set({ serviceOptions: rows.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  return (
    <div className="stack">
      <p className="faint">Customers tick these on the order form{kind === 'forwarder' ? ', on any route' : ''}. Leave the price empty for free.</p>
      <div className="sf-options">
        {rows.map((row) => (
          <div key={row.id} className="sf-option sf-option--extra">
            <input value={row.name} placeholder={kind === 'forwarder' ? 'Door-to-door delivery' : 'Rush — jump the queue'} aria-label="Extra" onChange={(e) => update(row.id, { name: e.target.value })} />
            <MoneyInput label="Price" value={row.priceMinor} placeholder="Free" onChange={(priceMinor) => update(row.id, { priceMinor })} />
            <input className="sf-option__note" value={row.note} placeholder="Note (optional)" aria-label="Note" onChange={(e) => update(row.id, { note: e.target.value })} />
            <button type="button" className="btn btn--quiet btn--sm" aria-label="Remove extra" onClick={() => set({ serviceOptions: rows.filter((other) => other.id !== row.id) })}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm sf-add" onClick={() => set({ serviceOptions: [...rows, { id: partId('add'), name: '', priceMinor: 0, note: '' }] })}>
          <Icon name="plus" size={13} /> Add an extra
        </button>
      </div>
    </div>
  );
}

/** How customers pay this store directly, and the terms on every route or service. */
export function PaymentTermsSection({ kind, draft, set }: SectionProps) {
  const payment = draft.payment ?? {};
  const pay = (patch: Record<string, string>) => set({ payment: { ...payment, ...patch } });
  return (
    <div className="stack">
      <div className="field">
        <span>Where customers pay you</span>
        <span className="field__hint">Shown to a customer once they accept your quote or open your payment link — never on your page.</span>
        <div className="field-row">
          <input value={payment.upiId ?? ''} onChange={(e) => pay({ upiId: e.target.value })} placeholder="UPI ID" aria-label="UPI ID" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <input value={payment.accountName ?? ''} onChange={(e) => pay({ accountName: e.target.value })} placeholder="Account name" aria-label="Account name" />
        </div>
        <div className="field-row">
          <input value={payment.accountNumber ?? ''} onChange={(e) => pay({ accountNumber: e.target.value })} placeholder="Account number" aria-label="Account number" />
          <input value={payment.ifsc ?? ''} onChange={(e) => pay({ ifsc: e.target.value })} placeholder="IFSC" aria-label="IFSC" />
        </div>
        <input value={payment.instructions ?? ''} onChange={(e) => pay({ instructions: e.target.value })} placeholder="Anything to quote when paying" aria-label="Payment instructions" />
      </div>
      <label className="field"><span>Terms for everything you {kind === 'forwarder' ? 'ship' : 'make'}</span>
        <textarea rows={6} value={draft.terms ?? ''} onChange={(e) => set({ terms: e.target.value })}
          placeholder={kind === 'forwarder'
            ? 'Shown under each route’s own terms. Liability, storage, prohibited goods, claims.'
            : 'Shown under each service’s own terms. Deposits, changes, what happens if a piece arrives damaged.'} /></label>
    </div>
  );
}
