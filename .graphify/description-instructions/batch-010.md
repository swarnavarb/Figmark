# Node Description Batch 11 of 55

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
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "scripts_live_browser_syncplaceholderresizehandles": "syncPlaceholderResizeHandles()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2214 | neighbors=[live-browser.js, hideAnnotOverlay(), positionAnnotOverlay(), removeInsertPlaceholderDom(), showAnnotOverlay(), buildPlaceholderResizeHandles()]
- "scripts_live_browser_updatemanualapplyrepairstate": "updateManualApplyRepairState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3985 | neighbors=[live-browser.js, handleManualEditActivity(), onPendingKeepFixingClick(), readStoredManualApplyState(), setPendingApplyLoading(), storeManualApplyState()]
- "scripts_live_browser_updatevariantstatestylesheet": "updateVariantStateStylesheet()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6670 | neighbors=[live-browser.js, applyParamValue(), refreshParamsPanel(), showVariantInDOM(), variantParamDecls(), variantStateSelector()]
- "scripts_modern_screenshot_umd_de": "de()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, jt(), Mt(), Ot(), fe(), q()]
- "scripts_modern_screenshot_umd_e": "_e()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L10 | neighbors=[modern-screenshot.umd.js, Gt(), k(), ne(), qt(), q()]
- "scripts_modern_screenshot_umd_fe": "fe()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, de(), J(), k(), x(), yt()]
- "scripts_modern_screenshot_umd_tt": "Tt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, ne(), Ct(), Et(), Se(), St()]
- "shared_enums_conditiontag": "ConditionTag" | kind=code-symbol | source=shared/enums.ts:L39 | neighbors=[power-sale-routes.ts, template-routes.ts, want-routes.ts, enums.ts, models.ts, templates.ts]
- "shared_enums_lotstage": "LotStage" | kind=code-symbol | source=shared/enums.ts:L71 | neighbors=[Ladder.tsx, fulfilment-routes.ts, enums.ts, fulfilment.ts, models.ts, routes.ts]
- "shared_enums_storepermission": "StorePermission" | kind=code-symbol | source=shared/enums.ts:L237 | neighbors=[seller-routes.ts, ShopPage.tsx, enums.ts, models.ts, stores.ts, api.ts]
- "shared_fulfilment_stagesfor": "stagesFor()" | kind=code-symbol | source=shared/fulfilment.ts:L59 | neighbors=[fulfilment-routes.ts, fulfilment.ts, furthestStage(), progressOf(), awaitingLot(), isDirect()]
- "shared_models_notification": "Notification" | kind=code-symbol | source=shared/models.ts:L1213 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, notify.ts, models.ts, BaseDocument]
- "shared_models_sellerprofile": "SellerProfile" | kind=code-symbol | source=shared/models.ts:L164 | neighbors=[seller-routes.ts, ShopPage.tsx, contracts.ts, models.ts, stores.ts, api.ts]
- "shared_models_storereview": "StoreReview" | kind=code-symbol | source=shared/models.ts:L937 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, profile-routes.ts, models.ts, BaseDocument]
- "shared_routes_coarsestage": "coarseStage()" | kind=code-symbol | source=shared/routes.ts:L490 | neighbors=[fulfilment-routes.ts, template-routes.ts, tracking-routes.ts, routes.ts, atSellerYet(), stepForStage()]
- "shared_routes_lotnumberfrom": "lotNumberFrom()" | kind=code-symbol | source=shared/routes.ts:L560 | neighbors=[catalog-routes.ts, fulfilment-routes.ts, seller-routes.ts, tracking-routes.ts, routes.ts, lotRefOf()]
- "shared_routes_lotoffset": "lotOffset()" | kind=code-symbol | source=shared/routes.ts:L153 | neighbors=[fulfilment-routes.ts, tracking-routes.ts, routes.ts, currentStepName(), itemStepOn(), joinIndexOf()]
- "src_config_config": "config" | kind=code-symbol | source=api/src/config.ts:L160 | neighbors=[index.ts, mock-provider.ts, index.ts, health.ts, config.ts, index.ts]
- "src_config_env": "env()" | kind=code-symbol | source=api/src/config.ts:L51 | neighbors=[config.ts, resolveAdmins(), resolveAuthMode(), resolveCosmos(), resolveSessionSecret(), resolveStorage()]
- "auth_mock_provider_mockauthprovider_getcurrentuser": ".getCurrentUser()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L70 | neighbors=[MockAuthProvider, readTokens(), toAuthUser(), .requireAuth(), .staleCookies()]
- "auth_mock_provider_mockauthprovider_requireauth": ".requireAuth()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L92 | neighbors=[MockAuthProvider, hasSessionCookie(), .getCurrentUser(), readTokens(), .requireCapability()]
- "commit:repo:github.com/swarnavarb/Figmark@0460f849b5d825cdddeec24fbaf184d074965217": "0460f84 The links were there and looked exactly like plain text" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, b862356 Accounts written before handles…, ProfileByHandlePage.tsx, e057084 Every name is an address, and e…]
- "commit:repo:github.com/swarnavarb/Figmark@4e0f732e0446d9e185a45e3f71bd70f7467ef63e": "4e0f732 A route module can be present, compiled, and still not deployed" | kind=Commit | source=git | neighbors=[0326170 Maintenance ran in front of eve…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 29bd178 The Functions host keeps /admin…, check-routes.mjs]
- "commit:repo:github.com/swarnavarb/Figmark@d7cd6b434b1bf74a54eeb11b7d7a22ea165efe22": "d7cd6b4 A \"comment\" key took the operations console offline" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 6696535 An escrow is a person the buyer…, check-swa-config.mjs, f1b6577 An operations console, escrow a…]
- "data_cosmos_repository_cosmosrepository_existingids": ".existingIds()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L493 | neighbors=[CosmosRepository, .backfillHandles(), .container(), .repair(), .topUpFixtures()]
- "data_cosmos_repository_cosmosrepository_readreservation": ".readReservation()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L500 | neighbors=[CosmosRepository, .getByHandle(), .container(), isNotFound(), .reserveHandle()]
- "data_cosmos_repository_cosmosrepository_repair": ".repair()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L383 | neighbors=[CosmosRepository, .existingIds(), .listAllUsers(), .seedFixtures(), .runMaintenance()]
- "data_cosmos_repository_cosmosrepository_reservehandle": ".reserveHandle()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L793 | neighbors=[CosmosRepository, .backfillHandles(), .container(), .readReservation(), isConflict()]
- "data_memory_repository_identifiersof": "identifiersOf()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L782 | neighbors=[cosmos-repository.ts, memory-repository.ts, .createUser(), .deleteUser(), .indexUser()]
- "data_memory_repository_memoryrepository_indexuser": ".indexUser()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L97 | neighbors=[MemoryRepository, .createUser(), identifiersOf(), .init(), .updateUser()]
- "data_seed_seededcounts": "seededCounts()" | kind=code-symbol | source=api/src/data/seed.ts:L548 | neighbors=[seed.ts, seedLiveSale(), seedLotOrders(), seedOrders(), seedPledges()]
- "data_seed_seedlivesale": "seedLiveSale()" | kind=code-symbol | source=api/src/data/seed.ts:L984 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, seededCounts(), iso()]
- "data_seed_seedlotorders": "seedLotOrders()" | kind=code-symbol | source=api/src/data/seed.ts:L1242 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, seededCounts(), iso()]
- "data_seed_seedorders": "seedOrders()" | kind=code-symbol | source=api/src/data/seed.ts:L661 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, seededCounts(), iso()]
- "data_seed_seedreviews": "seedReviews()" | kind=code-symbol | source=api/src/data/seed.ts:L800 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso(), soon()]
- "data_seed_verification": "verification()" | kind=code-symbol | source=api/src/data/seed.ts:L81 | neighbors=[seed.ts, forwarder(), handler(), seedUsers(), storefront()]
- "functions_dispute_routes_message": "message()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L102 | neighbors=[dispute-routes.ts, escalate(), offer(), open(), reply()]
- "functions_fulfilment_routes_lotsstorefor": "lotsStoreFor()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L758 | neighbors=[fulfilment-routes.ts, lotBoard(), lotsBoard(), myLots(), setCheckpoint()]
- "functions_want_routes_findwant": "findWant()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L160 | neighbors=[want-routes.ts, alsoMe(), close(), offer(), readWant()]
- "scripts_live_browser_accepteddomalreadyclean": "acceptedDomAlreadyClean()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8831 | neighbors=[live-browser.js, ensureAcceptedDomClean(), reloadAfterMissingAcceptedDom(), restoreAcceptedDomFromSnapshot(), scheduleAcceptCleanup()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-010.json

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
