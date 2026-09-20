# Node Description Batch 32 of 55

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

- "scripts_live_browser_groupsiblingrows": "groupSiblingRows()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1724 | neighbors=[live-browser.js, hitSiblingInsertGap()]
- "scripts_live_browser_hidehighlighttagtooltip": "hideHighlightTagTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L366 | neighbors=[live-browser.js, showHighlight()]
- "scripts_live_browser_hideinsertcreatetooltip": "hideInsertCreateTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2336 | neighbors=[live-browser.js, syncInsertCreateButton()]
- "scripts_live_browser_highlightbold": "highlightBold()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12912 | neighbors=[live-browser.js, inlineMd()]
- "scripts_live_browser_horizontaloverlap": "horizontalOverlap()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1742 | neighbors=[live-browser.js, hitSiblingInsertGap()]
- "scripts_live_browser_ignores_matchesscope": "matchesScope()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-ignores.js:L172 | neighbors=[live-browser-ignores.js, resolveDetectIgnores()]
- "scripts_live_browser_ignores_normalizeignorerule": "normalizeIgnoreRule()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-ignores.js:L44 | neighbors=[live-browser-ignores.js, resolveDetectIgnores()]
- "scripts_live_browser_ignores_normalizeignorevalue": "normalizeIgnoreValue()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-ignores.js:L48 | neighbors=[live-browser-ignores.js, resolveDetectIgnores()]
- "scripts_live_browser_ignores_pagecandidates": "pageCandidates()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-ignores.js:L118 | neighbors=[live-browser-ignores.js, resolveDetectIgnores()]
- "scripts_live_browser_initannotoverlay": "initAnnotOverlay()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L444 | neighbors=[live-browser.js, init()]
- "scripts_live_browser_inithighlight": "initHighlight()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L334 | neighbors=[live-browser.js, init()]
- "scripts_live_browser_inlinefonturls": "inlineFontUrls()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7965 | neighbors=[live-browser.js, collectFontCssText()]
- "scripts_live_browser_insertcreategatestate": "insertCreateGateState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2341 | neighbors=[live-browser.js, syncInsertCreateButton()]
- "scripts_live_browser_insertlinecoords": "insertLineCoords()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1805 | neighbors=[live-browser.js, resolveInsertHover()]
- "scripts_live_browser_isjsxsourcefile": "isJsxSourceFile()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6216 | neighbors=[live-browser.js, injectVariantsFromSource()]
- "scripts_live_browser_isterminalsessionsummary": "isTerminalSessionSummary()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9038 | neighbors=[live-browser.js, recoverMissedGenerationCompletion()]
- "scripts_live_browser_isvariantshown": "isVariantShown()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4970 | neighbors=[live-browser.js, readVisibleVariantFromDOM()]
- "scripts_live_browser_layoutflowchildren": "layoutFlowChildren()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1706 | neighbors=[live-browser.js, handleMouseMove()]
- "scripts_live_browser_loaddesignprefs": "loadDesignPrefs()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11805 | neighbors=[live-browser.js, initDesignPanel()]
- "scripts_live_browser_loaddetectscript": "loadDetectScript()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11684 | neighbors=[live-browser.js, toggleDetect()]
- "scripts_live_browser_loadinteractionprefs": "loadInteractionPrefs()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9714 | neighbors=[live-browser.js, loadPickPref()]
- "scripts_live_browser_loadmodernscreenshot": "loadModernScreenshot()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7930 | neighbors=[live-browser.js, captureElementToBlob()]
- "scripts_live_browser_loadpickpref": "loadPickPref()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9739 | neighbors=[live-browser.js, loadInteractionPrefs()]
- "scripts_live_browser_loadsveltecomponentparams": "loadSvelteComponentParams()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5295 | neighbors=[live-browser.js, injectSvelteComponentsFromManifest()]
- "scripts_live_browser_manualediteventforcurrentpage": "manualEditEventForCurrentPage()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4253 | neighbors=[live-browser.js, handleManualEditActivity()]
- "scripts_live_browser_maybecompletesteer": "maybeCompleteSteer()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10718 | neighbors=[live-browser.js, unlockSteerChat()]
- "scripts_live_browser_mounterrorcardbottomoffset": "mountErrorCardBottomOffset()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6020 | neighbors=[live-browser.js, renderMountErrorCard()]
- "scripts_live_browser_normalizepagepath": "normalizePagePath()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9024 | neighbors=[live-browser.js, pageMatchesCurrent()]
- "scripts_live_browser_normalizepreviewtext": "normalizePreviewText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6540 | neighbors=[live-browser.js, buildSvelteExpressionTextMap()]
- "scripts_live_browser_normalizesessionpath": "normalizeSessionPath()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8975 | neighbors=[live-browser.js, rememberSessionFileMeta()]
- "scripts_live_browser_notepagepointerdown": "notePagePointerDown()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10112 | neighbors=[live-browser.js, shouldFocusSteerChat()]
- "scripts_live_browser_pagechatcollapsedwidthpx": "pageChatCollapsedWidthPx()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9922 | neighbors=[live-browser.js, pageChatExpandedWidth()]
- "scripts_live_browser_pagehashosttextselection": "pageHasHostTextSelection()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10067 | neighbors=[live-browser.js, handleClick()]
- "scripts_live_browser_pagematchescurrent": "pageMatchesCurrent()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9033 | neighbors=[live-browser.js, normalizePagePath()]
- "scripts_live_browser_parsemanualeditrefsegment": "parseManualEditRefSegment()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4451 | neighbors=[live-browser.js, queryManualEditRef()]
- "scripts_live_browser_parsesourceloc": "parseSourceLoc()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3628 | neighbors=[live-browser.js, sourceHintForElement()]
- "scripts_live_browser_placeholdersizing": "placeholderSizing()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1827 | neighbors=[live-browser.js, createInsertPlaceholder()]
- "scripts_live_browser_placeholderwidthisimplicit": "placeholderWidthIsImplicit()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1846 | neighbors=[live-browser.js, materializePlaceholderWidth()]
- "scripts_live_browser_playpendingintroanimation": "playPendingIntroAnimation()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3837 | neighbors=[live-browser.js, updatePendingCounter()]
- "scripts_live_browser_popoverdirection": "popoverDirection()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4786 | neighbors=[live-browser.js, positionParamsPanel()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-031.json

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
