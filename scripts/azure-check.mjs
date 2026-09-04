/**
 * Verifies connectivity to the three provisioned Azure resources.
 *
 * Run this from a network that is allowed to reach Azure, with credentials in
 * the environment (or in api/local.settings.json - this script reads that file
 * as a fallback so there is one place to keep them).
 *
 *   node scripts/azure-check.mjs
 *
 * Exits non-zero if any configured resource is unreachable. Resources with no
 * credentials configured are reported as skipped, not failed.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Azure SDKs live in api/node_modules; resolve them from there.
const require = createRequire(new URL('../api/package.json', import.meta.url));

const SWA_HOSTNAME = process.env.SWA_HOSTNAME ?? 'icy-stone-0498a9900.6.azurestaticapps.net';

/** Environment first, then api/local.settings.json, so either source works. */
async function loadSettings() {
  const values = { ...process.env };
  try {
    const raw = await readFile(new URL('../api/local.settings.json', import.meta.url), 'utf8');
    for (const [key, value] of Object.entries(JSON.parse(raw).Values ?? {})) {
      if (!values[key] && typeof value === 'string' && !value.startsWith('<')) values[key] = value;
    }
  } catch {
    // No local settings file; environment variables only.
  }
  return values;
}

/**
 * Bound every check. The Azure SDKs retry hard against an unreachable endpoint,
 * which turns a quick connectivity check into a multi-minute hang.
 */
const TIMEOUT_MS = Number(process.env.AZURE_CHECK_TIMEOUT_MS ?? 15_000);

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} did not respond within ${TIMEOUT_MS / 1000}s`)),
        TIMEOUT_MS,
      ).unref(),
    ),
  ]);
}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  const mark = ok === null ? 'skip' : ok ? ' ok ' : 'FAIL';
  console.log(`[${mark}] ${name}\n       ${detail}`);
};

const settings = await loadSettings();

console.log('Checking Azure resources for rg-figuremarket-dev\n');

/* Cosmos DB ---------------------------------------------------------------- */

if (!settings.COSMOS_ENDPOINT) {
  record('Cosmos DB', null, 'COSMOS_ENDPOINT not set - skipped.');
} else {
  try {
    const { CosmosClient } = require('@azure/cosmos');
    const connectionPolicy = {
      requestTimeout: TIMEOUT_MS,
      retryOptions: { maxRetryAttemptCount: 1, maxWaitTimeInSeconds: 5 },
    };
    const client = settings.COSMOS_KEY
      ? new CosmosClient({
          endpoint: settings.COSMOS_ENDPOINT,
          key: settings.COSMOS_KEY,
          connectionPolicy,
        })
      : new CosmosClient({
          endpoint: settings.COSMOS_ENDPOINT,
          aadCredentials: new (require('@azure/identity').DefaultAzureCredential)(),
          connectionPolicy,
        });

    const { resources } = await withTimeout(client.databases.readAll().fetchAll(), 'Cosmos DB');
    const dbName = settings.COSMOS_DATABASE ?? 'figmark';
    const found = resources.find((db) => db.id === dbName);

    if (!found) {
      record(
        'Cosmos DB',
        true,
        `Account reachable. Database "${dbName}" does not exist yet - run "npm run azure:provision". Databases present: ${
          resources.map((d) => d.id).join(', ') || '(none)'
        }`,
      );
    } else {
      const { resources: containers } = await withTimeout(
        client.database(dbName).containers.readAll().fetchAll(),
        'Cosmos DB',
      );
      record(
        'Cosmos DB',
        true,
        `Database "${dbName}" present with ${containers.length} containers: ${containers
          .map((c) => c.id)
          .join(', ')}`,
      );
    }
  } catch (error) {
    record('Cosmos DB', false, describe(error));
  }
}

/* Blob Storage ------------------------------------------------------------- */

if (!settings.STORAGE_ACCOUNT && !settings.STORAGE_CONNECTION_STRING) {
  record('Blob Storage', null, 'STORAGE_ACCOUNT not set - skipped.');
} else {
  try {
    const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
    let client;
    if (settings.STORAGE_CONNECTION_STRING) {
      client = BlobServiceClient.fromConnectionString(settings.STORAGE_CONNECTION_STRING);
    } else if (settings.STORAGE_KEY) {
      client = new BlobServiceClient(
        `https://${settings.STORAGE_ACCOUNT}.blob.core.windows.net`,
        new StorageSharedKeyCredential(settings.STORAGE_ACCOUNT, settings.STORAGE_KEY),
      );
    } else {
      client = new BlobServiceClient(
        `https://${settings.STORAGE_ACCOUNT}.blob.core.windows.net`,
        new (require('@azure/identity').DefaultAzureCredential)(),
      );
    }

    const names = await withTimeout(
      (async () => {
        const found = [];
        for await (const container of client.listContainers()) found.push(container.name);
        return found;
      })(),
      'Blob Storage',
    );
    record(
      'Blob Storage',
      true,
      `Account reachable. Containers: ${names.join(', ') || '(none yet - run "npm run azure:provision")'}`,
    );
  } catch (error) {
    record('Blob Storage', false, describe(error));
  }
}

/* Static Web App ----------------------------------------------------------- */

try {
  const response = await fetch(`https://${SWA_HOSTNAME}/`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const health = await fetch(`https://${SWA_HOSTNAME}/api/health`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
    .then(async (r) => (r.ok ? await r.json() : null))
    .catch(() => null);

  let detail;
  if (health) {
    detail = `API is live: data=${health.data.backend}, storage=${health.storage.backend}, auth=${health.auth.mode}.`;
  } else if (response.status === 403) {
    // A network policy denying the host and the site itself refusing look the
    // same from here, so name both rather than guessing.
    detail = 'Either the site is not deployed yet, or outbound access to this host is blocked.';
  } else {
    detail = 'The /api/health route did not respond - the app may not be deployed yet.';
  }

  record('Static Web App', response.ok, `${SWA_HOSTNAME} returned ${response.status}. ${detail}`);
} catch (error) {
  record('Static Web App', false, `${SWA_HOSTNAME}: ${describe(error)}`);
}

/* Summary ------------------------------------------------------------------ */

const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === null);
console.log(
  `\n${results.length - failed.length - skipped.length} reachable, ${failed.length} failed, ${skipped.length} skipped.`,
);
process.exit(failed.length > 0 ? 1 : 0);

function describe(error) {
  const message = error instanceof Error ? error.message : String(error);
  // The most common failure by far is a network policy blocking the host.
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|403|tunnel/i.test(message)) {
    return `${message} (check that outbound access to this host is allowed)`;
  }
  return message;
}
