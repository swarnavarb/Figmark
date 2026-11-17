/**
 * Verification, end to end: email code, WhatsApp number, Aadhaar Secure QR,
 * what they unlock, what an operator can override, and the session key.
 *
 * Runs against the compiled API (`npm run build:api` first). UIDAI's real
 * certificate cannot sign test data, so a key made here stands in for it and
 * the QR is built the way UIDAI builds one - fields, photo, mobile hash and a
 * signature over all of it, compressed and written as one decimal number.
 */
import assert from 'node:assert/strict';
import { fixtures, useFixtures } from './fixtures.mjs';
import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

// Configuration is read once at import, so it goes in first.
process.env.FIGMARK_RATE_LIMITS = 'off';
process.env.ADMIN_EMAILS = 'demo@figmark.in,ops-lead@verify.example';
process.env.WHATSAPP_BUSINESS_NUMBER = '+91 90000 00001';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.AADHAAR_QR_CERT = publicKey.export({ type: 'spki', format: 'pem' });

const dist = new URL('../api/dist/', import.meta.url);
const fns = new URL('api/src/functions/', dist);
const { signupRoute: signup, loginRoute: login, meRoute: me } = await import(new URL('auth-routes.js', fns));
const {
  verifyStatusRoute: status, verifyEmailSendRoute: emailSend, verifyEmailConfirmRoute: emailConfirm,
  verifyPhoneStartRoute: phoneStart, verifyPhoneNumberRoute: phoneNumber, verifyAadhaarRoute: aadhaar,
  whatsappWebhookRoute: webhook, verifyEmailChangeRoute: emailChange, verifyEmailChangeConfirmRoute: emailChangeConfirm,
  verifyReviewRoute: review,
} = await import(new URL('verify-routes.js', fns));
const { createOrderRoute: createOrder } = await import(new URL('catalog-routes.js', fns));
const { adminRightsRoute: rights, adminUsersRoute: adminUsers, adminReviewsRoute: adminReviews } = await import(new URL('admin-routes.js', fns));
const { publicProfileRoute: publicProfile } = await import(new URL('message-routes.js', fns));
await useFixtures();
const { getRepository } = await import(new URL('api/src/data/index.js', dist));
const { MemoryRepository } = await import(new URL('api/src/data/memory-repository.js', dist));
const { MockAuthProvider } = await import(new URL('api/src/auth/mock-provider.js', dist));
const { aadhaarMobileHash, parseSecureQr, bundledUidaiKeys, loadUidaiKeys, signedByAny, uidaiKeys } =
  await import(new URL('api/src/verification/aadhaar.js', dist));

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
const req = ({ headers = {}, body, query = {}, params = {}, method = 'POST', raw } = {}) => ({
  method,
  headers: new Headers(headers),
  query: new URLSearchParams(query),
  params,
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
  text: async () => raw ?? JSON.stringify(body ?? {}),
});

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const repository = await getRepository();

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** A Secure QR as UIDAI makes one, for `mobile` (ten digits), signed by `key`. */
function secureQr({ mobile, last4 = '5678', key = privateKey, withMobile = true, name = 'Priya Nair' }) {
  const fields = ['V2', withMobile ? '2' : '0', `${last4}20260101120000000`, name, '01-02-1990', 'F',
    'D/O Someone', 'Pune', '', '12', 'Kothrud', '411038', 'Kothrud', 'Maharashtra', 'Main Road', 'Pune', 'Pune',
    withMobile ? mobile.slice(-4) : ''];
  const body = Buffer.concat([
    Buffer.from(fields.join('\xff') + '\xff', 'latin1'),
    Buffer.from('fake-jp2-photo-bytes', 'latin1'),
    withMobile ? Buffer.from(aadhaarMobileHash(mobile, last4), 'hex') : Buffer.alloc(0),
  ]);
  const signed = Buffer.concat([body, sign('sha256', body, key)]);
  return BigInt(`0x${gzipSync(signed).toString('hex')}`).toString(10);
}

