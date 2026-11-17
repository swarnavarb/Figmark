import { constants, createHash, publicDecrypt, type KeyObject } from 'node:crypto';
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
    signature: { valid: signedBy !== null, signedBy, bytes: qr.signature.length, diagnosis: diagnoseSignature(qr) },
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
      // Legacy QRs hash the whole number; versioned ones only print its last four digits.
      method: qr.versioned ? 'last4' as const : 'hash' as const,
      matches: !mobile
        ? null
        : qr.versioned
          ? (qr.mobileLast4 ? mobile.endsWith(qr.mobileLast4) : null)
          : (qr.mobileHash ? aadhaarMobileHash(mobileDigits(mobile), qr.last4) === qr.mobileHash : null),
    },
    email: {
      linked: qr.hasEmail,
      entered: email.trim() || null,
      // Versioned QRs carry no email hash, so an email cannot be checked against them.
      checkable: !qr.versioned,
      matches: email.trim() && qr.emailHash ? emailHash(email.trim(), qr.last4) === qr.emailHash : null,
    },
    photo: qr.photo.length > 0 ? { bytes: qr.photo.length, jp2Base64: qr.photo.toString('base64') } : null,
    /** What real verification would answer for this QR and number. */
    wouldVerify: signedBy !== null && qr.hasMobile && Boolean(mobile) && (qr.versioned
      ? Boolean(qr.mobileLast4 && mobile?.endsWith(qr.mobileLast4))
      : qr.mobileHash === aadhaarMobileHash(mobileDigits(mobile ?? ''), qr.last4)),
  };
}

/* ── Why a signature does not check ────────────────────────────────────── */

const DIGEST_INFO: { hash: string; prefix: string }[] = [
  { hash: 'md5', prefix: '3020300c06082a864886f70d020505000410' },
  { hash: 'sha1', prefix: '3021300906052b0e03021a05000414' },
  { hash: 'sha1', prefix: '301f300706052b0e03021a0414' },
  { hash: 'sha224', prefix: '302d300d06096086480165030402040500041c' },
  { hash: 'sha256', prefix: '3031300d060960864801650304020105000420' },
  { hash: 'sha384', prefix: '3041300d060960864801650304020205000430' },
  { hash: 'sha512', prefix: '3051300d060960864801650304020305000440' },
];

export interface KeyDiagnosis {
  certificate: string;
  keyBits: number;
  /**
   * pkcs1: this key made the signature (standard RSA padding); hash says with
   * what. pss: it decodes as PSS padding. none: not made by this key.
   */
  outcome: 'pkcs1' | 'pss' | 'none';
  hash: string | null;
  /** Which part of the QR the signed digest is of, when one of ours matches; null if none does. */
  digestOf: string | null;
}

/**
 * Opens the signature with each public key, without checking it, to see which
 * key made it and over what. A key that made it reveals PKCS#1 padding and the
 * digest inside; comparing that digest with digests of different parts of the
 * QR shows whether the checker hashes the wrong bytes. No key revealing any
 * structure means the signer is a key we do not hold.
 */
export function diagnoseSignature(qr: ReturnType<typeof parseSecureQr>): KeyDiagnosis[] {
  const bundled = bundledUidaiCertificates();
  const extra = uidaiKeys(config.verification.aadhaarCertificate).slice(bundled.length)
    .map((key, i) => ({ file: `AADHAAR_QR_CERT #${i + 1}`, key }));
  const data = qr.decompressed;
  const sigStart = data.length - qr.signature.length;
  const candidates: [string, Buffer][] = [
    ['everything before the signature (the standard)', qr.signedData],
    ['the whole decompressed QR', data],
    ['the text fields and photo, without the email/mobile hashes', data.subarray(0, sigStart - (qr.mobileHash ? 32 : 0) - (qr.emailHash ? 32 : 0))],
    ['the text fields only', data.subarray(0, sigStart - qr.photo.length - (qr.mobileHash ? 32 : 0) - (qr.emailHash ? 32 : 0))],
    ['the compressed bytes', qr.compressed],
  ];

  return [...bundled, ...extra].map(({ file, key }) => {
    const keyBits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    let opened: Buffer;
    try {
      opened = publicDecrypt({ key, padding: constants.RSA_NO_PADDING }, qr.signature);
    } catch {
      return { certificate: file, keyBits, outcome: 'none', hash: null, digestOf: null };
    }
    const hex = opened.toString('hex');
    const pkcs1 = /^0001(ff)+00([0-9a-f]+)$/.exec(hex);
    if (pkcs1) {
      const info = pkcs1[2] ?? '';
      const known = DIGEST_INFO.find((entry) => info.startsWith(entry.prefix));
      if (!known) return { certificate: file, keyBits, outcome: 'pkcs1', hash: 'unknown', digestOf: null };
      const digest = info.slice(known.prefix.length);
      const match = candidates.find(([, bytes]) => createHash(known.hash).update(bytes).digest('hex') === digest);
      return { certificate: file, keyBits, outcome: 'pkcs1', hash: known.hash, digestOf: match?.[0] ?? null };
    }
    // PSS ends in 0xbc with a clear top bit; random-looking output from the wrong key almost never does both.
    if (hex.endsWith('bc') && opened[0] !== undefined && opened[0] < 0x80) {
      return { certificate: file, keyBits, outcome: 'pss', hash: null, digestOf: null };
    }
    return { certificate: file, keyBits, outcome: 'none', hash: null, digestOf: null };
  });
}
