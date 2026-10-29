import { config } from '../config.js';
import { CosmosRepository } from './cosmos-repository.js';
import { MemoryRepository } from './memory-repository.js';
import { withLotView } from './lot-view.js';
import { withTimedView } from './timed-view.js';
import type { Repository } from './repository.js';

export type { Repository, BackendStatus, CatalogQuery } from './repository.js';

let cached: Promise<Repository> | null = null;

/**
 * Resolve the configured repository, initialising it once per host instance.
 *
 * Cosmos is used when an endpoint is configured; otherwise the in-memory store
 * keeps the app usable. The promise is cached so concurrent invocations share
 * one initialisation rather than racing.
 */
export function getRepository(): Promise<Repository> {
  if (!cached) {
    cached = (async () => {
      const repository: Repository = config.cosmos
        ? new CosmosRepository(config.cosmos)
        : new MemoryRepository();
      return prepared(repository);
    })();
  }
  return cached;
}

/**
 * Serve from this store instead of the configured one: how the tests and the
 * local server run the API against test-fixtures/ without the API itself
 * carrying any.
 */
export function useRepository(repository: Repository): void {
  cached = prepared(repository);
}

async function prepared(repository: Repository): Promise<Repository> {
  await repository.init();
  // Orders are read with their lot's news and position, and written back
  // as only their own - see lot-view.ts. Posts and listings written ahead
  // stay out of sight until their moment - see timed-view.ts.
  return withTimedView(withLotView(repository));
}
