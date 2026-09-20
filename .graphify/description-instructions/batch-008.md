# Node Description Batch 9 of 55

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

- "scripts_live_browser_ignores": "live-browser-ignores.js" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-ignores.js:L1 | neighbors=[0f35535 Add the Impeccable design skill, globToRegex(), matchesScope(), normalizeIgnoreRule(), normalizeIgnoreValue(), pageCandidates()]
- "scripts_live_browser_loadsession": "loadSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9229 | neighbors=[live-browser.js, completeSourceInjection(), injectSvelteComponentsFromManifest(), clearSession(), restoreSessionSupersedingHandledWrapper…, restoreSessionWithoutWrapper()]
- "scripts_live_browser_onannotdown": "onAnnotDown()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L593 | neighbors=[live-browser.js, clearAnnotations(), finalizeEditingPin(), localCoords(), redrawStrokes(), renderAllPins()]
- "scripts_live_browser_onpendingpillclick": "onPendingPillClick()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4113 | neighbors=[live-browser.js, hidePendingApplyDock(), remainingManualEditCount(), resetManualApplyProgress(), setPendingApplyLoading(), showToast()]
- "scripts_live_browser_pagechatpalette": "pageChatPalette()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9892 | neighbors=[live-browser.js, buildSteerProcessingDots(), buildSteerQueueHint(), barPaletteForTheme(), detectPageTheme(), syncPageChatChrome()]
- "scripts_live_browser_preparepagechatinputfortyping": "preparePageChatInputForTyping()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10315 | neighbors=[live-browser.js, armPageChatForTyping(), expandPageChat(), focusPageChatInput(), lockSteerChat(), pageChatExpandedWidth()]
- "scripts_live_browser_recoveremptycycling": "recoverEmptyCycling()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3040 | neighbors=[live-browser.js, completeSourceInjection(), ensureCyclingRenderable(), injectVariantsFromSource(), cleanup(), resetSvelteComponentSession()]
- "scripts_live_browser_renderallpins": "renderAllPins()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L780 | neighbors=[live-browser.js, cancelEditingPin(), finalizeEditingPin(), onAnnotDown(), onAnnotMove(), onAnnotUp()]
- "scripts_live_browser_rendermounterrorcard": "renderMountErrorCard()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6027 | neighbors=[live-browser.js, barPaletteForTheme(), detectPageTheme(), el(), mountErrorCardBottomOffset(), truncateMiddle()]
- "scripts_live_browser_schedulehandledruntimewrapperreload": "scheduleHandledRuntimeWrapperReload()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9432 | neighbors=[live-browser.js, resumeSession(), clearHandledWrapperReloadStamp(), deferredRecoverySuperseded(), handledWrapperReloadKey(), isSessionHandled()]
- "scripts_live_browser_showannotoverlay": "showAnnotOverlay()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L518 | neighbors=[live-browser.js, applyEditing(), cancelEditing(), handleClick(), handleKeyDown(), positionAnnotOverlay()]
- "scripts_live_browser_showmanualapplydecision": "showManualApplyDecision()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4185 | neighbors=[live-browser.js, handleManualEditActivity(), onPendingKeepFixingClick(), numberOrNull(), refreshLiveControlsForManualApply(), schedulePendingDockPosition()]
- "scripts_live_browser_startscrolltracking": "startScrollTracking()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7080 | neighbors=[live-browser.js, enterRecoveryWaitingForAnchor(), handleClick(), handleInsertCreate(), handleKeyDown(), restoreSessionWithoutWrapper()]
- "scripts_live_browser_stopscrolllock": "stopScrollLock()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6917 | neighbors=[live-browser.js, abortSvelteComponentInjection(), cleanup(), cleanupAcceptedSession(), handleServerLost(), resetSvelteComponentSession()]
- "scripts_live_browser_stopscrolltracking": "stopScrollTracking()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7110 | neighbors=[live-browser.js, cancelEditingToPicking(), cancelInsertConfigure(), cleanup(), cleanupAcceptedSession(), handleServerLost()]
- "scripts_live_browser_storemanualapplystate": "storeManualApplyState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3912 | neighbors=[live-browser.js, setPendingApplyLoading(), showManualApplyDecision(), readStoredManualApplyState(), writeManualApplyState(), updateManualApplyProgressFromChunk()]
- "scripts_live_browser_syncsteerqueuehint": "syncSteerQueueHint()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10021 | neighbors=[live-browser.js, lockSteerChat(), setLiveState(), syncAgentPollingUi(), buildSteerQueueHint(), pageChatExpandedWidth()]
- "scripts_modern_screenshot_umd_jt": "jt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, de(), ae(), ft(), k(), v()]
- "scripts_modern_screenshot_umd_q": "q()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, P(), be(), de(), _e(), k()]
- "shared_catalog_categories": "CATEGORIES" | kind=code-symbol | source=shared/catalog.ts:L24 | neighbors=[PowerSale.tsx, catalog-routes.ts, power-sale-routes.ts, SellPage.tsx, ShopPage.tsx, WantedPage.tsx]
- "shared_contracts_authuser": "AuthUser" | kind=code-symbol | source=shared/contracts.ts:L24 | neighbors=[main.tsx, mock-provider.ts, swa-provider.ts, types.ts, contracts.ts, api.ts]
- "shared_enums_lot_stage_labels": "LOT_STAGE_LABELS" | kind=code-symbol | source=shared/enums.ts:L90 | neighbors=[fulfilment-routes.ts, seller-routes.ts, LotsPage.tsx, ShopPage.tsx, enums.ts, fulfilment.ts]
- "shared_enums_lot_stages": "LOT_STAGES" | kind=code-symbol | source=shared/enums.ts:L62 | neighbors=[fulfilment-routes.ts, seller-routes.ts, LotsPage.tsx, ShopPage.tsx, enums.ts, fulfilment.ts]
- "shared_fulfilment_inlot": "inLot()" | kind=code-symbol | source=shared/fulfilment.ts:L44 | neighbors=[fulfilment-routes.ts, seller-routes.ts, template-routes.ts, tracking-routes.ts, fulfilment.ts, awaitingLot()]
- "shared_models_message": "Message" | kind=code-symbol | source=shared/models.ts:L1353 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, message-routes.ts, models.ts, BaseDocument]
- "shared_models_powersale": "PowerSale" | kind=code-symbol | source=shared/models.ts:L1253 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, power-sale.ts, power-sale-routes.ts, models.ts]
- "shared_models_want": "Want" | kind=code-symbol | source=shared/models.ts:L1125 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, want-routes.ts, models.ts]
- "shared_models_wantoffer": "WantOffer" | kind=code-symbol | source=shared/models.ts:L1188 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, want-routes.ts, models.ts]
- "shared_routes_itemstepon": "itemStepOn()" | kind=code-symbol | source=shared/routes.ts:L196 | neighbors=[fulfilment-routes.ts, template-routes.ts, tracking-routes.ts, routes.ts, hasTriggers(), lotOffset()]
- "shared_routes_trackingroute": "TrackingRoute" | kind=code-symbol | source=shared/routes.ts:L216 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, tracking-routes.ts, routes.ts, BaseDocument]
- "auth_mock_provider_toauthuser": "toAuthUser()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L399 | neighbors=[index.ts, mock-provider.ts, .getCurrentUser(), .login(), .signup(), swa-provider.ts]
- "commit:repo:github.com/swarnavarb/Figmark@06b6faa9f9ebf20d23b31f3d253cfc77cc844892": "06b6faa Init cost 157 sequential round trips, so the console never finished loa…" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 0326170 Maintenance ran in front of eve…, cosmos-repository.ts, smoke-cosmos-seed.mjs, e7e5925 The seed only ever ran once, so…]
- "commit:repo:github.com/swarnavarb/Figmark@466681d4dda008f623ba6fdbf5ff1ca9b28729d2": "466681d Buy now skipped the checkout it was supposed to open" | kind=Commit | source=git | neighbors=[4484666 Buying is two transactions, not…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 121777a A page at /<username>, and a re…, ListingPage.tsx, OrderPage.tsx]
- "commit:repo:github.com/swarnavarb/Figmark@89d46209f4c0fb9ea224586ede9b5e52d21593b8": "89d4620 Ask a new shop how its stock travels, before it has anything to ship" | kind=Commit | source=git | neighbors=[74942be One lot card, and a lot page wi…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 84e162a Bind a step to the button that …, RoutesPage.tsx, ShopPage.tsx]
- "commit:repo:github.com/swarnavarb/Figmark@904cac6d571149f199f3e451f05c67f101cfc7d0": "904cac6 Fix the powerSales indexing path, and check the rest of them" | kind=Commit | source=git | neighbors=[613ff69 Rebuild the sell tab: one door …, claude/figmark-connection-icpfax, claude/new-session-13ackt, 320bbe5 A members' window that actually…, check-containers.mjs, containers.ts]
- "commit:repo:github.com/swarnavarb/Figmark@c501457e342b1adaac2fa2ea47f13f3c08dc442c": "c501457 Put Routes on the Track tab, where Track actually lives" | kind=Commit | source=git | neighbors=[141db1a Routes you can write, and a tra…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 543c531 Joining a lot is an event, not …, RoutesPage.tsx, ShopPage.tsx]
- "commit:repo:github.com/swarnavarb/Figmark@e7e59251a666c571ad0fe521003fcb6846a88bb6": "e7e5925 The seed only ever ran once, so the deployed data stopped at day one" | kind=Commit | source=git | neighbors=[6696535 An escrow is a person the buyer…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 06b6faa Init cost 157 sequential round …, cosmos-repository.ts, smoke-cosmos-seed.mjs]
- "commit:repo:github.com/swarnavarb/Figmark@efdbcff1962b2fdf41ed42378509b24b616cd1b3": "efdbcff `from` is a reserved word in Cosmos SQL, and the inbox query used it" | kind=Commit | source=git | neighbors=[6d70f64 Make a broken deployment say wh…, claude/figmark-connection-icpfax, claude/new-session-13ackt, d820fb9 The order lifecycle: hold the m…, cosmos-repository.ts, check-queries.mjs]
- "components_ui_leadphoto": "leadPhoto()" | kind=code-symbol | source=app/src/components/ui.tsx:L48 | neighbors=[ui.tsx, FeedPage.tsx, ListingPage.tsx, ProfileByHandlePage.tsx, ProfilePage.tsx, ShopPage.tsx]
- "components_ui_trustbadge": "TrustBadge()" | kind=code-symbol | source=app/src/components/ui.tsx:L72 | neighbors=[ui.tsx, FeedPage.tsx, ForwardersPage.tsx, ListingPage.tsx, ProfilePage.tsx, ServicesPage.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-008.json

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
