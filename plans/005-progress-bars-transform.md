# 005 — Animate progress fills with transform, not width

- **Status**: DONE (applied in this branch)
- **Commit**: a9e1b80
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: ~9 CSS rules plus the TSX that sets their `width`

## Problem

Progress fills transition `width`, which re-runs layout every frame:

```
app/src/styles.css:1910  .runcard__bar span   transition: width 0.4s
app/src/styles.css:2062  .lothero__bar span   transition: width var(--dur-2) var(--ease)
app/src/styles.css:3086  .mline__bar span     transition: width 700ms var(--ease)
app/src/styles.css:4119  .moneybar__track span transition: width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)
app/src/styles.css:4414  .dealcard__bar > i   transition: width 1s linear
app/src/styles.css:5827  .qxp > span          transition: width var(--dur-2) var(--ease)
app/src/styles.css:6352  .trk__bar span       transition: width 500ms var(--ease)
app/src/styles.css:8069  .ms-crew__bar span   transition: width var(--dur-2) var(--ease)
```

They change rarely, so this is polish, not a fire — but the repo already has
the right pattern one screen away.

## Target

Exemplar already in the repo:

```css
/* app/src/styles.css:10366-10368 */
.goals__fill {
  position: absolute; inset: 0; border-radius: inherit; background: var(--grad-gold);
  transform-origin: left center; transition: transform 600ms var(--ease-out);
```

For each fill: `width: 100%`, `transform-origin: left center`,
`transform: scaleX(var(--p))`, transition `transform` with the same duration and
curve as today. The TSX sets `style={{ '--p': fraction }}` instead of `width: n%`.
Where the fill has its **own** rounded right end inside a track that is not
`overflow: hidden`, `scaleX` would squash the radius — for those use
`clip-path: inset(0 calc((1 - var(--p)) * 100%) 0 0 round <radius>)` and transition `clip-path`.

## Steps

1. For each selector above, find the TSX that writes its width (`grep -rn "<class>" app/src --include=*.tsx`).
2. Check the parent track for `overflow: hidden` + `border-radius` → use `scaleX`; otherwise `clip-path`.
3. Make the CSS and TSX change; keep the reduced-motion rules that zero these transitions.
4. `.dealcard__bar > i` is a countdown (`1s linear`): keep `linear`.

## Boundaries

- Do NOT touch `.carousel__dot` (3722, width of a 6px dot that morphs into a pill — the morph is the point) or `.qkinds__slot` (covered by plan 002).

## Verification

- **Mechanical**: `npm run typecheck`, `npm run build:app`, `npm test`.
- **Feel check**: each bar fills from the left with the same timing as before; rounded ends are not squashed at 10% fill.
- **Done when**: `grep -n 'transition: width' app/src/styles.css` lists only `.carousel__dot`.
