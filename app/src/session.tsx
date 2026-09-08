import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (body: { displayName: string; username?: string; email: string; phone: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  /** Set when sign-up succeeded on a store that will not keep the account. */
  const [warning, setWarning] = useState<string | null>(null);
  const [sessionsInsecure, setSessionsInsecure] = useState(false);

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
      .then((h) => !cancelled && setSessionsInsecure(h.auth.sessionSecretSource === 'development'))
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
    setSessionRejectedHandler(() => {
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

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
    setWarning(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, warning, sessionsInsecure, signIn, signUp, signOut }),
    [user, loading, warning, sessionsInsecure, signIn, signUp, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}
