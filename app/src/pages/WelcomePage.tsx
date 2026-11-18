import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { suggestUsername } from '@shared/handles';
import { Icon, type IconName } from '../components/ui';
import { useSession } from '../session';
import { haptic } from '../haptics';
import { ApiRequestError, api } from '../api';
import { readQrFrame, readQrPicture } from '../qr-reader';
import { hasOnboarded, markOnboarded, readWelcomeDraft, saveWelcomeDraft } from '../onboarding';
import '../styles/Welcome.css';

/**
 * The first-run welcome: what Figmark is, then sign-up in four short steps.
 *
 * Slides first - the gist, then buyers, sellers, freight forwarders, artists
 * and what makes Figmark different - each with Back and Next, ending on Sign in.
 * Then Google (name and email), WhatsApp, Aadhaar (the two that earn the blue
 * tick) and a profile whose name, date of birth and gender come from Aadhaar.
 *
 * Seen once, the slides are skipped: coming back opens straight on sign-in.
 *
 * DESIGN PREVIEW SEAMS - what still needs a backend:
 *  - Google: with VITE_GOOGLE_CLIENT_ID set this uses Google Identity Services
 *    and reads name and email from the ID token; the token still has to be
 *    verified server-side. Without it, the person confirms name and email here.
 *  - The WhatsApp code is simulated: any six digits pass.
 *  - Aadhaar is real: the Secure QR is scanned or uploaded and checked by
 *    POST /api/verify/aadhaar/signup (UIDAI signature, linked mobile = the
 *    WhatsApp number), which answers with name, date of birth and gender and
 *    saves nothing. Creating the account must send the QR again so the server
 *    re-checks it; nothing the browser holds is trusted.
 *  - "Create account" keeps the profile on this device and does not call the
 *    API yet: there is no password-free sign-up endpoint.
 */

type Step = 'slides' | 'google' | 'whatsapp' | 'aadhaar' | 'profile' | 'done';
const FORM_STEPS: Step[] = ['google', 'whatsapp', 'aadhaar', 'profile'];

interface AadhaarDetails { name: string; dob: string; gender: string; last4: string }
interface Profile {
  username: string;
  roles: string[];
  city: string;
  pin: string;
  interests: string[];
  language: string;
  referral: string;
  whatsappUpdates: boolean;
}
interface Draft {
  step: Step;
  name: string;
  email: string;
  phone: string;
  phoneVerified: boolean;
  aadhaar: AadhaarDetails | null;
  profile: Profile | null;
}

const EMPTY: Draft = { step: 'slides', name: '', email: '', phone: '', phoneVerified: false, aadhaar: null, profile: null };

export function WelcomePage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = readWelcomeDraft<Draft>();
    if (saved && saved.step !== 'slides') return { ...EMPTY, ...saved };
    return { ...EMPTY, step: hasOnboarded() ? 'google' : 'slides' };
  });
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

  useEffect(() => {
    saveWelcomeDraft(draft.step === 'slides' ? null : draft);
    window.scrollTo(0, 0);
  }, [draft]);

  if (user) return <Navigate to="/" replace />;

  const goSignIn = () => {
    markOnboarded();
    patch({ step: 'google' });
  };
  const back = () => {
    const at = FORM_STEPS.indexOf(draft.step);
    if (at > 0) patch({ step: FORM_STEPS[at - 1]! });
    else if (at === 0) patch({ step: 'slides' });
  };

  return (
    <div className="wel">
      <div className="wel__aura" aria-hidden="true" />
      <div className="wel__frame">
        {draft.step === 'slides' && <Slides onSignIn={goSignIn} />}
        {draft.step === 'google' && (
          <StepShell step="google" onBack={back} backLabel="See the tour">
            <GoogleStep initial={draft} onDone={(name, email) => patch({ name, email, step: 'whatsapp' })} />
          </StepShell>
        )}
        {draft.step === 'whatsapp' && (
          <StepShell step="whatsapp" onBack={back}>
            <WhatsAppStep initial={draft.phone} verified={draft.phoneVerified}
              onDone={(phone) => patch({ phone, phoneVerified: true, step: 'aadhaar' })} />
          </StepShell>
        )}
        {draft.step === 'aadhaar' && (
          <StepShell step="aadhaar" onBack={back}>
            <AadhaarStep draft={draft}
              onDone={(aadhaar) => patch({ aadhaar, step: 'profile' })}
              onLater={() => patch({ aadhaar: null, step: 'profile' })} />
          </StepShell>
        )}
        {draft.step === 'profile' && (
          <StepShell step="profile" onBack={back}>
            <ProfileStep draft={draft} onDone={(profile, name) => patch({ profile, name, step: 'done' })} />
          </StepShell>
        )}
        {draft.step === 'done' && (
          <DoneStep draft={draft} onExplore={() => {
            markOnboarded();
            saveWelcomeDraft(null);
            navigate('/', { replace: true });
          }} />
        )}
      </div>
    </div>
  );
}

/* ── The slides ──────────────────────────────────────────────────────────── */

type Tone = 'violet' | 'aqua' | 'coral' | 'blue' | 'pink' | 'gold' | 'lime' | 'orange';

interface Slide {
  id: string;
  tone: Tone;
  kicker: string;
  title: string;
  /** The words in the title drawn in the slide's colour. */
  hl: string;
  lede: string;
  /** Up to four benefits: icon, the gain in a few words, how. */
  points?: Array<[IconName, string, string]>;
  art: () => JSX.Element;
}

