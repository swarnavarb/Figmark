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
  /** Each point: the gain in a few words, then how Figmark gets you there. */
  points: Array<[lead: string, detail: string]>;
  art: () => JSX.Element;
}

const SLIDES: Slide[] = [
  {
    id: 'welcome',
    audience: 'Welcome to Figmark',
    tone: 'violet',
    title: 'Import more. Worry less.',
    points: [
      ['Your money is safe', 'with Buyer Protection, the seller is paid only once your order arrives'],
      ['Every seller is accountable', 'reviews come only from orders that really happened'],
      ['No more guessing', 'follow every pre-order from overseas to your doorstep'],
    ],
    art: WelcomeScene,
  },
  {
    id: 'buyers',
    audience: 'For buyers',
    tone: 'aqua',
    title: 'Never get ghosted on a pre-order again',
    points: [
      ['Zero-risk payments', 'Figmark holds your money until the order is in your hands'],
      ['Live tracking', 'see each stage with photos, without chasing anyone for updates'],
      ['Backup when it goes wrong', 'open a dispute or refund in a tap, and Figmark steps in'],
      ['Find it faster', 'search with a photo, or post a Wanted and let sellers come to you'],
    ],
    art: BuyerScene,
  },
  {
    id: 'sellers',
    audience: 'For sellers',
    tone: 'coral',
    title: 'Less chasing. More selling.',
    points: [
      ['Know who paid at a glance', 'one manifest per lot shows who ordered, who paid and who still owes'],
      ['Get paid your way', 'full payment, an advance or a booking, without the spreadsheets'],
      ['Update once, everyone knows', 'move a stage and every buyer in the lot is told'],
      ['Price to win', 'the profit calculator and freight forwarders are built in'],
    ],
    art: SellerScene,
  },
  {
    id: 'grow',
    audience: 'For sellers',
    tone: 'lime',
    title: 'Turn first-time buyers into regulars',
    points: [
      ['Trust that sells for you', 'verified reviews become your strongest sales pitch'],
      ['A shop that is yours', 'storefront, offers, power sales and loyalty cards'],
      ['Reach more buyers', 'affiliates and share kits spread the word for you'],
      ['Close the sale', 'insights show who looked, who saved and who nearly bought'],
    ],
    art: GrowScene,
  },
];

const TURN_MS = 6000;

function prefersLessMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function AuthTour({ onSkip, still = false }: { onSkip: () => void; still?: boolean }) {
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
    if (steered || paused || still || prefersLessMotion()) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % count), TURN_MS);
    return () => window.clearTimeout(timer);
  }, [index, steered, paused, still, count]);

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
              {at === index && !steered && !paused && !still && <span className="authtour__fill" style={{ animationDuration: `${TURN_MS}ms` }} />}
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
                  {item.points.map(([lead, detail]) => <li key={lead}><strong>{lead}</strong> - {detail}</li>)}
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


/* ── Illustrations ────────────────────────────────────────────────────────
 * Small scenes drawn here, in the slide's tone, with people in them. Their
 * moving parts start when the slide comes in (see AuthTour.css), so every
 * visit plays the scene from the top. */

const INK = '#1F1A17';

/** One of the people in the scenes, standing with their feet at (x, y). */
function Person({ x, y, s = 1, skin, hair, shirt, pose = 'stand' }: {
  x: number; y: number; s?: number; skin: string; hair: string; shirt: string; pose?: 'stand' | 'wave' | 'carry';
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-13" y="-46" width="11" height="46" rx="5" className="tourart__legs" />
      <rect x="2" y="-46" width="11" height="46" rx="5" className="tourart__legs" />
      <rect x="-21" y="-94" width="42" height="56" rx="16" className={shirt} />
      {pose === 'carry' ? (
        <>
          <rect x="-26" y="-74" width="52" height="10" rx="5" className={shirt} />
          <circle cx="-24" cy="-69" r="6" fill={skin} />
          <circle cx="24" cy="-69" r="6" fill={skin} />
        </>
      ) : (
        <>
          <rect x="-28" y="-88" width="10" height="40" rx="5" className={shirt} />
          <circle cx="-23" cy="-48" r="6" fill={skin} />
          {pose === 'wave' ? (
            <g transform="rotate(-155 23 -86)">
              <g className="tourart__wave">
                <rect x="18" y="-88" width="10" height="38" rx="5" className={shirt} />
                <circle cx="23" cy="-50" r="6" fill={skin} />
              </g>
            </g>
          ) : (
            <>
              <rect x="18" y="-88" width="10" height="40" rx="5" className={shirt} />
              <circle cx="23" cy="-48" r="6" fill={skin} />
            </>
          )}
        </>
      )}
      <rect x="-5" y="-102" width="10" height="10" fill={skin} />
      <circle cx="0" cy="-112" r="16" fill={skin} />
      <path d="M-17 -112 a17 17 0 0 1 34 0 q-8 -7 -17 -4 q-9 -3 -17 4z" fill={hair} />
      <circle cx="-5.5" cy="-111" r="1.8" fill={INK} />
      <circle cx="5.5" cy="-111" r="1.8" fill={INK} />
      <path d="M-5 -104 q5 4.5 10 0" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
    </g>
  );
}

