# Node Description Batch 17 of 55

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

- "scripts_live_browser_parsevariantparams": "parseVariantParams()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3164 | neighbors=[live-browser.js, buildCyclingRow(), openTunePopover(), refreshParamsPanel()]
- "scripts_live_browser_pendingapplylabel": "pendingApplyLabel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3872 | neighbors=[live-browser.js, hidePendingApplyDock(), setPendingApplyLoading(), updatePendingCounter()]
- "scripts_live_browser_positionannotoverlay": "positionAnnotOverlay()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L536 | neighbors=[live-browser.js, applyPlaceholderDimensions(), syncPlaceholderResizeHandles(), showAnnotOverlay()]
- "scripts_live_browser_probepreviewtree": "probePreviewTree()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5271 | neighbors=[live-browser.js, describeMountFailure(), componentModuleCandidates(), importFirstReachable()]
- "scripts_live_browser_readvisiblevariantfromdom": "readVisibleVariantFromDOM()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6600 | neighbors=[live-browser.js, handleAccept(), findVariantsWrapper(), isVariantShown()]
- "scripts_live_browser_recovermissedgenerationcompletion": "recoverMissedGenerationCompletion()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9181 | neighbors=[live-browser.js, isFrameworkComponentPreviewMode(), isTerminalSessionSummary(), rememberSessionFileMeta()]
- "scripts_live_browser_redrawstrokes": "redrawStrokes()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L560 | neighbors=[live-browser.js, onAnnotDown(), onAnnotUp(), updateClearChip()]
- "scripts_live_browser_reloadaftermissingaccepteddom": "reloadAfterMissingAcceptedDom()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8908 | neighbors=[live-browser.js, acceptedDomAlreadyClean(), deferredRecoverySuperseded(), restoreAcceptedDomFromSnapshot()]
- "scripts_live_browser_remainingmanualeditcount": "remainingManualEditCount()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4262 | neighbors=[live-browser.js, handleManualEditActivity(), onPendingPillClick(), numberOrNull()]
- "scripts_live_browser_removeconfigureselection": "removeConfigureSelection()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1475 | neighbors=[live-browser.js, cancelInsertConfigure(), exitConfigureToPicking(), hideConfigureBarTooltip()]
- "scripts_live_browser_removesveltecomponentvariantstyle": "removeSvelteComponentVariantStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5324 | neighbors=[live-browser.js, commitAcceptedSvelteComponentToDom(), mountSvelteComponentVariant(), teardownSvelteComponentSession()]
- "scripts_live_browser_renderdosdontscollapsible": "renderDosDontsCollapsible()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12737 | neighbors=[live-browser.js, renderDesignVisual(), buildCollapsible(), inlineMd()]
- "scripts_live_browser_rendermarkdown": "renderMarkdown()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12809 | neighbors=[live-browser.js, escapeHtml(), inlineMd(), renderRawTab()]
- "scripts_live_browser_renderoverviewcollapsible": "renderOverviewCollapsible()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12758 | neighbors=[live-browser.js, renderDesignVisual(), buildCollapsible(), inlineMd()]
- "scripts_live_browser_renderrulescollapsible": "renderRulesCollapsible()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12719 | neighbors=[live-browser.js, renderDesignVisual(), buildCollapsible(), escapeHtml()]
- "scripts_live_browser_rendertypetiles": "renderTypeTiles()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12496 | neighbors=[live-browser.js, renderDesignVisual(), escapeHtml(), fontStack()]
- "scripts_live_browser_reportvariantmountfailed": "reportVariantMountFailed()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5971 | neighbors=[live-browser.js, injectSvelteComponentsFromManifest(), mountSvelteComponentVariant(), sendEvent()]
- "scripts_live_browser_resetmanualapplyprogress": "resetManualApplyProgress()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3957 | neighbors=[live-browser.js, handleManualEditActivity(), onPendingPillClick(), writeManualApplyState()]
- "scripts_live_browser_restoreaccepteddomfromsnapshot": "restoreAcceptedDomFromSnapshot()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8886 | neighbors=[live-browser.js, ensureAcceptedDomClean(), acceptedDomAlreadyClean(), reloadAfterMissingAcceptedDom()]
- "scripts_live_browser_restorefromactivesessions": "restoreFromActiveSessions()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9165 | neighbors=[live-browser.js, findAnyVariantsWrapper(), isFrameworkComponentPreviewMode(), restoreSessionWithoutWrapper()]
- "scripts_live_browser_restoreinlineeditdrafts": "restoreInlineEditDrafts()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3531 | neighbors=[live-browser.js, cancelEditing(), cancelEditingToPicking(), hideBar()]
- "scripts_live_browser_saveinteractionprefs": "saveInteractionPrefs()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9733 | neighbors=[live-browser.js, savePickPref(), toggleInsert(), togglePick()]
- "scripts_live_browser_schedulependingdockposition": "schedulePendingDockPosition()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3822 | neighbors=[live-browser.js, setPendingApplyLoading(), showManualApplyDecision(), updatePendingCounter()]
- "scripts_live_browser_scopecssblock": "scopeCssBlock()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5331 | neighbors=[live-browser.js, findMatchingCssBrace(), prefixCssSelectors(), shouldScopeNestedCssAtRule()]
- "scripts_live_browser_showparamspanel": "showParamsPanel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4848 | neighbors=[live-browser.js, openTunePopover(), refreshParamsPanel(), positionParamsPanel()]
- "scripts_live_browser_snapshotacceptedvariantdom": "snapshotAcceptedVariantDom()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8810 | neighbors=[live-browser.js, handleAccept(), findVariantsWrapper(), selectorForAcceptedRoot()]
- "scripts_live_browser_steerqueuedbehindgeneration": "steerQueuedBehindGeneration()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10002 | neighbors=[live-browser.js, agentHasWorkInFlight(), steerTimeoutMessage(), syncSteerQueueHint()]
- "scripts_live_browser_stripmanualeditruntimestate": "stripManualEditRuntimeState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L939 | neighbors=[live-browser.js, handleGo(), sanitizedContextOuterHTML(), unwrapMixedContentTextNodes()]
- "scripts_live_browser_syncpagechatsendbutton": "syncPageChatSendButton()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9980 | neighbors=[live-browser.js, syncPageChatFocusRing(), pageChatPalette(), syncPageChatVisual()]
- "scripts_live_browser_toggleconfigurevoice": "toggleConfigureVoice()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10682 | neighbors=[live-browser.js, configureVoiceContext(), startVoice(), stopVoice()]
- "scripts_live_browser_togglesteervoice": "toggleSteerVoice()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10673 | neighbors=[live-browser.js, startVoice(), steerVoiceContext(), stopVoice()]
- "scripts_live_browser_toggletunepopover": "toggleTunePopover()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4931 | neighbors=[live-browser.js, closeTunePopover(), openTunePopover(), showManualApplyBusyToast()]
- "scripts_live_browser_updateclearchip": "updateClearChip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L512 | neighbors=[live-browser.js, clearAnnotations(), redrawStrokes(), renderAllPins()]
- "scripts_live_browser_usesshadowchromeroot": "usesShadowChromeRoot()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4493 | neighbors=[live-browser.js, editBadgeProxyTargets(), initEditBadgeHitProxies(), syncEditBadgeHitProxies()]
- "scripts_live_browser_writemanualapplystate": "writeManualApplyState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3899 | neighbors=[live-browser.js, resetManualApplyProgress(), storeManualApplyState(), manualApplyStateKey()]
- "scripts_modern_screenshot_umd_ct": "Ct()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, L(), Se(), Tt()]
- "scripts_modern_screenshot_umd_l": "L()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, Ct(), me(), yt()]
- "scripts_modern_screenshot_umd_qt": "qt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, _e(), k(), x()]
- "scripts_modern_screenshot_umd_re": "Re()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, Ie(), Lt(), z()]
- "scripts_modern_screenshot_umd_rt": "Rt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, ne(), Ce(), Ee()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-016.json

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
