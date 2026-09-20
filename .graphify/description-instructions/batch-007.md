# Node Description Batch 8 of 55

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

- "scripts_modern_screenshot_umd_ye": "ye()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, k(), be(), ht(), me(), pt()]
- "shared_enums_order_checkpoints": "ORDER_CHECKPOINTS" | kind=code-symbol | source=shared/enums.ts:L264 | neighbors=[LotPeople.tsx, RouteBuilder.tsx, fulfilment-routes.ts, LotsPage.tsx, board.ts, enums.ts]
- "shared_enums_sourcing": "SOURCING" | kind=code-symbol | source=shared/enums.ts:L49 | neighbors=[catalog-routes.ts, SellPage.tsx, ShopPage.tsx, enums.ts, fulfilment.ts, models.ts]
- "shared_handles_suggestusername": "suggestUsername()" | kind=code-symbol | source=shared/handles.ts:L59 | neighbors=[mock-provider.ts, cosmos-repository.ts, seller-routes.ts, AuthPage.tsx, ProfilePage.tsx, ShopPage.tsx]
- "shared_handles_username_problems": "USERNAME_PROBLEMS" | kind=code-symbol | source=shared/handles.ts:L46 | neighbors=[mock-provider.ts, message-routes.ts, seller-routes.ts, AuthPage.tsx, ProfileByHandlePage.tsx, ProfilePage.tsx]
- "shared_models_forum": "Forum" | kind=code-symbol | source=shared/models.ts:L1323 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, social-routes.ts, models.ts]
- "shared_models_listingcomment": "ListingComment" | kind=code-symbol | source=shared/models.ts:L543 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, catalog-routes.ts, models.ts]
- "shared_models_pledge": "Pledge" | kind=code-symbol | source=shared/models.ts:L521 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, preorder.ts, preorder-routes.ts]
- "shared_models_stageevent": "StageEvent" | kind=code-symbol | source=shared/models.ts:L586 | neighbors=[Ladder.tsx, catalog-routes.ts, fulfilment-routes.ts, template-routes.ts, tracking-routes.ts, fulfilment.ts]
- "shared_routes_currentstepof": "currentStepOf()" | kind=code-symbol | source=shared/routes.ts:L468 | neighbors=[fulfilment-routes.ts, seller-routes.ts, template-routes.ts, tracking-routes.ts, routes.ts, atSellerYet()]
- "shared_stores_can": "can()" | kind=code-symbol | source=shared/stores.ts:L52 | neighbors=[catalog-routes.ts, fulfilment-routes.ts, insight-routes.ts, power-sale-routes.ts, seller-routes.ts, social-routes.ts]
- "storage_memory_store_memoryphotostore": "MemoryPhotoStore" | kind=code-symbol | source=api/src/storage/memory-store.ts:L13 | neighbors=[index.ts, memory-store.ts, .init(), .read(), .status(), .upload()]
- "storage_types": "types.ts" | kind=code-symbol | source=api/src/storage/types.ts:L1 | neighbors=[a5a184e Orders, Track, and the statione…, f4ae77f The lot board: count the pieces…, blob-store.ts, index.ts, memory-store.ts, PhotoStore]
- "auth_errors": "errors.ts" | kind=code-symbol | source=api/src/auth/errors.ts:L1 | neighbors=[AuthError, index.ts, mock-provider.ts, swa-provider.ts, f4ae77f The lot board: count the pieces…, fulfilment-routes.ts]
- "commit:repo:github.com/swarnavarb/Figmark@344cea2f29030fdac4796771b4b27241605c12a2": "344cea2 One tracking ladder, and a batch you can open in one decision" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 141db1a Routes you can write, and a tra…, fulfilment-routes.ts, OrderPage.tsx, ShopPage.tsx]
- "commit:repo:github.com/swarnavarb/Figmark@b862356beab82662eb4d7a690f31faa874f0e6c2": "b862356 Accounts written before handles existed had no address to link to" | kind=Commit | source=git | neighbors=[0460f84 The links were there and looked…, claude/figmark-connection-icpfax, claude/new-session-13ackt, a2f74f9 A channel is a shop's room, and…, cosmos-repository.ts, SocialPage.tsx]
- "components_icon_icon": "Icon()" | kind=code-symbol | source=app/src/components/Icon.tsx:L68 | neighbors=[Feedback.tsx, Icon.tsx, Ladder.tsx, Notifications.tsx, PhotoManager.tsx, RouteBuilder.tsx]
- "components_ladder_ladder": "Ladder()" | kind=code-symbol | source=app/src/components/Ladder.tsx:L22 | neighbors=[Ladder.tsx, notesByStep(), LotsPage.tsx, OrderPage.tsx, ProfilePage.tsx, RoutesPage.tsx]
- "components_ui_modal": "Modal()" | kind=code-symbol | source=app/src/components/ui.tsx:L179 | neighbors=[PowerSale.tsx, ui.tsx, EscrowPage.tsx, OrderPage.tsx, ProfileByHandlePage.tsx, ShopPage.tsx]
- "data_cosmos_repository_cosmosrepository_getuserbyid": ".getUserById()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L594 | neighbors=[CosmosRepository, .deleteUser(), .getByHandle(), .container(), isNotFound(), .getUserByIdentifier()]
- "data_cosmos_repository_cosmosrepository_init": ".init()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L106 | neighbors=[CosmosRepository, autoSeedEnabled(), .countSignInAccounts(), .ensureContainers(), .fill(), .runMaintenance()]
- "data_cosmos_repository_cosmosrepository_runmaintenance": ".runMaintenance()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L327 | neighbors=[CosmosRepository, .init(), .backfillHandles(), .countSignInAccounts(), .repair(), .topUpFixtures()]
- "data_seed_trust": "trust()" | kind=code-symbol | source=api/src/data/seed.ts:L96 | neighbors=[seed.ts, forwarder(), handler(), seedUsers(), sellerTrust(), storefront()]
- "functions_fulfilment_routes_ownedlot": "ownedLot()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L340 | neighbors=[fulfilment-routes.ts, advanceStage(), assignToLot(), lotContents(), setCrew(), setTracking()]
- "functions_power_sale_advancepowersale": "advancePowerSale()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L151 | neighbors=[power-sale.ts, advanceAll(), dueAt(), listingFor(), minutes(), shopPost()]
- "functions_power_sale_routes_create": "create()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L188 | neighbors=[power-sale-routes.ts, card(), positive(), readBody(), readItem(), shopFor()]
- "scripts_check_styles": "check-styles.mjs" | kind=code-symbol | source=scripts/check-styles.mjs:L1 | neighbors=[e492525 A Services tab, and the people …, bareClasses(), check(), css, displayOf(), parsed]
- "scripts_live_browser_buildconfigurecountcontrol": "buildConfigureCountControl()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1593 | neighbors=[live-browser.js, bindConfigureCountPillTooltip(), bindConfigureInlineControlHover(), configureInlineControlStyle(), el(), buildConfigureRow()]
- "scripts_live_browser_buildgeneratingrow": "buildGeneratingRow()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2581 | neighbors=[live-browser.js, actionLabel(), buildDots(), el(), generationStatusText(), showBar()]
- "scripts_live_browser_buildparamspanel": "buildParamsPanel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3226 | neighbors=[live-browser.js, barPaletteForTheme(), detectPageTheme(), el(), formatRangeValue(), openTunePopover()]
- "scripts_live_browser_buildsveltepropvaluesv2": "buildSveltePropValuesV2()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5459 | neighbors=[live-browser.js, buildSveltePropValuesFromLiveElement(), buildSvelteExpressionTextMap(), cloneWithoutElements(), cssEscapeIdent(), parseOriginalMarkupElement()]
- "scripts_live_browser_captureandemit": "captureAndEmit()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8230 | neighbors=[live-browser.js, captureElementToBlob(), sendCheckpoint(), sendEvent(), showShaderOverlay(), handleGo()]
- "scripts_live_browser_clearinsertpicking": "clearInsertPicking()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2286 | neighbors=[live-browser.js, cancelInsertConfigure(), finalizeInsertSession(), hideInsertLine(), hideBar(), toggleInsert()]
- "scripts_live_browser_clearmounterrorcard": "clearMountErrorCard()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6012 | neighbors=[live-browser.js, cleanup(), handleGo(), handleInsertCreate(), mountSvelteComponentVariant(), resetSvelteComponentSession()]
- "scripts_live_browser_closetunepopover": "closeTunePopover()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4957 | neighbors=[live-browser.js, hideParamsPanel(), showOrUpdateCyclingBar(), handleClick(), hideBar(), refreshLiveControlsForManualApply()]
- "scripts_live_browser_commitacceptedsveltecomponenttodom": "commitAcceptedSvelteComponentToDom()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5747 | neighbors=[live-browser.js, applyOriginalAttrsToSvelteAnchor(), getMountedSvelteComponentAnchor(), isSvelteInsertManifest(), removeSvelteComponentVariantStyle(), maybeCompleteAcceptedSession()]
- "scripts_live_browser_completeparameterpublication": "completeParameterPublication()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4909 | neighbors=[live-browser.js, completeParameterGenerationIfReady(), mountedParameterCount(), refreshParamsPanel(), saveSession(), showOrUpdateCyclingBar()]
- "scripts_live_browser_createinsertplaceholder": "createInsertPlaceholder()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2247 | neighbors=[live-browser.js, applyPlaceholderSizingStyles(), detectInsertAxis(), placeholderSizing(), removeInsertPlaceholderDom(), ensureInsertPlaceholder()]
- "scripts_live_browser_documentrefforelement": "documentRefForElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3636 | neighbors=[live-browser.js, applyEditing(), copyEditContainerContext(), copyEditLeafContext(), documentRefSegment(), mixedTextWrapRestoreHint()]
- "scripts_live_browser_entereditingmode": "enterEditingMode()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3507 | neighbors=[live-browser.js, enableInlineEdit(), hideAnnotOverlay(), hideBar(), renderEditBadge(), setLiveState()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-007.json

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
