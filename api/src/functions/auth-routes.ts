import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import type { AuthUser, LoginRequest, MeResponse, SignupRequest, SignupResponse } from '../../../shared/contracts.js';
import { VerificationError, startEmail } from '../verification/index.js';
import { MockAuthProvider } from '../auth/mock-provider.js';
import { getAuthService } from '../auth/index.js';
import { error, handler, json } from './http.js';
import { getRepository } from '../data/index.js';
import { claimCookieReferrals } from '../affiliate.js';
import { claimInvite, visitorCookieIfMissing } from '../share.js';
import { clientIp, limited } from '../rate-limit.js';
import { deviceCookieValue } from '../auth/tokens.js';
import { deletionBlockers, eraseAccount } from '../account-deletion.js';
import { captchaPasses } from '../captcha.js';
import { USERNAME_PROBLEMS, checkUsername } from '../../../shared/handles.js';

/** One address trying too many sign-ins or sign-ups, whichever accounts they name. */
async function addressLimited(request: HttpRequest, action: 'login' | 'signup') {
  const wait = await limited(clientIp(request), action);
  return wait
    ? error(429, 'too_many_attempts', `Too many attempts from this network. Try again in ${wait}.`)
    : null;
}

/**
 * A referral link followed before signing in now belongs to this account, and
 * a brand-new account is filed under whoever invited it.
 */
async function claimReferrals(request: HttpRequest, userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    const repository = await getRepository();
    await claimCookieReferrals(repository, request, userId);
    await claimInvite(repository, request, userId);
  } catch {
    // Never let a referral stand between somebody and their account.
  }
}

/**
 * The email code goes out as the account is made, so the next screen can ask
 * for it. A failure to send is reported, not fatal: the account exists, and
 * the code can be re-sent from the screen that asks for it.
 */
async function sendFirstEmailCode(userId: string | undefined): Promise<SignupResponse['emailCode']> {
  if (!userId) return { sent: false, error: 'No account to send to.' };
  try {
    const repository = await getRepository();
    const user = await repository.getUserById(userId);
    if (!user) return { sent: false, error: 'No account to send to.' };
    const sent = await startEmail(repository, user);
    return { sent: true, ...(sent.devCode ? { devCode: sent.devCode } : {}) };
  } catch (err) {
    return { sent: false, error: err instanceof VerificationError ? err.message : 'The code could not be sent. Send it again.' };
  }
}