/** A WhatsApp Cloud API webhook delivery, signed as Meta signs it. */
function whatsappDelivery(from, text, secret = 'test-app-secret') {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [{ from, type: 'text', text: { body: text } }] } }] }],
  });
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return req({ raw, headers: { 'x-hub-signature-256': signature } });
}

async function newAccount(name, phone) {
  const made = await signup(req({
    body: { acceptTerms: true, displayName: name, email: `${name.toLowerCase().replace(/\W/g, '')}@verify.example`, phone, password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return { id: made.jsonBody.user.id, made, headers: { authorization: `Bearer ${made.jsonBody.token}` } };
}

const statusOf = async (who) => (await status(req({ method: 'GET', headers: who.headers }), ctx)).jsonBody;
const meOf = async (who) => (await me(req({ method: 'GET', headers: who.headers }), ctx)).jsonBody.user;

/* ── Sign-up and email ─────────────────────────────────────────────────── */
console.log('sign-up and email');

const priya = await newAccount('Priya', '+91 98765 43210');

await check('sign-up verifies nothing, and stores the phone in one canonical form', async () => {
  const user = priya.made.jsonBody.user;
  assert.equal(user.phone, '+919876543210');
  assert.equal(user.verification.phone, 'unverified');
  assert.equal(user.verification.email, 'pending');
  assert.equal(user.capabilities.canBuy, false);
  assert.equal(user.capabilities.canSell, false);
});

await check('sign-up refuses a number that is not an Indian mobile', async () => {
  const bad = await signup(req({ body: { acceptTerms: true, displayName: 'Abroad', email: 'abroad@verify.example', phone: '+1 415 555 0100', password: 'longenough1' } }), ctx);
  assert.equal(bad.status, 400);
  assert.match(bad.jsonBody.message, /Aadhaar/);
});

await check('an unverified account cannot buy, and is told how to fix it', async () => {
  const refused = await createOrder(req({ headers: priya.headers, body: { listingId: 'anything' } }), ctx);
  assert.equal(refused.status, 403);
  assert.equal(refused.jsonBody.error, 'verification_required');
  assert.match(refused.jsonBody.message, /WhatsApp/);
});

await check('the email code goes out with the account (shown on screen only on a local run)', async () => {
  assert.equal(priya.made.jsonBody.emailCode.sent, true);
  assert.match(priya.made.jsonBody.emailCode.devCode, /^\d{6}$/);
  const stored = await repository.getUserById(priya.id);
  assert.ok(stored.challenges.email.hash, 'held as a hash');
  assert.ok(!JSON.stringify(priya.made.jsonBody.user).includes(stored.challenges.email.hash), 'never sent to the client');
});

await check('a wrong code is refused; the right one verifies the email', async () => {
  const code = priya.made.jsonBody.emailCode.devCode;
  const wrong = await emailConfirm(req({ headers: priya.headers, body: { code: code === '000000' ? '111111' : '000000' } }), ctx);
  assert.equal(wrong.status, 400);
  const right = await emailConfirm(req({ headers: priya.headers, body: { code } }), ctx);
  assert.equal(right.status, 200, JSON.stringify(right.jsonBody));
  assert.equal(right.jsonBody.status.checks.email, true);
});

await check('a code cannot be used twice, and a new one can be sent', async () => {
  const again = await emailSend(req({ headers: priya.headers }), ctx);
  assert.equal(again.status, 409, 'already verified');
});

/* ── WhatsApp ──────────────────────────────────────────────────────────── */
console.log('\nWhatsApp');

await check('Aadhaar waits for the WhatsApp number it is matched against', async () => {
  const early = await aadhaar(req({ headers: priya.headers, body: { qr: secureQr({ mobile: '9876543210' }), consent: true } }), ctx);
  assert.equal(early.status, 409);
  assert.equal(early.jsonBody.error, 'phone_first');
});

let phoneMessage;
await check('starting gives a wa.me link to the business number with the message filled in', async () => {
  const started = await phoneStart(req({ headers: priya.headers }), ctx);
  assert.equal(started.status, 200, JSON.stringify(started.jsonBody));
  assert.ok(started.jsonBody.link.startsWith('https://wa.me/919000000001?text='));
  assert.ok(started.jsonBody.message.includes(priya.id));
  phoneMessage = started.jsonBody.message;
});

await check("Meta's subscription handshake is answered only with the right token", async () => {
  const good = await webhook(req({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '42' } }), ctx);
  assert.equal(good.status, 200);
  assert.equal(good.body, '42');
  const bad = await webhook(req({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '42' } }), ctx);
  assert.equal(bad.status, 403);
});

await check('a delivery not signed with the app secret is refused unread', async () => {
  const forged = await webhook(whatsappDelivery('919876543210', phoneMessage, 'not-the-secret'), ctx);
  assert.equal(forged.status, 401);
  assert.equal((await statusOf(priya)).checks.phone, false);
});

await check('the code sent from a different number does not verify, and says why', async () => {
  const other = await webhook(whatsappDelivery('919811111111', phoneMessage), ctx);
  assert.equal(other.status, 200);
  assert.deepEqual(other.jsonBody.results, ['refused']);
  const now = await statusOf(priya);
  assert.equal(now.checks.phone, false);
  assert.match(now.phoneChallenge.error, /1111/);
  assert.match(now.phoneChallenge.error, /3210/);
});

await check('a made-up code does not verify', async () => {
  const guessed = await webhook(whatsappDelivery('919876543210', phoneMessage.replace(/code \w+/, 'code ZZZZZZ')), ctx);
  assert.deepEqual(guessed.jsonBody.results, ['refused']);
});

await check("the code sent from the account's own number verifies it", async () => {
  const sent = await webhook(whatsappDelivery('919876543210', phoneMessage), ctx);
  assert.deepEqual(sent.jsonBody.results, ['verified']);
  const now = await statusOf(priya);
  assert.equal(now.checks.phone, true);
  assert.equal(now.phoneChallenge, null);
});

await check('email and phone open buying, but not selling', async () => {
  const user = await meOf(priya);
  assert.equal(user.capabilities.canBuy, true);
  assert.equal(user.capabilities.canSell, false);
});

/* ── Aadhaar ───────────────────────────────────────────────────────────── */
console.log('\nAadhaar');

await check('nothing is read without consent', async () => {
  const noConsent = await aadhaar(req({ headers: priya.headers, body: { qr: secureQr({ mobile: '9876543210' }), consent: false } }), ctx);
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.jsonBody.error, 'consent_required');
});

await check('something that is not a Secure QR is refused', async () => {
  const junk = await aadhaar(req({ headers: priya.headers, body: { qr: 'hello', consent: true } }), ctx);
  assert.equal(junk.status, 400);
  assert.equal(junk.jsonBody.error, 'aadhaar_unreadable');
});

await check('a QR not signed by UIDAI is refused', async () => {
  const forged = await aadhaar(req({ headers: priya.headers, body: { qr: secureQr({ mobile: '9876543210', key: otherKey }), consent: true } }), ctx);
  assert.equal(forged.status, 400);
  assert.equal(forged.jsonBody.error, 'aadhaar_signature');
});

await check('an Aadhaar with no linked mobile is refused', async () => {
  const none = await aadhaar(req({ headers: priya.headers, body: { qr: secureQr({ mobile: '9876543210', withMobile: false }), consent: true } }), ctx);
  assert.equal(none.jsonBody.error, 'aadhaar_no_mobile');
});

await check("an Aadhaar linked to another mobile is refused, naming that number's last digits", async () => {
  const mismatch = await aadhaar(req({ headers: priya.headers, body: { qr: secureQr({ mobile: '9123456789' }), consent: true } }), ctx);
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.jsonBody.error, 'aadhaar_mobile_mismatch');
  assert.match(mismatch.jsonBody.message, /6789/);
  assert.match(mismatch.jsonBody.message, /same number/);
});

