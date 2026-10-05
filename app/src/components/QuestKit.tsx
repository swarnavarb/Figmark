import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BUMPS_FOR } from '@shared/quest';
import { ApiRequestError, api } from '../api';
import { Glyph, LevelRing, XpBar } from './Quest';

/**
 * The parts both quest boards are built from - a person's and a shop's - so
 * the two read as one game: the same hero, the same bump wallet, the same
 * rows and the same ⓘ buttons. Explanations live behind those buttons rather
 * than in paragraphs, so the board stays a list of things to do.
 */

/** A small ⓘ that opens a note beside it. Escape, a tap elsewhere or scrolling closes it. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const id = useId();

  // Fixed to the viewport so a panel with overflow hidden cannot clip it.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - 16 - width);
    setAt({ top: rect.bottom + 8, left, width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!bubble.current?.contains(target) && !button.current?.contains(target)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button ref={button} type="button" className={`qinfo${open ? ' is-on' : ''}`} aria-label={label}
        aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
        i
      </button>
      {open && at && (
        <div ref={bubble} id={id} role="note" className="qinfo__bubble" style={{ top: at.top, left: at.left, width: at.width }}>
          {children}
        </div>
      )}
    </>
  );
}

/** What bump points are and how they are earned - the same note wherever Bump is. */
export function BumpHelp() {
  return (
    <>
      <b>Bump points</b>
      <p>One bump point puts one live item back at the top of the feed. Bump on the item's page and Bump on the shop's quest board both spend one.</p>
      <p>
        Earn them from quests, yours and your shop's: every <b>weekly</b> quest pays {BUMPS_FOR.weekly} and every <b>monthly</b> quest
        pays {BUMPS_FOR.monthly}. Daily quests, milestones and shop upkeep pay XP only.
      </p>
      <p>The shop's points are spent first, then your own. Everybody who runs a shop shares its points.</p>
    </>
  );
}

/** The wallet beside the level: how many bumps are saved up, with what they are behind the ⓘ. */
export function BumpWallet({ count }: { count: number }) {
  return (
    <div className={`qbump${count === 0 ? ' is-empty' : ''}`}>
      <span className="qbump__icon" aria-hidden="true"><Glyph name="bolt" size={18} /></span>
      <span className="qbump__count"><b>{count}</b><small>{count === 1 ? 'bump point' : 'bump points'}</small></span>
      <InfoTip label="What bump points are"><BumpHelp /></InfoTip>
    </div>
  );
}

export function QuestHero({ eyebrow, title, level, progress, xp, toNext, nextLevel, bumps, side, info }: {
  eyebrow: string;
  title: string;
  level: number;
  progress: number;
  xp: number;
  /** XP still needed, or null at the top level. */
  toNext: number | null;
  nextLevel: number;
  bumps: number;
  side: 'you' | 'shop';
  info: ReactNode;
}) {
  return (
    <section className={`qhero qhero--${side}`}>
      <LevelRing level={level} progress={progress} size={84} />
      <div className="qhero__body">
        <p className="qhero__eyebrow">{eyebrow}</p>
        <h2 className="qhero__title">{title} <InfoTip label="How XP and levels work">{info}</InfoTip></h2>
        <p className="qhero__xp">
          <b>{xp.toLocaleString('en-IN')} XP</b>
          {toNext !== null && <> · {toNext.toLocaleString('en-IN')} to level {nextLevel}</>}
        </p>
        <XpBar progress={progress} />
      </div>
      <BumpWallet count={bumps} />
    </section>
  );
}

export type BoardKind = 'daily' | 'weekly' | 'monthly' | 'milestone';
const KIND_LABELS: Record<BoardKind, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', milestone: 'Milestones' };

export function QuestTabs({ tab, onTab, ready }: { tab: BoardKind; onTab: (kind: BoardKind) => void; ready: (kind: BoardKind) => number }) {
  return (
    <div className="tabs qtabs" role="tablist">
      {(['daily', 'weekly', 'monthly', 'milestone'] as const).map((kind) => (
        <button key={kind} type="button" role="tab" aria-selected={tab === kind} className={`tab${tab === kind ? ' is-on' : ''}`} onClick={() => onTab(kind)}>
          {KIND_LABELS[kind]}
          {ready(kind) > 0 && <span className="qdot">{ready(kind)}</span>}
        </button>
      ))}
    </div>
  );
}

