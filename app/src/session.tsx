import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthUser } from '@shared/contracts';
import { api, setSessionRejectedHandler } from './api';

/**
 * The signed-in user, resolved once and shared.
 *
 * Everything reads the session through this context, never through the auth
 * endpoints directly - the same discipline the API keeps behind `AuthService`.
 */
interface SessionValue {
  user: AuthUser | null;
  loading: boolean;
  /** Non-null when the signed-in account is not durably stored. */
  warning: string | null;
  /** True when sessions are signed with the key published in this repository. */
  sessionsInsecure: boolean;
  /**
   * Containers the schema declares that the database does not hold.
   *
   * Every feature reading one is broken, and the only symptom is an error on
   * that one screen — which is how a missing `messages` container went two
   * rounds undiagnosed. Said out loud, in the same banner as the session key.
   */
  missingContainers: string[];
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (body: { displayName: string; username?: string; email: string; phone: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-read the principal, after something on it has changed server-side. */
  refresh: () => Promise<void>;
  /**
   * Ask a guest to sign in, in a popup over the page they are on. Anything
   * that needs an account calls this instead of hiding itself; once they are
   * in, the popup closes and they are still on the same page.
   */
  promptAuth: (reason?: string) => void;
  /**
   * `fn` for somebody signed in; the sign-in popup for a guest. For wrapping
   * the handler of anything interactive.
   */
  gate: <A extends unknown[]>(fn: (...args: A) => unknown, reason?: string) => (...args: A) => void;
  /** Non-null while the sign-in popup is open: why it was asked for. */
  authPrompt: { reason: string | null } | null;
  closeAuth: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  /** Set when sign-up succeeded on a store that will not keep the account. */
  const [warning, setWarning] = useState<string | null>(null);
  const [sessionsInsecure, setSessionsInsecure] = useState(false);
  const [missingContainers, setMissingContainers] = useState<string[]>([]);
  const [authPrompt, setAuthPrompt] = useState<{ reason: string | null } | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  const loadingRef = useRef(true);
  loadingRef.current = loading;

  useEffect(() => {
    let cancelled = false;
    // Only a clean answer of "nobody" means signed out. A network blip or a 500
    // is the server failing to tell us, not the session ending - retry once,
    // and never turn an error into a logout.
    const resolveSession = async (): Promise<void> => {
      try {
        const result = await api.me();
        if (!cancelled) setUser(result.user);
      } catch {
        try {
          const retry = await api.me();
          if (!cancelled) setUser(retry.user);
        } catch {
          if (!cancelled) setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void resolveSession();

    void api
      .health()
      .then((h) => {
        if (cancelled) return;
        setSessionsInsecure(h.auth.sessionSecretSource === 'development');
        setMissingContainers(h.data.missingContainers ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A single 401 is not proof the session is gone.
   *
   * Requests are spread across workers, and one of them answering 401 while the
   * rest are fine must not destroy a working session - that turns a transient
   * error into "clicking this link logs me out". So confirm with the server
   * before clearing anything: only when /api/auth/me also reports nobody is
   * the session actually over.
   */
  useEffect(() => {
    let checking = false;
    setSessionRejectedHandler((method) => {
      // A guest pressing something that needs an account: ask them to sign
      // in, rather than showing "Authentication required" on the page.
      if (!userRef.current && !loadingRef.current) {
        if (method !== 'GET') setAuthPrompt({ reason: null });
        return;
      }
      if (checking) return;
      checking = true;
      void api
        .me()
        .then((result) => {
          if (result.user) return; // Still signed in; the 401 was not ours to act on.
          setUser(null);
          setWarning(null);
        })
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    });
    return () => setSessionRejectedHandler(null);
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    // The warning belongs to the account it was raised for, so signing in as
    // someone else must clear it.
    setWarning(null);
    setUser((await api.login(identifier, password)).user);
  }, []);

  const signUp = useCallback(async (body: Parameters<SessionValue['signUp']>[0]) => {
    const result = await api.signup(body);
    setWarning(result.warning ?? null);
    setUser(result.user);
  }, []);

  const refresh = useCallback(async () => {
    // Only a clean answer replaces the principal: a failure here means the
    // server could not tell us, not that the account changed underneath.
    try {
      const result = await api.me();
      if (result.user) setUser(result.user);
    } catch {
      /* keep what we have */
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
    setWarning(null);
  }, []);

  // Signed in: whatever asked for it is now allowed, so the popup goes.
  useEffect(() => {
    if (user) setAuthPrompt(null);
  }, [user]);

  const promptAuth = useCallback((reason?: string) => setAuthPrompt({ reason: reason ?? null }), []);
  const closeAuth = useCallback(() => setAuthPrompt(null), []);
  const gate = useCallback(<A extends unknown[]>(fn: (...args: A) => unknown, reason?: string) => (...args: A) => {
    if (userRef.current) {
      void fn(...args);
      return;
    }
    // A click on a link or inside a form must not go on to do the thing anyway.
    const event = args[0] as { preventDefault?: () => void; stopPropagation?: () => void } | undefined;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setAuthPrompt({ reason: reason ?? null });
  }, []);

  const value = useMemo(
    () => ({
      user, loading, warning, sessionsInsecure, missingContainers, signIn, signUp, signOut, refresh,
      promptAuth, gate, authPrompt, closeAuth,
    }),
    [user, loading, warning, sessionsInsecure, missingContainers, signIn, signUp, signOut, refresh,
      promptAuth, gate, authPrompt, closeAuth],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}
