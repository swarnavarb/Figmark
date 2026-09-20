# Node Description Batch 12 of 55

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

- "scripts_live_browser_agentstatustext": "agentStatusText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10979 | neighbors=[live-browser.js, agentHasWorkInFlight(), ensureAgentPollTooltip(), showAgentPollTooltip(), syncAgentPollingUi()]
- "scripts_live_browser_armpagechatfortyping": "armPageChatForTyping()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10334 | neighbors=[live-browser.js, focusPageChatInput(), preparePageChatInputForTyping(), syncPageChatChrome(), syncPageChatFocusRing()]
- "scripts_live_browser_buildcollapsible": "buildCollapsible()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12694 | neighbors=[live-browser.js, escapeHtml(), renderDosDontsCollapsible(), renderOverviewCollapsible(), renderRulesCollapsible()]
- "scripts_live_browser_buildsveltepropvaluesfromliveelement": "buildSveltePropValuesFromLiveElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5435 | neighbors=[live-browser.js, buildSvelteExpressionTextMap(), buildSveltePropValuesV2(), parseOriginalMarkupElement(), injectSvelteComponentsFromManifest()]
- "scripts_live_browser_collapsepagechat": "collapsePageChat()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10745 | neighbors=[live-browser.js, syncGlobalBarExpandedLabels(), syncPageChatChrome(), syncPageChatFocusRing(), syncPageChatVisual()]
- "scripts_live_browser_componentmodulecandidates": "componentModuleCandidates()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5238 | neighbors=[live-browser.js, detectDevServerBase(), loadSvelteRuntime(), mountSvelteComponentVariant(), probePreviewTree()]
- "scripts_live_browser_configureinlinecontrolstyle": "configureInlineControlStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1352 | neighbors=[live-browser.js, buildConfigureActionControl(), buildConfigureCountControl(), configureBarPalette(), configureRowTextMetrics()]
- "scripts_live_browser_configurerowtextmetrics": "configureRowTextMetrics()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1280 | neighbors=[live-browser.js, configureInlineControlStyle(), configureInputFieldStyle(), configureModifierPillStyle(), configureSelectionPillStyle()]
- "scripts_live_browser_discardorphanedsession": "discardOrphanedSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6206 | neighbors=[live-browser.js, cleanup(), markSessionHandled(), sendEvent(), showToast()]
- "scripts_live_browser_documentrefsegment": "documentRefSegment()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3653 | neighbors=[live-browser.js, documentRefForElement(), documentRefClassSuffix(), documentRefIdSuffix(), indexAmongSameTag()]
- "scripts_live_browser_elementmatchesoriginalmarkup": "elementMatchesOriginalMarkup()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5061 | neighbors=[live-browser.js, isUsableInjectionAnchor(), normalizeElementClassName(), findLiveElementForOriginalMarkup(), resolveLiveInjectionAnchor()]
- "scripts_live_browser_ensurecyclingrenderable": "ensureCyclingRenderable()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3031 | neighbors=[live-browser.js, buildCyclingRow(), recoverEmptyCycling(), showBar(), updateBarContent()]
- "scripts_live_browser_extractcontext": "extractContext()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L969 | neighbors=[live-browser.js, applyEditing(), sanitizedContextOuterHTML(), handleGo(), handleInsertCreate()]
- "scripts_live_browser_fetchdesignsystem": "fetchDesignSystem()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12221 | neighbors=[live-browser.js, renderDesignBody(), renderDesignChrome(), initDesignPanel(), toggleDesignPanel()]
- "scripts_live_browser_finalizeinsertsession": "finalizeInsertSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2092 | neighbors=[live-browser.js, cleanup(), clearInsertPicking(), removeInsertPlaceholderDom(), resumeSession()]
- "scripts_live_browser_findliveelementforsveltemanifest": "findLiveElementForSvelteManifest()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5173 | neighbors=[live-browser.js, findInsertAnchorInDom(), isSvelteInsertManifest(), resolveLiveInjectionAnchor(), injectSvelteComponentsFromManifest()]
- "scripts_live_browser_hideconfigurebartooltip": "hideConfigureBarTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1442 | neighbors=[live-browser.js, hideBar(), removeConfigureSelection(), renderEditBadge(), teardownConfigureChrome()]
- "scripts_live_browser_hideinsertline": "hideInsertLine()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1982 | neighbors=[live-browser.js, clearInsertPicking(), handleClick(), handleMouseMove(), syncPageInteractionCursor()]
- "scripts_live_browser_hideparamspanel": "hideParamsPanel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4858 | neighbors=[live-browser.js, closeTunePopover(), closedClipPath(), setClipPath(), refreshParamsPanel()]
- "scripts_live_browser_ignores_resolvedetectignores": "resolveDetectIgnores()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-ignores.js:L195 | neighbors=[live-browser-ignores.js, matchesScope(), normalizeIgnoreRule(), normalizeIgnoreValue(), pageCandidates()]
- "scripts_live_browser_initactionpicker": "initActionPicker()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2921 | neighbors=[live-browser.js, init(), barPaletteForTheme(), detectPageTheme(), el()]
- "scripts_live_browser_initeditbadgehitproxies": "initEditBadgeHitProxies()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4502 | neighbors=[live-browser.js, initEditBadge(), setImportantStyle(), usesShadowChromeRoot(), syncEditBadgeHitProxies()]
- "scripts_live_browser_initparamspanel": "initParamsPanel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3091 | neighbors=[live-browser.js, init(), barPaletteForTheme(), detectPageTheme(), el()]
- "scripts_live_browser_issessionhandled": "isSessionHandled()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9255 | neighbors=[live-browser.js, restoreSessionSupersedingHandledWrapper…, restoreSessionWithoutWrapper(), resumeSession(), scheduleHandledRuntimeWrapperReload()]
- "scripts_live_browser_issvelteinsertmanifest": "isSvelteInsertManifest()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5169 | neighbors=[live-browser.js, commitAcceptedSvelteComponentToDom(), findLiveElementForSvelteManifest(), injectSvelteComponentsFromManifest(), mountSvelteComponentVariant()]
- "scripts_live_browser_istransparentcolor": "isTransparentColor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8016 | neighbors=[live-browser.js, paintsBackdrop(), paintsShaderProxySurface(), resolveCanvasBackground(), resolvePaperRgb()]
- "scripts_live_browser_isusableinjectionanchor": "isUsableInjectionAnchor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5053 | neighbors=[live-browser.js, elementMatchesOriginalMarkup(), findLiveElementForOriginalMarkup(), findLiveElementFromAnchorSnapshot(), resolveLiveInjectionAnchor()]
- "scripts_live_browser_onannotup": "onAnnotUp()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L737 | neighbors=[live-browser.js, beginEditPin(), redrawStrokes(), renderAllPins(), syncInsertCreateButton()]
- "scripts_live_browser_onpendingrollbackclick": "onPendingRollbackClick()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4230 | neighbors=[live-browser.js, clearStoredManualApplyState(), numberOrNull(), showToast(), updatePendingCounter()]
- "scripts_live_browser_pickvariantcontent": "pickVariantContent()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6621 | neighbors=[live-browser.js, completeSourceInjection(), resolveBarAnchor(), resumeSession(), updateSelectedElement()]
- "scripts_live_browser_querymanualeditref": "queryManualEditRef()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4431 | neighbors=[live-browser.js, findManualEditRestoreElement(), elementMatchesManualRefSegment(), parseManualEditRefSegment(), restoreMixedTextNodeManualEdit()]
- "scripts_live_browser_queuecheckpoint": "queueCheckpoint()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7445 | neighbors=[live-browser.js, enterRecoveryWaitingForAnchor(), restoreSessionWithoutWrapper(), resumeSession(), waitForVariantAnchorAndRetry()]
- "scripts_live_browser_releasediscardedstaticwrappers": "releaseDiscardedStaticWrappers()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6746 | neighbors=[live-browser.js, cleanup(), discardedWrappers(), releaseDiscardedStaticWrapper(), removeDiscardStateStylesheet()]
- "scripts_live_browser_removediscardstatestylesheet": "removeDiscardStateStylesheet()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6714 | neighbors=[live-browser.js, cleanup(), releaseDiscardedStaticWrappers(), discardStateStyleId(), watchForDiscardedFrameworkWrapperRemova…]
- "scripts_live_browser_removeinsertplaceholderdom": "removeInsertPlaceholderDom()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2083 | neighbors=[live-browser.js, createInsertPlaceholder(), finalizeInsertSession(), injectSvelteComponentsFromManifest(), syncPlaceholderResizeHandles()]
- "scripts_live_browser_rendercolortiles": "renderColorTiles()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12451 | neighbors=[live-browser.js, cssSafe(), escapeHtml(), synthesizeRamp(), renderDesignVisual()]
- "scripts_live_browser_rendercomponenttiles": "renderComponentTiles()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12610 | neighbors=[live-browser.js, escapeHtml(), groupByKind(), titleForKind(), renderDesignVisual()]
- "scripts_live_browser_resolveinserthover": "resolveInsertHover()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1815 | neighbors=[live-browser.js, handleMouseMove(), computeInsertPosition(), hitSiblingInsertGap(), insertLineCoords()]
- "scripts_live_browser_resolvepaperrgb": "resolvePaperRgb()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8406 | neighbors=[live-browser.js, captureElementToBlob(), cssColorToRgb01(), isTransparentColor(), showShaderOverlay()]
- "scripts_live_browser_restorediscardedmanualedits": "restoreDiscardedManualEdits()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4348 | neighbors=[live-browser.js, onPendingTrashClick(), canRestoreManualEditElement(), findManualEditRestoreElement(), restoreMixedTextNodeManualEdit()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-011.json

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
