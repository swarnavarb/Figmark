import { config } from '../config.js';
import { getRepository } from '../data/index.js';
import { MockAuthProvider } from './mock-provider.js';
import { StaticWebAppsAuthProvider } from './swa-provider.js';
import type { AuthService } from './types.js';

export { AuthError } from './errors.js';
export type { AuthService } from './types.js';
export { toAuthUser } from './mock-provider.js';

let cached: AuthService | null = null;

/**
 * Resolve the configured auth provider. The single place in the codebase that
 * knows which implementation is in use - everything else takes an `AuthService`.
 */
export async function getAuthService(): Promise<AuthService> {
  if (cached) return cached;
  const repository = await getRepository();

  cached =
    config.authMode === 'swa'
      ? new StaticWebAppsAuthProvider(repository)
      : new MockAuthProvider(repository, config.sessionSecret, config.sessionTtlSeconds);

  return cached;
}
