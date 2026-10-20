import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { meRoute } from './auth-routes.js';
import { healthRoute } from './health.js';
import { handler, json } from './http.js';
import { pushKeyRoute } from './push-routes.js';
import { questMeRoute } from './quest-routes.js';
import { routeWordsRoute } from './route-admin-routes.js';
import { myInviteRoute } from './share-routes.js';
import { myItemsRoute } from './tracking-routes.js';

/**
 * GET /api/bootstrap - the reads every page load starts with, in one request.
 *
 * Each used to be its own request and its own function invocation: who is
 * signed in, the status banners, the route short forms, the push key and, for
 * a signed-in account, its items, invite and quest. The answers here are the
 * very same handlers' answers, keyed by the path the app would have asked,
 * with their status - the app files each where its own request would have.
 * The session's cookie, which /api/auth/me may renew, comes through as well.
 */
type Route = (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>;

const ALWAYS: [string, Route][] = [
  ['/auth/me', meRoute],
  ['/health', healthRoute],
  ['/route-words', routeWordsRoute],
  ['/push/key', pushKeyRoute],
];

const SIGNED_IN: [string, Route][] = [
  ['/me/items', myItemsRoute],
  ['/invite/me', myInviteRoute],
  ['/quest/me', questMeRoute],
];

async function bootstrap(request: HttpRequest, context: InvocationContext) {
  const answers: Record<string, { status: number; body: unknown }> = {};
  const run = async ([path, route]: [string, Route]) => {
    const response = await route(request, context);
    answers[path] = { status: response.status ?? 200, body: response.jsonBody ?? null };
    return response;
  };
  const [me] = await Promise.all(ALWAYS.map(run));
  const signedIn = Boolean((me?.jsonBody as { user?: unknown } | undefined)?.user);
  if (signedIn) await Promise.all(SIGNED_IN.map(run));

  const cookies = me?.headers instanceof Headers ? me.headers.getSetCookie() : [];
  const response = json(200, { answers }, cookies);
  // Who is signed in is in it: never shared, never kept.
  (response.headers as Headers).set('Cache-Control', 'no-store');
  return response;
}

export const bootstrapRoute = handler(bootstrap);

app.http('bootstrap', { authLevel: 'anonymous', methods: ['GET'], route: 'bootstrap', handler: bootstrapRoute });
