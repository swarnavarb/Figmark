import { Link } from 'react-router-dom';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { SocialIdentity } from '@shared/social';
import { useSession } from '../session';
import { Avatar } from './ui';
import { Icon } from './Icon';

/**
 * Which of your voices the social tab speaks in: you, a shop you run, or a
 * freight or art store you have the voice of (`kind:ownerId`).
 *
 * One choice for everything on the tab - posting, reacting, commenting,
 * reposting - because a shop owner switching to the shop to post and then
 * finding their reactions still land as themselves would be two identities
 * leaking into each other. Remembered on this device, so it survives a reload.
 *
 * One choice for the whole app, too: switching from the profile menu is the
 * same switch, so whoever you switched to is who you are on Social.
 */

interface VoiceValue {
  voice: SocialIdentity;
  voices: SocialIdentity[];
  choose: (storeId: string | null) => void;
}

const STORAGE_KEY = 'figmark.social.voice';

const ME: SocialIdentity = { storeId: null, name: '', handle: null };
const VoiceContext = createContext<VoiceValue>({ voice: ME, voices: [ME], choose: () => undefined });
/** Set once a provider is up, so the pages that wrap themselves in one share the app's. */
const Provided = createContext(false);

/** The shop this device last posted as, or null for yourself. */
export function remembered(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  if (useContext(Provided)) return <>{children}</>;
  return <OwnVoice>{children}</OwnVoice>;
}

