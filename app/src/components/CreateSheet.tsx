import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SkelRows } from './PageSkeletons';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Post } from '@shared/models';
import type { SocialIdentity } from '@shared/social';
import type { StoreAccess } from '@shared/stores';
import { api, type ServiceStoreRole } from '../api';
import { useSession } from '../session';
import { VoiceScope, remembered } from './SocialVoice';
import type { StudioMode } from './PostStudio';
import { reducedMotion } from '../motion';
import { Velocity } from '../spring';


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
  { id: 'photo', emoji: '📸', title: 'Photo tag', line: 'Share a photo, tag every piece.', studio: 'photo', hue: 'violet' },
  { id: 'poll', emoji: '📊', title: 'Poll', line: 'Text, photos, versus or stars.', studio: 'poll', hue: 'aqua' },
  { id: 'debate', emoji: '⚔️', title: 'Debate', line: 'Two sides. Pick yours.', studio: 'debate', hue: 'pink' },
  { id: 'question', emoji: '❓', title: 'Ask a question', line: 'Legit? Bootleg? What is it?', studio: 'question', hue: 'blue' },
  { id: 'compare', emoji: '🎨', title: 'Before & after', line: 'Drag a line from one to the other.', studio: 'compare', hue: 'lime' },
  { id: 'iso', emoji: '🔎', title: 'Post a want', line: 'Sellers who stock it hear.', to: () => '/social?view=wanted&ask=1', hue: 'coral' },
];

/** What a freight forwarder or artist can put up: posts here, the rest from its dashboard. */
function serviceActions(store: ServiceStoreRole): { label: string; actions: Action[] }[] {
  const desk = `/services/store/${store.kind}/${store.ownerId}`;
  const forwarder = store.kind === 'forwarder';
  return [
    {
      label: 'Post',
      actions: [
        { id: 'vphoto', emoji: '📸', title: 'Photo tag', line: forwarder ? 'A shipment landing, a full warehouse, a new route.' : 'A finished piece, work in progress.', studio: 'photo', hue: 'violet' },
        { id: 'vcompare', emoji: '🎨', title: 'Before & after', line: 'Two photos, side by side.', studio: 'compare', hue: 'pink' },
        { id: 'vpoll', emoji: '📊', title: 'Poll', line: forwarder ? 'Which route should we open next?' : 'Which piece should we paint next?', studio: 'poll', hue: 'aqua' },
        { id: 'vannounce', emoji: '📣', title: 'Message your channel', line: 'Cut-offs, delays, news for followers.', to: () => `/services/${store.kind}/${store.slug}?tab=channel`, hue: 'coral' },
      ],
    },
    {
      label: 'Work',
      actions: [
        { id: 'vlink', emoji: '🔗', title: 'Payment link', line: 'A price for a custom job, sent as a link.', to: () => `${desk}?tab=requests&link=1`, hue: 'lime' },
        { id: 'vedit', emoji: forwarder ? '🗺️' : '🖌️', title: forwarder ? 'Routes & prices' : 'Menu & prices', line: 'Change what you offer and charge.', to: () => `${desk}?tab=store`, hue: 'blue' },
        { id: 'vinsights', emoji: '📈', title: 'Insights', line: 'Customers, routes and trends.', to: () => `${desk}?tab=insights`, hue: 'gold' },
      ],
    },
  ];
}

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
      { id: 'power', emoji: '⚡', title: 'Live drop', line: 'A run of drops on a timer, in your channel.', pro: true,
        to: (store) => `/shop/power-sale?store=${encodeURIComponent(store!.ownerId)}`, hue: 'gold' },
      { id: 'announce', emoji: '📣', title: 'Announcement', line: 'To your channel, for your followers.', to: (store) => `/social/c/${encodeURIComponent(store!.ownerId)}`, hue: 'coral' },
    ],
  },
  {
    label: 'Get people playing',
    actions: [
      { id: 'contest', emoji: '🏆', title: 'Photo competition', line: 'You set prizes; they or you pick.', studio: 'contest', hue: 'gold' },
      { id: 'sguess', emoji: '🎯', title: 'Guess the price', line: 'Sealed till the reveal. Closest wins.', studio: 'guess', hue: 'violet' },
      { id: 'spoll', emoji: '📊', title: 'Store poll', line: 'Reward whoever picks the winner.', studio: 'poll', hue: 'aqua' },
      { id: 'stock', emoji: '📦', title: 'Stock next?', line: 'Results land in your Store Console.', studio: 'poll', presets: { stock: true }, hue: 'lime' },
      { id: 'sdebate', emoji: '🎤', title: 'Debate with a prize', line: 'Store credit for the best argument.', studio: 'debate', presets: { prize: true }, hue: 'pink' },
      { id: 'squestion', emoji: '❓', title: 'Ask your buyers', line: 'One question, open answers.', studio: 'question', hue: 'blue' },
      { id: 'sspread', emoji: '📣', title: 'Spread the word', line: 'Credit for every new buyer they bring.', studio: 'spread', hue: 'gold' },
    ],
  },
  {
    label: 'Show off',
    actions: [
      { id: 'sphoto', emoji: '📸', title: 'Photo tag', line: 'New arrivals, a full shelf, an unboxing.', studio: 'photo', hue: 'violet' },
      { id: 'scompare', emoji: '🎨', title: 'Before & after', line: 'A restore, a repaint, a glow-up.', studio: 'compare', hue: 'pink' },
    ],
  },
];

