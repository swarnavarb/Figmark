import type { SiteContent } from '../../../shared/models.js';
import { config, type EmailProviderConfig } from '../config.js';
import type { Repository } from '../data/repository.js';

/**
 * Sending an email through whichever free tier still has room today.
 *
 * Providers are tried in the configured order - Brevo, then Mailjet, then
 * Resend - and each is used until its free allowance for the day (or month)
 * is spent. Two things decide "spent":
 *
 * - Our own count, kept in one shared document so every worker sees the same
 *   number. A send reserves its slot before it goes out, so two workers
 *   racing for the last slot cannot both take it.
 * - The provider saying so. A quota refusal (429, 402, or a body that talks
 *   about limits, quota or credits) marks that provider exhausted for the rest
 *   of the UTC day, whatever our count says - their number is the real one.
 *
 * Any other failure (an outage, a bad key) moves on to the next provider for
 * this email without marking anything, so one bad minute does not take a
 * provider out for the day. Counts reset at midnight UTC; monthly counts on
 * the first of the month.
 */

const USAGE_ID = 'email-usage';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface Usage {
  day: string;
  month: string;
  /** Sends reserved per provider, today and this month. */
  counts: Record<string, { day: number; month: number }>;
  /** Providers that refused for quota today, with why. */
  exhausted: Record<string, string>;
}

const dayKey = (now: Date) => now.toISOString().slice(0, 10);
const monthKey = (now: Date) => now.toISOString().slice(0, 7);

function readUsage(content: SiteContent | null, now: Date): Usage {
  const saved = content?.data as Usage | undefined;
  const day = dayKey(now);
  const month = monthKey(now);
  const counts: Usage['counts'] = {};
  for (const [name, entry] of Object.entries(saved?.counts ?? {})) {
    counts[name] = {
      day: saved?.day === day ? entry.day : 0,
      month: saved?.month === month ? entry.month : 0,
    };
  }
  return { day, month, counts, exhausted: saved?.day === day ? saved.exhausted ?? {} : {} };
}

function hasRoom(provider: EmailProviderConfig, usage: Usage): boolean {
  if (usage.exhausted[provider.name]) return false;
  const count = usage.counts[provider.name] ?? { day: 0, month: 0 };
  if (count.day >= provider.dailyLimit) return false;
  if (provider.monthlyLimit !== null && count.month >= provider.monthlyLimit) return false;
  return true;
}

function asContent(usage: Usage, now: Date): SiteContent {
  const at = now.toISOString();
  return { id: USAGE_ID, data: usage, createdAt: at, updatedAt: at, updatedBy: null } as SiteContent;
}

/** Takes one slot on `provider` if it still has room; false when it has none. */
async function reserve(repository: Repository, provider: EmailProviderConfig, now: Date): Promise<boolean> {
  let taken = false;
  await repository.mutateSiteContent(USAGE_ID, (current) => {
    const usage = readUsage(current, now);
    taken = hasRoom(provider, usage);
    if (taken) {
      const count = usage.counts[provider.name] ?? { day: 0, month: 0 };
      usage.counts[provider.name] = { day: count.day + 1, month: count.month + 1 };
    }
    return asContent(usage, now);
  });
  return taken;
}

async function release(repository: Repository, provider: EmailProviderConfig, now: Date, exhaustedBecause: string | null): Promise<void> {
  await repository.mutateSiteContent(USAGE_ID, (current) => {
    const usage = readUsage(current, now);
    const count = usage.counts[provider.name];
    // The slot was not used, so give it back.
    if (count) usage.counts[provider.name] = { day: Math.max(0, count.day - 1), month: Math.max(0, count.month - 1) };
    if (exhaustedBecause) usage.exhausted[provider.name] = exhaustedBecause;
    return asContent(usage, now);
  });
}

type Outcome = { ok: true } | { ok: false; quota: boolean; detail: string };

async function outcomeOf(response: Response): Promise<Outcome> {
  if (response.ok) return { ok: true };
  const body = (await response.text().catch(() => '')).slice(0, 300);
  const quota = response.status === 429 || response.status === 402
    || /limit|quota|credit|exceed/i.test(body);
  return { ok: false, quota, detail: `${response.status} ${body}`.trim() };
}

const fromOf = (provider: EmailProviderConfig) => provider.from ?? config.verification.email!.from;
const nameOf = () => config.verification.email!.fromName;

async function deliver(provider: EmailProviderConfig, message: EmailMessage): Promise<Outcome> {
  try {
    switch (provider.name) {
      case 'brevo':
        return outcomeOf(await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': provider.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender: { email: fromOf(provider), name: nameOf() },
            to: [{ email: message.to }],
            subject: message.subject,
            textContent: message.text,
            htmlContent: message.html,
          }),
        }));
      case 'mailjet':
        return outcomeOf(await fetch('https://api.mailjet.com/v3.1/send', {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${provider.apiKey}:${provider.secretKey ?? ''}`).toString('base64')}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            Messages: [{
              From: { Email: fromOf(provider), Name: nameOf() },
              To: [{ Email: message.to }],
              Subject: message.subject,
              TextPart: message.text,
              HTMLPart: message.html,
            }],
          }),
        }));
      case 'resend':
        return outcomeOf(await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: `${nameOf()} <${fromOf(provider)}>`,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        }));
    }
  } catch (err) {
    return { ok: false, quota: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export class EmailUnavailableError extends Error {}

/**
 * Sends `message` through the first provider with room. Returns which one did;
 * throws EmailUnavailableError when every provider is spent or failing.
 */
export async function sendEmail(repository: Repository, message: EmailMessage, now = new Date()): Promise<string> {
  const providers = config.verification.email?.providers ?? [];
  const failures: string[] = [];
  for (const provider of providers) {
    if (!(await reserve(repository, provider, now))) {
      failures.push(`${provider.name}: free limit reached`);
      continue;
    }
    const outcome = await deliver(provider, message);
    if (outcome.ok) return provider.name;
    await release(repository, provider, now, outcome.quota ? outcome.detail : null);
    failures.push(`${provider.name}: ${outcome.detail}`);
  }
  console.warn(`Email to ${message.to} not sent: ${failures.join('; ') || 'no provider configured'}`);
  throw new EmailUnavailableError(failures.join('; '));
}

/** Today's counts, for the operators' status line. */
export async function emailUsage(repository: Repository, now = new Date()) {
  const usage = readUsage(await repository.getSiteContent(USAGE_ID), now);
  return (config.verification.email?.providers ?? []).map((provider) => ({
    name: provider.name,
    today: usage.counts[provider.name]?.day ?? 0,
    dailyLimit: provider.dailyLimit,
    thisMonth: usage.counts[provider.name]?.month ?? 0,
    monthlyLimit: provider.monthlyLimit,
    exhaustedToday: usage.exhausted[provider.name] ?? null,
  }));
}
