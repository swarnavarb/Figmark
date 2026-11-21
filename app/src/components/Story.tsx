import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Discover's sections read as chapters of one story. Each is a band running
 * edge to edge between two hand-cut hems (a pinking-shear zig-zag, sketched
 * dashes, waves, curtain scallops, torn paper, sprocket holes) with a little
 * scene playing behind its cards - a carnival, a lab, the sea, a stage, a
 * map, a cinema. Like the street behind "Shops for you", but each its own.
 *
 * The styles are the `.story` rules at the end of styles.css; this file is the
 * markup of each scene and the little behaviour they share.
 */
export type StoryTheme = 'carnival' | 'lab' | 'ocean' | 'stage' | 'map' | 'cinema';

/**
 * A chapter's classes, its scene, and the ref that runs both.
 *
 * - The cards play their entrance the first time the band scrolls in. Nothing
 *   is hidden until the observer is known to work (`is-armed`), so a browser
 *   without one - or a printed page - still shows every card.
 * - The scene only moves while the band is on screen (`is-live`): a scene
 *   scrolled out of sight costs nothing.
 */
export function useStory(theme: StoryTheme): { ref: (node: HTMLElement | null) => void; className: string; scene: ReactNode } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<'idle' | 'armed' | 'shown'>('idle');
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setState('shown');
      setLive(true);
      return;
    }
    setState((now) => (now === 'shown' ? now : 'armed'));
    const watch = new IntersectionObserver((entries) => {
      const seen = entries.some((entry) => entry.isIntersecting);
      setLive(seen);
      if (seen) setState('shown');
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    watch.observe(node);
    return () => watch.disconnect();
  }, [node]);
  useEffect(() => (node ? swingRows(node) : undefined), [node]);
  return {
    ref: setNode,
    className: `story story--${theme}${state === 'armed' ? ' is-armed' : state === 'shown' ? ' is-shown' : ''}${live ? ' is-live' : ''}`,
    scene: (
      <>
        <StoryScene theme={theme} />
        {theme === 'ocean' && <OceanFront />}
      </>
    ),
  };
}

/** Whether this reader has asked for less motion, here or on the device. */
function reducedMotion(): boolean {
  return document.documentElement.dataset.motion === 'reduced'
    || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Cards with weight. Sliding a chapter's row flings its cards: they lean
 * against the motion, then swing back and settle, as if they had mass - a
 * spring on one number (`--fling`, -1 to 1) that the CSS turns into a lean.
 * The number only moves while the row does; at rest nothing runs at all.
 */
function swingRows(band: HTMLElement): () => void {
  if (reducedMotion()) return () => undefined;
  type Swing = { last: number; at: number; pos: number; vel: number; push: number; frame: number };
  const swings = new Map<HTMLElement, Swing>();
  const settle = (row: HTMLElement, swing: Swing) => {
    swing.vel = (swing.vel + (swing.push - swing.pos) * 0.14) * 0.8;
    swing.pos += swing.vel;
    swing.push *= 0.86;
    if (Math.abs(swing.pos) + Math.abs(swing.vel) + Math.abs(swing.push) < 0.004) {
      swing.frame = 0;
      row.classList.remove('is-flung');
      row.style.removeProperty('--fling');
      return;
    }
    row.style.setProperty('--fling', swing.pos.toFixed(3));
    swing.frame = requestAnimationFrame(() => settle(row, swing));
  };
  const onScroll = (event: Event) => {
    const row = event.target;
    if (!(row instanceof HTMLElement) || !row.classList.contains('story__row')) return;
    const now = performance.now();
    const swing = swings.get(row);
    if (!swing) {
      swings.set(row, { last: row.scrollLeft, at: now, pos: 0, vel: 0, push: 0, frame: 0 });
      return;
    }
    const speed = (row.scrollLeft - swing.last) / Math.max(8, now - swing.at);
    swing.last = row.scrollLeft;
    swing.at = now;
    swing.push = Math.max(-1, Math.min(1, swing.push * 0.5 - speed * 0.4));
    if (!swing.frame) {
      row.classList.add('is-flung');
      swing.frame = requestAnimationFrame(() => settle(row, swing));
    }
  };
  band.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    band.removeEventListener('scroll', onScroll, { capture: true });
    for (const swing of swings.values()) cancelAnimationFrame(swing.frame);
  };
}