/** Each list's rows come in one after another, this far apart, so the eye reads them in order. */
const STAGGER_MS = 28;

/**
 * What the + in the middle of the tab bar opens: every way to put something
 * up, in one place - split between what you post as yourself and what you
 * run as your shop, because a prize is the shop's to give.
 *
 * Listing and asking already had homes - the sell form and the ISO board - so
 * those go there. Everything else is made right here, in the studio, over
 * whatever page you were on, and lands you on the post once it is up.
 */
/**
 * Pull the sheet down to put it away, the way a phone's own sheets go.
 *
 * Grabbed by its top (the grip and the title, never the list, which scrolls),
 * it follows the finger 1:1; pulled up it resists, a fifth as far. Let go past
 * a third of its height, or flicked down faster than 0.11 px/ms, it slides out
 * and closes; otherwise it springs back. Moves are written straight to the
 * element's style, so a drag never re-renders the sheet.
 */
function useDragToClose(onClose: () => void) {
  const box = useRef<HTMLDivElement>(null);
  const held = useRef<{ y: number; height: number; id: number } | null>(null);
  const speed = useRef(new Velocity());

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    const el = box.current;
    if (!el || event.button !== 0 || (event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    const top = el.getBoundingClientRect().top;
    // Only the top of the sheet: the grip and the title above the choices.
    const head = el.querySelector('.csheet__head');
    const limit = head ? head.getBoundingClientRect().bottom : top + 56;
    if (event.clientY > limit) return;
    held.current = { y: event.clientY, height: el.offsetHeight, id: event.pointerId };
    speed.current.reset(0, event.timeStamp);
    // The entrance animation holds transform while it runs: let go of it.
    el.style.animation = 'none';
    el.style.transition = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const grip = held.current;
    const el = box.current;
    if (!grip || !el || event.pointerId !== grip.id) return;
    const dy = event.clientY - grip.y;
    speed.current.track(dy, event.timeStamp);
    const shown = dy < 0 ? dy * 0.2 : dy;
    el.style.transform = `translateY(${shown}px)`;
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const grip = held.current;
    const el = box.current;
    held.current = null;
    if (!grip || !el) return;
    const dy = event.clientY - grip.y;
    const fling = speed.current.at(event.timeStamp);
    if (dy > 0 && (dy > grip.height * 0.3 || fling > 0.11)) {
      if (reducedMotion()) {
        onClose();
        return;
      }
      el.style.transition = 'transform 240ms var(--ease-out)';
      el.style.transform = 'translateY(100%)';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        onClose();
      };
      el.addEventListener('transitionend', finish, { once: true });
      window.setTimeout(finish, 320);
      return;
    }
    el.style.transition = 'transform var(--spring-snappy-dur) var(--spring-snappy)';
    el.style.transform = '';
  }

  return { box, handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } };
}

