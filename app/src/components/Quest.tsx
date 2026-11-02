import { formatCount } from '../format';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  RARITY_LABELS, STICKER_TIER_NAMES, titleFor, type QuestView, type RarityTier, type StickerView,
} from '@shared/quest';
import { ApiRequestError, api, type QuestResult } from '../api';
import { useSession } from '../session';
import { useToast } from './Feedback';
import { Confetti } from './Confetti';
import { Modal } from './ui';
import { useShareSheet, type ShareSpec } from './ShareKit';

/*
 * The collector game's shared pieces.
 *
 * Everything the gamified Buy tab, the Quests page and the collector profile
 * draw with lives here, so an honour or a level ring looks the same on
 * every screen - and so the one piece of global state the game has (your own
 * quest view, and the celebration when it moves) is held in one place.
 */

/* ── Your own quest state ──────────────────────────────────────────────── */

interface Celebration {
  run: number;
  levelBefore: number;
  levelAfter: number;
  gained: number;
  title: string;
}

interface QuestContextValue {
  view: QuestView | null;
  refresh: () => Promise<void>;
  /** Runs a game write and celebrates whatever it earned. Null back when it failed. */
  act: (write: () => Promise<QuestResult>, title?: string) => Promise<QuestResult | null>;
}

const QuestContext = createContext<QuestContextValue>({
  view: null,
  refresh: async () => {},
  act: async () => null,
});

export function useQuest() {
  return useContext(QuestContext);
}

const LEVEL_KEY = 'figmark.level';

/**
 * Holds the signed-in person's quest view and throws the parties.
 *
 * A level can go up from somewhere that is not a game screen - an order
 * placed, a review written - so the last level seen is remembered and a jump
 * is celebrated the next time the view is read, wherever that happens.
 */
export function QuestProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const toast = useToast();
  const [view, setView] = useState<QuestView | null>(null);
  const [party, setParty] = useState<Celebration | null>(null);

  const noticeLevel = useCallback((next: QuestView) => {
    let seen = 0;
    try {
      seen = Number(window.localStorage.getItem(LEVEL_KEY) ?? 0);
      window.localStorage.setItem(LEVEL_KEY, String(next.level));
    } catch {
      return;
    }
    if (seen > 0 && next.level > seen) {
      setParty((current) => ({
        run: (current?.run ?? 0) + 1,
        levelBefore: seen,
        levelAfter: next.level,
        gained: 0,
        title: 'Level up',
      }));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const { view: next } = await api.quest();
      setView(next);
      noticeLevel(next);
    } catch {
      // The game is a layer over the market: if it cannot load, the market still works.
    }
  }, [user, noticeLevel]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback<QuestContextValue['act']>(async (write, title) => {
    try {
      const result = await write();
      setView(result.view);
      try {
        window.localStorage.setItem(LEVEL_KEY, String(result.view.level));
      } catch {
        // See above.
      }
      if (result.levelAfter > result.levelBefore) {
        setParty((current) => ({
          run: (current?.run ?? 0) + 1,
          levelBefore: result.levelBefore,
          levelAfter: result.levelAfter,
          gained: result.gained,
          title: 'Level up',
        }));
      } else if (result.gained > 0) {
        toast(`+${result.gained} XP`, 'ok');
      }
      return result;
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not go through.', 'error');
      return null;
    }
  }, [toast]);

  const value = useMemo(() => ({ view, refresh, act }), [view, refresh, act]);
  return (
    <QuestContext.Provider value={value}>
      {children}
      {party && <CelebrationModal party={party} onClose={() => setParty(null)} />}
    </QuestContext.Provider>
  );
}

