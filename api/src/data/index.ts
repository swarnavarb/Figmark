import { config } from '../config.js';
import { CosmosRepository } from './cosmos-repository.js';
import { MemoryRepository } from './memory-repository.js';
import { withLotView } from './lot-view.js';
import { withTimedView } from './timed-view.js';
import type { Repository } from './repository.js';

export type { Repository, BackendStatus, CatalogQuery } from './repository.js';

/**
 * How long a host instance that could not reach its database keeps that
 * answer before trying again. Long enough that a database which is really
 * gone is not asked on every request; short enough that one which was only
 * briefly away - an outage, or a database deleted and recreated - is back in
 * use within a minute, without anybody restarting the API.
 */
export const RETRY_AFTER_MS = 30_000;

/**
 * Open a store once and keep it, unless it came up unable to reach its
 * database: then the failure is kept for retryAfterMs and the next call after
 * that opens it afresh. Concurrent calls share one attempt either way.
 *
 * Before this, the first answer was kept for the life of the instance, so a
 * worker that started while the database was unreachable stayed broken until
 * Azure happened to recycle it.
 */
export function openOnce(
  open: () => Promise<Repository>,
  retryAfterMs = RETRY_AFTER_MS,
  now: () => number = Date.now,
): () => Promise<Repository> {
  let pending: Promise<Repository> | null = null;
  let failedAt: number | null = null;
  return () => {
    if (pending && failedAt !== null && now() - failedAt >= retryAfterMs) {
      pending = null;
      failedAt = null;
    }
    if (!pending) {
      pending = open().then(
        (repository) => {
          if (!repository.status().connected) failedAt = now();
          return repository;
        },
        (error: unknown) => {
          failedAt = now();
          throw error;
        },
      );
    }
    return pending;
  };
}

const configured = openOnce(() => prepared(
  config.cosmos ? new CosmosRepository(config.cosmos) : new MemoryRepository(),
));

let chosen: Promise<Repository> | null = null;

/**
 * Resolve the configured repository, initialising it once per host instance.
 *
 * Cosmos is used when an endpoint is configured; otherwise the in-memory store
 * keeps the app usable. A store that could not reach its database is tried
 * again after RETRY_AFTER_MS; see openOnce.
 */
export function getRepository(): Promise<Repository> {
  return chosen ?? configured();
}

/**
 * Serve from this store instead of the configured one: how the tests and the
 * local server run the API against test-fixtures/ without the API itself
 * carrying any.
 */
export function useRepository(repository: Repository): void {
  chosen = prepared(repository);
}

async function prepared(repository: Repository): Promise<Repository> {
  await repository.init();
  // Orders are read with their lot's news and position, and written back
  // as only their own - see lot-view.ts. Posts and listings written ahead
  // stay out of sight until their moment - see timed-view.ts.
  return withTimedView(withLotView(repository));
}
