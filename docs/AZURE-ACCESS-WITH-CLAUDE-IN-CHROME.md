# Azure access for Claude Code: instructions for Claude in Chrome

Paste everything below the line into Claude in Chrome. Before that, open
<https://portal.azure.com> and <https://claude.ai/code> in tabs and sign in
to both.

This gives the Claude Code cloud environment that works on Figmark its own
Azure sign-in, limited to Figmark's two resource groups, so a Claude Code
session can check and set production settings, run `azure:check` and
`azure:live-check`, and read the live resources itself. When launch is done,
delete it (step 6).

---

You are giving a Claude Code cloud environment access to the Figmark app's
Azure resources. Work in my signed-in Chrome. Use the Azure Portal, Azure Cloud
Shell (Bash) for commands, and the environment settings on claude.ai/code.

**What it is:** a service principal (an Azure sign-in for a program) called
`figmark-claude-session`, with the **Contributor** role on two resource groups
only: `rg-figmark-prod` and `rg-figuremarket-dev`. Its ID, tenant and secret go
into the Claude Code environment as environment variables, and the
environment's network access is opened to Azure's hosts.

## Rules, always

1. **Stop and ask me before** deleting anything, giving the service principal
   any role or scope not named here, or changing any environment setting not
   named here.
2. **Never show the secret.** The service principal's password stays in a
   Cloud Shell variable. Do not print it, paste it into chat, or take a
   screenshot while it is on screen. Step 4 hands it to me to copy myself.
3. Never give the service principal a role on the whole subscription, and
   never the Owner or User Access Administrator role.
4. After each numbered step, tell me in one line what is done, then continue.
   If a command fails, stop, show me the error (no secrets) and ask.
5. Cloud Shell forgets variables when its session restarts. If one is empty,
   re-run the lines that set it. If `SP_SECRET` is lost before step 4 is done,
   tell me: step 2's last command makes a new one.

## Step 0: Cloud Shell

1. Open Cloud Shell (the `>_` icon in the Portal's top bar), and pick **Bash**.
2. Run `az account show --query "{name:name, id:id}" -o tsv`, and ask me
   whether it is the right subscription.

## Step 1: The resource groups

```bash
SUB=$(az account show --query id -o tsv)
az group list --query "[?name=='rg-figmark-prod' || name=='rg-figuremarket-dev'].name" -o tsv
```

Both names should be listed. If `rg-figmark-prod` is missing, create it (an
empty resource group costs nothing):

```bash
az group create --name rg-figmark-prod --location centralindia -o none
```

If `rg-figuremarket-dev` is missing, stop and ask me: development should
already exist.

## Step 2: The service principal

First check that it does not exist already:

```bash
az ad sp list --display-name figmark-claude-session --query "[].appId" -o tsv
```

If that prints an ID, stop and ask me whether to reuse it. Otherwise:

```bash
SP_JSON=$(az ad sp create-for-rbac --name figmark-claude-session \
  --role Contributor \
  --scopes /subscriptions/$SUB/resourceGroups/rg-figmark-prod \
           /subscriptions/$SUB/resourceGroups/rg-figuremarket-dev \
  -o json)
SP_APP_ID=$(echo "$SP_JSON" | jq -r .appId)
SP_TENANT=$(echo "$SP_JSON" | jq -r .tenant)
SP_SECRET=$(echo "$SP_JSON" | jq -r .password)
unset SP_JSON
echo "app id: $SP_APP_ID"; echo "tenant: $SP_TENANT"; echo "subscription: $SUB"
echo "secret length: ${#SP_SECRET}"
```

The secret length should be about 40, and the app id and tenant should not
read `null`. A warning that the output includes credentials is expected (the
credentials went into the variable, not the screen). The secret expires after
one year.

If the command fails with "Insufficient privileges", my account cannot create
app registrations in this directory: stop and tell me.

## Step 3: Check the roles

```bash
az role assignment list --assignee "$SP_APP_ID" --all \
  --query "[].{role:roleDefinitionName, scope:scope}" -o table
```

There should be exactly two rows, both **Contributor**, one ending in
`/resourceGroups/rg-figmark-prod` and one in `/resourceGroups/rg-figuremarket-dev`.
Anything else: stop and tell me.

## Step 4: The Claude Code environment

1. On <https://claude.ai/code>, open the cloud environment that Figmark
   sessions use: the environment menu in a session's title bar, then **Edit**
   on that environment. If there is more than one environment, or you cannot
   tell which one is Figmark's, ask me.
2. **Network access.** Keep the current access level if it is **Limited** (or
   **Custom**), and add these under **Allowed domains**, one per line, leaving
   **Allow package managers** (or "include the default list of package
   managers") ticked:

   ```text
   management.azure.com
   login.microsoftonline.com
   graph.microsoft.com
   aka.ms
   *.documents.azure.com
   *.blob.core.windows.net
   *.queue.core.windows.net
   *.azurestaticapps.net
   *.azurewebsites.net
   ```

   Keep every domain that is already in the list. If the level is already
   **Full** (or "unrestricted"), change nothing here.
3. **Environment variables.** Add these four, without removing the ones already
   there. Fill in the first three yourself from Cloud Shell's output in step 2
   (they are identifiers, not secrets):

   ```text
   AZURE_CLIENT_ID=<app id>
   AZURE_TENANT_ID=<tenant>
   AZURE_SUBSCRIPTION_ID=<subscription>
   AZURE_CLIENT_SECRET=
   ```

   If the page has a separate secrets section for environment variables, put
   `AZURE_CLIENT_SECRET` there instead.
4. **The secret, handed to me.** Leave `AZURE_CLIENT_SECRET` empty, do not save
   yet, and tell me: "Run `echo "$SP_SECRET"` in Cloud Shell, copy the value
   after `AZURE_CLIENT_SECRET=`, then run `clear`." Look away from the Cloud
   Shell tab (no screenshots of it) until I say it is done.
5. When I say it is done, save the environment. Check the saved variables list
   shows all four names (do not read the secret's value back).

## Step 5: Tidy Cloud Shell

```bash
unset SP_SECRET
clear
```

Then tell me, in a few lines: the app ID, the two role assignments, the
domains added, and that the environment is saved. Remind me that a **new**
Claude Code session is needed to pick the settings up.

## Step 6: After launch (only when I ask)

Remove the access when I say launch work is done:

```bash
APP_ID=$(az ad sp list --display-name figmark-claude-session --query "[0].appId" -o tsv)
az ad sp delete --id "$APP_ID"
az ad app delete --id "$APP_ID"
```

Then remove the four `AZURE_*` variables from the Claude Code environment.
This is a delete: ask me first (rule 1).

---

## What the Claude Code session does with it

In a new session, Claude installs the Azure CLI (`pip install azure-cli`), signs
in with `az login --service-principal -u "$AZURE_CLIENT_ID" -p "$AZURE_CLIENT_SECRET" --tenant "$AZURE_TENANT_ID"`
and `az account set -s "$AZURE_SUBSCRIPTION_ID"`, and works through
`docs/ENVIRONMENTS.md`. Contributor on the two resource groups covers creating
the Cosmos, storage, Static Web App and Function App resources and setting
their app settings. It does **not** cover the Entra and role steps in
`docs/ENVIRONMENTS.md` §5 (the GitHub deploy app's federated credential and its
Website Contributor role) or GitHub's own settings (§6): those stay with you,
or with Claude in Chrome using `docs/LAUNCH-WITH-CLAUDE-IN-CHROME.md`.
