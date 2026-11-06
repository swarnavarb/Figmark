import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import '../styles/AuthTour.css';

/**
 * The slides above the sign-in form: what Figmark does for the person buying
 * and for the person selling, read while they decide whether to sign up.
 *
 * Every line here names something the app really does - held payments, lot
 * stages, manifests, verified reviews - and nothing is a number we cannot
 * stand behind. The slides turn on their own until somebody touches them,
 * swipe on a phone, and stay put for anyone who asked for less motion.
 */

type Tone = 'violet' | 'aqua' | 'coral' | 'lime';

interface Slide {
  id: string;
  audience: string;
  tone: Tone;
  title: string;
  points: string[];
  art: () => JSX.Element;
}

const SLIDES: Slide[] = [
  {
    id: 'welcome',
    audience: 'Welcome to Figmark',
    tone: 'violet',
    title: 'Imports, minus the guesswork',
    points: [
      'Pre-orders and group-buy lots from verified sellers',
      'Your payment held safe under Buyer Protection',
      'Reviews only from orders that really happened',
    ],
    art: GlobeArt,
  },
  {
    id: 'buyers',
    audience: 'For buyers',
    tone: 'aqua',
    title: 'Shop with your money protected',
    points: [
      'Pay through Figmark - the seller is paid once you confirm delivery',
      'Watch your lot move stage by stage, from overseas to your door',
      'Disputes and refunds handled right here, not in a chat thread',
      'Search with a photo, or post a Wanted and let shops come to you',
    ],
    art: ShieldArt,
  },
  {
    id: 'sellers',
    audience: 'For sellers',
    tone: 'coral',
    title: 'Run every lot from one screen',
    points: [
      'A manifest per lot: who ordered what, and who has paid',
      'Take full payment, an advance or a booking - your choice',
      'Move a stage once and every buyer in the lot sees it',
      'Profit calculator and freight forwarders built in',
    ],
    art: ManifestArt,
  },
  {
    id: 'grow',
    audience: 'For sellers',
    tone: 'lime',
    title: 'Grow a shop people trust',
    points: [
      'Two-sided verified reviews build your reputation',
      'Your own storefront, offers, power sales and loyalty cards',
      'Affiliates and share kits bring new buyers in',
      'Insights show who looked, who saved and who nearly bought',
    ],
    art: ShopArt,
  },
];

const TURN_MS = 6000;

function prefersLessMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function AuthTour({ onSkip }: { onSkip: () => void }) {
  const [index, setIndex] = useState(0);
  /** Once somebody steers, the slides stop turning by themselves. */
  const [steered, setSteered] = useState(false);
  const [paused, setPaused] = useState(false);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const count = SLIDES.length;
  const current = SLIDES[index]!;

  const go = useCallback((next: number) => {
    setIndex((next + count) % count);
    setSteered(true);
  }, [count]);

  useEffect(() => {
    if (steered || paused || prefersLessMotion()) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % count), TURN_MS);
    return () => window.clearTimeout(timer);
  }, [index, steered, paused, count]);

  function onPointerDown(event: ReactPointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }
  function onPointerUp(event: ReactPointerEvent) {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // A swipe is mostly sideways; anything else was a scroll or a tap.
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    go(index + (dx < 0 ? 1 : -1));
  }

  return (
    <section className={`authtour authtour--${current.tone}`} aria-roledescription="carousel" aria-label="Why Figmark"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(index + 1);
        else if (event.key === 'ArrowLeft') go(index - 1);
      }}>
      <div className="authtour__glow" aria-hidden="true" />
      <header className="authtour__bar">
        <span className="brand__mark authtour__mark" aria-hidden="true" />
        <span className="authtour__count" aria-live="polite">{index + 1} / {count}</span>
        <span className="authtour__dots" role="tablist" aria-label="Choose one">
          {SLIDES.map((item, at) => (
            <button key={item.id} type="button" role="tab" aria-selected={at === index}
              aria-label={`${item.audience}: ${item.title}`}
              className={`authtour__dot${at === index ? ' is-on' : ''}`} onClick={() => go(at)}>
              {at === index && !steered && !paused && <span className="authtour__fill" style={{ animationDuration: `${TURN_MS}ms` }} />}
            </button>
          ))}
        </span>
        <button type="button" className="authtour__skip" onClick={onSkip}>Skip</button>
      </header>

      <div className="authtour__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; }}>
        <div className="authtour__track" style={{ transform: `translateX(${-100 * index}%)` }}>
          {SLIDES.map((item, at) => (
            <article key={item.id} className={`authtour__slide authtour--${item.tone}`} aria-roledescription="card"
              aria-label={`${at + 1} of ${count}`} aria-hidden={at !== index}>
              <div className="authtour__copy">
                <span className="authtour__who">{item.audience}</span>
                <h2 className="authtour__title">{item.title}</h2>
                <ul className="authtour__points">
                  {item.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </div>
              <div className="authtour__art" aria-hidden="true"><item.art /></div>
            </article>
          ))}
        </div>
      </div>

      <div className="authtour__nav">
        <button type="button" className="authtour__arrow" aria-label="Previous" onClick={() => go(index - 1)}>‹</button>
        <button type="button" className="authtour__arrow" aria-label="Next" onClick={() => go(index + 1)}>›</button>
      </div>
    </section>
  );
}

