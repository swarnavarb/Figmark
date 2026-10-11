import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getAuthService } from './auth/index.js';
import { mutateList } from './community.js';
import { getRepository } from './data/index.js';

/**
 * Who operated on what, and when.
 *
 * Operators suspend and delete accounts, hand out the right to hold other
 * people's money, change the fees, and approve what dispute decisions ask for.
 * Each of those is recorded here after it succeeds: the operator, the action,
 * what it was done to, and what they sent. Nothing in the app edits or deletes
 * these entries.
 *
 * One document per day rather than one ever-growing list, so the trail is not
 * trimmed to fit a document: a day holds up to `DAY_KEEP` entries, and old
 * days are simply never rewritten.
 */

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorEmail: string | null;
  /** What was done, e.g. `user.suspend`. */
  action: string;
  /** The route parameters - which account, dispute or action it was done to. */
  target: Record<string, string>;
  /** The request body, secrets redacted and trimmed. */
  detail: unknown;
  status: number;
}

const DAY_KEEP = 5_000;
const DETAIL_MAX_CHARS = 2_000;
const SECRET_KEYS = /pass(word)?|secret|token|key|otp|code|aadhaar|qr/i;

const dayId = (at: Date) => `audit-${at.toISOString().slice(0, 10)}`;

/** Secrets out, long text trimmed, at any depth. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, SECRET_KEYS.test(key) ? '[redacted]' : redact(entry, depth + 1)]));
  }
  return value;
}

function bounded(detail: unknown): unknown {
  const clean = redact(detail);
  const text = JSON.stringify(clean) ?? 'null';
  return text.length > DETAIL_MAX_CHARS ? `${text.slice(0, DETAIL_MAX_CHARS)}…` : clean;
}

export async function recordAudit(entry: Omit<AuditEntry, 'id' | 'at'>, at = new Date()): Promise<void> {
  const repository = await getRepository();
  const full: AuditEntry = { id: `aud_${at.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`, at: at.toISOString(), ...entry };
  await mutateList<AuditEntry>(repository, dayId(at), 'entries', DAY_KEEP, entry.actorId ?? 'system', (entries) => [...entries, full]);
}

/** The last `days` days of the trail, newest first. */
export async function loadAudit(days: number, now = new Date()): Promise<AuditEntry[]> {
  const repository = await getRepository();
  const ids = Array.from({ length: days }, (_, back) => dayId(new Date(now.getTime() - back * 86_400_000)));
  const lists = await Promise.all(ids.map(async (id) => {
    const saved = await repository.getSiteContent(id);
    const entries = (saved?.data as { entries?: unknown } | undefined)?.entries;
    return Array.isArray(entries) ? (entries as AuditEntry[]) : [];
  }));
  return lists.flat().sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * An operator route that records itself once it has succeeded.
 *
 * The body is captured as the route reads it, so it is read once and recorded
 * exactly as the route saw it. A failure to record is logged, not returned:
 * the action has already happened, and telling the operator it failed would
 * invite them to repeat it.
 */
export function audited(
  action: string,
  route: (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>,
): (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit> {
  return async (request, context) => {
    let body: unknown;
    const read = typeof request.json === 'function' ? request.json.bind(request) : null;
    if (read) {
      Object.defineProperty(request, 'json', {
        configurable: true,
        value: async () => {
          body = await read();
          return body;
        },
      });
    }
    const response = await route(request, context);
    const status = response.status ?? 200;
    if (status < 200 || status >= 300) return response;
    try {
      const actor = await (await getAuthService()).getCurrentUser(request);
      await recordAudit({
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action,
        target: { ...(request.params ?? {}) },
        detail: body === undefined ? null : bounded(body),
        status,
      });
    } catch (err) {
      context.error(`Could not record operator action ${action} in the audit trail`, err);
    }
    return response;
  };
}
