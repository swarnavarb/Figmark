import type { KeyObject } from 'node:crypto';
import { config } from '../config.js';
import { mobileDigits, normalizeIndianMobile } from '../../../shared/verification.js';
import { AadhaarError, aadhaarMobileHash, bundledUidaiCertificates, parseSecureQr, signatureValid, uidaiKeys } from './aadhaar.js';

/**
 * TEMPORARY - the Aadhaar test page (/verify/aadhaar-test). Delete this file, its
 * route in verify-routes.ts, the dev-server line and AadhaarTestPage.tsx when
 * testing is done.
 *
 * Runs the same checks as real verification and shows everything the QR holds,
 * so a real card can be tried end to end. It saves nothing, logs nothing and
 * answers only on a test deployment (SITE_ENVIRONMENT set, and not production).
 */
export function aadhaarTestAllowed(): boolean {
  const environment = config.siteEnvironment;
  return Boolean(environment) && environment !== 'production';
}

/** Which key made the signature: a bundled certificate's file name, or "AADHAAR_QR_CERT". */
function signer(qr: ReturnType<typeof parseSecureQr>): string | null {
  const bundled = bundledUidaiCertificates();
  const found = bundled.find((certificate) => signatureValid(qr, certificate.key));
  if (found) return found.file;
  const extra = uidaiKeys(config.verification.aadhaarCertificate).slice(bundled.length);
  return extra.some((key: KeyObject) => signatureValid(qr, key)) ? 'AADHAAR_QR_CERT setting' : null;
}

/** The same N-times SHA-256 as the mobile hash, which UIDAI also uses for the email. */
function emailHash(email: string, last4: string): string {
  return aadhaarMobileHash(email, last4);
}

/** "20260101120000123" -> "2026-01-01 12:00:00" */
function readTimestamp(digits: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(digits);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
}

export function testAadhaarQr(qrText: string, phone: string, email: string) {
  let qr: ReturnType<typeof parseSecureQr>;
  try {
    qr = parseSecureQr(qrText);
  } catch (err) {
    if (err instanceof AadhaarError) return { readable: false as const, error: err.message };
    throw err;
  }
  const signedBy = signer(qr);
  const mobile = normalizeIndianMobile(phone);
  const reference = qr.fields.referenceId ?? '';
  const ADDRESS = ['careOf', 'house', 'street', 'landmark', 'location', 'vtc', 'postOffice', 'subDistrict', 'district', 'state', 'pincode'];
  const printed = Object.fromEntries(ADDRESS.map((name) => [name, (qr.fields[name] ?? '').trim()]));

  return {
    readable: true as const,
    version: qr.version,
    signature: { valid: signedBy !== null, signedBy },
    details: {
      name: qr.name,
      dob: qr.dob,
      gender: qr.gender,
      aadhaarLast4: qr.last4,
      generatedAt: readTimestamp(reference.slice(4)),
    },
    address: printed,
    mobile: {
      linked: qr.hasMobile,
      last4OnQr: qr.mobileLast4,
      entered: mobile,
      enteredValid: Boolean(mobile) || !phone.trim(),
      matches: mobile && qr.mobileHash ? aadhaarMobileHash(mobileDigits(mobile), qr.last4) === qr.mobileHash : null,
    },
    email: {
      linked: qr.hasEmail,
      entered: email.trim() || null,
      matches: email.trim() && qr.emailHash ? emailHash(email.trim(), qr.last4) === qr.emailHash : null,
    },
    photo: qr.photo.length > 0 ? { bytes: qr.photo.length, jp2Base64: qr.photo.toString('base64') } : null,
    /** What real verification would answer for this QR and number. */
    wouldVerify: signedBy !== null && qr.hasMobile && Boolean(mobile) && qr.mobileHash === aadhaarMobileHash(mobileDigits(mobile ?? ''), qr.last4),
  };
}
