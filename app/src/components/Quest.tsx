import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  CARDS, CARD_ODDS, CARD_SETS, CARD_XP, RARITY_LABELS, SET_BONUS_XP, STICKER_TIER_NAMES,
  titleFor, type CardDef, type CardRarity, type QuestView, type RarityTier, type StickerView,
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
 * draw with lives here, so a card, a sticker or a level ring looks the same on
 * every screen - and so the one piece of global state the game has (your own
 * quest view, and the celebration when it moves) is held in one place.
 */

/* ── Your own quest state ──────────────────────────────────────────────── */

interface Celebration {
  run: number;
  levelBefore: number;
  levelAfter: number;
  gained: number;
  card: CardDef | null;
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
        card: null,
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
      if (result.card || result.levelAfter > result.levelBefore) {
        setParty((current) => ({
          run: (current?.run ?? 0) + 1,
          levelBefore: result.levelBefore,
          levelAfter: result.levelAfter,
          gained: result.gained,
          card: result.card ?? null,
          title: title ?? (result.card ? 'New card' : 'Level up'),
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

/** What a celebration looks like as a picture to share: the pull, the set it finished, or the level. */
function celebrationSpec(party: Celebration, view: QuestView | null): ShareSpec | null {
  const card = party.card;
  if (card) {
    const set = view?.sets.find((entry) => entry.id === card.set);
    const firstCopy = (view?.cards.filter((mine) => mine.id === card.id).length ?? 0) <= 1;
    if (set?.complete && firstCopy) {
      return {
        kind: 'set',
        moment: { card, title: `${set.name} complete`, detail: `All ${set.total} cards · ${SET_BONUS_XP} XP bonus`, headline: 'Set complete!' },
        link: { to: 'invite' },
        caption: `Just finished the ${set.name} set on Figmark 🏆 Come collect with me.`,
        target: card.set,
      };
    }
    const big = card.rarity === 'legendary' || card.rarity === 'epic';
    return {
      kind: 'card',
      moment: {
        card, title: `From the ${setName(card.set)} set`, detail: `${RARITY_LABELS_CARD[card.rarity]} · only ${CARD_ODDS[card.rarity]}% of packs`,
        headline: big ? `${RARITY_LABELS_CARD[card.rarity]} pull!` : 'New card pulled',
      },
      link: { to: 'invite' },
      caption: `Pulled ${card.rarity === 'epic' ? 'an' : 'a'} ${card.rarity} ${card.name} on Figmark 🃏 Only ${CARD_ODDS[card.rarity]}% of packs have one.`,
      target: card.id,
    };
  }
  if (party.levelAfter > party.levelBefore) {
    const title = titleFor(party.levelAfter);
    return {
      kind: 'level',
      moment: {
        level: { level: party.levelAfter, title }, title: `Level ${party.levelAfter} · ${title}`,
        detail: 'Collector on Figmark', headline: 'Level up!',
      },
      link: { to: 'invite' },
      caption: `Just hit level ${party.levelAfter} (${title}) on Figmark ⭐ Come play - pre-orders, card packs and quests.`,
      target: String(party.levelAfter),
    };
  }
  return null;
}

const RARITY_LABELS_CARD: Record<CardRarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

function CelebrationModal({ party, onClose }: { party: Celebration; onClose: () => void }) {
  const { view } = useQuest();
  const { open, sheet } = useShareSheet();
  const spec = celebrationSpec(party, view);
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setFlipped(true), 350);
    return () => window.clearTimeout(timer);
  }, [party.run]);
  const levelled = party.levelAfter > party.levelBefore;

  return (
    <Modal title={party.title} onClose={onClose}>
      <div className="qparty">
        <Confetti run={party.run} />
        {party.card && (
          <div className={`qflip${flipped ? ' is-flipped' : ''}`}>
            <div className="qflip__inner">
              <div className="qflip__back" aria-hidden="true"><span>?</span></div>
              <div className="qflip__front"><CardFace card={party.card} /></div>
            </div>
          </div>
        )}
        {party.card && (
          <p className="qparty__line">
            <span className={`qrarity qrarity--${party.card.rarity}`}>{party.card.rarity}</span>{' '}
            {party.card.name} · {setName(party.card.set)}
          </p>
        )}
        {levelled && (
          <div className="qparty__level">
            <LevelRing level={party.levelAfter} progress={0} size={84} />
            <p>
              You reached <b>level {party.levelAfter}</b>. A new pack is waiting on your Quests page.
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

export function setName(setId: string): string {
  return CARD_SETS.find((set) => set.id === setId)?.name ?? setId;
}

/* ── Marks ─────────────────────────────────────────────────────────────── */

/** A level in a ring that fills as the level does. */
export function LevelRing({ level, progress, size = 40 }: { level: number; progress: number; size?: number }) {
  const stroke = Math.max(3, Math.round(size / 11));
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <span className="qring" style={{ width: size, height: size }} aria-label={`Level ${level}`}>
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
        <small>{view.title}</small>
        <span>{view.xp - view.levelFloor}/{view.nextLevelXp - view.levelFloor} XP</span>
      </span>
      {gain ? <em className={`qchip__gain${gain.xp < 0 ? ' qchip__gain--loss' : ''}`}>{gain.xp > 0 ? `+${gain.xp}` : `−${-gain.xp}`} XP</em> : null}
    </Link>
  );
}

/** The first shop you run, as the same chip: its level and XP, one tap from its quests. */
export function StoreChip() {
  const [shop, setShop] = useState<{ id: string; name: string; level: Awaited<ReturnType<typeof api.growth>>['level'] } | null>(null);
  useEffect(() => {
    let live = true;
    void api.stores().then(async ({ stores }) => {
      const first = stores[0];
      if (!first) return;
      const board = await api.growth(first.ownerId);
      if (live) setShop({ id: first.ownerId, name: board.name, level: board.level });
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!shop) return null;
  const { level } = shop;
  return (
    <Link to={`/quests?shop=${encodeURIComponent(shop.id)}`} className="qchip qchip--store"
      aria-label={`${shop.name}: level ${level.level} ${level.title}, open shop quests`}>
      <LevelRing level={level.level} progress={level.progress} size={30} />
      <span className="qchip__text">
        <small>{shop.name}</small>
        <span>{level.points.toLocaleString('en-IN')}{level.next === null ? '' : `/${level.next.toLocaleString('en-IN')}`} XP</span>
      </span>
    </Link>
  );
}

/* ── Glyphs ────────────────────────────────────────────────────────────── */

export type GlyphName = CardDef['glyph'] | StickerView['glyph'] | 'clock' | 'crown' | 'gift';

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
    case 'mech':
      return <svg {...common}><g fill="currentColor"><rect x="9" y="2" width="6" height="5" rx="1.2" /><rect x="7" y="8" width="10" height="7" rx="1.4" /><rect x="3.5" y="8.5" width="3" height="7" rx="1.2" /><rect x="17.5" y="8.5" width="3" height="7" rx="1.2" /><rect x="8" y="16" width="3" height="6" rx="1" /><rect x="13" y="16" width="3" height="6" rx="1" /></g></svg>;
    case 'beast':
      return <svg {...common}><path fill="currentColor" d="M4 20c1-4.5 3.5-7.5 6.5-8.5-1.5-2-1.5-4.5 0-6.5.5 2 2 3 3.5 3 2.5 0 4.5 1.5 5 4l2-1-1 3c-.5 3-3 5.5-6.5 6Z" /></svg>;
    case 'card':
      return <svg {...common}><g stroke="currentColor" strokeWidth="1.8" fill="none"><rect x="4" y="5" width="10" height="15" rx="1.6" transform="rotate(-10 9 12)" /><rect x="10" y="4" width="10" height="15" rx="1.6" fill="currentColor" fillOpacity=".35" /></g></svg>;
    case 'shoe':
      return <svg {...common}><path fill="currentColor" d="M2.5 15.5c0-2.5 1-5.8 2.5-7.3l3 1.5c1.5.7 3 .2 4-1l2.5 2.5c2 1.5 5.5 2 7.5 3 1 .5 1.5 1.5 1.5 2.5v1.5h-21Z" /></svg>;
    case 'box':
    default:
      return <svg {...common}><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" /><path d="m4 8.5 8 4.5 8-4.5M12 13v7" /></g></svg>;
  }
}

/* ── Cards and stickers ────────────────────────────────────────────────── */

/** One collectible card, face up. Tapping it opens what it is. */
export function CardFace({ card, size = 'md', copies, onOpen }: {
  card: CardDef;
  size?: 'sm' | 'md';
  copies?: number;
  onOpen?: () => void;
}) {
  const set = CARD_SETS.find((entry) => entry.id === card.set);
  const face = (
    <>
      <span className="qcardface__rarity">{card.rarity}</span>
      <span className="qcardface__art"><Glyph name={card.glyph} size={size === 'sm' ? 30 : 56} /></span>
      <span className="qcardface__name">{card.name}</span>
      <span className="qcardface__set">{set?.name ?? card.set}</span>
      {copies && copies > 1 ? <span className="qcardface__copies">×{copies}</span> : null}
    </>
  );
  const className = `qcardface qcardface--${card.rarity} qcardface--${size} qhue--${set?.hue ?? 'violet'}`;
  return onOpen ? (
    <button type="button" className={`${className} qcardface--tap`} onClick={onOpen} aria-label={`${card.name}, ${card.rarity}`}>
      {face}
    </button>
  ) : (
    <div className={className}>{face}</div>
  );
}

/** An empty slot in a set, for a card not pulled yet. */
export function CardSlot() {
  return <div className="qcardslot" aria-label="Not collected yet">?</div>;
}

/** A sticker as a hexagon with its tier as the rim colour. Tapping it explains it. */
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
 * A card or sticker on a turntable. It spins in when opened; a tap spins it
 * once more; a drag turns it under the finger and lets go into a spin that
 * comes to rest face up. One element throughout, so it never blinks.
 */
export function Spin({ spinKey, children, back }: {
  /** Changes when the thing shown changes, which spins it in again. */
  spinKey: string;
  children: ReactNode;
  /** What shows when it is turned away: a card's back. Without one it shows through. */
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

/** What a sticker means, how to earn it, and how far along its tiers somebody is. */
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
            : `${Math.min(sticker.have, sticker.next)} of ${sticker.next} towards ${sticker.tiers.length > 1 ? STICKER_TIER_NAMES[Math.min(3, sticker.tier + 1)] : 'this sticker'}.`}
        </p>
        <XpBar progress={sticker.next === null ? 1 : sticker.have / sticker.next} tone="gold" />
        <p className="faint qsheet__note">Stickers show on the page, so anybody deciding whether to deal with them can see them.</p>
      </div>
    </Modal>
  );
}

/** What a card is, how rare, and what collecting its set is worth. */
export function CardSheet({ card, copies, setOwned, onClose }: {
  card: CardDef;
  copies: number;
  /** How many of the six in its set are owned. */
  setOwned: number;
  onClose: () => void;
}) {
  const total = Object.values(CARD_ODDS).reduce((sum, weight) => sum + weight, 0);
  return (
    <Modal title={card.name} onClose={onClose}>
      <div className="qsheet">
        <Spin spinKey={card.id} back={<span className={`qcardback qcardface--${card.rarity}`}><Glyph name="crest" size={44} /></span>}>
          <CardFace card={card} />
        </Spin>
        <p className="qsheet__lore">&ldquo;{card.lore}&rdquo;</p>
        <p className="qsheet__state">
          <span className={`qrarity qrarity--${card.rarity}`}>{card.rarity}</span>{' '}
          {setName(card.set)} · {copies > 0 ? `you have ${copies}` : 'not collected'}
        </p>
        <section className="qsheet__block">
          <h4>How rare</h4>
          <p>A {card.rarity} card comes out of {Math.round((CARD_ODDS[card.rarity] / total) * 100)}% of ordinary packs, and is worth {CARD_XP[card.rarity]} XP when pulled.</p>
        </section>
        <section className="qsheet__block">
          <h4>Its set</h4>
          <p>{setOwned}/6 of {setName(card.set)} collected. Finish the set for {SET_BONUS_XP} XP and the {setName(card.set)} Master sticker.</p>
        </section>
        <section className="qsheet__block">
          <h4>Where cards come from</h4>
          <p>The daily Reveal, a pack for every level you reach (epic or better every fifth level), and a pack for every milestone you collect.</p>
        </section>
      </div>
    </Modal>
  );
}

type Opened = { kind: 'card'; card: CardDef & { copies?: number } } | { kind: 'sticker'; sticker: StickerView } | null;

/**
 * Every card and every sticker, in one sheet.
 *
 * Opened from a profile's showcase. Cards are laid out set by set with gaps
 * for the ones still missing, so it reads as a binder being filled.
 */
export function ShowcaseModal({ cards, stickers, whose, onClose, start = 'cards' }: {
  cards: (CardDef & { copies?: number })[];
  stickers: StickerView[];
  whose: 'mine' | 'theirs';
  onClose: () => void;
  start?: 'cards' | 'stickers';
}) {
  const [tab, setTab] = useState<'cards' | 'stickers'>(start);
  const [opened, setOpened] = useState<Opened>(null);
  const copiesOf = (id: string) => cards.filter((card) => card.id === id).reduce((sum, card) => sum + (card.copies ?? 1), 0);
  const ownedIn = (setId: string) => new Set(cards.filter((card) => card.set === setId).map((card) => card.id)).size;

  const sortedStickers = [...stickers].sort((a, b) => b.tier - a.tier);

  if (opened?.kind === 'card') {
    const card = opened.card;
    return <CardSheet card={card} copies={copiesOf(card.id)} setOwned={ownedIn(card.set)} onClose={() => setOpened(null)} />;
  }
  if (opened?.kind === 'sticker') {
    const sticker = opened.sticker;
    return <StickerSheet sticker={sticker} whose={whose} onClose={() => setOpened(null)} />;
  }

  return (
    <Modal title="Showcase" onClose={onClose}>
      <div className="tabs qtabs">
        <button type="button" className={`tab${tab === 'cards' ? ' is-on' : ''}`} onClick={() => setTab('cards')}>
          Cards {new Set(cards.map((card) => card.id)).size}/{CARDS.length}
        </button>
        <button type="button" className={`tab${tab === 'stickers' ? ' is-on' : ''}`} onClick={() => setTab('stickers')}>
          Stickers {stickers.filter((sticker) => sticker.earned).length}/{stickers.length}
        </button>
      </div>
      {tab === 'cards' ? (
        <div className="stack qsheet__scroll">
          <p className="faint" style={{ margin: 0 }}>
            Cards come from the daily Reveal, level-ups and milestones. Finish a set for {SET_BONUS_XP} XP and its Master sticker. Tap a card to read it.
          </p>
          {CARD_SETS.map((set) => (
            <div key={set.id} className="qset">
              <div className="qset__head">
                <b>{set.name}</b>
                <span className={ownedIn(set.id) === 6 ? 'qok' : 'faint'}>{ownedIn(set.id)}/6{ownedIn(set.id) === 6 ? ' · complete' : ''}</span>
              </div>
              <div className="qset__cards">
                {CARDS.filter((card) => card.set === set.id).map((card) => (
                  copiesOf(card.id) > 0
                    ? <CardFace key={card.id} card={card} size="sm" copies={copiesOf(card.id)} onOpen={() => setOpened({ kind: 'card', card })} />
                    : <CardSlot key={card.id} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="stack qsheet__scroll">
          <p className="faint" style={{ margin: 0 }}>
            Stickers are earned by what somebody actually does - buying, reviewing, backing pre-orders, trading cleanly. Bronze, silver and gold show how far. Tap one to see what it means.
          </p>
          <div className="qstickers">
            {sortedStickers.map((sticker) => (
              <Sticker key={sticker.id} sticker={sticker} onOpen={() => setOpened({ kind: 'sticker', sticker })} />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
