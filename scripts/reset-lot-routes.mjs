/**
 * One-off reset: every seller's saved route templates are dropped and every
 * lot's own route snapshot is replaced with a single sample route, so all of
 * them read from exactly one route shape while the per-route framework is
 * still being worked out.
 *
 * Deleting a route template does not touch a lot already travelling it - each
 * lot carries its own copy, which is the whole point of a snapshot - so this
 * does the two things separately: clear the templates, then overwrite every
 * lot's own copy.
 *
 * Runs against whichever backend `getRepository()` resolves to (Cosmos if
 * COSMOS_ENDPOINT etc. are set, the in-memory store otherwise), exactly like
 * `azure:provision` and the smoke scripts. Re-run it after pointing the
 * process at a real deployment; nothing here is automatic on boot.
 */
import { randomUUID } from 'node:crypto';

const base = new URL('../api/dist/', import.meta.url);
const { getRepository } = await import(new URL('api/src/data/index.js', base));
const { ROUTE_TEMPLATES, normaliseSteps, stepForStage } = await import(new URL('shared/routes.js', base));

const repository = await getRepository();
const status = repository.status();
console.log(`Backend: ${repository.backend}${status.database ? ` (${status.database})` : ''}`);

/** The one shape every lot gets. A real route template, not the seven-stage
 *  built-in - so it proves the ladder reads any route the same way. */
const template = ROUTE_TEMPLATES.find((entry) => entry.id === 'supplier_accumulates') ?? ROUTE_TEMPLATES[0];
const sampleSteps = normaliseSteps(template.steps);

const lots = await repository.listLots();
const sellerIds = new Set(lots.map((lot) => lot.sellerId));

let routesDeleted = 0;
let routesCreated = 0;
let lotsUpdated = 0;

for (const sellerId of sellerIds) {
  const existing = await repository.listRoutes(sellerId);
  for (const route of existing) {
    if (await repository.deleteRoute(sellerId, route.id)) routesDeleted += 1;
  }

  const now = new Date().toISOString();
  const sample = await repository.saveRoute({
    id: `rt_${randomUUID().slice(0, 12)}`,
    sellerId,
    name: `${template.name} (sample)`,
    steps: sampleSteps,
    createdAt: now,
    updatedAt: now,
  });
  routesCreated += 1;

  for (const lot of lots.filter((entry) => entry.sellerId === sellerId)) {
    const route = { routeId: sample.id, name: sample.name, steps: sample.steps };
    await repository.updateLot({
      ...lot,
      route,
      // Keep the lot roughly where it was rather than snapping every one of
      // them back to the start: the coarse stage it already carries maps onto
      // wherever the sample route reaches the same stage.
      currentStep: stepForStage(route, lot.stage),
    });
    lotsUpdated += 1;
  }
}

console.log(`Sellers touched: ${sellerIds.size}`);
console.log(`Routes deleted: ${routesDeleted}`);
console.log(`Sample routes created: ${routesCreated}`);
console.log(`Lots updated: ${lotsUpdated}`);
