# Azure setup

## Provisioned resources

Resource group **`rg-figuremarket-dev`**, all tagged `project: figuremarket-dev`.

| Resource | Name | Details |
|---|---|---|
| Database | `cosmos-figuremarket-dev` | Cosmos DB, Core (SQL) API, Central India, free tier (1000 RU/s + 25 GB) |
| Storage | `stfiguremarketdev` | StorageV2, Standard_LRS, Central India — listing and condition photos |
| Hosting | `stapp-figuremarket-dev` | Static Web App, Free tier, East Asia — `icy-stone-0498a9900.6.azurestaticapps.net` |
| Auth | *not provisioned* | Deferred; see [AUTH.md](AUTH.md) |

## What still needs doing

The scaffold is complete and tested, but **nothing here has been run against
the live resources yet**. The session that built it had no network route to
Azure — `*.documents.azure.com`, `*.blob.core.windows.net` and the Static Web
App hostname were all refused by the environment's egress policy — and no Azure
credentials were present. These steps need a machine that can reach Azure:

1. **Add the deployment token.** In the repository, add a secret named
   `AZURE_STATIC_WEB_APPS_API_TOKEN`:

   ```bash
   az staticwebapp secrets list \
     --name stapp-figuremarket-dev \
     --resource-group rg-figuremarket-dev \
     --query "properties.apiKey" -o tsv
   ```

   (If the Static Web App was created with GitHub as its deployment source,
   Azure has already added this secret — check before creating a second one.)

2. **Collect the data credentials** into `api/local.settings.json` (copy
   `api/local.settings.json.example`; it is gitignored):

   ```bash
   az cosmosdb keys list \
     --name cosmos-figuremarket-dev \
     --resource-group rg-figuremarket-dev \
     --query "primaryMasterKey" -o tsv

   az storage account keys list \
     --account-name stfiguremarketdev \
     --resource-group rg-figuremarket-dev \
     --query "[0].value" -o tsv
   ```

3. **Create the database, containers and blob containers:**

   ```bash
   npm run build:api
   npm run azure:provision
   ```

   Add `-- --seed` to also write the development fixtures, so the deployed
   status page shows real data from Cosmos rather than an empty database:

   ```bash
   npm run azure:provision -- --seed
   ```

   Development environments only — it creates accounts whose password is
   committed to this repository.

4. **Confirm connectivity:**

   ```bash
   npm run azure:check
   ```

   It reports each resource as reachable, failed or skipped, and exits non-zero
   on failure. Every check is bounded (15s by default, `AZURE_CHECK_TIMEOUT_MS`)
   because the Azure SDKs otherwise retry an unreachable endpoint for minutes.

5. **Set the same values as Static Web App application settings**, so the
   deployed API uses Cosmos and Blob Storage rather than its fallbacks:

   ```bash
   az staticwebapp appsettings set \
     --name stapp-figuremarket-dev \
     --resource-group rg-figuremarket-dev \
     --setting-names \
       COSMOS_ENDPOINT="https://cosmos-figuremarket-dev.documents.azure.com:443/" \
       COSMOS_KEY="<key>" \
       COSMOS_DATABASE="figmark" \
       STORAGE_ACCOUNT="stfiguremarketdev" \
       STORAGE_KEY="<key>" \
       AUTH_SESSION_SECRET="<a long random string>"
   ```

   `AUTH_SESSION_SECRET` matters even while auth is mocked: without it the API
   falls back to a constant development secret, and anyone who reads this
   repository can mint a valid session token.

6. **Push to the default branch.** The workflow builds, runs the smoke tests,
   and deploys. Then visit the site — the status page should show Database and
   Storage as Cosmos DB and Blob Storage rather than in-memory fallbacks.

   Note: the repository was empty before this scaffold, so GitHub made
   `claude/new-session-13ackt` the default branch. If you want `main` to be the
   production branch, create it from this one and set it as default in the
   repository settings — the workflow follows whatever the default branch is, so
   nothing needs editing. Check that the Static Web App's own production branch
   setting in Azure matches.

## Preferring managed identity over keys

Both the repository and the storage client fall back to `DefaultAzureCredential`
when no key is configured. Once the Static Web App has a managed identity with
the Cosmos DB Built-in Data Contributor and Storage Blob Data Contributor roles,
drop `COSMOS_KEY` and `STORAGE_KEY` from the app settings and the code will use
the identity instead — no change required.

## Deployment pipeline

`.github/workflows/azure-static-web-apps.yml`:

- **Build and verify** runs on every push and pull request: installs, builds
  both sides, runs the smoke tests, prunes the API's dev dependencies, and
  uploads the artifact.
- **Deploy** runs only for the repository's default branch and for manual
  dispatch. Other branches are built and verified but never published. Until
  `AZURE_STATIC_WEB_APPS_API_TOKEN` exists the upload is skipped with a warning
  rather than failing the run (`skip_deploy_on_missing_secrets`), so the
  pipeline is green while the token is outstanding and starts deploying the
  moment it is added.
- **Close preview** tears down the preview environment when a PR closes.

Both halves are pre-built in CI and uploaded with `skip_app_build` and
`skip_api_build`, so Oryx never rebuilds them. That matters because `shared/` is
compiled *into* the API by a `tsconfig` rooted above `api/` — Oryx running
`npm install` inside `api/` on its own would not reproduce that.

## Free tier constraints

- Cosmos free tier covers the first 1000 RU/s and 25 GB, and only one account
  per subscription. Throughput is provisioned **on the database** rather than
  per container, so every container shares that single pool; a
  shared-throughput database allows up to 25 of them.
- Static Web Apps Free tier includes managed functions with no SLA and
  100 GB/month bandwidth. Custom authentication providers (a custom OpenID
  Connect registration, which is what Entra External ID would need) require the
  Standard plan — worth confirming against current Azure pricing before
  committing to that route (see [AUTH.md](AUTH.md)).
