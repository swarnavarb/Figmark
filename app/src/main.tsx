import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { AuthPage } from './pages/AuthPage';
import { RouteEditorPage, RoutesPage } from './pages/RoutesPage';
import { RouteStudioPage } from './pages/RouteStudioPage';
import { FeedPage } from './pages/FeedPage';
import { ForwardersPage } from './pages/ForwardersPage';
import { ListingPage } from './pages/ListingPage';
import { OrderPage } from './pages/OrderPage';
import { ProfilePage } from './pages/ProfilePage';
import { PurchasesPage } from './pages/PurchasesPage';
import { SellPage } from './pages/SellPage';
import { LotBoardPage } from './pages/LotBoardPage';
import { ShopPage } from './pages/ShopPage';
import {
  ConsignmentsPage, DistributionPage, MyServicesPage, ServiceDirectoryPage, ServicesPage,
} from './pages/ServicesPage';
import { ChannelPage, PostPage, SocialPage } from './pages/SocialPage';
import { ThreadPage } from './pages/MessagesPage';
import { DisputePage } from './pages/DisputePage';
import { EscrowPage } from './pages/EscrowPage';
import { SupplierPage, PackingLotPage } from './pages/SupplierPage';
import { ProfileByHandlePage } from './pages/ProfileByHandlePage';
import { MyRefundsPage } from './pages/MyRefundsPage';
import { MyDisputesPage } from './pages/MyDisputesPage';
import { SessionProvider, useSession } from './session';
import { ToastHost } from './components/Feedback';
import './styles.css';

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
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<FeedPage />} />
        <Route path="/listing/:id" element={<ListingPage />} />
        <Route path="/sell" element={<SellPage />} />
        <Route path="/shop" element={<ShopPage />} />
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
        {/* Last of the four, so the static paths above win the match. */}
        <Route path="/services/:kind" element={<ServiceDirectoryPage />} />
        <Route path="/social" element={<SocialPage />} />
        <Route path="/social/c/:id" element={<ChannelPage />} />
        <Route path="/social/p/:channel/:id" element={<PostPage />} />
        <Route path="/messages/:handle" element={<ThreadPage />} />
        <Route path="/packing" element={<SupplierPage />} />
        <Route path="/packing/:id" element={<PackingLotPage />} />
        <Route path="/order/:id" element={<OrderPage />} />
        <Route path="/dispute/:id" element={<DisputePage />} />
        <Route path="/escrow" element={<EscrowPage />} />
        <Route path="/forwarders" element={<ForwardersPage />} />
        <Route path="/me" element={<ProfilePage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        {/* Old notifications still link here; the details live under My refunds now. */}
        <Route path="/buyer-settings" element={<Navigate to="/refunds?tab=details" replace />} />
        <Route path="/refunds" element={<MyRefundsPage />} />
        <Route path="/disputes" element={<MyDisputesPage />} />
        {/* Last, so every screen above keeps its path: `/<username>` is the
            fallback reading of a single segment, not the first one. */}
        <Route path="/:username" element={<ProfileByHandlePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
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
