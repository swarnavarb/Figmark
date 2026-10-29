# Pushes on the minute: instructions for Claude in Chrome

Paste everything below the line into Claude in Chrome. Before that, open
<https://portal.azure.com> and <https://github.com/swarnavarb/Figmark> in
tabs and sign in to both.

This turns on the wake-up queue described in `docs/AZURE.md` ("Pushes on the
minute"). It makes held notices (power sale drops, undo windows) reach phones
on time, even when nobody has the site open.

Development was tested and then turned off again (28 October 2026) to keep its
cost at zero; it stays off. For production, go straight to "Step 7: Production" once
`func-figmark-clocks-prod` exists. To try it on development again, do Steps
1–6 and turn it off afterwards.

---

You are turning on the "push wake-up queue" for the Figmark app on Azure.
Work in my signed-in Chrome. Use the Azure Portal and Azure Cloud Shell (Bash)
for commands. The reference is `docs/AZURE.md` in the repository, section
"Pushes on the minute".

**What it is:** when the site holds a notice until a set time, it also puts a
message on a Storage queue called `held-pushes`. The message stays invisible
until that time. A queue trigger called `push-wake`, on the clock Function App,
wakes up when the message becomes visible and sends the push. It needs three
things:
- the queue
- `PUSH_WAKE_QUEUE` and `PUSH_WAKE_STORAGE` set on the clock app
- `PUSH_WAKE_QUEUE` set on the site

## Rules, always

1. **Stop and ask me before** deleting anything, changing any setting not
   named here, or approving a production deploy.
2. **Never show secrets.** Keep connection strings and keys in Cloud Shell
   variables. Don't print them, paste them into chat, or show them in
   screenshots. If a command prints one, run `clear`.
3. **Read before you write.** Before changing a resource's settings, list its
   setting *names* (not values). After the change, list them again. If any
   name disappeared, stop and tell me.
4. After each numbered step, tell me in one line what is done, then continue.
   If a command fails, stop, show me the error (no secrets) and ask.
5. Cloud Shell forgets variables when its session restarts. If one is empty,
   re-run the lines that set it.

## Step 0: Cloud Shell and the code

1. Open Cloud Shell (the `>_` icon in the Portal's top bar), and pick **Bash**.
2. Run `az account show --query name -o tsv`, and ask me whether it is the right
   subscription.
3. On <https://github.com/swarnavarb/Figmark/actions>, check that the latest
   **Build and deploy** run on branch `development` succeeded, including the
   **Deploy clocks (development)** job. The run must include commit
   "Write power sales ahead so drops land on their minute". If it is missing or
   failed, stop and tell me.

## Step 1: Development, find the storage account the site uses

The queue must be in the **same storage account the site already uses** for
photos, because the site writes the messages with its own `STORAGE_*`
settings.

```bash
RG=rg-figuremarket-dev
SITE=stapp-figuremarket-dev
SITE_ENV=development
CLOCK=func-figmark-clocks-dev

az staticwebapp appsettings list -n $SITE -g $RG --environment-name $SITE_ENV \
  --query "properties | keys(@)" -o tsv
az staticwebapp appsettings list -n $SITE -g $RG --environment-name $SITE_ENV \
  --query "properties.STORAGE_ACCOUNT" -o tsv
```

The storage account name is not a secret. Tell me what it is, and which
`STORAGE_*` names the site has:
- **`STORAGE_ACCOUNT` and `STORAGE_KEY`:** good. Use that account below.
- **`STORAGE_CONNECTION_STRING` only:** tell me, and ask before going on.
- **No `STORAGE_*` at all:** stop. The site can't write queue messages. Tell me.

```bash
ACCOUNT=<the STORAGE_ACCOUNT value>
ACCOUNT_RG=$(az storage account list --query "[?name=='$ACCOUNT'].resourceGroup | [0]" -o tsv)
echo "$ACCOUNT in $ACCOUNT_RG"
```

## Step 2: Development, create the queue

```bash
CONN=$(az storage account show-connection-string -g "$ACCOUNT_RG" -n "$ACCOUNT" --query connectionString -o tsv)
az storage queue create --name held-pushes --connection-string "$CONN" -o table
```

## Step 3: Development, clock app settings

First check the clock app can send pushes at all and can write to the queue.
List its setting names:

```bash
az functionapp config appsettings list -g $RG -n $CLOCK --query "[].name" -o tsv
```

It needs all of these: `COSMOS_ENDPOINT`, `COSMOS_KEY`, `STORAGE_ACCOUNT`,
`STORAGE_KEY`, `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`,
`WEB_PUSH_SUBJECT`.

If any are missing, stop and tell me which. They must have the same values
as the site's development environment. Without `WEB_PUSH_*`, no push is ever
sent from the clock app. Without `STORAGE_*`, the notices the clock writes
ahead for power sales can't queue a wake-up.

If any are missing, I can let you copy them from the site, without showing
the values. Ask me first. Then for each missing NAME:

```bash
V=$(az staticwebapp appsettings list -n $SITE -g $RG --environment-name $SITE_ENV --query "properties.NAME" -o tsv)
az functionapp config appsettings set -g $RG -n $CLOCK --settings NAME="$V" > /dev/null
unset V
```

Then add the two queue settings:

```bash
az functionapp config appsettings set -g $RG -n $CLOCK \
  --settings PUSH_WAKE_QUEUE=held-pushes PUSH_WAKE_STORAGE="$CONN" > /dev/null
az functionapp config appsettings list -g $RG -n $CLOCK --query "[].name" -o tsv
```

The second list must now also show `PUSH_WAKE_QUEUE` and `PUSH_WAKE_STORAGE`,
and nothing from the first list may be missing.

## Step 4: Development, site setting

```bash
az staticwebapp appsettings list -n $SITE -g $RG --environment-name $SITE_ENV --query "properties | keys(@)" -o tsv
az staticwebapp appsettings set -n $SITE -g $RG --environment-name $SITE_ENV \
  --setting-names PUSH_WAKE_QUEUE=held-pushes > /dev/null
az staticwebapp appsettings list -n $SITE -g $RG --environment-name $SITE_ENV --query "properties | keys(@)" -o tsv
```

Compare the two lists. The second must be the first plus `PUSH_WAKE_QUEUE`.
If anything else is gone, **stop immediately** and tell me which names are
missing. Older Azure CLI versions replace all settings instead of adding one.

## Step 5: Development, register the trigger

The `push-wake` trigger only exists when the clock app starts with
`PUSH_WAKE_QUEUE` set. Azure must also be told about it, so it can wake the
app from zero.

```bash
az functionapp restart -g $RG -n $CLOCK
SUB=$(az account show --query id -o tsv)
az rest --method post \
  --url "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Web/sites/$CLOCK/syncfunctiontriggers?api-version=2022-03-01"
```

Wait one minute, then run:

```bash
az functionapp function list -g $RG -n $CLOCK --query "[].name" -o tsv
```

It must list `clock` and `push-wake`, both prefixed with the app name. If
`push-wake` is missing, re-run the **Deploy clocks (development)** job on
GitHub (Actions → the latest run on `development` → Re-run jobs). Then check
again. If it is still missing, stop and tell me.

## Step 6: Development, test it

1. Put a test message on the queue, invisible for 30 seconds. The content is
   base64, as the trigger expects:
   ```bash
   MSG=$(printf '{"at":"test"}' | base64)
   az storage message put --queue-name held-pushes --connection-string "$CONN" \
     --content "$MSG" --visibility-timeout 30 --time-to-live 3600 -o none
   ```
2. Wait 2 minutes.
3. In the Portal, open the Function App `func-figmark-clocks-dev` → **Functions**
   → `push-wake` → **Invocations** (or **Monitor**). There should be one
   successful run in the last few minutes. Logs can take up to 5 minutes to
   show up, so refresh once if it's empty.
4. Check the queue is empty again:
   ```bash
   az storage message peek --queue-name held-pushes --connection-string "$CONN" -o table
   ```
   If the message is still there, or a queue named `held-pushes-poison`
   exists, tell me (`az storage queue list --connection-string "$CONN" -o table`).

Tell me the result. **Ask me before continuing to production.**

## Step 7: Production (only after I say yes)

Production must already have its own clock app. If
`az functionapp show -g rg-figmark-prod -n func-figmark-clocks-prod` fails, stop
and tell me: production isn't set up yet.

Also check that the production deploy includes the new code. On GitHub, the
latest **Build and deploy** run on `main` must include the commit "Write
power sales ahead so drops land on their minute". If it doesn't, stop and
tell me. The code has to be merged into `main` first.

Then repeat Steps 1 to 6 with these values. Production has no named site
environment, so leave out `--environment-name` everywhere:

```bash
RG=rg-figmark-prod
SITE=stapp-figmark-prod
CLOCK=func-figmark-clocks-prod
```

In Step 5, if `push-wake` is missing, re-run the job called
**Deploy clocks (production)**. It may ask for approval, so **ask me**.

## When finished

Give me a short checklist:
- Development: queue created, clock settings, site setting, `push-wake`
  listed, test message handled (yes or no for each).
- Production: the same, or why it was skipped.
- Anything that looked wrong.
