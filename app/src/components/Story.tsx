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
  return {
    ref: setNode,
    className: `story story--${theme}${state === 'armed' ? ' is-armed' : state === 'shown' ? ' is-shown' : ''}${live ? ' is-live' : ''}`,
    scene: <StoryScene theme={theme} />,
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
 * swims down past a sunken ship to a chest half-buried in the sand; the lid
 * lifts, gold light spills out and coins float up; the diver turns and kicks
 * away with the find, and the lid settles shut for the next one.
 */
function Ocean() {
  return (
    <>
      <span className="sc-caustics" />
      <span className="sc-ray" style={at({ '--x': '10%', '--d': '0s' })} />
      <span className="sc-ray" style={at({ '--x': '52%', '--d': '-4s' })} />
      <span className="sc-wreck" />
      <span className="sc-school"><i /></span>
      <span className="sc-jelly" />
      <span className="sc-sand" />
      {['3%', '16%', '90%'].map((x, n) => (
        <span key={x} className="sc-weed" style={at({ '--x': x, '--d': `${n * -0.9}s`, '--h': `${40 + (n % 2) * 18}px` })} />
      ))}
      <span className="sc-chest">
        <i className="sc-chest__glow" />
        {[0, 1, 2, 3].map((n) => <i key={n} className="sc-coin" style={at({ '--n': String(n) })} />)}
        <i className="sc-chest__box" />
        <i className="sc-chest__lid" />
      </span>
      <span className="sc-dive">
        <i className="sc-diver">
          <b className="sc-diver__lamp" />
          {[0, 1, 2].map((n) => <b key={n} className="sc-diver__bubble" style={at({ '--n': String(n) })} />)}
        </i>
      </span>
    </>
  );
}

/** The cast: a stage - the curtains part as the people come on, spotlights find them. */
function Stage() {
  return (
    <>
      <span className="sc-spot" style={at({ '--x': '22%', '--d': '0s' })} />
      <span className="sc-spot" style={at({ '--x': '72%', '--d': '-3.5s' })} />
      <span className="sc-curtain sc-curtain--left"><i /></span>
      <span className="sc-curtain sc-curtain--right"><i /></span>
      <span className="sc-footlights" />
    </>
  );
}

/** The quest: a treasure map - the trail inks itself in, footprints follow it, X marks the spot. */
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
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`sc-foot${n % 2 ? ' sc-foot--r' : ''}`} style={at({ '--x': `${12 + n * 9}%`, '--y': `${74 - (n % 2) * 5 - n * 2}%`, '--d': `${n * 0.45}s` })} />
      ))}
      <span className="sc-x" />
      <span className="sc-compass"><i /></span>
    </>
  );
}

/** The scene: a cinema - the projector's beam flickering, dust in it, the leader counting down. */
function Cinema() {
  return (
    <>
      <span className="sc-beam" />
      {[[14, 30], [32, 62], [52, 24], [66, 70], [80, 40], [44, 46], [24, 78], [90, 18]].map(([x, y], n) => (
        <span key={n} className="sc-dust" style={at({ '--x': `${x}%`, '--y': `${y}%`, '--d': `${n * -0.8}s` })} />
      ))}
      <span className="sc-scratch" />
      <span className="sc-scratch sc-scratch--late" />
      <span className="sc-leader"><i /></span>
    </>
  );
}
