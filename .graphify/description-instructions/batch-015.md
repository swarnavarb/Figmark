# Node Description Batch 16 of 55

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

- "scripts_live_browser_buildsavingrow": "buildSavingRow()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2804 | neighbors=[live-browser.js, el(), ensureSpinKeyframes(), updateBarContent()]
- "scripts_live_browser_buildsteerprocessingdots": "buildSteerProcessingDots()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10289 | neighbors=[live-browser.js, el(), pageChatPalette(), lockSteerChat()]
- "scripts_live_browser_buildsteerqueuehint": "buildSteerQueueHint()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10006 | neighbors=[live-browser.js, el(), pageChatPalette(), syncSteerQueueHint()]
- "scripts_live_browser_cancreateinsert": "canCreateInsert()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1879 | neighbors=[live-browser.js, handleInsertCreate(), insertCreateDisabledReason(), syncInsertCreateButton()]
- "scripts_live_browser_captureelementfromrenderedancestor": "captureElementFromRenderedAncestor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8136 | neighbors=[live-browser.js, averageRgb01(), dominantRgb01(), findShaderProxyCaptureRoot()]
- "scripts_live_browser_completeparametergenerationifready": "completeParameterGenerationIfReady()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4924 | neighbors=[live-browser.js, completeParameterPublication(), completeSourceInjection(), injectSvelteComponentsFromManifest()]
- "scripts_live_browser_configureinputfieldstyle": "configureInputFieldStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1290 | neighbors=[live-browser.js, buildConfigureRow(), buildInsertConfigureRow(), configureRowTextMetrics()]
- "scripts_live_browser_configureselectionpillstyle": "configureSelectionPillStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1313 | neighbors=[live-browser.js, buildSelectionPill(), configureBarPalette(), configureRowTextMetrics()]
- "scripts_live_browser_contextelementformanualedit": "contextElementForManualEdit()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1014 | neighbors=[live-browser.js, applyEditing(), addManualContextText(), isUsefulManualEditContext()]
- "scripts_live_browser_copyeditcontainercontext": "copyEditContainerContext()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3725 | neighbors=[live-browser.js, applyEditing(), documentRefForElement(), sanitizedContextOuterHTML()]
- "scripts_live_browser_copyeditleafcontext": "copyEditLeafContext()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3691 | neighbors=[live-browser.js, applyEditing(), documentRefForElement(), sanitizedContextOuterHTML()]
- "scripts_live_browser_cyclingcountertext": "cyclingCounterText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2645 | neighbors=[live-browser.js, buildCyclingRow(), cyclingShownVariant(), syncCyclingControls()]
- "scripts_live_browser_cyclingshownvariant": "cyclingShownVariant()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2631 | neighbors=[live-browser.js, buildCyclingRow(), cyclingCounterText(), syncCyclingControls()]
- "scripts_live_browser_detectinsertaxis": "detectInsertAxis()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1695 | neighbors=[live-browser.js, createInsertPlaceholder(), detectInsertAxisFromStyle(), handleMouseMove()]
- "scripts_live_browser_enableinlineedit": "enableInlineEdit()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3441 | neighbors=[live-browser.js, collectEditableTextRows(), wrapMixedContentTextNodes(), enterEditingMode()]
- "scripts_live_browser_ensureconfigurebartooltip": "ensureConfigureBarTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1398 | neighbors=[live-browser.js, configureBarPalette(), el(), showConfigureBarTooltip()]
- "scripts_live_browser_fetchpendingcount": "fetchPendingCount()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4100 | neighbors=[live-browser.js, updatePendingCounter(), handleManualEditActivity(), init()]
- "scripts_live_browser_findanyvariantswrapper": "findAnyVariantsWrapper()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6964 | neighbors=[live-browser.js, pickPopulatedVariantsWrapper(), restoreFromActiveSessions(), resumeSession()]
- "scripts_live_browser_findinsertanchorindom": "findInsertAnchorInDom()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2115 | neighbors=[live-browser.js, ensureInsertPlaceholder(), findLiveElementForSvelteManifest(), resumeSession()]
- "scripts_live_browser_findliveelementfromanchorsnapshot": "findLiveElementFromAnchorSnapshot()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5082 | neighbors=[live-browser.js, isUsableInjectionAnchor(), resolveLiveInjectionAnchor(), restoreSessionWithoutWrapper()]
- "scripts_live_browser_findmanualeditrestoreelement": "findManualEditRestoreElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4412 | neighbors=[live-browser.js, normalizeManualContextText(), queryManualEditRef(), restoreDiscardedManualEdits()]
- "scripts_live_browser_getmountedsveltecomponentanchor": "getMountedSvelteComponentAnchor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3140 | neighbors=[live-browser.js, commitAcceptedSvelteComponentToDom(), mountSvelteComponentVariant(), resolveSvelteComponentAnchor()]
- "scripts_live_browser_handlediscard": "handleDiscard()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8959 | neighbors=[live-browser.js, sendEvent(), showManualApplyBusyToast(), handleKeyDown()]
- "scripts_live_browser_hastextrows": "hasTextRows()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3485 | neighbors=[live-browser.js, handleClick(), handleKeyDown(), refreshLiveControlsForManualApply()]
- "scripts_live_browser_hitsiblinginsertgap": "hitSiblingInsertGap()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1748 | neighbors=[live-browser.js, groupSiblingRows(), horizontalOverlap(), resolveInsertHover()]
- "scripts_live_browser_importfirstreachable": "importFirstReachable()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5253 | neighbors=[live-browser.js, loadSvelteRuntime(), mountSvelteComponentVariant(), probePreviewTree()]
- "scripts_live_browser_initbar": "initBar()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1095 | neighbors=[live-browser.js, init(), barPaletteForTheme(), detectPageTheme()]
- "scripts_live_browser_initpagechat": "initPageChat()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10769 | neighbors=[live-browser.js, initGlobalBar(), el(), steerFocusLog()]
- "scripts_live_browser_ispageeditableactive": "isPageEditableActive()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10062 | neighbors=[live-browser.js, isInlineEditActive(), isPageEditableElement(), shouldSteerAutoFocus()]
- "scripts_live_browser_loadsvelteruntime": "loadSvelteRuntime()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5282 | neighbors=[live-browser.js, componentModuleCandidates(), importFirstReachable(), mountSvelteComponentVariant()]
- "scripts_live_browser_manualapplystatekey": "manualApplyStateKey()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3880 | neighbors=[live-browser.js, clearStoredManualApplyState(), readStoredManualApplyState(), writeManualApplyState()]
- "scripts_live_browser_marksessionhandled": "markSessionHandled()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9250 | neighbors=[live-browser.js, abandonForeignSession(), discardOrphanedSession(), maybeCompleteAcceptedSession()]
- "scripts_live_browser_materializeplaceholderwidth": "materializePlaceholderWidth()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1867 | neighbors=[live-browser.js, applyPlaceholderDimensions(), placeholderWidthIsImplicit(), startPlaceholderEdgeResize()]
- "scripts_live_browser_mixedtextwraprestorehint": "mixedTextWrapRestoreHint()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4373 | neighbors=[live-browser.js, applyEditing(), directMixedTextRestoreNodes(), documentRefForElement()]
- "scripts_live_browser_nearbyeditabletextsformanualedit": "nearbyEditableTextsForManualEdit()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3705 | neighbors=[live-browser.js, applyEditing(), documentRefForElement(), normalizeManualContextText()]
- "scripts_live_browser_normalizeelementclassname": "normalizeElementClassName()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5031 | neighbors=[live-browser.js, elementMatchesOriginalMarkup(), findLiveElementForOriginalMarkup(), resolveLiveInjectionAnchor()]
- "scripts_live_browser_ondetectmessage": "onDetectMessage()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11693 | neighbors=[live-browser.js, requestDetectScan(), showToast(), updateGlobalBarState()]
- "scripts_live_browser_onpendingtrashclick": "onPendingTrashClick()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4160 | neighbors=[live-browser.js, restoreDiscardedManualEdits(), showToast(), updatePendingCounter()]
- "scripts_live_browser_paintsbackdrop": "paintsBackdrop()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8423 | neighbors=[live-browser.js, findBackdropAncestor(), isTransparentColor(), paintsShaderProxySurface()]
- "scripts_live_browser_paintsshaderproxysurface": "paintsShaderProxySurface()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8106 | neighbors=[live-browser.js, findShaderProxyCaptureRoot(), isTransparentColor(), paintsBackdrop()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-015.json

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
