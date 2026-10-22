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

   Blob containers: `listing-photos` (public-read), `chat-photos` (private; chat
   photos are served only through the API to the two handles in the thread) and
   `dispute-evidence` (private).

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
   > `/api/health`, and on the sign-in page itself. On Azure it no longer
   > seeds an empty database by itself: the fixtures carry a published
   > password, including a community manager's, so they are written only
   > where `COSMOS_AUTOSEED=on` marks the database as a demo (it also keeps a
   > seeded demo topped up with fixtures later releases add). **Never set it
   > on production.** Off Azure it stays on unless `COSMOS_AUTOSEED=off`. Containers still have to exist first: creating them
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

   Two more settings, both optional:

   - `PASSWORD_BREACH_CHECK=on|off` - check new passwords against Have I Been
     Pwned (on by default in Azure). See [AUTH.md](AUTH.md).
   - `SWA_PRINCIPAL_TRUST=managed|linked` - required only with `AUTH_MODE=swa`;
     without it no `x-ms-client-principal` is believed. See [AUTH.md](AUTH.md).

   The site is sent with a Content-Security-Policy, HSTS and a
   Permissions-Policy (`globalHeaders` in `app/public/staticwebapp.config.json`).
   The policy allows no inline script, so anything that has to run before the
   bundle loads lives in `app/public/boot/`. Photos load only from this site
   and Azure Blob Storage (`*.blob.core.windows.net`) - every picture people
   add is uploaded here, so no other server sees who views it. Put a CDN in
   front of the photos container later and its host must be added to
   `img-src`. The API is called only on this origin.

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

## Shared test environments

The in-memory store is per worker. A Functions host runs several, and each one
keeps its own copy of every account, listing and order, so something a tester
creates on one is missing on the next request that lands elsewhere. Sign-in
hides this (the session token carries a snapshot of the account), nothing else
does. Fine for a demo; confusing for anyone testing.

Any environment more than one person tests against should run on Cosmos DB.
The serverless tier costs little at test volumes: set `COSMOS_ENDPOINT` and
`COSMOS_KEY`, then `npm run azure:provision` to create the containers. A
deployment still on memory says so in a standing banner on every page, and
`/api/health` reports `data.perWorker: true`.

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

Every write made from the console - suspending or deleting an account, granting
rights, appointing managers, reassigning disputes, deciding their actions,
settings, the Learn page, reports and store reviews - is recorded once it
succeeds, with the operator, the target and what they sent (secrets redacted).
It is kept one document per day in `siteContent` (`audit-YYYY-MM-DD`) and shown
under **Audit trail**, or at `GET /api/ops/audit?days=N`.

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

## The site's own address

Share cards (`/r/`, `/i/`, `/s/` links and `/api/og/card/...`) carry absolute
links, and the page they answer with is this site's `index.html`, fetched from
the site itself. Neither may come from `Host` or `x-forwarded-host`, which the
caller chooses. On Azure they come from `PUBLIC_ORIGIN`: the origins the site is
served at, comma-separated, the first used for any request that names none of
them. One `*` may stand for a single DNS label, to cover the branch and preview
environments.

Unset on Azure, it defaults to this Static Web App and its environments
(`https://icy-stone-0498a9900.6.azurestaticapps.net`,
`https://icy-stone-0498a9900-*.6.azurestaticapps.net`). Set it once a custom
domain is added, keeping the defaults after it:

```bash
az staticwebapp appsettings set \
  --name stapp-figuremarket-dev \
  --resource-group rg-figuremarket-dev \
  --setting-names PUBLIC_ORIGIN="https://figmark.in,https://icy-stone-0498a9900.6.azurestaticapps.net,https://icy-stone-0498a9900-*.6.azurestaticapps.net"
```

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

The workflow grants no token permissions by default; each job asks for
`contents: read` at most, since deploys authenticate to Azure with their own
token. Every action is pinned to a full commit SHA with its release in a
trailing comment — bump both together.