await check('the hash is checked for every last digit (one round for 0 and 1, n for the rest)', async () => {
  // Each last digit hashes a different number of times; all must line up.
  for (const last4 of ['1230', '1231', '1239']) {
    const parsed = parseSecureQr(secureQr({ mobile: '9876543210', last4 }));
    assert.equal(parsed.last4, last4);
    assert.equal(parsed.mobileHash, aadhaarMobileHash('9876543210', last4));
  }
  const once = createHash('sha256').update('9876543210').digest('hex');
  assert.equal(aadhaarMobileHash('9876543210', '0000'), once);
  assert.equal(aadhaarMobileHash('9876543210', '0001'), once);
  const twice = createHash('sha256').update(once).digest('hex');
  assert.equal(aadhaarMobileHash('9876543210', '0002'), twice);
});

await check('the matching Aadhaar verifies, keeping only name, birth date, gender and last four', async () => {
  const ok = await aadhaar(req({ headers: priya.headers, body: { qr: secureQr({ mobile: '9876543210' }), consent: true } }), ctx);
  assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
  assert.equal(ok.jsonBody.status.checks.aadhaar, true);
  const stored = (await repository.getUserById(priya.id)).verification.proofs.aadhaar;
  assert.deepEqual(Object.keys(stored).sort(), ['at', 'dob', 'gender', 'last4', 'mobile', 'name', 'via']);
  assert.equal(stored.last4, '5678');
  assert.equal(stored.name, 'Priya Nair');
  assert.ok(!JSON.stringify(stored).includes('Kothrud'), 'no address kept');
});

