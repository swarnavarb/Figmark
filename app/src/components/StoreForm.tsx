import { useState } from 'react';
import type { ArtistOffering, FreightLane, InsurancePlan, PortfolioPiece, StoreLink } from '@shared/models';
import {
  FREIGHT_MODES, FREIGHT_MODE_LABELS, STORE_ACCENTS, insuranceQuote, partId, type StoreKind,
} from '@shared/service-stores';
import type { StoreDraft } from '../api';
import { formatMoney } from '../format';
import { Icon } from './ui';
import { LaneTicket, MoneyInput, OfferingCard, PlanCard, PortfolioGrid, StoreCover, StoreMark, accentStyle } from './StoreKit';

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
          <input value={draft.contactPhone ?? ''} onChange={(e) => set({ contactPhone: e.target.value })} placeholder="+91 …" />
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
        <label className="field"><span>From city</span>
          <input value={lane.originCity} onChange={(e) => onChange({ originCity: e.target.value })} placeholder="Guangzhou" /></label>
        <label className="field"><span>Country</span>
          <input value={lane.originCountry} onChange={(e) => onChange({ originCountry: e.target.value })} /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>To city</span>
          <input value={lane.destinationCity} onChange={(e) => onChange({ destinationCity: e.target.value })} placeholder="Mumbai" /></label>
        <label className="field"><span>Country</span>
          <input value={lane.destinationCountry} onChange={(e) => onChange({ destinationCountry: e.target.value })} /></label>
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
          <MoneyInput label="Rate per kilogram" value={lane.ratePerKgMinor} onChange={(ratePerKgMinor) => onChange({ ratePerKgMinor })} /></label>
        <label className="field"><span>Minimum kg</span>
          <input inputMode="decimal" value={lane.minChargeKg || ''} onChange={(e) => onChange({ minChargeKg: Number(e.target.value) || 0 })} /></label>
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
        Plans buyers can add to their own item when a shop books you and turns cover on. The premium is
        paid with the order — held by an escrow or sent direct, same as the goods — and the shop settles
        it with you alongside the freight.
      </p>
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
        <button type="button" className="btn btn--ghost sf-add" onClick={() => set({
          insurance: [...plans, {
            id: partId('plan'), name: plans.length ? 'Full cover' : 'Transit cover', coverPercent: 100,
            premiumBasisPoints: 150, minPremiumMinor: 4_900, maxCoverMinor: null, terms: '', active: true,
          }],
        })}>
          <Icon name="plus" size={14} /> Add a cover plan
        </button>
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
                <MoneyInput label="Price from" value={offering.priceFromMinor} onChange={(priceFromMinor) => update(offering.id, { priceFromMinor })} /></label>
              <label className="field"><span>Days</span>
                <input inputMode="numeric" value={offering.turnaroundDays || ''} onChange={(e) => update(offering.id, { turnaroundDays: Number(e.target.value) || 0 })} /></label>
            </div>
          </div>
          <label className="field"><span>What they get</span>
            <input value={offering.description} onChange={(e) => update(offering.id, { description: e.target.value })}
              placeholder="Strip, prime and airbrush to your reference, sealed." /></label>
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
        <span className="field__hint">Optional. Without them, buyers can only pay you with protection (held by an escrow).</span>
        <div className="field-row">
          <input value={payment.upiId ?? ''} onChange={(e) => pay({ upiId: e.target.value })} placeholder="UPI ID" aria-label="UPI ID" />
          <input value={payment.accountName ?? ''} onChange={(e) => pay({ accountName: e.target.value })} placeholder="Account name" aria-label="Account name" />
        </div>
        <input value={payment.instructions ?? ''} onChange={(e) => pay({ instructions: e.target.value })} placeholder="Anything to quote when paying" aria-label="Payment instructions" />
      </div>
    </div>
  );
}
