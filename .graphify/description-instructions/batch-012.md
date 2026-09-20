# Node Description Batch 13 of 55

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
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "scripts_live_browser_restoremixedtextnodemanualedit": "restoreMixedTextNodeManualEdit()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4384 | neighbors=[live-browser.js, restoreDiscardedManualEdits(), directMixedTextRestoreNodes(), normalizeManualContextText(), queryManualEditRef()]
- "scripts_live_browser_restoresessionsupersedinghandledwrapper": "restoreSessionSupersedingHandledWrapper()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9500 | neighbors=[live-browser.js, isSessionHandled(), loadSession(), restoreSessionWithoutWrapper(), resumeSession()]
- "scripts_live_browser_retrymounterrorcard": "retryMountErrorCard()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6105 | neighbors=[live-browser.js, clearMountErrorCard(), injectSvelteComponentsFromManifest(), setLiveState(), showToast()]
- "scripts_live_browser_sanitizedcontextouterhtml": "sanitizedContextOuterHTML()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L962 | neighbors=[live-browser.js, copyEditContainerContext(), copyEditLeafContext(), extractContext(), stripManualEditRuntimeState()]
- "scripts_live_browser_sendcheckpoint": "sendCheckpoint()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7425 | neighbors=[live-browser.js, captureAndEmit(), resumeSession(), checkpointPayload(), sendEvent()]
- "scripts_live_browser_shouldfocussteerchat": "shouldFocusSteerChat()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10046 | neighbors=[live-browser.js, focusSteerChat(), notePagePointerDown(), shouldSteerAutoFocus(), steerFocusLog()]
- "scripts_live_browser_shouldsteerautofocus": "shouldSteerAutoFocus()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10077 | neighbors=[live-browser.js, focusSteerChat(), isPageEditableActive(), shouldFocusSteerChat(), syncPageChatFocus()]
- "scripts_live_browser_showmounterrorcard": "showMountErrorCard()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6001 | neighbors=[live-browser.js, abortSvelteComponentInjection(), injectSvelteComponentsFromManifest(), mountSvelteComponentVariant(), renderMountErrorCard()]
- "scripts_live_browser_startvariantobserver": "startVariantObserver()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6968 | neighbors=[live-browser.js, handleGo(), handleInsertCreate(), restoreSessionWithoutWrapper(), resumeSession()]
- "scripts_live_browser_submitsteermessage": "submitSteerMessage()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10691 | neighbors=[live-browser.js, lockSteerChat(), scheduleSteerAwaitTimeout(), sendEvent(), stopVoice()]
- "scripts_live_browser_syncconfigureinputchrome": "syncConfigureInputChrome()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1262 | neighbors=[live-browser.js, applyConfigureBarChrome(), buildConfigureRow(), buildInsertConfigureRow(), syncVoiceUi()]
- "scripts_live_browser_synccyclingcontrols": "syncCyclingControls()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4986 | neighbors=[live-browser.js, mountSvelteComponentVariant(), cyclingCounterText(), cyclingShownVariant(), saveSession()]
- "scripts_live_browser_syncglobalbarexpandedlabels": "syncGlobalBarExpandedLabels()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9913 | neighbors=[live-browser.js, collapsePageChat(), preparePageChatInputForTyping(), applyGlobalBarLabelState(), updateGlobalBarState()]
- "scripts_live_browser_syncpagechatvisual": "syncPageChatVisual()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9964 | neighbors=[live-browser.js, focusSteerChat(), collapsePageChat(), expandPageChat(), syncPageChatSendButton()]
- "scripts_live_browser_syncvoiceui": "syncVoiceUi()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10515 | neighbors=[live-browser.js, finishVoiceSession(), stopVoice(), syncConfigureInputChrome(), syncPageChatChrome()]
- "scripts_live_browser_teardownsveltecomponentsession": "teardownSvelteComponentSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5716 | neighbors=[live-browser.js, abortSvelteComponentInjection(), cleanup(), resetSvelteComponentSession(), removeSvelteComponentVariantStyle()]
- "scripts_live_browser_toggleactionpicker": "toggleActionPicker()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2995 | neighbors=[live-browser.js, barPaletteForTheme(), detectPageTheme(), hideActionPicker(), showManualApplyBusyToast()]
- "scripts_live_browser_toggledesignpanel": "toggleDesignPanel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12211 | neighbors=[live-browser.js, fetchDesignSystem(), renderDesignChrome(), showManualApplyBusyToast(), updateGlobalBarState()]
- "scripts_live_browser_toggledetect": "toggleDetect()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11612 | neighbors=[live-browser.js, loadDetectScript(), requestDetectScan(), showManualApplyBusyToast(), updateGlobalBarState()]
- "scripts_live_browser_updatemanualapplyprogressfromchunk": "updateManualApplyProgressFromChunk()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3970 | neighbors=[live-browser.js, handleManualEditActivity(), readStoredManualApplyState(), setPendingApplyLoading(), storeManualApplyState()]
- "scripts_live_browser_updateselectedelement": "updateSelectedElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6587 | neighbors=[live-browser.js, showVariantInDOM(), findVariantsWrapper(), pickVariantContent(), resolveSvelteComponentAnchor()]
- "scripts_modern_screenshot_umd_ae": "ae()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, P(), W(), jt(), x()]
- "scripts_modern_screenshot_umd_yt": "yt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, q(), bt(), fe(), L()]
- "scripts_provision_cosmos": "provision-cosmos.mjs" | kind=code-symbol | source=scripts/provision-cosmos.mjs:L1 | neighbors=[b269064 Create missing Cosmos container…, f4ae77f The lot board: count the pieces…, { CosmosClient }, loadSettings(), require]
- "shared_board_countof": "countOf()" | kind=code-symbol | source=shared/board.ts:L84 | neighbors=[LotPeople.tsx, ServicesPage.tsx, ShopPage.tsx, SupplierPage.tsx, board.ts]
- "shared_board_tally": "tally()" | kind=code-symbol | source=shared/board.ts:L62 | neighbors=[fulfilment-routes.ts, service-routes.ts, board.ts, byCustomer(), countCheckpoints()]
- "shared_contracts_authmode": "AuthMode" | kind=code-symbol | source=shared/contracts.ts:L90 | neighbors=[mock-provider.ts, swa-provider.ts, types.ts, contracts.ts, config.ts]
- "shared_contracts_healthresponse": "HealthResponse" | kind=code-symbol | source=shared/contracts.ts:L95 | neighbors=[api.ts, main.tsx, health.ts, contracts.ts, api.ts]
- "shared_contracts_loginrequest": "LoginRequest" | kind=code-symbol | source=shared/contracts.ts:L60 | neighbors=[mock-provider.ts, swa-provider.ts, types.ts, auth-routes.ts, contracts.ts]
- "shared_contracts_loginresponse": "LoginResponse" | kind=code-symbol | source=shared/contracts.ts:L75 | neighbors=[mock-provider.ts, swa-provider.ts, types.ts, contracts.ts, api.ts]
- "shared_enums_capability": "Capability" | kind=code-symbol | source=shared/enums.ts:L19 | neighbors=[mock-provider.ts, swa-provider.ts, types.ts, capabilities.ts, enums.ts]
- "shared_enums_dispute_outcomes": "DISPUTE_OUTCOMES" | kind=code-symbol | source=shared/enums.ts:L158 | neighbors=[DisputesView.tsx, admin-routes.ts, dispute-routes.ts, EscrowPage.tsx, enums.ts]
- "shared_enums_dispute_reason_labels": "DISPUTE_REASON_LABELS" | kind=code-symbol | source=shared/enums.ts:L194 | neighbors=[DisputesView.tsx, DisputePage.tsx, EscrowPage.tsx, OrderPage.tsx, enums.ts]
- "shared_enums_disputeoutcome": "DisputeOutcome" | kind=code-symbol | source=shared/enums.ts:L159 | neighbors=[admin-routes.ts, dispute-routes.ts, disputes.ts, enums.ts, models.ts]
- "shared_fulfilment_awaitinglot": "awaitingLot()" | kind=code-symbol | source=shared/fulfilment.ts:L39 | neighbors=[fulfilment-routes.ts, seller-routes.ts, fulfilment.ts, inLot(), stagesFor()]
- "shared_fulfilment_isdirect": "isDirect()" | kind=code-symbol | source=shared/fulfilment.ts:L34 | neighbors=[seller-routes.ts, template-routes.ts, fulfilment.ts, inLot(), stagesFor()]
- "shared_fulfilment_islotevent": "isLotEvent()" | kind=code-symbol | source=shared/fulfilment.ts:L140 | neighbors=[Ladder.tsx, OrderPage.tsx, fulfilment.ts, kindOf(), lotOf()]
- "shared_insights_packingestimate": "packingEstimate()" | kind=code-symbol | source=shared/insights.ts:L99 | neighbors=[insight-routes.ts, insights.ts, aggregateBox(), groupByBuyer(), live()]
- "shared_models_escrowrights": "EscrowRights" | kind=code-symbol | source=shared/models.ts:L267 | neighbors=[api.ts, admin-routes.ts, contracts.ts, models.ts, api.ts]
- "shared_models_follow": "Follow" | kind=code-symbol | source=shared/models.ts:L561 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, models.ts, BaseDocument]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-012.json

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
