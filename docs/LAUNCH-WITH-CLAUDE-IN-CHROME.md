# Launch instructions for Claude in Chrome

Paste everything below the line into Claude in Chrome. Open
<https://portal.azure.com> and <https://github.com/swarnavarb/Figmark>
in tabs first, and sign in to both.

---

You are setting up the Figmark app's two environments, Development and
Production, on Azure and GitHub. Work in my signed-in Chrome. Use the Azure
Portal, Azure Cloud Shell (Bash) for commands, and GitHub's settings pages.
The full reference is `docs/ENVIRONMENTS.md` in the repository. Follow it when
these steps are not detailed enough.

## Rules, always

1. **Stop and ask me before:** deleting anything; any action that costs money
   beyond what is described here; approving a production deploy; buying the
   domain. Wait for me to say yes.
2. **Never show secrets.** Keys, tokens and passwords stay in Cloud Shell
   variables. Do not print them, do not paste them into chat, do not put them in
   screenshots. If a command prints one, clear the screen (`clear`).
3. Production's `AUTH_SESSION_SECRET` must be newly generated, never copied from
   development.
4. After each numbered step, tell me in one line what is done, then continue.
   If a command fails, stop, show me the error (no secrets) and ask.
5. Cloud Shell forgets variables when its session restarts. If one is empty,
   re-run the lines that set it.

## Step 0: Cloud Shell

1. Open Cloud Shell in the Azure Portal (the `>_` icon in the top bar), and pick **Bash**.
2. Run `az account show --query name -o tsv`, and ask me whether it's the right subscription.
3. Then run:
   ```bash
   git clone https://github.com/swarnavarb/Figmark.git
   cd Figmark && git checkout main
   npm run install:all && npm run build:api
   ```
   If the clone asks for a username or password, stop and ask me. The repository may be private.

## Step 1: Budget alarm

1. In the Portal, go to **Cost Management → Budgets → Add**.
2. Set the scope to the subscription and the amount to **$15 a month**.
3. Add alerts at 50%, 80% and 100%. Ask me which email to send them to.

## Step 2: Development gets its own serverless database

In Cloud Shell:

```bash
az cosmosdb create --name cosmos-figmark-dev --resource-group rg-figuremarket-dev \
  --capabilities EnableServerless --locations regionName=centralindia

ENDPOINT=$(az cosmosdb show -n cosmos-figmark-dev -g rg-figuremarket-dev --query documentEndpoint -o tsv)
KEY=$(az cosmosdb keys list -n cosmos-figmark-dev -g rg-figuremarket-dev --query primaryMasterKey -o tsv)

COSMOS_ENDPOINT="$ENDPOINT" COSMOS_KEY="$KEY" COSMOS_THROUGHPUT=serverless \
  npm run azure:provision

az staticwebapp appsettings set --name stapp-figuremarket-dev --resource-group rg-figuremarket-dev \
  --setting-names COSMOS_ENDPOINT="$ENDPOINT" COSMOS_KEY="$KEY" SITE_ENVIRONMENT=development
```

If `func-figmark-clocks-dev` exists (`az functionapp list -g rg-figuremarket-dev -o table`):

```bash
az functionapp config appsettings set --resource-group rg-figuremarket-dev --name func-figmark-clocks-dev \
  --settings COSMOS_ENDPOINT="$ENDPOINT" COSMOS_KEY="$KEY"
```

Then check <https://icy-stone-0498a9900.6.azurestaticapps.net>:
- It shows a **DEVELOPMENT** banner.
- `/api/health` says Cosmos DB is connected.

Tell me what you see.

**Ask me first**, then delete the old free database:

```bash
az cosmosdb delete --name cosmos-figuremarket-dev --resource-group rg-figuremarket-dev --yes
```

## Step 3: Production resources

