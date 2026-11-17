import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { suggestUsername } from '@shared/handles';
import { Icon, type IconName } from '../components/ui';
import { useSession } from '../session';
import { haptic } from '../haptics';
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
 *  - WhatsApp and Aadhaar OTPs are simulated: any six digits pass, and Aadhaar
 *    returns the Google name with a sample date of birth and gender. The real
 *    checks live behind /verify and need a signed-in account.
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
  lede: string;
  points?: Array<[IconName, string, string]>;
  art: () => JSX.Element;
}

const SLIDES: Slide[] = [
  {
    id: 'gist',
    tone: 'violet',
    kicker: 'Welcome to Figmark',
    title: 'Buy, sell, ship and create - with trust built in.',
    lede: 'A marketplace and a community in one: imports, group-buys, drops and original art, plus the people who love them. Your money is held safe until the order arrives.',
    art: GistArt,
  },
  {
    id: 'buyers',
    tone: 'aqua',
    kicker: 'For buyers',
    title: 'Pre-order from anywhere. Never get ghosted.',
    lede: 'Figmark stands between you and the seller until the order is in your hands.',
    points: [
      ['lock', 'Buyer Protection', 'the seller is paid only after your order arrives'],
      ['truck', 'Live tracking', 'every stage from overseas to your door, with photos'],
      ['star', 'Honest reviews', 'only from orders that really happened'],
      ['search', 'Find it faster', 'search with a photo, or post a Wanted and let sellers come to you'],
    ],
    art: BuyerArt,
  },
  {
    id: 'sellers',
    tone: 'coral',
    kicker: 'For sellers',
    title: 'Run group-buys without the spreadsheets.',
    lede: 'Lots, manifests and payments in one place - and buyers who trust you from day one.',
    points: [
      ['box', 'Lots & manifests', 'see who ordered, who paid and who still owes'],
      ['bank', 'Get paid your way', 'full payment, an advance or a booking'],
      ['bell', 'Update once', 'move a stage and every buyer in the lot is told'],
      ['rising', 'Grow', 'storefront, offers, loyalty cards and insights'],
    ],
    art: SellerArt,
  },
  {
    id: 'forwarders',
    tone: 'blue',
    kicker: 'For freight forwarders',
    title: 'Fill every consignment with ready lots.',
    lede: 'Sellers on Figmark book their shipments with you directly - no chasing in group chats.',
    points: [
      ['plane', 'Bookings come to you', 'sellers request space on your routes'],
      ['tag', 'Your rates, visible', 'publish rates and send quotes in a tap'],
      ['truck', 'One update reaches all', 'consignment stages flow to every buyer waiting'],
      ['star', 'Reputation that travels', 'reviews from every seller you ship for'],
    ],
    art: ForwarderArt,
  },
  {
    id: 'artists',
    tone: 'pink',
    kicker: 'For artists & creators',
    title: 'Sell your art, drops and commissions.',
    lede: 'A home for original work, where collectors pay with confidence and you get paid on time.',
    points: [
      ['image', 'A portfolio that sells', 'your page, your prints, your originals'],
      ['spark', 'Limited editions', 'take pre-orders for a print run before you print'],
      ['message', 'Commissions, safely', 'advances held by Figmark until you deliver'],
      ['users', 'Your community', 'followers, posts and channels in one place'],
    ],
    art: ArtistArt,
  },
  {
    id: 'discover',
    tone: 'lime',
    kicker: 'Discover',
    title: "Find things you didn't know to search for.",
    lede: 'Finds, shelves and conversations, ranked for you.',
    points: [
      ['spark', 'Five ways to browse', 'For you, Live, Debates, Shelves and Finds'],
      ['eye', 'Seen it? Buy it', 'tap a photo in a post to see if it is for sale'],
      ['camera', 'Search with a photo', 'snap a picture, get matching items and shops'],
      ['trophy', "The week's best", 'the top posts and shelves, one tap away'],
    ],
    art: DiscoverArt,
  },
  {
    id: 'social',
    tone: 'violet',
    kicker: 'Social',
    title: 'Your hobby, with your people.',
    lede: 'Follow collectors and shops, talk about what you love, and buy from people you already know.',
    points: [
      ['home', 'Your feed', 'posts and shelves from people you follow'],
      ['megaphone', 'Shop channels', 'news, restocks and prices only members get'],
      ['forum', 'Forums & debates', 'join the conversations everyone is having'],
      ['target', 'Wanted board', 'post what you are hunting; sellers reply "I can get this"'],
    ],
    art: SocialArt,
  },
  {
    id: 'drops',
    tone: 'orange',
    kicker: 'Drops & sales',
    title: 'Drops worth turning up for.',
    lede: 'Shops run sales on Figmark, and the people who show up get rewarded.',
    points: [
      ['bolt', 'Power sales', 'channel-only prices, item by item'],
      ['box', 'Pre-order drops', 'join a group-buy lot before it fills up'],
      ['tag', 'Offers & loyalty', 'shop offers and loyalty cards that reward coming back'],
      ['bell', 'Never miss one', 'alerts on your phone the moment a drop goes live'],
    ],
    art: DropsArt,
  },
  {
    id: 'play',
    tone: 'gold',
    kicker: 'Collect & play',
    title: 'Show off your collection. Level up.',
    lede: 'Every buy, review and share counts.',
    points: [
      ['star', 'A collection that is real', 'your showcase is built from delivered orders'],
      ['trophy', 'Quests & streaks', 'earn XP, levels and stickers'],
      ['rising', 'Hobby leaderboards', 'sneakers, figures, cards and more'],
      ['users', 'Spread the word', 'your invite link counts every friend who joins'],
    ],
    art: PlayArt,
  },
  {
    id: 'unique',
    tone: 'aqua',
    kicker: 'Why Figmark is different',
    title: 'Trust is the product.',
    lede: 'Other marketplaces list things. Figmark makes sure both sides can rely on each other.',
    points: [
      ['check', 'Blue tick people', 'WhatsApp and Aadhaar verified'],
      ['lock', 'Money held, not sent', 'released only when the order is delivered'],
      ['star', 'Reviews you can believe', 'two-sided, and only from completed orders'],
      ['users', 'Shopping and community, together', 'buyers, sellers, forwarders and artists in one app'],
    ],
    art: TrustArt,
  },
  {
    id: 'ready',
    tone: 'violet',
    kicker: "You're all set",
    title: 'Create your account in under two minutes.',
    lede: 'Four quick steps. Verify once and the blue tick is yours.',
    art: ReadyArt,
  },
];

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
      <header className="welslides__bar">
        <span className="welslides__brand"><span className="brand__mark welslides__mark" aria-hidden="true" />Figmark</span>
        {!last && <button type="button" className="welslides__skip" onClick={onSignIn}>Skip</button>}
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
                <h1 className="welslide__title">{item.title}</h1>
                <p className="welslide__lede">{item.lede}</p>
                {item.points && (
                  <ul className="welslide__points">
                    {item.points.map(([icon, lead, detail]) => (
                      <li key={lead}>
                        <span className="welslide__pointicon"><Icon name={icon} size={16} /></span>
                        <span><strong>{lead}</strong><span>{detail}</span></span>
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
            <button type="button" className="welbtn welbtn--primary welbtn--wide" onClick={() => go(1)} tabIndex={0}>
              Get started <Icon name="right" size={16} />
            </button>
            <button type="button" className="welbtn welbtn--quiet" onClick={onSignIn}>I already have an account</button>
          </>
        ) : (
          <div className="welslides__nav">
            <button type="button" className="welbtn welbtn--ghost" onClick={() => go(index - 1)} aria-label="Previous">
              <Icon name="left" size={16} /> Back
            </button>
            <span className="welslides__dots" aria-label={`Slide ${index + 1} of ${count}`}>
              {SLIDES.map((item, at) => (
                <button key={item.id} type="button" className={`welslides__dot${at === index ? ' is-on' : ''}`}
                  aria-label={`Go to ${item.kicker}`} aria-current={at === index} onClick={() => go(at)} />
              ))}
            </span>
            {last ? (
              <button type="button" className="welbtn welbtn--primary" onClick={onSignIn}>Sign in <Icon name="right" size={16} /></button>
            ) : (
              <button type="button" className="welbtn welbtn--primary" onClick={() => go(index + 1)}>Next <Icon name="right" size={16} /></button>
            )}
          </div>
        )}
      </footer>
    </section>
  );
}

function GistTiles() {
  const tiles: Array<[IconName, string, string, Tone]> = [
    ['heart', 'Buy', 'protected pre-orders', 'aqua'],
    ['box', 'Sell', 'lots & manifests', 'coral'],
    ['plane', 'Ship', 'freight forwarders', 'blue'],
    ['image', 'Create', 'art & commissions', 'pink'],
  ];
  return (
    <ul className="welgist">
      {tiles.map(([icon, title, sub, tone]) => (
        <li key={title} className={`welgist__tile wel--${tone}`}>
          <span className="welgist__icon"><Icon name={icon} size={18} /></span>
          <strong>{title}</strong>
          <span>{sub}</span>
        </li>
      ))}
    </ul>
  );
}

function ReadySteps() {
  const steps: Array<[string, string]> = [
    ['Sign in with Google', 'your name and email'],
    ['Verify WhatsApp', 'order updates, straight to your phone'],
    ['Verify Aadhaar', 'earns your blue tick'],
    ['Your profile', 'a few details to personalise Figmark'],
  ];
  return (
    <ol className="welready">
      {steps.map(([title, sub], at) => (
        <li key={title}>
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

function AadhaarStep({ draft, onDone, onLater }: { draft: Draft; onDone: (details: AadhaarDetails) => void; onLater: () => void }) {
  const [number, setNumber] = useState('');
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<AadhaarDetails | null>(draft.aadhaar);
  const masked = `+91 ${draft.phone.slice(0, 2)}xxxxxx${draft.phone.slice(-2)}`;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (number.length !== 12 || !verhoeffValid(number)) return setError('That is not a valid Aadhaar number. Check the 12 digits.');
    if (!consent) return setError('Please give consent to verify with UIDAI.');
    setError(null);
    setBusy(true);
    await pause(800); // Simulated: UIDAI sends an OTP to the Aadhaar-linked mobile.
    setBusy(false);
    setSent(true);
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 6) return setError('Enter the 6-digit code sent by UIDAI.');
    setError(null);
    setBusy(true);
    await pause(900); // Simulated: UIDAI's eKYC answer. Sample date of birth and gender.
    setBusy(false);
    haptic('success');
    setFound({ name: draft.name, dob: '1997-08-14', gender: 'Female', last4: number.slice(-4) });
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
          <p className="welfine">We keep only these and the last 4 digits. Your Aadhaar number is never stored or shown.</p>
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
        <p>Verify your Aadhaar to complete the blue tick. Verified people get more orders, and their buyers worry less.</p>
      </div>
      <TickMeter phone aadhaar={false} />

      {!sent ? (
        <form className="welform" onSubmit={send} noValidate>
          <Field label="Aadhaar number">
            <input className="welinput welinput--spaced" inputMode="numeric" autoComplete="off" value={groupAadhaar(number)}
              placeholder="0000 0000 0000" onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 12))} />
          </Field>
          <div className="welnote">
            <Icon name="phone" size={16} />
            <span>UIDAI sends a code to your Aadhaar-linked mobile. It must be your WhatsApp number, <strong>{masked}</strong>.</span>
          </div>
          <label className="welcheck">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I agree to Figmark verifying my Aadhaar with UIDAI to confirm my name, date of birth and gender.</span>
          </label>
          {error && <p className="welerror" role="alert">{error}</p>}
          <button type="submit" className="welbtn welbtn--primary welbtn--wide" disabled={busy}>{busy ? 'Sending…' : 'Send OTP'}</button>
          <button type="button" className="welbtn welbtn--quiet" onClick={onLater}>Do this later</button>
          <p className="welfine">You can buy without it. Selling, and the blue tick, need Aadhaar.</p>
        </form>
      ) : (
        <form className="welform" onSubmit={verify} noValidate>
          <p className="welsent">Code sent to <strong>{masked}</strong>{' '}
            <button type="button" className="welbtn welbtn--link" onClick={() => { setSent(false); setCode(''); }}>Change</button>
          </p>
          <OtpInput value={code} onChange={setCode} label="Aadhaar OTP" />
          {error && <p className="welerror" role="alert">{error}</p>}
          <button type="submit" className="welbtn welbtn--primary welbtn--wide" disabled={busy}>{busy ? 'Verifying…' : 'Verify Aadhaar'}</button>
        </form>
      )}
    </>
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
  const [dob, setDob] = useState(fromAadhaar?.dob ?? '');
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
    if (!fromAadhaar && (!name.trim() || !dob || !gender)) return setError('Fill in your name, date of birth and gender.');
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
              <input className="welinput" type="date" value={dob} readOnly={!!fromAadhaar} onChange={(e) => setDob(e.target.value)} />
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

const groupAadhaar = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

function formatDob(iso: string) {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Aadhaar's own check digit (Verhoeff), so a typo is caught before UIDAI is asked. */
function verhoeffValid(digits: string): boolean {
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  if (!/^[2-9]\d{11}$/.test(digits)) return false;
  let check = 0;
  digits.split('').reverse().forEach((char, at) => {
    check = d[check]![p[at % 8]![Number(char)]!]!;
  });
  return check === 0;
}

/* ── Slide art: small scenes in the slide's tone ─────────────────────────── */

function Orb({ icon, children }: { icon: IconName; children?: ReactNode }) {
  return (
    <div className="welart">
      <div className="welart__ring" />
      <div className="welart__orb"><Icon name={icon} size={44} /></div>
      {children}
    </div>
  );
}

function Float({ at, children, delay = 0 }: { at: string; children: ReactNode; delay?: number }) {
  return <span className={`welfloat welfloat--${at}`} style={{ animationDelay: `${delay}ms` }}>{children}</span>;
}

function GistArt() {
  return (
    <div className="welart">
      <div className="welart__ring" />
      <span className="brand__mark welart__logo" />
      <Float at="tl" delay={100}><Icon name="lock" size={13} /> ₹4,200 held safely</Float>
      <Float at="tr" delay={250}><BlueTick size={14} /> Verified seller</Float>
      <Float at="bl" delay={400}><Icon name="plane" size={13} /> Shipped from Tokyo</Float>
      <Float at="br" delay={550}><Icon name="star" size={13} /> 4.9 · 212 reviews</Float>
    </div>
  );
}
function BuyerArt() {
  return (
    <Orb icon="lock">
      <Float at="tl" delay={100}>Payment held <b>until delivery</b></Float>
      <Float at="br" delay={300}><Icon name="truck" size={13} /> Stage 4 of 5 · In customs</Float>
    </Orb>
  );
}
function SellerArt() {
  return (
    <Orb icon="box">
      <Float at="tl" delay={100}><Icon name="check" size={13} /> 18 of 20 paid</Float>
      <Float at="br" delay={300}><Icon name="bell" size={13} /> 20 buyers notified</Float>
    </Orb>
  );
}
function ForwarderArt() {
  return (
    <Orb icon="plane">
      <Float at="tl" delay={100}>New booking · 42 kg</Float>
      <Float at="br" delay={300}><Icon name="tag" size={13} /> ₹780/kg · Tokyo → Mumbai</Float>
    </Orb>
  );
}
function ArtistArt() {
  return (
    <Orb icon="image">
      <Float at="tl" delay={100}><Icon name="spark" size={13} /> Drop · 50 prints</Float>
      <Float at="br" delay={300}>Commission advance <b>held</b></Float>
    </Orb>
  );
}
function DiscoverArt() {
  return (
    <Orb icon="spark">
      <Float at="tl" delay={100}><Icon name="eye" size={13} /> Seen for sale · 3 shops</Float>
      <Float at="br" delay={300}><Icon name="rising" size={13} /> Trending in Sneakers</Float>
    </Orb>
  );
}
function SocialArt() {
  return (
    <Orb icon="forum">
      <Float at="tl" delay={100}><Icon name="heart" size={13} /> 128 love this shelf</Float>
      <Float at="br" delay={300}><Icon name="target" size={13} /> Wanted · 4 sellers replied</Float>
    </Orb>
  );
}
function DropsArt() {
  return (
    <Orb icon="bolt">
      <Float at="tl" delay={100}><Icon name="bolt" size={13} /> Drop live · 10:00 PM</Float>
      <Float at="br" delay={300}>Channel price <b>-20% for 15 min</b></Float>
    </Orb>
  );
}
function PlayArt() {
  return (
    <Orb icon="trophy">
      <Float at="tl" delay={100}><Icon name="spark" size={13} /> +40 XP · 7-day streak</Float>
      <Float at="br" delay={300}><Icon name="rising" size={13} /> #12 on Action figures</Float>
    </Orb>
  );
}
function TrustArt() {
  return (
    <div className="welart">
      <div className="welart__ring" />
      <div className="welart__orb welart__orb--tick"><BlueTick size={64} /></div>
      <Float at="tl" delay={100}><Icon name="message" size={13} /> WhatsApp ✓</Float>
      <Float at="br" delay={300}>Aadhaar ✓</Float>
    </div>
  );
}
function ReadyArt() {
  return (
    <div className="welart">
      <div className="welart__ring" />
      <div className="welart__orb"><Icon name="spark" size={44} /></div>
    </div>
  );
}
