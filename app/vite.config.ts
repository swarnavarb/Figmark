import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import postcss, { type AtRule, type Plugin as PostcssPlugin, type Root, type Rule } from 'postcss';
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

/**
 * Motion follows the reader's choice, not only the phone's.
 *
 * The stylesheets say what changes with reduced motion the usual way, in
 * `@media (prefers-reduced-motion: reduce)` blocks (and a few
 * `no-preference` ones). A media query cannot be switched off from a menu, so
 * each block is rewritten here: its rules move out of the query and under
 * `:where(:root[data-motion="reduced"])` (or `:not(...)` for no-preference), which
 * src/motion.ts sets from the profile menu's switch, falling back to the
 * phone's own setting. Any other condition in the same query stays a query.
 */
const MOTION_FEATURE = /\(\s*prefers-reduced-motion\s*:\s*(reduce|no-preference)\s*\)/;
// In :where(), so a rule weighs exactly what it did inside the query and the
// cascade between rules is unchanged.
const MOTION_ON = '[data-motion="reduced"]';
const MOTION_OFF = ':not([data-motion="reduced"])';

function underMotion(selector: string, scope: string): string {
  const trimmed = selector.trim();
  // The root itself: the condition goes on it rather than above it.
  const root = trimmed.match(/^(html|:root)(?![\w-])/);
  if (root) return `${root[1]}:where(${scope})${trimmed.slice(root[1]!.length)}`;
  return `:where(:root${scope}) ${trimmed}`;
}

const motionFollowsChoice: PostcssPlugin = {
  postcssPlugin: 'figmark-motion-follows-choice',
  AtRule: {
    media(atRule) {
      const found = atRule.params.match(MOTION_FEATURE);
      if (!found) return;
      const scope = found[1] === 'reduce' ? MOTION_ON : MOTION_OFF;
      atRule.walkRules((rule) => {
        // Keyframe steps (from, 50%) are not selectors.
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as AtRule).name)) return;
        rule.selectors = rule.selectors.map((selector) => underMotion(selector, scope));
      });
      const rest = atRule.params
        .replace(MOTION_FEATURE, '')
        .replace(/^\s*and\s+|\s+and\s*$/gi, '')
        .replace(/\s+and\s+and\s+/gi, ' and ')
        .trim();
      if (rest) atRule.params = rest;
      else atRule.replaceWith(...(atRule.nodes ?? []));
    },
  },
};

/**
 * Hover belongs to a mouse.
 *
 * A phone has no hover, but it fakes one on every tap and keeps it until the
 * next tap somewhere else: a card tapped to open it stays lifted when you come
 * back, a button stays lit after its job is done. So every `:hover` rule moves
 * under `@media (hover: hover) and (pointer: fine)`, here at build time rather
 * than by hand in each of the stylesheets' ~180 hover rules, and a new one is
 * covered without anyone remembering to.
 *
 * Only the `:hover` selectors move. In `.x:hover, .x:active { … }` the
 * `:active` half stays where it was, so a finger still gets press feedback and
 * a keyboard still gets `:focus-visible`. The moved copy goes straight after
 * the rule it came from, so source order, and with it the cascade, is
 * unchanged. Rules already inside a hover query are left alone.
 */
const HOVER_QUERY = '(hover: hover) and (pointer: fine)';
const hoverMoved = new WeakSet<Rule>();

function insideHoverQuery(rule: Rule): boolean {
  for (let node: Rule['parent'] | Root['parent'] = rule.parent; node; node = node.parent) {
    if (node.type !== 'atrule') continue;
    const at = node as AtRule;
    if (/keyframes$/i.test(at.name)) return true;
    if (at.name === 'media' && /\bhover\b/.test(at.params)) return true;
  }
  return false;
}

const hoverNeedsAPointer: PostcssPlugin = {
  postcssPlugin: 'figmark-hover-needs-a-pointer',
  Rule(rule) {
    if (hoverMoved.has(rule) || !rule.selector.includes(':hover') || insideHoverQuery(rule)) return;
    const hover = rule.selectors.filter((selector) => selector.includes(':hover'));
    const rest = rule.selectors.filter((selector) => !selector.includes(':hover'));
    const moved = rule.clone({ selectors: hover });
    hoverMoved.add(moved);
    const query = postcss.atRule({ name: 'media', params: HOVER_QUERY });
    query.append(moved);
    rule.after(query);
    if (rest.length) rule.selectors = rest;
    else rule.remove();
  },
};

export default defineConfig({
  plugins: [react(), bootFirst()],
  css: {
    postcss: { plugins: [motionFollowsChoice, hoverNeedsAPointer] },
  },
  resolve: {
    alias: {
      // The domain model is shared with the API rather than duplicated, so a
      // change to a wire contract breaks the typecheck on both sides at once.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
      // MediaPipe's WebAssembly, which its package does not export: imported
      // with ?url, so it is served from this site under a hashed name.
      '@mediapipe-wasm': fileURLToPath(new URL('node_modules/@mediapipe/tasks-vision/wasm', import.meta.url)),
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
