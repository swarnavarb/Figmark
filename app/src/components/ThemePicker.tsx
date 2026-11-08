import { useState, type ReactNode } from 'react';
import { THEMES, readTheme, setTheme, type Theme } from '../theme';

// Drawn rather than typed: the half-moon and sun glyphs fall back to
// whatever font has them, at whatever size it likes.
const GLYPH: Record<Theme, ReactNode> = {
  auto: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  ),
  light: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
    </svg>
  ),
};

/** Auto, Light or Dark, as one segmented control. */
export function ThemePicker({ className = '' }: { className?: string }) {
  const [theme, set] = useState<Theme>(readTheme);
  return (
    <div className={`seg themepick ${className}`.trim()} role="radiogroup" aria-label="Theme">
      {THEMES.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={theme === option.value}
          className={theme === option.value ? 'is-on' : undefined}
          onClick={() => { setTheme(option.value); set(option.value); }}>
          <span aria-hidden="true" className="themepick__glyph">{GLYPH[option.value]}</span>
          {option.label}
        </button>
      ))}
    </div>
  );
}
