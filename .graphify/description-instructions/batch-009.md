# Node Description Batch 10 of 55

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

- "data_repository_repository": "Repository" | kind=code-symbol | source=api/src/data/repository.ts:L75 | neighbors=[mock-provider.ts, swa-provider.ts, cosmos-repository.ts, index.ts, memory-repository.ts, repository.ts]
- "data_seed_forwarder": "forwarder()" | kind=code-symbol | source=api/src/data/seed.ts:L381 | neighbors=[seed.ts, iso(), sellerTrust(), trust(), verification(), seedUsers()]
- "data_seed_handler": "handler()" | kind=code-symbol | source=api/src/data/seed.ts:L346 | neighbors=[seed.ts, iso(), sellerTrust(), trust(), verification(), seedUsers()]
- "data_seed_sellertrust": "sellerTrust()" | kind=code-symbol | source=api/src/data/seed.ts:L103 | neighbors=[seed.ts, forwarder(), handler(), seedUsers(), trust(), storefront()]
- "data_seed_storefront": "storefront()" | kind=code-symbol | source=api/src/data/seed.ts:L289 | neighbors=[seed.ts, seedUsers(), iso(), sellerTrust(), trust(), verification()]
- "functions_dispute_routes_settledispute": "settleDispute()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L134 | neighbors=[admin-routes.ts, dispute-routes.ts, accept(), settleAsEscrow(), note(), withdraw()]
- "functions_order_routes_note": "note()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L58 | neighbors=[order-routes.ts, claimPayment(), pay(), rejectOrder(), release(), settleClaim()]
- "functions_power_sale_routes_shopfor": "shopFor()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L31 | neighbors=[power-sale-routes.ts, create(), list(), read(), bodyStore(), stop()]
- "scripts_check_swa_config": "check-swa-config.mjs" | kind=code-symbol | source=scripts/check-swa-config.mjs:L1 | neighbors=[d7cd6b4 A "comment" key took the operat…, check(), NAVIGATION_FALLBACK, path, ROUTE, TOP_LEVEL]
- "scripts_live_browser_applyplaceholderdimensions": "applyPlaceholderDimensions()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2167 | neighbors=[live-browser.js, materializePlaceholderWidth(), positionAnnotOverlay(), positionBar(), ensureInsertPlaceholder(), onAnnotMove()]
- "scripts_live_browser_buildconfigureactioncontrol": "buildConfigureActionControl()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1563 | neighbors=[live-browser.js, actionLabel(), bindConfigureInlineControlHover(), configureInlineControlStyle(), el(), buildConfigureRow()]
- "scripts_live_browser_buildsvelteexpressiontextmap": "buildSvelteExpressionTextMap()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6471 | neighbors=[live-browser.js, collectTextNodes(), expressionTextMatcher(), normalizePreviewText(), buildSveltePropValuesFromLiveElement(), buildSveltePropValuesV2()]
- "scripts_live_browser_clearsession": "clearSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9243 | neighbors=[live-browser.js, cleanup(), cleanupAcceptedSession(), loadSession(), resetSvelteComponentSession(), resumeSession()]
- "scripts_live_browser_clearstoredmanualapplystate": "clearStoredManualApplyState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3928 | neighbors=[live-browser.js, manualApplyStateKey(), handleManualEditActivity(), hidePendingApplyDock(), onPendingRollbackClick(), setPendingApplyLoading()]
- "scripts_live_browser_deferredrecoverysuperseded": "deferredRecoverySuperseded()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2051 | neighbors=[live-browser.js, cleanup(), ensureAcceptedDomClean(), reloadAfterMissingAcceptedDom(), scheduleAcceptCleanup(), scheduleHandledRuntimeWrapperReload()]
- "scripts_live_browser_ensureaccepteddomclean": "ensureAcceptedDomClean()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8838 | neighbors=[live-browser.js, acceptedDomAlreadyClean(), deferredRecoverySuperseded(), findAcceptedRuntimeWrappers(), restoreAcceptedDomFromSnapshot(), scheduleAcceptCleanup()]
- "scripts_live_browser_ensureagentpolltooltip": "ensureAgentPollTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11008 | neighbors=[live-browser.js, agentStatusText(), barPaletteForTheme(), detectPageTheme(), el(), showAgentPollTooltip()]
- "scripts_live_browser_expandpagechat": "expandPageChat()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10736 | neighbors=[live-browser.js, focusPageChatInput(), preparePageChatInputForTyping(), syncPageChatChrome(), syncPageChatFocusRing(), syncPageChatVisual()]
- "scripts_live_browser_finalizeeditingpin": "finalizeEditingPin()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L871 | neighbors=[live-browser.js, renderAllPins(), handleGo(), handleInsertCreate(), onAnnotDown(), onAnnotInputKey()]
- "scripts_live_browser_findliveelementfororiginalmarkup": "findLiveElementForOriginalMarkup()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5105 | neighbors=[live-browser.js, elementMatchesOriginalMarkup(), isUsableInjectionAnchor(), normalizeElementClassName(), parseOriginalMarkupElement(), resolveLiveInjectionAnchor()]
- "scripts_live_browser_focuspagechatinput": "focusPageChatInput()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10348 | neighbors=[live-browser.js, armPageChatForTyping(), expandPageChat(), preparePageChatInputForTyping(), syncPageChatFocusRing(), unlockSteerChat()]
- "scripts_live_browser_getvisiblevariantel": "getVisibleVariantEl()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3152 | neighbors=[live-browser.js, buildCyclingRow(), findVariantsWrapper(), resolveSvelteComponentAnchor(), openTunePopover(), refreshParamsPanel()]
- "scripts_live_browser_hidependingapplydock": "hidePendingApplyDock()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4015 | neighbors=[live-browser.js, clearStoredManualApplyState(), pendingApplyLabel(), refreshLiveControlsForManualApply(), onPendingPillClick(), updatePendingCounter()]
- "scripts_live_browser_inlinemd": "inlineMd()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12898 | neighbors=[live-browser.js, highlightBold(), escapeHtml(), renderDosDontsCollapsible(), renderMarkdown(), renderOverviewCollapsible()]
- "scripts_live_browser_maybecompleteacceptedsession": "maybeCompleteAcceptedSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8765 | neighbors=[live-browser.js, commitAcceptedSvelteComponentToDom(), markSessionHandled(), scheduleAcceptCleanup(), setLiveState(), updateBarContent()]
- "scripts_live_browser_normalizemanualcontexttext": "normalizeManualContextText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1074 | neighbors=[live-browser.js, addManualContextText(), canRestoreManualEditElement(), findManualEditRestoreElement(), nearbyEditableTextsForManualEdit(), restoreMixedTextNodeManualEdit()]
- "scripts_live_browser_numberornull": "numberOrNull()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4257 | neighbors=[live-browser.js, handleManualEditActivity(), onPendingKeepFixingClick(), onPendingRollbackClick(), remainingManualEditCount(), showManualApplyDecision()]
- "scripts_live_browser_onannotmove": "onAnnotMove()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L671 | neighbors=[live-browser.js, applyPlaceholderDimensions(), localCoords(), pointsToPath(), renderAllPins(), resizePlaceholderFromEdge()]
- "scripts_live_browser_onpendingkeepfixingclick": "onPendingKeepFixingClick()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4210 | neighbors=[live-browser.js, numberOrNull(), readStoredManualApplyState(), showManualApplyDecision(), showToast(), updateManualApplyRepairState()]
- "scripts_live_browser_pagechatexpandedwidth": "pageChatExpandedWidth()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9927 | neighbors=[live-browser.js, pageChatCollapsedWidthPx(), preparePageChatInputForTyping(), syncPageChatExpandedWidth(), syncSteerQueueHint(), unlockSteerChat()]
- "scripts_live_browser_parseoriginalmarkupelement": "parseOriginalMarkupElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5025 | neighbors=[live-browser.js, applyOriginalAttrsToSvelteAnchor(), buildSveltePropValuesFromLiveElement(), buildSveltePropValuesV2(), findLiveElementForOriginalMarkup(), resolveLiveInjectionAnchor()]
- "scripts_live_browser_positionbar": "positionBar()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1117 | neighbors=[live-browser.js, applyPlaceholderDimensions(), completeSourceInjection(), injectSvelteComponentsFromManifest(), resolveBarAnchor(), showBar()]
- "scripts_live_browser_positionparamspanel": "positionParamsPanel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4816 | neighbors=[live-browser.js, closedClipPath(), popoverDirection(), setClipPath(), refreshParamsPanel(), showParamsPanel()]
- "scripts_live_browser_removevariantstatestylesheet": "removeVariantStateStylesheet()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6692 | neighbors=[live-browser.js, abortSvelteComponentInjection(), cleanup(), cleanupAcceptedSession(), resetSvelteComponentSession(), teardown()]
- "scripts_live_browser_renderdesignchrome": "renderDesignChrome()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12153 | neighbors=[live-browser.js, fetchDesignSystem(), initDesignPanel(), buildDesignHeader(), renderDesignBody(), toggleDesignPanel()]
- "scripts_live_browser_resetsessionfilemeta": "resetSessionFileMeta()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8981 | neighbors=[live-browser.js, cleanup(), cleanupAcceptedSession(), handleGo(), handleInsertCreate(), resetSvelteComponentSession()]
- "scripts_live_browser_resolvesveltecomponentanchor": "resolveSvelteComponentAnchor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3146 | neighbors=[live-browser.js, getVisibleVariantEl(), resolveBarAnchor(), getMountedSvelteComponentAnchor(), resumeSession(), updateSelectedElement()]
- "scripts_live_browser_showhighlight": "showHighlight()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L372 | neighbors=[live-browser.js, handleClick(), handleKeyDown(), handleMouseMove(), hideHighlightTagTooltip(), shouldShowHighlightTagTooltip()]
- "scripts_live_browser_showshaderoverlay": "showShaderOverlay()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8570 | neighbors=[live-browser.js, captureAndEmit(), compileShader(), hideShaderOverlay(), resolvePaperRgb(), showShaderBitmapFallback()]
- "scripts_live_browser_startscrolllock": "startScrollLock()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6798 | neighbors=[live-browser.js, handleGo(), handleInsertCreate(), resumeSession(), resolveScrollLockAnchorTop(), stopScrollLock()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-009.json

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
