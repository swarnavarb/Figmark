# 006 — Drag-to-dismiss on the Create sheet (missed opportunity)

- **Status**: TODO
- **Commit**: a9e1b80
- **Severity**: LOW (additive)
- **Category**: Missed opportunities / gestures
- **Estimated scope**: 1 TSX (`app/src/components/CreateSheet.tsx`), 1 CSS block

## Problem

`CreateSheet` is a bottom sheet on a phone app, but it closes only by tapping
the scrim:

```tsx
/* app/src/components/CreateSheet.tsx:226-227 — current */
<div className="csheet" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
  <div className="csheet__box" role="dialog" aria-modal="true" aria-labelledby="csheet-title">
```

People expect to pull a sheet down. It is the most-used entry to selling.

## Target

- Pointer drag on the sheet's top 48px (handle area) moves `.csheet__box` with
  `transform: translateY(dy)` 1:1, `transition: none` while dragging.
  Upward drag gets rising friction: `dy < 0 → dy * 0.2`.
- On release dismiss if `dy > box.height * 0.3` **or** downward velocity `> 0.11 px/ms`
  (same EMA as plan 003). Dismiss = `transition: transform 240ms var(--ease-out)`
  to `translateY(100%)`, then `onClose()` on `transitionend`.
  Otherwise spring home: `transition: transform var(--spring-snappy-dur) var(--spring-snappy)` (tokens from plan 002; if 002 is not done use `260ms var(--ease-out)`).
- `touch-action: none` on the handle only, so the sheet body still scrolls.
- Reduced motion: no drag translate; close on release past threshold without animating.

## Repo conventions to follow

- Pointer capture pattern as in `app/src/components/SlideToConfirm.tsx:58-62`.
- Drawer curve already in tokens: `--ease: cubic-bezier(0.32, 0.72, 0, 1)`.

## Steps

1. Add a visible grab handle (`<span className="csheet__grip" aria-hidden="true" />`) at the top of `.csheet__box`.
2. Add pointer handlers on the grip area as described; write `style.transform` directly on the box ref (no React state per move).
3. CSS: `.csheet__grip { display:block; width:36px; height:5px; margin:8px auto 4px; border-radius:var(--r-pill); background:var(--border-strong); touch-action:none; }`.

## Boundaries

- Do NOT change the scrim click or Escape behaviour.
- Depends softly on plan 002 (tokens).

## Verification

- **Mechanical**: `npm run typecheck`, `npm run build:app`.
- **Feel check** on a real phone: the sheet tracks the finger exactly; a short fast flick dismisses; a slow half-drag returns; scrolling the sheet's list does not drag the sheet.
- **Done when**: both dismissal paths work and nothing else about the sheet changed.