/* ── Illustrations: drawn here, coloured by the slide's tone. ───────────── */

function GlobeArt() {
  return (
    <svg viewBox="0 0 240 150" className="tourart">
      <circle cx="62" cy="78" r="44" className="tourart__soft" />
      <circle cx="62" cy="78" r="44" className="tourart__line" />
      <ellipse cx="62" cy="78" rx="18" ry="44" className="tourart__line" />
      <path d="M18 78h88M24 56h76M24 100h76" className="tourart__line" />
      <path d="M100 52 C 140 10, 180 20, 196 70" className="tourart__route" />
      <path d="M196 70 l-14 -6 l4 6 l-4 6 z" className="tourart__solid" />
      <rect x="168" y="86" width="52" height="42" rx="6" className="tourart__solid" />
      <path d="M168 100h52M194 86v14" className="tourart__ink" />
      <circle cx="62" cy="78" r="5" className="tourart__solid" />
    </svg>
  );
}

function ShieldArt() {
  return (
    <svg viewBox="0 0 240 150" className="tourart">
      <path d="M72 20 L118 34 V74 C118 104 98 122 72 132 C46 122 26 104 26 74 V34 Z" className="tourart__soft" />
      <path d="M72 20 L118 34 V74 C118 104 98 122 72 132 C46 122 26 104 26 74 V34 Z" className="tourart__line" />
      <path d="M52 76 l14 14 l28 -30" className="tourart__check" />
      <g transform="translate(140 30)">
        {[0, 1, 2, 3].map((step) => (
          <g key={step} transform={`translate(0 ${step * 28})`}>
            <circle cx="10" cy="10" r="8" className={step < 3 ? 'tourart__solid' : 'tourart__line'} />
            {step < 3 && <path d="M10 18v20" className="tourart__line" />}
            <rect x="26" y="5" width={step === 2 ? 64 : 50} height="10" rx="5" className="tourart__soft" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function ManifestArt() {
  return (
    <svg viewBox="0 0 240 150" className="tourart">
      <rect x="22" y="14" width="128" height="124" rx="12" className="tourart__soft" />
      <rect x="22" y="14" width="128" height="124" rx="12" className="tourart__line" />
      <rect x="40" y="28" width="60" height="10" rx="5" className="tourart__solid" />
      {[0, 1, 2, 3].map((row) => (
        <g key={row} transform={`translate(40 ${52 + row * 20})`}>
          <circle cx="6" cy="6" r="6" className="tourart__line" />
          <rect x="18" y="1" width="54" height="10" rx="5" className="tourart__soft" />
          <rect x="80" y="0" width="16" height="12" rx="6" className={row < 3 ? 'tourart__solid' : 'tourart__line'} />
        </g>
      ))}
      <g transform="translate(164 48)">
        <rect width="58" height="58" rx="10" className="tourart__solid" />
        <path d="M0 22h58M29 0v22" className="tourart__ink" />
        <path d="M10 66 h38" className="tourart__route" />
      </g>
    </svg>
  );
}

function ShopArt() {
  return (
    <svg viewBox="0 0 240 150" className="tourart">
      <path d="M30 50 L44 22 H136 L150 50 Z" className="tourart__solid" />
      <path d="M60 22 L56 50M90 22v28M120 22l4 28" className="tourart__ink" />
      <rect x="36" y="50" width="108" height="82" rx="4" className="tourart__soft" />
      <rect x="36" y="50" width="108" height="82" rx="4" className="tourart__line" />
      <rect x="78" y="88" width="26" height="44" rx="3" className="tourart__line" />
      <rect x="48" y="64" width="22" height="18" rx="3" className="tourart__line" />
      <rect x="112" y="64" width="22" height="18" rx="3" className="tourart__line" />
      <g transform="translate(166 30)">
        {[0, 1, 2].map((row) => (
          <path key={row} transform={`translate(${row * 4} ${row * 34})`}
            d="M12 0 l3.6 7.4 8.2 1.2 -5.9 5.8 1.4 8.1 -7.3 -3.8 -7.3 3.8 1.4 -8.1 -5.9 -5.8 8.2 -1.2z"
            className={row === 0 ? 'tourart__solid' : 'tourart__soft'} />
        ))}
        <path d="M34 8h22M38 42h18M42 76h14" className="tourart__line" />
      </g>
    </svg>
  );
}
