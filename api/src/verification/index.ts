import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { User } from '../../../shared/models.js';
import {
  maskMobile, mobileDigits, normalizeIndianMobile, verifiedChecks, type VerifiedChecks,
} from '../../../shared/verification.js';
import { config } from '../config.js';
import type { Repository } from '../data/repository.js';
import {
  AadhaarError, aadhaarMobileHash, loadUidaiKey, parseSecureQr, signatureValid,
} from './aadhaar.js';

/**
 * Email, phone and Aadhaar verification: the three checks that open buying and
 * selling (see shared/verification.ts for what each one proves).
 *
 * All three are free to run. Email goes out through Brevo's free tier; the
 * phone is proved by the person messaging Figmark on WhatsApp, which costs
 * nothing to receive; the Aadhaar QR is checked offline against UIDAI's
 * certificate. Each piece switches on when its settings are present, and says
 * so plainly when they are not.
 */

const EMAIL_CODE_MINUTES = 15;
const EMAIL_CODE_ATTEMPTS = 5;
const PHONE_CODE_MINUTES = 30;
/** No 0/O or 1/I/L, so a code read off a screen is typed back right. */
const PHONE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class VerificationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const hashCode = (userId: string, code: string) =>
  createHash('sha256').update(`${userId}:${code.trim().toUpperCase()}`).digest('hex');

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const now = () => new Date().toISOString();

/** What the verification screens need to know about this server and this account. */
export interface VerificationStatus {
  checks: VerifiedChecks;
  email: string;
  phone: string | null;
  /** Set while a WhatsApp code is waiting to be messaged in. */
  phoneChallenge: { expiresAt: string; error: string | null } | null;
  emailCodePending: boolean;
  aadhaar: { name: string; last4: string; at: string } | null;
  /** Which pieces this deployment can actually run. */
  ready: { email: boolean; whatsapp: boolean; aadhaar: boolean };
}

export function statusOf(user: User): VerificationStatus {
  const phone = user.challenges?.phone;
  const aadhaar = user.verification.proofs?.aadhaar;
  return {
    checks: verifiedChecks(user),
    email: user.email,
    phone: user.phone,
    phoneChallenge: phone ? { expiresAt: phone.expiresAt, error: phone.error ?? null } : null,
    emailCodePending: Boolean(user.challenges?.email && Date.parse(user.challenges.email.expiresAt) > Date.now()),
    aadhaar: aadhaar ? { name: aadhaar.name, last4: aadhaar.last4, at: aadhaar.at } : null,
    ready: {
      email: config.verification.email !== null || devCodesAllowed(),
      whatsapp: config.verification.whatsapp !== null,
      aadhaar: config.verification.aadhaarCertificate !== null,
    },
  };
}

/**
 * Showing the code on screen instead of emailing it - only for a throwaway
 * local run on the in-memory store, where there is nobody to protect and no
 * email service to send through. Never with a real database.
 */
function devCodesAllowed(): boolean {
  return config.cosmos === null && config.verification.email === null && config.sessionSecretSource === 'development';
}

/* ── Email ─────────────────────────────────────────────────────────────── */

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  const settings = config.verification.email;
  if (!settings) throw new VerificationError(503, 'email_unconfigured', 'Email delivery is not set up on this server yet.');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': settings.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: settings.from, name: settings.fromName },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!response.ok) {
    throw new VerificationError(502, 'email_failed', `The email could not be sent (Brevo answered ${response.status}). Try again in a minute.`);
  }
}

