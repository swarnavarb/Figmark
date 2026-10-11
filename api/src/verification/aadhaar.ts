import { X509Certificate, createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

/**
 * Aadhaar Secure QR, read and checked offline.
 *
 * The QR on every Aadhaar letter, e-Aadhaar PDF and the mAadhaar app holds one
 * long decimal number. Turned into bytes and decompressed, it is a run of
 * fields separated by 0xFF, then the photo, then SHA-256 hashes of the linked
 * email and mobile, then a 256-byte RSA signature by UIDAI over everything
 * before it. Checking that signature against UIDAI's published certificate
 * proves the fields are UIDAI's and unedited - no network call, no fee, no
 * licence. (UIDAI, "Secure QR Code - Specification", and pyaadhaar's reader.)
 *
 * The mobile hash is the part that matters here. It is SHA-256 applied to the
 * ten-digit number N times, N being the last digit of the Aadhaar number (0 and
 * 1 both mean once). Hashing the account's WhatsApp-verified number the same
 * way and comparing is what ties this Aadhaar to the person holding that SIM.
 */

const SIGNATURE_BYTES = 256;
const HASH_BYTES = 32;

const FIELDS_V1 = [
  'emailMobileStatus', 'referenceId', 'name', 'dob', 'gender', 'careOf', 'district', 'landmark',
  'house', 'location', 'pincode', 'postOffice', 'state', 'street', 'subDistrict', 'vtc',
] as const;
/** 2022 onwards: a leading "V2" and the mobile's last four digits in the clear. */
const FIELDS_V2 = ['version', ...FIELDS_V1, 'mobileLast4'] as const;

export interface SecureQr {
  version: 'V1' | 'V2';
  name: string;
  dob: string;
  gender: string;
  /** The last four digits of the Aadhaar number. */
  last4: string;
  /** Only V2 prints these; null on older QRs. */
  mobileLast4: string | null;
  hasMobile: boolean;
  /** Hex, or null when no mobile is linked. */
  mobileHash: string | null;
  signedData: Buffer;
  signature: Buffer;
}

export class AadhaarError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** The decimal string in the QR, as bytes. */
function decimalToBytes(decimal: string): Buffer {
  let hex = BigInt(decimal).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Buffer.from(hex, 'hex');
}

function decompress(bytes: Buffer): Buffer {
  // UIDAI's own readers use gzip; tolerate the plain and raw deflate a
  // re-encoding app might hand over.
  for (const attempt of [gunzipSync, inflateSync, inflateRawSync]) {
    try {
      return attempt(bytes);
    } catch {
      /* try the next */
    }
  }
  throw new AadhaarError('aadhaar_unreadable', 'That is not an Aadhaar Secure QR. Scan the QR code on your Aadhaar or e-Aadhaar.');
}

export function parseSecureQr(raw: string): SecureQr {
  const decimal = raw.replace(/\s/g, '');
  if (!/^\d{200,10000}$/.test(decimal)) {
    throw new AadhaarError(
      'aadhaar_unreadable',
      'That is not an Aadhaar Secure QR. Scan the large QR code on your Aadhaar letter, e-Aadhaar PDF or mAadhaar app.',
    );
  }
  const data = decompress(decimalToBytes(decimal));
  if (data.length < SIGNATURE_BYTES + 64) throw new AadhaarError('aadhaar_unreadable', 'The QR was cut short. Scan it again.');

  const version = data.subarray(0, 2).toString('latin1') === 'V2' ? 'V2' : 'V1';
  const names = version === 'V2' ? FIELDS_V2 : FIELDS_V1;
  const fields: Record<string, string> = {};
  let start = 0;
  for (const name of names) {
    const end = data.indexOf(0xff, start);
    if (end < 0) throw new AadhaarError('aadhaar_unreadable', 'The QR was cut short. Scan it again.');
    fields[name] = data.subarray(start, end).toString('latin1');
    start = end + 1;
  }

  const field = (name: string) => fields[name] ?? '';
  const status = Number(field('emailMobileStatus'));
  const hasMobile = status === 2 || status === 3;
  const end = data.length - SIGNATURE_BYTES;
  return {
    version,
    name: field('name').trim(),
    dob: field('dob').trim(),
    gender: field('gender').trim(),
    last4: field('referenceId').slice(0, 4),
    mobileLast4: version === 'V2' && /^\d{4}$/.test(field('mobileLast4')) ? field('mobileLast4') : null,
    hasMobile,
    // The mobile hash sits immediately before the signature, whether or not
    // an email hash precedes it.
    mobileHash: hasMobile ? data.subarray(end - HASH_BYTES, end).toString('hex') : null,
    signedData: data.subarray(0, end),
    signature: data.subarray(end),
  };
}

/** UIDAI's key from configuration: a PEM certificate, a PEM public key, or base64 DER of either. */
export function loadUidaiKey(configured: string): KeyObject {
  const text = configured.replace(/\\n/g, '\n').trim();
  const candidates: (string | Buffer)[] = [text];
  if (!text.includes('-----BEGIN')) candidates.push(Buffer.from(text.replace(/\s/g, ''), 'base64'));
  for (const candidate of candidates) {
    try {
      return new X509Certificate(candidate).publicKey;
    } catch {
      /* not a certificate */
    }
    try {
      return typeof candidate === 'string'
        ? createPublicKey(candidate)
        : createPublicKey({ key: candidate, format: 'der', type: 'spki' });
    } catch {
      /* not a bare key either */
    }
  }
  throw new AadhaarError('aadhaar_unconfigured', 'AADHAAR_QR_CERT is set but is not a certificate or public key.');
}

export function signatureValid(qr: SecureQr, key: KeyObject): boolean {
  try {
    return verify('sha256', qr.signedData, key, qr.signature);
  } catch {
    return false;
  }
}

/** The mobile hash UIDAI would have written for this ten-digit number. */
export function aadhaarMobileHash(tenDigits: string, last4: string): string {
  const lastDigit = Number(last4.slice(-1));
  const rounds = lastDigit <= 1 ? 1 : lastDigit;
  let value = tenDigits;
  for (let i = 0; i < rounds; i += 1) value = createHash('sha256').update(value).digest('hex');
  return value;
}
