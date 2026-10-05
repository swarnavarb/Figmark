/**
 * Draws app/public/og/figmark.jpg: the preview for a link that is about no
 * one thing (the home page, an unknown address). The same square card every
 * other share uses, painted by the API's renderer. Run after `npm run build`
 * in api/ whenever the card's layout changes.
 */
import { writeFileSync } from 'node:fs';

const api = new URL('../api/dist/', import.meta.url);
const { cardSvg, renderCard } = await import(new URL('api/src/og-card.js', api));

const spec = {
  seed: 'figmark',
  stamp: { label: 'PRE-ORDERS', from: '#7C3AED', to: '#EC4899', ink: '#FFFFFF' },
  headline: 'Import drops, bought together.',
  hero: { kind: 'brand' },
  title: 'Figmark',
  detail: 'Pre-orders from import resellers · live tracking · card packs',
  badge: null,
  protection: true,
};

const out = new URL('../app/public/og/figmark.jpg', import.meta.url);
writeFileSync(out, await renderCard(cardSvg(spec)));
console.log(`wrote ${out.pathname}`);
