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
  addCommentRoute, reactToCommentRoute, toggleFollowRoute, createOrderRoute, myActivityRoute, myListingsRoute, forwardersRoute,
  editListingRoute, deleteListingRoute, similarListingsRoute, affiliateLinkRoute, openShortLinkRoute,
} = await import(new URL('catalog-routes.js', apiRoot));
const { myAffiliateRoute, markAffiliatePaidRoute } = await import(new URL('affiliate-routes.js', apiRoot));
const {
  myLotsRoute, createLotRoute, lotContentsRoute, assignToLotRoute,
  advanceStageRoute, setTrackingRoute, updateLotDetailsRoute, orderTrackingRoute,
  lotsBoardRoute, lotBoardRoute, setCheckpointRoute, supplierLotsRoute, supplierLotRoute,
  setCrewRoute,
} = await import(new URL('fulfilment-routes.js', apiRoot));
const { storefrontRoute, updateStorefrontRoute, dashboardRoute, myStoresRoute, updateManagersRoute, salesRoute } =
  await import(new URL('seller-routes.js', apiRoot));
const {
  socialFeedRoute, channelsRoute, channelThreadRoute, createPostRoute, myPostsRoute, personPostsRoute,
  listForumsRoute, createForumRoute, readPostRoute, reactRoute, reactorsRoute,
  addPostCommentRoute, likeCommentRoute, deletePostCommentRoute, sharePostRoute, voteRoute,
  removePostRoute, trendingRoute, shareableRoute, pinPostRoute, joinForumRoute, socialSearchRoute,
} = await import(new URL('social-routes.js', apiRoot));
const { inboxRoute, threadRoute, sendMessageRoute, publicProfileRoute, setUsernameRoute, reactToMessageRoute } =
  await import(new URL('message-routes.js', apiRoot));
const {
  payRoute, confirmRoute, reviewRoute, orderStateRoute, checkoutRoute,
  claimPaymentRoute, settleClaimRoute, rejectOrderRoute, payMoreRoute, refundCreditRoute,
  acceptOrderRoute, cancelOrderRoute, requestReversalDetailsRoute, confirmReversalDetailsRoute,
  submitReversalRoute, ackReversalRoute, raiseDisputeRoute, bookOrderRoute,
  ackCreditRefundRoute, applyCreditRoute, holdCreditRoute, startRefundRoute, myRefundsRoute, flagDisputeRoute, myDisputesRoute,
} = await import(new URL('order-routes.js', apiRoot));
const {
  wantsBoardRoute, wantPostRoute, wantReadRoute, wantOfferRoute, wantCloseRoute, wantAlsoMeRoute,
} = await import(new URL('want-routes.js', apiRoot));
const { notificationsRoute, notificationsReadRoute } =
  await import(new URL('notification-routes.js', apiRoot));
const { preOrderReadRoute, preOrderPledgeRoute } =
  await import(new URL('preorder-routes.js', apiRoot));
