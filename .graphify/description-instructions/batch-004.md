# Node Description Batch 5 of 55

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

- "scripts_live_browser_buildconfigurerow": "buildConfigureRow()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2389 | neighbors=[live-browser.js, buildConfigureActionControl(), buildConfigureCountControl(), buildConfigureSubmitButton(), buildConfigureTrailingCluster(), buildConfigureVoiceButton()] | lang=en
- "scripts_live_browser_buildinsertconfigurerow": "buildInsertConfigureRow()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2476 | neighbors=[live-browser.js, buildConfigureCountControl(), buildConfigureSubmitButton(), buildConfigureTrailingCluster(), buildConfigureVoiceButton(), buildSelectionPill()] | lang=en
- "scripts_live_browser_cancelinsertconfigure": "cancelInsertConfigure()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7845 | neighbors=[live-browser.js, clearAnnotations(), clearInsertPicking(), hideAnnotOverlay(), hideBar(), hideHighlight()] | lang=en
- "scripts_live_browser_completesourceinjection": "completeSourceInjection()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6285 | neighbors=[live-browser.js, completeParameterGenerationIfReady(), disableInlineEdit(), hideShaderOverlay(), loadSession(), pickVariantContent()] | lang=en
- "scripts_live_browser_detectpagetheme": "detectPageTheme()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9825 | neighbors=[live-browser.js, buildParamsPanel(), configureBarPalette(), ensureAgentPollTooltip(), initActionPicker(), initBar()] | lang=en
- "scripts_live_browser_findvariantswrapper": "findVariantsWrapper()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6958 | neighbors=[live-browser.js, commitAcceptedVariantToDom(), ensureInsertPlaceholder(), pickPopulatedVariantsWrapper(), getVisibleVariantEl(), handleAccept()] | lang=en
- "scripts_live_browser_refreshparamspanel": "refreshParamsPanel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4868 | neighbors=[live-browser.js, completeParameterPublication(), completeSourceInjection(), injectSvelteComponentsFromManifest(), applyParamDefaults(), buildParamsPanel()] | lang=en
- "shared_capabilities": "capabilities.ts" | kind=code-symbol | source=shared/capabilities.ts:L1 | neighbors=[mock-provider.ts, swa-provider.ts, f4ae77f The lot board: count the pieces…, fulfilment-routes.ts, deriveCapabilities(), hasAnyCapability()] | lang=en
- "storage_blob_store": "blob-store.ts" | kind=code-symbol | source=api/src/storage/blob-store.ts:L1 | neighbors=[a5a184e Orders, Track, and the statione…, f4ae77f The lot board: count the pieces…, containers.ts, config.ts, StorageConfig, BlobPhotoStore] | lang=en
- "auth_types": "types.ts" | kind=code-symbol | source=api/src/auth/types.ts:L1 | neighbors=[index.ts, mock-provider.ts, swa-provider.ts, AuthService, contracts.ts, AuthMode] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@84e162a12c833e0d334dfa79c1a15b91328bedb1": "84e162a Bind a step to the button that moves it" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 71eee88 The exporter was the supplier a…, RouteBuilder.tsx, fulfilment-routes.ts, template-routes.ts] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@b1179de8e3751d1d87fada8f4f30ed6f3c9e732b": "b1179de Pro analytics off the packing board, and numbers that open" | kind=Commit | source=git | neighbors=[320bbe5 A members' window that actually…, claude/figmark-connection-icpfax, claude/new-session-13ackt, e492525 A Services tab, and the people …, ui.tsx, insight-routes.ts] | lang=en
- "data_cosmos_repository_isnotfound": "isNotFound()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1705 | neighbors=[cosmos-repository.ts, .assignListingsToLot(), .bumpListing(), .deletePledge(), .getForum(), .getLot()] | lang=en
- "pages_forwarderspage": "ForwardersPage.tsx" | kind=code-symbol | source=app/src/pages/ForwardersPage.tsx:L1 | neighbors=[f4ae77f The lot board: count the pieces…, ui.tsx, Avatar(), EmptyState(), ErrorNotice(), TrustBadge()] | lang=en
- "scripts_live_browser_captureelementtoblob": "captureElementToBlob()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8160 | neighbors=[live-browser.js, captureAndEmit(), averageRgb01(), buildAnnotationsForCapture(), collectFontCssText(), cssColorToRgb01()] | lang=en
- "scripts_live_browser_handlemanualeditactivity": "handleManualEditActivity()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4272 | neighbors=[live-browser.js, clearStoredManualApplyState(), fetchPendingCount(), manualEditEventForCurrentPage(), numberOrNull(), remainingManualEditCount()] | lang=en
- "scripts_live_browser_resetsveltecomponentsession": "resetSvelteComponentSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6161 | neighbors=[live-browser.js, recoverEmptyCycling(), clearHandled(), clearMountErrorCard(), clearSession(), hideBar()] | lang=en
- "scripts_live_browser_savesession": "saveSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9202 | neighbors=[live-browser.js, abortSvelteComponentInjection(), completeParameterPublication(), completeSourceInjection(), enterRecoveryWaitingForAnchor(), handleAccept()] | lang=en
- "scripts_live_browser_stopvoice": "stopVoice()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10555 | neighbors=[live-browser.js, handleGo(), handleInsertCreate(), hideBar(), lockSteerChat(), startVoice()] | lang=en
- "scripts_live_browser_syncpagechatfocus": "syncPageChatFocus()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10283 | neighbors=[live-browser.js, cancelEditingToPicking(), cancelInsertConfigure(), exitConfigureToPicking(), init(), focusConfigureInput()] | lang=en
- "scripts_live_browser_updatependingcounter": "updatePendingCounter()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4075 | neighbors=[live-browser.js, applyEditing(), fetchPendingCount(), handleManualEditActivity(), onPendingPillClick(), onPendingRollbackClick()] | lang=en
- "src_session_usesession": "useSession()" | kind=code-symbol | source=app/src/session.tsx:L145 | neighbors=[AuthPage.tsx, FeedPage.tsx, ListingPage.tsx, ProfileByHandlePage.tsx, ProfilePage.tsx, SellPage.tsx] | lang=en
- "storage_index": "index.ts" | kind=code-symbol | source=api/src/storage/index.ts:L1 | neighbors=[f4ae77f The lot board: count the pieces…, health.ts, template-routes.ts, config.ts, config, blob-store.ts] | lang=en
- "auth_swa_provider_staticwebappsauthprovider": "StaticWebAppsAuthProvider" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L29 | neighbors=[index.ts, swa-provider.ts, AuthService, .constructor(), .getCurrentUser(), .listDemoAccounts()] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@74942be6ac1d8ed052886d46dfb81a9a879ec0df": "74942be One lot card, and a lot page with four faces" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 89d4620 Ask a new shop how its stock tr…, LotPeople.tsx, fulfilment-routes.ts, LotBoardPage.tsx] | lang=en
- "commit:repo:github.com/swarnavarb/Figmark@8cf0d9bee1e139fcfff68722eb23c54393431f9a": "8cf0d9b Give Figmark a vibrant colour identity" | kind=Commit | source=git | neighbors=[0f35535 Add the Impeccable design skill, claude/figmark-connection-icpfax, claude/new-session-13ackt, 12950fa Give Figmark a typeface, a dens…, CategoryIcon.tsx, FillMeter.tsx] | lang=pt
- "commit:repo:github.com/swarnavarb/Figmark@ced09f4eab2032088d4875c9955cf5b4cfdc014f": "ced09f4 A lot's ladder is the lot's steps; an item's is the whole journey" | kind=Commit | source=git | neighbors=[b36b0b9 Stop the warehouse tick claimin…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 74942be One lot card, and a lot page wi…, fulfilment-routes.ts, template-routes.ts] | lang=en
- "components_icon": "Icon.tsx" | kind=code-symbol | source=app/src/components/Icon.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, Feedback.tsx, FILLED, Icon(), IconName, PATHS] | lang=en
- "scripts_check_queries": "check-queries.mjs" | kind=code-symbol | source=scripts/check-queries.mjs:L1 | neighbors=[7b5199d Filters that fit, tabs that hol…, 8992ccb A fill meter you can join, and …, efdbcff `from` is a reserved word in Co…, all, check(), { code, pieces: allStrings }] | lang=en
- "scripts_live_browser_canceleditingtopicking": "cancelEditingToPicking()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3548 | neighbors=[live-browser.js, clearAnnotations(), disableInlineEdit(), hideAnnotOverlay(), hideBar(), hideHighlight()] | lang=en
- "scripts_live_browser_cleanupacceptedsession": "cleanupAcceptedSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8915 | neighbors=[live-browser.js, clearScrollY(), clearSession(), hideBar(), hideHighlight(), removeVariantStateStylesheet()] | lang=en
- "scripts_live_browser_setpendingapplyloading": "setPendingApplyLoading()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4047 | neighbors=[live-browser.js, handleManualEditActivity(), onPendingPillClick(), clearStoredManualApplyState(), manualApplyLoadingText(), pendingApplyLabel()] | lang=en
- "scripts_live_browser_toggleinsert": "toggleInsert()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11663 | neighbors=[live-browser.js, handleKeyDown(), cancelInsertConfigure(), clearInsertPicking(), hideActionPicker(), hideBar()] | lang=en
- "scripts_live_browser_togglepick": "togglePick()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11635 | neighbors=[live-browser.js, handleKeyDown(), cancelInsertConfigure(), clearInsertPicking(), hideActionPicker(), hideHighlight()] | lang=en
- "scripts_modern_screenshot_umd_k": "k()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, _e(), er(), fe(), jt(), ye()] | lang=en
- "scripts_smoke_auth": "smoke-auth.mjs" | kind=code-symbol | source=scripts/smoke-auth.mjs:L1 | neighbors=[aa99b23 Usernames, shops as the only wa…, d820fb9 The order lifecycle: hold the m…, f1b6577 An operations console, escrow a…, f4ae77f The lot board: count the pieces…, auth, base] | lang=en
- "shared_models_listing": "Listing" | kind=code-symbol | source=shared/models.ts:L374 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, catalog-routes.ts, power-sale.ts] | lang=en
- "components_notifications": "Notifications.tsx" | kind=code-symbol | source=app/src/components/Notifications.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 843b46a +Me, and a bell that tells ever…, Icon.tsx, Icon(), Notifications(), api.ts] | lang=en
- "components_photomanager": "PhotoManager.tsx" | kind=code-symbol | source=app/src/components/PhotoManager.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, a5a184e Orders, Track, and the statione…, Icon.tsx, Icon(), PhotoManager(), shrink()] | lang=en
- "components_tabbar": "TabBar.tsx" | kind=code-symbol | source=app/src/components/TabBar.tsx:L1 | neighbors=[141db1a Routes you can write, and a tra…, 613ff69 Rebuild the sell tab: one door …, 7b5199d Filters that fit, tabs that hol…, 8cf0d9b Give Figmark a vibrant colour i…, aa99b23 Usernames, shops as the only wa…, e492525 A Services tab, and the people …] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-004.json

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
