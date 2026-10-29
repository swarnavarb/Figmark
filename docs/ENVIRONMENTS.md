# Environments

Two environments, each with its own database, photo storage, website and
clock app. Nothing is shared between them.

| | Development | Production |
|---|---|---|
| Address | `dev.figmark.in` | `figmark.in` (and `www.figmark.in`) |
| Branch | `development`: every push deploys | `main`: deploys after someone approves it |
| Resource group | `rg-figuremarket-dev` | `rg-figmark-prod` |
| Cosmos DB | `cosmos-figmark-dev`, **serverless** (pay per use) | `cosmos-figmark-prod`, **free tier** (1000 RU/s, 25 GB) |
| Storage | `stfiguremarketdev` | `stfigmarkprod` |
| Static Web App | `stapp-figuremarket-dev`, Free plan | `stapp-figmark-prod`, Free plan |
| Clock Function App | `func-figmark-clocks-dev` (optional; classic Consumption, Windows, Node 22, no Application Insights, no `push-wake`) | `func-figmark-clocks-prod` (classic Consumption, Windows, Node 22, trimmed Application Insights, `push-wake` on) |
| `SITE_ENVIRONMENT` | `development` (test-site banner, kept out of search engines) | `production` |

A release: work lands on `development` and is checked on the development
site. A pull request from `development` into `main`, merged, builds once; the
production deploy then waits in GitHub Actions until an approver presses
**Approve and deploy**.

Expected cost at launch: a few dollars a month on Azure, plus 18% GST. The
free Cosmos tier is the one allowance worth the most, so it goes to
production. There is one per subscription.

The steps below are in the order they have to happen. Commands assume the
Azure CLI signed in to the right subscription (`az login`), run from the
repository root after `npm run install:all && npm run build:api`.

## 1. Budget alarm

Portal: **Cost Management → Budgets → Add**. Scope: the subscription. Amount:
$15 a month. Alerts at 50%, 80% and 100% to your email. Costs nothing.

## 2. Move development to a serverless database

Development moves first, so it keeps working while the free tier is freed for
production.

```bash
az cosmosdb create \
  --name cosmos-figmark-dev --resource-group rg-figuremarket-dev \
  --capabilities EnableServerless \
  --locations regionName=centralindia

ENDPOINT=$(az cosmosdb show -n cosmos-figmark-dev -g rg-figuremarket-dev --query documentEndpoint -o tsv)
KEY=$(az cosmosdb keys list -n cosmos-figmark-dev -g rg-figuremarket-dev --query primaryMasterKey -o tsv)

# Serverless refuses a throughput setting, hence COSMOS_THROUGHPUT.
# It writes no data: development starts empty, like production.
COSMOS_ENDPOINT="$ENDPOINT" COSMOS_KEY="$KEY" COSMOS_THROUGHPUT=serverless \
  npm run azure:provision
```

