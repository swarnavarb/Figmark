# Node Description Batch 7 of 55

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

- "scripts_live_browser_syncinsertcreatebutton": "syncInsertCreateButton()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2349 | neighbors=[live-browser.js, buildInsertConfigureRow(), onAnnotUp(), showBar(), canCreateInsert(), hideInsertCreateTooltip()]
- "scripts_live_browser_syncpagechatchrome": "syncPageChatChrome()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9942 | neighbors=[live-browser.js, armPageChatForTyping(), collapsePageChat(), expandPageChat(), focusSteerChat(), lockSteerChat()]
- "scripts_live_browser_syncpagechatfocusring": "syncPageChatFocusRing()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10213 | neighbors=[live-browser.js, armPageChatForTyping(), collapsePageChat(), expandPageChat(), focusPageChatInput(), focusSteerChat()]
- "scripts_live_browser_teardown": "teardown()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11717 | neighbors=[live-browser.js, cleanup(), clearSteerFocusRecoverTimer(), hideAgentPollTooltip(), hideBar(), removeVariantStateStylesheet()]
- "scripts_live_browser_teardownconfigurechrome": "teardownConfigureChrome()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3562 | neighbors=[live-browser.js, exitConfigureToPicking(), clearAnnotations(), hideAnnotOverlay(), hideBar(), hideConfigureBarTooltip()]
- "scripts_modern_screenshot_umd_ne": "ne()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, _e(), It(), Rt(), _t(), Tt()]
- "shared_contracts_demoaccount": "DemoAccount" | kind=code-symbol | source=shared/contracts.ts:L140 | neighbors=[mock-provider.ts, swa-provider.ts, types.ts, cosmos-repository.ts, memory-repository.ts, repository.ts]
- "shared_enums_condition_tags": "CONDITION_TAGS" | kind=code-symbol | source=shared/enums.ts:L38 | neighbors=[PowerSale.tsx, power-sale-routes.ts, template-routes.ts, want-routes.ts, FeedPage.tsx, SellPage.tsx]
- "shared_routes_routeof": "routeOf()" | kind=code-symbol | source=shared/routes.ts:L457 | neighbors=[fulfilment-routes.ts, seller-routes.ts, template-routes.ts, tracking-routes.ts, ShopPage.tsx, routes.ts]
- "shared_routes_routestep": "RouteStep" | kind=code-symbol | source=shared/routes.ts:L73 | neighbors=[Ladder.tsx, RouteBuilder.tsx, tracking-routes.ts, LotsPage.tsx, RoutesPage.tsx, SellPage.tsx]
- "shared_templates_posttemplate": "PostTemplate" | kind=code-symbol | source=shared/templates.ts:L19 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, template-routes.ts, SellPage.tsx, ShopPage.tsx]
- "src_format_formatdate": "formatDate()" | kind=code-symbol | source=app/src/format.ts:L14 | neighbors=[UsersView.tsx, FillMeter.tsx, ListingPage.tsx, LotsPage.tsx, OrderPage.tsx, ProfileByHandlePage.tsx]
- "storage_blob_store_blobphotostore": "BlobPhotoStore" | kind=code-symbol | source=api/src/storage/blob-store.ts:L10 | neighbors=[blob-store.ts, .constructor(), .init(), .read(), .status(), .upload()]
- "commit:repo:github.com/swarnavarb/Figmark@29bd1784759622e0d0ef5e2052c6326052b3e6ce": "29bd178 The Functions host keeps /admin for itself, so those eight routes never…" | kind=Commit | source=git | neighbors=[api.ts, claude/figmark-connection-icpfax, claude/new-session-13ackt, 4484666 Buying is two transactions, not…, admin-routes.ts, check-routes.mjs]
- "commit:repo:github.com/swarnavarb/Figmark@44f8ea38ddc966e2a7a6a135f8565d288b6838ab": "44f8ea3 Label the warehouse toggle, and call a batch by its name" | kind=Commit | source=git | neighbors=[12950fa Give Figmark a typeface, a dens…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 344cea2 One tracking ladder, and a batc…, fulfilment-routes.ts, LotBoardPage.tsx]
- "components_ui_personlink": "PersonLink()" | kind=code-symbol | source=app/src/components/ui.tsx:L228 | neighbors=[ui.tsx, DisputePage.tsx, EscrowPage.tsx, ListingPage.tsx, OrderPage.tsx, ProfileByHandlePage.tsx]
- "components_ui_thumb": "Thumb()" | kind=code-symbol | source=app/src/components/ui.tsx:L30 | neighbors=[ui.tsx, FeedPage.tsx, ListingPage.tsx, ProfileByHandlePage.tsx, ProfilePage.tsx, SellPage.tsx]
- "data_cosmos_repository_cosmosrepository_backfillhandles": ".backfillHandles()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L255 | neighbors=[CosmosRepository, .existingIds(), .freeHandle(), .listAllUsers(), .reserveHandle(), .updateUser()]
- "functions_dispute_routes_owndispute": "ownDispute()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L55 | neighbors=[dispute-routes.ts, accept(), escalate(), offer(), read(), reply()]
- "functions_notify_notify": "notify()" | kind=code-symbol | source=api/src/functions/notify.ts:L35 | neighbors=[dispute-routes.ts, fulfilment-routes.ts, notify.ts, order-routes.ts, power-sale.ts, preorder.ts]
- "scripts_live_browser_buildselectionpill": "buildSelectionPill()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1485 | neighbors=[live-browser.js, buildConfigureRow(), buildInsertConfigureRow(), configureBarPalette(), configureSelectionPillStyle(), el()]
- "scripts_live_browser_configurebarpalette": "configureBarPalette()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1276 | neighbors=[live-browser.js, buildSelectionPill(), barPaletteForTheme(), detectPageTheme(), configureInlineControlStyle(), configureModifierPillStyle()]
- "scripts_live_browser_ensureinsertplaceholder": "ensureInsertPlaceholder()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2139 | neighbors=[live-browser.js, applyPlaceholderDimensions(), createInsertPlaceholder(), findInsertAnchorInDom(), findVariantsWrapper(), isInsertGeneratingSession()]
- "scripts_live_browser_enterrecoverywaitingforanchor": "enterRecoveryWaitingForAnchor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5205 | neighbors=[live-browser.js, queueCheckpoint(), saveSession(), setLiveState(), showBar(), startScrollTracking()]
- "scripts_live_browser_exitconfiguretopicking": "exitConfigureToPicking()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3573 | neighbors=[live-browser.js, hideHighlight(), setLiveState(), syncPageChatFocus(), teardownConfigureChrome(), handleClick()]
- "scripts_live_browser_handlemousemove": "handleMouseMove()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7458 | neighbors=[live-browser.js, detectInsertAxis(), hideInsertLine(), layoutFlowChildren(), resolveInsertHover(), showHighlight()]
- "scripts_live_browser_hideactionpicker": "hideActionPicker()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3024 | neighbors=[live-browser.js, handleClick(), handleKeyDown(), hideBar(), refreshLiveControlsForManualApply(), toggleActionPicker()]
- "scripts_live_browser_initdesignpanel": "initDesignPanel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11828 | neighbors=[live-browser.js, init(), barPaletteForTheme(), designPanelCss(), detectPageTheme(), fetchDesignSystem()]
- "scripts_live_browser_locksteerchat": "lockSteerChat()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10391 | neighbors=[live-browser.js, buildSteerProcessingDots(), preparePageChatInputForTyping(), stopVoice(), syncPageChatChrome(), syncPageChatFocusRing()]
- "scripts_live_browser_opentunepopover": "openTunePopover()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4937 | neighbors=[live-browser.js, applyParamDefaults(), buildParamsPanel(), getVisibleVariantEl(), parseVariantParams(), showOrUpdateCyclingBar()]
- "scripts_live_browser_readstoredmanualapplystate": "readStoredManualApplyState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3884 | neighbors=[live-browser.js, manualApplyLoadingText(), onPendingKeepFixingClick(), manualApplyStateKey(), shouldResumeManualApplyLoading(), storeManualApplyState()]
- "scripts_live_browser_remembersessionfilemeta": "rememberSessionFileMeta()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8990 | neighbors=[live-browser.js, applySavedSessionMeta(), injectSvelteComponentsFromManifest(), injectVariantsFromSource(), recoverMissedGenerationCompletion(), isFrameworkComponentPreviewMode()]
- "scripts_live_browser_renderdesignbody": "renderDesignBody()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12247 | neighbors=[live-browser.js, fetchDesignSystem(), msgDiv(), renderDesignVisual(), renderParsedMdCta(), renderRawTab()]
- "scripts_live_browser_resolvebaranchor": "resolveBarAnchor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2057 | neighbors=[live-browser.js, positionBar(), positionShaderOverlay(), ensureInsertPlaceholder(), findVariantsWrapper(), pickVariantContent()]
- "scripts_live_browser_resolveliveinjectionanchor": "resolveLiveInjectionAnchor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5145 | neighbors=[live-browser.js, findLiveElementForSvelteManifest(), elementMatchesOriginalMarkup(), findLiveElementForOriginalMarkup(), findLiveElementFromAnchorSnapshot(), isUsableInjectionAnchor()]
- "scripts_live_browser_scheduleacceptcleanup": "scheduleAcceptCleanup()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8784 | neighbors=[live-browser.js, maybeCompleteAcceptedSession(), acceptedDomAlreadyClean(), cleanupAcceptedSession(), commitAcceptedSvelteComponentToDom(), deferredRecoverySuperseded()]
- "scripts_live_browser_showorupdatecyclingbar": "showOrUpdateCyclingBar()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2179 | neighbors=[live-browser.js, closeTunePopover(), completeParameterPublication(), completeSourceInjection(), injectSvelteComponentsFromManifest(), openTunePopover()]
- "scripts_live_browser_steerfocuslog": "steerFocusLog()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10170 | neighbors=[live-browser.js, focusConfigureInput(), focusSteerChat(), initPageChat(), shouldFocusSteerChat(), steerFocusDebugEnabled()]
- "scripts_live_browser_synceditbadgehitproxies": "syncEditBadgeHitProxies()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4614 | neighbors=[live-browser.js, positionEditBadge(), renderEditBadge(), bindEditBadgeProxy(), editBadgeProxyTargets(), initEditBadgeHitProxies()]
- "scripts_live_browser_syncpageinteractioncursor": "syncPageInteractionCursor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2022 | neighbors=[live-browser.js, handleMouseMove(), hideInsertLine(), init(), setLiveState(), cursorForInsertAxis()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-006.json

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
