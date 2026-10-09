import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { LoginRequest, MeResponse, SignupRequest, SignupResponse } from '../../../shared/contracts.js';
import { VerificationError, startEmail } from '../verification/index.js';
import { MockAuthProvider } from '../auth/mock-provider.js';
import { getAuthService } from '../auth/index.js';
import { error, handler, json } from './http.js';
import { getRepository } from '../data/index.js';
import { claimCookieReferrals } from '../affiliate.js';
import { claimInvite } from '../share.js';
import { clientIp, limited } from '../rate-limit.js';
import { deviceCookieValue } from '../auth/tokens.js';

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
  const cookies = [...auth.loginCookies(result.token)];
  if (auth instanceof MockAuthProvider && result.user) cookies.push(...auth.deviceCookies(result.user.id, request));
  return json(200, result, cookies);
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

  const result = await auth.signup(body);
  await claimReferrals(request, result.user?.id);
  const cookies = [...auth.loginCookies(result.token), ...(result.user ? auth.deviceCookies(result.user.id, request) : [])];
  return json(201, { ...result, emailCode: await sendFirstEmailCode(result.user?.id) }, cookies);
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
  const cookies = auth instanceof MockAuthProvider
    ? user ? await auth.refreshCookies(request) : await auth.staleCookies(request)
    : [];
  return json(200, body, cookies);
}

export const loginRoute = handler(login);
export const signupRoute = handler(signup);
export const logoutRoute = handler(logout);
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