/** What a celebration looks like as a picture to share: the level reached. */
function celebrationSpec(party: Celebration): ShareSpec | null {
  if (party.levelAfter > party.levelBefore) {
    const title = titleFor(party.levelAfter);
    return {
      kind: 'level',
      moment: {
        level: { level: party.levelAfter, title }, title: `Level ${party.levelAfter} · ${title}`,
        detail: 'Collector on Figmark', headline: 'Level up!',
      },
      link: { to: 'invite' },
      caption: `Just hit level ${party.levelAfter} (${title}) on Figmark ⭐ Come play - pre-orders, quests and hobby leaderboards.`,
      target: String(party.levelAfter),
    };
  }
  return null;
}

function CelebrationModal({ party, onClose }: { party: Celebration; onClose: () => void }) {
  const { open, sheet } = useShareSheet();
  const spec = celebrationSpec(party);
  const levelled = party.levelAfter > party.levelBefore;

  return (
    <Modal title={party.title} onClose={onClose}>
      <div className="qparty">
        <Confetti run={party.run} />
        {levelled && (
          <div className="qparty__level">
            <LevelRing level={party.levelAfter} progress={0} size={84} />
            <p>
              You reached <b>level {party.levelAfter}</b> · {titleFor(party.levelAfter)}.
            </p>
          </div>
        )}
        {party.gained > 0 && <p className="qparty__xp">+{party.gained} XP</p>}
        <div className="row" style={{ justifyContent: 'center' }}>
          {spec && <button type="button" className="btn mshare__go" onClick={() => open(spec)}>Share it</button>}
          {levelled && <Link to="/quests" className="btn btn--quiet" onClick={onClose}>Open Quests</Link>}
          <button type="button" className="btn btn--quiet" onClick={onClose}>Nice</button>
        </div>
      </div>
      {sheet}
    </Modal>
  );
}

/* ── Marks ─────────────────────────────────────────────────────────────── */

