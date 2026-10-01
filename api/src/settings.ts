import { DEFAULT_SETTINGS, cleanSettings, type MarketSettings } from '../../shared/settings.js';
import type { getRepository } from './data/index.js';

/**
 * The live marketplace settings, as the operators last saved them.
 *
 * Read from the store on every call rather than cached: it is one point read,
 * and a cached copy would keep the old number on every warm worker until it
 * happened to restart - which is exactly the kind of "I changed it and nothing
 * happened" an operator cannot see from the console.
 */
type Repo = Awaited<ReturnType<typeof getRepository>>;

export const SETTINGS_ID = 'settings';

export async function marketSettings(repository: Repo): Promise<MarketSettings> {
  const saved = await repository.getSiteContent(SETTINGS_ID);
  if (!saved) return { ...DEFAULT_SETTINGS, updatedAt: null, updatedBy: null };
  // Re-checked on the way out: a copy that no longer passes (the range
  // tightened since it was saved) falls back to the default, never to nothing.
  const cleaned = cleanSettings(saved.data);
  if ('error' in cleaned) return { ...DEFAULT_SETTINGS, updatedAt: null, updatedBy: null };
  return { ...cleaned.settings, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy };
}

export async function autoReleaseDays(repository: Repo): Promise<number> {
  return (await marketSettings(repository)).autoReleaseDays;
}
