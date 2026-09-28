import type { ReactNode } from 'react';

/**
 * The pieces every listing form is built from - the sell page, a private
 * deal, a power sale's items, and editing an item - so listing looks and asks
 * the same wherever it happens.
 *
 * Each question is a box of its own with a small icon and a short title;
 * choices are big tiles or switches rather than bare checkboxes, and the
 * explaining is one short line at most.
 */
export function LBox({ icon, title, hint, right, children, tone }: {
  icon: string;
  title: string;
  hint?: ReactNode;
  /** Something on the title row, such as a switch. */
  right?: ReactNode;
  children?: ReactNode;
  /** A PRO box wears gold. */
  tone?: 'pro';
}) {
  return (
    <section className={`lbox${tone ? ` lbox--${tone}` : ''}`}>
      <header className="lbox__head">
        <span className="lbox__icon" aria-hidden="true">{icon}</span>
        <span className="lbox__titles">
          <b className="lbox__title">{title}</b>
          {hint && <span className="lbox__hint">{hint}</span>}
        </span>
        {right}
      </header>
      {children && <div className="lbox__body">{children}</div>}
    </section>
  );
}

/** An on/off switch, labelled. */
export function Switch({ checked, onChange, label }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={`lswitch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="lswitch__knob" />
    </button>
  );
}

/** A switch with a title and a line under it - one row of a box. */
export function ToggleRow({ checked, onChange, title, hint, icon }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  hint?: string;
  icon?: string;
}) {
  return (
    <div className={`ltoggle${checked ? ' is-on' : ''}`}>
      {icon && <span className="ltoggle__icon" aria-hidden="true">{icon}</span>}
      <span className="ltoggle__text" onClick={() => onChange(!checked)}>
        <b>{title}</b>
        {hint && <span>{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

/** One choice out of a few, as tiles with an icon and a line each. */
export function OptionTiles<T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (next: T) => void;
  options: { id: T; icon: string; title: string; note?: string }[];
  label: string;
}) {
  return (
    <div className="ltiles" role="radiogroup" aria-label={label}
      style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={value === option.id}
          className={`ltile${value === option.id ? ' is-on' : ''}`} onClick={() => onChange(option.id)}>
          <span className="ltile__icon" aria-hidden="true">{option.icon}</span>
          <b className="ltile__title">{option.title}</b>
          {option.note && <span className="ltile__note">{option.note}</span>}
        </button>
      ))}
    </div>
  );
}

/** How an item is sold, which is the same question as where it is. */
export type Shape = 'single' | 'waiting' | 'lot';

export const SHAPE_OPTIONS: { id: Shape; icon: string; title: string; note: string }[] = [
  { id: 'single', icon: '🏠', title: 'In hand', note: 'Ships from your shelf' },
  { id: 'waiting', icon: '✈️', title: 'Import', note: 'Lot added later' },
  { id: 'lot', icon: '📦', title: 'In a lot', note: 'Pick the lot now' },
];

/**
 * Pre-order: how many bookings it needs, and when bookings close.
 *
 * The close date is the item's expiry too - one date, not two - and a
 * pre-order has no fixed stock count, so the quantity and expiry questions
 * step aside while this is on.
 */
export function PreOrderBox({ on, onToggle, units, onUnits, closes, onCloses }: {
  on: boolean;
  onToggle: (next: boolean) => void;
  units: string;
  onUnits: (next: string) => void;
  /** A datetime-local value. */
  closes: string;
  onCloses: (next: string) => void;
}) {
  return (
    <LBox icon="📅" title="Pre-order" hint="Buyers book first; you order once enough are in."
      right={<Switch checked={on} onChange={onToggle} label="Take pre-orders" />}>
      {on && (
        <div className="field-row">
          <label className="field">
            <span>Bookings needed</span>
            <input type="number" min="2" value={units} onChange={(e) => onUnits(e.target.value)} />
          </label>
          <label className="field">
            <span>Bookings close</span>
            <input type="datetime-local" value={closes} onChange={(e) => onCloses(e.target.value)} />
          </label>
        </div>
      )}
    </LBox>
  );
}

/** A datetime-local value `days` from now, in the viewer's own clock. */
export function localInDays(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
