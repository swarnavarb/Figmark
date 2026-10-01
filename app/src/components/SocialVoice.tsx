import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { SocialIdentity } from '@shared/social';
import { useSession } from '../session';
import { Avatar } from './ui';
import { Icon } from './Icon';

/**
 * Which of your voices the social tab speaks in: you, or a shop you run.
 *
 * One choice for everything on the tab - posting, reacting, commenting,
 * reposting - because a shop owner switching to the shop to post and then
 * finding their reactions still land as themselves would be two identities
 * leaking into each other. Remembered on this device, so it survives a reload.
 */

interface VoiceValue {
  voice: SocialIdentity;
  voices: SocialIdentity[];
  choose: (storeId: string | null) => void;
}

const STORAGE_KEY = 'figmark.social.voice';

const ME: SocialIdentity = { storeId: null, name: '', handle: null };
const VoiceContext = createContext<VoiceValue>({ voice: ME, voices: [ME], choose: () => undefined });

function remembered(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [stores, setStores] = useState<SocialIdentity[]>([]);
  const [chosen, setChosen] = useState<string | null>(remembered);

  useEffect(() => {
    let live = true;
    api.stores()
      .then((result) => {
        if (!live) return;
        setStores(result.stores
          .filter((store) => store.permissions.includes('posts'))
          .map((store) => ({ storeId: store.ownerId, name: store.name, handle: store.handle ?? null })));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

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
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
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
export function VoicePicker({ size = 44, switchOnly = false, title = 'Post, react and comment as' }: {
  size?: number;
  /** Just the small switch, for a bar that already shows your photo elsewhere. */
  switchOnly?: boolean;
  title?: string;
}) {
  const { voice, voices, choose } = useVoice();
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

  if (voices.length < 2) return switchOnly ? null : <VoiceAvatar voice={voice} size={size} />;

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
          <p className="voicepick__title">{title}</p>
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
                  <span className="faint">{entry.storeId ? 'Storefront' : 'Your profile'}</span>
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