export function CreateSheet({ onClose }: { onClose: () => void }) {
  const drag = useDragToClose(onClose);
  const navigate = useNavigate();
  const { user } = useSession();
  const [making, setMaking] = useState<{ action: Action; storeId: string | null; storeName: string | null } | null>(null);
  const [shops, setShops] = useState<StoreAccess[]>([]);
  const [services, setServices] = useState<ServiceStoreRole[]>([]);
  const [storeAt, setStoreAt] = useState(0);
  const [side, setSide] = useState<'you' | 'store'>('you');
  const first = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void Promise.all([
      api.stores().then((result) => result.stores.filter((store) => store.permissions.includes('posts'))).catch(() => [] as StoreAccess[]),
      api.myServiceStores().then((result) => result.stores.filter((row) => row.live && row.rights.includes('voice'))).catch(() => [] as ServiceStoreRole[]),
    ]).then(([mine, theirs]) => {
      if (!live) return;
      setShops(mine);
      setServices(theirs);
      // Opens as whoever you are posting as elsewhere: switched to the shop
      // in a thread, you are still the shop here.
      const ids = [...mine.map((store) => store.ownerId), ...theirs.map((row) => `${row.kind}:${row.ownerId}`)];
      const at = ids.indexOf(remembered() ?? '');
      if (at >= 0) {
        setStoreAt(at);
        setSide('store');
      }
    });
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

  // Shops first, then the freight and art stores: every voice that can post.
  const seats = [
    ...shops.map((shop) => ({ id: shop.ownerId, name: shop.name, handle: shop.handle ?? null, shop, service: null })),
    ...services.map((row) => ({ id: `${row.kind}:${row.ownerId}`, name: row.name, handle: null, shop: null, service: row })),
  ];
  const stores = seats;
  const seat = seats[storeAt] ?? null;
  const store = seat?.shop ?? null;

  function pick(action: Action, as: StoreAccess | null) {
    if (action.studio) {
      setMaking({ action, storeId: side === 'store' ? seat?.id ?? null : null, storeName: side === 'store' ? seat?.name ?? null : null });
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
      <Suspense fallback={createPortal(<div className="csheet"><div className="csheet__box"><SkelRows n={4} /></div></div>, document.body)}>
        <PostStudio mode={making.action.studio!} storeId={making.storeId} storeName={making.storeName}
          presets={making.action.presets} onClose={onClose} onPosted={posted} />
      </Suspense>
    );
  }

  const groups = side === 'store' && seat?.service ? serviceActions(seat.service)
    : side === 'store' && store ? STORE : [{ label: '', actions: YOU }];
  // Whoever the side is, the quick post speaks as it: you, or the store picked.
  const voice: SocialIdentity = side === 'store' && seat
    ? { storeId: seat.id, name: seat.name, handle: seat.handle }
    : { storeId: null, name: user?.displayName ?? 'Me', handle: user?.username ?? null };
  const quickPosted = () => {
    onClose();
    navigate('/social');
  };
  let order = 0;

  const who = side === 'store' && seat ? seat.name : 'you';

  return createPortal(
    <div className="csheet" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={drag.box} className="csheet__box" role="dialog" aria-modal="true" aria-labelledby="csheet-title" {...drag.handlers}>
        <span className="csheet__grip" aria-hidden="true" />
        <div className="csheet__head">
          <h2 id="csheet-title" className="csheet__title">
            What would you like to make?<span className="csheet__spark" aria-hidden="true">✨</span>
          </h2>
          <p className="csheet__sub" key={who}>Posting as <strong>{who}</strong></p>
        </div>

        {stores.length > 0 && (
          <div className="csheet__sides" role="tablist" aria-label="Post as">
            <button type="button" role="tab" aria-selected={side === 'you'} className={`csheet__side${side === 'you' ? ' is-on' : ''}`}
              onClick={() => setSide('you')}>
              You
            </button>
            <button type="button" role="tab" aria-selected={side === 'store'} className={`csheet__side${side === 'store' ? ' is-on' : ''}`}
              onClick={() => setSide('store')}>
              {stores.length === 1 ? seat?.name : 'Your store'}
            </button>
            <span className={`csheet__thumb csheet__thumb--${side}`} aria-hidden="true" />
          </div>
        )}

        {side === 'store' && stores.length > 1 && (
          <div className="csheet__stores" role="radiogroup" aria-label="Which store">
            {stores.map((entry, index) => (
              <button key={entry.id} type="button" role="radio" aria-checked={index === storeAt}
                className={`csheet__store${index === storeAt ? ' is-on' : ''}`} onClick={() => setStoreAt(index)}>
                <span aria-hidden="true">{entry.service ? (entry.service.kind === 'forwarder' ? '✈️' : '🎨') : '🏪'}</span>
                <span className="csheet__storename">{entry.name}</span>
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
                    className={`csheet__tile csheet__tile--${action.hue}`} style={{ animationDelay: `${at * STAGGER_MS}ms` }}
                    onClick={() => pick(action, side === 'store' ? store : null)}>
                    <span className="csheet__emoji" aria-hidden="true" style={{ animationDelay: `${120 + at * STAGGER_MS}ms` }}>
                      <span>{action.emoji}</span>
                    </span>
                    {action.pro && <span className="probadge csheet__pro">PRO</span>}
                    <strong className="csheet__name">{action.title}</strong>
                    <span className="csheet__line">{action.line}</span>
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
