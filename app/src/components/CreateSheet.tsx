import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Post } from '@shared/models';
import type { SocialIdentity } from '@shared/social';
import type { StoreAccess } from '@shared/stores';
import { api } from '../api';
import { useSession } from '../session';
import { VoiceScope, remembered } from './SocialVoice';
import type { StudioMode } from './PostStudio';
import { Loading } from './Feedback';

/*
 * The studio arrives with the first tap on one of its kinds, as every screen
 * does (see main.tsx): most people who open this sheet are listing something,
 * and should not wait on a photo tagger to do it.
 */
const PostStudio = lazy(() => import('./PostStudio').then((module) => ({ default: module.PostStudio })));
/** The quick post - "What's new?" - the same box as on top of the Social feed. */
const Composer = lazy(() => import('./SocialComposer').then((module) => ({ default: module.Composer })));

interface Action {
  id: string;
  emoji: string;
  title: string;
  line: string;
  /** Opens the studio in this mode... */
  studio?: StudioMode;
  presets?: { stock?: boolean; prize?: boolean };
  /** ...or goes somewhere that already makes it. */
  to?: (store: StoreAccess | null) => string;
  hue: 'aqua' | 'coral' | 'violet' | 'pink' | 'blue' | 'lime' | 'gold';
  /** Marked as a Pro tool. */
  pro?: boolean;
}

/** What a person can put up. */
const YOU: Action[] = [
  { id: 'photo', emoji: '📸', title: 'Photo or collection flex', line: 'Photos, with every piece tagged if you like.', studio: 'photo', hue: 'violet' },
  { id: 'poll', emoji: '📊', title: 'Poll', line: 'Text, photos, versus or a star rating.', studio: 'poll', hue: 'aqua' },
  { id: 'debate', emoji: '⚔️', title: 'Debate', line: 'Two sides. Arguments land on yours.', studio: 'debate', hue: 'pink' },
  { id: 'iso', emoji: '🔎', title: 'Post an ISO request', line: 'Say what you hunt. Sellers who stock it hear.', to: () => '/social?view=wanted&ask=1', hue: 'coral' },
];

const storeQuery = (store: StoreAccess | null) => (store && !store.isOwner ? `?store=${encodeURIComponent(store.ownerId)}` : '');

/**
 * What a shop can do, in two groups: sell, and get people playing. The games
 * with prizes and the guess are a shop's - the credit is spent there, and the
 * price being guessed is its own.
 */
const STORE: { label: string; actions: Action[] }[] = [
  {
    label: 'Sell',
    actions: [
      { id: 'slist', emoji: '🛍️', title: 'List an item', line: 'Price, condition, photos and shipping.', to: (store) => `/sell${storeQuery(store)}`, hue: 'blue' },
      { id: 'spreorder', emoji: '📅', title: 'Pre-order', line: 'Take bookings first; order once enough are in.',
        to: (store) => `/sell${storeQuery(store) ? `${storeQuery(store)}&` : '?'}preorder=1`, hue: 'violet' },
      { id: 'power', emoji: '⚡', title: 'Power sale', line: 'A run of drops on a timer, in your channel.', pro: true,
        to: (store) => `/shop/power-sale?store=${encodeURIComponent(store!.ownerId)}`, hue: 'gold' },
      { id: 'announce', emoji: '📣', title: 'Announcement', line: 'To your channel, for your followers.', to: (store) => `/social/c/${encodeURIComponent(store!.ownerId)}`, hue: 'coral' },
    ],
  },
  {
    label: 'Get people playing',
    actions: [
      { id: 'contest', emoji: '🏆', title: 'Photo competition', line: 'You set prizes; the audience or you pick.', studio: 'contest', hue: 'lime' },
      { id: 'sguess', emoji: '🎯', title: 'Guess the price', line: 'Sealed until the reveal. Closest wins.', studio: 'guess', hue: 'violet' },
      { id: 'spoll', emoji: '📊', title: 'Store poll', line: 'Reward whoever picks the winner, if you like.', studio: 'poll', hue: 'aqua' },
      { id: 'stock', emoji: '📦', title: 'What should we stock next?', line: 'Results land in your Store Console.', studio: 'poll', presets: { stock: true }, hue: 'lime' },
      { id: 'sdebate', emoji: '🎤', title: 'Debate with a prize', line: 'Store credit for the best argument.', studio: 'debate', presets: { prize: true }, hue: 'pink' },
    ],
  },
];

/** Each list's rows come in one after another, this far apart, so the eye reads them in order. */
const STAGGER_MS = 35;

/**
 * What the + in the middle of the tab bar opens: every way to put something
 * up, in one place - split between what you post as yourself and what you
 * run as your shop, because a prize is the shop's to give.
 *
 * Listing and asking already had homes - the sell form and the ISO board - so
 * those go there. Everything else is made right here, in the studio, over
 * whatever page you were on, and lands you on the post once it is up.
 */