/** The small chapter line over a section's heading. Decoration: the heading says what it is. */
export function StoryTag({ children }: { children: string }) {
  return <span className="story__tag" aria-hidden="true">{children}</span>;
}

/** A custom property or two for one piece of a scene: where it stands, when it starts. */
const at = (vars: Record<string, string>) => vars as CSSProperties;

function StoryScene({ theme }: { theme: StoryTheme }) {
  return (
    <div className={`storyscene storyscene--${theme}`} aria-hidden="true">
      {theme === 'carnival' && <Carnival />}
      {theme === 'lab' && <Lab />}
      {theme === 'ocean' && <Ocean />}
      {theme === 'stage' && <Stage />}
      {theme === 'map' && <QuestMap />}
      {theme === 'cinema' && <Cinema />}
    </div>
  );
}

/** The invitation: a fair at night - bunting swinging on its strings, tickets drifting up. */
function Carnival() {
  const tickets = [
    { x: '6%', d: '0s', t: '11s', r: '-18deg' }, { x: '22%', d: '-4s', t: '13s', r: '12deg' },
    { x: '41%', d: '-8s', t: '10s', r: '-8deg' }, { x: '58%', d: '-2s', t: '12s', r: '20deg' },
    { x: '74%', d: '-6s', t: '14s', r: '-14deg' }, { x: '90%', d: '-10s', t: '11.5s', r: '9deg' },
  ];
  return (
    <>
      <span className="sc-glow" />
      <span className="sc-bunting"><i /></span>
      <span className="sc-bunting sc-bunting--far"><i /></span>
      {tickets.map((ticket, n) => (
        <span key={n} className="sc-ticket" style={at({ '--x': ticket.x, '--d': ticket.d, '--t': ticket.t, '--r': ticket.r })} />
      ))}
    </>
  );
}

/** The lab: a strand of DNA turning over, a flask bubbling, a scanner sweeping the bench. */
function Lab() {
  return (
    <>
      <span className="sc-grid" />
      <span className="sc-helix">
        {Array.from({ length: 20 }, (_, n) => <i key={n} style={at({ '--n': String(n) })} />)}
      </span>
      <span className="sc-scan" />
      {[8, 13, 18, 11, 16].map((x, n) => (
        <span key={n} className="sc-bubble" style={at({ '--x': `${x}%`, '--d': `${n * -1.3}s`, '--s': `${4 + (n % 3) * 2}px` })} />
      ))}
    </>
  );
}

/**
 * The treasure: one dive, told on a loop. Light plays on the surface; a diver
 * swims down past a sunken ship and the corals to a chest half-buried in the
 * sand; the lid lifts, gold light spills out and coins float up; the diver
 * turns and kicks away with the find, and the lid settles shut for the next.
 *
 * The sea, the wreck and the reef are behind the cards; the fish, the chest
 * and the diver swim in front of them ({@link OceanFront}).
 */
function Ocean() {
  return (
    <>
      <span className="sc-caustics" />
      <span className="sc-ray" style={at({ '--x': '10%', '--d': '0s' })} />
      <span className="sc-ray" style={at({ '--x': '52%', '--d': '-4s' })} />
      <span className="sc-wreck" />
      <span className="sc-jelly" />
      <span className="sc-sand" />
      <span className="sc-coral sc-coral--fan" />
      <span className="sc-coral sc-coral--brain" />
      <span className="sc-coral sc-coral--branch" />
      <span className="sc-coral sc-coral--branch sc-coral--far" />
      {['3%', '16%', '90%'].map((x, n) => (
        <span key={x} className="sc-weed" style={at({ '--x': x, '--d': `${n * -0.9}s`, '--h': `${40 + (n % 2) * 18}px` })} />
      ))}
    </>
  );
}

/** The treasure's foreground: the fish, the chest and its light, and the diver, over the cards. */
function OceanFront() {
  return (
    <div className="storyscene storyscene--front" aria-hidden="true">
      <span className="sc-school"><i /></span>
      <span className="sc-school sc-school--late"><i /></span>
      <span className="sc-chest">
        <i className="sc-chest__glow" />
        {[0, 1, 2, 3].map((n) => <i key={n} className="sc-coin" style={at({ '--n': String(n) })} />)}
        <i className="sc-chest__box" />
        <i className="sc-chest__lid" />
      </span>
      <span className="sc-dive">
        <i className="sc-diver">
          <b className="sc-diver__lamp" />
          <Diver />
          {[0, 1, 2].map((n) => <b key={n} className="sc-diver__bubble" style={at({ '--n': String(n) })} />)}
        </i>
      </span>
    </div>
  );
}

