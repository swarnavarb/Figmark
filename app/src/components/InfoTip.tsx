import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/InfoTip.css';

/** A small ⓘ that opens a note beside it. Escape, a tap elsewhere or scrolling closes it. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const id = useId();

  // Drawn on the page itself, outside every panel: a row with a backdrop blur
  // or a board with overflow hidden would otherwise trap it underneath.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - 16 - width);
    setAt({ top: rect.bottom + 8, left, width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!bubble.current?.contains(target) && !button.current?.contains(target)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button ref={button} type="button" className={`qinfo${open ? ' is-on' : ''}`} aria-label={label}
        aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
        i
      </button>
      {open && at && createPortal(
        <div ref={bubble} id={id} role="note" className="qinfo__bubble" style={{ top: at.top, left: at.left, width: at.width }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
