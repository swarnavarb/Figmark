# Node Description Batch 22 of 55

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

- "scripts_live_browser_expressiontextmatcher": "expressionTextMatcher()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6514 | neighbors=[live-browser.js, buildSvelteExpressionTextMap(), escapeRegExp()]
- "scripts_live_browser_findbackdropancestor": "findBackdropAncestor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8438 | neighbors=[live-browser.js, captureElementToBlob(), paintsBackdrop()]
- "scripts_live_browser_findshaderproxycaptureroot": "findShaderProxyCaptureRoot()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8113 | neighbors=[live-browser.js, captureElementFromRenderedAncestor(), paintsShaderProxySurface()]
- "scripts_live_browser_focusconfigureinput": "focusConfigureInput()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10193 | neighbors=[live-browser.js, steerFocusLog(), syncPageChatFocus()]
- "scripts_live_browser_handledwrapperreloadkey": "handledWrapperReloadKey()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9410 | neighbors=[live-browser.js, clearHandledWrapperReloadStamp(), scheduleHandledRuntimeWrapperReload()]
- "scripts_live_browser_hideagentpolltooltip": "hideAgentPollTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11055 | neighbors=[live-browser.js, syncAgentPollingUi(), teardown()]
- "scripts_live_browser_hidecapturechromeforshaderproxy": "hideCaptureChromeForShaderProxy()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8077 | neighbors=[live-browser.js, captureElementToBlob(), captureChromeNodes()]
- "scripts_live_browser_indexamongsametag": "indexAmongSameTag()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3677 | neighbors=[live-browser.js, documentRefSegment(), elementMatchesManualRefSegment()]
- "scripts_live_browser_initeditbadge": "initEditBadge()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4648 | neighbors=[live-browser.js, init(), initEditBadgeHitProxies()]
- "scripts_live_browser_insertcreatedisabledreason": "insertCreateDisabledReason()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1888 | neighbors=[live-browser.js, canCreateInsert(), syncInsertCreateButton()]
- "scripts_live_browser_isembeddedpreviewbrowser": "isEmbeddedPreviewBrowser()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10480 | neighbors=[live-browser.js, startVoice(), steerVoiceErrorMessage()]
- "scripts_live_browser_isinlineeditactive": "isInlineEditActive()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10058 | neighbors=[live-browser.js, handleKeyDown(), isPageEditableActive()]
- "scripts_live_browser_isinsertgeneratingsession": "isInsertGeneratingSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2132 | neighbors=[live-browser.js, ensureInsertPlaceholder(), findVariantsWrapper()]
- "scripts_live_browser_ispageeditableelement": "isPageEditableElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10052 | neighbors=[live-browser.js, handleKeyDown(), isPageEditableActive()]
- "scripts_live_browser_issveltecomponentmanifestpath": "isSvelteComponentManifestPath()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5017 | neighbors=[live-browser.js, injectVariantsFromSource(), rememberSessionFileMeta()]
- "scripts_live_browser_isusefulmanualeditcontext": "isUsefulManualEditContext()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1038 | neighbors=[live-browser.js, contextElementForManualEdit(), collectManualContextPieces()]
- "scripts_live_browser_localcoords": "localCoords()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L588 | neighbors=[live-browser.js, onAnnotDown(), onAnnotMove()]
- "scripts_live_browser_manualapplyloadingtext": "manualApplyLoadingText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3940 | neighbors=[live-browser.js, readStoredManualApplyState(), setPendingApplyLoading()]
- "scripts_live_browser_maybeprefetchpage": "maybePrefetchPage()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7636 | neighbors=[live-browser.js, handleClick(), sendEvent()]
- "scripts_live_browser_maybeshowfirstsavetoast": "maybeShowFirstSaveToast()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4094 | neighbors=[live-browser.js, applyEditing(), showToast()]
- "scripts_live_browser_maybewarnconditionalancestor": "maybeWarnConditionalAncestor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7582 | neighbors=[live-browser.js, handleClick(), showToast()]
- "scripts_live_browser_mountedparametercount": "mountedParameterCount()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4898 | neighbors=[live-browser.js, completeParameterPublication(), findVariantsWrapper()]
- "scripts_live_browser_msgdiv": "msgDiv()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12281 | neighbors=[live-browser.js, renderDesignBody(), renderDesignVisual()]
- "scripts_live_browser_navbtn": "navBtn()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2890 | neighbors=[live-browser.js, buildCyclingRow(), el()]
- "scripts_live_browser_normalizedocumentreftoken": "normalizeDocumentRefToken()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3673 | neighbors=[live-browser.js, documentRefClassSuffix(), documentRefIdSuffix()]
- "scripts_live_browser_onannotinputkey": "onAnnotInputKey()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L858 | neighbors=[live-browser.js, cancelEditingPin(), finalizeEditingPin()]
- "scripts_live_browser_pickpopulatedvariantswrapper": "pickPopulatedVariantsWrapper()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6946 | neighbors=[live-browser.js, findAnyVariantsWrapper(), findVariantsWrapper()]
- "scripts_live_browser_pointstopath": "pointsToPath()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L728 | neighbors=[live-browser.js, buildAnnotationsForCapture(), onAnnotMove()]
- "scripts_live_browser_positioneditbadge": "positionEditBadge()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4676 | neighbors=[live-browser.js, syncEditBadgeHitProxies(), renderEditBadge()]
- "scripts_live_browser_prefixcssselectors": "prefixCssSelectors()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5391 | neighbors=[live-browser.js, splitCssSelectorList(), scopeCssBlock()]
- "scripts_live_browser_releasevoiceengine": "releaseVoiceEngine()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10540 | neighbors=[live-browser.js, startVoice(), stopVoice()]
- "scripts_live_browser_renderrawtab": "renderRawTab()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12802 | neighbors=[live-browser.js, renderDesignBody(), renderMarkdown()]
- "scripts_live_browser_rendershadowtiles": "renderShadowTiles()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12580 | neighbors=[live-browser.js, renderDesignVisual(), escapeHtml()]
- "scripts_live_browser_reportvariantmounted": "reportVariantMounted()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5960 | neighbors=[live-browser.js, mountSvelteComponentVariant(), sendEvent()]
- "scripts_live_browser_requestdetectscan": "requestDetectScan()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11575 | neighbors=[live-browser.js, onDetectMessage(), toggleDetect()]
- "scripts_live_browser_resizeplaceholderfromedge": "resizePlaceholderFromEdge()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1907 | neighbors=[live-browser.js, onAnnotMove(), clampPlaceholderSize()]
- "scripts_live_browser_resolvecanvasbackground": "resolveCanvasBackground()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8032 | neighbors=[live-browser.js, captureElementToBlob(), isTransparentColor()]
- "scripts_live_browser_resolvescrolllockanchortop": "resolveScrollLockAnchorTop()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6789 | neighbors=[live-browser.js, resolveBarAnchor(), startScrollLock()]
- "scripts_live_browser_restorepickerbarchrome": "restorePickerBarChrome()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1249 | neighbors=[live-browser.js, showBar(), updateBarContent()]
- "scripts_live_browser_schedulesteerawaittimeout": "scheduleSteerAwaitTimeout()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10364 | neighbors=[live-browser.js, clearSteerAwaitTimer(), submitSteerMessage()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-021.json

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
