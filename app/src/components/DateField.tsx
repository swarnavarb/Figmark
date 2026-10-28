import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/**
 * A day, picked on Figmark's own calendar.
 *
 * Stands in for <input type="date">, which on a phone opens the operating
 * system's date wheel. `value` and the `onChange` value are "YYYY-MM-DD", or
 * '' for no day, exactly what the native field gave, so a handler written for
 * it keeps working.
 */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

function parts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) } : null;
}

/** "Tue, 4 Nov 2026": the day as the field shows it once chosen. */
function spoken(value: string): string {
  const day = parts(value);
  if (!day) return '';
  return new Date(day.year, day.month, day.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function DateField({ value, onChange, placeholder = 'Pick a day', min, disabled = false, 'aria-label': ariaLabel }: {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  placeholder?: string;
  /** The first day that can be chosen, "YYYY-MM-DD". */
  min?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const choose = (next: string) => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
    if (next !== value) onChange({ target: { value: next } });
  };
  return (
    <>
      <button ref={button} type="button" className={`fmselect fmdate${value ? '' : ' is-empty'}`} disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        <span className="fmselect__value">{value ? spoken(value) : placeholder}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
      {open && <Calendar value={value} min={min} onPick={choose} onClose={() => { setOpen(false); button.current?.focus(); }} />}
    </>
  );
}

function Calendar({ value, min, onPick, onClose }: {
  value: string;
  min?: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const todayKey = keyOf(today.getFullYear(), today.getMonth(), today.getDate());
  const start = parts(value) ?? { year: today.getFullYear(), month: today.getMonth(), day: today.getDate() };
  const [view, setView] = useState({ year: start.year, month: start.month });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('.fmcal__day.is-on, .fmcal__day.is-today, .fmcal__day:not([disabled])')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  const step = (months: number) => setView((current) => {
    const next = new Date(current.year, current.month + months, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  });

  // Monday first; blanks before the 1st so it falls under its weekday.
  const lead = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
  const days = new Date(view.year, view.month + 1, 0).getDate();

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return onClose(); }
    const focused = document.activeElement as HTMLElement | null;
    const day = Number(focused?.dataset.day);
    if (!day) return;
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!move) return;
    event.preventDefault();
    const target = day + move;
    if (target < 1 || target > days) {
      step(target < 1 ? -1 : 1);
      return;
    }
    box.current?.querySelector<HTMLElement>(`[data-day="${target}"]`)?.focus();
  };

  return createPortal(
    <div className="fmlist__scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={box} className="fmlist fmcal" role="dialog" aria-modal="true" aria-label="Choose a day" onKeyDown={onKeyDown}>
        <div className="fmlist__head">
          <span className="fmlist__title">{MONTHS[view.month]} {view.year}</span>
          <span className="fmcal__nav">
            <button type="button" className="fmlist__close" aria-label="Previous month" onClick={() => step(-1)}><Icon name="left" size={18} /></button>
            <button type="button" className="fmlist__close" aria-label="Next month" onClick={() => step(1)}><Icon name="right" size={18} /></button>
            <button type="button" className="fmlist__close" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
          </span>
        </div>
        <div className="fmcal__grid" role="grid">
          {WEEKDAYS.map((name) => <span key={name} className="fmcal__weekday" aria-hidden="true">{name}</span>)}
          {Array.from({ length: lead }, (_, index) => <span key={`b${index}`} />)}
          {Array.from({ length: days }, (_, index) => {
            const day = index + 1;
            const key = keyOf(view.year, view.month, day);
            const blocked = Boolean(min && key < min);
            return (
              <button key={key} type="button" data-day={day} disabled={blocked}
                className={`fmcal__day${key === value ? ' is-on' : ''}${key === todayKey ? ' is-today' : ''}`}
                aria-pressed={key === value} aria-label={spoken(key)} onClick={() => onPick(key)}>
                {day}
              </button>
            );
          })}
        </div>
        <div className="fmcal__foot">
          {value && <button type="button" className="btn btn--quiet btn--sm" onClick={() => onPick('')}>Clear</button>}
          <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(min && todayKey < min)} onClick={() => onPick(todayKey)}>Today</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