await check('all three open buying and selling', async () => {
  const user = await meOf(priya);
  assert.equal(user.capabilities.canBuy, true);
  assert.equal(user.capabilities.canSell, true);
});

await check("a person's public page says which checks passed", async () => {
  const page = await publicProfile(req({ method: 'GET', params: { handle: (await meOf(priya)).username } }), ctx);
  assert.equal(page.status, 200);
  assert.deepEqual(page.jsonBody.verified, { email: true, phone: true, aadhaar: true });
});

/* ── Changing the number ───────────────────────────────────────────────── */
console.log('\nchanging the number');

const ravi = await newAccount('Ravi', '9811122233');

await check("a number on somebody else's account is refused", async () => {
  const taken = await phoneNumber(req({ headers: ravi.headers, body: { phone: '+919876543210' } }), ctx);
  assert.equal(taken.status, 409);
});

await check('a corrected number becomes the sign-in identifier, and the old one is let go', async () => {
  const changed = await phoneNumber(req({ headers: ravi.headers, body: { phone: '098111 22244' } }), ctx);
  assert.equal(changed.status, 200, JSON.stringify(changed.jsonBody));
  assert.equal(changed.jsonBody.status.phone, '+919811122244');
  assert.equal((await repository.getUserByIdentifier('+919811122244')).id, ravi.id);
  assert.equal(await repository.getUserByIdentifier('+919811122233'), null);
  const signedIn = await login(req({ body: { identifier: '+919811122244', password: 'longenough1' } }), ctx);
  assert.equal(signedIn.status, 200);
});

/* ── Changing the email ────────────────────────────────────────────────── */
console.log('\nchanging the email');

