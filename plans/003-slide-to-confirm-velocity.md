# 003 — Let a flick confirm SlideToConfirm, and fill it without layout

- **Status**: DONE (applied in this branch)
- **Commit**: a9e1b80
- **Severity**: MEDIUM
- **Category**: Interruptibility / Performance
- **Estimated scope**: 2 files, ~25 lines

## Problem

`app/src/components/SlideToConfirm.tsx` decides only by distance:

```ts
/* app/src/components/SlideToConfirm.tsx:69-78 — current */
function up() {
  if (!start.current) return;
  const at = drag ?? start.current.from;
  const moved = Math.abs(at - start.current.from);
  start.current = null;
  setDrag(null);
  // Past most of the way is a yes; anything less goes home.
  if (!shown && at >= max * 0.85) commit(true);
  else if (shown && at <= max * 0.15) commit(false);
  else if (moved < 4) knob.current?.focus();
}
```

A confident fast flick that releases at 60% snaps back home — the gesture
ignores intent. Separately, the green fill animates `width`, a layout property:

```css
/* app/src/styles.css:9558 — current */
.slide__fill { position: absolute; inset: 0 auto 0 0; border-radius: var(--r-pill); background: var(--rdy, var(--ok)); opacity: 0.85; transition: width var(--dur-2) cubic-bezier(0.22, 1, 0.36, 1); }
```

## Target

- Track the pointer's velocity over the last ~80ms. On release, a flick in the
  confirming direction with speed **> 0.11 px/ms** that has travelled at least
  **35%** of `max` commits, as does the existing 85% distance rule. Mirror for
  turning off (≤ 65% and flick leftwards).
- Fill via `clip-path` (documented exception to transform/opacity) instead of `width`:

```css
.slide__fill { position: absolute; inset: 0; border-radius: var(--r-pill); background: var(--rdy, var(--ok)); opacity: 0.85;
  clip-path: inset(0 calc(100% - var(--fill)) 0 0 round var(--r-pill));
  transition: clip-path var(--dur-2) cubic-bezier(0.22, 1, 0.36, 1); }
```

and in TSX `style={{ '--fill': \`calc(${x}px + 44px)\` } as React.CSSProperties}`.

## Repo conventions to follow

- Keep the file's comment style: short plain-English comments over intent.
- Existing `.slide.is-dragging .slide__fill { transition: none; }` (styles.css:9565) and the reduced-motion block (styles.css:9571) must keep working — they reference `transition`, which still applies to `clip-path`.

## Steps

1. Extend the `start` ref type with `last: { x: number; t: number }` and `v: number`.
2. In `down`, set `last = { x: event.clientX, t: event.timeStamp }`, `v = 0`.
3. In `move`, compute `dt = event.timeStamp - last.t`; if `dt > 0`, `v = 0.7 * ((event.clientX - last.x) / dt) + 0.3 * v`; update `last`.
4. In `up`, read `v` (treat it as 0 if the last move was > 80ms ago) and replace the two commit lines with:
   ```ts
   const flickOn = v > 0.11 && at >= max * 0.35;
   const flickOff = v < -0.11 && at <= max * 0.65;
   if (!shown && (at >= max * 0.85 || flickOn)) commit(true);
   else if (shown && (at <= max * 0.15 || flickOff)) commit(false);
   ```
5. Swap the fill's `width` style for the `--fill` custom property and update the CSS rule as in Target.

## Boundaries

- Do NOT change keyboard behaviour (`click` with `detail === 0`).
- Do NOT change the knob's `transform` transition.

## Verification

- **Mechanical**: `npm run typecheck`, `npm run build:app`, `npm test`.
- **Feel check** on a real phone: a quick flick from the left edge confirms; a slow drag to 60% and release goes home; the fill tracks the knob with no lag; DevTools Performance shows no Layout during the release animation.
- **Done when**: both flick directions work and `.slide__fill` no longer transitions `width`.
