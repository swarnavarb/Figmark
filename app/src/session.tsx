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
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (body: { displayName: string; email: string; phone: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  /** Set when sign-up succeeded on a store that will not keep the account. */
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .me()
      .then((result) => !cancelled && setUser(result.user))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Any authenticated call the server rejects drops us back to sign-in, rather
  // than leaving a stale user object and an unusable page behind it.
  useEffect(() => {
    setSessionRejectedHandler(() => {
      setUser(null);
      setWarning(null);
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
    () => ({ user, loading, warning, signIn, signUp, signOut }),
    [user, loading, warning, signIn, signUp, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}
