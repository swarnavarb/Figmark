/**
 * Creates the Cosmos database, its containers, and the blob containers.
 *
 *   npm run build:api && npm run azure:provision
 *
 * Idempotent: every create is a create-if-not-exists, so re-running it after
 * adding a container definition provisions only the new one. Container schema
 * comes from shared/containers.ts, so this script and the repository can never
 * disagree about a partition key.
 *
 * Note: unique key policies can only be set when a container is created. If a
 * container already exists, its unique keys are left as they are.
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
  DATABASE_NAME,
  SHARED_THROUGHPUT_RU,
  PHOTO_CONTAINER_NAME,
  EVIDENCE_CONTAINER_NAME,
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
const { database, statusCode } = await client.databases.createIfNotExists(
  { id: databaseName },
  { offerThroughput: SHARED_THROUGHPUT_RU },
);
console.log(
  `  database  ${databaseName} ${statusCode === 201 ? 'created' : 'already existed'} (${SHARED_THROUGHPUT_RU} RU/s shared)`,
);

for (const definition of CONTAINER_LIST) {
  const body = {
    id: definition.name,
    partitionKey: { paths: [definition.partitionKeyPath] },
    indexingPolicy: {
      indexingMode: 'consistent',
      automatic: true,
      includedPaths: [{ path: '/*' }],
      excludedPaths: [
        { path: '/"_etag"/?' },
        ...(definition.excludedPaths ?? []).map((path) => ({ path })),
      ],
      ...(definition.compositeIndexes ? { compositeIndexes: definition.compositeIndexes } : {}),
    },
  };

  if (definition.uniqueKeyPaths) {
    body.uniqueKeyPolicy = { uniqueKeys: definition.uniqueKeyPaths.map((paths) => ({ paths })) };
  }
  if (definition.defaultTtlSeconds !== undefined) {
    body.defaultTtl = definition.defaultTtlSeconds;
  }

  const result = await database.containers.createIfNotExists(body);
  console.log(
    `  container ${definition.name.padEnd(10)} ${
      result.statusCode === 201 ? 'created' : 'already existed'
    }  pk=${definition.partitionKeyPath}`,
  );
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
  // Listing photos are served publicly; dispute evidence never is.
  for (const [name, access] of [
    [PHOTO_CONTAINER_NAME, 'blob'],
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
