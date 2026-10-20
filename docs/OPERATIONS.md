# Operations

What has to be true before real people use Figmark, and how to keep it that
way. Resource names follow `docs/AZURE.md` (`rg-figuremarket-dev`,
`cosmos-figuremarket-dev`, `stfiguremarketdev`, `stapp-figuremarket-dev`);
use the production ones in their place.

## 1. Production settings

Set these as Static Web App application settings
(`az staticwebapp appsettings set --name … --setting-names KEY=value …`).

| Setting | Value | Why |
|---|---|---|
| `AUTH_SESSION_SECRET` | 64+ random characters (`openssl rand -hex 32`) | Signs sessions. Without it a deployment with no database refuses sign-in. |
| `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE` | from the Cosmos account | Durable data. |
| `COSMOS_AUTOSEED` | **leave unset** (never `on`) | On Azure the demo fixtures, whose password is public, are written only when this is `on`. |
| `STORAGE_ACCOUNT`, `STORAGE_KEY` | from the storage account | Photos. |
| `ADMIN_EMAILS` | comma-separated operator emails | Nobody operates the site otherwise. Each must confirm that email on their account, and turn on two-factor sign-in, before the console opens. |
| `STAFF_MFA` | leave unset (on by default in Azure) | Operators and community managers must use two-factor sign-in. |
| `PUBLIC_ORIGIN` | `https://your-domain` first, then the azurestaticapps.net address | Share cards and preview links use the first one. |
| `BREVO_API_KEY` / `MAILJET_*` / `RESEND_API_KEY`, `EMAIL_FROM` | from the providers | Verification, password reset and email-change codes. **Without one, nobody can verify an email, so nobody new can buy.** |
| `WHATSAPP_BUSINESS_NUMBER`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | from Meta | Phone verification, needed to buy. |
| `AADHAAR_QR_CERT` | UIDAI's offline-verification certificate | Needed to sell. |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | `npm run push:keys` | Lock-screen notifications. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare dashboard → Turnstile | CAPTCHA on sign-up. Off when unset. |
| `ANTHROPIC_API_KEY` | optional | Photo search by what is in the picture. |

After setting them, open `/api/health` signed in as an operator: every line
should read connected, `sessionSecretSource` should be `configured`, and
`status` should be `ok`.

Payments are still simulated (`simulatedPayment: true` on every payment
response). Do not take real money until a payment gateway and an
RBI-compliant arrangement for holding buyers' money are in place.

## 2. Custom domain

1. `az staticwebapp hostname set --name stapp-figuremarket-prod --resource-group rg-figuremarket-prod --hostname www.example.in`
   (add the CNAME the command asks for first; an apex domain needs a TXT
   validation and an ALIAS/ANAME record).
2. Put the new origin first in `PUBLIC_ORIGIN`.
3. Optionally redirect the azurestaticapps.net address to the domain.

On its own domain the session cookie is no longer shared with other
`*.azurestaticapps.net` sites as "same-site" (the API also refuses form-encoded
writes, so cross-site form posts are blocked either way).

## 3. Backups and restore

### Cosmos DB: continuous backup

```bash
az cosmosdb update \
  --name cosmos-figuremarket-prod --resource-group rg-figuremarket-prod \
  --backup-policy-type Continuous --continuous-tier Continuous30Days
```

This keeps a restorable point for every second of the last 30 days. Moving to
continuous backup cannot be undone, which is fine.

**Restore** (into a new account; the live one is never overwritten):

```bash
az cosmosdb restore \
  --target-database-account-name cosmos-figuremarket-restore \
  --account-name cosmos-figuremarket-prod --resource-group rg-figuremarket-prod \
  --restore-timestamp 2026-11-01T10:00:00Z --location centralindia
```

Then point `COSMOS_ENDPOINT` / `COSMOS_KEY` at the restored account, check
`/api/health`, and only then retire the old one.

### Blob Storage: soft delete and versioning

```bash
az storage account blob-service-properties update \
  --account-name stfiguremarketprod --resource-group rg-figuremarket-prod \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-container-delete-retention true --container-delete-retention-days 30 \
  --enable-versioning true
```

A photo deleted by mistake (or by the unused-photo cleanup) can be undeleted
for 30 days from the portal or with `az storage blob undelete`.

### Restore drill

Once before launch and then every quarter: restore Cosmos to a scratch account,
point a development deployment at it, sign in, open an order, and time it.
Write the time down. That is the number to quote when something goes wrong.

## 4. Monitoring and alerts

The API logs every unhandled error, and browsers report theirs to
`POST /api/client-errors`, which logs them as `Client error: {…}`. Both reach
Application Insights.

Create, in Application Insights for the Static Web App:

1. **Availability test**: standard test, `GET https://your-domain/api/health`,
   every 5 minutes from 3 locations, alert when 2 locations fail.
2. **Server errors**: log alert on
   `requests | where resultCode startswith "5" | summarize count() by bin(timestamp, 5m)`,
   threshold 10 in 5 minutes.
3. **Browser errors**: log alert on
   `traces | where message startswith "Client error" | summarize count() by bin(timestamp, 15m)`,
   threshold 20 in 15 minutes.
4. **Cosmos throttling**: metric alert on the Cosmos account,
   `Total Requests` filtered to `StatusCode = 429`, more than 0 for 5 minutes.

Send all of them to an action group that pages a person, not only an inbox.

## 5. Load test

`scripts/load-test.mjs` drives the pages every visit starts with
(`/api/bootstrap`, `/api/feed`, `/api/social/discover`, a listing) at a set
rate and reports latency percentiles and errors:

```bash
node scripts/load-test.mjs https://your-dev-deployment 20 60
#                           base URL                    rps duration (s)
```

Run it against the development deployment on Cosmos, never production. Watch
Cosmos "Normalized RU Consumption" while it runs: above 70% at your expected
peak, move from serverless to provisioned throughput (autoscale), or add
indexes for the queries that cost most (Cosmos Insights → Top queries by RU).

## 6. Launch checklist

- [ ] Section 1 settings set; `/api/health` is `ok`
- [ ] Custom domain live; `PUBLIC_ORIGIN` updated
- [ ] Continuous backup on; blob soft delete on; restore drill done and timed
- [ ] Alerts created and tested (break `/api/health` on a development deployment)
- [ ] Load test run at 2x the expected peak with no errors
- [ ] Legal pages (`/legal`) reviewed by counsel; [bracketed] values filled; `LEGAL_VERSION` bumped
- [ ] Grievance Officer named and reachable
- [ ] Payment gateway live and reconciled, or launch without taking payments
- [ ] GitHub default branch set to `main`
