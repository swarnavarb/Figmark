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

   Development environments only — it creates an account whose password is
   committed to this repository.

   > **The order of steps 3 and 5 matters.** Pointing the deployed API at a
   > database that does not exist, has no containers, or has no accounts in it
   > used to look exactly like a wrong password: sign-in resolves every
   > identifier to nobody, including the demo account, and no amount of
   > retyping fixes it. The API now says which of those it is — on
   > `/api/health`, and on the sign-in page itself — and seeds a database it
   > finds provisioned but completely empty, so this step is the explicit path
   > rather than the only one. Set `COSMOS_AUTOSEED=off` for a database that is
   > meant to start empty. Containers still have to exist first: creating them
   > is what step 3 does, and nothing can be written to a database without
   > them.

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

6. **Push to `main`.** The workflow builds, runs the smoke tests, and deploys.
   Then visit the site — the status page should show Database and Storage as
   Cosmos DB and Blob Storage rather than in-memory fallbacks.

   Note: the repository was empty before this scaffold, so GitHub made
   `claude/new-session-13ackt` the default branch. `main` is the production
   branch for deployment purposes regardless, because the deploy job names it
   explicitly — but the default branch is what people land on when they open the
   repository, and what new branches and pull requests base off. Set it to
   `main` under Settings → General → Default branch. Check that the Static Web
   App's own production branch setting in Azure matches.

## The operations console

The console is a second bundle in the same deployment, served at `/admin`. It
shares the API and the stylesheet with the marketplace and nothing else: its own
entry point, its own sign-in, no link either way.

**Nobody can reach it until you say who may.** `isAdmin` is derived at request
time from `ADMIN_EMAILS`, never from a row, so operating the marketplace cannot
be acquired by signing up, by a bug in a write path, or by restoring a database
from somewhere else. With the setting absent, a Cosmos-backed deployment has no
operators at all — which is the right state for one nobody has configured.

```bash
az staticwebapp appsettings set \
  --name stapp-figuremarket-dev \
  --resource-group rg-figuremarket-dev \
  --setting-names ADMIN_EMAILS="you@example.com,ops@example.com"
```

On the in-memory store the demo account is an operator by default. That store is
a throwaway whose password is published in this repository, so admin over data
that resets on restart grants nothing; a durable store gets nobody.

### Putting it on a subdomain

The console is built to live at `admin.<your domain>` — nothing in it links back
into the marketplace and nothing in the marketplace links to it, so moving it is
a hosting change rather than a code one. Two ways, depending on how separate you
want it:

1. **Same app, second custom domain.** Add `admin.<domain>` as a custom domain on
   the Static Web App (Settings → Custom domains) with a CNAME to the app's
   default hostname. Both hostnames serve the same content, so the console stays
   reachable at `/admin` on either — the separation is cosmetic, and the API is
   the thing actually enforcing access.

2. **Its own Static Web App.** Deploy `app/dist/admin.html` and its bundle as a
   separate app with `admin.<domain>` pointed at it, and give it the same
   `/api` backend by linking the Functions app. This is the one to choose if the
   console should be unreachable from the marketplace's hostname at all — for
   example behind a different network restriction.

Either way the DNS record and the Azure custom-domain step are manual: they
cannot be created from the repository.

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
- **Deploy** runs only for `main` and for manual dispatch. Other branches are
  built and verified but never published. It uses the
  `AZURE_STATIC_WEB_APPS_API_TOKEN` repository secret, and fails loudly if that
  secret is missing rather than skipping quietly — a green run that published
  nothing is worse than a red one.
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
