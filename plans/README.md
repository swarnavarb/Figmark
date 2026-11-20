# Animation plans

Written by the `improve-animations` skill (Emil Kowalski's animation philosophy)
against commit `a9e1b80`. Each plan is self-contained: hand one file to any
agent and it has every path, value and check it needs.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Gate hover styles to devices that really hover](001-gate-hover-motion.md) | HIGH | DONE |
| 002 | [Replace hand-tuned overshoot curves with real spring tokens](002-spring-tokens.md) | MEDIUM | DONE |
| 003 | [Let a flick confirm SlideToConfirm, fill without layout](003-slide-to-confirm-velocity.md) | MEDIUM | DONE |
| 004 | [Tiny spring helper + momentum on the quest sticker spin](004-spring-util-quest-spin.md) | MEDIUM | DONE |
| 005 | [Animate progress fills with transform, not width](005-progress-bars-transform.md) | LOW | DONE |
| 006 | [Drag-to-dismiss on the Create sheet](006-drag-to-dismiss-sheets.md) | LOW (additive) | DONE |

## Where the result differs from the plan text

- **003**: the flick threshold is 0.3 px/ms past halfway, not 0.11 px/ms past
  35%. This control clears parcels and confirms payments; a brushing thumb
  must not trip it. Also fixed while testing: on release the component read
  the knob position from the last render, which lags a fast flick by a frame.
- **005**: every fill uses `clip-path` (with `round`), not `scaleX`, so no
  rounded end is ever squashed; four more bars than listed were converted
  (`sa-progress`, `cl-btncard__bar`, `hx-meter`, `setupcheck__bar`).
- **006**: the grip and the title row are the handle (the grip alone is 4px).

## Order and dependencies

1. **002** first: it adds the `--spring-snappy` / `--spring-bouncy` tokens.
2. **003** and **004** next. They share the velocity-tracking pattern (EMA
   0.7/0.3, flick threshold 0.11 px/ms); 004 adds `app/src/spring.ts`.
3. **006** uses the tokens from 002 and the velocity pattern from 003.
4. **005** is independent polish.

## Also changed in this branch (remove-animations pass)

- Whole-page `<main className="page tab-view">` no longer plays the 260ms
  rise: RouteFade already cross-fades every navigation, so it was two
  animations for one change. In-page tab swaps keep `.tab-view`.
- The Pro tab chip no longer loops its gradient drift (it's a tab people flip
  through, and `background-position` loops repaint every frame).
- The "expires soon" chip pulses once instead of forever; the PRO badge
  sheens once on arrival instead of every 3.6s in every list row.