const SLIDES: Slide[] = [
  {
    id: 'gist',
    tone: 'violet',
    kicker: 'Welcome to Figmark',
    title: 'The safest way to buy, sell and collect.',
    hl: 'safest way',
    lede: 'Imports, group-buys, drops and original art, with your money held safe until it arrives and real, verified people behind every shop.',
    art: GistArt,
  },
  {
    id: 'buyers',
    tone: 'aqua',
    kicker: 'For buyers',
    title: 'Pre-order from anywhere. Never get ghosted.',
    hl: 'Never get ghosted.',
    lede: 'Figmark holds your money until the order is in your hands.',
    points: [
      ['lock', 'Buyer Protection', 'sellers are paid after delivery'],
      ['truck', 'Live tracking', 'every stage, with photos'],
      ['star', 'Honest reviews', 'only from real orders'],
      ['camera', 'Photo search', 'snap it, find who sells it'],
    ],
    art: BuyerArt,
  },
  {
    id: 'sellers',
    tone: 'coral',
    kicker: 'For sellers',
    title: 'Run group-buys without the spreadsheets.',
    hl: 'without the spreadsheets.',
    lede: 'Lots, manifests and payments in one place, and buyers who trust you from day one.',
    points: [
      ['box', 'Lots & manifests', 'who paid, who still owes'],
      ['bank', 'Paid your way', 'full, advance or booking'],
      ['bell', 'Update once', 'every buyer is told'],
      ['rising', 'Grow', 'offers, loyalty, insights'],
    ],
    art: SellerArt,
  },
  {
    id: 'forwarders',
    tone: 'blue',
    kicker: 'For freight forwarders',
    title: 'Fill every consignment with ready lots.',
    hl: 'ready lots.',
    lede: 'Sellers book space on your routes directly, with no chasing in group chats.',
    points: [
      ['plane', 'Bookings come in', 'on the routes you run'],
      ['tag', 'Rates, visible', 'quotes in a tap'],
      ['truck', 'One update', 'reaches every buyer'],
      ['star', 'Reputation', 'reviews from every seller'],
    ],
    art: ForwarderArt,
  },
  {
    id: 'artists',
    tone: 'pink',
    kicker: 'For artists & creators',
    title: 'Your art, sold to collectors who care.',
    hl: 'collectors who care.',
    lede: 'A home for original work, where collectors pay with confidence and you get paid on time.',
    points: [
      ['image', 'Portfolio shop', 'prints and originals'],
      ['spark', 'Limited editions', 'pre-sell the print run'],
      ['message', 'Commissions', 'advance held till delivery'],
      ['users', 'Your fans', 'followers and channels'],
    ],
    art: ArtistArt,
  },
  {
    id: 'discover',
    tone: 'lime',
    kicker: 'Discover',
    title: "Find things you didn't know you wanted.",
    hl: "didn't know you wanted.",
    lede: 'Finds, shelves and conversations, ranked for you.',
    points: [
      ['spark', 'Five lenses', 'For you, Live, Shelves…'],
      ['eye', 'Seen it? Buy it', 'tap a photo in any post'],
      ['camera', 'Photo search', 'snap, match, buy'],
      ['trophy', "Week's best", 'the top of the week'],
    ],
    art: DiscoverArt,
  },
  {
    id: 'social',
    tone: 'violet',
    kicker: 'Social',
    title: 'Your hobby, with your people.',
    hl: 'your people.',
    lede: 'Follow collectors and shops, talk about what you love, and buy from people you know.',
    points: [
      ['home', 'Your feed', 'people and shops you follow'],
      ['megaphone', 'Shop channels', 'member-only prices'],
      ['forum', 'Forums', 'debates worth joining'],
      ['target', 'Wanted board', 'sellers reply "I can get this"'],
    ],
    art: SocialArt,
  },
  {
    id: 'drops',
    tone: 'orange',
    kicker: 'Drops & sales',
    title: 'Drops worth setting an alarm for.',
    hl: 'setting an alarm for.',
    lede: 'Shops run sales on Figmark, and the people who show up get the best price.',
    points: [
      ['bolt', 'Power sales', 'channel price, item by item'],
      ['box', 'Pre-order drops', 'join a lot before it fills'],
      ['tag', 'Offers & loyalty', 'rewards for coming back'],
      ['bell', 'Drop alerts', 'on your phone, on time'],
    ],
    art: DropsArt,
  },
  {
    id: 'play',
    tone: 'gold',
    kicker: 'Collect & play',
    title: 'Show off your collection. Level up.',
    hl: 'Level up.',
    lede: 'Every buy, review and share counts.',
    points: [
      ['star', 'Real showcase', 'built from delivered orders'],
      ['trophy', 'Quests & streaks', 'XP, levels, stickers'],
      ['rising', 'Leaderboards', 'one for every hobby'],
      ['users', 'Invite friends', 'your link counts them'],
    ],
    art: PlayArt,
  },
  {
    id: 'unique',
    tone: 'aqua',
    kicker: 'Why Figmark is different',
    title: 'Trust, built into every order.',
    hl: 'every order.',
    lede: 'Other marketplaces list things. Figmark makes sure both sides can rely on each other.',
    points: [
      ['check', 'Blue tick people', 'WhatsApp + Aadhaar verified'],
      ['lock', 'Money held', 'released on delivery'],
      ['star', 'Real reviews', 'from completed orders only'],
      ['users', 'All in one app', 'shopping and community'],
    ],
    art: TrustArt,
  },
  {
    id: 'ready',
    tone: 'violet',
    kicker: 'Free to join',
    title: 'Get your blue tick in minutes.',
    hl: 'blue tick',
    lede: 'Four quick steps, and your verified profile is live.',
    art: ReadyArt,
  },
];

function Title({ text, hl }: { text: string; hl: string }) {
  const at = text.indexOf(hl);
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<em className="welslide__hl">{hl}</em>{text.slice(at + hl.length)}</>;
}