/** The diver, swimming left: mask and lamp out front, tank on the back, fins kicking. */
function Diver() {
  return (
    <svg className="sc-diver__body" viewBox="0 0 84 32">
      <g className="sc-diver__fin sc-diver__fin--far">
        <path d="M60 17 L70 18 L82 12 L80 21 L70 22 L60 21Z" fill="#0891B2" stroke="#CFFAFE" strokeWidth="0.6" />
      </g>
      <path d="M44 15.5 C52 14.5 58 15.5 64 17.5 L64 22 C58 22 52 22 44 21.5Z" fill="#334155" stroke="#CBD5E1" strokeWidth="0.8" />
      <g className="sc-diver__fin">
        <path d="M60 19 L70 21 L83 18 L80 27 L70 25 L60 23Z" fill="#22D3EE" stroke="#CFFAFE" strokeWidth="0.6" />
      </g>
      <path d="M14 14 C18 9 30 9 44 12 C50 13 50 22 44 22 C30 24 18 22 14 18Z" fill="#F97316" stroke="#FFEDD5" strokeWidth="0.9" />
      <path d="M24 13 C30 12 38 12.5 46 14.5 L45.5 19 C38 18.5 30 18.5 24.5 19.5Z" fill="#334155" />
      <rect x="22" y="3.5" width="22" height="7.5" rx="3.7" fill="#FACC15" stroke="#FEF9C3" strokeWidth="0.8" />
      <rect x="40" y="4.5" width="4.5" height="5.5" rx="1.2" fill="#CBD5E1" />
      <path d="M22 8.5 C18 9 16 11 15 13" fill="none" stroke="#E2E8F0" strokeWidth="1.2" />
      <path d="M26 20 C22 23 16 24 9 23" fill="none" stroke="#F97316" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="11" cy="14" r="6.5" fill="#334155" stroke="#CBD5E1" strokeWidth="0.9" />
      <path d="M4.5 11.5 C4.5 10 7.5 9.3 11.5 9.8 L11.5 16.2 C7.5 16.7 4.5 16 4.5 14.5Z" fill="#7DD3FC" stroke="#F8FAFC" strokeWidth="1.1" />
      <path d="M6 12 L8.4 11.3" stroke="#F0F9FF" strokeWidth="1" strokeLinecap="round" />
      <rect x="3.5" y="21" width="6.5" height="4.2" rx="1.5" fill="#FDE68A" stroke="#A16207" strokeWidth="0.6" />
    </svg>
  );
}

/**
 * The cast: a stage, its side drapes tied back. The front curtain that rises
 * on the people and the lamps over them are the cards' own (FollowSuggestions).
 */
function Stage() {
  return (
    <>
      <span className="sc-haze" />
      <span className="sc-curtain sc-curtain--left"><i /></span>
      <span className="sc-curtain sc-curtain--right"><i /></span>
      <span className="sc-footlights" />
    </>
  );
}

/**
 * The quest, told on a loop along the bottom of the map: an explorer sets
 * off, footprints following, to the X; digs; a chest comes up out of the
 * ground and opens in a burst of sparkle; the explorer jumps for joy - and
 * the map fades to start the walk again.
 */
