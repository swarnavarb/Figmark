# 001 — Gate hover styles to devices that really hover

- **Status**: DONE (applied in this branch)
- **Commit**: a9e1b80
- **Severity**: HIGH
- **Category**: Accessibility (touch false-hover) / mobile-native
- **Estimated scope**: 1 file (`app/vite.config.ts`), ~40 lines

## Problem

Figmark is a phone-first PWA, but almost every `:hover` rule in the stylesheets
applies on touch screens too. On iOS and Android a tap fires a synthetic hover
that **sticks** until the user taps somewhere else, so a card tapped to open it
stays lifted, a button stays highlighted after its action is done.

`app/src/styles.css` has 181 `:hover` rules and only 3 `@media (hover: …)`
blocks. Roughly 85 of the ungated rules move things (transform), e.g.:

```css
/* app/src/styles.css:1929 — current */
.door:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow); }
/* app/src/styles.css:1989 */
.lotbox:hover { transform: translateY(-2px); }
/* app/src/styles.css:4273 */
.instile:hover { transform: translateY(-2px); border-color: var(--border-strong); }
/* app/src/styles.css:4791 */
.chmine:hover { transform: translateY(-2px); }
```

Hand-wrapping ~180 rules across 30 stylesheets is error-prone and every new rule
would need remembering. The repo already rewrites media queries at build time
(`motionFollowsChoice` in `app/vite.config.ts`), so the same mechanism fits.

## Target

A PostCSS plugin that, for every rule outside an existing `@media (hover…)`
query, moves the selectors containing `:hover` into
`@media (hover: hover) and (pointer: fine) { … }` placed **immediately after**
the original rule (so source order — and the cascade — is unchanged). Selectors
in the same list without `:hover` (e.g. `:active`, `:focus-visible`) stay where
they are, so touch still gets press and keyboard feedback.

```css
/* in:  */ .csheet__tile:hover, .csheet__tile:active { transform: scale(0.98); }
/* out: */ .csheet__tile:active { transform: scale(0.98); }
           @media (hover: hover) and (pointer: fine) { .csheet__tile:hover { transform: scale(0.98); } }
```

## Repo conventions to follow

- Exemplar: `motionFollowsChoice` in `app/vite.config.ts` — a `PostcssPlugin`
  object with a doc comment explaining *why*, registered in
  `css.postcss.plugins`.
- Skip rules inside `@keyframes` and inside any `@media` whose params already
  mention `hover`.

## Steps

1. In `app/vite.config.ts`, add `import type { Rule } from 'postcss'` to the existing type import.
2. Add a `hoverNeedsAPointer` plugin with a `Rule` visitor:
   - return if `rule.selector` has no `:hover`; return if any ancestor is an
     at-rule named `keyframes` or a `media` at-rule whose params match `/hover/`;
     return if the rule is already marked (use a `WeakSet`).
   - split `rule.selectors` into `hover` and `rest`.
   - clone the rule with `selectors = hover`, wrap it in a new
     `@media (hover: hover) and (pointer: fine)` at-rule, insert it after `rule`.
   - if `rest` is empty remove `rule`, else set `rule.selectors = rest`.
3. Register it **after** `motionFollowsChoice` in `css.postcss.plugins`.

## Boundaries

- Do NOT edit any `.css` file by hand.
- Do NOT gate `:focus-visible` or `:active`.
- Do NOT add dependencies (postcss is already present through Vite).

## Verification

- **Mechanical**: `npm run build:app` succeeds; in `app/dist/assets/*.css`,
  `.door:hover` appears only inside `@media (hover:hover) and (pointer:fine)`;
  `.csheet__tile:active` still appears unwrapped. `npm test` passes.
- **Feel check**: on a phone (or DevTools device mode with touch), tap a
  store card, go back — it must not stay lifted. On a laptop with a mouse,
  hovering `.door` still lifts it 2px.
- **Done when**: no `:hover` selector in the built CSS sits outside a hover media query.