function Slides({ onSignIn }: { onSignIn: () => void }) {
  const [index, setIndex] = useState(0);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const count = SLIDES.length;
  const last = index === count - 1;
  const slide = SLIDES[index]!;

  const go = (next: number) => {
    if (next < 0 || next >= count) return;
    haptic('tap');
    setIndex(next);
  };

  function onPointerDown(event: ReactPointerEvent) {
    if (event.pointerType === 'mouse') return;
    drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }
  function onPointerUp(event: ReactPointerEvent) {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(event.clientY - start.y) * 1.2) return;
    go(index + (dx < 0 ? 1 : -1));
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') go(index + 1);
    if (event.key === 'ArrowLeft') go(index - 1);
  }

  return (
    <section className={`welslides wel--${slide.tone}`} aria-roledescription="carousel" aria-label="What Figmark is" onKeyDown={onKey}>
      <div className="welslides__blobs" aria-hidden="true"><span /><span /></div>

      <div className="welslides__progress" aria-label={`Slide ${index + 1} of ${count}`}>
        {SLIDES.map((item, at) => (
          <button key={item.id} type="button" className={`welslides__seg${at < index ? ' is-done' : at === index ? ' is-on' : ''}`}
            aria-label={`Go to ${item.kicker}`} aria-current={at === index} onClick={() => go(at)} />
        ))}
      </div>
      <header className="welslides__bar">
        <span className="welslides__brand"><span className="brand__mark welslides__mark" aria-hidden="true" />Figmark</span>
        {!last && index > 0 && <button type="button" className="welslides__join" onClick={onSignIn}>Join free</button>}
        {index === 0 && <button type="button" className="welslides__skip" onClick={onSignIn}>Log in</button>}
      </header>

      <div className="welslides__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; }}>
        <div className="welslides__track" style={{ transform: `translateX(${-100 * index}%)` }}>
          {SLIDES.map((item, at) => (
            <article key={item.id} className={`welslide wel--${item.tone}${at === index ? ' is-on' : ''}`}
              aria-roledescription="slide" aria-label={`${at + 1} of ${count}`} aria-hidden={at !== index}>
              <div className="welslide__art" aria-hidden="true">{at === index && <item.art />}</div>
              <div className="welslide__copy">
                <span className="welslide__kicker">{item.kicker}</span>
                <h1 className="welslide__title"><Title text={item.title} hl={item.hl} /></h1>
                <p className="welslide__lede">{item.lede}</p>
                {item.points && (
                  <ul className="welslide__grid">
                    {item.points.map(([icon, lead, detail]) => (
                      <li key={lead}>
                        <span className="welslide__gicon"><Icon name={icon} size={15} /></span>
                        <strong>{lead}</strong>
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {item.id === 'gist' && <GistTiles />}
                {item.id === 'ready' && <ReadySteps />}
              </div>
            </article>
          ))}
        </div>
      </div>

      <footer className="welslides__foot">
        {index === 0 ? (
          <>
            <button type="button" className="welbtn welbtn--primary welbtn--wide welbtn--big" onClick={() => go(1)}>
              Get started <span className="welbtn__sub">it's free</span> <Icon name="right" size={16} />
            </button>
            <button type="button" className="welbtn welbtn--quiet" onClick={onSignIn}>I already have an account</button>
          </>
        ) : (
          <div className="welslides__nav">
            <button type="button" className="welround" onClick={() => go(index - 1)} aria-label="Previous">
              <Icon name="left" size={18} />
            </button>
            {last ? (
              <button type="button" className="welbtn welbtn--primary welbtn--big welbtn--glow" onClick={onSignIn}>
                Sign in &amp; join free <Icon name="right" size={16} />
              </button>
            ) : (
              <button type="button" className="welbtn welbtn--primary welbtn--big" onClick={() => go(index + 1)}>
                Next <Icon name="right" size={16} />
              </button>
            )}
          </div>
        )}
      </footer>
    </section>
  );
}

function GistTiles() {
  const tiles: Array<[IconName, string, Tone]> = [
    ['heart', 'Buy', 'aqua'],
    ['box', 'Sell', 'coral'],
    ['plane', 'Ship', 'blue'],
    ['image', 'Create', 'pink'],
    ['users', 'Connect', 'lime'],
  ];
  return (
    <ul className="welgist">
      {tiles.map(([icon, title, tone]) => (
        <li key={title} className={`welgist__tile wel--${tone}`}>
          <Icon name={icon} size={15} />
          {title}
        </li>
      ))}
    </ul>
  );
}

function ReadySteps() {
  const steps: Array<[string, string]> = [
    ['Sign in with Google', 'name and email, no password'],
    ['Verify WhatsApp', 'order updates on your phone'],
    ['Verify Aadhaar', 'unlocks your blue tick'],
    ['Your profile', 'so Figmark fits you'],
  ];
  return (
    <ol className="welready">
      {steps.map(([title, sub], at) => (
        <li key={title} style={{ animationDelay: `${200 + at * 90}ms` }}>
          <span className="welready__n">{at + 1}</span>
          <span><strong>{title}</strong><span>{sub}</span></span>
          {at === 2 && <BlueTick size={18} />}
        </li>
      ))}
    </ol>
  );
}

/* ── The sign-up steps ───────────────────────────────────────────────────── */

const STEP_TITLES: Record<string, string> = { google: 'Sign in', whatsapp: 'WhatsApp', aadhaar: 'Aadhaar', profile: 'Profile' };

function StepShell({ step, onBack, backLabel = 'Back', children }: { step: Step; onBack: () => void; backLabel?: string; children: ReactNode }) {
  const at = FORM_STEPS.indexOf(step);
  return (
    <section className="welstep">
      <header className="welstep__bar">
        <button type="button" className="welbtn welbtn--ghost welbtn--sm" onClick={onBack}>
          <Icon name="left" size={16} /> {backLabel}
        </button>
        <span className="welstep__count">Step {at + 1} of {FORM_STEPS.length}</span>
      </header>
      <ol className="welstep__progress" aria-label="Sign-up progress">
        {FORM_STEPS.map((name, i) => (
          <li key={name} className={i < at ? 'is-done' : i === at ? 'is-on' : ''}>
            <span className="welstep__track" />
            <span className="welstep__label">{STEP_TITLES[name]}</span>
          </li>
        ))}
      </ol>
      <div className="welstep__body" key={step}>{children}</div>
    </section>
  );
}

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

interface GoogleIdentity {
  accounts: { id: {
    initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
    renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  } };
}

/** Name and email from a Google ID token. Read here for the form; the server must verify it. */
function readGoogleToken(credential: string): { name: string; email: string } | null {
  try {
    const payload = credential.split('.')[1] ?? '';
    const json = JSON.parse(decodeURIComponent(escape(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))));
    return { name: String(json.name ?? ''), email: String(json.email ?? '') };
  } catch {
    return null;
  }
}

function GoogleStep({ initial, onDone }: { initial: Draft; onDone: (name: string, email: string) => void }) {
  const [confirming, setConfirming] = useState(!!initial.email);
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [error, setError] = useState<string | null>(null);
  const gsiSlot = useRef<HTMLDivElement>(null);

  // A real Google button when a client ID is configured.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || confirming) return;
    const ready = () => {
      const google = (window as unknown as { google?: GoogleIdentity }).google;
      if (!google || !gsiSlot.current) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: ({ credential }) => {
          const who = readGoogleToken(credential);
          if (!who) return setError('Google did not send your details. Please try again.');
          setName(who.name);
          setEmail(who.email);
          setConfirming(true);
        },
      });
      google.accounts.id.renderButton(gsiSlot.current, { theme: 'filled_black', size: 'large', shape: 'pill', width: 320, text: 'continue_with' });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-gsi]');
    if (existing) return ready();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.dataset.gsi = '1';
    script.onload = ready;
    document.head.appendChild(script);
  }, [confirming]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError('Enter your name as on your Google account.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    haptic('success');
    onDone(name.trim(), email.trim().toLowerCase());
  }

  return (
    <>
      <div className="welhead">
        <span className="welhead__icon wel--violet"><span className="brand__mark welhead__mark" aria-hidden="true" /></span>
        <h1>Sign in to Figmark</h1>
        <p>New or returning - one tap with Google. We only use your name and email.</p>
      </div>

      {!confirming ? (
        <div className="welgoogle">
          {GOOGLE_CLIENT_ID ? <div ref={gsiSlot} className="welgoogle__gsi" /> : (
            <button type="button" className="welgoogle__btn" onClick={() => setConfirming(true)}>
              <GoogleG /> Continue with Google
            </button>
          )}
          <p className="welfine">
            By continuing you agree to Figmark's <a href="/legal/terms">Terms</a> and <a href="/legal/privacy">Privacy Policy</a>.
          </p>
          <ul className="welperks">
            <li><Icon name="lock" size={14} /> No password to remember</li>
            <li><Icon name="check" size={14} /> Your Google account stays private - we never post</li>
          </ul>
        </div>
      ) : (
        <form className="welform" onSubmit={submit} noValidate>
          <div className="welgoogle__who">
            <GoogleG />
            <span>Details from your Google account</span>
            <button type="button" className="welbtn welbtn--link" onClick={() => { setConfirming(false); setEmail(''); setName(''); }}>Switch</button>
          </div>
          <Field label="Full name">
            <input className="welinput" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </Field>
          <Field label="Email">
            <input className="welinput" type="email" autoComplete="email" inputMode="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" />
          </Field>
          {error && <p className="welerror" role="alert">{error}</p>}
          <button type="submit" className="welbtn welbtn--primary welbtn--wide">Continue <Icon name="right" size={16} /></button>
        </form>
      )}
    </>
  );
}