await check('the email moves only once the new inbox returns the code, and the password is asked', async () => {
  const mover = await newAccount('Mover', '9811122233');
  const wrongPassword = await emailChange(req({ headers: mover.headers, body: { email: 'moved@verify.example', password: 'nope' } }), ctx);
  assert.equal(wrongPassword.status, 403);
  const taken = await emailChange(req({ headers: mover.headers, body: { email: 'priya@verify.example', password: 'longenough1' } }), ctx);
  assert.equal(taken.status, 409);

  const started = await emailChange(req({ headers: mover.headers, body: { email: 'Moved@Verify.example', password: 'longenough1' } }), ctx);
  assert.equal(started.status, 200, JSON.stringify(started.jsonBody));
  assert.equal((await meOf(mover)).email, 'mover@verify.example', 'nothing changes before the code');
  assert.equal((await emailChangeConfirm(req({ headers: mover.headers, body: { code: started.jsonBody.devCode === '000000' ? '111111' : '000000' } }), ctx)).status, 400);
  assert.equal((await emailChangeConfirm(req({ headers: mover.headers, body: { code: started.jsonBody.devCode } }), ctx)).status, 200);

  const now = await meOf(mover);
  assert.equal(now.email, 'moved@verify.example');
  assert.equal((await statusOf(mover)).checks.email, true, 'the new address is verified by the code');
  // Signs in under the new address, not the old.
  assert.equal((await login(req({ body: { identifier: 'moved@verify.example', password: 'longenough1' } }), ctx)).status, 200);
  assert.equal((await login(req({ body: { identifier: 'mover@verify.example', password: 'longenough1' } }), ctx)).status, 401);
});

await check('an operator address is no use to whoever registers it without proving the inbox', async () => {
  const squatter = await newAccount('Ops Lead', '9811177744');
  const row = await repository.getUserById(squatter.id);
  row.email = 'ops-lead@verify.example';
  await repository.updateUser(row);
  assert.equal((await meOf(squatter)).capabilities.isAdmin, false, 'unconfirmed: not an operator');
  const sent = await emailSend(req({ headers: squatter.headers, body: {} }), ctx);
  await emailConfirm(req({ headers: squatter.headers, body: { code: sent.jsonBody.devCode } }), ctx);
  assert.equal((await meOf(squatter)).capabilities.isAdmin, true, 'confirmed: an operator');
});

/* ── Older accounts ────────────────────────────────────────────────────── */
console.log('\nolder accounts');

await check('an account marked verified before real checks existed is not trusted', async () => {
  const legacy = await newAccount('Legacy', '9822233344');
  const row = await repository.getUserById(legacy.id);
  row.verification = { ...row.verification, phone: 'verified', email: 'verified', governmentId: 'verified', proofs: undefined };
  await repository.updateUser(row);
  const user = await meOf(legacy);
  assert.equal(user.capabilities.canBuy, false);
  assert.equal(user.capabilities.canSell, false);
});

await check('an older account with its number stored as typed can still verify it on WhatsApp', async () => {
  const older = await newAccount('Older', '9833344455');
  const row = await repository.getUserById(older.id);
  row.phone = '+91 98333 44455';
  await repository.updateUser(row);
  const started = await phoneStart(req({ headers: older.headers }), ctx);
  const sent = await webhook(whatsappDelivery('919833344455', started.jsonBody.message), ctx);
  assert.deepEqual(sent.jsonBody.results, ['verified']);
});

/* ── Operators ─────────────────────────────────────────────────────────── */
console.log('\noperators');

const operatorSession = await login(req({ body: { identifier: 'demo@figmark.in', password: 'figmark123' } }), ctx);
const operator = { authorization: `Bearer ${operatorSession.jsonBody.token}` };

await check('the user list shows each check and what it allows', async () => {
  const list = await adminUsers(req({ method: 'GET', headers: operator, query: { q: 'Priya' } }), ctx);
  const row = list.jsonBody.users.find((entry) => entry.id === priya.id);
  assert.deepEqual(row.verified, { email: true, phone: true, aadhaar: true });
  assert.equal(row.canBuy, true);
  assert.equal(row.aadhaar.last4, '5678');
});

await check('granting needs a reason', async () => {
  const bare = await rights(req({ headers: operator, params: { id: ravi.id }, body: { buy: 'grant', sell: 'auto' } }), ctx);
  assert.equal(bare.status, 400);
  assert.equal(bare.jsonBody.error, 'reason_required');
});

