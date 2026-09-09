import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { AuthPage } from './pages/AuthPage';
import { BatchesPage } from './pages/BatchesPage';
import { FeedPage } from './pages/FeedPage';
import { ForwardersPage } from './pages/ForwardersPage';
import { ListingPage } from './pages/ListingPage';
import { OrderPage } from './pages/OrderPage';
import { ProfilePage } from './pages/ProfilePage';
import { SellPage } from './pages/SellPage';
import { LotBoardPage } from './pages/LotBoardPage';
import { ShopPage } from './pages/ShopPage';
import { ChannelPage, SocialPage } from './pages/SocialPage';
import { ThreadPage } from './pages/MessagesPage';
import { DisputePage } from './pages/DisputePage';
import { ExporterPage, PackingLotPage } from './pages/ExporterPage';
import { ProfileByHandlePage } from './pages/ProfileByHandlePage';
import { SessionProvider, useSession } from './session';
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
        <Route path="/batches" element={<BatchesPage />} />
        <Route path="/social" element={<SocialPage />} />
        <Route path="/social/c/:id" element={<ChannelPage />} />
        <Route path="/messages/:handle" element={<ThreadPage />} />
        <Route path="/packing" element={<ExporterPage />} />
        <Route path="/packing/:id" element={<PackingLotPage />} />
        <Route path="/order/:id" element={<OrderPage />} />
        <Route path="/dispute/:id" element={<DisputePage />} />
        <Route path="/forwarders" element={<ForwardersPage />} />
        <Route path="/me" element={<ProfilePage />} />
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
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