function WhatsAppStep({ initial, verified, onDone }: { initial: string; verified: boolean; onDone: (phone: string) => void }) {
  const [phone, setPhone] = useState(initial);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wait = useCountdown(sent);
  const valid = /^[6-9]\d{9}$/.test(phone);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!valid) return setError('Enter the 10-digit mobile number you use on WhatsApp.');
    setError(null);
    setBusy(true);
    await pause(700); // Simulated: sends the code on WhatsApp.
    setBusy(false);
    setSent(true);
    wait.restart();
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 6) return setError('Enter the 6-digit code from WhatsApp.');
    setError(null);
    setBusy(true);
    await pause(800); // Simulated: any six digits pass.
    setBusy(false);
    haptic('success');
    onDone(phone);
  }

  return (
    <>
      <div className="welhead">
        <span className="welhead__icon wel--whatsapp"><WhatsAppGlyph /></span>
        <h1>Verify your WhatsApp</h1>
        <p>Order updates, tracking and messages from sellers arrive on WhatsApp. This is half of your blue tick.</p>
      </div>
      <TickMeter phone={verified} aadhaar={false} />

      {!sent ? (
        <form className="welform" onSubmit={send} noValidate>
          <Field label="WhatsApp number">
            <div className="welphone">
              <span className="welphone__cc">🇮🇳 +91</span>
              <input className="welinput welphone__input" inputMode="numeric" autoComplete="tel-national" maxLength={10}
                value={phone} placeholder="98765 43210" onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            </div>
          </Field>
          {error && <p className="welerror" role="alert">{error}</p>}
          <button type="submit" className="welbtn welbtn--primary welbtn--wide" disabled={busy}>
            {busy ? 'Sending…' : 'Send code on WhatsApp'}
          </button>
          <p className="welfine">Use the number linked to your Aadhaar - the two must match for the blue tick.</p>
        </form>
      ) : (
        <form className="welform" onSubmit={verify} noValidate>
          <p className="welsent">Code sent to <strong>+91 {phone.slice(0, 5)} {phone.slice(5)}</strong>{' '}
            <button type="button" className="welbtn welbtn--link" onClick={() => { setSent(false); setCode(''); }}>Change</button>
          </p>
          <OtpInput value={code} onChange={setCode} label="WhatsApp code" />
          {error && <p className="welerror" role="alert">{error}</p>}
          <button type="submit" className="welbtn welbtn--primary welbtn--wide" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
          <p className="welfine">
            {wait.left > 0 ? <>Resend in 0:{String(wait.left).padStart(2, '0')}</> : (
              <button type="button" className="welbtn welbtn--link" onClick={() => void send()}>Resend code</button>
            )}
          </p>
        </form>
      )}
    </>
  );
}

