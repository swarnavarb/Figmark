/**
 * Local dev server: serves the built frontend and mounts the compiled API
 * handlers on /api, without needing the Azure Functions Core Tools.
 *
 * Run `npm run build` first, then `node scripts/dev-server.mjs`. For live
 * reload during frontend work use `npm run dev` (Vite) with the Functions host
 * on :7071 instead; this exists so the whole stack can be exercised anywhere,
 * including CI.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = join(root, 'app', 'dist');
const apiRoot = new URL('../api/dist/api/src/functions/', import.meta.url);

const { healthRoute } = await import(new URL('health.js', apiRoot));
const { loginRoute, logoutRoute, meRoute, signupRoute } = await import(new URL('auth-routes.js', apiRoot));
const {
  feedRoute, listingDetailRoute, createListingRoute, toggleLikeRoute, bumpListingRoute,
  addCommentRoute, toggleFollowRoute, createOrderRoute, myActivityRoute, forwardersRoute,
} = await import(new URL('catalog-routes.js', apiRoot));
const {
  myLotsRoute, createLotRoute, lotContentsRoute, assignToLotRoute,
  advanceStageRoute, setTrackingRoute, updateLotDetailsRoute, orderTrackingRoute,
  lotsBoardRoute, lotBoardRoute, setCheckpointRoute, exporterLotsRoute, exporterLotRoute,
} = await import(new URL('fulfilment-routes.js', apiRoot));
const { storefrontRoute, updateStorefrontRoute, dashboardRoute, myStoresRoute, updateManagersRoute } =
  await import(new URL('seller-routes.js', apiRoot));
const {
  socialFeedRoute, channelsRoute, channelThreadRoute, createPostRoute,
  listForumsRoute, createForumRoute,
} = await import(new URL('social-routes.js', apiRoot));
const { inboxRoute, threadRoute, sendMessageRoute, publicProfileRoute, setUsernameRoute } =
  await import(new URL('message-routes.js', apiRoot));
const {
  payRoute, confirmRoute, reviewRoute, orderStateRoute, reviewsAboutRoute, checkoutRoute,
} = await import(new URL('order-routes.js', apiRoot));
const {
  openDisputeRoute, readDisputeRoute, replyDisputeRoute, offerDisputeRoute,
  acceptDisputeRoute, withdrawDisputeRoute, escalateDisputeRoute,
  settleAsEscrowRoute, escrowHoldingsRoute,
} = await import(new URL('dispute-routes.js', apiRoot));
const {
  adminUsersRoute, adminUserDetailRoute, adminSuspendRoute, adminDeleteUserRoute,
  adminDeleteResourceRoute, adminEscrowRoute, adminDisputesRoute, adminResolveRoute,
} = await import(new URL('admin-routes.js', apiRoot));

/**
 * [method, path pattern, handler]. `:name` segments become route params.
 * Mirrors the routes registered with app.http() in the API.
 */
