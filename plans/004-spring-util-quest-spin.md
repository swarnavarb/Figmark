# 004 — A tiny spring helper, and momentum on the quest sticker spin

- **Status**: TODO
- **Commit**: a9e1b80
- **Severity**: MEDIUM
- **Category**: Interruptibility (spring physics for gestures)
- **Estimated scope**: 1 new file (`app/src/spring.ts`, ~50 lines), 1 edit (`app/src/components/Quest.tsx`)

## Problem

The sticker in `app/src/components/Quest.tsx` can be grabbed mid-spin (good —
`down()` reads the live angle at line ~396), but on release it snaps to the
nearest face with a fixed tween that ignores how hard it was flung:

```ts
/* app/src/components/Quest.tsx:378-388 — current */
el.animate(
  [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }],
  { duration: ms, easing: 'cubic-bezier(0.17, 0.84, 0.28, 1)' },
);
```

A fast flick and a lazy nudge land identically; the motion has no mass.
CSS can't take an initial velocity, so this is the one place a JS spring earns its keep.

## Target

`app/src/spring.ts`, no dependency, WAAPI-based (runs off the main thread once started):

```ts
/** Damped spring, Apple model: duration (s) and bounce (0–1). v0 in units/s. */
export function springKeyframes(from: number, to: number, v0: number,
  { duration = 0.5, bounce = 0.2 } = {}, format: (v: number) => string) {
  const w = (2 * Math.PI) / duration, z = 1 - bounce, span = to - from;
  const vn = span === 0 ? 0 : v0 / span;               // velocity normalised to the span
  const wd = w * Math.sqrt(Math.max(1e-6, 1 - z * z));
  const x = (t: number) => 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w - vn) / wd) * Math.sin(wd * t));
  const frames: Keyframe[] = []; let t = 0, settle = 0;
  for (; t < 4; t += 1 / 60) { frames.push({ transform: format(from + span * x(t)) });
    if (Math.abs(x(t) - 1) < 0.002) { if (++settle > 6) break; } else settle = 0; }
  frames.push({ transform: format(to) });
  return { frames, ms: Math.round(t * 1000) };
}
```

In Quest: track angular velocity (deg/ms → ×1000 for deg/s) in `move` the same
way as plan 003 (EMA 0.7/0.3, ignore if last move > 80ms old). In `up`:

```ts
const projected = at + v * 0.35;                       // where the fling would carry it
const to = Math.round(projected / 360) * 360;           // nearest front face
const { frames, ms } = springKeyframes(at, to, v, { duration: 0.6, bounce: 0.25 }, (d) => `rotateY(${d}deg)`);
el.animate(frames, { duration: ms, easing: 'linear' });
```

Keep the existing `still` (reduced motion) early return.

## Repo conventions to follow

- Small single-purpose modules at `app/src/*.ts` with a top doc comment (exemplar: `app/src/haptics.ts`).
- Reduced motion via `reducedMotion()` from `app/src/motion.ts`.

## Steps

1. Create `app/src/spring.ts` with the function above and a doc comment.
2. In `Quest.tsx` add velocity tracking to the drag ref and `move`.
3. Replace the release branch (the `held.moved` path in `up`) with the spring call. Leave the tap path (`!held.moved` → full turn) and the initial 1200ms spin as they are.

## Boundaries

- Do NOT add a library (framer-motion/motion/react-spring).
- Do NOT change the initial entrance spin.

## Verification

- **Mechanical**: `npm run typecheck`, `npm run build:app`.
- **Feel check**: a hard flick spins one or two extra turns and settles with a small overshoot; a gentle drag settles to the nearest face; grabbing it mid-settle stops it under the finger.
- **Done when**: release speed visibly changes where and how the sticker lands.