/** UIDAI writes the date of birth as DD-MM-YYYY (or a year alone); the profile wants YYYY-MM-DD. */
function isoDob(raw: string): string {
  const day = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(raw.trim());
  if (day) return `${day[3]}-${day[2]}-${day[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : '';
}

const GENDERS: Record<string, string> = { M: 'Male', F: 'Female', T: 'Transgender' };

/**
 * Aadhaar by its Secure QR, the same way /verify does it: scan the QR on the
 * Aadhaar letter, e-Aadhaar or mAadhaar (or upload a picture of it), and the
 * server checks UIDAI's signature and that the mobile linked to it is the
 * WhatsApp number just verified. No OTP and no Aadhaar number typed in.
 */
function AadhaarStep({ draft, onDone, onLater }: { draft: Draft; onDone: (details: AadhaarDetails) => void; onLater: () => void }) {
  const [consent, setConsent] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<AadhaarDetails | null>(draft.aadhaar);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const masked = `+91 ${draft.phone.slice(0, 2)}xxxxxx${draft.phone.slice(-2)}`;

  async function check(qr: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.checkAadhaarForSignup(qr, draft.phone);
      haptic('success');
      setFound({ name: result.name, dob: isoDob(result.dob) || result.dob, gender: GENDERS[result.gender] ?? result.gender, last4: result.last4 });
    } catch (err) {
      haptic('error');
      setError(err instanceof ApiRequestError ? err.message : 'The check did not go through. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  // The camera, read a few times a second until a QR turns up.
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } } });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        let attempt = 0;
        while (!stopped) {
          if (video.videoWidth > 0) {
            const text = await readQrFrame(video, attempt);
            attempt += 1;
            if (text) {
              setScanning(false);
              void check(text);
              return;
            }
          }
          await pause(350);
        }
      } catch {
        setError('Could not open the camera. Upload a photo or screenshot of the QR instead.');
        setScanning(false);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scanning]);

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const text = await readQrPicture(file);
      if (text) await check(text);
      else setError('No QR code found in that picture. Crop it to the QR and make sure it is sharp, then try again.');
    } catch {
      setError('That file could not be read as a picture.');
    } finally {
      setBusy(false);
    }
  }

  if (found) {
    return (
      <>
        <div className="welearned">
          <div className="welearned__burst" aria-hidden="true" />
          <span className="welearned__tick"><BlueTick size={56} /></span>
          <h1>You're verified!</h1>
          <p>Your blue tick now shows on your profile, shop and every review you leave. People trust it - and buy from it.</p>
        </div>
        <div className="welcard">
          <span className="welcard__title">From your Aadhaar <span className="welchip">xxxx xxxx {found.last4}</span></span>
          <dl className="welcard__rows">
            <div><dt>Name</dt><dd>{found.name}</dd></div>
            <div><dt>Date of birth</dt><dd>{formatDob(found.dob)}</dd></div>
            <div><dt>Gender</dt><dd>{found.gender}</dd></div>
          </dl>
          <p className="welfine">Signed by UIDAI and matched to your WhatsApp number. We keep only these and the last 4 digits - never the full number, your address or your photo.</p>
        </div>
        <button type="button" className="welbtn welbtn--primary welbtn--wide" onClick={() => onDone(found)}>
          Continue to your profile <Icon name="right" size={16} />
        </button>
      </>
    );
  }

  return (
    <>
      <div className="welhead">
        <span className="welhead__icon wel--blue"><BlueTick size={28} /></span>
        <h1>Get your blue tick</h1>
        <p>Scan the QR on your Aadhaar. Verified people get more orders, and their buyers worry less.</p>
      </div>
      <TickMeter phone aadhaar={false} />

      <div className="welform">
        <div className="welqrwhere">
          <span className="welqrwhere__code" aria-hidden="true"><QrGlyph /></span>
          <span>
            <strong>Use the large QR code</strong> on your Aadhaar letter, your e-Aadhaar PDF (from myaadhaar.uidai.gov.in)
            or the mAadhaar app. It's signed by UIDAI and checked on our server, so there's no OTP and no card upload.
          </span>
        </div>
        <div className="welnote">
          <Icon name="phone" size={16} />
          <span>The mobile linked to your Aadhaar must be your WhatsApp number, <strong>{masked}</strong>.</span>
        </div>
        <label className="welcheck">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I agree to Figmark reading my Aadhaar Secure QR to verify who I am. Figmark keeps only my name, date of birth,
            gender and the last 4 digits of my Aadhaar - never the full number, my address or my photo.</span>
        </label>

        {scanning ? (
          <div className="welcam">
            <video ref={videoRef} playsInline muted />
            <span className="welcam__frame" aria-hidden="true" />
            <span className="welcam__hint">Hold the QR inside the frame</span>
            <button type="button" className="welbtn welbtn--ghost welbtn--sm welcam__stop" onClick={() => setScanning(false)}>Stop</button>
          </div>
        ) : busy ? (
          <div className="welchecking" role="status"><span className="welchecking__spin" aria-hidden="true" /> Checking UIDAI's signature…</div>
        ) : (
          <div className="welqrbtns">
            <button type="button" className="welbtn welbtn--primary welbtn--wide" disabled={!consent} onClick={() => { setError(null); setScanning(true); }}>
              <Icon name="camera" size={16} /> Scan with camera
            </button>
            <label className={`welbtn welbtn--outline welbtn--wide${consent ? '' : ' is-off'}`}>
              <Icon name="image" size={16} /> Upload a photo or screenshot
              <input type="file" accept="image/*" hidden disabled={!consent} onChange={(event) => { void fromFile(event.target.files?.[0]); event.target.value = ''; }} />
            </label>
          </div>
        )}
        {!consent && !scanning && <p className="welfine">Tick the box above to scan.</p>}

        {error && <p className="welerror" role="alert">{error}</p>}

        <details className="welpaste">
          <summary>Have the QR's text from another scanner app?</summary>
          <textarea className="welinput welpaste__box" value={pasted} onChange={(e) => setPasted(e.target.value)}
            placeholder="A long number, thousands of digits" rows={3} />
          <button type="button" className="welbtn welbtn--outline welbtn--sm" disabled={!consent || busy || pasted.trim().length < 100}
            onClick={() => void check(pasted.trim())}>Check this</button>
        </details>

        <button type="button" className="welbtn welbtn--quiet" onClick={onLater}>Do this later</button>
        <p className="welfine">You can buy without it. Selling, and the blue tick, need Aadhaar.</p>
      </div>
    </>
  );
}

function QrGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2" />
    </svg>
  );
}

const ROLES: Array<[string, IconName, string]> = [
  ['buy', 'heart', 'Buy'],
  ['sell', 'box', 'Sell'],
  ['ship', 'plane', 'Ship (forwarder)'],
  ['create', 'image', 'Create (artist)'],
];
const INTERESTS = ['Collectibles', 'Anime & figures', 'Fashion', 'Sneakers', 'Beauty', 'Electronics', 'Toys', 'Art & prints', 'Home', 'Books & manga'];
const LANGUAGES = ['English', 'हिन्दी Hindi', 'தமிழ் Tamil', 'తెలుగు Telugu', 'বাংলা Bengali', 'मराठी Marathi', 'ಕನ್ನಡ Kannada', 'മലയാളം Malayalam'];

function ProfileStep({ draft, onDone }: { draft: Draft; onDone: (profile: Profile, name: string) => void }) {
  const fromAadhaar = draft.aadhaar;
  const [name, setName] = useState(fromAadhaar?.name ?? draft.name);
  // Older QRs carry only a birth year: then the date is asked for, not locked.
  const dobLocked = !!fromAadhaar && /^\d{4}-\d{2}-\d{2}$/.test(fromAadhaar.dob);
  const [dob, setDob] = useState(dobLocked ? fromAadhaar!.dob : '');
  const [gender, setGender] = useState(fromAadhaar?.gender ?? '');
  const suggestion = useMemo(() => suggestUsername(name || draft.email.split('@')[0] || 'figmarker'), [name, draft.email]);
  const [profile, setProfile] = useState<Profile>(draft.profile ?? {
    username: '', roles: ['buy'], city: '', pin: '', interests: [], language: 'English', referral: '', whatsappUpdates: true,
  });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (next: Partial<Profile>) => setProfile((current) => ({ ...current, ...next }));
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !dob || !gender) return setError('Fill in your name, date of birth and gender.');
    if (profile.roles.length === 0) return setError('Pick at least one thing you are here to do.');
    if (profile.pin && !/^[1-9]\d{5}$/.test(profile.pin)) return setError('A PIN code is 6 digits.');
    if (!agreed) return setError('Please accept the Terms to create your account.');
    setError(null);
    haptic('success');
    onDone({ ...profile, username: profile.username.trim() || suggestion }, name.trim());
  }

  return (
    <>
      <div className="welhead welhead--left">
        <h1>Almost there - tell us about you</h1>
        <p>These help us show the right shops, sellers and delivery times.</p>
      </div>
      <form className="welform" onSubmit={submit} noValidate>
        <fieldset className="welgroup">
          <legend>
            Basic details
            {fromAadhaar && <span className="welchip welchip--blue"><BlueTick size={12} /> From Aadhaar</span>}
          </legend>
          <Field label="Full name">
            <input className="welinput" value={name} readOnly={!!fromAadhaar} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="welrow">
            <Field label="Date of birth">
              <input className="welinput" type="date" value={dob} readOnly={dobLocked} onChange={(e) => setDob(e.target.value)} />
            </Field>
            <Field label="Gender">
              {fromAadhaar ? <input className="welinput" value={gender} readOnly /> : (
                <select className="welinput" value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">Choose</option>
                  <option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option>
                </select>
              )}
            </Field>
          </div>
          <div className="welrow">
            <Field label="Email"><input className="welinput" value={draft.email} readOnly /></Field>
            <Field label="WhatsApp"><input className="welinput" value={`+91 ${draft.phone}`} readOnly /></Field>
          </div>
        </fieldset>

        <Field label="Username" hint="Your page lives at figmark.in/username">
          <div className="welhandle">
            <span>@</span>
            <input className="welinput" value={profile.username} placeholder={suggestion} autoCapitalize="none"
              onChange={(e) => set({ username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 30) })} />
          </div>
        </Field>

        <fieldset className="welgroup">
          <legend>I'm here to</legend>
          <div className="welchips">
            {ROLES.map(([id, icon, label]) => (
              <button key={id} type="button" className={`welpick${profile.roles.includes(id) ? ' is-on' : ''}`}
                aria-pressed={profile.roles.includes(id)} onClick={() => set({ roles: toggle(profile.roles, id) })}>
                <Icon name={icon} size={15} /> {label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="welrow">
          <Field label="City"><input className="welinput" autoComplete="address-level2" value={profile.city} placeholder="Mumbai" onChange={(e) => set({ city: e.target.value })} /></Field>
          <Field label="PIN code" hint="For delivery estimates">
            <input className="welinput" inputMode="numeric" autoComplete="postal-code" value={profile.pin} placeholder="400001"
              onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
          </Field>
        </div>

        <fieldset className="welgroup">
          <legend>What do you love? <span className="welfaint">Pick a few</span></legend>
          <div className="welchips">
            {INTERESTS.map((item) => (
              <button key={item} type="button" className={`welpick welpick--sm${profile.interests.includes(item) ? ' is-on' : ''}`}
                aria-pressed={profile.interests.includes(item)} onClick={() => set({ interests: toggle(profile.interests, item) })}>
                {item}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="welrow">
          <Field label="Preferred language">
            <select className="welinput" value={profile.language} onChange={(e) => set({ language: e.target.value })}>
              {LANGUAGES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Referral code" hint="Optional">
            <input className="welinput" value={profile.referral} placeholder="FRIEND10" autoCapitalize="characters"
              onChange={(e) => set({ referral: e.target.value.toUpperCase().slice(0, 16) })} />
          </Field>
        </div>

        <label className="welswitch">
          <span><strong>Order updates on WhatsApp</strong><span>Stages, payments and delivery - no spam.</span></span>
          <input type="checkbox" role="switch" checked={profile.whatsappUpdates} onChange={(e) => set({ whatsappUpdates: e.target.checked })} />
        </label>
        <label className="welcheck">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I agree to the <a href="/legal/terms">Terms</a> and <a href="/legal/privacy">Privacy Policy</a>.</span>
        </label>
        {error && <p className="welerror" role="alert">{error}</p>}
        <button type="submit" className="welbtn welbtn--primary welbtn--wide">Create my account</button>
      </form>
    </>
  );
}

function DoneStep({ draft, onExplore }: { draft: Draft; onExplore: () => void }) {
  const first = draft.name.split(/\s+/)[0] ?? '';
  const verified = !!draft.aadhaar && draft.phoneVerified;
  return (
    <section className="weldone">
      <div className="welearned__burst" aria-hidden="true" />
      <div className="weldone__card">
        <span className="weldone__avatar">{(draft.name[0] ?? 'F').toUpperCase()}</span>
        <strong className="weldone__name">{draft.name} {verified && <BlueTick size={20} />}</strong>
        <span className="weldone__handle">@{draft.profile?.username}</span>
        <ul className="weldone__ticks">
          <li className="is-on"><Icon name="mail" size={13} /> Email</li>
          <li className={draft.phoneVerified ? 'is-on' : ''}><Icon name="message" size={13} /> WhatsApp</li>
          <li className={draft.aadhaar ? 'is-on' : ''}><Icon name="check" size={13} /> Aadhaar</li>
        </ul>
      </div>
      <h1>Welcome to Figmark, {first}! 🎉</h1>
      <p>{verified ? 'Your account is ready and your blue tick is live.' : 'Your account is ready. Verify Aadhaar anytime from your profile to earn the blue tick.'}</p>
      <button type="button" className="welbtn welbtn--primary welbtn--wide" onClick={onExplore}>Start exploring <Icon name="right" size={16} /></button>
    </section>
  );
}

/* ── Small parts ─────────────────────────────────────────────────────────── */

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="welfield">
      <span className="welfield__label">{label}{hint && <span className="welfaint"> · {hint}</span>}</span>
      {children}
    </label>
  );
}

function OtpInput({ value, onChange, label }: { value: string; onChange: (next: string) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="welotp" onClick={() => input.current?.focus()}>
      <input ref={input} className="welotp__input" inputMode="numeric" autoComplete="one-time-code" aria-label={label}
        value={value} maxLength={6} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      {Array.from({ length: 6 }, (_, at) => (
        <span key={at} className={`welotp__box${at === value.length ? ' is-cursor' : ''}${value[at] ? ' is-filled' : ''}`} aria-hidden="true">
          {value[at] ?? ''}
        </span>
      ))}
    </div>
  );
}

/** The two checks that make the blue tick, and how far along they are. */
function TickMeter({ phone, aadhaar }: { phone: boolean; aadhaar: boolean }) {
  return (
    <div className="weltick">
      <BlueTick size={22} />
      <div className="weltick__copy">
        <strong>Blue tick verified badge</strong>
        <span>Shows buyers and sellers you are real. Profiles with it get far more trust.</span>
      </div>
      <ul className="weltick__steps">
        <li className={phone ? 'is-done' : ''}>WhatsApp</li>
        <li className={aadhaar ? 'is-done' : ''}>Aadhaar</li>
      </ul>
    </div>
  );
}

export function BlueTick({ size = 16 }: { size?: number }) {
  return (
    <svg className="welbluetick" width={size} height={size} viewBox="0 0 24 24" aria-label="Verified" role="img">
      <path fill="#1D9BF0" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z" />
      <path fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="m8 12.3 2.7 2.7L16.2 9.4" />
    </svg>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function WhatsAppGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.2.1-.1 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

function useCountdown(running: boolean) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!running || left <= 0) return;
    const timer = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [running, left]);
  return { left, restart: () => setLeft(30) };
}

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));


function formatDob(iso: string) {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}


/* ── Slide art: little screens from the app, in the slide's tone ─────────────
 * Each one shows the feature itself - the tracking timeline, the manifest,
 * the countdown - so the slide reads as "this is what you get". Names,
 * prices and counts are examples. */

function Thumb({ hue, icon, size = 44 }: { hue: number; icon: IconName; size?: number }) {
  return (
    <span className="welm__thumb" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 85% 62%), hsl(${hue + 40} 80% 45%))` }}>
      <Icon name={icon} size={Math.round(size * 0.45)} />
    </span>
  );
}