export function CreateSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const [making, setMaking] = useState<{ action: Action; store: StoreAccess | null } | null>(null);
  const [stores, setStores] = useState<StoreAccess[]>([]);
  const [storeAt, setStoreAt] = useState(0);
  const [side, setSide] = useState<'you' | 'store'>('you');
  const first = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    api.stores()
      .then((result) => {
        if (!live) return;
        const mine = result.stores.filter((store) => store.permissions.includes('posts'));
        setStores(mine);
        // Opens as whoever you are posting as elsewhere: switched to the shop
        // in a thread, you are still the shop here.
        const at = mine.findIndex((store) => store.ownerId === remembered());
        if (at >= 0) {
          setStoreAt(at);
          setSide('store');
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user]);

  useEffect(() => {
    if (making) return;
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [making, onClose]);

  // The page behind stays put but cannot be tapped or tabbed to while the
  // chooser is up; the studio that follows is a modal of its own.
  useEffect(() => {
    if (making) return;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => root?.removeAttribute('inert');
  }, [making]);

  const store = stores[storeAt] ?? null;

  function pick(action: Action, as: StoreAccess | null) {
    if (action.studio) {
      setMaking({ action, store: as });
      return;
    }
    // Closed here as well as by the move: from the page it goes to, there is no move.
    onClose();
    navigate(action.to!(as));
  }

  const posted = (post: Pick<Post, 'channelId' | 'id'>) => {
    onClose();
    navigate(`/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`);
  };

  if (making) {
    return (
      <Suspense fallback={createPortal(<div className="csheet"><Loading /></div>, document.body)}>
        <PostStudio mode={making.action.studio!} storeId={making.store?.ownerId ?? null} storeName={making.store?.name ?? null}
          presets={making.action.presets} onClose={onClose} onPosted={posted} />
      </Suspense>
    );
  }

  const groups = side === 'store' && store ? STORE : [{ label: '', actions: YOU }];
  // Whoever the side is, the quick post speaks as it: you, or the store picked.
  const voice: SocialIdentity = side === 'store' && store
    ? { storeId: store.ownerId, name: store.name, handle: store.handle ?? null }
    : { storeId: null, name: user?.displayName ?? 'Me', handle: user?.username ?? null };
  const quickPosted = () => {
    onClose();
    navigate('/social');
  };
  let order = 0;

  return createPortal(
    <div className="csheet" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="csheet__box" role="dialog" aria-modal="true" aria-labelledby="csheet-title">
        <span className="csheet__grip" aria-hidden="true" />
        <h2 id="csheet-title" className="csheet__title">What would you like to make?</h2>

        {stores.length > 0 && (
          <div className="csheet__sides" role="tablist" aria-label="Post as">
            <button type="button" role="tab" aria-selected={side === 'you'} className={`csheet__side${side === 'you' ? ' is-on' : ''}`}
              onClick={() => setSide('you')}>
              You
            </button>
            <button type="button" role="tab" aria-selected={side === 'store'} className={`csheet__side${side === 'store' ? ' is-on' : ''}`}
              onClick={() => setSide('store')}>
              {stores.length === 1 ? store?.name : 'Your store'}
            </button>
            <span className={`csheet__thumb csheet__thumb--${side}`} aria-hidden="true" />
          </div>
        )}

        {side === 'store' && stores.length > 1 && (
          <div className="chips chips--tight csheet__stores" role="radiogroup" aria-label="Which store">
            {stores.map((entry, index) => (
              <button key={entry.ownerId} type="button" role="radio" aria-checked={index === storeAt}
                className={`chip${index === storeAt ? ' is-on' : ''}`} onClick={() => setStoreAt(index)}>
                {entry.name}
              </button>
            ))}
          </div>
        )}

        <div className="csheet__list" key={`${side}:${voice.storeId ?? ''}`}>
          {user && (
            <Suspense fallback={null}>
              <VoiceScope voice={voice} voices={[voice]} choose={() => undefined}>
                <div className="csheet__quick"><Composer onPosted={quickPosted} /></div>
              </VoiceScope>
            </Suspense>
          )}
          {groups.map((group) => (
            <section key={group.label || 'you'} className="csheet__group" aria-label={group.label || undefined}>
              {group.label && <h3 className="csheet__label">{group.label}</h3>}
              {group.actions.map((action) => {
                const at = order++;
                return (
                  <button key={action.id} ref={at === 0 ? first : undefined} type="button"
                    className={`csheet__item csheet__item--${action.hue}`} style={{ animationDelay: `${at * STAGGER_MS}ms` }}
                    onClick={() => pick(action, side === 'store' ? store : null)}>
                    <span className="csheet__emoji" aria-hidden="true">{action.emoji}</span>
                    <span className="csheet__text">
                      <strong>{action.title}{action.pro && <span className="probadge csheet__pro">PRO</span>}</strong>
                      <span>{action.line}</span>
                    </span>
                    <svg className="csheet__chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
        <button type="button" className="csheet__cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body,
  );
}
