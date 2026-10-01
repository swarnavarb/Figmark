import { StrictMode, lazy, type ComponentType } from 'react';
import { PowerSaleBuilderPage } from './components/PowerSale';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { AuthPage } from './pages/AuthPage';
import { SessionProvider, useSession } from './session';
import { ToastHost } from './components/Feedback';
import { QuestProvider } from './components/Quest';
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
const RoutesPage = page(() => import('./pages/RoutesPage'), 'RoutesPage');
const RouteEditorPage = page(() => import('./pages/RoutesPage'), 'RouteEditorPage');
const RouteStudioPage = page(() => import('./pages/RouteStudioPage'), 'RouteStudioPage');
const ServicesPage = page(() => import('./pages/ServicesPage'), 'ServicesPage');
const MyServicesPage = page(() => import('./pages/ServicesPage'), 'MyServicesPage');
const ConsignmentsPage = page(() => import('./pages/ServicesPage'), 'ConsignmentsPage');
const DistributionPage = page(() => import('./pages/ServicesPage'), 'DistributionPage');
const ServiceDirectoryPage = page(() => import('./pages/ServicesPage'), 'ServiceDirectoryPage');
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
const ForwardersPage = page(() => import('./pages/ForwardersPage'), 'ForwardersPage');
const ProfilePage = page(() => import('./pages/ProfilePage'), 'ProfilePage');
const PurchasesPage = page(() => import('./pages/PurchasesPage'), 'PurchasesPage');
const CartPage = page(() => import('./pages/PurchasesPage'), 'CartPage');
const MyRefundsPage = page(() => import('./pages/MyRefundsPage'), 'MyRefundsPage');
const MyDisputesPage = page(() => import('./pages/MyDisputesPage'), 'MyDisputesPage');
const QuestsPage = page(() => import('./pages/QuestsPage'), 'QuestsPage');
const LearnPage = page(() => import('./pages/LearnPage'), 'LearnPage');
const ProfileByHandlePage = page(() => import('./pages/ProfileByHandlePage'), 'ProfileByHandlePage');

/**
 * Signed-out visitors get the auth page and nothing else.
 *
 * The catalog is public at the API level, so opening it up to signed-out
 * browsing later is a routing change here rather than a permissions change
 * there.
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

  if (!user) return <AuthPage />;

  return (
    <QuestProvider>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<FeedPage />} />
        <Route path="/listing/:id" element={<ListingPage />} />
        <Route path="/sell" element={<SellPage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/shop/power-sale" element={<PowerSaleBuilderPage />} />
        <Route path="/lot/:id" element={<LotBoardPage />} />
        {/* Lots live on the Sell tab's own Lots section, not a separate page -
            these both just point there so nothing bookmarked or linked breaks. */}
        <Route path="/lots" element={<Navigate to="/shop?tab=lots" replace />} />
        <Route path="/batches" element={<Navigate to="/shop?tab=lots" replace />} />
        <Route path="/routes" element={<RoutesPage />} />
        {/* `new` before `:id`, so writing a route is never read as editing one. */}
        <Route path="/routes/new" element={<RouteEditorPage />} />
        {/* The experimental node-based builder, being compared against the one
            above. Its own paths, so neither can be reached by the other's link. */}
        <Route path="/routes/studio/new" element={<RouteStudioPage />} />
        <Route path="/routes/studio/:id" element={<RouteStudioPage />} />
        <Route path="/routes/:id" element={<RouteEditorPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/services/mine" element={<MyServicesPage />} />
        <Route path="/services/mine/forwarder" element={<ConsignmentsPage />} />
        <Route path="/services/mine/handler" element={<DistributionPage />} />
        {/* Freight forwarders are the forwarder directory itself, which used
            to hang off the header and now lives here with the other trades. */}
        <Route path="/services/forwarder" element={<ForwardersPage />} />
        {/* Last of the four, so the static paths above win the match. */}
        <Route path="/services/:kind" element={<ServiceDirectoryPage />} />
        <Route path="/social" element={<SocialPage />} />
        <Route path="/social/c/:id" element={<ChannelPage />} />
        <Route path="/social/f/:id" element={<ForumRoom />} />
        <Route path="/social/p/:channel/:id" element={<PostPage />} />
        <Route path="/messages/:handle" element={<ThreadPage />} />
        <Route path="/packing" element={<SupplierPage />} />
        <Route path="/packing/:id" element={<PackingLotPage />} />
        <Route path="/order/:id" element={<OrderPage />} />
        <Route path="/dispute/:id" element={<DisputePage />} />
        <Route path="/escrow" element={<EscrowPage />} />
        <Route path="/forwarders" element={<Navigate to="/services/forwarder" replace />} />
        <Route path="/me" element={<ProfilePage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/cart" element={<CartPage />} />
        {/* Old notifications still link here; the details live under My refunds now. */}
        <Route path="/buyer-settings" element={<Navigate to="/refunds?tab=details" replace />} />
        <Route path="/refunds" element={<MyRefundsPage />} />
        <Route path="/disputes" element={<MyDisputesPage />} />
        <Route path="/quests" element={<QuestsPage />} />
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

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastHost>
          <App />
        </ToastHost>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
