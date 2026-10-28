# Clock apps on classic Consumption: instructions for Claude in Chrome

Paste everything below the line into the **Claude in Chrome chat**, not into
Cloud Shell. Before that, open <https://portal.azure.com> and
<https://github.com/swarnavarb/Figmark> in tabs and sign in to both.

This moves the development clock app from Flex Consumption to the classic
Consumption plan (Windows, Node 22, no Application Insights), as described in
`docs/AZURE.md` ("The clock Function App"). A Flex app can't be switched to
another plan, so the old app is deleted and a new one with the same name is
created. Production isn't moved here: it gets created on classic Consumption
directly, in Step 5 of `docs/LAUNCH-WITH-CLAUDE-IN-CHROME.md`.

Do this after the "Step 5 metrics" numbers have been added to the billing
support ticket. Billing history stays after the app is deleted, but the
app's own metrics go with it.

---

You are moving the Figmark development clock Function App to a cheaper Azure
plan. Work in my signed-in Chrome. Use the Azure Portal and Azure Cloud Shell
(Bash). Type commands into Cloud Shell one at a time; don't paste this whole
message there.

## Rules, always

1. **Stop and ask me before** deleting anything, changing any setting not
   named here, or approving a production deploy.
2. **Never show secrets.** Keep connection strings and keys in Cloud Shell
   variables. Never print them, paste them in chat or show them in
   screenshots. If a command prints one, run: `clear`
3. **Read before you write.** Before changing a resource's settings, list its
   setting NAMES (not values). List them again afterwards. If any name
   disappeared, stop and tell me.
4. After each step, tell me in one line what is done, then continue. If a
   command fails, stop, show me the error (no secrets) and ask.
5. Cloud Shell forgets variables when its session restarts. **Don't let it
   restart between Step 2 and Step 5**: the saved settings live only in that
   session. If it does restart, stop and tell me.

## Step 1: Look at the current app

```bash
az account show --query name -o tsv
RG=rg-figuremarket-dev
CLOCK=func-figmark-clocks-dev
az functionapp show -g $RG -n $CLOCK --query "{plan:serverFarmId, kind:kind, state:state}" -o json
az functionapp config appsettings list -g $RG -n $CLOCK --query "[].name" -o tsv
```

Ask me whether the subscription name is right. Tell me the plan, the kind and
the setting names. I expect these names, and only these:
`AzureWebJobsStorage`, `DEPLOYMENT_STORAGE_CONNECTION_STRING`,
`APPLICATIONINSIGHTS_CONNECTION_STRING`, `COSMOS_ENDPOINT`, `COSMOS_KEY`,
`STORAGE_ACCOUNT`, `STORAGE_KEY`, `WEB_PUSH_PUBLIC_KEY`,
`WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`. If there are others, stop and
tell me which.

## Step 2: Save the app's settings and description

Save the settings the new app needs, in Cloud Shell variables only:

```bash
declare -A SAVED
for n in COSMOS_ENDPOINT COSMOS_KEY COSMOS_DATABASE STORAGE_ACCOUNT STORAGE_KEY STORAGE_CONNECTION_STRING WEB_PUSH_PUBLIC_KEY WEB_PUSH_PRIVATE_KEY WEB_PUSH_SUBJECT; do
  v=$(az functionapp config appsettings list -g $RG -n $CLOCK --query "[?name=='$n'].value | [0]" -o tsv)
  [ -n "$v" ] && SAVED[$n]="$v"
done
unset v
echo "${!SAVED[@]}"
```

That prints names only. Tell me the list. It must include `COSMOS_ENDPOINT`
and `COSMOS_KEY`; if not, stop.

Then keep a description of the app for the support ticket (it holds no
secrets):

```bash
az functionapp show -g $RG -n $CLOCK -o json > ~/func-figmark-clocks-dev-flex.json
az functionapp show -g $RG -n $CLOCK --query id -o tsv
```

