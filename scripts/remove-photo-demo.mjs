/**
 * Removes the "Seen for sale" photo demo from a database that should never
 * have had it.
 *
 *   npm run build:api && npm run azure:remove-photo-demo            (lists only)
 *   npm run build:api && npm run azure:remove-photo-demo -- --yes   (deletes)
 *
 * Until the API held the photo demo to COSMOS_AUTOSEED like every other
 * fixture, any API that started wrote it: demo listings and posts by sellers
 * who do not exist there, and their photos in the listing-photos container.
 * This deletes exactly those documents (by id, from seed-photo-demo.ts) and
 * the photos they point at. Nothing else is read or touched.
 *
 * Settings as for provision-cosmos.mjs: COSMOS_ENDPOINT, COSMOS_KEY (or an
 * identity), COSMOS_DATABASE, STORAGE_ACCOUNT and STORAGE_KEY. Without the
 * storage settings the documents are still removed and the photos are listed.
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../api/package.json', import.meta.url));

let photoDemoRecords;
let containers;
try {
  ({ photoDemoRecords } = require('../api/dist/api/src/data/seed-photo-demo.js'));
  containers = await import(new URL('../api/dist/shared/containers.js', import.meta.url));
} catch {
  console.error('The API is not built. Run "npm run build:api" first.');
  process.exit(1);
}
const { DATABASE_NAME, PHOTO_CONTAINER_NAME } = containers;

const settings = process.env;
if (!settings.COSMOS_ENDPOINT) {
  console.error('COSMOS_ENDPOINT is not set. See docs/AZURE.md for how to obtain it.');
  process.exit(1);
}
const apply = process.argv.includes('--yes');

const { CosmosClient } = require('@azure/cosmos');
const client = settings.COSMOS_KEY
  ? new CosmosClient({ endpoint: settings.COSMOS_ENDPOINT, key: settings.COSMOS_KEY })
  : new CosmosClient({
      endpoint: settings.COSMOS_ENDPOINT,
      aadCredentials: new (require('@azure/identity').DefaultAzureCredential)(),
    });
const database = client.database(settings.COSMOS_DATABASE ?? DATABASE_NAME);

console.log(`${apply ? 'Removing' : 'Would remove (run again with --yes to delete)'} the photo demo from ${settings.COSMOS_ENDPOINT}\n`);

const { listings, posts } = photoDemoRecords();
const blobNames = new Set();
/** The blob behind a photo URL: its last path segment. */
const blobOf = (url) => (url ? decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '') : '');

async function remove(containerName, id, partitionKey, collect) {
  const item = database.container(containerName).item(id, partitionKey);
  let resource;
  try {
    ({ resource } = await item.read());
  } catch (error) {
    if (error.code !== 404) throw error;
  }
  if (!resource) return false;
  collect(resource);
  if (apply) await item.delete();
  return true;
}

let found = 0;
for (const { id, sellerId } of listings) {
  const present = await remove('listings', id, sellerId, (listing) => {
    for (const photo of listing.photos ?? []) if (photo.blobName) blobNames.add(photo.blobName);
  });
  if (present) found += 1;
  console.log(`  listing ${id.padEnd(26)} ${present ? (apply ? 'deleted' : 'present') : 'not there'}`);
}
for (const { id, channelId } of posts) {
  const present = await remove('posts', id, channelId, (post) => {
    for (const url of [post.photoUrl, ...(post.photoUrls ?? [])]) {
      const name = blobOf(url);
      if (name) blobNames.add(name);
    }
  });
  if (present) found += 1;
  console.log(`  post    ${id.padEnd(26)} ${present ? (apply ? 'deleted' : 'present') : 'not there'}`);
}

if (blobNames.size > 0) {
  console.log(`\nPhotos in ${PHOTO_CONTAINER_NAME}: ${blobNames.size}`);
  if (!settings.STORAGE_ACCOUNT || !settings.STORAGE_KEY) {
    console.log('  STORAGE_ACCOUNT and STORAGE_KEY are not both set, so the photos are left in place:');
    for (const name of blobNames) console.log(`  ${name}`);
  } else {
    const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
    const container = new BlobServiceClient(
      `https://${settings.STORAGE_ACCOUNT}.blob.core.windows.net`,
      new StorageSharedKeyCredential(settings.STORAGE_ACCOUNT, settings.STORAGE_KEY),
    ).getContainerClient(PHOTO_CONTAINER_NAME);
    for (const name of blobNames) {
      const blob = container.getBlockBlobClient(name);
      const exists = await blob.exists();
      if (exists && apply) await blob.delete();
      console.log(`  ${name.padEnd(42)} ${exists ? (apply ? 'deleted' : 'present') : 'not there'}`);
    }
  }
}

console.log(`\nDone. ${found} demo document(s) ${apply ? 'removed' : 'found'}.`);
