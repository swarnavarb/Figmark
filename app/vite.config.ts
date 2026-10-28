import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The loading screen paints before anything else has arrived.
 *
 * Its rules are written into index.html rather than linked, which saves a
 * round trip. And the app's own stylesheet, which Vite links in the head, no
 * longer blocks that first paint: a head stylesheet holds back the whole page
 * until it has downloaded, so the loading screen used to appear only after
 * 65 KB of styles it does not use. It is fetched at the same priority as before
 * (the preload), but applied by main.tsx, and the loading screen covers the
 * page until it is in (components/Preloader.tsx). The CSP allows inline styles
 * and no inline script, so the switch is made from the bundle, not an onload.
 */
function bootFirst(): Plugin {
  const loader = fileURLToPath(new URL('public/boot/loader.css', import.meta.url));
  return {
    name: 'figmark-boot-first',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.filename.endsWith('index.html')) return html;
        const rules = readFileSync(loader, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s*\n\s*/g, ' ')
          .trim();
        let page = html.replace(/<link rel="stylesheet" href="\/boot\/loader\.css"\s*\/?>/, `<style>${rules}</style>`);
        if (context.bundle) {
          page = page.replace(
            /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/g,
            '<link rel="preload" as="style" crossorigin href="$1">\n    <link rel="stylesheet" crossorigin href="$1" media="print" data-fm-css>',
          );
        }
        return page;
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), bootFirst()],
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
    // No source maps: the whole of dist is deployed, so a map - linked or
    // not - hands the original source to anybody who asks for it.
    sourcemap: false,
    rollupOptions: {
      // Two entry points, two bundles. The operations console shares nothing
      // with the marketplace but the API and the stylesheet: it is a different
      // audience, a different risk profile, and eventually a different host, so
      // it must not be reachable by clicking around inside the app.
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
      },
      output: {
        // React and the router change far less often than the app: kept in a
        // chunk of their own, a deploy of the app leaves them cached.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
