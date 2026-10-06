import { StrictMode, lazy, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { SessionProvider, useSession } from './session';
import { ToastHost } from './components/Feedback';
import { UndoHost } from './components/Undo';
import { QuestProvider } from './components/Quest';
import { GuestWall } from './components/GuestWall';
import { registerServiceWorker } from './push';
import { listenForInstallPrompt } from './device';
import { PushHost } from './components/PushControls';
import { PullToRefresh } from './components/PullToRefresh';
import './styles.css';

/**
 * A screen, fetched the first time it is opened.
 *
 * Every page used to ship in one 650 KB script that had to arrive before the
 * app drew anything - the Sell console, the order page and the route studio
 * included, for somebody who only came to browse. Each is its own chunk now;
 * AppShell shows "Loading…" in the page area while one arrives.
 */
function page<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] as ComponentType })));
}

const FeedPage = page(() => import('./pages/FeedPage'), 'FeedPage');
const ListingPage = page(() => import('./pages/ListingPage'), 'ListingPage');
const SellPage = page(() => import('./pages/SellPage'), 'SellPage');
const ShopPage = page(() => import('./pages/ShopPage'), 'ShopPage');
const LotBoardPage = page(() => import('./pages/LotBoardPage'), 'LotBoardPage');
const RouteRedirect = page(() => import('./pages/RoutesPage'), 'RouteRedirect');
const RouteStudioPage = page(() => import('./pages/RouteStudioPage'), 'RouteStudioPage');
const ServicesPage = page(() => import('./pages/ServicesPage'), 'ServicesPage');
const MyServicesPage = page(() => import('./pages/ServicesPage'), 'MyServicesPage');
const ConsignmentsPage = page(() => import('./pages/ServicesPage'), 'ConsignmentsPage');
const DistributionPage = page(() => import('./pages/ServicesPage'), 'DistributionPage');
const ServiceDirectoryPage = page(() => import('./pages/ServicesPage'), 'ServiceDirectoryPage');
const StoreApplyPage = page(() => import('./pages/StoreApplyPage'), 'StoreApplyPage');
const StoreConsolePage = page(() => import('./pages/StoreConsolePage'), 'StoreConsolePage');
const StorePage = page(() => import('./pages/StorePage'), 'StorePage');
const CrewLotPage = page(() => import('./pages/CrewLotPage'), 'CrewLotPage');
const SocialPage = page(() => import('./pages/SocialPage'), 'SocialPage');
const ChannelPage = page(() => import('./pages/SocialPage'), 'ChannelPage');
const PostPage = page(() => import('./pages/SocialPage'), 'PostPage');
const ForumRoom = page(() => import('./components/ForumRoom'), 'ForumRoom');
const ThreadPage = page(() => import('./pages/MessagesPage'), 'ThreadPage');
const SupplierPage = page(() => import('./pages/SupplierPage'), 'SupplierPage');
const PackingLotPage = page(() => import('./pages/SupplierPage'), 'PackingLotPage');
const OrderPage = page(() => import('./pages/OrderPage'), 'OrderPage');
const DisputePage = page(() => import('./pages/DisputePage'), 'DisputePage');
const EscrowPage = page(() => import('./pages/EscrowPage'), 'EscrowPage');
const ProfilePage = page(() => import('./pages/ProfilePage'), 'ProfilePage');
const PurchasesPage = page(() => import('./pages/PurchasesPage'), 'PurchasesPage');
const CartPage = page(() => import('./pages/PurchasesPage'), 'CartPage');
const BuyerLotPage = page(() => import('./pages/BuyerLotPage'), 'BuyerLotPage');
const MyRefundsPage = page(() => import('./pages/MyRefundsPage'), 'MyRefundsPage');
const MyDisputesPage = page(() => import('./pages/MyDisputesPage'), 'MyDisputesPage');
const QuestsPage = page(() => import('./pages/QuestsPage'), 'QuestsPage');
const LearnPage = page(() => import('./pages/LearnPage'), 'LearnPage');
const ProfileByHandlePage = page(() => import('./pages/ProfileByHandlePage'), 'ProfileByHandlePage');
const ShortLinkPage = page(() => import('./pages/ShortLinkPage'), 'ShortLinkPage');
const InvitePage = page(() => import('./pages/InvitePage'), 'InvitePage');
const SharedItem = page(() => import('./pages/InvitePage'), 'SharedItem');
const SharedPage = page(() => import('./pages/InvitePage'), 'SharedPage');
const PowerSaleBuilderPage = page(() => import('./components/PowerSale'), 'PowerSaleBuilderPage');

/**
 * Everyone lands on the catalog. Signed-out visitors can read every public
 * page - items, shops, services - and anything that needs an account opens a
 * sign-in popup over the page they are on (see session.tsx).
 */
function App() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="auth">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  // Anybody can browse. A screen that is only about your own account shows a
  // locked page and asks you to sign in, without leaving the address.
  const members = (element: JSX.Element) => (user ? element : <GuestWall />);

  return (
    <QuestProvider>
    {/* Notifications: the floating prompt, the steps, and where this copy is used. */}
    <PushHost />
    <PullToRefresh />
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<FeedPage />} />
        <Route path="/listing/:id" element={<ListingPage />} />
        {/* A short affiliate link: resolved, remembered, then the item. */}
        <Route path="/r/:code" element={<ShortLinkPage />} />
        {/* Shared from the app: an invite, and items and pages that carry one. */}
        <Route path="/i/:code" element={<InvitePage />} />
        <Route path="/s/l/:id" element={<SharedItem />} />
        <Route path="/s/p/:handle" element={<SharedPage />} />
        <Route path="/sell" element={members(<SellPage />)} />
        <Route path="/shop" element={members(<ShopPage />)} />
        <Route path="/shop/power-sale" element={members(<PowerSaleBuilderPage />)} />
        <Route path="/lot/:id" element={members(<LotBoardPage />)} />
        {/* Lots live on the Sell tab's own Lots section, not a separate page -
            these both just point there so nothing bookmarked or linked breaks. */}
        <Route path="/lots" element={<Navigate to="/shop?tab=lots" replace />} />
        <Route path="/batches" element={<Navigate to="/shop?tab=lots" replace />} />
        {/* The route list lives in Sell → Routes, and every route is written
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
        <Route path="/packing" element={members(<SupplierPage />)} />
        <Route path="/packing/:id" element={members(<PackingLotPage />)} />
        <Route path="/order/:id" element={members(<OrderPage />)} />
        <Route path="/dispute/:id" element={members(<DisputePage />)} />
        <Route path="/escrow" element={members(<EscrowPage />)} />
        <Route path="/forwarders" element={<Navigate to="/services/forwarder" replace />} />
        <Route path="/me" element={members(<ProfilePage />)} />
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
        {/* Last, so every screen above keeps its path: `/<username>` is the
            fallback reading of a single segment, not the first one. */}
        <Route path="/:username" element={<ProfileByHandlePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </QuestProvider>
  );
}

// Only shows notifications; it caches nothing, so the site loads as before.
registerServiceWorker();
// Android's install prompt can arrive at any moment; keep it for the guide.
listenForInstallPrompt();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastHost>
          <UndoHost>
            <App />
          </UndoHost>
        </ToastHost>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