/** A level in a ring that fills as the level does. */
export function LevelRing({ level, progress, size = 40 }: { level: number; progress: number; size?: number }) {
  const stroke = Math.max(3, Math.round(size / 11));
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <span className="qring" style={{ width: size, height: size }} role="img" aria-label={`Level ${level}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--q-track)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="url(#qring-grad)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${Math.max(0.001, progress) * length} ${length}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <defs>
          <linearGradient id="qring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--violet-lit)" />
            <stop offset="1" stopColor="var(--pink)" />
          </linearGradient>
        </defs>
      </svg>
      <b style={{ fontSize: Math.round(size * 0.36) }}>{level}</b>
    </span>
  );
}

export function XpBar({ progress, tone = 'violet' }: { progress: number; tone?: 'violet' | 'gold' }) {
  return (
    <span className={`qxp qxp--${tone}`} aria-hidden="true">
      <span style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
    </span>
  );
}

/** The rarity a listing wears, as the ribbon at the top of its card. */
export function RarityRibbon({ tier }: { tier: RarityTier }) {
  return <span className={`qribbon qribbon--${tier}`}>{RARITY_LABELS[tier]}</span>;
}

/**
 * Your level, XP and streak in the width of a chip; opens the Quests page. It
 * is the long view while the daily quest board is today's. XP claimed there
 * flies up here and the chip pops when it lands; it shakes red when XP is
 * taken back, as when a save is undone.
 */
export function CollectorChip() {
  const { view } = useQuest();
  const seen = useRef<number | null>(null);
  const [gain, setGain] = useState<{ id: number; xp: number } | null>(null);
  const xp = view?.xp ?? null;
  useEffect(() => {
    if (xp === null) return;
    if (seen.current !== null && xp !== seen.current) setGain({ id: Date.now(), xp: xp - seen.current });
    seen.current = xp;
  }, [xp]);
  if (!view) return null;
  return (
    <Link to="/quests" className={`qchip${gain ? (gain.xp > 0 ? ' is-gain' : ' is-loss') : ''}`} key={gain?.id}
      aria-label={`Level ${view.level} ${view.title}, open Quests`}>
      {view.streak.current > 0 && (
        <span className="qchip__streak" title={`${view.streak.current}-day streak`}>
          <Glyph name="flame" size={13} />{view.streak.current}
        </span>
      )}
      <LevelRing level={view.level} progress={view.progress} size={30} />
      <span className="qchip__text">
        <small>You</small>
        <span>{view.xp - view.levelFloor}/{view.nextLevelXp - view.levelFloor} XP</span>
      </span>
      {gain ? <em className={`qchip__gain${gain.xp < 0 ? ' qchip__gain--loss' : ''}`}>{gain.xp > 0 ? `+${gain.xp}` : `−${-gain.xp}`} XP</em> : null}
    </Link>
  );
}

/** The first shop you run, as the same chip: its level and XP, one tap from its quests. */
export function StoreChip() {
  const [shop, setShop] = useState<{ id: string; name: string; level: Awaited<ReturnType<typeof api.growth>>['level'] } | null>(null);
  // Asked again when the account changes, and not at all for a guest.
  const userId = useSession().user?.id ?? null;
  useEffect(() => {
    setShop(null);
    if (!userId) return;
    let live = true;
    void api.stores().then(async ({ stores }) => {
      const first = stores[0];
      if (!first) return;
      const board = await api.growth(first.ownerId);
      if (live) setShop({ id: first.ownerId, name: board.name, level: board.level });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [userId]);
  if (!shop) return null;
  const { level } = shop;
  return (
    <Link to={`/quests?shop=${encodeURIComponent(shop.id)}`} className="qchip"
      aria-label={`${shop.name}: level ${level.level} ${level.title}, open shop quests`}>
      <LevelRing level={level.level} progress={level.progress} size={30} />
      <span className="qchip__text">
        <small>Store</small>
        <span>{formatCount(level.points)}{level.next === null ? '' : `/${formatCount(level.next)}`} XP</span>
      </span>
    </Link>
  );
}

/* ── Glyphs ────────────────────────────────────────────────────────────── */

export type GlyphName = StickerView['glyph'] | 'card' | 'box';

/** Drawn rather than emoji, so they look the same in every browser and take the text colour. */
export function Glyph({ name, size = 18 }: { name: GlyphName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  switch (name) {
    case 'flame':
      return <svg {...common}><path fill="currentColor" d="M12 22c4 0 7-2.7 7-6.8C19 10 14 8 14 3c-3 1.5-5 4.5-5 7-1-.5-2-1.8-2-3.2C5.6 8.3 5 10.6 5 12.5 5 18.6 8 22 12 22Z" /></svg>;
    case 'bolt':
      return <svg {...common}><path fill="currentColor" d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>;
    case 'crest':
    case 'shield':
      return <svg {...common}><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" /></svg>;
    case 'star':
      return <svg {...common}><path fill="currentColor" d="m12 2.6 2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8Z" /></svg>;
    case 'heart':
      return <svg {...common}><path fill="currentColor" d="M12 20.4s-7.6-4.6-7.6-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.6 2.8c0 5.6-7.6 10.2-7.6 10.2Z" /></svg>;
    case 'chat':
      return <svg {...common}><path fill="currentColor" d="M4 4.8h16v11H9.6L4 20Z" /></svg>;
    case 'bag':
      return <svg {...common}><path fill="currentColor" d="M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" /><path d="M9.5 8V6.5a2.5 2.5 0 0 1 5 0V8" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
    case 'chest':
      return <svg {...common}><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 11h16v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" /><path d="M4 11V9a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2" /><rect x="10" y="10" width="4" height="4" rx="1" /></g></svg>;
    case 'clock':
      return <svg {...common}><g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></g></svg>;
    case 'crown':
      return <svg {...common}><path fill="currentColor" d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z" /></svg>;
    case 'gift':
      return <svg {...common}><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M3 9h18M12 9v11M12 9c-1.5-4-6-4-6-1.5S12 9 12 9Zm0 0c1.5-4 6-4 6-1.5S12 9 12 9Z" /></g></svg>;
    case 'card':
      return <svg {...common}><g stroke="currentColor" strokeWidth="1.8" fill="none"><rect x="4" y="5" width="10" height="15" rx="1.6" transform="rotate(-10 9 12)" /><rect x="10" y="4" width="10" height="15" rx="1.6" fill="currentColor" fillOpacity=".35" /></g></svg>;
    case 'box':
    default:
      return <svg {...common}><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" /><path d="m4 8.5 8 4.5 8-4.5M12 13v7" /></g></svg>;
  }
}

/* ── Honours ──────────────────────────────────────────────────────────── */

/** An honour as a hexagon with its tier as the rim colour. Tapping it explains it. (Called a sticker in code.) */
export function Sticker({ sticker, onOpen }: { sticker: StickerView; onOpen?: () => void }) {
  const body = (
    <>
      <span className={`qsticker__hex qhue--${sticker.hue} qtier--${sticker.tier}`}><Glyph name={sticker.glyph} size={22} /></span>
      <span className="qsticker__name">{sticker.name}</span>
      {sticker.tier > 0 && sticker.tiers.length > 1 && (
        <span className={`qsticker__tier qtiertext--${sticker.tier}`}>{STICKER_TIER_NAMES[sticker.tier]}</span>
      )}
    </>
  );
  const className = `qsticker${sticker.earned ? '' : ' is-locked'}`;
  return onOpen ? (
    <button type="button" className={`${className} qsticker--tap`} onClick={onOpen} aria-label={`${sticker.name}: ${STICKER_TIER_NAMES[sticker.tier]}`}>
      {body}
    </button>
  ) : (
    <div className={className} title={sticker.meaning}>{body}</div>
  );
}

/**
 * An honour on a turntable. It spins in when opened; a tap spins it
 * once more; a drag turns it under the finger and lets go into a spin that
 * comes to rest face up. One element throughout, so it never blinks.
 */
export function Spin({ spinKey, children, back }: {
  /** Changes when the thing shown changes, which spins it in again. */
  spinKey: string;
  children: ReactNode;
  /** What shows when it is turned away. Without one it shows through. */
  back?: ReactNode;
}) {
  const node = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const turnTo = useCallback((to: number, from: number, ms: number) => {
    const el = node.current;
    if (!el) return;
    el.getAnimations().forEach((animation) => animation.cancel());
    angle.current = to;
    el.style.transform = `rotateY(${to}deg)`;
    if (still) return;
    el.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }],
      { duration: ms, easing: 'cubic-bezier(0.17, 0.84, 0.28, 1)' },
    );
  }, [still]);

  useEffect(() => {
    turnTo(0, -720, 1200);
  }, [spinKey, turnTo]);

  function down(event: React.PointerEvent<HTMLDivElement>) {
    const el = node.current;
    if (!el) return;
    // Pick it up where it is, even mid-spin: the angle it is showing right now.
    const shown = getComputedStyle(el).transform;
    const matrix = shown && shown !== 'none' ? new DOMMatrixReadOnly(shown) : null;
    const live = matrix ? (Math.atan2(-matrix.m13, matrix.m11) * 180) / Math.PI : angle.current;
    el.getAnimations().forEach((animation) => animation.cancel());
    drag.current = { x: event.clientX, from: live, moved: false };
    el.style.transform = `rotateY(${live}deg)`;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    const held = drag.current;
    const el = node.current;
    if (!held || !el) return;
    const dx = event.clientX - held.x;
    if (Math.abs(dx) > 4) held.moved = true;
    angle.current = held.from + dx * 0.9;
    el.style.transform = `rotateY(${angle.current}deg)`;
  }

  function up() {
    const held = drag.current;
    drag.current = null;
    if (!held) return;
    const at = angle.current;
    if (!held.moved) {
      turnTo(Math.round(at / 360) * 360 + 360, at, 1000);
      return;
    }
    // Carry on the way it was flicked, one more full turn, landing face up.
    const way = at >= held.from ? 1 : -1;
    const rest = way > 0 ? (Math.floor(at / 360) + 2) * 360 : (Math.ceil(at / 360) - 2) * 360;
    turnTo(rest, at, 1100);
  }

  return (
    <div className="spin" onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={() => { drag.current = null; turnTo(Math.round(angle.current / 360) * 360, angle.current, 500); }}>
      <div ref={node} className={`spin__turn${back ? ' spin__turn--sided' : ''}`}>
        {back ? <><div className="spin__face">{children}</div><div className="spin__face spin__back">{back}</div></> : children}
      </div>
      <span className="spin__hint">Tap to spin · drag to turn it</span>
    </div>
  );
}

/** What an honour means, how to earn it, and how far along its tiers somebody is. */
export function StickerSheet({ sticker, whose, onClose }: {
  sticker: StickerView;
  whose: 'mine' | 'theirs';
  onClose: () => void;
}) {
  return (
    <Modal title={sticker.name} onClose={onClose}>
      <div className="qsheet">
        <Spin spinKey={sticker.id}>
          <span className={`qsticker__hex qsticker__hex--big qhue--${sticker.hue} qtier--${sticker.tier}`}>
            <Glyph name={sticker.glyph} size={40} />
          </span>
        </Spin>
        <p className="qsheet__state">
          {sticker.earned
            ? <><b className={`qtiertext--${sticker.tier}`}>{sticker.tiers.length > 1 ? STICKER_TIER_NAMES[sticker.tier] : 'Earned'}</b>{whose === 'mine' ? ' · yours' : ''}</>
            : <b className="faint">Not earned yet</b>}
        </p>
        <section className="qsheet__block">
          <h4>What it means</h4>
          <p>{sticker.meaning}</p>
        </section>
        <section className="qsheet__block">
          <h4>How to earn it</h4>
          <p>{sticker.how}</p>
        </section>
        {sticker.tiers.length > 1 && (
          <div className="qtiers">
            {sticker.tiers.map((threshold, index) => (
              <span key={threshold} className={`qtiers__step${sticker.have >= threshold ? ' is-done' : ''}`}>
                <b className={`qtiertext--${index + 1}`}>{STICKER_TIER_NAMES[index + 1]}</b>
                <small>{threshold}</small>
              </span>
            ))}
          </div>
        )}
        <p className="faint qsheet__progress">
          {sticker.next === null
            ? 'Top tier reached.'
            : `${Math.min(sticker.have, sticker.next)} of ${sticker.next} towards ${sticker.tiers.length > 1 ? STICKER_TIER_NAMES[Math.min(STICKER_TIER_NAMES.length - 1, sticker.tier + 1)] : 'this honour'}.`}
        </p>
        <XpBar progress={sticker.next === null ? 1 : sticker.have / sticker.next} tone="gold" />
        <p className="faint qsheet__note">Honours show on the page, so anybody deciding whether to deal with them can see them.</p>
      </div>
    </Modal>
  );
}

/**
 * Every honour, in one sheet, opened from a profile's showcase. Earned ones
 * first, highest tier first; tap one to read what it means.
 */
export function ShowcaseModal({ stickers, whose, onClose }: {
  stickers: StickerView[];
  whose: 'mine' | 'theirs';
  onClose: () => void;
}) {
  const [opened, setOpened] = useState<StickerView | null>(null);
  const sorted = [...stickers].sort((a, b) => b.tier - a.tier);
  if (opened) return <StickerSheet sticker={opened} whose={whose} onClose={() => setOpened(null)} />;
  return (
    <Modal title={`Honours · ${stickers.filter((sticker) => sticker.earned).length}/${stickers.length}`} onClose={onClose}>
      <div className="stack qsheet__scroll">
        <p className="faint" style={{ margin: 0 }}>
          Honours are earned by what somebody actually does - buying, reviewing, backing pre-orders, winning, trading cleanly. Bronze, Silver, Gold, Platinum and Diamond show how far. Tap one to see what it means.
        </p>
        <div className="qstickers">
          {sorted.map((sticker) => (
            <Sticker key={sticker.id} sticker={sticker} onOpen={() => setOpened(sticker)} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
