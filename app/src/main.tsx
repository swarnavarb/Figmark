import { StrictMode, lazy, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { SessionProvider, useSession } from './session';
import { PageLoading, ToastHost } from './components/Feedback';
import { UndoHost } from './components/Undo';
import { QuestProvider } from './components/Quest';
import { GuestWall } from './components/GuestWall';
import { registerServiceWorker } from './push';
import { listenForInstallPrompt } from './device';
import { PushHost } from './components/PushControls';
import { FreshOnNavigate, NotificationLinks } from './components/Notifications';
import { keepFresh } from './freshness';
import { PullToRefresh } from './components/PullToRefresh';
import { applyDeferredStyles, liftBootScreen } from './components/Preloader';
import { loadRouteWords } from './routeWords';
import { ErrorBoundary } from './components/ErrorBoundary';
import { listenForErrors } from './errors';
import { primeStartupReads } from './api';
import { loaders, warmPage, warmTabsWhenIdle } from './pageLoaders';
import './styles.css';

// The stylesheet index.html fetched without blocking the loading screen's paint.
applyDeferredStyles();
// The reads every screen starts with, as one request, before anything asks.
primeStartupReads();
loadRouteWords();
// This address's screen, fetched alongside the session rather than after it.
warmPage(location.pathname);

/**
 * A screen, fetched the first time it is opened.
 *
 * Every page used to ship in one 650 KB script that had to arrive before the
 * app drew anything - the Sell console, the order page and the route studio
 * included, for somebody who only came to browse. Each is its own chunk now;
 * AppShell shows the loading mark in the page area while one arrives.
 */
function page<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] as ComponentType })));
}

const FeedPage = page(loaders.feed, 'FeedPage');
const DiscoverPage = page(loaders.discover, 'DiscoverPage');
const LegalPage = page(loaders.legal, 'LegalPage');
const ListingPage = page(loaders.listing, 'ListingPage');
const SellPage = page(loaders.sell, 'SellPage');
const ShopPage = page(loaders.shop, 'ShopPage');
const LotBoardPage = page(loaders.lotBoard, 'LotBoardPage');
const RouteRedirect = page(loaders.routes, 'RouteRedirect');
const RouteStudioPage = page(loaders.routeStudio, 'RouteStudioPage');
const ServicesPage = page(loaders.services, 'ServicesPage');
const MyServicesPage = page(loaders.services, 'MyServicesPage');
const ConsignmentsPage = page(loaders.services, 'ConsignmentsPage');
const DistributionPage = page(loaders.services, 'DistributionPage');
const ServiceDirectoryPage = page(loaders.services, 'ServiceDirectoryPage');
const StoreApplyPage = page(loaders.storeApply, 'StoreApplyPage');
const StoreConsolePage = page(loaders.storeConsole, 'StoreConsolePage');
const StorePage = page(loaders.store, 'StorePage');
const CrewLotPage = page(loaders.crewLot, 'CrewLotPage');
const SocialPage = page(loaders.social, 'SocialPage');
const ChannelPage = page(loaders.social, 'ChannelPage');
const PostPage = page(loaders.social, 'PostPage');
const ForumRoom = page(loaders.forumRoom, 'ForumRoom');
const ThreadPage = page(loaders.messages, 'ThreadPage');
const OrderPage = page(loaders.order, 'OrderPage');
const DisputePage = page(loaders.dispute, 'DisputePage');
const CommunityServicePage = page(loaders.communityService, 'CommunityServicePage');
const ProfilePage = page(loaders.profile, 'ProfilePage');
const VerifyPage = page(loaders.verify, 'VerifyPage');
const PurchasesPage = page(loaders.purchases, 'PurchasesPage');
const CartPage = page(loaders.purchases, 'CartPage');
const BuyerLotPage = page(loaders.buyerLot, 'BuyerLotPage');
const MyRefundsPage = page(loaders.refunds, 'MyRefundsPage');
const MyDisputesPage = page(loaders.disputes, 'MyDisputesPage');
const QuestsPage = page(loaders.quests, 'QuestsPage');
const LearnPage = page(loaders.learn, 'LearnPage');
const TagPage = page(loaders.tag, 'TagPage');
const ProfileByHandlePage = page(loaders.profileByHandle, 'ProfileByHandlePage');
const ShortLinkPage = page(loaders.shortLink, 'ShortLinkPage');
const InvitePage = page(loaders.invite, 'InvitePage');
const SharedItem = page(loaders.invite, 'SharedItem');
const SharedPage = page(loaders.invite, 'SharedPage');
const SharedPost = page(loaders.invite, 'SharedPost');
const SharedTopic = page(loaders.invite, 'SharedTopic');
const SharedDiscover = page(loaders.invite, 'SharedDiscover');
const PowerSaleBuilderPage = page(loaders.powerSale, 'PowerSaleBuilderPage');
const NotFoundPage = page(loaders.notFound, 'NotFoundPage');

/**
 * Everyone lands on the catalog. Signed-out visitors can read every public
 * page - items, shops, services - and anything that needs an account opens a
 * sign-in popup over the page they are on (see session.tsx).
 */
