import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { clientIp, tooFast } from '../rate-limit.js';
import { error, handler, json } from './http.js';

/*
 * The account's own data, as the Privacy Policy promises: everything it holds,
 * downloadable in one file. And the browser's own errors, reported back so a
 * page that breaks on somebody's phone shows up in the logs.
 */

/**
 * GET /api/me/export - every record this account made or is party to, as JSON.
 *
 * What only the server keeps for itself - password hash, two-factor key,
 * pending codes - is left out by the response itself (see STORE_FIELDS).
 */
async function exportMine(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const slow = await tooFast(user.id, 'export');
  if (slow) return slow;
  const repository = await getRepository();
  const account = await repository.getUserById(user.id);
  if (!account) return error(404, 'not_found', 'Your account could not be found.');

  const handles = [account.username, account.sellerProfile?.username].filter((handle): handle is string => Boolean(handle));
  const [listings, lots, purchases, sales, posts, reviewsAboutYou, disputes, wants, likes, follows, messages] = await Promise.all([
    repository.listListings({ sellerId: user.id, includeHidden: true }),
    repository.listLots({ sellerId: user.id }),
    repository.listOrdersForBuyer(user.id),
    repository.listOrdersForSeller(user.id),
    repository.listPostsByAuthor(user.id),
    repository.listReviewsAbout(user.id),
    repository.listDisputesForParty(user.id),
    repository.listWantsBy(user.id),
    repository.listLikesBy(user.id),
    repository.listFollowsBy(user.id),
    handles.length > 0 ? repository.listMessagesForHandles(handles, 5000) : Promise.resolve([]),
  ]);

  const body = {
    exportedAt: new Date().toISOString(),
    note: 'Everything Figmark holds about this account. Passwords, two-factor keys and pending codes are never included.',
    account, listings, lots, purchases, sales, posts, reviewsAboutYou, disputes, wants, likes, follows, messages,
  };
  const response = json(200, body);
  const day = new Date().toISOString().slice(0, 10);
  (response.headers as Headers).set('Content-Disposition', `attachment; filename="figmark-${account.username ?? account.id}-${day}.json"`);
  (response.headers as Headers).set('Cache-Control', 'no-store');
  return response;
}

/**
 * POST /api/client-errors - { message, stack?, url?, kind? }: a browser's error.
 *
 * Logged, never stored or echoed: Application Insights picks it up from the
 * log like any server error, and alerts can be set on it there. Signed in or
 * not; cut short and rate limited per address.
 */
async function clientError(request: HttpRequest, context: InvocationContext) {
  const slow = await tooFast(clientIp(request), 'clienterror');
  if (slow) return slow;
  let body: { message?: unknown; stack?: unknown; url?: unknown; kind?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
  const report = {
    kind: text(body.kind, 40) || 'error',
    message: text(body.message, 500),
    stack: text(body.stack, 2000),
    url: text(body.url, 300).replace(/[?#].*$/, ''),
    agent: (request.headers.get('user-agent') ?? '').slice(0, 200),
  };
  if (!report.message) return error(400, 'invalid_report', 'Say what went wrong.');
  context.warn(`Client error: ${JSON.stringify(report)}`);
  return json(202, { logged: true });
}

export const exportMineRoute = handler(exportMine);
export const clientErrorRoute = handler(clientError);

const anon = { authLevel: 'anonymous' as const };
app.http('me-export', { ...anon, methods: ['GET'], route: 'me/export', handler: exportMineRoute });
app.http('client-errors', { ...anon, methods: ['POST'], route: 'client-errors', handler: clientErrorRoute });