function OwnVoice({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [stores, setStores] = useState<SocialIdentity[]>([]);
  const [chosen, setChosen] = useState<string | null>(remembered);

  // Asked again whenever the account changes: signing in without a reload
  // must find its shops, and signing out must not leave the last one's.
  const userId = user?.id ?? null;
  useEffect(() => {
    setStores([]);
    if (!userId) return;
    let live = true;
    void Promise.all([
      api.stores()
        .then((result) => result.stores
          .filter((store) => store.permissions.includes('posts'))
          .map((store): SocialIdentity => ({ storeId: store.ownerId, name: store.name, handle: store.handle ?? null })))
        .catch(() => [] as SocialIdentity[]),
      api.myServiceStores()
        .then((result) => result.stores
          .filter((row) => row.live && row.rights.includes('voice'))
          .map((row): SocialIdentity => ({ storeId: `${row.kind}:${row.ownerId}`, name: row.name, handle: null })))
        .catch(() => [] as SocialIdentity[]),
    ]).then(([shops, services]) => {
      if (live) setStores([...shops, ...services]);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  const me = useMemo<SocialIdentity>(
    () => ({ storeId: null, name: user?.displayName ?? 'Me', handle: user?.username ?? null }),
    [user?.displayName, user?.username],
  );
  const voices = useMemo(() => [me, ...stores], [me, stores]);
  // A remembered shop you no longer run falls back to you, rather than
  // leaving every request refused.
  const voice = voices.find((entry) => entry.storeId === chosen) ?? me;

  const choose = useCallback((storeId: string | null) => {
    setChosen(storeId);
    try {
      if (storeId) window.localStorage.setItem(STORAGE_KEY, storeId);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Not remembered on this device; still chosen for this visit. */
    }
  }, []);

  const value = useMemo(() => ({ voice, voices, choose }), [voice, voices, choose]);
  return (
    <Provided.Provider value={true}>
      <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
    </Provided.Provider>
  );
}

/**
 * Yourself, and nobody else, for everything inside.
 *
 * A forum is people talking as themselves, so inside one the shop voice is
 * not on offer: reactions, comments and votes there are always yours.
 */
export function PersonVoice({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const value = useMemo<VoiceValue>(() => {
    const me: SocialIdentity = { storeId: null, name: user?.displayName ?? 'Me', handle: user?.username ?? null };
    return { voice: me, voices: [me], choose: () => undefined };
  }, [user?.displayName, user?.username]);
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

/** A set of voices from somewhere else - the handles of a conversation - for the same picker. */
export function VoiceScope({ voice, voices, choose, children }: VoiceValue & { children: ReactNode }) {
  const value = useMemo(() => ({ voice, voices, choose }), [voice, voices, choose]);
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceValue {
  return useContext(VoiceContext);
}

/** A face for a voice: initials, with a shop badge when it is a shop. */
export function VoiceAvatar({ voice, size = 40 }: { voice: SocialIdentity; size?: number }) {
  return (
    <span className={`voiceav${voice.storeId ? ' voiceav--shop' : ''}`}>
      <Avatar name={voice.name || 'Me'} size={size} />
      {voice.storeId && (
        <span className="voiceav__badge" aria-hidden="true"><Icon name="tag" size={10} /></span>
      )}
    </span>
  );
}

/**
 * The avatar that switches who you are posting as.
 *
 * Only a button when there is a choice to make: somebody with no shop sees a
 * plain avatar, not a menu with one entry in it.
 */
export function VoicePicker({ size = 44, switchOnly = false, title = 'Post, react and comment as', adding = true }: {
  size?: number;
  /** An Add beside the title, for opening another business. Off where the voices are a conversation's. */
  adding?: boolean;
  /** Just the small switch, for a bar that already shows your photo elsewhere. */
  switchOnly?: boolean;
  title?: string;
}) {
  const { voice, voices, choose } = useVoice();
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  // Which way the menu opens: towards whichever side of the screen has room.
  // A switcher in a bar pinned to the bottom opening downwards opened off the
  // screen, where nobody could pick anything from it.
  const [place, setPlace] = useState({ up: false, right: false });
  const box = useRef<HTMLDivElement | null>(null);

  function toggle() {
    const rect = box.current?.getBoundingClientRect();
    if (!open && rect) {
      setPlace({
        up: rect.top > window.innerHeight * 0.55,
        right: rect.left > window.innerWidth * 0.5,
      });
    }
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  // The green switch stays for anyone signed in, since its menu is also where
  // another business is opened; the photo in a composer is only a menu with a choice in it.
  if (!switchOnly && voices.length < 2) return <VoiceAvatar voice={voice} size={size} />;
  if (switchOnly && !user) return null;

  return (
    <div className="voicepick" ref={box}>
      <button type="button" className="voicepick__button" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Posting as ${voice.name}. Switch profile`} onClick={toggle}>
        {switchOnly ? (
          <span className="voicepick__switch" aria-hidden="true"><Icon name="sort" size={Math.round(size * 0.45)} /></span>
        ) : (
          <>
            <VoiceAvatar voice={voice} size={size} />
            <span className="voicepick__swap" aria-hidden="true"><Icon name="sort" size={11} /></span>
          </>
        )}
      </button>
      {open && (
        <div className={`voicepick__menu${place.up ? ' voicepick__menu--up' : ''}${place.right ? ' voicepick__menu--right' : ''}`}
          role="menu" aria-label={title}>
          <div className="voicepick__head">
            <p className="voicepick__title">{title}</p>
            {adding && <Link to="/open" className="voicepick__open" aria-label="Open another business" onClick={() => setOpen(false)}>
              <Icon name="plus" size={12} /> Add
            </Link>}
          </div>
          {voices.map((entry) => {
            const on = entry.storeId === voice.storeId;
            return (
              <button key={entry.storeId ?? 'me'} type="button" role="menuitemradio" aria-checked={on}
                className={`voicepick__item${on ? ' is-on' : ''}`}
                onClick={() => {
                  choose(entry.storeId);
                  setOpen(false);
                }}>
                <VoiceAvatar voice={entry} size={36} />
                <span className="voicepick__who">
                  <strong>{entry.name}</strong>
                  <span className="faint">{!entry.storeId ? 'Your profile'
                    : entry.storeId.startsWith('forwarder:') ? 'Freight forwarder'
                      : entry.storeId.startsWith('artist:') ? 'Artist' : 'Storefront'}</span>
                </span>
                {on && <Icon name="check" size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
