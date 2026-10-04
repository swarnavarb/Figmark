import { useState, type CSSProperties, type ReactNode } from 'react';
import type { ArtistOffering, FreightLane, InsurancePlan, PortfolioPiece, StoreStatus } from '@shared/models';
import {
  FREIGHT_MODE_LABELS, STORE_STATUS_LABELS, laneQuoteMinor, transitLabel, type FreightMode,
} from '@shared/service-stores';
import { formatMoney, fromMinor, gradientFor, initialsOf, toMinor } from '../format';

/**
 * The pieces every service-store screen is built from.
 *
 * A store wears one of the app's six hues as its accent, set as custom
 * properties on the element so every child - the mark, the cover, a ticket's
 * stub - takes it without being told. Nothing here invents a colour.
 */

const TEXT_INK: Record<string, string> = {
  violet: 'var(--violet-text)', blue: 'var(--blue-text)', pink: 'var(--pink-text)',
  aqua: 'var(--aqua)', lime: 'var(--lime)', coral: 'var(--coral)',
};

/** A store's accent, as the custom properties its screens read. */
export function accentStyle(accent: string | null | undefined): CSSProperties {
  const hue = accent && TEXT_INK[accent] ? accent : 'violet';
  return {
    '--sk': `var(--${hue === 'violet' ? 'violet-lit' : hue})`,
    '--sk-soft': `var(--${hue}-soft)`,
    '--sk-line': `var(--${hue}-line)`,
    '--sk-text': TEXT_INK[hue],
  } as CSSProperties;
}

