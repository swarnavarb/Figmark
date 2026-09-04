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
 * The signing secret for mock sessions. In production this must come from app
 * settings; the development fallback is constant so local restarts don't
 * invalidate every open session.
 */
function resolveSessionSecret(): string {
  return env('AUTH_SESSION_SECRET') ?? 'figmark-dev-insecure-session-secret';
}

export const config: AppConfig = {
  version: env('BUILD_VERSION') ?? '0.1.0',
  authMode: resolveAuthMode(),
  sessionSecret: resolveSessionSecret(),
  sessionTtlSeconds: 60 * 60 * 12,
  cosmos: resolveCosmos(),
  storage: resolveStorage(),
};

/** True when the session secret is still the built-in development fallback. */
export const usingDevSessionSecret = env('AUTH_SESSION_SECRET') === null;