```bash
az group create --name rg-figmark-prod --location centralindia

az cosmosdb create --name cosmos-figmark-prod --resource-group rg-figmark-prod \
  --enable-free-tier true --backup-policy-type Continuous --continuous-tier Continuous7Days \
  --locations regionName=centralindia

az storage account create --name stfigmarkprod --resource-group rg-figmark-prod --location centralindia \
  --sku Standard_LRS --kind StorageV2 --allow-blob-public-access true

az storage account blob-service-properties update --account-name stfigmarkprod --resource-group rg-figmark-prod \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-container-delete-retention true --container-delete-retention-days 30

az staticwebapp create --name stapp-figmark-prod --resource-group rg-figmark-prod \
  --location eastasia --sku Free
```

If the Cosmos create says a free-tier account already exists, wait 5 minutes
(the delete is still finishing) and retry.

Set up the database structure (it writes no data):

```bash
P_ENDPOINT=$(az cosmosdb show -n cosmos-figmark-prod -g rg-figmark-prod --query documentEndpoint -o tsv)
P_KEY=$(az cosmosdb keys list -n cosmos-figmark-prod -g rg-figmark-prod --query primaryMasterKey -o tsv)
S_KEY=$(az storage account keys list -n stfigmarkprod -g rg-figmark-prod --query "[0].value" -o tsv)
P_HOST=$(az staticwebapp show -n stapp-figmark-prod -g rg-figmark-prod --query defaultHostname -o tsv)

COSMOS_ENDPOINT="$P_ENDPOINT" COSMOS_KEY="$P_KEY" STORAGE_ACCOUNT=stfigmarkprod STORAGE_KEY="$S_KEY" \
  npm run azure:provision
```

## Step 4: Production settings

Ask me for the admin email address(es), then:

```bash
az staticwebapp appsettings set --name stapp-figmark-prod --resource-group rg-figmark-prod \
  --setting-names SITE_ENVIRONMENT=production \
    COSMOS_ENDPOINT="$P_ENDPOINT" COSMOS_KEY="$P_KEY" COSMOS_DATABASE=figmark \
    STORAGE_ACCOUNT=stfigmarkprod STORAGE_KEY="$S_KEY" \
    AUTH_SESSION_SECRET="$(openssl rand -hex 32)" \
    ADMIN_EMAILS="<ask me>" \
    PUBLIC_ORIGIN="https://figmark.in,https://www.figmark.in,https://$P_HOST" > /dev/null
```

Then tell me which of these are still missing. I will provide them later:
- Email: `BREVO_API_KEY`, `EMAIL_FROM`
- WhatsApp: the `WHATSAPP_*` settings
- Aadhaar: `AADHAAR_QR_CERT`
- Push: `WEB_PUSH_*`. These need new keys from `npm run push:keys`; don't reuse development's.
- CAPTCHA: `TURNSTILE_*`

## Step 5: Production clock app

Classic Consumption, Windows, Node 22. **Not** Flex Consumption, even if the
portal suggests it.

```bash
az functionapp create --resource-group rg-figmark-prod --name func-figmark-clocks-prod \
  --storage-account stfigmarkprod --consumption-plan-location centralindia \
  --os-type Windows --functions-version 4 --runtime node --runtime-version 22

az functionapp config appsettings set --resource-group rg-figmark-prod --name func-figmark-clocks-prod \
  --settings COSMOS_ENDPOINT="$P_ENDPOINT" COSMOS_KEY="$P_KEY" \
             STORAGE_ACCOUNT=stfigmarkprod STORAGE_KEY="$S_KEY" > /dev/null
```

The create command also makes an Application Insights resource called
`func-figmark-clocks-prod`. Open it → **Usage and estimated costs → Daily cap**
→ 0.1 GB.

Push keys: the clock app needs the same three `WEB_PUSH_*` values as the
production site (Step 4). If the site has them, copy them across without
showing them:

