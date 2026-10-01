/**
 * The calculator's mark: a plain line-drawn calculator, the same one the
 * floating button wears, used wherever the calculator is named. Drawn in the
 * text colour so it sits in a heading, a chip or a label alike. `open` turns
 * it into a cross, for the floating button while its calculator is showing.
 */
export function CalcIcon({ size = 18, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg className="calcicon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? (
        <path d="M6 6l12 12M18 6L6 18" />
      ) : (
        <>
          <rect x="5" y="3" width="14" height="18" rx="3" />
          <path d="M8.5 7.5h7" />
          <path d="M9 12h.01M12 12h.01M15 12h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01" strokeWidth="2.4" />
        </>
      )}
    </svg>
  );
}