/** The store's logo, or its initials on its own hue. */
export function StoreMark({ name, logoUrl, accent, size = 52 }: {
  name: string; logoUrl?: string | null; accent?: string | null; size?: number;
}) {
  return (
    <span className="sk-mark" style={{ ...accentStyle(accent), width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {logoUrl ? <img src={logoUrl} alt="" /> : initialsOf(name)}
    </span>
  );
}

const STATUS_TONE: Record<StoreStatus, string> = {
  pending: 'warn', changes: 'coral', approved: 'ok', rejected: 'danger', suspended: 'danger',
};

export function StatusPill({ status }: { status: StoreStatus | null | undefined }) {
  if (!status) return null;
  return (
    <span className={`sk-status sk-status--${STATUS_TONE[status]}`}>
      <span className="sk-status__dot" aria-hidden="true" />
      {STORE_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The band across the top of a store: its photo if it has one, and otherwise
 * a drawing of what it does - a flight path for a forwarder, brush strokes
 * for a studio - in its own hue, so no store opens on a blank rectangle.
 */
export function StoreCover({ kind, coverUrl, accent, children }: {
  kind: 'forwarder' | 'artist'; coverUrl?: string | null; accent?: string | null; children?: ReactNode;
}) {
  return (
    <div className={`sk-cover sk-cover--${kind}`} style={accentStyle(accent)}>
      {coverUrl ? <img className="sk-cover__img" src={coverUrl} alt="" /> : kind === 'forwarder' ? (
        <svg className="sk-cover__art" viewBox="0 0 600 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <radialGradient id="skglow" cx="80%" cy="20%" r="70%">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.45" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="600" height="180" fill="url(#skglow)" />
          {[30, 60, 90, 120, 150].map((y) => (
            <path key={y} d={`M0 ${y} Q300 ${y - 18} 600 ${y}`} stroke="currentColor" strokeOpacity="0.08" fill="none" />
          ))}
          <path className="sk-cover__route" d="M40 150 C 180 30, 420 20, 560 110" stroke="currentColor" strokeWidth="2.4"
            strokeDasharray="2 9" strokeLinecap="round" fill="none" />
          <circle cx="40" cy="150" r="6" fill="currentColor" />
          <circle cx="560" cy="110" r="6" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <g className="sk-cover__plane" transform="translate(330 46) rotate(8)">
            <path d="M-16 0 L16 0 M2 -3 L-6 -14 L-1 -14 L10 -3 M2 3 L-6 14 L-1 14 L10 3 M-16 0 L-20 -6 M-16 0 L-20 6"
              stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
        </svg>
      ) : (
        <svg className="sk-cover__art" viewBox="0 0 600 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path d="M-20 140 C 80 60, 160 170, 260 90 S 440 30, 620 110" stroke="currentColor" strokeOpacity="0.55"
            strokeWidth="26" strokeLinecap="round" fill="none" />
          <path d="M-20 60 C 120 10, 200 120, 330 60 S 520 140, 620 40" stroke="var(--violet-lit)" strokeOpacity="0.4"
            strokeWidth="14" strokeLinecap="round" fill="none" />
          <path d="M40 175 C 160 120, 300 190, 420 150 S 560 120, 620 160" stroke="var(--aqua)" strokeOpacity="0.28"
            strokeWidth="8" strokeLinecap="round" fill="none" />
          {[[90, 40, 5], [470, 70, 7], [520, 30, 3], [200, 150, 4], [380, 120, 3]].map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="currentColor" fillOpacity="0.7" />
          ))}
        </svg>
      )}
      {children}
    </div>
  );
}

/** The first three letters of a city, the way a ticket prints it. */
const code = (city: string) => (city.replace(/[^A-Za-z]/g, '').slice(0, 3) || '···').toUpperCase();

/**
 * One lane, as a boarding pass: where from and to in big letters, how long and
 * how much on the stub. With a weight it also prices this lot on the lane.
 */
export function LaneTicket({ lane, weightGrams, selected, onSelect, accent }: {
  lane: FreightLane; weightGrams?: number; selected?: boolean; onSelect?: () => void; accent?: string | null;
}) {
  const mode = FREIGHT_MODE_LABELS[lane.mode as FreightMode] ?? FREIGHT_MODE_LABELS.air;
  const body = (
    <>
      <span className="sk-ticket__main">
        <span className="sk-ticket__mode">{mode.glyph} {mode.label}</span>
        <span className="sk-ticket__cities">
          <span className="sk-ticket__end">
            <b>{code(lane.originCity)}</b>
            <span>{lane.originCity}</span>
          </span>
          <span className="sk-ticket__path" aria-hidden="true"><span /></span>
          <span className="sk-ticket__end sk-ticket__end--to">
            <b>{code(lane.destinationCity)}</b>
            <span>{lane.destinationCity}</span>
          </span>
        </span>
        {lane.note && <span className="sk-ticket__note">{lane.note}</span>}
      </span>
      <span className="sk-ticket__stub">
        <span className="sk-ticket__rate">{formatMoney(lane.ratePerKgMinor)}<small>/kg</small></span>
        <span>{transitLabel(lane)}</span>
        {lane.minChargeKg > 0 && <span>min {lane.minChargeKg} kg</span>}
        <span className={lane.customsIncluded ? 'sk-ticket__ok' : ''}>{lane.customsIncluded ? '✓ Customs cleared' : 'Duty at actuals'}</span>
        {weightGrams !== undefined && weightGrams > 0 && (
          <span className="sk-ticket__quote">≈ {formatMoney(laneQuoteMinor(lane, weightGrams))} for this lot</span>
        )}
      </span>
    </>
  );
  const className = `sk-ticket${selected ? ' is-on' : ''}${onSelect ? ' sk-ticket--tap' : ''}`;
  return onSelect ? (
    <button type="button" className={className} style={accentStyle(accent)} onClick={onSelect} aria-pressed={selected}>{body}</button>
  ) : (
    <div className={className} style={accentStyle(accent)}>{body}</div>
  );
}

/** One cover plan, priced for an item when a value is given. */
export function PlanCard({ plan, premiumMinor, coverMinor, selected, onSelect, footer }: {
  plan: InsurancePlan; premiumMinor?: number; coverMinor?: number; selected?: boolean; onSelect?: () => void; footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const inner = (
    <>
      <span className="sk-plan__shield" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 3 4.5 6v5.6c0 4.6 3.2 8.2 7.5 9.4 4.3-1.2 7.5-4.8 7.5-9.4V6Z" />
          <path d="m8.6 12 2.4 2.4 4.4-4.6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="sk-plan__body">
        <span className="sk-plan__name">{plan.name}</span>
        <span className="sk-plan__line">
          {plan.coverPercent}% of value{plan.maxCoverMinor ? `, up to ${formatMoney(plan.maxCoverMinor)}` : ''}
        </span>
      </span>
      <span className="sk-plan__price">
        {premiumMinor !== undefined ? (
          <><b>{formatMoney(premiumMinor)}</b>{coverMinor !== undefined && <small>covers {formatMoney(coverMinor)}</small>}</>
        ) : (
          <><b>{(plan.premiumBasisPoints / 100).toFixed(plan.premiumBasisPoints % 100 ? 1 : 0)}%</b>
            <small>{plan.minPremiumMinor ? `min ${formatMoney(plan.minPremiumMinor)}` : 'of value'}</small></>
        )}
      </span>
    </>
  );
  return (
    <div className={`sk-plan${selected ? ' is-on' : ''}`}>
      {onSelect ? (
        <button type="button" className="sk-plan__pick" onClick={onSelect} aria-pressed={selected}>{inner}</button>
      ) : <div className="sk-plan__pick">{inner}</div>}
      {plan.terms && (
        <button type="button" className="sk-plan__terms-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide terms' : 'What it covers'}
        </button>
      )}
      {open && <p className="sk-plan__terms">{plan.terms}</p>}
      {footer}
    </div>
  );
}

export function OfferingCard({ offering, onPick, picked }: { offering: ArtistOffering; onPick?: () => void; picked?: boolean }) {
  const inner = (
    <>
      <span className="sk-offer__top">
        <span className="sk-offer__name">{offering.name}</span>
        {offering.priceFromMinor > 0 && <span className="sk-offer__price"><small>from</small> {formatMoney(offering.priceFromMinor)}</span>}
      </span>
      {offering.description && <span className="sk-offer__desc">{offering.description}</span>}
      {offering.turnaroundDays > 0 && <span className="sk-offer__days">⏱ about {offering.turnaroundDays} days</span>}
    </>
  );
  return onPick ? (
    <button type="button" className={`sk-offer sk-offer--tap${picked ? ' is-on' : ''}`} onClick={onPick} aria-pressed={picked}>{inner}</button>
  ) : <div className="sk-offer">{inner}</div>;
}

/** A picture by URL, or for a seeded piece, the same generated square an item without a photo gets. */
export function Picture({ url, label, className }: { url: string; label: string; className: string }) {
  if (url.startsWith('seed:')) {
    return <span className={className} style={{ background: gradientFor(url) }}><span className="sk-pic__ini">{initialsOf(label)}</span></span>;
  }
  return <span className={className}><img src={url} alt={label} loading="lazy" /></span>;
}

export function PortfolioGrid({ pieces }: { pieces: PortfolioPiece[] }) {
  if (pieces.length === 0) return null;
  return (
    <div className="sk-folio">
      {pieces.map((piece, index) => (
        <figure key={piece.id} className={`sk-folio__cell${index === 0 ? ' sk-folio__cell--hero' : ''}`}>
          <Picture url={piece.url} label={piece.caption || 'Work'} className="sk-pic" />
          {piece.caption && <figcaption>{piece.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

/** Rupees typed, paise stored. */
export function MoneyInput({ value, onChange, placeholder, label }: {
  value: number; onChange: (minor: number) => void; placeholder?: string; label: string;
}) {
  const [text, setText] = useState(value ? fromMinor(value) : '');
  return (
    <span className="sk-money">
      <span className="sk-money__sym" aria-hidden="true">₹</span>
      <input inputMode="decimal" value={text} placeholder={placeholder ?? '0'} aria-label={label}
        onChange={(event) => { setText(event.target.value); onChange(toMinor(event.target.value)); }} />
    </span>
  );
}

/** A count with a label, for the strips at the top of a console. */
export function StatTile({ value, label, tone }: { value: ReactNode; label: string; tone?: 'warn' | 'ok' | 'accent' }) {
  return (
    <div className={`sk-stat${tone ? ` sk-stat--${tone}` : ''}`}>
      <span className="sk-stat__value">{value}</span>
      <span className="sk-stat__label">{label}</span>
    </div>
  );
}