function Sparkle({ x, y, r = 5, delay = 0 }: { x: number; y: number; r?: number; delay?: number }) {
  return (
    <path className="tourart__twinkle" style={{ animationDelay: `${delay}ms` }}
      d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} />
  );
}

/** A parcel flies from the world to a buyer, who is holding the last one. */
function WelcomeScene() {
  const route = 'M126 66 C 168 6, 226 4, 252 70';
  return (
    <svg viewBox="0 0 320 200" className="tourart">
      <defs>
        <clipPath id="tourart-globe"><circle cx="0" cy="0" r="50" /></clipPath>
      </defs>
      <ellipse cx="160" cy="192" rx="150" ry="8" className="tourart__soft" />
      <g transform="translate(76 104)">
        <circle r="50" className="tourart__soft" />
        <g clipPath="url(#tourart-globe)">
          <g className="tourart__spin">
            {[0, 100].map((dx) => (
              <g key={dx} transform={`translate(${dx} 0)`} className="tourart__land">
                <path d="M-44 -24 q12 -16 30 -10 q8 10 -2 18 q-14 4 -12 16 q-10 8 -18 -4z" />
                <path d="M2 -36 q18 -6 30 6 q-4 14 -18 12 q-10 -8 -12 -18z" />
                <path d="M-6 6 q16 -4 26 8 q2 18 -14 26 q-14 -12 -12 -34z" />
              </g>
            ))}
          </g>
        </g>
        <circle r="50" className="tourart__line" />
        <ellipse rx="20" ry="50" className="tourart__line tourart__meridian" />
        <path d="M-50 0h100M-44 -24h88M-44 24h88" className="tourart__line" />
      </g>
      <path d={route} className="tourart__route" />
      <g className="tourart__fly" style={{ offsetPath: `path('${route}')` }}>
        <rect x="-9" y="-8" width="18" height="16" rx="3" className="tourart__box" />
        <path d="M-9 -1h18" className="tourart__tape" />
      </g>
      <Person x={262} y={190} skin="#E0AC69" hair={INK} shirt="tourart__shirt--blue" pose="carry" />
      <g className="tourart__bob">
        <rect x="240" y="88" width="44" height="34" rx="4" className="tourart__box" />
        <path d="M240 100h44M262 88v12" className="tourart__tape" />
      </g>
      <Sparkle x={150} y={150} delay={0} />
      <Sparkle x={210} y={128} r={4} delay={500} />
      <Sparkle x={300} y={40} r={6} delay={900} />
    </svg>
  );
}

/** A buyer waves beside their phone, tracking the order, money under a shield. */
function BuyerScene() {
  return (
    <svg viewBox="0 0 320 200" className="tourart">
      <ellipse cx="160" cy="192" rx="150" ry="8" className="tourart__soft" />
      <Person x={66} y={190} skin="#C68642" hair={INK} shirt="tourart__shirt--pink" pose="wave" />
      <g transform="translate(128 10)">
        <rect width="118" height="178" rx="18" className="tourart__device" />
        <rect x="44" y="8" width="30" height="6" rx="3" className="tourart__soft" />
        <rect x="16" y="24" width="58" height="9" rx="4.5" className="tourart__solid" />
        {[0, 1, 2, 3].map((step) => {
          const y = 52 + step * 30;
          return (
            <g key={step}>
              {step < 3 && (
                <>
                  <rect x="22" y={y + 8} width="4" height="22" rx="2" className="tourart__soft" />
                  <rect x="22" y={y + 8} width="4" height="22" rx="2" className="tourart__solid tourart__trackfill"
                    style={{ animationDelay: `${300 + step * 450}ms` }} />
                </>
              )}
              <circle cx="24" cy={y} r="8" className="tourart__solid tourart__step" style={{ animationDelay: `${step * 450}ms` }} />
              <rect x="40" y={y - 5} width={62 - step * 8} height="10" rx="5" className="tourart__soft" />
            </g>
          );
        })}
        <rect x="16" y="152" width="86" height="16" rx="8" className="tourart__solid" />
      </g>
      <g transform="translate(270 56)">
        <circle r="26" className="tourart__ring" />
        <path d="M0 -30 L26 -21 V2 C26 20 14 30 0 36 C-14 30 -26 20 -26 2 V-21 Z" className="tourart__solid tourart__pop" />
        <text y="10" textAnchor="middle" fontSize="28" fontWeight="800" className="tourart__glyph">₹</text>
      </g>
      <Sparkle x={300} y={120} delay={300} />
      <Sparkle x={112} y={40} r={4} delay={800} />
    </svg>
  );
}