function App() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <PageLoading />
    );
  }

  // Anybody can browse. A screen that is only about your own account shows a
  // locked page and asks you to sign in, without leaving the address.
  const members = (element: JSX.Element) => (user ? element : <GuestWall />);

  return (
    <QuestProvider>
    {/* Notifications: the floating prompt, the steps, and where this copy is used. */}
    <PushHost />
    <NotificationLinks />
    <FreshOnNavigate />
    <PullToRefresh />
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<FeedPage />} />
        {/* Open to everybody, as the catalogue is: the community side, ranked. */}
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/listing/:id" element={<ListingPage />} />
        {/* A short affiliate link: resolved, remembered, then the item. */}
        <Route path="/r/:code" element={<ShortLinkPage />} />
        {/* Shared from the app: an invite, and items and pages that carry one. */}
        <Route path="/i/:code" element={<InvitePage />} />
        <Route path="/s/l/:id" element={<SharedItem />} />
        <Route path="/s/p/:handle" element={<SharedPage />} />
        <Route path="/s/x/:channel/:id" element={<SharedPost />} />
        <Route path="/s/t/:slug" element={<SharedTopic />} />
        <Route path="/s/d" element={<SharedDiscover />} />
        <Route path="/sell" element={members(<SellPage />)} />
        <Route path="/shop" element={members(<ShopPage />)} />
        <Route path="/shop/power-sale" element={members(<PowerSaleBuilderPage />)} />
        <Route path="/lot/:id" element={members(<LotBoardPage />)} />
        {/* Lots live on the Sell tab's own Lots section, not a separate page -
            these both just point there so nothing bookmarked or linked breaks. */}
        <Route path="/lots" element={<Navigate to="/shop?tab=lots" replace />} />
        <Route path="/batches" element={<Navigate to="/shop?tab=lots" replace />} />
        {/* The route list lives in Sell → Lots → Routes, and every route is written
            in the Studio. The old addresses still land in the right place. */}
        <Route path="/routes" element={<Navigate to="/shop?tab=routes" replace />} />
        <Route path="/routes/studio/new" element={members(<RouteStudioPage />)} />
        <Route path="/routes/studio/:id" element={members(<RouteStudioPage />)} />
        <Route path="/routes/:id" element={members(<RouteRedirect />)} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/services/mine" element={members(<MyServicesPage />)} />
        <Route path="/services/mine/forwarder" element={members(<ConsignmentsPage />)} />
        <Route path="/services/mine/handler" element={members(<DistributionPage />)} />
        <Route path="/services/apply/:kind" element={members(<StoreApplyPage />)} />
        <Route path="/services/store/:kind" element={members(<StoreConsolePage />)} />
        <Route path="/services/store/:kind/:ownerId" element={members(<StoreConsolePage />)} />
        <Route path="/services/crew/:sellerId/:lotId" element={members(<CrewLotPage />)} />
        {/* Last of the four, so the static paths above win the match. */}
        <Route path="/services/:kind" element={<ServiceDirectoryPage />} />
        <Route path="/services/:kind/:slug" element={<StorePage />} />
        <Route path="/social" element={members(<SocialPage />)} />
        <Route path="/social/c/:id" element={members(<ChannelPage />)} />
        <Route path="/social/f/:id" element={members(<ForumRoom />)} />
        <Route path="/social/p/:channel/:id" element={members(<PostPage />)} />
        <Route path="/messages/:handle" element={members(<ThreadPage />)} />
        <Route path="/order/:id" element={members(<OrderPage />)} />
        <Route path="/dispute/:id" element={members(<DisputePage />)} />
        <Route path="/community-service" element={members(<CommunityServicePage />)} />
        {/* The buyer protection console became part of the Community Service desk. */}
        <Route path="/forwarders" element={<Navigate to="/services/forwarder" replace />} />
        <Route path="/me" element={members(<ProfilePage />)} />
        <Route path="/verify" element={members(<VerifyPage />)} />
        <Route path="/purchases" element={members(<PurchasesPage />)} />
        <Route path="/purchases/lot/:lotId" element={members(<BuyerLotPage />)} />
        <Route path="/cart" element={members(<CartPage />)} />
        {/* Old notifications still link here; the details live under My wallet now. */}
        <Route path="/buyer-settings" element={<Navigate to="/wallet?tab=details" replace />} />
        <Route path="/wallet" element={members(<MyRefundsPage />)} />
        {/* My refunds became My wallet; older links and notifications still land. */}
        <Route path="/refunds" element={members(<MyRefundsPage />)} />
        <Route path="/disputes" element={members(<MyDisputesPage />)} />
        <Route path="/quests" element={members(<QuestsPage />)} />
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="/tags/:slug" element={<TagPage />} />
        {/* Last, so every screen above keeps its path: `/<username>` is the
            fallback reading of a single segment, not the first one. */}
        <Route path="/:username" element={<ProfileByHandlePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </QuestProvider>
  );
}

// Errors in the browser reach the server's log.
listenForErrors();
// Only shows notifications; it caches nothing, so the site loads as before.
registerServiceWorker();
// Android's install prompt can arrive at any moment; keep it for the guide.
listenForInstallPrompt();
// A home-screen app resumes from memory for days; pick up new deploys.
keepFresh();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html.');

liftBootScreen(warmTabsWhenIdle);

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastHost>
          <UndoHost>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </UndoHost>
        </ToastHost>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
