# Node Description Batch 2 of 55

Graphify is running in assistant/skill mode (no API key). You are the host
assistant (Claude Code / Codex / Gemini CLI). Read the prompt below and write
your JSON answer to the answer file.

## Prompt

You are documenting nodes in a knowledge graph.
For each entry below, write ONE concise factual plain-language sentence
describing what it is or does. Use only the provided context.
For a code symbol (kind=code-symbol — a function, class, or constant),
describe what the function/symbol does based on its name, source location
and neighbors — e.g. "Resolves the configured ontology profile from graphify.yaml.".
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
LANGUAGE: each entry has a `lang=` marker giving the language of its source.
Write that entry's description in EXACTLY that language. Do not translate to
a single common language — match each node's source language individually.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "shared_contracts": "contracts.ts" | kind=code-symbol | source=shared/contracts.ts:L1 | neighbors=[api.ts, main.tsx, mock-provider.ts, swa-provider.ts, types.ts, 121777a A page at /<username>, and a re…] | lang=en
- "pages_sellpage": "SellPage.tsx" | kind=code-symbol | source=app/src/pages/SellPage.tsx:L1 | neighbors=[141db1a Routes you can write, and a tra…, 613ff69 Rebuild the sell tab: one door …, 8992ccb A fill meter you can join, and …, a5a184e Orders, Track, and the statione…, aa99b23 Usernames, shops as the only wa…, f4ae77f The lot board: count the pieces…] | lang=en
- "functions_want_routes": "want-routes.ts" | kind=code-symbol | source=api/src/functions/want-routes.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 843b46a +Me, and a bell that tells ever…, dc5dc06 Notifications for the rest of i…, f26bb32 Wanted: the half of the market …, index.ts, getAuthService()] | lang=en
- "functions_message_routes": "message-routes.ts" | kind=code-symbol | source=api/src/functions/message-routes.ts:L1 | neighbors=[121777a A page at /<username>, and a re…, a5a184e Orders, Track, and the statione…, aa99b23 Usernames, shops as the only wa…, b269064 Create missing Cosmos container…, index.ts, getAuthService()] | lang=en
- "pages_servicespage": "ServicesPage.tsx" | kind=code-symbol | source=app/src/pages/ServicesPage.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 141db1a Routes you can write, and a tra…, 71eee88 The exporter was the supplier a…, e492525 A Services tab, and the people …, TabBar.tsx, ui.tsx] | lang=en
- "shared_insights": "insights.ts" | kind=code-symbol | source=shared/insights.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, b1179de Pro analytics off the packing b…, insight-routes.ts, ShopPage.tsx, index.ts, board.ts] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@aa99b23224aefe49c3984541746da49dddecdf05": "aa99b23 Usernames, shops as the only way to list, packing access, and messages" | kind=Commit | source=git | neighbors=[mock-provider.ts, claude/figmark-connection-icpfax, claude/new-session-13ackt, b269064 Create missing Cosmos container…, TabBar.tsx, ui.tsx] | lang=en
- "functions_insight_routes": "insight-routes.ts" | kind=code-symbol | source=api/src/functions/insight-routes.ts:L1 | neighbors=[b1179de Pro analytics off the packing b…, index.ts, getAuthService(), index.ts, getRepository(), http.ts] | lang=en
- "src_format": "format.ts" | kind=code-symbol | source=app/src/format.ts:L1 | neighbors=[DisputesView.tsx, UsersView.tsx, 8cf0d9b Give Figmark a vibrant colour i…, f4ae77f The lot board: count the pieces…, FillMeter.tsx, LotPeople.tsx] | lang=en
- "functions_profile_routes": "profile-routes.ts" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L1 | neighbors=[121777a A page at /<username>, and a re…, e057084 Every name is an address, and e…, index.ts, getAuthService(), index.ts, getRepository()] | lang=en
- "auth_index": "index.ts" | kind=code-symbol | source=api/src/auth/index.ts:L1 | neighbors=[errors.ts, AuthError, getAuthService(), mock-provider.ts, MockAuthProvider, toAuthUser()] | lang=en
- "data_index": "index.ts" | kind=code-symbol | source=api/src/data/index.ts:L1 | neighbors=[index.ts, f4ae77f The lot board: count the pieces…, cosmos-repository.ts, CosmosRepository, getRepository(), memory-repository.ts] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@a5a184ef723edd939be52b7519287d531c84e306": "a5a184e Orders, Track, and the stationery a shop lists from" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 119ed59 Add Emil Kowalski's design and …, PhotoManager.tsx, ui.tsx, cosmos-repository.ts] | lang=en
- "pages_listingpage": "ListingPage.tsx" | kind=code-symbol | source=app/src/pages/ListingPage.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 141db1a Routes you can write, and a tra…, 466681d Buy now skipped the checkout it…, 8992ccb A fill meter you can join, and …, a5a184e Orders, Track, and the statione…, aa99b23 Usernames, shops as the only wa…] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@f1b6577bd7c168cb5f3b65df7f05582b4e8481bf": "f1b6577 An operations console, escrow as a granted right, and disputes both sid…" | kind=Commit | source=git | neighbors=[d820fb9 The order lifecycle: hold the m…, api.ts, Confirm.tsx, DisputesView.tsx, main.tsx, UsersView.tsx] | lang=en
- "src_index": "index.ts" | kind=code-symbol | source=api/src/index.ts:L1 | neighbors=[121777a A page at /<username>, and a re…, 613ff69 Rebuild the sell tab: one door …, 843b46a +Me, and a bell that tells ever…, 8992ccb A fill meter you can join, and …, a5a184e Orders, Track, and the statione…, aa99b23 Usernames, shops as the only wa…] | lang=en
- "scripts_dev_server": "dev-server.mjs" | kind=code-symbol | source=scripts/dev-server.mjs:L1 | neighbors=[121777a A page at /<username>, and a re…, 12950fa Give Figmark a typeface, a dens…, 141db1a Routes you can write, and a tra…, 29bd178 The Functions host keeps /admin…, 4484666 Buying is two transactions, not…, 613ff69 Rebuild the sell tab: one door …] | lang=en
- "functions_http": "http.ts" | kind=code-symbol | source=api/src/functions/http.ts:L1 | neighbors=[6d70f64 Make a broken deployment say wh…, f4ae77f The lot board: count the pieces…, admin-routes.ts, auth-routes.ts, catalog-routes.ts, dispute-routes.ts] | lang=en
- "pages_wantedpage": "WantedPage.tsx" | kind=code-symbol | source=app/src/pages/WantedPage.tsx:L1 | neighbors=[843b46a +Me, and a bell that tells ever…, 8992ccb A fill meter you can join, and …, dc5dc06 Notifications for the rest of i…, f26bb32 Wanted: the half of the market …, SocialPage.tsx, ui.tsx] | lang=en
- "scripts_live_browser_resumesession": "resumeSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9515 | neighbors=[live-browser.js, init(), applySavedSessionMeta(), clearHandled(), clearSession(), disableInlineEdit()] | lang=en
- "pages_routespage": "RoutesPage.tsx" | kind=code-symbol | source=app/src/pages/RoutesPage.tsx:L1 | neighbors=[141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, 84e162a Bind a step to the button that …, 89d4620 Ask a new shop how its stock tr…, c501457 Put Routes on the Track tab, wh…, Feedback.tsx] | lang=en
- "scripts_live_browser_setlivestate": "setLiveState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2037 | neighbors=[live-browser.js, applyEditing(), beginNewLiveConfiguration(), cancelEditing(), cancelEditingToPicking(), cancelInsertConfigure()] | lang=en
- "shared_catalog": "catalog.ts" | kind=code-symbol | source=shared/catalog.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 7b5199d Filters that fit, tabs that hol…, 8992ccb A fill meter you can join, and …, 8cf0d9b Give Figmark a vibrant colour i…, PowerSale.tsx, cosmos-repository.ts] | lang=en
- "shared_services": "services.ts" | kind=code-symbol | source=shared/services.ts:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 141db1a Routes you can write, and a tra…, 71eee88 The exporter was the supplier a…, e492525 A Services tab, and the people …, fulfilment-routes.ts, service-routes.ts] | lang=en
- "components_powersale": "PowerSale.tsx" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 320bbe5 A members' window that actually…, 613ff69 Rebuild the sell tab: one door …, blankItem(), Countdown(), ItemDraft] | lang=en
- "scripts_live_browser_el": "el()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2910 | neighbors=[live-browser.js, buildConfigureActionControl(), buildConfigureCountControl(), buildConfigureRow(), buildConfigureSubmitButton(), buildConfigureTrailingCluster()] | lang=en
- "functions_preorder": "preorder.ts" | kind=code-symbol | source=api/src/functions/preorder.ts:L1 | neighbors=[613ff69 Rebuild the sell tab: one door …, 8992ccb A fill meter you can join, and …, catalog-routes.ts, index.ts, getRepository(), notify.ts] | lang=en
- "shared_templates": "templates.ts" | kind=code-symbol | source=shared/templates.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, a5a184e Orders, Track, and the statione…, cosmos-repository.ts, memory-repository.ts, repository.ts, fulfilment-routes.ts] | lang=en
- "src_api_api": "api" | kind=code-symbol | source=app/src/api.ts:L1003 | neighbors=[api.ts, LotFields.tsx, LotPeople.tsx, Notifications.tsx, PhotoManager.tsx, PowerSale.tsx] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@8992ccb50b4bc605c06f4cecf397cfda090eba85": "8992ccb A fill meter you can join, and a catalog you can narrow" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 7b5199d Filters that fit, tabs that hol…, FillMeter.tsx, cosmos-repository.ts, memory-repository.ts] | lang=pt
- "pages_disputepage": "DisputePage.tsx" | kind=code-symbol | source=app/src/pages/DisputePage.tsx:L1 | neighbors=[e057084 Every name is an address, and e…, f1b6577 An operations console, escrow a…, ui.tsx, Avatar(), ErrorNotice(), PersonLink()] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@613ff69abc5356c0d36aca3c0821aa9e38612234": "613ff69 Rebuild the sell tab: one door in, two ways to sell, every order answer…" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 904cac6 Fix the powerSales indexing pat…, PowerSale.tsx, TabBar.tsx, cosmos-repository.ts] | lang=en
- "pages_messagespage": "MessagesPage.tsx" | kind=code-symbol | source=app/src/pages/MessagesPage.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, aa99b23 Usernames, shops as the only wa…, b269064 Create missing Cosmos container…, Feedback.tsx, SkeletonRows(), ui.tsx] | lang=en
- "scripts_live_browser_handlekeydown": "handleKeyDown()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7654 | neighbors=[live-browser.js, beginNewLiveConfiguration(), cancelEditing(), cancelInsertConfigure(), clearAnnotations(), cycleVariant()] | lang=en
- "scripts_live_browser_injectsveltecomponentsfrommanifest": "injectSvelteComponentsFromManifest()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5767 | neighbors=[live-browser.js, abortSvelteComponentInjection(), buildSveltePropValuesFromLiveElement(), completeParameterGenerationIfReady(), disableInlineEdit(), enterRecoveryWaitingForAnchor()] | lang=en
- "scripts_live_browser_showtoast": "showToast()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9362 | neighbors=[live-browser.js, abandonForeignSession(), applyEditing(), completeParameterPublication(), copyToClipboard(), discardOrphanedSession()] | lang=en
- "shared_orders": "orders.ts" | kind=code-symbol | source=shared/orders.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 4484666 Buying is two transactions, not…, 613ff69 Rebuild the sell tab: one door …, d820fb9 The order lifecycle: hold the m…, f1b6577 An operations console, escrow a…, dispute-routes.ts] | lang=en
- "shared_stores": "stores.ts" | kind=code-symbol | source=shared/stores.ts:L1 | neighbors=[aa99b23 Usernames, shops as the only wa…, f4ae77f The lot board: count the pieces…, catalog-routes.ts, fulfilment-routes.ts, insight-routes.ts, message-routes.ts] | lang=en
- "src_api_apirequesterror": "ApiRequestError" | kind=code-symbol | source=app/src/api.ts:L41 | neighbors=[api.ts, LotFields.tsx, LotPeople.tsx, PhotoManager.tsx, PowerSale.tsx, AuthPage.tsx] | lang=en
- "src_config": "config.ts" | kind=code-symbol | source=api/src/config.ts:L1 | neighbors=[index.ts, mock-provider.ts, f1b6577 An operations console, escrow a…, f4ae77f The lot board: count the pieces…, cosmos-repository.ts, index.ts] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-001.json

Keep each description factual and concise (one sentence). No markdown, no prose
outside the JSON object. It is acceptable to omit a node if context is
insufficient — but include every node you can ground confidently.

Example answer format:
```json
{
  "node_id_1": "Resolves the configured ontology profile from graphify.yaml.",
  "node_id_2": "Colonel James Barclay, an antagonist in The Crooked Man."
}
```
