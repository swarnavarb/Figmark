import {
  Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/**
 * A choice from a list, drawn by Figmark rather than the phone.
 *
 * A native <select> opens the operating system's own picker: a wheel on an
 * iPhone, a grey Material sheet on Android, a system menu on a desktop - none
 * of them the app. This opens a sheet of Figmark's own from the bottom of a
 * phone, and a list under the field on a wider screen.
 *
 * It reads the same JSX a <select> did - <option value>…</option> children,
 * `value`, `onChange`, `disabled`, `required`, `aria-label` - and `onChange`
 * receives an object with `target.value`, so a screen's handler did not have
 * to change when its <select> became this.
 */

export interface SelectChange {
  target: { value: string };
  currentTarget: { value: string };
}

interface Choice {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
}

/** The words inside an option, for type-to-jump and the filter. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** The <option>s, through any arrays and fragments a .map() or a condition left around them. */
function choicesOf(children: ReactNode): Choice[] {
  const found: Choice[] = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      const element = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
      if (element.type === Fragment) return walk(element.props.children);
      if (element.type !== 'option') return;
      const text = textOf(element.props.children);
      found.push({
        value: element.props.value === undefined ? text : String(element.props.value),
        label: element.props.children,
        text,
        disabled: Boolean(element.props.disabled),
      });
    });
  };
  walk(children);
  return found;
}

/** Past this many choices the list gets a filter at its top. */
const FILTER_FROM = 12;

export function Select({
  value, onChange, children, disabled = false, required = false, className, style, 'aria-label': ariaLabel, id,
}: {
  value: string | number | undefined;
  onChange: (event: SelectChange) => void;
  children: ReactNode;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  id?: string;
}) {
  const choices = choicesOf(children);
  const current = value === undefined ? '' : String(value);
  const chosen = choices.find((choice) => choice.value === current) ?? null;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const pick = (next: string) => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
    if (next !== current) onChange({ target: { value: next }, currentTarget: { value: next } });
  };

  // Up and down on the closed field step through the choices, as a select's did.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (event.altKey) return setOpen(true);
    const usable = choices.filter((choice) => !choice.disabled);
    const at = usable.findIndex((choice) => choice.value === current);
    const next = usable[Math.max(0, Math.min(usable.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next && next.value !== current) onChange({ target: { value: next.value }, currentTarget: { value: next.value } });
  };

  return (
    <>
      <button ref={button} type="button" id={id}
        className={`fmselect${className ? ` ${className}` : ''}${chosen && chosen.value !== '' ? '' : ' is-empty'}`}
        style={style} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)} onKeyDown={onKeyDown}>
        <span className="fmselect__value">{chosen?.label ?? ''}</span>
        <Icon name="chevron" size={16} />
      </button>
      {/* The form still refuses to send without an answer, as a required select did. */}
      {required && (
        <input className="fmselect__required" tabIndex={-1} aria-hidden="true" required
          value={chosen && !chosen.disabled ? current : ''} onChange={() => undefined}
          onFocus={() => button.current?.focus()} />
      )}
      {open && (
        <ChoiceList id={listId} anchor={button.current} choices={choices} current={current}
          title={ariaLabel ?? labelOf(button.current)} onPick={pick} onClose={() => {
            setOpen(false);
            button.current?.focus({ preventScroll: true });
          }} />
      )}
    </>
  );
}

/** The words of the field's own label, for the sheet's heading. */
function labelOf(element: HTMLElement | null): string {
  const label = element?.closest('label');
  const words = label?.querySelector(':scope > span')?.textContent ?? '';
  return words.replace(/\s*\*$/, '').trim();
}

function ChoiceList({ id, anchor, choices, current, title, onPick, onClose }: {
  id: string;
  anchor: HTMLElement | null;
  choices: Choice[];
  current: string;
  title: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const [place, setPlace] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const filtering = choices.length >= FILTER_FROM;
  const words = filter.trim().toLowerCase();
  const shown = words ? choices.filter((choice) => choice.text.toLowerCase().includes(words)) : choices;

  // Under the field on a wide screen, over it when there is more room above.
  useLayoutEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setPlace({ top: below > 280 || below > rect.top ? rect.bottom + 6 : rect.top - 6, left: rect.left, width: rect.width, up: !(below > 280 || below > rect.top) });
  }, [anchor]);

  // The chosen one in view and in focus; nothing behind scrolls while open.
  useEffect(() => {
    const list = box.current;
    const on = list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLElement>('[role="option"]:not([disabled])');
    on?.scrollIntoView({ block: 'center' });
    // On a phone the keyboard would cover half the list; the filter waits for a tap.
    if (!filtering || matchMedia('(pointer: coarse)').matches) on?.focus({ preventScroll: true });
    else list?.querySelector<HTMLInputElement>('.fmlist__filter input')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [filtering]);

  const options = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])') ?? [])];
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      return onClose();
    }
    const items = options();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => items[Math.max(0, Math.min(items.length - 1, index))]?.focus();
    if (event.key === 'ArrowDown') { event.preventDefault(); go(at + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); go(at < 0 ? items.length - 1 : at - 1); }
    else if (event.key === 'Home') { event.preventDefault(); go(0); }
    else if (event.key === 'End') { event.preventDefault(); go(items.length - 1); }
    else if (event.key.length === 1 && !(event.target instanceof HTMLInputElement)) {
      // Type a letter to jump to the next choice starting with it.
      const letter = event.key.toLowerCase();
      const from = at + 1;
      const next = [...items.slice(from), ...items.slice(0, from)].find((item) => item.textContent?.trim().toLowerCase().startsWith(letter));
      next?.focus();
    }
  };

  const style = place
    ? { '--fmlist-top': `${place.top}px`, '--fmlist-left': `${place.left}px`, '--fmlist-width': `${place.width}px` } as CSSProperties
    : undefined;

  return createPortal(
    <div className="fmlist__scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={box} className={`fmlist${place?.up ? ' fmlist--up' : ''}`} style={style} role="dialog" aria-modal="true"
        aria-label={title || 'Choose'} onKeyDown={onKeyDown}>
        <div className="fmlist__head">
          <span className="fmlist__title">{title || 'Choose one'}</span>
          <button type="button" className="fmlist__close" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        {filtering && (
          <label className="fmlist__filter">
            <Icon name="search" size={16} />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Type to narrow" aria-label="Narrow the list"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); options()[0]?.focus(); }
                if (event.key === 'Enter') { event.preventDefault(); const first = shown.find((choice) => !choice.disabled); if (first) onPick(first.value); }
              }} />
          </label>
        )}
        <div className="fmlist__options" id={id} role="listbox">
          {shown.map((choice) => (
            <button key={choice.value} type="button" role="option" aria-selected={choice.value === current}
              className={`fmlist__option${choice.value === current ? ' is-on' : ''}`} disabled={choice.disabled}
              onClick={() => onPick(choice.value)}>
              <span>{choice.label}</span>
              {choice.value === current && <Icon name="check" size={16} />}
            </button>
          ))}
          {shown.length === 0 && <p className="fmlist__none">Nothing matches “{filter}”.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