await check('an operator can let an unverified account trade', async () => {
  const granted = await rights(req({ headers: operator, params: { id: ravi.id }, body: { buy: 'grant', sell: 'grant', reason: 'No WhatsApp; checked by phone call' } }), ctx);
  assert.equal(granted.status, 200, JSON.stringify(granted.jsonBody));
  assert.equal(granted.jsonBody.user.canBuy, true);
  assert.equal(granted.jsonBody.user.tradeOverride.reason, 'No WhatsApp; checked by phone call');
  assert.equal((await meOf(ravi)).capabilities.canSell, true);
});

await check('and stop a verified one, then hand it back to verification', async () => {
  const blocked = await rights(req({ headers: operator, params: { id: priya.id }, body: { buy: 'auto', sell: 'block', reason: 'Counterfeit listings' } }), ctx);
  assert.equal(blocked.jsonBody.user.canSell, false);
  assert.equal(blocked.jsonBody.user.canBuy, true);
  const back = await rights(req({ headers: operator, params: { id: priya.id }, body: { buy: 'auto', sell: 'auto' } }), ctx);
  assert.equal(back.jsonBody.user.canSell, true);
  assert.equal(back.jsonBody.user.tradeOverride, null);
});

await check('only an operator can change rights', async () => {
  const self = await rights(req({ headers: ravi.headers, params: { id: ravi.id }, body: { buy: 'grant', sell: 'grant', reason: 'me' } }), ctx);
  assert.equal(self.status, 403);
});

/* ── Manual review ─────────────────────────────────────────────────────── */
console.log('\nmanual review');

const meera = await newAccount('Meera', '+91 91234 56780');
const reviewQueue = async () => (await adminReviews(req({ method: 'GET', headers: operator }), ctx)).jsonBody.users;

await check('asking for a review needs a step and a line about what is wrong', async () => {
  const noStep = await review(req({ headers: meera.headers, body: { note: 'No WhatsApp on my phone at all' } }), ctx);
  assert.equal(noStep.status, 400);
  assert.equal(noStep.jsonBody.error, 'invalid_step');
  const noNote = await review(req({ headers: meera.headers, body: { stuckOn: 'whatsapp', note: 'help' } }), ctx);
  assert.equal(noNote.status, 400);
  assert.equal(noNote.jsonBody.error, 'note_required');
});

await check('a request is recorded, marks nothing verified, and reaches the operator queue', async () => {
  const asked = await review(req({ headers: meera.headers, body: { stuckOn: 'whatsapp', note: 'I do not use WhatsApp at all' } }), ctx);
  assert.equal(asked.status, 200, JSON.stringify(asked.jsonBody));
  assert.equal(asked.jsonBody.status.review.stuckOn, 'whatsapp');
  assert.deepEqual(asked.jsonBody.status.checks, { email: false, phone: false, aadhaar: false });
  assert.deepEqual(asked.jsonBody.status.access, { canBuy: false, canSell: false, byOperator: false });
  const queue = await reviewQueue();
  assert.equal(queue.find((row) => row.id === meera.id)?.reviewRequest.note, 'I do not use WhatsApp at all');
});

await check('it can be taken back', async () => {
  const back = await review(req({ headers: meera.headers, body: { withdraw: true } }), ctx);
  assert.equal(back.jsonBody.status.review, null);
  assert.equal((await reviewQueue()).some((row) => row.id === meera.id), false);
});

await check('only an operator sees the queue', async () => {
  const self = await adminReviews(req({ method: 'GET', headers: meera.headers }), ctx);
  assert.equal(self.status, 403);
});

await check("an operator's grant answers it, opens trading and tells the person", async () => {
  await review(req({ headers: meera.headers, body: { stuckOn: 'whatsapp', note: 'I do not use WhatsApp at all' } }), ctx);
  const granted = await rights(req({ headers: operator, params: { id: meera.id }, body: { buy: 'grant', sell: 'auto', reason: 'Checked on a video call' } }), ctx);
  assert.equal(granted.status, 200, JSON.stringify(granted.jsonBody));
  assert.equal(granted.jsonBody.user.reviewRequest, null);
  assert.equal((await reviewQueue()).some((row) => row.id === meera.id), false);
  const now = await statusOf(meera);
  assert.deepEqual(now.access, { canBuy: true, canSell: false, byOperator: true });
  assert.equal(now.checks.phone, false, 'a grant is not a verification tick');
  const [notice] = await repository.listNotifications(meera.id, 5);
  assert.equal(notice.kind, 'verification_review');
  assert.match(notice.title, /You can buy/);
  assert.doesNotMatch(notice.body, /video call/, "a grant's reason is the operator's note, not shown");
});