Point the development site at it (the app's production slot; see step 9):

```bash
az staticwebapp appsettings set \
  --name stapp-figuremarket-dev --resource-group rg-figuremarket-dev \
  --setting-names COSMOS_ENDPOINT="$ENDPOINT" COSMOS_KEY="$KEY" \
    SITE_ENVIRONMENT=development
```

Do the same for the development clock app, if it exists:

```bash
az functionapp config appsettings set \
  --resource-group rg-figuremarket-dev --name func-figmark-clocks-dev \
  --settings COSMOS_ENDPOINT="$ENDPOINT" COSMOS_KEY="$KEY"
```

Check the development site: it should show the DEVELOPMENT banner, and
`/api/health` should report Cosmos DB connected, with no accounts until
somebody signs up.

Then delete the old free-tier account. It holds only test data, and the demo
accounts in it have a password published in this repository, so it must not
become production:

```bash
az cosmosdb delete --name cosmos-figuremarket-dev --resource-group rg-figuremarket-dev
```

## 3. Production resources

```bash
az group create --name rg-figmark-prod --location centralindia

# Free tier and the free 7-day continuous backup. If this says the
# subscription already has a free-tier account, the delete in step 2 has not
# finished yet: wait a few minutes.
az cosmosdb create \
  --name cosmos-figmark-prod --resource-group rg-figmark-prod \
  --enable-free-tier true \
  --backup-policy-type Continuous --continuous-tier Continuous7Days \
  --locations regionName=centralindia

# Listing photos are public-read, so the account must allow public containers.
az storage account create \
  --name stfigmarkprod --resource-group rg-figmark-prod --location centralindia \
  --sku Standard_LRS --kind StorageV2 --allow-blob-public-access true

az storage account blob-service-properties update \
  --account-name stfigmarkprod --resource-group rg-figmark-prod \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-container-delete-retention true --container-delete-retention-days 30

# Static Web Apps offers only a few regions; East Asia is the nearest.
az staticwebapp create \
  --name stapp-figmark-prod --resource-group rg-figmark-prod \
  --location eastasia --sku Free
```

Create the database and containers, without `COSMOS_THROUGHPUT` (the free
tier's 1000 RU/s):

```bash
P_ENDPOINT=$(az cosmosdb show -n cosmos-figmark-prod -g rg-figmark-prod --query documentEndpoint -o tsv)
P_KEY=$(az cosmosdb keys list -n cosmos-figmark-prod -g rg-figmark-prod --query primaryMasterKey -o tsv)
S_KEY=$(az storage account keys list -n stfigmarkprod -g rg-figmark-prod --query "[0].value" -o tsv)

COSMOS_ENDPOINT="$P_ENDPOINT" COSMOS_KEY="$P_KEY" \
STORAGE_ACCOUNT=stfigmarkprod STORAGE_KEY="$S_KEY" \
  npm run azure:provision
```

## 4. Production settings

Every value here is production's own. None is copied from development,
`AUTH_SESSION_SECRET` least of all: a shared key would make a development
sign-in valid on production.

```bash
az staticwebapp appsettings set \
  --name stapp-figmark-prod --resource-group rg-figmark-prod \
  --setting-names \
    SITE_ENVIRONMENT=production \
    COSMOS_ENDPOINT="$P_ENDPOINT" COSMOS_KEY="$P_KEY" COSMOS_DATABASE=figmark \
    STORAGE_ACCOUNT=stfigmarkprod STORAGE_KEY="$S_KEY" \
    AUTH_SESSION_SECRET="$(openssl rand -hex 32)" \
    ADMIN_EMAILS="you@example.com" \
    PUBLIC_ORIGIN="https://figmark.in,https://www.figmark.in,https://<prod app hostname>"
```

`<prod app hostname>` is `az staticwebapp show -n stapp-figmark-prod -g rg-figmark-prod --query defaultHostname -o tsv`.
Set `PUBLIC_ORIGIN` on this app: unset, it defaults to the development app's
address, and share links would point there.

Then, as each one is ready (full table in [OPERATIONS.md](OPERATIONS.md#1-production-settings)):

- Email: `BREVO_API_KEY`, `EMAIL_FROM`. Without one nobody can verify an email, so nobody new can buy.
- WhatsApp: `WHATSAPP_BUSINESS_NUMBER`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
- Aadhaar: `AADHAAR_QR_CERT`.
- Push: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (new keys from `npm run push:keys`, not development's).
- CAPTCHA: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.

## 5. Production clock app

```bash
az functionapp create \
  --resource-group rg-figmark-prod --name func-figmark-clocks-prod \
  --storage-account stfigmarkprod \
  --consumption-plan-location centralindia \
  --os-type Windows --functions-version 4 \
  --runtime node --runtime-version 22

az functionapp config appsettings set \
  --resource-group rg-figmark-prod --name func-figmark-clocks-prod \
  --settings COSMOS_ENDPOINT="$P_ENDPOINT" COSMOS_KEY="$P_KEY" \
             STORAGE_ACCOUNT=stfigmarkprod STORAGE_KEY="$S_KEY" \
             WEB_PUSH_PUBLIC_KEY=... WEB_PUSH_PRIVATE_KEY=... WEB_PUSH_SUBJECT=...
```

Let GitHub deploy it. The sign-in app (`figmark-github-deploy`) already
exists from development; give it a production credential, if it has none,
and the right to deploy this app:

```bash
APP_ID=$(az ad app list --display-name figmark-github-deploy --query "[0].appId" -o tsv)
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "figmark-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:swarnavarb/Figmark:environment:production",
  "audiences": ["api://AzureADTokenExchange"] }'
az role assignment create --assignee "$APP_ID" --role "Website Contributor" \
  --scope "$(az functionapp show -g rg-figmark-prod -n func-figmark-clocks-prod --query id -o tsv)"
```

This creates an Application Insights resource with the same name. Give it a
**Daily cap** of 0.1 GB (Usage and estimated costs). The push keys are the
production ones from step 4; without them the clock sends no pushes.

Both clock apps fit in the subscription's classic Consumption free grant.
What they cost is storage and this app's telemetry: about ₹100–200 a month
together. Why classic and not Flex Consumption: [AZURE.md](AZURE.md#the-clock-function-app).

For pushes on time with nobody on the site, also set up the `push-wake`
queue: [PUSH-WAKE-WITH-CLAUDE-IN-CHROME.md](PUSH-WAKE-WITH-CLAUDE-IN-CHROME.md), production part.

## 6. GitHub

Settings, in the repository:

1. **General → Default branch:** `main`.
2. **Environments → production:**
   - **Required reviewers:** yourself. Nothing deploys to production until one of them approves the run.
   - **Deployment branches:** selected branches, `main` only.
   - **Environment secret** `AZURE_STATIC_WEB_APPS_API_TOKEN`: the production app's token,
     `az staticwebapp secrets list -n stapp-figmark-prod -g rg-figmark-prod --query properties.apiKey -o tsv`.
     It takes precedence over the repository secret of the same name, which stays the development app's.
3. **Variables:** `CLOCK_APP_PRODUCTION=func-figmark-clocks-prod`.

## 7. First production release

Open a pull request from `development` into `main` and merge it. The run
builds, tests, then waits at **Deploy to Static Web Apps**: open it in the
Actions tab, **Review deployments → Approve and deploy**.

Then open `https://<prod app hostname>/api/health` signed in as an operator:
every line connected, `sessionSecretSource: configured`, `status: ok`.

## 8. Domain

At the domain registrar (its free DNS, or Cloudflare's; Azure DNS costs
extra), then:

```bash
# www: a CNAME from www to the prod app's hostname first.
az staticwebapp hostname set -n stapp-figmark-prod -g rg-figmark-prod --hostname www.figmark.in

# The bare domain: Azure gives a TXT value to add; then an ALIAS/ANAME (or
# Cloudflare's flattened CNAME) to the prod app's hostname.
az staticwebapp hostname set -n stapp-figmark-prod -g rg-figmark-prod \
  --hostname figmark.in --validation-method dns-txt-token
```

## 9. Development on its own address

Done on 29 October 2026: development deploys to the production slot of
`stapp-figuremarket-dev` (`icy-stone-0498a9900.6.azurestaticapps.net`), and the
app's `development` environment was deleted. Its database was emptied, and
the API no longer carries any demo data, so development starts empty like
production. The steps, for reference:

A custom domain attaches to an app's production environment only, which is
why development moved there. Steps 1 and 2 are done; step 3 gives it
`dev.figmark.in` whenever that is wanted:

1. Copy every setting of the app's `development` environment onto its
   production slot (`az staticwebapp appsettings list ... --environment-name development`,
   then `appsettings set` without `--environment-name`).
2. In the workflow's `deploy_development` job, change `production_branch: main`
   to `production_branch: development`, so development deploys to that slot.
3. CNAME `dev` to `stapp-figuremarket-dev`'s hostname, then
   `az staticwebapp hostname set -n stapp-figuremarket-dev -g rg-figuremarket-dev --hostname dev.figmark.in`.

Skipping this leaves development on its azurestaticapps.net address, which
works just as well.

## 10. Monitoring, free

- **UptimeRobot**: a keyword monitor on `https://figmark.in/api/health` for
  `"status":"ok"` every 5 minutes, alerting by email and the phone app. A
  keyword rather than a plain check, because a degraded deployment still
  answers 200.
- **Azure alert**: one metric alert on `cosmos-figmark-prod`, `Total Requests`
  with `StatusCode = 429`, above 0 for 5 minutes (about $0.10 a month).
- **Restore drill** before launch: [OPERATIONS.md](OPERATIONS.md#3-backups-and-restore),
  restoring into a scratch account and deleting it after.

## Before a risky release

There is no staging. For a release that changes stored data in a way you are
unsure of, restore production to a scratch account
([OPERATIONS.md](OPERATIONS.md#3-backups-and-restore)), point the development
site at it for the test, then point it back and delete the scratch account.
It holds real people's data while it exists, so keep it short and do not
send email from it.

Every release must work with the data the release before it wrote: add
fields, and remove old ones a release later. The API brings stored data up to
date on start-up, and rolling the code back does not roll the data back.
