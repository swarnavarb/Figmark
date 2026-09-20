# Node Description Batch 33 of 55

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

- "scripts_live_browser_positionshaderoverlay": "positionShaderOverlay()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8516 | neighbors=[live-browser.js, resolveBarAnchor()]
- "scripts_live_browser_probejsxwrapperfororphan": "probeJsxWrapperForOrphan()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6240 | neighbors=[live-browser.js, injectVariantsFromSource()]
- "scripts_live_browser_readscrolly": "readScrollY()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L226 | neighbors=[live-browser.js, resumeSession()]
- "scripts_live_browser_releasediscardedstaticwrapper": "releaseDiscardedStaticWrapper()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6729 | neighbors=[live-browser.js, releaseDiscardedStaticWrappers()]
- "scripts_live_browser_removestrayshadernode": "removeStrayShaderNode()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8528 | neighbors=[live-browser.js, hideShaderOverlay()]
- "scripts_live_browser_renderparsedmdcta": "renderParsedMdCta()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12298 | neighbors=[live-browser.js, renderDesignBody()]
- "scripts_live_browser_renderradiitile": "renderRadiiTile()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12549 | neighbors=[live-browser.js, renderDesignVisual()]
- "scripts_live_browser_renderstalehint": "renderStaleHint()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12288 | neighbors=[live-browser.js, renderDesignBody()]
- "scripts_live_browser_samplesurroundingrgb": "sampleSurroundingRgb()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8486 | neighbors=[live-browser.js, captureElementToBlob()]
- "scripts_live_browser_savepickpref": "savePickPref()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9743 | neighbors=[live-browser.js, saveInteractionPrefs()]
- "scripts_live_browser_schedulecyclingbarsync": "scheduleCyclingBarSync()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4975 | neighbors=[live-browser.js, showVariantInDOM()]
- "scripts_live_browser_schedulesteerfocusrecover": "scheduleSteerFocusRecover()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10091 | neighbors=[live-browser.js, clearSteerFocusRecoverTimer()]
- "scripts_live_browser_selectiontaglabel": "selectionTagLabel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1448 | neighbors=[live-browser.js, buildSelectionPill()]
- "scripts_live_browser_selectorforacceptedroot": "selectorForAcceptedRoot()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8823 | neighbors=[live-browser.js, snapshotAcceptedVariantDom()]
- "scripts_live_browser_serversessionassavedshape": "serverSessionAsSavedShape()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9092 | neighbors=[live-browser.js, restoreSessionWithoutWrapper()]
- "scripts_live_browser_session": "live-browser-session.js" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-session.js:L1 | neighbors=[0f35535 Add the Impeccable design skill, createLiveBrowserSessionState()]
- "scripts_live_browser_setpageinteractioncursor": "setPageInteractionCursor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2002 | neighbors=[live-browser.js, syncPageInteractionCursor()]
- "scripts_live_browser_shouldpassthroughelementnav": "shouldPassthroughElementNav()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7644 | neighbors=[live-browser.js, handleKeyDown()]
- "scripts_live_browser_shouldscopenestedcssatrule": "shouldScopeNestedCssAtRule()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5365 | neighbors=[live-browser.js, scopeCssBlock()]
- "scripts_live_browser_shouldshowhighlighttagtooltip": "shouldShowHighlightTagTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L361 | neighbors=[live-browser.js, showHighlight()]
- "scripts_live_browser_showconfigurebartooltip": "showConfigureBarTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1426 | neighbors=[live-browser.js, ensureConfigureBarTooltip()]
- "scripts_live_browser_showinsertcreatetooltip": "showInsertCreateTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2322 | neighbors=[live-browser.js, ensureInsertCreateTooltip()]
- "scripts_live_browser_showshaderbitmapfallback": "showShaderBitmapFallback()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8551 | neighbors=[live-browser.js, showShaderOverlay()]
- "scripts_live_browser_splitcssselectorlist": "splitCssSelectorList()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5404 | neighbors=[live-browser.js, prefixCssSelectors()]
- "scripts_live_browser_steerspeechrecognitionctor": "steerSpeechRecognitionCtor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10476 | neighbors=[live-browser.js, startVoice()]
- "scripts_live_browser_steertimeoutmessage": "steerTimeoutMessage()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10380 | neighbors=[live-browser.js, steerQueuedBehindGeneration()]
- "scripts_live_browser_steervoicecontext": "steerVoiceContext()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10650 | neighbors=[live-browser.js, toggleSteerVoice()]
- "scripts_live_browser_stripsveltekeydelimiters": "stripSvelteKeyDelimiters()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5578 | neighbors=[live-browser.js, stripSvelteBlockRegions()]
- "scripts_live_browser_syncpagechatexpandedwidth": "syncPageChatExpandedWidth()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9937 | neighbors=[live-browser.js, pageChatExpandedWidth()]
- "scripts_live_browser_synthesizenarrative": "synthesizeNarrative()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12432 | neighbors=[live-browser.js, renderDesignVisual()]
- "scripts_live_browser_synthesizeramp": "synthesizeRamp()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12486 | neighbors=[live-browser.js, renderColorTiles()]
- "scripts_live_browser_titleforkind": "titleForKind()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12680 | neighbors=[live-browser.js, renderComponentTiles()]
- "scripts_live_browser_truncatemiddle": "truncateMiddle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5987 | neighbors=[live-browser.js, renderMountErrorCard()]
- "scripts_live_browser_variantparamdecls": "variantParamDecls()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6660 | neighbors=[live-browser.js, updateVariantStateStylesheet()]
- "scripts_live_browser_variantstateselector": "variantStateSelector()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6649 | neighbors=[live-browser.js, updateVariantStateStylesheet()]
- "scripts_live_browser_waitforsveltecomponenttargetandretry": "waitForSvelteComponentTargetAndRetry()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5930 | neighbors=[live-browser.js, injectSvelteComponentsFromManifest()]
- "scripts_live_browser_wrapmixedcontenttextnodes": "wrapMixedContentTextNodes()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3403 | neighbors=[live-browser.js, enableInlineEdit()]
- "scripts_modern_screenshot_umd_bt": "bt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, yt()]
- "scripts_modern_screenshot_umd_ce": "Ce()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, Rt()]
- "scripts_modern_screenshot_umd_dt": "dt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, ft()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-032.json

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
