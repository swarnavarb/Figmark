import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The domain model is shared with the API rather than duplicated, so a
      // change to a wire contract breaks the typecheck on both sides at once.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // Mirrors the Static Web Apps routing, so `/api/*` works the same locally
    // as it does in the deployed app.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7071',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // Two entry points, two bundles. The operations console shares nothing
      // with the marketplace but the API and the stylesheet: it is a different
      // audience, a different risk profile, and eventually a different host, so
      // it must not be reachable by clicking around inside the app.
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
      },
    },
  },
});
