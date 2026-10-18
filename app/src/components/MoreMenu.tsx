import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

/** One line in a ⋯ menu: a press, or a place to go. */
export interface MoreItem {
  label: ReactNode;
  onClick?: () => void;
  to?: string;
  state?: unknown;
  /** Something that cannot be taken back, in red. */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The ⋯ that holds what a card can do but rarely does - the listing, cancel,
 * delete - so the card itself shows only what is next. Same look as the ⋮ on
 * posts and comments, drawn over the page so no card clips it.
 */
export function MoreMenu({ items, label = 'More' }: { items: readonly (MoreItem | null | false | undefined)[]; label?: string }) {
  const shown = items.filter((item): item is MoreItem => Boolean(item));
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLSpanElement>(null);
  const navigate = useNavigate();

  function toggle() {
    if (!open && button.current) {
      const rect = button.current.getBoundingClientRect();
      const width = 200;
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      const below = window.innerHeight - rect.bottom > 40 + shown.length * 44;
      setPlace(below ? { left, top: rect.bottom + 4 } : { left, bottom: window.innerHeight - rect.top + 4 });
    }
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === 'scroll' || event.type === 'resize' || !(event.target instanceof Node)
        || !(list.current?.contains(event.target) || button.current?.contains(event.target))) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (shown.length === 0) return null;

  return (
    <span className="cmenu">
      <button ref={button} type="button" className="iconbtn cmenu__btn" aria-label={label} aria-haspopup="menu"
        aria-expanded={open} onClick={toggle}>
        ⋯
      </button>
      {open && createPortal(
        <span ref={list} className="cmenu__list" role="menu" style={place}>
          {shown.map((item, index) => (
            <button key={index} type="button" role="menuitem" disabled={item.disabled}
              className={item.danger ? 'is-danger' : undefined}
              onClick={() => {
                setOpen(false);
                if (item.to) navigate(item.to, { state: item.state });
                else item.onClick?.();
              }}>
              {item.label}
            </button>
          ))}
        </span>,
        document.body,
      )}
    </span>
  );
}