/** One quest, the same shape on either board. */
export function QuestRow({ title, blurb, tag, step, progress, goal, count, xp, bumps, pack, claimed, claimable, busy, onClaim, action }: {
  title: string;
  blurb: string;
  /** The area a shop quest belongs to. */
  tag?: { area: string; label: string } | null;
  step?: { index: number; of: number };
  progress: number;
  goal: number;
  /** How the progress reads, when "3/5" is not it. */
  count?: string;
  xp: number;
  bumps: number;
  pack?: boolean;
  claimed: boolean;
  claimable: boolean;
  busy?: boolean;
  onClaim: () => void;
  /** What to press to get on with it. */
  action?: ReactNode;
}) {
  return (
    <li className={`qtask${claimed ? ' is-claimed' : ''}${claimable ? ' is-ready' : ''}`}>
      <span className="qtask__body">
        <span className="qtask__head">
          <b>{title}</b>
          {step && step.of > 1 && <span className="qtask__step">{step.index}/{step.of}</span>}
          {tag && <span className={`qtag qtag--${tag.area}`}>{tag.label}</span>}
          <InfoTip label={`About ${title}`}>{blurb}</InfoTip>
        </span>
        <span className="qtask__progress">
          <XpBar progress={goal > 0 ? progress / goal : 0} tone={claimable || claimed ? 'gold' : 'violet'} />
          <span className="qtask__count">{count ?? `${progress}/${goal}`}</span>
        </span>
        <span className="qtask__pay">
          <span className="qpay">+{xp} XP</span>
          {bumps > 0 && <span className="qpay qpay--bump"><Glyph name="bolt" size={11} />+{bumps}</span>}
          {pack && <span className="qpay qpay--pack"><Glyph name="gift" size={11} />pack</span>}
        </span>
      </span>
      <span className="qtask__act">
        {claimed ? <span className="qok">✓</span>
          : claimable ? (
            <button type="button" className="btn btn--sm qbtn-gold" disabled={busy} onClick={onClaim}>Claim</button>
          ) : action}
      </span>
    </li>
  );
}

/** The board's own header line: a title, its ⓘ, and anything to press for the whole board. */
export function BoardHead({ info, children }: { info: ReactNode; children?: ReactNode }) {
  return (
    <div className="qarcade__head">
      <span className="qarcade__title"><Glyph name="shield" size={14} /> Quest board</span>
      <InfoTip label="How the quest board works">{info}</InfoTip>
      <span className="qbar__spacer" />
      {children}
    </div>
  );
}

/** A slim strip: a few numbers and two buttons, with the long story behind the ⓘ. */
export function InviteStrip({ title, stats, actions, info }: {
  title: string;
  stats: { value: number; label: string }[];
  actions: ReactNode;
  info: ReactNode;
}) {
  return (
    <section className="qstrip" id="invite">
      <span className="qstrip__title"><Glyph name="gift" size={15} /> {title} <InfoTip label={`About ${title}`}>{info}</InfoTip></span>
      {stats.length > 0 && (
        <span className="qstrip__stats">
          {stats.map((stat) => <span key={stat.label}><b>{stat.value.toLocaleString('en-IN')}</b> {stat.label}</span>)}
        </span>
      )}
      <span className="qstrip__acts">{actions}</span>
    </section>
  );
}

/** Shown on Quests after a Bump found no points to spend. */
export function NoBumpsNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="qnobump" role="alert">
      <span className="qnobump__face" aria-hidden="true">😞</span>
      <span className="qnobump__text">
        <b>No bump points left</b>
        <small>That Bump didn't go through. Finish a weekly or monthly quest below to earn more, then try again.</small>
      </span>
      <button type="button" className="qnobump__x" aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  );
}

/**
 * Bumping an item, from anywhere it is offered. Out of points, it goes to the
 * shop's quests, which earn more.
 */
export function useBump() {
  const navigate = useNavigate();
  return useCallback(async (listing: { id: string; sellerId: string }): Promise<{ bumps: number } | null> => {
    try {
      const result = await api.bump(listing.id);
      return { bumps: result.bumps };
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'no_bumps') {
        navigate(`/quests?shop=${encodeURIComponent(listing.sellerId)}&nobump=1`);
        return null;
      }
      throw err;
    }
  }, [navigate]);
}
