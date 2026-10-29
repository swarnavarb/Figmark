/**
 * The demo world for the smoke tests and the local server.
 *
 * The API ships with no data at all; test-fixtures/ holds the accounts,
 * shops, lots and posts these scripts exercise it against. Import this module
 * before any API module: the demo account is made an operator through
 * ADMIN_EMAILS, which the API reads once, when its config loads.
 *
 *   import { fixtures, useFixtures } from './fixtures.mjs';
 *   await useFixtures();            // getRepository() now serves the fixtures
 *   const { DEMO_EMAIL } = fixtures;
 *
 * Needs `npm run build:api && npm run build:fixtures` first.
 */
process.env.ADMIN_EMAILS ??= 'demo@figmark.in';

let loaded;
try {
  loaded = await import(new URL('../test-fixtures/dist/test-fixtures/index.js', import.meta.url));
} catch {
  console.error('The test fixtures are not built. Run "npm run build:fixtures" first.');
  process.exit(1);
}

/** Everything test-fixtures/index.ts exports: fixtureSet(), the seed*() builders, DEMO_EMAIL and the rest. */
export const fixtures = loaded;

/** A fresh in-memory store holding the fixtures, not yet initialised. */
export async function fixtureRepository() {
  const { MemoryRepository } = await import(new URL('../api/dist/api/src/data/memory-repository.js', import.meta.url));
  return new MemoryRepository(fixtures.fixtureSet());
}

/** Make the API serve the fixtures: what getRepository() resolves from now on. */
export async function useFixtures() {
  const { useRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));
  useRepository(await fixtureRepository());
}