function Chip({ className = '', children, delay = 0 }: { className?: string; children: ReactNode; delay?: number }) {
  return <span className={`welm__chip ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</span>;
}

function GistArt() {
  const cards: Array<[number, IconName, string, string, string]> = [
    [200, 'box', 'Mecha kit 1/100', '@tokyo.toys', '₹3,450'],
    [320, 'tag', 'Retro high-tops', '@kicks.import', '₹12,900'],
    [30, 'image', 'Monsoon City print', '@inkbyriya', '₹1,200'],
  ];
  return (
    <div className="welm welm--gist">
      {cards.map(([hue, icon, name, shop, price], at) => (
        <div key={name} className={`welm__card welm__fan welm__fan--${at}`}>
          <span className="welm__hero" style={{ background: `linear-gradient(140deg, hsl(${hue} 85% 64%), hsl(${hue + 50} 75% 42%))` }}>
            <Icon name={icon} size={30} />
          </span>
          <strong>{name}</strong>
          <span className="welm__seller">{shop} <BlueTick size={11} /></span>
          <span className="welm__price">{price}</span>
        </div>
      ))}
      <Chip className="welm__chip--tl" delay={500}><Icon name="lock" size={12} /> Held safely until delivery</Chip>
      <Chip className="welm__chip--br" delay={700}><Icon name="star" size={12} /> 4.9 · real orders only</Chip>
    </div>
  );
}

function BuyerArt() {
  const steps = ['Ordered', 'Paid', 'Shipped', 'In customs', 'Delivered'];
  return (
    <div className="welm">
      <div className="welm__card welm__panel">
        <div className="welm__row">
          <Thumb hue={200} icon="box" />
          <span className="welm__grow"><strong>Mecha kit 1/100</strong><span>Lot #24 · @tokyo.toys</span></span>
        </div>
        <ol className="welm__steps">
          {steps.map((step, at) => (
            <li key={step} className={at < 3 ? 'is-done' : at === 3 ? 'is-now' : ''} style={{ animationDelay: `${150 + at * 120}ms` }}>
              <span className="welm__dot" />{step}
            </li>
          ))}
        </ol>
      </div>
      <Chip className="welm__chip--br welm__chip--tone" delay={800}><Icon name="lock" size={12} /> ₹3,450 held by Figmark</Chip>
    </div>
  );
}

function SellerArt() {
  const rows: Array<[string, string, boolean]> = [['Aarav', '×2', true], ['Meera', '×1', true], ['Kabir', '×3', false]];
  return (
    <div className="welm">
      <div className="welm__card welm__panel">
        <div className="welm__row welm__row--between"><strong>Lot #24 · Mecha kits</strong><span className="welm__muted">18 / 20 paid</span></div>
        <span className="welm__bar"><span style={{ width: '90%' }} /></span>
        <ul className="welm__list">
          {rows.map(([name, qty, paid], at) => (
            <li key={name} style={{ animationDelay: `${200 + at * 120}ms` }}>
              <span className="welm__avatar" style={{ background: `hsl(${at * 90 + 20} 70% 55%)` }}>{name[0]}</span>
              <span className="welm__grow">{name} <span className="welm__muted">{qty}</span></span>
              <span className={`welm__pill${paid ? ' is-ok' : ' is-due'}`}>{paid ? 'Paid' : 'Due'}</span>
            </li>
          ))}
        </ul>
      </div>
      <Chip className="welm__chip--tr welm__chip--tone" delay={700}><Icon name="bell" size={12} /> 20 buyers notified</Chip>
    </div>
  );
}

function ForwarderArt() {
  const route = 'M30 70 C 90 0, 190 0, 250 70';
  return (
    <div className="welm">
      <div className="welm__card welm__panel">
        <div className="welm__route">
          <span className="welm__city"><strong>TYO</strong>Tokyo</span>
          <svg viewBox="0 0 280 80" className="welm__arc">
            <path d={route} />
            <g className="welm__plane" style={{ offsetPath: `path('${route}')` }}>
              <circle r="11" />
              <path d="M-5 0h10M1 -4l4 4-4 4" />
            </g>
          </svg>
          <span className="welm__city welm__city--end"><strong>BOM</strong>Mumbai</span>
        </div>
        <div className="welm__row">
          <Thumb hue={215} icon="box" size={36} />
          <span className="welm__grow"><strong>New booking · 42 kg</strong><span>from @tokyo.toys</span></span>
          <span className="welm__btn">Accept</span>
        </div>
      </div>
      <Chip className="welm__chip--tl welm__chip--tone" delay={600}><Icon name="tag" size={12} /> ₹780 / kg</Chip>
    </div>
  );
}

function ArtistArt() {
  return (
    <div className="welm">
      <div className="welm__card welm__panel welm__art">
        <span className="welm__canvas" />
        <div className="welm__grow">
          <strong>Monsoon City</strong>
          <span className="welm__muted">A3 giclée print · limited</span>
          <span className="welm__bar"><span style={{ width: '26%' }} /></span>
          <span className="welm__muted"><b className="welm__tone">37 of 50</b> left</span>
        </div>
      </div>
      <Chip className="welm__chip--br welm__chip--tone" delay={700}><Icon name="lock" size={12} /> Commission advance held</Chip>
    </div>
  );
}

function DiscoverArt() {
  const tiles: Array<[number, IconName]> = [[95, 'tag'], [260, 'box'], [20, 'image'], [180, 'star']];
  return (
    <div className="welm">
      <div className="welm__card welm__panel">
        <div className="welm__lenses">
          {['For you', 'Live', 'Shelves', 'Finds'].map((lens, at) => <span key={lens} className={at === 0 ? 'is-on' : ''}>{lens}</span>)}
        </div>
        <div className="welm__tiles">
          {tiles.map(([hue, icon], at) => (
            <span key={hue} className="welm__tile" style={{ background: `linear-gradient(140deg, hsl(${hue} 80% 60%), hsl(${hue + 50} 70% 38%))`, animationDelay: `${150 + at * 100}ms` }}>
              <Icon name={icon} size={20} />
              {at === 0 && <span className="welm__seen"><Icon name="eye" size={10} /> For sale · 3 shops</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SocialArt() {
  return (
    <div className="welm">
      <div className="welm__card welm__panel">
        <div className="welm__row">
          <span className="welm__avatar welm__avatar--lg" style={{ background: 'var(--grad-warm)' }}>R</span>
          <span className="welm__grow"><strong>Riya <BlueTick size={12} /></strong><span>posted a shelf · 2h</span></span>
        </div>
        <span className="welm__post">
          {[30, 200, 280].map((hue) => <span key={hue} style={{ background: `linear-gradient(160deg, hsl(${hue} 80% 62%), hsl(${hue + 40} 70% 40%))` }} />)}
        </span>
        <div className="welm__row welm__acts">
          <span className="welm__like"><Icon name="heart" size={14} /> 128</span>
          <span><Icon name="message" size={14} /> 24</span>
          <span><Icon name="share" size={14} /></span>
        </div>
      </div>
      <Chip className="welm__chip--tr welm__chip--bubble" delay={700}>"I can get this!" · @kicks.import</Chip>
    </div>
  );
}

function DropsArt() {
  const [left, setLeft] = useState(14 * 60 + 32);
  useEffect(() => {
    const timer = window.setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 15 * 60)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className="welm">
      <div className="welm__card welm__panel">
        <div className="welm__row welm__row--between">
          <span className="welm__live"><span />Power sale · live</span>
          <span className="welm__muted">@tokyo.toys</span>
        </div>
        <div className="welm__clock" aria-label="Channel price ends in">
          {[mm[0], mm[1], ':', ss[0], ss[1]].map((char, at) => <span key={at} className={char === ':' ? 'is-sep' : ''}>{char}</span>)}
        </div>
        <div className="welm__row">
          <Thumb hue={25} icon="bolt" size={36} />
          <span className="welm__grow"><strong>Limited figure · #3 of 8</strong><span><s>₹2,400</s> <b className="welm__tone">₹1,920</b> channel price</span></span>
        </div>
      </div>
      <Chip className="welm__chip--tl welm__chip--tone" delay={600}><Icon name="bell" size={12} /> Drop alert sent</Chip>
    </div>
  );
}

function PlayArt() {
  return (
    <div className="welm">
      <div className="welm__card welm__panel">
        <div className="welm__row">
          <span className="welm__ring" style={{ ['--p' as string]: '72%' }}><span>12</span></span>
          <span className="welm__grow">
            <strong>Level 12 · Collector</strong>
            <span className="welm__bar"><span style={{ width: '72%' }} /></span>
            <span className="welm__muted">720 / 1,000 XP · <b className="welm__tone">7-day streak</b></span>
          </span>
        </div>
        <div className="welm__stickers">
          {(['trophy', 'star', 'heart', 'spark', 'bolt'] as IconName[]).map((icon, at) => (
            <span key={icon} style={{ animationDelay: `${250 + at * 90}ms` }}><Icon name={icon} size={16} /></span>
          ))}
        </div>
      </div>
      <Chip className="welm__chip--br welm__chip--tone" delay={800}><Icon name="rising" size={12} /> #12 on Action figures</Chip>
    </div>
  );
}

function TrustArt() {
  return (
    <div className="welm">
      <div className="welm__card welm__panel welm__profile">
        <span className="welm__avatar welm__avatar--xl" style={{ background: 'var(--grad-cool)' }}>T</span>
        <strong className="welm__name">tokyo.toys <BlueTick size={16} /></strong>
        <ul className="welm__checks">
          <li style={{ animationDelay: '200ms' }}><Icon name="check" size={12} /> WhatsApp verified</li>
          <li style={{ animationDelay: '320ms' }}><Icon name="check" size={12} /> Aadhaar verified</li>
          <li style={{ animationDelay: '440ms' }}><Icon name="star" size={12} /> 4.9 · 212 completed orders</li>
        </ul>
      </div>
    </div>
  );
}

function ReadyArt() {
  return (
    <div className="welm welm--ready">
      <div className="welm__card welm__panel welm__profile welm__you">
        <span className="welm__avatar welm__avatar--xl" style={{ background: 'var(--grad-hero)' }}>You</span>
        <strong className="welm__name">Your name <span className="welm__shine"><BlueTick size={18} /></span></strong>
        <span className="welm__muted">Verified on Figmark</span>
      </div>
    </div>
  );
}
