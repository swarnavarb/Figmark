import type { VerificationState } from './models.js';

/**
 * The three checks that unlock buying and selling, and what passing them means.
 *
 * Email: a code sent to the address was typed back.
 * Phone: the number messaged Figmark on WhatsApp with the account's code, so
 *   the person holds that SIM.
 * Aadhaar: a UIDAI-signed Secure QR whose mobile hash matches that same
 *   WhatsApp-verified number - which is what ties the Aadhaar to this person
 *   rather than to whoever had a photo of the card.
 *
 * Each needs its proof as well as its status. Accounts made before real
 * verification existed were marked verified at sign-up with nothing checked;
 * the missing proof is what keeps them from passing for verified now.
 */
export interface VerifiedChecks {
  email: boolean;
  phone: boolean;
  aadhaar: boolean;
}

export function verifiedChecks(subject: { verification: VerificationState }): VerifiedChecks {
  const { verification } = subject;
  const proofs = verification.proofs ?? {};
  return {
    email: verification.email === 'verified' && Boolean(proofs.email),
    phone: verification.phone === 'verified' && Boolean(proofs.phone),
    aadhaar: verification.governmentId === 'verified' && Boolean(proofs.aadhaar),
  };
}

/** All three, which is the bar for buying and for selling alike. */
export function fullyVerified(subject: { verification: VerificationState }): boolean {
  const checks = verifiedChecks(subject);
  return checks.email && checks.phone && checks.aadhaar;
}

/**
 * An Indian mobile number as one canonical string, `+91XXXXXXXXXX`, or null.
 *
 * Accepts what people actually type - spaces, dashes, a leading 0, 91 or +91 -
 * and refuses anything that is not ten digits starting 6 to 9, which is every
 * Indian mobile and nothing else. Aadhaar carries an Indian mobile, so a
 * number outside India could never complete verification anyway.
 */
export function normalizeIndianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** The ten digits after +91, as Aadhaar hashes them. */
export function mobileDigits(e164: string): string {
  return e164.replace(/^\+91/, '');
}

/** `+91 ••••• •3210`, for saying which number without printing it all. */
export function maskMobile(e164: string | null | undefined): string {
  if (!e164) return 'no number';
  const digits = mobileDigits(e164);
  return `+91 ••••• •${digits.slice(-4)}`;
}

/** Shown wherever a number is asked for, so the mismatch is caught before it happens. */
export const AADHAAR_MOBILE_RULE =
  'Use the mobile number linked to your Aadhaar, on WhatsApp. Aadhaar verification only passes when your ' +
  'WhatsApp number and your Aadhaar-linked mobile are the same number.';

