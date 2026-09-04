import { config } from '../config.js';
import { CosmosRepository } from './cosmos-repository.js';
import { MemoryRepository } from './memory-repository.js';
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
      await repository.init();
      return repository;
    })();
  }
  return cached;
}
