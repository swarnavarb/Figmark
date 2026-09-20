# Node Description Batch 3 of 55

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

- "src_session": "session.tsx" | kind=code-symbol | source=app/src/session.tsx:L1 | neighbors=[6d70f64 Make a broken deployment say wh…, aa99b23 Usernames, shops as the only wa…, b269064 Create missing Cosmos container…, f4ae77f The lot board: count the pieces…, AuthPage.tsx, FeedPage.tsx] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@669653508a38264329b67c069341b5532400d5e6": "6696535 An escrow is a person the buyer picks, not a service the company runs" | kind=Commit | source=git | neighbors=[api.ts, UsersView.tsx, mock-provider.ts, claude/figmark-connection-icpfax, claude/new-session-13ackt, e7e5925 The seed only ever ran once, so…] | lang=en
- "components_ladder": "Ladder.tsx" | kind=code-symbol | source=app/src/components/Ladder.tsx:L1 | neighbors=[141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, b36b0b9 Stop the warehouse tick claimin…, Icon.tsx, Icon(), Ladder()] | lang=en
- "functions_preorder_routes": "preorder-routes.ts" | kind=code-symbol | source=api/src/functions/preorder-routes.ts:L1 | neighbors=[8992ccb A fill meter you can join, and …, index.ts, getAuthService(), index.ts, getRepository(), http.ts] | lang=en
- "scripts_live_browser_cleanup": "cleanup()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9263 | neighbors=[live-browser.js, abandonForeignSession(), clearMountErrorCard(), clearScrollY(), clearSession(), deferredRecoverySuperseded()] | lang=en
- "admin_api": "api.ts" | kind=code-symbol | source=app/src/admin/api.ts:L1 | neighbors=[admin, AdminDisputeRow, AdminUserDetail, AdminUserRow, post(), request()] | lang=en
- "auth_swa_provider": "swa-provider.ts" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L1 | neighbors=[index.ts, errors.ts, AuthError, mock-provider.ts, toAuthUser(), ClientPrincipal] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@121777a8c9c4fcf64bc0ad85d56f3bc383818fb0": "121777a A page at /<username>, and a record on it a stranger can check" | kind=Commit | source=git | neighbors=[mock-provider.ts, claude/figmark-connection-icpfax, claude/new-session-13ackt, e057084 Every name is an address, and e…, cosmos-repository.ts, memory-repository.ts] | lang=pt
- "commit:repo:github.com/swarnavarb/Figmark@e4925255313229407632d72dc4a6ee0f77e2f428": "e492525 A Services tab, and the people who do the work get a screen" | kind=Commit | source=git | neighbors=[b1179de Pro analytics off the packing b…, claude/figmark-connection-icpfax, claude/new-session-13ackt, c6c033a The batch is the tracking engin…, TabBar.tsx, cosmos-repository.ts] | lang=en
- "data_index_getrepository": "getRepository()" | kind=code-symbol | source=api/src/data/index.ts:L17 | neighbors=[index.ts, index.ts, admin-routes.ts, catalog-routes.ts, dispute-routes.ts, fulfilment-routes.ts] | lang=en
- "functions_power_sale": "power-sale.ts" | kind=code-symbol | source=api/src/functions/power-sale.ts:L1 | neighbors=[320bbe5 A members' window that actually…, 613ff69 Rebuild the sell tab: one door …, index.ts, getRepository(), notify.ts, notify()] | lang=en
- "pages_escrowpage": "EscrowPage.tsx" | kind=code-symbol | source=app/src/pages/EscrowPage.tsx:L1 | neighbors=[6696535 An escrow is a person the buyer…, e057084 Every name is an address, and e…, ui.tsx, EmptyState(), ErrorNotice(), Modal()] | lang=en
- "shared_disputes": "disputes.ts" | kind=code-symbol | source=shared/disputes.ts:L1 | neighbors=[f1b6577 An operations console, escrow a…, dispute-routes.ts, DisputePage.tsx, OrderPage.tsx, DisputeAction, disputeActionsFor()] | lang=en
- "shared_models_order": "Order" | kind=code-symbol | source=shared/models.ts:L760 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, catalog-routes.ts, dispute-routes.ts] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@c6c033a41c8f2021b3371aa4ba56049f3d2bdae9": "c6c033a The batch is the tracking engine, and the seller writes the route" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, a5a184e Orders, Track, and the statione…, LotFields.tsx, RouteBuilder.tsx, cosmos-repository.ts] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@e05708471090a68370af4cf5ceff161751e60df9": "e057084 Every name is an address, and each page carries one record" | kind=Commit | source=git | neighbors=[121777a A page at /<username>, and a re…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 0460f84 The links were there and looked…, ui.tsx, seed.ts] | lang=en
- "components_routebuilder": "RouteBuilder.tsx" | kind=code-symbol | source=app/src/components/RouteBuilder.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, 84e162a Bind a step to the button that …, c6c033a The batch is the tracking engin…, Icon.tsx] | lang=en
- "components_ui_errornotice": "ErrorNotice()" | kind=code-symbol | source=app/src/components/ui.tsx:L103 | neighbors=[LotFields.tsx, PowerSale.tsx, ui.tsx, AuthPage.tsx, DisputePage.tsx, EscrowPage.tsx] | lang=en
- "functions_auth_routes": "auth-routes.ts" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L1 | neighbors=[f4ae77f The lot board: count the pieces…, index.ts, getAuthService(), mock-provider.ts, MockAuthProvider, login()] | lang=en
- "functions_http_json": "json()" | kind=code-symbol | source=api/src/functions/http.ts:L17 | neighbors=[admin-routes.ts, auth-routes.ts, catalog-routes.ts, dispute-routes.ts, fulfilment-routes.ts, health.ts] | lang=en
- "pages_supplierpage": "SupplierPage.tsx" | kind=code-symbol | source=app/src/pages/SupplierPage.tsx:L1 | neighbors=[71eee88 The exporter was the supplier a…, ShopPage.tsx, ui.tsx, EmptyState(), ErrorNotice(), Tile()] | lang=en
- "shared_board": "board.ts" | kind=code-symbol | source=shared/board.ts:L1 | neighbors=[f4ae77f The lot board: count the pieces…, LotPeople.tsx, fulfilment-routes.ts, service-routes.ts, ServicesPage.tsx, ShopPage.tsx] | lang=en
- "shared_models_basedocument": "BaseDocument" | kind=code-symbol | source=shared/models.ts:L23 | neighbors=[models.ts, Dispute, Follow, Forum, Like, Listing] | lang=en
- "components_lotpeople": "LotPeople.tsx" | kind=code-symbol | source=app/src/components/LotPeople.tsx:L1 | neighbors=[74942be One lot card, and a lot page wi…, CustomerCard(), LotPeople(), ui.tsx, EmptyState(), board.ts] | lang=en
- "functions_http_error": "error()" | kind=code-symbol | source=api/src/functions/http.ts:L23 | neighbors=[admin-routes.ts, auth-routes.ts, catalog-routes.ts, dispute-routes.ts, fulfilment-routes.ts, http.ts] | lang=en
- "scripts_live_browser_applyediting": "applyEditing()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3745 | neighbors=[live-browser.js, buildLocatorForLeaf(), cancelEditing(), contextElementForManualEdit(), copyEditContainerContext(), copyEditLeafContext()] | lang=en
- "scripts_live_browser_handleclick": "handleClick()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7495 | neighbors=[live-browser.js, beginNewLiveConfiguration(), cancelEditingToPicking(), cancelInsertConfigure(), clearAnnotations(), closeTunePopover()] | lang=en
- "scripts_live_browser_showbar": "showBar()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1162 | neighbors=[live-browser.js, applyEditing(), cancelEditing(), enterRecoveryWaitingForAnchor(), handleClick(), handleGo()] | lang=en
- "shared_models_user": "User" | kind=code-symbol | source=shared/models.ts:L96 | neighbors=[mock-provider.ts, cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, admin-routes.ts] | lang=en
- "admin_usersview": "UsersView.tsx" | kind=code-symbol | source=app/src/admin/UsersView.tsx:L1 | neighbors=[main.tsx, api.ts, admin, AdminUserDetail, AdminUserRow, Confirm.tsx] | lang=en
- "auth_index_getauthservice": "getAuthService()" | kind=code-symbol | source=api/src/auth/index.ts:L17 | neighbors=[index.ts, admin-routes.ts, auth-routes.ts, catalog-routes.ts, dispute-routes.ts, fulfilment-routes.ts] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@12950fa66322563994c0b6364dff737d8cabc710": "12950fa Give Figmark a typeface, a dense order queue and a real chat" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 44f8ea3 Label the warehouse toggle, and…, Feedback.tsx, Icon.tsx, Notifications.tsx] | lang=pt
- "commit:repo:github.com/swarnavarb/Figmark@843b46a451f614d64cd1a78aace0050d8c683cd7": "843b46a +Me, and a bell that tells everyone who pressed it" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, dc5dc06 Notifications for the rest of i…, Notifications.tsx, ui.tsx, cosmos-repository.ts] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@d820fb9e12f0cf6aa2c0d20f38ec474655a7f5f5": "d820fb9 The order lifecycle: hold the money, confirm delivery, rate each other" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, f1b6577 An operations console, escrow a…, cosmos-repository.ts, memory-repository.ts, repository.ts] | lang=en
- "data_seed_iso": "iso()" | kind=code-symbol | source=api/src/data/seed.ts:L61 | neighbors=[seed.ts, forwarder(), handler(), seedComments(), seedDisputes(), seedFollows()] | lang=en
- "functions_http_handler": "handler()" | kind=code-symbol | source=api/src/functions/http.ts:L82 | neighbors=[admin-routes.ts, auth-routes.ts, catalog-routes.ts, dispute-routes.ts, fulfilment-routes.ts, health.ts] | lang=en
- "scripts_live_browser_handlego": "handleGo()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7772 | neighbors=[live-browser.js, buildPickedAnchorSnapshot(), captureAndEmit(), clearAnnotations(), clearMountErrorCard(), disableInlineEdit()] | lang=en
- "scripts_live_browser_restoresessionwithoutwrapper": "restoreSessionWithoutWrapper()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9107 | neighbors=[live-browser.js, restoreFromActiveSessions(), restoreSessionSupersedingHandledWrapper…, applySavedSessionMeta(), clampVariantIndex(), findActiveSessionSummary()] | lang=en
- "scripts_smoke_cosmos_seed": "smoke-cosmos-seed.mjs" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L1 | neighbors=[0326170 Maintenance ran in front of eve…, 06b6faa Init cost 157 sequential round …, 6d70f64 Make a broken deployment say wh…, aa99b23 Usernames, shops as the only wa…, b269064 Create missing Cosmos container…, b862356 Accounts written before handles…] | lang=en
- "shared_containers": "containers.ts" | kind=code-symbol | source=shared/containers.ts:L1 | neighbors=[121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 613ff69 Rebuild the sell tab: one door …, 843b46a +Me, and a bell that tells ever…, 8992ccb A fill meter you can join, and …, 904cac6 Fix the powerSales indexing pat…] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-002.json

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