Tell me the resource ID it printed.

## Step 3: Delete the Flex app (ask me first)

**Ask me before running this.** Say: "Delete func-figmark-clocks-dev (Flex
Consumption)? Its settings are saved in this Cloud Shell session." Wait for
my yes.

```bash
az functionapp delete -g $RG -n $CLOCK
```

Leave these alone: the Application Insights resource also called
`func-figmark-clocks-dev` (it is evidence for the ticket and costs nothing
once nothing sends to it), the storage account `stfiguremarketdev` and its
queues, and any App Service plan left behind. Then list what's left:

```bash
az resource list -g $RG --query "[].{name:name, type:type}" -o table
```

Tell me the list.

## Step 4: Create the classic Consumption app

```bash
az functionapp create -g $RG -n $CLOCK \
  --storage-account stfiguremarketdev \
  --consumption-plan-location centralindia \
  --os-type Windows --functions-version 4 \
  --runtime node --runtime-version 22 \
  --disable-app-insights -o none
```

If it says the name is taken, wait five minutes and try again (up to three
times). Then check:

```bash
az functionapp show -g $RG -n $CLOCK --query "{kind:kind, sku:sku, plan:serverFarmId}" -o json
az functionapp config appsettings list -g $RG -n $CLOCK --query "[].name" -o tsv
```

The plan should end in a name like `CentralIndiaPlan` and the SKU should be
`Dynamic`. The settings list must **not** contain
`APPLICATIONINSIGHTS_CONNECTION_STRING`. If it does, tell me.

## Step 5: Put the settings back

List the names first (rule 3), then:

```bash
ARGS=()
for n in "${!SAVED[@]}"; do ARGS+=("$n=${SAVED[$n]}"); done
az functionapp config appsettings set -g $RG -n $CLOCK --settings "${ARGS[@]}" > /dev/null
unset ARGS
az functionapp config appsettings list -g $RG -n $CLOCK --query "[].name" -o tsv
```

Check that every name from before is still there, plus the saved ones. Don't
add `PUSH_WAKE_QUEUE` or `PUSH_WAKE_STORAGE`: the wake-up queue stays off in
development.

## Step 6: Let GitHub deploy to the new app

The old app's deploy permission was deleted with it. Give it back:

```bash
APP_ID=$(az ad app list --display-name figmark-github-deploy --query "[0].appId" -o tsv)
az role assignment create --assignee "$APP_ID" --role "Website Contributor" \
  --scope "$(az functionapp show -g $RG -n $CLOCK --query id -o tsv)" -o none
az role assignment list --assignee "$APP_ID" --all --query "[].{role:roleDefinitionName, scope:scope}" -o table
```

Then on <https://github.com/swarnavarb/Figmark/actions>, open the latest
**Build and deploy** run on branch `development` whose event is **push** (a
pull request run never deploys the clocks) and use **Re-run jobs →
Re-run all jobs**. It doesn't ask for approval. Wait for
**Deploy clocks (development)** to finish, and tell me whether it succeeded.
If it failed, copy the error lines (no secrets).

## Step 7: Check it runs

```bash
az functionapp function list -g $RG -n $CLOCK --query "[].name" -o tsv
```

It should list only `clock` (prefixed with the app name). Wait 15 minutes,
then open the Function App in the Portal → **Monitoring → Metrics**, metric
**Function Execution Count**, last 30 minutes. There should be about one run
every five minutes. Tell me the count. The Invocations tab will be empty;
that's expected, since there is no Application Insights.

## Step 8: Clear up

```bash
unset SAVED APP_ID
clear
```

## When finished

Give me a short checklist (yes or no for each):
- Old Flex app deleted, and its resource ID
- New app created on classic Consumption, Windows, Node 22, no Application Insights
- Settings restored (names)
- Deploy permission given, deploy job succeeded
- Clock running (executions in the last 30 minutes)
- Anything that looked wrong
