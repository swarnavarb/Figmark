import { useEffect, useState } from 'react';
import type { RouteProblem } from '@shared/buttons';
import { stepButtonLabel, type RouteStep } from '@shared/routes';

/**
 * Pip, the parcel who helps write a tracking timeline.
 *
 * Two jobs. On a blank route Pip asks a handful of questions - who gets the
 * item first, how the lot travels, where it lands - and lays down a step for
 * each answer, so the chain grows on screen as the seller talks. On a route
 * that already exists Pip reads it and suggests the one thing most worth
 * fixing, with a button that does it.
 */

export type PipMood = 'happy' | 'think' | 'cheer';

/** The character itself: a cardboard parcel with a face, drawn inline so it themes and animates. */
export function Pip({ mood = 'happy', size = 64 }: { mood?: PipMood; size?: number }) {
  return (
    <svg className={`pip pip--${mood}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="pip-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7C46C" />
          <stop offset="1" stopColor="#D98B3A" />
        </linearGradient>
      </defs>
      <g className="pip__antenna">
        <line x1="32" y1="14" x2="32" y2="6" stroke="#8A5A24" strokeWidth="2" strokeLinecap="round" />
        <circle className="pip__bulb" cx="32" cy="5" r="3.4" fill="#A78BFA" />
      </g>
      <g className="pip__body">
        <rect x="9" y="14" width="46" height="38" rx="9" fill="url(#pip-body)" />
        <path d="M9 24 H55" stroke="#B7742F" strokeWidth="1.4" opacity="0.6" />
        <rect x="28" y="14" width="8" height="10" fill="#FBE3B2" opacity="0.85" />
        <g className="pip__eyes">
          <ellipse cx="23" cy="34" rx="4.2" ry="4.8" fill="#fff" />
          <ellipse cx="41" cy="34" rx="4.2" ry="4.8" fill="#fff" />
          <circle cx="24" cy="35" r="2.2" fill="#2A1A0C" />
          <circle cx="42" cy="35" r="2.2" fill="#2A1A0C" />
        </g>
        <circle cx="16" cy="42" r="2.6" fill="#F28B82" opacity="0.55" />
        <circle cx="48" cy="42" r="2.6" fill="#F28B82" opacity="0.55" />
        {mood === 'think' && <circle cx="32" cy="44" r="2.2" fill="#2A1A0C" />}
        {mood === 'happy' && <path d="M27 42 Q32 47 37 42" stroke="#2A1A0C" strokeWidth="2" fill="none" strokeLinecap="round" />}
        {mood === 'cheer' && <path d="M26 41 Q32 50 38 41 Z" fill="#2A1A0C" />}
      </g>
      <rect x="16" y="52" width="9" height="5" rx="2.5" fill="#8A5A24" />
      <rect x="39" y="52" width="9" height="5" rx="2.5" fill="#8A5A24" />
    </svg>
  );
}

/** Text that types itself out, the way a character talks. All at once under reduced motion. */
function useTyped(text: string): string {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) { setShown(text); return; }
    let at = 0;
    setShown('');
    const timer = window.setInterval(() => {
      at += 2;
      setShown(text.slice(0, at));
      if (at >= text.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [text]);
  return shown;
}

export interface PipChoice { id: string; label: string; primary?: boolean; onPick: () => void }

/** Pip and a speech bubble, with the answers Pip is waiting for as buttons. */
export function PipSays({ text, mood = 'happy', choices = [], step, of, onHide }: {
  text: string;
  mood?: PipMood;
  choices?: PipChoice[];
  /** Which question this is, when Pip is asking a run of them. */
  step?: number;
  of?: number;
  onHide?: () => void;
}) {
  const typed = useTyped(text);
  const done = typed.length >= text.length;
  return (
    <div className="pipdock">
      <span className="pipdock__pip" key={text}><Pip mood={mood} /></span>
      <div className="pipdock__talk">
        <div className="pipdock__bubble" aria-live="polite">
          {step !== undefined && of !== undefined && (
            <span className="pipdock__count">Question {step} of {of}</span>
          )}
          <p className="pipdock__text"><span aria-hidden="true">{typed}</span><span className="pipdock__sr">{text}</span></p>
        </div>
        {choices.length > 0 && (
          <div className={`pipdock__choices${done ? ' is-ready' : ''}`}>
            {choices.map((choice, index) => (
              <button key={choice.id} type="button" style={{ ['--i' as string]: index }}
                className={`pipdock__choice${choice.primary ? ' is-primary' : ''}`} onClick={choice.onPick}>
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {onHide && (
        <button type="button" className="pipdock__hide" aria-label="Hide Pip" onClick={onHide}>×</button>
      )}
    </div>
  );
}

/* ── The questions ─────────────────────────────────────────────────────── */

export interface PipAnswers {
  first?: 'warehouse' | 'forwarder' | 'supplier' | 'inhand';
  packed?: boolean;
  travel?: 'air' | 'sea' | 'courier';
  customs?: boolean;
  land?: 'warehouse' | 'me';
  lastPack?: boolean;
}

type Key = keyof PipAnswers;

interface Question {
  key: Key;
  ask: (answers: PipAnswers) => string;
  choices: { value: PipAnswers[Key]; label: string }[];
  /** Skipped when the answers so far make it moot. */
  skip?: (answers: PipAnswers) => boolean;
}

const QUESTIONS: Question[] = [
  {
    key: 'first',
    ask: () => "Hi, I'm Pip! 📦 Step 1, 🧾 Order placed, is already in - every timeline starts there. So who gets the item first after a buyer orders?",
    choices: [
      { value: 'warehouse', label: '🏬 My China warehouse' },
      { value: 'forwarder', label: '🤝 A freight forwarder' },
      { value: 'supplier', label: '🏭 The supplier ships it' },
      { value: 'inhand', label: '🏠 I already have it' },
    ],
  },
  {
    key: 'packed',
    ask: (a) => `Got it - step 2 is "${firstStepName(a.first)}", and its button is yours to press. Does it get packed or consolidated before it leaves?`,
    choices: [{ value: true, label: '📦 Yes, packed first' }, { value: false, label: '➡️ No, it goes as is' }],
    skip: (a) => a.first === 'inhand',
  },
  {
    key: 'travel',
    ask: () => 'Now the lot - everything from here moves together. How does it travel?',
    choices: [
      { value: 'air', label: '✈️ By air' },
      { value: 'sea', label: '🚢 By sea' },
      { value: 'courier', label: '🚚 International courier' },
    ],
    skip: (a) => a.first === 'inhand',
  },
  {
    key: 'customs',
    ask: () => 'Should buyers see customs clearance as its own step?',
    choices: [{ value: true, label: '🛃 Yes, show customs' }, { value: false, label: '🙈 No, skip it' }],
    skip: (a) => a.first === 'inhand',
  },
  {
    key: 'land',
    ask: () => 'Where does the lot land? That is where it gets unpacked, and each item goes on alone.',
    choices: [{ value: 'warehouse', label: '🏬 My India warehouse' }, { value: 'me', label: '🏠 Straight to me' }],
    skip: (a) => a.first === 'inhand',
  },
  {
    key: 'lastPack',
    ask: (a) => (a.first === 'inhand'
      ? 'In hand - easy! Last mile then: do you pack each order before it goes out?'
      : 'Last mile! 🚚 Each item now goes to its own buyer. Do you pack each one before dispatch?'),
    choices: [{ value: true, label: '📦 Yes, I pack each' }, { value: false, label: '🚚 Straight to the courier' }],
  },
];

function firstStepName(first: PipAnswers['first']): string {
  if (first === 'forwarder') return 'Received by the freight forwarder';
  if (first === 'supplier') return 'Shipped by the supplier';
  return 'Received at the China warehouse';
}

/** The questions still to be asked, in order. */
export function pipQueue(answers: PipAnswers): Question[] {
  return QUESTIONS.filter((question) => answers[question.key] === undefined && !question.skip?.(answers));
}

/** How many questions this run will have, given what has been answered. */
export function pipTotal(answers: PipAnswers): number {
  return QUESTIONS.filter((question) => !question.skip?.(answers)).length;
}

export { QUESTIONS as PIP_QUESTIONS };

/* Ids from the words, so a step Pip already laid down keeps its place on screen as the chain grows. */
const make = (name: string, description: string, extra: Partial<RouteStep> = {}): RouteStep => ({
  id: `pip_${name.toLowerCase().replace(/[^a-z]+/g, '_')}`, name, description, position: 0, ...extra,
});

/**
 * The route the answers so far describe: steps, the side each is on, and
 * where the last mile starts. Partial answers give a partial route - which
 * is the point: the chain grows as Pip is answered.
 */
export function routeFromAnswers(a: PipAnswers): RouteStep[] {
  const pre: RouteStep[] = [make('Order placed', 'Placed with the shop. The buyer pays, and the seller confirms it.', { locked: true })];
  if (a.first === 'warehouse') {
    pre.push(make('Received at {origin} warehouse', 'Counted in and waiting for a lot.', { trigger: 'china_received', button: 'At warehouse' }));
  } else if (a.first === 'forwarder') {
    pre.push(make('Received by the freight forwarder', 'The forwarder has it and will ship it with the lot.', { trigger: 'china_received', button: 'Forwarder got it' }));
  } else if (a.first === 'supplier') {
    pre.push(make('Shipped by the supplier', 'On its way from the factory to the lot.', { trigger: 'china_received', button: 'Supplier sent' }));
  }
  if (a.packed) pre.push(make('Packed at {origin}', 'Boxed up and ready for the lot.', { trigger: 'china_packed', button: 'Packed for the lot' }));

  const lot: RouteStep[] = [];
  if (a.travel === 'air') {
    lot.push(make('Flying out of {origin}', 'The lot is on a flight.', { forward: true }), make('Landed in {destination}', 'Off the plane.'));
  } else if (a.travel === 'sea') {
    lot.push(make('Sailing from {origin}', 'The lot is on a ship.', { forward: true }), make('Arrived at {destination} port', 'Off the ship.'));
  } else if (a.travel === 'courier') {
    lot.push(make('With the international courier', 'Handed over to the courier.', { forward: true }), make('Arrived in {destination}', 'In the country.'));
  }
  if (a.customs) lot.push(make('Customs cleared', 'Cleared on arrival.'));
  if (a.land === 'warehouse') {
    lot.push(make('Received at {destination} warehouse', 'Unpacked - each item goes on alone from here.', { trigger: 'india_received', button: 'At India WH' }));
  } else if (a.land === 'me') {
    lot.push(make('Received by the seller', 'Unpacked - each item goes on alone from here.', { trigger: 'india_received', button: 'Got it' }));
  }

  const last: RouteStep[] = [];
  if (a.lastPack !== undefined) {
    if (a.lastPack) last.push(make('Packed for you', 'Boxed for the courier.', { trigger: 'packed', button: 'Packed for the buyer' }));
    last.push(make('Dispatched to you', 'Handed to the courier for the last leg.', { trigger: 'dispatched', button: 'Dispatched' }));
  }

  return [
    ...pre.map((step) => ({ ...step, side: 'pre' as const })),
    ...lot.map((step) => ({ ...step, side: 'post' as const })),
    ...last.map((step) => ({ ...step, side: 'post' as const, lastMile: true })),
  ];
}

/** What Pip says once a question is answered: the step it just laid down. */
export function pipAck(before: RouteStep[], after: RouteStep[]): string {
  const added = after.filter((step) => !before.some((old) => old.name === step.name));
  if (added.length === 0) return 'Okay, nothing to add there.';
  const first = before.length + 1;
  const names = added.map((step) => `"${step.name.replace(/\{(origin|destination)\}/g, (_, key) => (key === 'origin' ? 'China' : 'India'))}"`);
  return added.length === 1
    ? `Step ${first} is ${names[0]}.`
    : `Steps ${first}-${first + added.length - 1}: ${names.join(', ')}.`;
}

/* ── Suggestions on a route that already exists ───────────────────────── */

export type PipFix =
  | { kind: 'preview' }
  | { kind: 'name' }
  | { kind: 'focus'; stepId: string };

export interface PipTip { id: string; mood: PipMood; text: string; fix?: { label: string; action: PipFix } }

/**
 * The one thing most worth doing to this route next, and the ones after it.
 *
 * Which button moves which step is never a tip any more - that is handed out
 * for the seller, in order, on every edit. What Pip reads out is what is
 * still theirs: button words that would mislead whoever presses them (these
 * stop a save, so they come first), steps nothing will press, the stock words
 * on a button, and a route with no name.
 */
export function pipTips(steps: RouteStep[], name: string, problems: RouteProblem[]): PipTip[] {
  const tips: PipTip[] = [];

  for (const problem of problems.filter((entry) => entry.level === 'error')) {
    tips.push({
      id: `wrong-${problem.stepId ?? problem.text}`, mood: 'think',
      text: `Hold on - ${problem.text}`,
      fix: problem.stepId ? { label: '✏️ Show me', action: { kind: 'focus', stepId: problem.stepId } } : undefined,
    });
  }

  for (const problem of problems.filter((entry) => entry.level === 'warning')) {
    tips.push({ id: `idle-${problem.stepId ?? problem.text}`, mood: 'happy', text: problem.text });
  }

  const bound = steps.filter((step) => step.trigger);
  const stock = bound.find((step) => !step.button && step.trigger !== 'delivered');
  if (stock) {
    tips.push({
      id: `words-${stock.id}`, mood: 'happy',
      text: `I gave "${stock.name}" its button - it says "${stepButtonLabel(stock)}". Want to try it on a sample order and put it in your own words?`,
      fix: { label: '👀 Open the preview', action: { kind: 'preview' } },
    });
  }

  if (!name.trim()) {
    tips.push({
      id: 'name', mood: 'happy',
      text: 'Give it a name - something like "Guangzhou air" - so you can pick it when you make a lot.',
      fix: { label: '✏️ Name it', action: { kind: 'name' } },
    });
  }

  tips.push({
    id: 'done', mood: 'cheer',
    text: `Looking good! ${steps.length} steps and ${bound.length} buttons, all in order - Dispatched and Delivered always come last. Try it on a sample order before you save.`,
    fix: { label: '👀 Preview it', action: { kind: 'preview' } },
  });
  return tips;
}