/** Sends a fresh six-digit code to the account's email. Returns the code only where dev codes are allowed. */
export async function startEmail(repository: Repository, user: User): Promise<{ sentTo: string; devCode?: string }> {
  if (verifiedChecks(user).email) throw new VerificationError(409, 'already_verified', 'Your email is already verified.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  user.challenges = {
    ...user.challenges,
    email: { hash: hashCode(user.id, code), address: user.email, expiresAt: minutesFromNow(EMAIL_CODE_MINUTES), sentAt: now(), attempts: 0 },
  };
  user.verification = { ...user.verification, email: 'pending' };

  if (devCodesAllowed()) {
    user.updatedAt = now();
    await repository.updateUser(user);
    return { sentTo: user.email, devCode: code };
  }

  await sendEmail(
    user.email,
    `${code} is your Figmark code`,
    `Your Figmark verification code is ${code}. It expires in ${EMAIL_CODE_MINUTES} minutes. If you did not sign up, ignore this email.`,
    `<p>Your Figmark verification code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>` +
      `<p>It expires in ${EMAIL_CODE_MINUTES} minutes. If you did not sign up for Figmark, ignore this email.</p>`,
  );
  user.updatedAt = now();
  await repository.updateUser(user);
  return { sentTo: user.email };
}

export async function confirmEmail(repository: Repository, user: User, code: string): Promise<void> {
  const challenge = user.challenges?.email;
  if (!challenge || Date.parse(challenge.expiresAt) < Date.now() || challenge.address !== user.email) {
    throw new VerificationError(410, 'code_expired', 'That code has expired. Send a new one.');
  }
  if (challenge.attempts >= EMAIL_CODE_ATTEMPTS) {
    throw new VerificationError(429, 'too_many_attempts', 'Too many wrong codes. Send a new one.');
  }
  if (!/^\d{6}$/.test(code.trim()) || !sameHash(challenge.hash, hashCode(user.id, code))) {
    challenge.attempts += 1;
    await repository.updateUser(user);
    throw new VerificationError(400, 'wrong_code', 'That code is not right. Check the email and try again.');
  }
  user.challenges = { ...user.challenges, email: null };
  user.verification = {
    ...user.verification,
    email: 'verified',
    proofs: { ...user.verification.proofs, email: { address: user.email, at: now() } },
  };
  user.updatedAt = now();
  await repository.updateUser(user);
}

/* ── Phone, over WhatsApp ──────────────────────────────────────────────── */

/** The exact words the person sends. The webhook reads the code and account back out of it. */
const phoneMessage = (userId: string, code: string) =>
  `Figmark verification code ${code} for account ${userId}. Send this message as it is to verify my number.`;

const PHONE_MESSAGE_PATTERN = /code\s+([A-Z0-9]{6})\s+for\s+account\s+(usr_[A-Za-z0-9_-]+)/i;

export async function startPhone(repository: Repository, user: User): Promise<{ link: string; message: string; businessNumber: string; expiresAt: string }> {
  const whatsapp = config.verification.whatsapp;
  if (!whatsapp) {
    throw new VerificationError(503, 'whatsapp_unconfigured', 'WhatsApp verification is not set up on this server yet. An operator can approve you meanwhile.');
  }
  if (verifiedChecks(user).phone) throw new VerificationError(409, 'already_verified', 'Your WhatsApp number is already verified.');
  if (!normalizeIndianMobile(user.phone)) {
    throw new VerificationError(400, 'phone_needed', 'Add your Indian mobile number first - the one linked to your Aadhaar.');
  }
  let code = '';
  for (let i = 0; i < 6; i += 1) code += PHONE_CODE_ALPHABET[randomInt(0, PHONE_CODE_ALPHABET.length)];
  const expiresAt = minutesFromNow(PHONE_CODE_MINUTES);
  user.challenges = { ...user.challenges, phone: { hash: hashCode(user.id, code), expiresAt, error: null } };
  user.verification = { ...user.verification, phone: 'pending' };
  user.updatedAt = now();
  await repository.updateUser(user);

  const message = phoneMessage(user.id, code);
  return {
    link: `https://wa.me/${whatsapp.businessNumber}?text=${encodeURIComponent(message)}`,
    message,
    businessNumber: `+${whatsapp.businessNumber}`,
    expiresAt,
  };
}

