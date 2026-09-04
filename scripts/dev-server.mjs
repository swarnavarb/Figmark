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
const { listLotsRoute, lotManifestRoute } = await import(new URL('lot-routes.js', apiRoot));
const {
  feedRoute, listingDetailRoute, createListingRoute, toggleLikeRoute, bumpListingRoute,
  addCommentRoute, toggleFollowRoute, createOrderRoute, myActivityRoute, forwardersRoute,
} = await import(new URL('catalog-routes.js', apiRoot));
const {
  myLotsRoute, createLotRoute, lotContentsRoute, assignToLotRoute,
  advanceStageRoute, setTrackingRoute, orderTrackingRoute,
} = await import(new URL('fulfilment-routes.js', apiRoot));

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
  ['GET', '/api/me/lots', myLotsRoute],
  ['POST', '/api/lots', createLotRoute],
  ['GET', '/api/lots/:id/contents', lotContentsRoute],
  ['POST', '/api/lots/:id/assign', assignToLotRoute],
  ['POST', '/api/lots/:id/stage', advanceStageRoute],
  ['POST', '/api/lots/:id/tracking', setTrackingRoute],
  ['GET', '/api/orders/:id', orderTrackingRoute],
  ['GET', '/api/lots', listLotsRoute],
  ['GET', '/api/lots/:sellerId/:lotId/manifest', lotManifestRoute],
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

/** Rebuild the runtime's Set-Cookie string from the structured cookie form. */
function serializeCookie(cookie) {
  const parts = [`${cookie.name}=${cookie.value}`];
  if (cookie.path) parts.push(`Path=${cookie.path}`);
  if (cookie.maxAge !== undefined) parts.push(`Max-Age=${cookie.maxAge}`);
  if (cookie.httpOnly) parts.push('HttpOnly');
  // `Secure` is dropped deliberately: this server is plain HTTP, and a Secure
  // cookie would be discarded by the browser. Production is HTTPS-only.
  if (cookie.sameSite) parts.push(`SameSite=${cookie.sameSite}`);
  return parts.join('; ');
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
      if (result.cookies?.length) {
        headers['Set-Cookie'] = result.cookies.map(serializeCookie);
      }
      response.writeHead(result.status ?? 200, headers);
      response.end(JSON.stringify(result.jsonBody ?? null));
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found', message: 'No such API route.' }));
      return;
    }

    // Static files, with SPA fallback to index.html.
    const relative = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(staticRoot, relative);
    const found = await stat(filePath).catch(() => null);
    if (!found?.isFile()) filePath = join(staticRoot, 'index.html');

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
