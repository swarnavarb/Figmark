import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';

/**
 * Saving a listing, the one way every screen does it.
 *
 * Optimistic - the heart fills at once - and rolled back if the server says
 * no. A second tap while the first is still on its way is ignored: two quick
 * taps used to send two toggles that undid each other.
 */
export function useSave(listingId: string, initial: boolean, onSaved?: (liked: boolean) => void) {
  const { user, promptAuth } = useSession();
  const [liked, setLiked] = useState(initial);
  const inFlight = useRef(false);
  useEffect(() => setLiked(initial), [initial]);

  const toggle = useCallback(async () => {
    if (!user) {
      promptAuth('Sign in to save items.');
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    const next = !liked;
    setLiked(next);
    try {
      const result = await api.like(listingId);
      setLiked(result.liked);
      onSaved?.(result.liked);
    } catch {
      setLiked(!next);
    } finally {
      inFlight.current = false;
    }
  }, [user, promptAuth, liked, listingId, onSaved]);

  return [liked, toggle] as const;
}