const routes = [
  ['GET', '/api/health', healthRoute],
  ['GET', '/api/auth/me', meRoute],
  ['POST', '/api/auth/login', loginRoute],
  ['POST', '/api/auth/signup', signupRoute],
  ['POST', '/api/auth/logout', logoutRoute],
  ['GET', '/api/feed', feedRoute],
  ['GET', '/api/forwarders', forwardersRoute],
  ['GET', '/api/me/activity', myActivityRoute],
  ['POST', '/api/orders', createOrderRoute],
  ['POST', '/api/listings', createListingRoute],
  ['GET', '/api/listings/:id', listingDetailRoute],
  ['POST', '/api/listings/:id/like', toggleLikeRoute],
  ['POST', '/api/listings/:id/bump', bumpListingRoute],
  ['POST', '/api/listings/:id/comments', addCommentRoute],
  ['POST', '/api/sellers/:id/follow', toggleFollowRoute],
  ['GET', '/api/me/lots/board', lotsBoardRoute],
  ['GET', '/api/me/lots', myLotsRoute],
  ['GET', '/api/lots/:id/board', lotBoardRoute],
  ['POST', '/api/orders/:id/checkpoint', setCheckpointRoute],
  ['POST', '/api/lots', createLotRoute],
  ['GET', '/api/lots/:id/contents', lotContentsRoute],
  ['POST', '/api/lots/:id/assign', assignToLotRoute],
  ['POST', '/api/lots/:id/stage', advanceStageRoute],
  ['POST', '/api/lots/:id/tracking', setTrackingRoute],
  ['POST', '/api/lots/:id/details', updateLotDetailsRoute],
  ['GET', '/api/orders/:id', orderTrackingRoute],
  ['GET', '/api/me/storefront', storefrontRoute],
  ['POST', '/api/me/storefront/save', updateStorefrontRoute],
  ['GET', '/api/me/dashboard', dashboardRoute],
  ['GET', '/api/me/stores', myStoresRoute],
  ['POST', '/api/me/storefront/managers', updateManagersRoute],
  ['GET', '/api/social/feed', socialFeedRoute],
  ['GET', '/api/social/channels', channelsRoute],
  ['GET', '/api/social/channels/:id', channelThreadRoute],
  ['POST', '/api/social/posts', createPostRoute],
  ['GET', '/api/social/forums', listForumsRoute],
  ['POST', '/api/social/forums/new', createForumRoute],
  ['GET', '/api/messages', inboxRoute],
  ['GET', '/api/messages/:handle', threadRoute],
  ['POST', '/api/messages/:handle/send', sendMessageRoute],
  ['GET', '/api/u/:handle', publicProfileRoute],
  ['POST', '/api/me/username', setUsernameRoute],
  ['GET', '/api/orders/:id/state', orderStateRoute],
  ['GET', '/api/orders/:id/checkout', checkoutRoute],
  ['POST', '/api/orders/:id/pay', payRoute],
  ['POST', '/api/orders/:id/confirm', confirmRoute],
  ['POST', '/api/orders/:id/dispute', openDisputeRoute],
  ['POST', '/api/orders/:id/review', reviewRoute],
  ['GET', '/api/disputes/:id', readDisputeRoute],
  ['POST', '/api/disputes/:id/reply', replyDisputeRoute],
  ['POST', '/api/disputes/:id/offer', offerDisputeRoute],
  ['POST', '/api/disputes/:id/accept', acceptDisputeRoute],
  ['POST', '/api/disputes/:id/withdraw', withdrawDisputeRoute],
  ['POST', '/api/disputes/:id/escalate', escalateDisputeRoute],
  ['POST', '/api/disputes/:id/settle', settleAsEscrowRoute],
  ['GET', '/api/escrow/holdings', escrowHoldingsRoute],
  ['GET', '/api/ops/users', adminUsersRoute],
  ['GET', '/api/ops/users/:id', adminUserDetailRoute],
  ['POST', '/api/ops/users/:id/suspend', adminSuspendRoute],
  ['POST', '/api/ops/users/:id/delete', adminDeleteUserRoute],
  ['POST', '/api/ops/users/:id/escrow', adminEscrowRoute],
  ['POST', '/api/ops/resources/delete', adminDeleteResourceRoute],
  ['GET', '/api/ops/disputes', adminDisputesRoute],
  ['POST', '/api/ops/disputes/:id/resolve', adminResolveRoute],
  ['GET', '/api/users/:id/reviews', reviewsAboutRoute],
  ['GET', '/api/exporter/lots', exporterLotsRoute],
  ['GET', '/api/exporter/lots/:id', exporterLotRoute],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

function matchRoute(method, pathname) {
  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternParts.length; i += 1) {
      const expected = patternParts[i];
      const actual = pathParts[i];
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
      else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler, params };
  }
  return null;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Pass the handler's own Set-Cookie headers through.
 *
 * This server used to build the cookie itself from the structured `cookies`
 * form, which meant it emitted a session cookie whether or not the API produced
 * a usable header - so a deployment where the cookie never reached the browser
 * looked perfect locally. It now forwards what the handler actually set, and
 * nothing else.
 *
 * `Secure` is the one edit: this server is plain HTTP, and a Secure cookie
 * would be discarded by the browser. Production is HTTPS-only.
 */
function setCookiesOf(result) {
  const headers = result.headers;
  const raw = headers instanceof Headers ? headers.getSetCookie() : [];
  return raw.map((cookie) =>
    cookie
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.toLowerCase() !== 'secure')
      .join('; '),
  );
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    const route = matchRoute(request.method ?? 'GET', url.pathname);
    if (route) {
      const raw = await readBody(request);
      const result = await route.handler(
        {
          headers: new Headers(Object.entries(request.headers).map(([k, v]) => [k, String(v)])),
          query: url.searchParams,
          params: route.params,
          json: async () => JSON.parse(raw),
          text: async () => raw,
        },
        { error: console.error, log: () => {}, warn: console.warn, info: () => {} },
      );

      const headers = { 'Content-Type': 'application/json' };
      const cookies = setCookiesOf(result);
      if (cookies.length > 0) headers['Set-Cookie'] = cookies;
      response.writeHead(result.status ?? 200, headers);
      response.end(JSON.stringify(result.jsonBody ?? null));
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found', message: 'No such API route.' }));
      return;
    }

    // Static files, with SPA fallback. Two bundles, so the fallback depends on
    // which one the path belongs to - mirroring the rewrite in
    // staticwebapp.config.json rather than reimplementing a different rule.
    const relative = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(staticRoot, relative);
    const found = await stat(filePath).catch(() => null);
    if (!found?.isFile()) {
      const isOps = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
      filePath = join(staticRoot, isOps ? 'admin.html' : 'index.html');
    }

    response.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  })().catch((err) => {
    console.error(err);
    if (!response.headersSent) response.writeHead(500);
    response.end('Internal error');
  });
});

const port = Number(process.env.PORT ?? 5173);
server.listen(port, () => console.log(`Figmark dev server on http://127.0.0.1:${port}`));
