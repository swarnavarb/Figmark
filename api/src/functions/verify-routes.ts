import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import type { User } from '../../../shared/models.js';
import { getAuthService } from '../auth/index.js';
import { config } from '../config.js';
import { getRepository } from '../data/index.js';
import { tooFast } from '../rate-limit.js';
import {
  VerificationError, changePhone, confirmEmail, handleWhatsAppMessage, inboundMessages, startEmail, startPhone,
  statusOf, verifyAadhaar, whatsappSignatureValid,
} from '../verification/index.js';
import { error, handler, json } from './http.js';

/**
 * Verification: email by code, phone over WhatsApp, Aadhaar by its signed QR.
 * The logic is in api/src/verification; this is the HTTP around it.
 */

/** The signed-in account's full row - verification reads and writes fields the session does not carry. */
async function signedInRow(request: HttpRequest): Promise<User> {
  const auth = await getAuthService();
  const principal = await auth.requireAuth(request);
  const repository = await getRepository();
  const user = await repository.getUserById(principal.id);
  if (!user) throw new VerificationError(404, 'not_found', 'Your account could not be found.');
  return user;
}

/** Wraps a route so a VerificationError becomes its own status and message. */
function verifying(fn: (request: HttpRequest) => Promise<HttpResponseInit>) {
  return handler(async (request: HttpRequest, _context: InvocationContext) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof VerificationError) return error(err.status, err.code, err.message);
      throw err;
    }
  });
}

async function readJson(request: HttpRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** GET /api/verify/status - where each check stands, and what this server can run. */
async function status(request: HttpRequest) {
  return json(200, statusOf(await signedInRow(request)));
}

/** POST /api/verify/email/send - a fresh code to the account's email. */
async function emailSend(request: HttpRequest) {
  const user = await signedInRow(request);
  const slow = tooFast(user.id, 'verify_email');
  if (slow) return slow;
  const repository = await getRepository();
  const sent = await startEmail(repository, user);
  return json(200, { ...sent, status: statusOf(user) });
}

/** POST /api/verify/email/confirm - { code }. */
async function emailConfirm(request: HttpRequest) {
  const user = await signedInRow(request);
  const slow = tooFast(user.id, 'verify_code');
  if (slow) return slow;
  const body = await readJson(request);
  await confirmEmail(await getRepository(), user, String(body.code ?? ''));
  return json(200, { status: statusOf(user) });
}

/** POST /api/verify/phone/start - the WhatsApp message to send, and the link that opens it. */
async function phoneStart(request: HttpRequest) {
  const user = await signedInRow(request);
  const slow = tooFast(user.id, 'verify_phone');
  if (slow) return slow;
  const started = await startPhone(await getRepository(), user);
  return json(200, { ...started, status: statusOf(user) });
}

/** POST /api/verify/phone/number - { phone }: correct the number before verifying it. */
async function phoneNumber(request: HttpRequest) {
  const user = await signedInRow(request);
  const slow = tooFast(user.id, 'verify_phone');
  if (slow) return slow;
  const body = await readJson(request);
  await changePhone(await getRepository(), user, String(body.phone ?? ''));
  return json(200, { status: statusOf(user) });
}

/** POST /api/verify/aadhaar - { qr, consent }: the Secure QR's number, as scanned. */
async function aadhaar(request: HttpRequest) {
  const user = await signedInRow(request);
  const slow = tooFast(user.id, 'verify_aadhaar');
  if (slow) return slow;
  const body = await readJson(request);
  await verifyAadhaar(await getRepository(), user, String(body.qr ?? ''), body.consent === true);
  return json(200, { status: statusOf(user) });
}

/**
 * GET|POST /api/verify/whatsapp/webhook - WhatsApp Cloud API.
 *
 * GET is Meta's one-time subscription handshake: echo the challenge when the
 * verify token matches. POST is each incoming message, signed with the app
 * secret; an unsigned or wrongly signed body is refused before it is read.
 * Always 200 on a signed body, even when a message does not verify, because
 * Meta retries anything else and the person has already been told why.
 */
async function whatsappWebhook(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const whatsapp = config.verification.whatsapp;
  if (!whatsapp) return error(503, 'whatsapp_unconfigured', 'WhatsApp verification is not configured.');

  if (request.method === 'GET') {
    const mode = request.query.get('hub.mode');
    const token = request.query.get('hub.verify_token');
    const challenge = request.query.get('hub.challenge') ?? '';
    if (mode === 'subscribe' && token === whatsapp.verifyToken) {
      return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: challenge };
    }
    return error(403, 'forbidden', 'Verify token does not match.');
  }

  const raw = await request.text();
  if (!whatsappSignatureValid(raw, request.headers.get('x-hub-signature-256'))) {
    return error(401, 'bad_signature', 'Webhook signature does not match.');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const results: string[] = [];
  for (const message of inboundMessages(body)) {
    try {
      results.push(await handleWhatsAppMessage(repository, message));
    } catch (err) {
      context.error('WhatsApp verification failed', err);
      results.push('failed');
    }
  }
  return json(200, { ok: true, results });
}

export const verifyStatusRoute = verifying(status);
export const verifyEmailSendRoute = verifying(emailSend);
export const verifyEmailConfirmRoute = verifying(emailConfirm);
export const verifyPhoneStartRoute = verifying(phoneStart);
export const verifyPhoneNumberRoute = verifying(phoneNumber);
export const verifyAadhaarRoute = verifying(aadhaar);
export const whatsappWebhookRoute = handler(whatsappWebhook);

const anon = { authLevel: 'anonymous' as const };
app.http('verify-status', { ...anon, methods: ['GET'], route: 'verify/status', handler: verifyStatusRoute });
app.http('verify-email-send', { ...anon, methods: ['POST'], route: 'verify/email/send', handler: verifyEmailSendRoute });
app.http('verify-email-confirm', { ...anon, methods: ['POST'], route: 'verify/email/confirm', handler: verifyEmailConfirmRoute });
app.http('verify-phone-start', { ...anon, methods: ['POST'], route: 'verify/phone/start', handler: verifyPhoneStartRoute });
app.http('verify-phone-number', { ...anon, methods: ['POST'], route: 'verify/phone/number', handler: verifyPhoneNumberRoute });
app.http('verify-aadhaar', { ...anon, methods: ['POST'], route: 'verify/aadhaar', handler: verifyAadhaarRoute });
app.http('verify-whatsapp-webhook', { ...anon, methods: ['GET', 'POST'], route: 'verify/whatsapp/webhook', handler: whatsappWebhookRoute });