await check('turning one down passes the reason on', async () => {
  await rights(req({ headers: operator, params: { id: meera.id }, body: { buy: 'auto', sell: 'auto' } }), ctx);
  await review(req({ headers: meera.headers, body: { stuckOn: 'aadhaar', note: 'My Aadhaar has no mobile linked' } }), ctx);
  const declined = await rights(req({ headers: operator, params: { id: meera.id }, body: { buy: 'auto', sell: 'auto', reason: 'Please link a mobile first.' } }), ctx);
  assert.equal(declined.jsonBody.user.reviewRequest, null);
  const [notice] = await repository.listNotifications(meera.id, 5);
  assert.match(notice.title, /not approved/);
  assert.match(notice.body, /Please link a mobile first\./);
});

await check('a fully verified account has nothing to review', async () => {
  const done = await review(req({ headers: priya.headers, body: { stuckOn: 'aadhaar', note: 'Just checking this out' } }), ctx);
  assert.equal(done.status, 409);
});

/* ── The session key ───────────────────────────────────────────────────── */
console.log('\nsession key');

await check('with no signing key, nothing is issued or accepted', async () => {
  const store = new MemoryRepository(fixtures.fixtureSet());
  await store.init();
  const keyless = new MockAuthProvider(store, '', 3600);
  await assert.rejects(keyless.login({ identifier: 'demo@figmark.in', password: 'figmark123' }), (err) => err.code === 'sign_in_unavailable');
  // A token "signed" with an empty key must not get anybody in.
  const keyed = new MockAuthProvider(store, '', 3600);
  const forged = `${Buffer.from(JSON.stringify({ sub: 'usr_demo', exp: Date.now() / 1000 + 600 })).toString('base64url')}.x`;
  assert.equal(await keyed.getCurrentUser(req({ method: 'GET', headers: { authorization: `Bearer ${forged}` } })), null);
});

await check("UIDAI's signing certificates ship with the API, old ones included", async () => {
  // DS 03 (2017) through DS 06 (2026-2029): a card printed under any of them still checks.
  assert.equal(bundledUidaiKeys().length, 9);
  for (const key of bundledUidaiKeys()) assert.equal(key.asymmetricKeyType, 'rsa');
});

await check('a QR signed with any one of several keys is accepted, and only those', async () => {
  const { publicKey: older, privateKey: olderPrivate } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pems = [older, publicKey].map((key) => key.export({ type: 'spki', format: 'pem' })).join('\n');
  const base64 = [older, publicKey].map((key) => key.export({ type: 'spki', format: 'der' }).toString('base64')).join(',');
  for (const setting of [pems, base64]) {
    const keys = loadUidaiKeys(setting);
    assert.equal(keys.length, 2);
    assert.ok(signedByAny(parseSecureQr(secureQr({ mobile: '9876543210', key: olderPrivate })), keys));
    assert.ok(signedByAny(parseSecureQr(secureQr({ mobile: '9876543210' })), keys));
    assert.ok(!signedByAny(parseSecureQr(secureQr({ mobile: '9876543210', key: otherKey })), keys));
  }
});

await check('the setting adds to the bundled keys, and a bad one does not switch them off', async () => {
  assert.equal(uidaiKeys(process.env.AADHAAR_QR_CERT).length, 10);
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(uidaiKeys('not a certificate').length, 9);
  } finally {
    console.error = quiet;
  }
});

console.log(`\n${passed} verification checks passed`);
