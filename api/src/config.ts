import { createHmac } from 'node:crypto';
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
  /**
   * Accounts that operate the marketplace, by email.
   *
   * An explicit list rather than a flag on a row, because the admin panel
   * deletes accounts and hands out the right to hold other people's money -
   * granting that has to be a deliberate act of configuration, not something an
   * account can acquire by signing up or by a bug in a write path.
   *
   * Empty by default. A deployment with nobody in it has no admin panel at all,
   * which is the correct state for one nobody has configured.
   */
  adminEmails: string[];
  /**
   * Claude, for reading what is in a photo someone searches with. Null when
   * ANTHROPIC_API_KEY is unset; photo search then matches on the picture alone.
   */
  vision: VisionConfig | null;
  /** Email, WhatsApp and Aadhaar verification. Each piece is null until configured. */
  verification: VerificationConfig;
}

export interface VerificationConfig {
  /** Brevo's transactional email API (free: 300 a day). Null: codes cannot be emailed. */
  email: { brevoApiKey: string; from: string; fromName: string } | null;
  /**
   * WhatsApp Cloud API. People message `businessNumber`; Meta posts each message
   * to the webhook, signed with `appSecret`. The access token is only for the
   * optional "you're verified" reply.
   */
  whatsapp: {
    businessNumber: string;
    verifyToken: string;
    appSecret: string;
    accessToken: string | null;
    phoneNumberId: string | null;
  } | null;
  /** UIDAI's offline-verification certificate (PEM, or base64 DER). Null: Aadhaar QRs cannot be checked. */
  aadhaarCertificate: string | null;
}

export interface VisionConfig {
  apiKey: string;
  model: string;
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

/**
 * Who operates the marketplace.
 *
 * On the in-memory store the demo account is included, because that store is a
 * throwaway fixture whose password is published in this repository - admin over
 * data that resets on restart grants nothing. A durable store gets nobody
 * unless ADMIN_EMAILS says so.
 */
function resolveAdmins(cosmos: CosmosConfig | null): string[] {
  const configured = (env('ADMIN_EMAILS') ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return cosmos ? [] : ['demo@figmark.in'];
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

function resolveVision(): VisionConfig | null {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  return { apiKey, model: env('PHOTO_SEARCH_MODEL') ?? 'claude-opus-5-5' };
}

function resolveVerification(): VerificationConfig {
  const brevoApiKey = env('BREVO_API_KEY');
  const from = env('EMAIL_FROM');
  const businessNumber = env('WHATSAPP_BUSINESS_NUMBER');
  const verifyToken = env('WHATSAPP_VERIFY_TOKEN');
  const appSecret = env('WHATSAPP_APP_SECRET');
  return {
    email: brevoApiKey && from ? { brevoApiKey, from, fromName: env('EMAIL_FROM_NAME') ?? 'Figmark' } : null,
    whatsapp:
      businessNumber && verifyToken && appSecret
        ? {
            // Digits only, as wa.me wants them: 919876543210.
            businessNumber: businessNumber.replace(/\D/g, ''),
            verifyToken,
            appSecret,
            accessToken: env('WHATSAPP_ACCESS_TOKEN'),
            phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
          }
        : null,
    aadhaarCertificate: env('AADHAAR_QR_CERT'),
  };
}

function resolveAuthMode(): AuthMode {
  return env('AUTH_MODE') === 'swa' ? 'swa' : 'mock';
}

/**
 * The signing secret for sessions.
 *
 * Anyone holding it can mint a session for any account, so it must be secret
 * and the same on every worker (requests are spread across them, and a key
 * that differs per worker signs people out on every other request).
 *
 * In order: AUTH_SESSION_SECRET; else a key derived from a credential the
 * deployment already holds (stable, never published); else - only on a
 * developer's machine with no database - the constant below, which is in this
 * repository and therefore forgeable by anyone. Anywhere else with no key
 * material, sessions are switched off ('missing') and sign-in says why, rather
 * than signing tokens with a published value.
 *
 * `/api/health` reports which case is in force.
 */
export type SessionSecretSource = 'configured' | 'derived' | 'development' | 'missing';

const DEV_SESSION_SECRET = 'figmark-dev-insecure-session-secret';

/** True on Azure: App Service and Functions hosts set these, a laptop does not. */
function runningInAzure(): boolean {
  return Boolean(env('WEBSITE_INSTANCE_ID') ?? env('WEBSITE_SITE_NAME') ?? env('WEBSITE_HOSTNAME'));
}

function resolveSessionSecret(hasRealBackend: boolean): {
  secret: string;
  source: SessionSecretSource;
} {
  const configured = env('AUTH_SESSION_SECRET');
  if (configured) return { secret: configured, source: 'configured' };

  const material = env('COSMOS_KEY') ?? env('STORAGE_KEY') ?? env('STORAGE_CONNECTION_STRING');
  if (material) {
    return {
      secret: createHmac('sha256', material).update('figmark-session-v1').digest('hex'),
      source: 'derived',
    };
  }

  // A throwaway local run: in-memory data, nobody else can reach it.
  if (!hasRealBackend && !runningInAzure()) return { secret: DEV_SESSION_SECRET, source: 'development' };

  // Deployed with nothing to sign with. Never fall back to the published
  // constant here: the secret is left empty and the auth provider refuses to
  // issue or accept sessions until AUTH_SESSION_SECRET is set.
  return { secret: '', source: 'missing' };
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
  adminEmails: resolveAdmins(cosmos),
  vision: resolveVision(),
  verification: resolveVerification(),
};
