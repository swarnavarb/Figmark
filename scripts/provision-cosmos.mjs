/**
 * Creates the Cosmos database, its containers, and the blob containers.
 *
 *   npm run build:api && npm run azure:provision
 *
 * Set COSMOS_THROUGHPUT=serverless for a serverless account (see the comment
 * on the database below); unset, the database gets the free tier's 1000 RU/s.
 *
 * It writes no data: a new database starts empty, and the first account is
 * whoever signs up.
 *
 * Idempotent: every create is a create-if-not-exists, so re-running it after
 * adding a container definition provisions only the new one. Container schema
 * comes from shared/containers.ts, so this script and the repository can never
 * disagree about a partition key.
 *
 * A container that already exists has its indexing and expiry (TTL) policy
 * brought in line with the schema; Cosmos re-indexes in the background. Unique
 * key policies can only be set when a container is created, so an existing
 * container's unique keys are left as they are. The API applies the same
 * policies itself on start-up when its identity is allowed to.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../api/package.json', import.meta.url));

let containers;
try {
  containers = await import(new URL('../api/dist/shared/containers.js', import.meta.url));
} catch {
  console.error('Container definitions are not built. Run "npm run build:api" first.');
  process.exit(1);
}

const {
  CONTAINER_LIST,
  containerBody,
  DATABASE_NAME,
  SHARED_THROUGHPUT_RU,
  PHOTO_CONTAINER_NAME,
  EVIDENCE_CONTAINER_NAME,
  CHAT_PHOTO_CONTAINER_NAME,
} = containers;

async function loadSettings() {
  const values = { ...process.env };
  try {
    const raw = await readFile(new URL('../api/local.settings.json', import.meta.url), 'utf8');
    for (const [key, value] of Object.entries(JSON.parse(raw).Values ?? {})) {
      if (!values[key] && typeof value === 'string' && !value.startsWith('<')) values[key] = value;
    }
  } catch {
    // Environment variables only.
  }
  return values;
}

const settings = await loadSettings();

if (!settings.COSMOS_ENDPOINT) {
  console.error('COSMOS_ENDPOINT is not set. See docs/AZURE.md for how to obtain it.');
  process.exit(1);
}

/* Cosmos ------------------------------------------------------------------- */

const { CosmosClient } = require('@azure/cosmos');
const client = settings.COSMOS_KEY
  ? new CosmosClient({ endpoint: settings.COSMOS_ENDPOINT, key: settings.COSMOS_KEY })
  : new CosmosClient({
      endpoint: settings.COSMOS_ENDPOINT,
      aadCredentials: new (require('@azure/identity').DefaultAzureCredential)(),
    });

const databaseName = settings.COSMOS_DATABASE ?? DATABASE_NAME;
console.log(`Provisioning database "${databaseName}" at ${settings.COSMOS_ENDPOINT}\n`);

// Throughput is provisioned on the database, not per container, so all
// containers share the free tier's 1000 RU/s rather than each reserving its own.
// COSMOS_THROUGHPUT overrides it: "serverless" for a serverless account, which
// refuses any throughput, or a number of RU/s (400 at least) to split the free
// tier between databases. On an account without the free tier, every RU/s
// provisioned here is billed, whether used or not.
const throughputSetting = (settings.COSMOS_THROUGHPUT ?? '').trim().toLowerCase();
let throughput = SHARED_THROUGHPUT_RU;
if (throughputSetting === 'serverless') {
  throughput = null;
} else if (throughputSetting) {
  throughput = Number(throughputSetting);
  if (!Number.isInteger(throughput) || throughput < 400 || throughput % 100 !== 0) {
    console.error(`COSMOS_THROUGHPUT must be "serverless" or a whole number of RU/s, 400 or more, in hundreds (got "${settings.COSMOS_THROUGHPUT}").`);
    process.exit(1);
  }
}
const { database, statusCode } = await client.databases.createIfNotExists(
  { id: databaseName },
  throughput === null ? undefined : { offerThroughput: throughput },
);
console.log(
  `  database  ${databaseName} ${statusCode === 201 ? 'created' : 'already existed'} (${throughput === null ? 'serverless' : `${throughput} RU/s shared`})`,
);

for (const definition of CONTAINER_LIST) {
  // The same body the API builds when it finds a container missing, so running
  // this script and letting the API heal itself produce the same container.
  const body = containerBody(definition);
  const result = await database.containers.createIfNotExists(body);
  let state = result.statusCode === 201 ? 'created' : 'already existed';
  if (result.statusCode !== 201) {
    const { resource } = await result.container.read();
    const shape = (policy, ttl) => JSON.stringify({
      excluded: (policy?.excludedPaths ?? []).map((entry) => entry.path).sort(),
      composite: (policy?.compositeIndexes ?? []).map((index) => index.map((entry) => `${entry.path} ${entry.order ?? 'ascending'}`).join(',')).sort(),
      ttl: ttl ?? null,
    });
    if (shape(resource.indexingPolicy, resource.defaultTtl) !== shape(body.indexingPolicy, body.defaultTtl)) {
      await result.container.replace({
        id: resource.id,
        partitionKey: resource.partitionKey,
        ...(resource.uniqueKeyPolicy ? { uniqueKeyPolicy: resource.uniqueKeyPolicy } : {}),
        indexingPolicy: body.indexingPolicy,
        ...(body.defaultTtl !== undefined ? { defaultTtl: body.defaultTtl } : {}),
      });
      state = 'policy updated';
    }
  }
  console.log(`  container ${definition.name.padEnd(10)} ${state}  pk=${definition.partitionKeyPath}`);
}

/* Blob containers ---------------------------------------------------------- */

if (!settings.STORAGE_ACCOUNT && !settings.STORAGE_CONNECTION_STRING) {
  console.log('\nSkipping blob containers: STORAGE_ACCOUNT is not set.');
} else {
  const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
  let blobClient;
  if (settings.STORAGE_CONNECTION_STRING) {
    blobClient = BlobServiceClient.fromConnectionString(settings.STORAGE_CONNECTION_STRING);
  } else if (settings.STORAGE_KEY) {
    blobClient = new BlobServiceClient(
      `https://${settings.STORAGE_ACCOUNT}.blob.core.windows.net`,
      new StorageSharedKeyCredential(settings.STORAGE_ACCOUNT, settings.STORAGE_KEY),
    );
  } else {
    blobClient = new BlobServiceClient(
      `https://${settings.STORAGE_ACCOUNT}.blob.core.windows.net`,
      new (require('@azure/identity').DefaultAzureCredential)(),
    );
  }

  console.log('\nProvisioning blob containers');
  // Listing photos are served publicly; chat photos and dispute evidence never are.
  for (const [name, access] of [
    [PHOTO_CONTAINER_NAME, 'blob'],
    [CHAT_PHOTO_CONTAINER_NAME, undefined],
    [EVIDENCE_CONTAINER_NAME, undefined],
  ]) {
    const container = blobClient.getContainerClient(name);
    const result = await container.createIfNotExists(access ? { access } : {});
    console.log(
      `  container ${name.padEnd(18)} ${result.succeeded ? 'created' : 'already existed'}  access=${access ?? 'private'}`,
    );
  }
}

console.log('\nDone. Run "npm run azure:check" to confirm.');