Both halves are pre-built in CI and uploaded with `skip_app_build` and
`skip_api_build`, so Oryx never rebuilds them. That matters because `shared/` is
compiled *into* the API by a `tsconfig` rooted above `api/` — Oryx running
`npm install` inside `api/` on its own would not reproduce that.

## The clock Function App

Some work falls due at a time rather than on a request. That work lives in
`api/src/clocks.ts`:

| Clock | Every | What it does |
|---|---|---|
| `power-sale-clock` | minute | moves each live power sale to its next item |
| `push-clock` | minute | sends notices whose undo window has ended |
| `preorder-clock` | minute | settles pre-orders past their cutoff or decision deadline |
| `games-clock` | minute | debate results, poll rewards, guess reveals, competition stages and prizes, "ending soon" reminders |
| `dispute-clock` | hour | applies dispute deadlines and releases held money |

Static Web Apps' managed functions run **HTTP triggers only**, so none of these
fire there. Some of them also run when someone reads the related page: the bell
sends held notices, the feed settles pre-orders and games, and the seller's
console moves a sale. That only helps while someone is on the site. So the same API build is
also deployed to a small standalone Function App that starts from
`clock-host.js`. It runs the timers and **no HTTP routes**: `http-off.ts` turns
route registration off. Its address is not behind Static Web Apps, so a route
served there would skip the sign-in Static Web Apps puts in front of the API.
It is not linked to the Static Web App, so the Free plan is enough.

It reads and writes the same Cosmos DB as the site. An environment still on the
in-memory store gets nothing from it, because the clock would be working on its
own copy of the data.

One app per environment. For development, with the names used above:

```bash
# Host storage can be the existing account. Flex Consumption is the plan to
# use; check the region offers it with: az functionapp list-flexconsumption-locations
az functionapp create \
  --resource-group rg-figuremarket-dev \
  --name func-figmark-clocks-dev \
  --storage-account stfiguremarketdev \
  --flexconsumption-location centralindia \
  --runtime node --runtime-version 20 \
  --instance-memory 512

# The settings the clocks read: the same values the Static Web App has
# (az staticwebapp appsettings list -n stapp-figuremarket-dev).
az functionapp config appsettings set \
  --resource-group rg-figuremarket-dev --name func-figmark-clocks-dev \
  --settings COSMOS_ENDPOINT=... COSMOS_KEY=... COSMOS_DATABASE=figmark \
             STORAGE_ACCOUNT=... STORAGE_KEY=... \
             WEB_PUSH_PUBLIC_KEY=... WEB_PUSH_PRIVATE_KEY=... WEB_PUSH_SUBJECT=... \
             PUBLIC_ORIGIN=...
```

Notifications link back to the site, so `PUBLIC_ORIGIN` matters here. Without it,
a notice would point at the Function App's own address.

**Deploying** is the `Deploy clocks` jobs in the workflow. GitHub signs in to
Azure over OIDC, so no password is stored:

```bash
APP_ID=$(az ad app create --display-name figmark-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
for env in development production; do
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"figmark-$env\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:swarnavarb/Figmark:environment:$env\",
    \"audiences\": [\"api://AzureADTokenExchange\"] }"
done
az role assignment create --assignee "$APP_ID" --role "Website Contributor" \
  --scope "$(az functionapp show -g rg-figuremarket-dev -n func-figmark-clocks-dev --query id -o tsv)"
```

Then, in the repository:

- **Secrets**: `AZURE_CLIENT_ID` (the `$APP_ID`), `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID`.
- **Variables**: `CLOCK_APP_DEVELOPMENT=func-figmark-clocks-dev`, plus
  `CLOCK_APP_PRODUCTION` once production has its own app.

A clock job is skipped while its variable is empty. Once the variable is set,
missing credentials fail the run rather than skipping it.

To check it works, open the Function App's **Functions** list in the portal. It
should show the five clocks and nothing else. Their invocation logs report what
each one settled.

**Cost**: about 175,000 runs a month at 512 MB. That should stay within or near
Flex Consumption's monthly free grant.

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