/** A seller beside the lot's boxes, its manifest ticking itself off. */
function SellerScene() {
  return (
    <svg viewBox="0 0 320 200" className="tourart">
      <ellipse cx="160" cy="192" rx="150" ry="8" className="tourart__soft" />
      <g>
        <rect x="14" y="142" width="54" height="48" rx="4" className="tourart__box" />
        <path d="M14 156h54M41 142v14" className="tourart__tape" />
        <rect x="20" y="100" width="44" height="42" rx="4" className="tourart__box" />
        <path d="M20 112h44M42 100v12" className="tourart__tape" />
        <g className="tourart__drop">
          <rect x="25" y="64" width="36" height="36" rx="4" className="tourart__box" />
          <path d="M25 75h36M43 64v11" className="tourart__tape" />
        </g>
      </g>
      <Person x={116} y={190} skin="#8D5524" hair="#3B2A20" shirt="tourart__solid" />
      <g transform="translate(170 18)">
        <rect width="128" height="170" rx="12" className="tourart__device" />
        <rect x="44" y="-6" width="40" height="14" rx="5" className="tourart__solid" />
        <rect x="16" y="22" width="62" height="9" rx="4.5" className="tourart__solid" />
        {[0, 1, 2, 3].map((row) => {
          const y = 52 + row * 30;
          const delay = 250 + row * 380;
          return (
            <g key={row}>
              <circle cx="24" cy={y} r="8" className="tourart__line" />
              {row < 3 && <path d={`M19.5 ${y} l3.5 3.8 l6 -7.2`} className="tourart__tick" style={{ animationDelay: `${delay}ms` }} />}
              <rect x="40" y={y - 5} width="44" height="10" rx="5" className="tourart__soft" />
              <rect x="92" y={y - 7} width="24" height="14" rx="7"
                className={row < 3 ? 'tourart__solid tourart__pop' : 'tourart__line'} style={{ animationDelay: `${delay + 150}ms` }} />
            </g>
          );
        })}
      </g>
      <g className="tourart__ping">
        <circle cx="290" cy="18" r="14" className="tourart__solid" />
        <path d="M284 22h12M286 22v-6a4 4 0 0 1 8 0v6M289 25h2" className="tourart__ink" />
      </g>
    </svg>
  );
}

/** Shoppers walking up to a shop, its stars filling and its numbers rising. */
function GrowScene() {
  return (
    <svg viewBox="0 0 320 200" className="tourart">
      <ellipse cx="160" cy="192" rx="150" ry="8" className="tourart__soft" />
      <g transform="translate(40 50)">
        <rect x="4" y="30" width="136" height="110" rx="4" className="tourart__soft" />
        <rect x="4" y="30" width="136" height="110" rx="4" className="tourart__line" />
        <rect x="-6" y="0" width="156" height="32" rx="6" className="tourart__solid" />
        {[0, 1, 2, 3].map((stripe) => (
          <rect key={stripe} x={12 + stripe * 36} y="0" width="18" height="32" className="tourart__stripe" />
        ))}
        <rect x="56" y="74" width="32" height="66" rx="3" className="tourart__line" />
        <circle cx="81" cy="108" r="2.5" className="tourart__solid" />
        <rect x="16" y="50" width="30" height="26" rx="3" className="tourart__line" />
        <rect x="98" y="50" width="30" height="26" rx="3" className="tourart__line" />
        <g transform="translate(26 -24)">
          {[0, 1, 2, 3, 4].map((star) => (
            <path key={star} transform={`translate(${star * 20} 0)`} className="tourart__solid tourart__pop"
              style={{ animationDelay: `${200 + star * 160}ms` }}
              d="M8 0 l2.4 5 5.5 .8 -4 3.9 .9 5.4 -4.8 -2.6 -4.8 2.6 .9 -5.4 -4 -3.9 5.5 -.8z" />
          ))}
        </g>
      </g>
      <g className="tourart__walk">
        <Person x={228} y={190} s={0.62} skin="#F1C27D" hair="#3B2A20" shirt="tourart__shirt--blue" pose="wave" />
        <Person x={266} y={190} s={0.56} skin="#C68642" hair={INK} shirt="tourart__shirt--gold" />
      </g>
      <g transform="translate(236 16)">
        {[18, 30, 46].map((height, bar) => (
          <rect key={bar} x={bar * 18} y={56 - height} width="12" height={height} rx="3" className="tourart__solid tourart__bar"
            style={{ animationDelay: `${300 + bar * 200}ms` }} />
        ))}
        <path d="M-4 40 L18 24 L30 30 L56 4 M46 4h10v10" className="tourart__line" />
      </g>
      <path className="tourart__heart" d="M214 96 c-4 -6 -12 -2 -8 5 l8 8 l8 -8 c4 -7 -4 -11 -8 -5z" />
    </svg>
  );
}