```bash
for n in WEB_PUSH_PUBLIC_KEY WEB_PUSH_PRIVATE_KEY WEB_PUSH_SUBJECT; do
  v=$(az staticwebapp appsettings list -n stapp-figmark-prod -g rg-figmark-prod --query "properties.$n" -o tsv)
  [ -n "$v" ] && az functionapp config appsettings set -g rg-figmark-prod -n func-figmark-clocks-prod --settings "$n=$v" > /dev/null && echo "$n copied"
done
unset v
```

If the site doesn't have them yet, tell me, and do this when it does.

```bash
APP_ID=$(az ad app list --display-name figmark-github-deploy --query "[0].appId" -o tsv)
az ad app federated-credential list --id "$APP_ID" --query "[].subject" -o tsv

APP_ID=$(az ad app list --display-name figmark-github-deploy --query "[0].appId" -o tsv)
az ad app federated-credential list --id "$APP_ID" --query "[].subject" -o tsv
```

If `repo:swarnavarb/Figmark:environment:production` isn't in that list:

```bash
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "figmark-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:swarnavarb/Figmark:environment:production",
  "audiences": ["api://AzureADTokenExchange"] }'
```

Then:

```bash
az role assignment create --assignee "$APP_ID" --role "Website Contributor" \
  --scope "$(az functionapp show -g rg-figmark-prod -n func-figmark-clocks-prod --query id -o tsv)"
```

## Step 6: GitHub settings

On <https://github.com/swarnavarb/Figmark/settings>:

1. **General → Default branch:** make sure it is `main`.
2. **Environments → production** (create it if it's missing):
   - **Required reviewers:** add me.
   - **Deployment branches and tags:** Selected branches, rule `main`.
   - **Environment secret** `AZURE_STATIC_WEB_APPS_API_TOKEN`. Get the value in Cloud Shell with:
     ```bash
     az staticwebapp secrets list -n stapp-figmark-prod -g rg-figmark-prod --query properties.apiKey -o tsv
     ```
     Copy it from Cloud Shell straight into the secret box, without showing it in chat. Then run `clear`.
     Leave the **repository** secret with the same name alone. It belongs to development.
3. **Secrets and variables → Actions → Variables:** add
   `CLOCK_APP_PRODUCTION` = `func-figmark-clocks-prod`.

## Step 7: First deploy to the new production app

1. Go to **Actions → Build and deploy → Run workflow**, and choose branch **main**.
2. When the run waits at the production deploy, **ask me**. I'll approve it myself, or tell you to press **Review deployments → Approve and deploy**.
3. When it's done, open `https://<P_HOST>/api/health`. Get the address with `echo $P_HOST`.
4. Report what it shows: `status` should be `ok`, and every service should be connected.

## Step 8: Domain (ask me first)

Ask me whether `figmark.in` is bought, and where its DNS is managed. Then:

1. **www:** add a DNS record at the registrar:
   - Type: CNAME
   - Name: `www`
   - Value: `$P_HOST`

   Then run:
   ```bash
   az staticwebapp hostname set -n stapp-figmark-prod -g rg-figmark-prod --hostname www.figmark.in
   ```
2. **The bare domain:**
   ```bash
   az staticwebapp hostname set -n stapp-figmark-prod -g rg-figmark-prod --hostname figmark.in --validation-method dns-txt-token
   ```
   Add the TXT record Azure gives you at the registrar. Then add an ALIAS/ANAME record (on Cloudflare, a CNAME) from the bare domain to `$P_HOST`.

## Step 9: Monitoring

1. **Azure alert:** on `cosmos-figmark-prod`, go to **Alerts → Create → Metric**.
   - Signal: **Total Requests**, split or filtered by **StatusCode = 429**.
   - Condition: greater than 0, over 5 minutes.
   - Action: email me.
2. **UptimeRobot:** tell me to create the account myself. Don't sign up on my behalf. Once I've signed in, add a **Keyword** monitor:
   - URL: `https://figmark.in/api/health`
   - Keyword: `"status":"ok"`
   - Interval: 5 minutes

## When finished

Give me a short checklist:
- What's done.
- What's still missing (settings I owe, the domain, DNS).
- Anything that looked wrong.