/** POST /api/auth/login - exchange credentials for a session. */
async function login(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();

  let body: LoginRequest;
  try {
    body = (await request.json()) as LoginRequest;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const slow = await addressLimited(request, 'login');
  if (slow) return slow;

  const device = auth instanceof MockAuthProvider ? deviceCookieValue(request.headers.get('cookie')) : null;
  const result = await auth.login(body, { ip: clientIp(request), device });
  await claimReferrals(request, result.user?.id);
  // The session cookie only: the device cookie follows on /api/auth/me, since
  // a response reaches the browser with one Set-Cookie at most (see `json`).
  return json(200, result, auth.loginCookies(result.token));
}

/** POST /api/auth/signup - create an account and sign straight in. */
async function signup(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  // Registration belongs to the identity provider, so only the mock offers it.
  if (!(auth instanceof MockAuthProvider)) {
    return error(501, 'not_implemented', 'Sign-up is handled by the identity provider.');
  }

  let body: SignupRequest;
  try {
    body = (await request.json()) as SignupRequest;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const slow = await addressLimited(request, 'signup');
  if (slow) return slow;
  if (!(await captchaPasses(body.captchaToken, clientIp(request)))) {
    return error(400, 'captcha_failed', 'Please complete the check that you are a person, then try again.');
  }

  const result = await auth.signup(body);
  await claimReferrals(request, result.user?.id);
  return json(201, { ...result, emailCode: await sendFirstEmailCode(result.user?.id) }, auth.loginCookies(result.token));
}

/** POST /api/auth/logout - always succeeds, signed in or not. */
async function logout(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  await auth.logout(request);
  return json(200, { ok: true }, auth.logoutCookies());
}

/**
 * POST /api/auth/logout-all - end every session this account has, everywhere.
 *
 * For a lost phone or a shared computer left signed in. This device is signed
 * out too, and every other one at its next request.
 */
async function logoutAll(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  if (!(auth instanceof MockAuthProvider)) {
    return error(501, 'not_implemented', 'Sessions are managed by the identity provider. Sign out there.');
  }
  await auth.logoutEverywhere(request);
  return json(200, { ok: true }, auth.logoutCookies());
}

/**
 * GET /api/auth/me - the current principal.
 *
 * Returns 200 with `user: null` when signed out rather than 401, so the client
 * can render a logged-out view without treating it as an error.
 */
async function me(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.getCurrentUser(request);
  const body: MeResponse = { user, authMode: auth.mode };
  // A cookie that resolves to nobody is dead weight the browser would otherwise
  // resend forever, so shed it here rather than only on a failing call.
  // A live one, on the other hand, is renewed while it is in use - every app
  // load asks this - so nobody is signed out in the middle of using it.
  // Then, with no renewal to send, the device cookie the sign-in could not
  // carry - one cookie per response (see `json`).
  let cookies: string[] = [];
  if (auth instanceof MockAuthProvider) {
    cookies = user ? await auth.refreshCookies(request) : await auth.staleCookies(request);
    if (user && cookies.length === 0) cookies = await auth.missingDeviceCookies(user.id, request);
  }
  // A guest with nothing else to set gets the visitor cookie that opening a
  // shared link has no room for.
  if (!user && cookies.length === 0) cookies = visitorCookieIfMissing(request);
  return json(200, body, cookies);
}

/**
 * POST /api/auth/reset/start - { identifier }: email a password reset code.
 *
 * Always "sent" when the request is well formed: whether an account exists,
 * or has a confirmed email, is not this form's to say.
 */
async function resetStart(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  if (!(auth instanceof MockAuthProvider)) {
    return error(501, 'not_implemented', 'Passwords are managed by the identity provider. Reset it there.');
  }
  let body: { identifier?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const wait = await limited(clientIp(request), 'reset');
  if (wait) return error(429, 'too_many_attempts', `Too many attempts from this network. Try again in ${wait}.`);
  try {
    const sent = await auth.requestPasswordReset(body.identifier ?? '');
    return json(200, {
      sent: true,
      message: 'If that account has a confirmed email, a code is on its way to it.',
      ...(sent.devCode ? { devCode: sent.devCode } : {}),
    });
  } catch (err) {
    if (err instanceof VerificationError) return error(err.status, err.code, err.message);
    throw err;
  }
}

/** POST /api/auth/reset/confirm - { identifier, code, password }: set a new password and sign in. */
async function resetConfirm(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  if (!(auth instanceof MockAuthProvider)) {
    return error(501, 'not_implemented', 'Passwords are managed by the identity provider. Reset it there.');
  }
  let body: { identifier?: string; code?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const wait = await limited(clientIp(request), 'reset');
  if (wait) return error(429, 'too_many_attempts', `Too many attempts from this network. Try again in ${wait}.`);
  const result = await auth.resetPassword(body, { ip: clientIp(request) });
  return json(200, result, auth.loginCookies(result.token));
}

/**
 * POST /api/me/delete - { password }: delete this account, by its owner.
 *
 * The password is asked again: a session left open on a shared computer must
 * not be enough to erase somebody. Refused, with the reason, while money is
 * held on one of its orders or a dispute it is in is open - the same rule the
 * operations console follows.
 */
async function deleteMe(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  if (!(auth instanceof MockAuthProvider)) {
    return error(501, 'not_implemented', 'Accounts are managed by the identity provider. Delete it there.');
  }
  const user = await auth.requireAuth(request);
  let body: { password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const slow = await addressLimited(request, 'login');
  if (slow) return slow;
  if (!(await auth.passwordMatches(user.id, body.password ?? ''))) {
    return error(403, 'wrong_password', 'That is not your password.');
  }
  const repository = await getRepository();
  const blockers = await deletionBlockers(user.id, repository);
  if (blockers.length > 0) return error(409, 'has_live_money', blockers.join(' '));
  await auth.logout(request);
  const deleted = await eraseAccount(user.id, repository);
  return json(200, { deleted }, auth.logoutCookies());
}

/** The signed-in account under the built-in provider, with its JSON body; or the refusal. */
async function ownAccount(request: HttpRequest): Promise<
  { refusal: HttpResponseInit } | { auth: MockAuthProvider; user: AuthUser; body: { password?: string; code?: string } }
> {
  const auth = await getAuthService();
  if (!(auth instanceof MockAuthProvider)) {
    return { refusal: error(501, 'not_implemented', 'Sign-in is managed by the identity provider. Set two-factor up there.') };
  }
  const user = await auth.requireAuth(request);
  let body: { password?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return { refusal: error(400, 'invalid_body', 'Request body must be JSON.') };
  }
  const slow = await addressLimited(request, 'login');
  if (slow) return { refusal: slow };
  return { auth, user, body };
}

/** POST /api/me/mfa/setup - { password }: a new authenticator key to add to an app. */
async function mfaSetup(request: HttpRequest, _context: InvocationContext) {
  const own = await ownAccount(request);
  if ('refusal' in own) return own.refusal;
  return json(200, await own.auth.startMfaSetup(own.user.id, own.body.password ?? ''));
}

/** POST /api/me/mfa/enable - { code }: the first code from the new key turns two-factor on. */
async function mfaEnable(request: HttpRequest, _context: InvocationContext) {
  const own = await ownAccount(request);
  if ('refusal' in own) return own.refusal;
  return json(200, await own.auth.enableMfa(own.user.id, own.body.code ?? ''));
}

/** POST /api/me/mfa/disable - { password, code }: two-factor off. */
async function mfaDisable(request: HttpRequest, _context: InvocationContext) {
  const own = await ownAccount(request);
  if ('refusal' in own) return own.refusal;
  await own.auth.disableMfa(own.user.id, own.body.password ?? '', own.body.code ?? '');
  return json(200, { ok: true });
}

export const loginRoute = handler(login);
export const mfaSetupRoute = handler(mfaSetup);
export const mfaEnableRoute = handler(mfaEnable);
export const mfaDisableRoute = handler(mfaDisable);
export const deleteMeRoute = handler(deleteMe);
export const resetStartRoute = handler(resetStart);
export const resetConfirmRoute = handler(resetConfirm);
export const signupRoute = handler(signup);
/**
 * GET /api/auth/username/{name} - whether a username can still be claimed.
 *
 * Asked as somebody types it on the sign-up form, so the answer arrives before
 * they press the button rather than as a refusal after. Who holds a name is
 * no secret - every handle is a public page - so this says only yes or no.
 */
async function usernameAvailable(request: HttpRequest, _context: InvocationContext) {
  const wait = await limited(clientIp(request), 'handle_check');
  if (wait) return error(429, 'too_many_attempts', `Too many checks from this network. Try again in ${wait}.`);
  const wanted = (request.params.name ?? '').trim().toLowerCase();
  const problem = checkUsername(wanted);
  if (problem) return json(200, { username: wanted, available: false, reason: USERNAME_PROBLEMS[problem] });
  const repository = await getRepository();
  const taken = (await repository.getByHandle(wanted)) !== null;
  return json(200, { username: wanted, available: !taken, reason: taken ? `@${wanted} is already taken.` : null });
}

export const logoutRoute = handler(logout);
export const usernameAvailableRoute = handler(usernameAvailable);
export const meRoute = handler(me);
export const logoutAllRoute = handler(logoutAll);

app.http('auth-signup', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/signup',
  handler: signupRoute,
});

app.http('auth-login', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: loginRoute,
});

app.http('auth-reset-start', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/reset/start',
  handler: resetStartRoute,
});

app.http('auth-reset-confirm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/reset/confirm',
  handler: resetConfirmRoute,
});

app.http('me-mfa-setup', { methods: ['POST'], authLevel: 'anonymous', route: 'me/mfa/setup', handler: mfaSetupRoute });
app.http('me-mfa-enable', { methods: ['POST'], authLevel: 'anonymous', route: 'me/mfa/enable', handler: mfaEnableRoute });
app.http('me-mfa-disable', { methods: ['POST'], authLevel: 'anonymous', route: 'me/mfa/disable', handler: mfaDisableRoute });

app.http('me-delete', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'me/delete',
  handler: deleteMeRoute,
});

app.http('auth-logout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: logoutRoute,
});

app.http('auth-logout-all', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/logout-all',
  handler: logoutAllRoute,
});

app.http('auth-me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: meRoute,
});

app.http('auth-username', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/username/{name}',
  handler: usernameAvailableRoute,
});
