import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { LoginRequest, MeResponse, SignupRequest } from '../../../shared/contracts.js';
import { MockAuthProvider } from '../auth/mock-provider.js';
import { getAuthService } from '../auth/index.js';
import { error, handler, json } from './http.js';

/** POST /api/auth/login - exchange credentials for a session. */
async function login(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();

  let body: LoginRequest;
  try {
    body = (await request.json()) as LoginRequest;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const result = await auth.login(body);
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

  const result = await auth.signup(body);
  return json(201, result, auth.loginCookies(result.token));
}

/** POST /api/auth/logout - always succeeds, signed in or not. */
async function logout(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  await auth.logout(request);
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
  return json(200, body);
}

export const loginRoute = handler(login);
export const signupRoute = handler(signup);
export const logoutRoute = handler(logout);
export const meRoute = handler(me);

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

app.http('auth-me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: meRoute,
});