const {
  powerSalesRoute, powerSaleCreateRoute, powerSaleReadRoute, powerSaleStopRoute,
} = await import(new URL('power-sale-routes.js', apiRoot));
const { fillingLotsRoute, dropsRoute, dropRoute, remindRoute } = await import(new URL('showcase-routes.js', apiRoot));
const { insightsRoute, interestRoute, marketRoute } = await import(new URL('insight-routes.js', apiRoot));
const {
  listProfitTemplatesRoute, saveProfitTemplateRoute, deleteProfitTemplateRoute,
  listSavedCalcsRoute, saveSavedCalcRoute, deleteSavedCalcRoute,
} = await import(new URL('profit-routes.js', apiRoot));
const { costsRoute, saveCostSheetRoute, deepRoute, salesReportRoute, nudgeRoute } = await import(new URL('pro-routes.js', apiRoot));
const {
  listRoutesRoute, saveRouteRoute, deleteRouteRoute, applyRouteRoute, closeLotRoute,
  lotCandidatesRoute, addItemsRoute, stepLotRoute, noteOnLotRoute, setLotRouteRoute,
  stepItemRoute, myItemsRoute,
} = await import(new URL('tracking-routes.js', apiRoot));
const {
  listTemplatesRoute, saveTemplateRoute, deleteTemplateRoute,
  uploadRoute, photoRoute, assignOrderToLotRoute,
} = await import(new URL('template-routes.js', apiRoot));
const {
  servicesHubRoute, serviceDirectoryRoute, offerServiceRoute,
  consignmentsRoute, distributionRoute, distributionDetailRoute,
} = await import(new URL('service-routes.js', apiRoot));
const {
  myServicesRoute, applyStoreRoute, storeConsoleRoute, saveStoreRoute, storeTeamRoute, storeWorkRoute,
  respondLotRoute, artistActRoute, storePageRoute, lotForwarderOptionsRoute, bookForwarderRoute,
  orderServicesRoute, setInsuranceRoute, commissionRoute, commissionActRoute, crewLotRoute, opsStoresRoute, opsReviewRoute,
} = await import(new URL('store-routes.js', apiRoot));
const {
  creditRoute, pageReviewsRoute, writePageReviewRoute, tradeReviewsRoute,
  saveReversalDetailsRoute, reversalDetailsRoute,
} = await import(new URL('profile-routes.js', apiRoot));
const {
  openDisputeRoute, readDisputeRoute, replyDisputeRoute, offerDisputeRoute,
  acceptDisputeRoute, withdrawDisputeRoute, escalateDisputeRoute,
  settleAsEscrowRoute, escrowHoldingsRoute,
} = await import(new URL('dispute-routes.js', apiRoot));
const {
  adminUsersRoute, adminUserDetailRoute, adminSuspendRoute, adminDeleteUserRoute,
  adminDeleteResourceRoute, adminEscrowRoute, adminDisputesRoute, adminResolveRoute,
} = await import(new URL('admin-routes.js', apiRoot));
const {
  questMeRoute, questCheckInRoute, questClaimRoute, questRevealRoute, questOpenRoute,
  questLeaderboardRoute, collectorRoute,
} = await import(new URL('quest-routes.js', apiRoot));
const {
  publicCollectionRoute, myCollectionRoute, collectionAddRoute, collectionEditRoute,
  collectionRemoveRoute, collectionGroupsRoute,
} = await import(new URL('collection-routes.js', apiRoot));
const { learnRoute, opsLearnRoute, opsLearnSaveRoute, opsLearnResetRoute } = await import(new URL('learn-routes.js', apiRoot));
const { settingsRoute, opsSettingsRoute, opsSettingsSaveRoute } = await import(new URL('settings-routes.js', apiRoot));
const {
  reportCreateRoute, reportMineRoute, opsReportsRoute, opsReportResolveRoute,
} = await import(new URL('report-routes.js', apiRoot));

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
  ['GET', '/api/me/listings', myListingsRoute],
  ['POST', '/api/orders', createOrderRoute],
  ['POST', '/api/listings', createListingRoute],
  ['GET', '/api/listings/:id', listingDetailRoute],
  ['GET', '/api/listings/:id/similar', similarListingsRoute],
  ['POST', '/api/listings/:id/affiliate-link', affiliateLinkRoute],
  ['GET', '/api/r/:code', openShortLinkRoute],
  ['GET', '/api/me/affiliate', myAffiliateRoute],
  ['POST', '/api/orders/:id/affiliate-paid', markAffiliatePaidRoute],
  ['POST', '/api/listings/:id/like', toggleLikeRoute],
  ['POST', '/api/listings/:id/edit', editListingRoute],
  ['POST', '/api/listings/:id/delete', deleteListingRoute],
  ['POST', '/api/listings/:id/bump', bumpListingRoute],
  ['POST', '/api/listings/:id/comments', addCommentRoute],
  ['POST', '/api/listings/:id/comments/:commentId/react', reactToCommentRoute],
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
  ['GET', '/api/me/sales', salesRoute],
  ['GET', '/api/me/stores', myStoresRoute],
  ['POST', '/api/me/storefront/managers', updateManagersRoute],
  ['GET', '/api/social/feed', socialFeedRoute],
  ['GET', '/api/me/posts', myPostsRoute],
  ['GET', '/api/users/:id/posts', personPostsRoute],
  ['GET', '/api/social/channels', channelsRoute],
  ['GET', '/api/social/channels/:id', channelThreadRoute],
  ['POST', '/api/social/posts', createPostRoute],
  ['GET', '/api/social/forums', listForumsRoute],
  ['POST', '/api/social/forums/new', createForumRoute],
  ['POST', '/api/social/forums/:id/join', joinForumRoute],
  ['GET', '/api/social/search', socialSearchRoute],
  ['GET', '/api/social/trending', trendingRoute],
  ['GET', '/api/social/shareable', shareableRoute],
  ['GET', '/api/social/posts/:channel/:id', readPostRoute],
  ['POST', '/api/social/posts/:channel/:id/react', reactRoute],
  ['GET', '/api/social/posts/:channel/:id/reactions', reactorsRoute],
  ['POST', '/api/social/posts/:channel/:id/comments', addPostCommentRoute],
  ['POST', '/api/social/posts/:channel/:id/comments/:comment/like', likeCommentRoute],
  ['POST', '/api/social/posts/:channel/:id/comments/:comment/delete', deletePostCommentRoute],
  ['POST', '/api/social/posts/:channel/:id/share', sharePostRoute],
  ['POST', '/api/social/posts/:channel/:id/vote', voteRoute],
  ['POST', '/api/social/posts/:channel/:id/delete', removePostRoute],
  ['POST', '/api/social/posts/:channel/:id/pin', pinPostRoute],
  ['GET', '/api/messages', inboxRoute],
  ['GET', '/api/messages/:handle', threadRoute],
  ['POST', '/api/messages/:handle/send', sendMessageRoute],
  ['POST', '/api/messages/:handle/react', reactToMessageRoute],
  ['GET', '/api/u/:handle', publicProfileRoute],
  ['POST', '/api/me/username', setUsernameRoute],
  ['GET', '/api/orders/:id/state', orderStateRoute],
  ['GET', '/api/orders/:id/checkout', checkoutRoute],
  ['POST', '/api/orders/:id/pay', payRoute],
  ['POST', '/api/orders/:id/refund-credit', refundCreditRoute],
  ['POST', '/api/orders/:id/credit-ack', ackCreditRefundRoute],
  ['POST', '/api/orders/:id/credit-apply', applyCreditRoute],
  ['POST', '/api/orders/:id/credit-hold', holdCreditRoute],
  ['POST', '/api/orders/:id/refund-new', startRefundRoute],
  ['GET', '/api/me/refunds', myRefundsRoute],
  ['GET', '/api/me/disputes', myDisputesRoute],
  ['POST', '/api/orders/:id/flag-dispute', flagDisputeRoute],
  ['POST', '/api/me/purchases/pay', payMoreRoute],
  ['POST', '/api/orders/:id/claim-payment', claimPaymentRoute],
  ['POST', '/api/orders/:id/settle-claim', settleClaimRoute],
  ['POST', '/api/orders/:id/reject', rejectOrderRoute],
  ['POST', '/api/orders/:id/confirm', confirmRoute],
  ['POST', '/api/orders/:id/dispute', openDisputeRoute],
  ['POST', '/api/orders/:id/review', reviewRoute],
  ['POST', '/api/orders/:id/book', bookOrderRoute],
  ['POST', '/api/orders/:id/accept', acceptOrderRoute],
  ['POST', '/api/orders/:id/cancel', cancelOrderRoute],
  ['POST', '/api/orders/:id/reversal/request-details', requestReversalDetailsRoute],
  ['POST', '/api/orders/:id/reversal/confirm-details', confirmReversalDetailsRoute],
  ['POST', '/api/orders/:id/reversal/submit', submitReversalRoute],
  ['POST', '/api/orders/:id/reversal/ack', ackReversalRoute],
  ['POST', '/api/orders/:id/reversal/dispute', raiseDisputeRoute],
  ['GET', '/api/me/reversal-details', reversalDetailsRoute],
  ['POST', '/api/me/reversal-details/save', saveReversalDetailsRoute],
  ['GET', '/api/disputes/:id', readDisputeRoute],
  ['POST', '/api/disputes/:id/reply', replyDisputeRoute],
  ['POST', '/api/disputes/:id/offer', offerDisputeRoute],
  ['POST', '/api/disputes/:id/accept', acceptDisputeRoute],
  ['POST', '/api/disputes/:id/withdraw', withdrawDisputeRoute],
  ['POST', '/api/disputes/:id/escalate', escalateDisputeRoute],
  ['POST', '/api/disputes/:id/settle', settleAsEscrowRoute],
  ['GET', '/api/escrow/holdings', escrowHoldingsRoute],
  ['GET', '/api/quest/me', questMeRoute],
  ['POST', '/api/quest/checkin', questCheckInRoute],
  ['POST', '/api/quest/claim', questClaimRoute],
  ['POST', '/api/quest/reveal', questRevealRoute],
  ['POST', '/api/quest/open', questOpenRoute],
  ['GET', '/api/quest/leaderboard', questLeaderboardRoute],
  ['GET', '/api/users/:id/collector', collectorRoute],
  ['GET', '/api/users/:id/collection', publicCollectionRoute],
  ['GET', '/api/learn', learnRoute],
  ['GET', '/api/ops/learn', opsLearnRoute],
  ['POST', '/api/ops/learn/save', opsLearnSaveRoute],
  ['POST', '/api/ops/learn/reset', opsLearnResetRoute],
  ['GET', '/api/settings', settingsRoute],
  ['GET', '/api/ops/settings', opsSettingsRoute],
  ['POST', '/api/ops/settings/save', opsSettingsSaveRoute],
  ['POST', '/api/reports', reportCreateRoute],
  ['GET', '/api/reports/mine', reportMineRoute],
  ['GET', '/api/ops/reports', opsReportsRoute],
  ['POST', '/api/ops/reports/:id/resolve', opsReportResolveRoute],
  ['GET', '/api/me/collection', myCollectionRoute],
  ['POST', '/api/me/collection/add', collectionAddRoute],
  ['POST', '/api/me/collection/edit', collectionEditRoute],
  ['POST', '/api/me/collection/remove', collectionRemoveRoute],
  ['POST', '/api/me/collection/groups', collectionGroupsRoute],
  ['GET', '/api/ops/users', adminUsersRoute],
  ['GET', '/api/ops/users/:id', adminUserDetailRoute],
  ['POST', '/api/ops/users/:id/suspend', adminSuspendRoute],
  ['POST', '/api/ops/users/:id/delete', adminDeleteUserRoute],
  ['POST', '/api/ops/users/:id/escrow', adminEscrowRoute],
  ['POST', '/api/ops/resources/delete', adminDeleteResourceRoute],
  ['GET', '/api/ops/disputes', adminDisputesRoute],
  ['POST', '/api/ops/disputes/:id/resolve', adminResolveRoute],
  ['GET', '/api/wants', wantsBoardRoute],
  ['POST', '/api/wants/new', wantPostRoute],
  ['GET', '/api/wants/:id', wantReadRoute],
  ['POST', '/api/wants/:id/offers', wantOfferRoute],
  ['POST', '/api/wants/:id/close', wantCloseRoute],
  ['POST', '/api/wants/:id/me', wantAlsoMeRoute],
  ['GET', '/api/me/insights', insightsRoute],
  ['GET', '/api/me/interest', interestRoute],
  ['GET', '/api/me/market', marketRoute],
  ['GET', '/api/me/profit-templates', listProfitTemplatesRoute],
  ['POST', '/api/me/profit-templates/save', saveProfitTemplateRoute],
  ['POST', '/api/me/profit-templates/:id/delete', deleteProfitTemplateRoute],
  ['GET', '/api/me/calcs', listSavedCalcsRoute],
  ['POST', '/api/me/calcs/save', saveSavedCalcRoute],
  ['POST', '/api/me/calcs/:id/delete', deleteSavedCalcRoute],
  ['GET', '/api/me/costs', costsRoute],
  ['POST', '/api/me/listings/:id/cost-sheet', saveCostSheetRoute],
  ['GET', '/api/me/deep', deepRoute],
  ['GET', '/api/me/sales-report', salesReportRoute],
  ['POST', '/api/me/nudge', nudgeRoute],
  ['GET', '/api/routes', listRoutesRoute],
  ['POST', '/api/routes/new', saveRouteRoute],
  ['POST', '/api/routes/:id/delete', deleteRouteRoute],
  ['POST', '/api/routes/:id/apply', applyRouteRoute],
  ['POST', '/api/lots/:id/close', closeLotRoute],
  ['GET', '/api/lots/:id/candidates', lotCandidatesRoute],
  ['POST', '/api/lots/:id/items', addItemsRoute],
  ['POST', '/api/lots/:id/step', stepLotRoute],
  ['POST', '/api/lots/:id/note', noteOnLotRoute],
  ['POST', '/api/lots/:id/route', setLotRouteRoute],
  ['POST', '/api/orders/:id/step', stepItemRoute],
  ['GET', '/api/me/items', myItemsRoute],
  ['GET', '/api/templates', listTemplatesRoute],
  ['POST', '/api/templates/new', saveTemplateRoute],
  ['POST', '/api/templates/:id/delete', deleteTemplateRoute],
  ['POST', '/api/uploads', uploadRoute],
  ['GET', '/api/photos/:name', photoRoute],
  ['POST', '/api/orders/:id/lot', assignOrderToLotRoute],
  ['GET', '/api/services', servicesHubRoute],
  ['GET', '/api/me/services', myServicesRoute],
  ['POST', '/api/me/services/apply', applyStoreRoute],
  ['GET', '/api/me/crew/:sellerId/:lotId', crewLotRoute],
  ['POST', '/api/service-stores/forwarder/:ownerId/respond', respondLotRoute],
  ['POST', '/api/service-stores/artist/:ownerId/jobs/:orderId', artistActRoute],
  ['GET', '/api/service-stores/:kind/:ownerId', storeConsoleRoute],
  ['POST', '/api/service-stores/:kind/:ownerId/save', saveStoreRoute],
  ['POST', '/api/service-stores/:kind/:ownerId/team', storeTeamRoute],
  ['GET', '/api/service-stores/:kind/:ownerId/work', storeWorkRoute],
  ['GET', '/api/service-store/:kind/:slug', storePageRoute],
  ['GET', '/api/lots/:id/forwarders', lotForwarderOptionsRoute],
  ['POST', '/api/lots/:id/forwarder-store', bookForwarderRoute],
  ['GET', '/api/orders/:id/services', orderServicesRoute],
  ['POST', '/api/orders/:id/insurance', setInsuranceRoute],
  ['POST', '/api/orders/:id/commission', commissionRoute],
  ['POST', '/api/orders/:id/commission/act', commissionActRoute],
  ['GET', '/api/ops/stores', opsStoresRoute],
  ['POST', '/api/ops/stores/:kind/:ownerId/review', opsReviewRoute],
  ['POST', '/api/me/service', offerServiceRoute],
  ['GET', '/api/me/service/consignments', consignmentsRoute],
  ['GET', '/api/me/service/distribution', distributionRoute],
  ['GET', '/api/me/service/distribution/:id', distributionDetailRoute],
  ['POST', '/api/lots/:id/crew', setCrewRoute],
  ['GET', '/api/services/:kind', serviceDirectoryRoute],
  ['GET', '/api/power-sales', powerSalesRoute],
  ['POST', '/api/power-sales/new', powerSaleCreateRoute],
  ['GET', '/api/power-sales/:id', powerSaleReadRoute],
  ['POST', '/api/power-sales/:id/stop', powerSaleStopRoute],
  ['GET', '/api/showcase/lots', fillingLotsRoute],
  ['GET', '/api/showcase/drops', dropsRoute],
  ['GET', '/api/showcase/drops/:sellerId/:id', dropRoute],
  ['POST', '/api/showcase/drops/:sellerId/:id/remind', remindRoute],
  ['GET', '/api/listings/:id/preorder', preOrderReadRoute],
  ['POST', '/api/listings/:id/pledge', preOrderPledgeRoute],
  ['GET', '/api/notifications', notificationsRoute],
  ['POST', '/api/notifications/read', notificationsReadRoute],
  ['GET', '/api/users/:id/reviews', tradeReviewsRoute],
  ['GET', '/api/users/:id/credit', creditRoute],
  ['GET', '/api/users/:id/page-reviews', pageReviewsRoute],
  ['POST', '/api/users/:id/page-reviews/new', writePageReviewRoute],
  ['GET', '/api/supplier/lots', supplierLotsRoute],
  ['GET', '/api/supplier/lots/:id', supplierLotRoute],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  // The vendored typefaces. Without this they were served as
  // application/octet-stream, which some engines refuse to parse as a font.
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
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

      // Not every route answers with JSON: a photo comes back as bytes with
      // its own content type, the way the Functions host would send it.
      const binary = result.body instanceof Buffer || result.body instanceof Uint8Array;
      const headers = binary
        ? { ...(result.headers ?? {}) }
        : { 'Content-Type': 'application/json' };
      const cookies = setCookiesOf(result);
      if (cookies.length > 0) headers['Set-Cookie'] = cookies;
      response.writeHead(result.status ?? 200, headers);
      if (binary) response.end(Buffer.from(result.body));
      else if (result.jsonBody === undefined && typeof result.body === 'string') response.end(result.body);
      else response.end(JSON.stringify(result.jsonBody ?? null));
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

/* The Functions host runs the power-sale clock as a timer trigger; this server
   has no host, so it keeps the same once-a-minute beat itself. */
const { tickPowerSales } = await import(new URL('power-sale.js', apiRoot));
const { getRepository } = await import(new URL('../data/index.js', apiRoot));
setInterval(() => {
  void getRepository().then((repository) => tickPowerSales(repository)).catch(() => undefined);
}, 60_000).unref();
