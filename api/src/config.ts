import { randomBytes } from 'node:crypto';
import type { AuthMode } from '../../shared/contracts.js';
import { DATABASE_NAME } from '../../shared/containers.js';

/**
 * Runtime configuration, resolved once from the environment.
 *
 * Every backend choice degrades to an in-process implementation when its
 * credentials are absent, so the app boots and is browsable with nothing
 * provisioned. `/api/health` reports which implementation actually loaded, so a
 * degraded deployment is visible rather than silent.
 */

export interface CosmosConfig {
  endpoint: string;
  /** Null when using managed identity via DefaultAzureCredential. */
  key: string | null;
  database: string;
}

export interface StorageConfig {
  account: string;
  key: string | null;
  connectionString: string | null;
}

export interface AppConfig {
  version: string;
  authMode: AuthMode;
  sessionSecret: string;
  sessionSecretSource: SessionSecretSource;
  sessionTtlSeconds: number;
  /** Null when Cosmos is not configured; the in-memory repository is used instead. */
  cosmos: CosmosConfig | null;
  /** Null when Storage is not configured; the in-memory store is used instead. */
  storage: StorageConfig | null;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

function resolveCosmos(): CosmosConfig | null {
  const endpoint = env('COSMOS_ENDPOINT');
  if (!endpoint) return null;
  return {
    endpoint,
    key: env('COSMOS_KEY'),
    database: env('COSMOS_DATABASE') ?? DATABASE_NAME,
  };
}

function resolveStorage(): StorageConfig | null {
  const connectionString = env('STORAGE_CONNECTION_STRING');
  const account = env('STORAGE_ACCOUNT');
  if (!connectionString && !account) return null;
  return {
    account: account ?? '(from connection string)',
    key: env('STORAGE_KEY'),
    connectionString,
  };
}

function resolveAuthMode(): AuthMode {
  return env('AUTH_MODE') === 'swa' ? 'swa' : 'mock';
}

/**
 * The signing secret for sessions.
 *
 * A committed constant is only ever acceptable for a throwaway demo running on
 * the in-memory store. The moment a real database is configured, falling back
 * to a value that is published in this repository would let anyone forge a
 * session for any account - so instead we generate a random secret per
 * instance. That fails safe rather than open: sessions do not survive a restart
 * and users are signed out, which is visible and recoverable, where a forgeable
 * token is neither.
 *
 * `/api/health` reports which of the three cases is in force.
 */
export type SessionSecretSource = 'configured' | 'ephemeral' | 'development';

const DEV_SESSION_SECRET = 'figmark-dev-insecure-session-secret';

function resolveSessionSecret(hasRealBackend: boolean): {
  secret: string;
  source: SessionSecretSource;
} {
  const configured = env('AUTH_SESSION_SECRET');
  if (configured) return { secret: configured, source: 'configured' };
  if (hasRealBackend) return { secret: randomBytes(32).toString('hex'), source: 'ephemeral' };
  return { secret: DEV_SESSION_SECRET, source: 'development' };
}

const cosmos = resolveCosmos();
const session = resolveSessionSecret(cosmos !== null);

export const config: AppConfig = {
  version: env('BUILD_VERSION') ?? '0.1.0',
  authMode: resolveAuthMode(),
  sessionSecret: session.secret,
  sessionSecretSource: session.source,
  sessionTtlSeconds: 60 * 60 * 12,
  cosmos,
  storage: resolveStorage(),
};

/** True when the session secret is the constant published in this repository. */
export const usingDevSessionSecret = session.source === 'development';
