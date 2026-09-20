# Node Description Batch 31 of 55

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

- "scripts_live_browser_buildtypographymodels": "buildTypographyModels()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12380 | neighbors=[live-browser.js, renderDesignVisual()]
- "scripts_live_browser_capturechromenodes": "captureChromeNodes()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8053 | neighbors=[live-browser.js, hideCaptureChromeForShaderProxy()]
- "scripts_live_browser_checkpointpayload": "checkpointPayload()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7405 | neighbors=[live-browser.js, sendCheckpoint()]
- "scripts_live_browser_clampplaceholdersize": "clampPlaceholderSize()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1893 | neighbors=[live-browser.js, resizePlaceholderFromEdge()]
- "scripts_live_browser_clampvariantindex": "clampVariantIndex()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9051 | neighbors=[live-browser.js, restoreSessionWithoutWrapper()]
- "scripts_live_browser_clonewithoutelements": "cloneWithoutElements()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5602 | neighbors=[live-browser.js, buildSveltePropValuesV2()]
- "scripts_live_browser_collecteditabletextrows": "collectEditableTextRows()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3361 | neighbors=[live-browser.js, enableInlineEdit()]
- "scripts_live_browser_collectmanualcontextpieces": "collectManualContextPieces()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1044 | neighbors=[live-browser.js, isUsefulManualEditContext()]
- "scripts_live_browser_collecttextnodes": "collectTextNodes()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6528 | neighbors=[live-browser.js, buildSvelteExpressionTextMap()]
- "scripts_live_browser_commitacceptedvarianttodom": "commitAcceptedVariantToDom()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8937 | neighbors=[live-browser.js, findVariantsWrapper()]
- "scripts_live_browser_compileshader": "compileShader()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8504 | neighbors=[live-browser.js, showShaderOverlay()]
- "scripts_live_browser_computeinsertposition": "computeInsertPosition()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1713 | neighbors=[live-browser.js, resolveInsertHover()]
- "scripts_live_browser_configurevoicecontext": "configureVoiceContext()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10661 | neighbors=[live-browser.js, toggleConfigureVoice()]
- "scripts_live_browser_connectsse": "connectSSE()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7123 | neighbors=[live-browser.js, init()]
- "scripts_live_browser_copytoclipboard": "copyToClipboard()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12925 | neighbors=[live-browser.js, showToast()]
- "scripts_live_browser_cssescapeident": "cssEscapeIdent()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5529 | neighbors=[live-browser.js, buildSveltePropValuesV2()]
- "scripts_live_browser_csssafe": "cssSafe()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12782 | neighbors=[live-browser.js, renderColorTiles()]
- "scripts_live_browser_cursorforinsertaxis": "cursorForInsertAxis()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1823 | neighbors=[live-browser.js, syncPageInteractionCursor()]
- "scripts_live_browser_cursorforplaceholderedge": "cursorForPlaceholderEdge()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1901 | neighbors=[live-browser.js, buildPlaceholderResizeHandles()]
- "scripts_live_browser_designemptymessage": "designEmptyMessage()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12314 | neighbors=[live-browser.js, renderDesignVisual()]
- "scripts_live_browser_designpanelcss": "designPanelCss()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11878 | neighbors=[live-browser.js, initDesignPanel()]
- "scripts_live_browser_detectdevserverbase": "detectDevServerBase()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5225 | neighbors=[live-browser.js, componentModuleCandidates()]
- "scripts_live_browser_detectinsertaxisfromstyle": "detectInsertAxisFromStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1676 | neighbors=[live-browser.js, detectInsertAxis()]
- "scripts_live_browser_dom": "live-browser-dom.js" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-dom.js:L1 | neighbors=[0f35535 Add the Impeccable design skill, createLiveBrowserDomHelpers()]
- "scripts_live_browser_dominantrgb01": "dominantRgb01()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8460 | neighbors=[live-browser.js, captureElementFromRenderedAncestor()]
- "scripts_live_browser_elementpath": "elementPath()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1454 | neighbors=[live-browser.js, buildSelectionPill()]
- "scripts_live_browser_ensureinsertline": "ensureInsertLine()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1934 | neighbors=[live-browser.js, showInsertLine()]
- "scripts_live_browser_escaperegexp": "escapeRegExp()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6544 | neighbors=[live-browser.js, expressionTextMatcher()]
- "scripts_live_browser_fetchagentpollingstatus": "fetchAgentPollingStatus()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11068 | neighbors=[live-browser.js, startAgentStatusPoll()]
- "scripts_live_browser_findacceptedruntimewrappers": "findAcceptedRuntimeWrappers()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8878 | neighbors=[live-browser.js, ensureAcceptedDomClean()]
- "scripts_live_browser_findactivesessionsummary": "findActiveSessionSummary()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9042 | neighbors=[live-browser.js, restoreSessionWithoutWrapper()]
- "scripts_live_browser_findadoptableserversession": "findAdoptableServerSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9075 | neighbors=[live-browser.js, restoreSessionWithoutWrapper()]
- "scripts_live_browser_findmatchingcssbrace": "findMatchingCssBrace()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5369 | neighbors=[live-browser.js, scopeCssBlock()]
- "scripts_live_browser_finishvoicesession": "finishVoiceSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10562 | neighbors=[live-browser.js, syncVoiceUi()]
- "scripts_live_browser_fontstack": "fontStack()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12540 | neighbors=[live-browser.js, renderTypeTiles()]
- "scripts_live_browser_forbiddenmanualtextchars": "forbiddenManualTextChars()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3737 | neighbors=[live-browser.js, applyEditing()]
- "scripts_live_browser_formatrangevalue": "formatRangeValue()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3219 | neighbors=[live-browser.js, buildParamsPanel()]
- "scripts_live_browser_generationstatustext": "generationStatusText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2611 | neighbors=[live-browser.js, buildGeneratingRow()]
- "scripts_live_browser_globalbarmodetoggles": "globalBarModeToggles()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9896 | neighbors=[live-browser.js, applyGlobalBarLabelState()]
- "scripts_live_browser_groupbykind": "groupByKind()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12667 | neighbors=[live-browser.js, renderComponentTiles()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-030.json

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