function QuestMap() {
  const id = useId().replace(/:/g, '');
  return (
    <>
      <span className="sc-hills" />
      <svg className="sc-trail" viewBox="0 0 400 160" preserveAspectRatio="none">
        <defs>
          <filter id={`ink${id}`}><feTurbulence baseFrequency="0.9" numOctaves="1" seed="4" /><feDisplacementMap in="SourceGraphic" scale="1.6" /></filter>
        </defs>
        <path d="M-6 120 C 40 100, 60 140, 104 118 S 160 70, 206 92 S 270 132, 312 96 S 350 52, 372 58"
          fill="none" stroke="#7A3E12" strokeWidth="2.2" strokeDasharray="7 6 3 6" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" filter={`url(#ink${id})`} />
      </svg>
      <span className="sc-compass"><i /></span>
      <span className="sc-prints">
        {Array.from({ length: 9 }, (_, n) => (
          <i key={n} className={n % 2 ? 'is-right' : undefined} style={at({ '--x': `${6 + n * 8.4}%` })} />
        ))}
      </span>
      <span className="sc-x" />
      <span className="sc-dig">
        <i className="sc-dig__glow" />
        {[0, 1, 2, 3, 4].map((n) => <i key={n} className="sc-spark" style={at({ '--n': String(n) })} />)}
        <i className="sc-dig__box" />
        <i className="sc-dig__lid" />
      </span>
      {[0, 1, 2].map((n) => <span key={n} className="sc-dirt" style={at({ '--n': String(n) })} />)}
      <span className="sc-walk">
        <i className="sc-explorer">
          <svg viewBox="0 0 30 38">
            <g className="sc-explorer__shovel">
              <path d="M23 10 L27 30" stroke="#5C3317" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M24.5 28 C23 33 27 37 29 36 C31 34 30 30 28 28Z" fill="#94A3B8" stroke="#475569" strokeWidth="0.7" />
            </g>
            <path d="M12 26 L10 36 M17 26 L19 36" stroke="#3B2A1A" strokeWidth="2.6" strokeLinecap="round" />
            <rect x="3" y="13" width="7" height="10" rx="2" fill="#7C4A1E" />
            <path d="M8 14 C8 11 21 11 21 14 L20 27 L9 27Z" fill="#4D7C0F" />
            <path d="M14 12 L14 27" stroke="#365314" strokeWidth="0.8" />
            <circle cx="15" cy="8" r="4.6" fill="#F2C48D" />
            <path d="M8 6 C9 1.5 21 1.5 22 6 L24.5 6.8 L5.5 6.8Z" fill="#92400E" />
            <path d="M10 5.2 L20 5.2" stroke="#451A03" strokeWidth="1" />
            <circle cx="17.2" cy="8.2" r="0.8" fill="#1C1917" />
            <path d="M19 16 L24 12" stroke="#4D7C0F" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </i>
      </span>
    </>
  );
}

/**
 * The scene: a cinema, and a short film on its screen along the bottom of the
 * band. The leader counts down 3, 2, 1; a flash; a figure walks in carrying a
 * box and sets it down; out pops a toy, hearts float up; the figure jumps for
 * joy; "The End" - and the reel runs again.
 */
function Cinema() {
  return (
    <>
      <span className="sc-beam" />
      {[[14, 30], [32, 62], [52, 24], [66, 70], [80, 40], [44, 46], [24, 78], [90, 18]].map(([x, y], n) => (
        <span key={n} className="sc-dust" style={at({ '--x': `${x}%`, '--y': `${y}%`, '--d': `${n * -0.8}s` })} />
      ))}
      <span className="sc-film">
        <i className="sc-film__light" />
        <i className="sc-film__count"><b /><span>3</span><span>2</span><span>1</span></i>
        <i className="sc-film__walk">
          <svg viewBox="0 0 34 44">
            <g className="sc-film__held"><rect x="22" y="18" width="11" height="10" rx="1" /></g>
            <circle cx="14" cy="6" r="4.6" />
            <path d="M9 13 C9 10 19 10 19 13 L19 28 L9 28Z" />
            <path d="M18 15 L24 20" strokeWidth="2.6" strokeLinecap="round" stroke="currentColor" />
            <path d="M11 28 L9 42 M17 28 L19 42" strokeWidth="3" strokeLinecap="round" stroke="currentColor" />
          </svg>
        </i>
        <i className="sc-film__box"><svg viewBox="0 0 14 12"><rect x="1" y="2" width="12" height="10" rx="1" /><path d="M1 2 L13 2 L13 0.5 L1 0.5Z" /></svg></i>
        <i className="sc-film__pop">
          <svg viewBox="0 0 20 24"><path d="M10 0 L12 5 L17 5 L13 8 L15 13 L10 10 L5 13 L7 8 L3 5 L8 5Z" /><rect x="6" y="13" width="8" height="8" rx="2" /><path d="M6 24 L8 21 L12 21 L14 24" /></svg>
        </i>
        {[0, 1, 2].map((n) => <i key={n} className="sc-film__heart" style={at({ '--n': String(n) })} />)}
        <i className="sc-film__end">The End</i>
        <i className="sc-film__flash" />
        <i className="sc-scratch" />
        <i className="sc-scratch sc-scratch--late" />
      </span>
    </>
  );
}