/**
 * Corrects the account's number before it is verified.
 *
 * Only before: once a number is verified it is what the Aadhaar was matched
 * against, so changing it would leave a verification standing for a number
 * nobody checked. Changing it resets both.
 */
export async function changePhone(repository: Repository, user: User, raw: string): Promise<void> {
  const phone = normalizeIndianMobile(raw);
  if (!phone) throw new VerificationError(400, 'invalid_phone', 'Enter a 10-digit Indian mobile number.');
  if (phone === user.phone) return;
  if (!(await repository.changePhone(user, phone))) {
    throw new VerificationError(409, 'phone_taken', 'That number is already on another Figmark account.');
  }
  user.challenges = { ...user.challenges, phone: null };
  user.verification = {
    ...user.verification,
    phone: 'unverified',
    governmentId: user.verification.proofs?.aadhaar ? 'unverified' : user.verification.governmentId,
    proofs: { ...user.verification.proofs, phone: null, aadhaar: null },
  };
  user.updatedAt = now();
  await repository.updateUser(user);
}

/** Meta signs each webhook body with the app secret; anything else is not from WhatsApp. */
export function whatsappSignatureValid(rawBody: string, header: string | null): boolean {
  const whatsapp = config.verification.whatsapp;
  if (!whatsapp || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', whatsapp.appSecret).update(rawBody, 'utf8').digest('hex');
  const given = header.slice(7).trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(given) && sameHash(expected, given);
}

/** A reply in the same chat. Free inside the 24 hours after they message; best-effort. */
async function reply(to: string, text: string): Promise<void> {
  const whatsapp = config.verification.whatsapp;
  if (!whatsapp?.accessToken || !whatsapp.phoneNumberId) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${whatsapp.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${whatsapp.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
  } catch {
    // The verification stands whether or not the courtesy reply arrives.
  }
}

interface InboundMessage {
  from: string;
  text: string;
}

/** The text messages in a WhatsApp Cloud API webhook body. */
export function inboundMessages(body: unknown): InboundMessage[] {
  const found: InboundMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return found;
  for (const entry of entries) {
    for (const change of (entry as { changes?: unknown[] })?.changes ?? []) {
      const messages = (change as { value?: { messages?: unknown[] } })?.value?.messages ?? [];
      for (const message of messages) {
        const m = message as { from?: unknown; type?: unknown; text?: { body?: unknown } };
        if (m.type === 'text' && typeof m.from === 'string' && typeof m.text?.body === 'string') {
          found.push({ from: m.from, text: m.text.body });
        }
      }
    }
  }
  return found;
}

/**
 * One message someone sent Figmark on WhatsApp.
 *
 * WhatsApp has already proved the sender holds that SIM, so a message carrying
 * a live code for an account, sent from that account's own number, verifies
 * the number. Anything else is answered with what went wrong - both in the
 * chat and on the screen they are waiting on.
 */
export async function handleWhatsAppMessage(repository: Repository, message: InboundMessage): Promise<'verified' | 'ignored' | 'refused'> {
  const sender = normalizeIndianMobile(message.from);
  const match = PHONE_MESSAGE_PATTERN.exec(message.text);
  if (!match) {
    await reply(message.from, 'Hi! To verify your number, tap "Verify on WhatsApp" in the Figmark app and send the message it fills in.');
    return 'ignored';
  }
  const code = match[1] ?? '';
  const userId = match[2] ?? '';
  const user = await repository.getUserById(userId);
  const challenge = user?.challenges?.phone;

  const refuse = async (why: string) => {
    if (user && challenge) {
      challenge.error = why;
      user.updatedAt = now();
      await repository.updateUser(user);
    }
    await reply(message.from, `Not verified: ${why}`);
    return 'refused' as const;
  };

  if (!user || !challenge || !sameHash(challenge.hash, hashCode(user.id, code))) {
    return refuse('that code is not one Figmark issued. Get a new one in the app.');
  }
  if (Date.parse(challenge.expiresAt) < Date.now()) return refuse('that code has expired. Get a new one in the app.');
  if (!sender) return refuse('only Indian mobile numbers (+91) can be verified, because Aadhaar carries an Indian mobile.');
  // Older accounts kept the number as typed (spaces, no +91), so compare canonical forms.
  if (sender !== normalizeIndianMobile(user.phone)) {
    return refuse(
      `you messaged from ${maskMobile(sender)}, but your Figmark account has ${maskMobile(user.phone)}. ` +
        'Send it from that number, or change the number on your account to this one and try again. ' +
        'It must be the mobile linked to your Aadhaar.',
    );
  }

  user.challenges = { ...user.challenges, phone: null };
  user.verification = {
    ...user.verification,
    phone: 'verified',
    proofs: { ...user.verification.proofs, phone: { number: sender, via: 'whatsapp', at: now() } },
  };
  user.updatedAt = now();
  await repository.updateUser(user);
  await reply(message.from, 'Your number is verified on Figmark. Next: verify your Aadhaar in the app.');
  return 'verified';
}

/* ── Aadhaar Secure QR ─────────────────────────────────────────────────── */

export async function verifyAadhaar(repository: Repository, user: User, qrText: string, consent: boolean): Promise<void> {
  if (!consent) {
    throw new VerificationError(400, 'consent_required', 'Tick the consent box to let Figmark read your Aadhaar QR.');
  }
  const certificate = config.verification.aadhaarCertificate;
  if (!certificate) {
    throw new VerificationError(503, 'aadhaar_unconfigured', 'Aadhaar verification is not set up on this server yet. An operator can approve you meanwhile.');
  }
  const checks = verifiedChecks(user);
  if (checks.aadhaar) throw new VerificationError(409, 'already_verified', 'Your Aadhaar is already verified.');
  const mobile = normalizeIndianMobile(user.phone);
  if (!checks.phone || !mobile) {
    throw new VerificationError(409, 'phone_first', 'Verify your WhatsApp number first: your Aadhaar is matched against it.');
  }

  try {
    const qr = parseSecureQr(qrText);
    if (!signatureValid(qr, loadUidaiKey(certificate))) {
      throw new AadhaarError('aadhaar_signature', 'This QR is not signed by UIDAI, or it has been altered. Scan the QR on your original Aadhaar.');
    }
    if (!qr.hasMobile || !qr.mobileHash) {
      throw new AadhaarError(
        'aadhaar_no_mobile',
        'No mobile number is linked to this Aadhaar, so it cannot be matched to your WhatsApp number. ' +
          'Link your mobile at an Aadhaar centre, download a fresh e-Aadhaar, and try again.',
      );
    }
    if (aadhaarMobileHash(mobileDigits(mobile), qr.last4) !== qr.mobileHash) {
      const hint = qr.mobileLast4 ? ` Your Aadhaar is linked to a number ending ${qr.mobileLast4};` : '';
      throw new AadhaarError(
        'aadhaar_mobile_mismatch',
        `The mobile linked to this Aadhaar is not your verified WhatsApp number (${maskMobile(user.phone)}).${hint} ` +
          'They must be the same number. Change your number in Verification to your Aadhaar-linked mobile, verify it on WhatsApp, then scan again.',
      );
    }

    user.verification = {
      ...user.verification,
      governmentId: 'verified',
      proofs: {
        ...user.verification.proofs,
        aadhaar: {
          name: qr.name.slice(0, 120), dob: qr.dob.slice(0, 20), gender: qr.gender.slice(0, 10), last4: qr.last4,
          mobile, via: 'secure_qr', at: now(),
        },
      },
    };
    user.updatedAt = now();
    await repository.updateUser(user);
  } catch (err) {
    if (err instanceof AadhaarError) {
      throw new VerificationError(err.code === 'aadhaar_unconfigured' ? 503 : 400, err.code, err.message);
    }
    throw err;
  }
}
