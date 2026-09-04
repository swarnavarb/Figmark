import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '@shared/contracts';
import { api } from './api';

/**
 * The signed-in user, resolved once and shared.
 *
 * Everything reads the session through this context, never through the auth
 * endpoints directly - the same discipline the API keeps behind `AuthService`.
 */
interface SessionValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (body: { displayName: string; email: string; phone: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

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

  const signIn = useCallback(async (identifier: string, password: string) => {
    setUser((await api.login(identifier, password)).user);
  }, []);

  const signUp = useCallback(async (body: Parameters<SessionValue['signUp']>[0]) => {
    setUser((await api.signup(body)).user);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}
