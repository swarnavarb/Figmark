# Node Description Batch 1 of 55

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

- "scripts_live_browser": "live-browser.js" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1 | neighbors=[0f35535 Add the Impeccable design skill, abandonForeignSession(), abortSvelteComponentInjection(), acceptedDomAlreadyClean(), actionLabel(), addManualContextText()] | lang=en
- "src_api": "api.ts" | kind=code-symbol | source=app/src/api.ts:L1 | neighbors=[api.ts, 121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 27d0f52 Announcements are a choice the …, 320bbe5 A members' window that actually…, 4484666 Buying is two transactions, not…] | lang=en
- "shared_models": "models.ts" | kind=code-symbol | source=shared/models.ts:L1 | neighbors=[api.ts, mock-provider.ts, 121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 27d0f52 Announcements are a choice the …, 320bbe5 A members' window that actually…] | lang=en
- "pages_shoppage": "ShopPage.tsx" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1 | neighbors=[121777a A page at /<username>, and a re…, 12950fa Give Figmark a typeface, a dens…, 141db1a Routes you can write, and a tra…, 320bbe5 A members' window that actually…, 344cea2 One tracking ladder, and a batc…, 4484666 Buying is two transactions, not…] | lang=en
- "data_cosmos_repository_cosmosrepository": "CosmosRepository" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L63 | neighbors=[cosmos-repository.ts, .addComment(), .assignListingsToLot(), .backfillHandles(), .bumpListing(), .constructor()] | lang=en
- "functions_fulfilment_routes": "fulfilment-routes.ts" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 320bbe5 A members' window that actually…, 344cea2 One tracking ladder, and a batc…, 44f8ea3 Label the warehouse toggle, and…, 71eee88 The exporter was the supplier a…, 74942be One lot card, and a lot page wi…] | lang=en
- "data_memory_repository_memoryrepository": "MemoryRepository" | kind=code-symbol | source=api/src/data/memory-repository.ts:L48 | neighbors=[index.ts, memory-repository.ts, .addComment(), .assignListingsToLot(), .bumpListing(), .createDispute()] | lang=en
- "data_cosmos_repository": "cosmos-repository.ts" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1 | neighbors=[0326170 Maintenance ran in front of eve…, 06b6faa Init cost 157 sequential round …, 121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 320bbe5 A members' window that actually…, 613ff69 Rebuild the sell tab: one door …] | lang=en
- "data_cosmos_repository_cosmosrepository_container": ".container()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L590 | neighbors=[CosmosRepository, .addComment(), .assignListingsToLot(), .bumpListing(), .countSignInAccounts(), .createDispute()] | lang=en
- "shared_enums": "enums.ts" | kind=code-symbol | source=shared/enums.ts:L1 | neighbors=[DisputesView.tsx, mock-provider.ts, swa-provider.ts, types.ts, 4484666 Buying is two transactions, not…, 71eee88 The exporter was the supplier a…] | lang=en
- "data_memory_repository": "memory-repository.ts" | kind=code-symbol | source=api/src/data/memory-repository.ts:L1 | neighbors=[121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 320bbe5 A members' window that actually…, 613ff69 Rebuild the sell tab: one door …, 6696535 An escrow is a person the buyer…, 6d70f64 Make a broken deployment say wh…] | lang=en
- "functions_tracking_routes": "tracking-routes.ts" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, 84e162a Bind a step to the button that …, b36b0b9 Stop the warehouse tick claimin…, c6c033a The batch is the tracking engin…, ced09f4 A lot's ladder is the lot's ste…] | lang=en
- "data_seed": "seed.ts" | kind=code-symbol | source=api/src/data/seed.ts:L1 | neighbors=[121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 4484666 Buying is two transactions, not…, 6696535 An escrow is a person the buyer…, 71eee88 The exporter was the supplier a…, 7b5199d Filters that fit, tabs that hol…] | lang=en
- "shared_routes": "routes.ts" | kind=code-symbol | source=shared/routes.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, 84e162a Bind a step to the button that …, b36b0b9 Stop the warehouse tick claimin…, c6c033a The batch is the tracking engin…, ced09f4 A lot's ladder is the lot's ste…] | lang=en
- "functions_catalog_routes": "catalog-routes.ts" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, 613ff69 Rebuild the sell tab: one door …, 7b5199d Filters that fit, tabs that hol…, 8992ccb A fill meter you can join, and …, a5a184e Orders, Track, and the statione…] | lang=en
- "functions_order_routes": "order-routes.ts" | kind=code-symbol | source=api/src/functions/order-routes.ts:L1 | neighbors=[121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 4484666 Buying is two transactions, not…, 613ff69 Rebuild the sell tab: one door …, 6696535 An escrow is a person the buyer…, d820fb9 The order lifecycle: hold the m…] | lang=en
- "functions_dispute_routes": "dispute-routes.ts" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L1 | neighbors=[6696535 An escrow is a person the buyer…, dc5dc06 Notifications for the rest of i…, e057084 Every name is an address, and e…, f1b6577 An operations console, escrow a…, admin-routes.ts, index.ts] | lang=en
- "pages_lotspage": "LotsPage.tsx" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L1 | neighbors=[141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, 71eee88 The exporter was the supplier a…, 74942be One lot card, and a lot page wi…, 84e162a Bind a step to the button that …, b36b0b9 Stop the warehouse tick claimin…] | lang=en
- "pages_orderpage": "OrderPage.tsx" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L1 | neighbors=[141db1a Routes you can write, and a tra…, 344cea2 One tracking ladder, and a batc…, 4484666 Buying is two transactions, not…, 466681d Buy now skipped the checkout it…, 543c531 Joining a lot is an event, not …, 6696535 An escrow is a person the buyer…] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@f4ae77f3d83cfb2f7d60cdf36bd81b1d64d62507": "f4ae77f The lot board: count the pieces, not the crate" | kind=Commit | source=git | neighbors=[vite.config.ts, errors.ts, index.ts, mock-provider.ts, swa-provider.ts, types.ts] | lang=en
- "functions_seller_routes": "seller-routes.ts" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L1 | neighbors=[121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 4484666 Buying is two transactions, not…, 613ff69 Rebuild the sell tab: one door …, a5a184e Orders, Track, and the statione…, aa99b23 Usernames, shops as the only wa…] | lang=en
- "src_main": "main.tsx" | kind=code-symbol | source=app/src/main.tsx:L1 | neighbors=[141db1a Routes you can write, and a tra…, 6696535 An escrow is a person the buyer…, 71eee88 The exporter was the supplier a…, aa99b23 Usernames, shops as the only wa…, e492525 A Services tab, and the people …, f1b6577 An operations console, escrow a…] | lang=en
- "scripts_modern_screenshot_umd": "modern-screenshot.umd.js" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[0f35535 Add the Impeccable design skill, modern-screenshot.umd.js, ae(), be(), bt(), Ce()] | lang=en
- "functions_template_routes": "template-routes.ts" | kind=code-symbol | source=api/src/functions/template-routes.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, 84e162a Bind a step to the button that …, a5a184e Orders, Track, and the statione…, b36b0b9 Stop the warehouse tick claimin…, ced09f4 A lot's ladder is the lot's ste…] | lang=en
- "scripts_smoke_api": "smoke-api.mjs" | kind=code-symbol | source=scripts/smoke-api.mjs:L1 | neighbors=[121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 27d0f52 Announcements are a choice the …, 320bbe5 A members' window that actually…, 4484666 Buying is two transactions, not…, 543c531 Joining a lot is an event, not …] | lang=en
- "data_repository": "repository.ts" | kind=code-symbol | source=api/src/data/repository.ts:L1 | neighbors=[mock-provider.ts, swa-provider.ts, 121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, 320bbe5 A members' window that actually…, 613ff69 Rebuild the sell tab: one door …] | lang=en
- "pages_socialpage": "SocialPage.tsx" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 141db1a Routes you can write, and a tra…, 27d0f52 Announcements are a choice the …, 843b46a +Me, and a bell that tells ever…, a2f74f9 A channel is a shop's room, and…, a5a184e Orders, Track, and the statione…] | lang=en
- "branch:repo:github.com/swarnavarb/Figmark#claude/figmark-connection-icpfax": "claude/figmark-connection-icpfax" | kind=Branch | source=git | neighbors=[0326170 Maintenance ran in front of eve…, 0460f84 The links were there and looked…, 06b6faa Init cost 157 sequential round …, 0f35535 Add the Impeccable design skill, 119ed59 Add Emil Kowalski's design and …, 121777a A page at /<username>, and a re…] | lang=en
- "branch:repo:github.com/swarnavarb/Figmark#claude/new-session-13ackt": "claude/new-session-13ackt" | kind=Branch | source=git | neighbors=[0326170 Maintenance ran in front of eve…, 0460f84 The links were there and looked…, 06b6faa Init cost 157 sequential round …, 0f35535 Add the Impeccable design skill, 119ed59 Add Emil Kowalski's design and …, 121777a A page at /<username>, and a re…] | lang=en
- "components_ui": "ui.tsx" | kind=code-symbol | source=app/src/components/ui.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 6696535 An escrow is a person the buyer…, 843b46a +Me, and a bell that tells ever…, 8cf0d9b Give Figmark a vibrant colour i…, a5a184e Orders, Track, and the statione…, aa99b23 Usernames, shops as the only wa…] | lang=en
- "functions_service_routes": "service-routes.ts" | kind=code-symbol | source=api/src/functions/service-routes.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 71eee88 The exporter was the supplier a…, e492525 A Services tab, and the people …, index.ts, getAuthService(), index.ts] | lang=en
- "functions_power_sale_routes": "power-sale-routes.ts" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L1 | neighbors=[320bbe5 A members' window that actually…, 613ff69 Rebuild the sell tab: one door …, index.ts, getAuthService(), index.ts, getRepository()] | lang=en
- "pages_feedpage": "FeedPage.tsx" | kind=code-symbol | source=app/src/pages/FeedPage.tsx:L1 | neighbors=[7b5199d Filters that fit, tabs that hol…, 8992ccb A fill meter you can join, and …, 8cf0d9b Give Figmark a vibrant colour i…, a5a184e Orders, Track, and the statione…, e492525 A Services tab, and the people …, f4ae77f The lot board: count the pieces…] | lang=en
- "pages_profilebyhandlepage": "ProfileByHandlePage.tsx" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L1 | neighbors=[0460f84 The links were there and looked…, 121777a A page at /<username>, and a re…, 8cf0d9b Give Figmark a vibrant colour i…, a5a184e Orders, Track, and the statione…, aa99b23 Usernames, shops as the only wa…, d820fb9 The order lifecycle: hold the m…] | lang=en
- "shared_fulfilment": "fulfilment.ts" | kind=code-symbol | source=shared/fulfilment.ts:L1 | neighbors=[141db1a Routes you can write, and a tra…, 543c531 Joining a lot is an event, not …, c6c033a The batch is the tracking engin…, f4ae77f The lot board: count the pieces…, Ladder.tsx, cosmos-repository.ts] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@141db1a4179d482cf941d47fd0658862bd2a02ce": "141db1a Routes you can write, and a tracking timeline you can edit" | kind=Commit | source=git | neighbors=[UsersView.tsx, claude/figmark-connection-icpfax, claude/new-session-13ackt, c501457 Put Routes on the Track tab, wh…, Ladder.tsx, LotFields.tsx] | lang=pt
- "pages_profilepage": "ProfilePage.tsx" | kind=code-symbol | source=app/src/pages/ProfilePage.tsx:L1 | neighbors=[121777a A page at /<username>, and a re…, 141db1a Routes you can write, and a tra…, a5a184e Orders, Track, and the statione…, b269064 Create missing Cosmos container…, c6c033a The batch is the tracking engin…, d820fb9 The order lifecycle: hold the m…] | lang=en
- "functions_admin_routes": "admin-routes.ts" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L1 | neighbors=[29bd178 The Functions host keeps /admin…, 320bbe5 A members' window that actually…, 6696535 An escrow is a person the buyer…, f1b6577 An operations console, escrow a…, index.ts, getAuthService()] | lang=en
- "auth_mock_provider": "mock-provider.ts" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L1 | neighbors=[index.ts, errors.ts, AuthError, hasSessionCookie(), MockAuthProvider, readToken()] | lang=en
- "functions_social_routes": "social-routes.ts" | kind=code-symbol | source=api/src/functions/social-routes.ts:L1 | neighbors=[27d0f52 Announcements are a choice the …, a2f74f9 A channel is a shop's room, and…, e057084 Every name is an address, and e…, f4ae77f The lot board: count the pieces…, index.ts, getAuthService()] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-000.json

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
