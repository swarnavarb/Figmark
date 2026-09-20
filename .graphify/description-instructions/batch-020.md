# Node Description Batch 21 of 55

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

- "functions_want_routes_readwant": "readWant()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L175 | neighbors=[want-routes.ts, card(), findWant()]
- "pages_lotspage_newlotform": "NewLotForm()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L367 | neighbors=[LotsPage.tsx, summarise(), ShopPage.tsx]
- "pages_profilebyhandlepage_gradefor": "gradeFor()" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L571 | neighbors=[ProfileByHandlePage.tsx, CreditSheet(), ProfileByHandlePage()]
- "pages_profilepage_profilepage": "ProfilePage()" | kind=code-symbol | source=app/src/pages/ProfilePage.tsx:L138 | neighbors=[ProfilePage.tsx, waitingOn(), main.tsx]
- "pages_wantedpage_othersline": "othersLine()" | kind=code-symbol | source=app/src/pages/WantedPage.tsx:L161 | neighbors=[WantedPage.tsx, WantDialog(), WantRow()]
- "scripts_check_containers": "check-containers.mjs" | kind=code-symbol | source=scripts/check-containers.mjs:L1 | neighbors=[904cac6 Fix the powerSales indexing pat…, check(), paths()]
- "scripts_live_browser_actionlabel": "actionLabel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2905 | neighbors=[live-browser.js, buildConfigureActionControl(), buildGeneratingRow()]
- "scripts_live_browser_addmanualcontexttext": "addManualContextText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1063 | neighbors=[live-browser.js, normalizeManualContextText(), contextElementForManualEdit()]
- "scripts_live_browser_applyglobalbarlabelstate": "applyGlobalBarLabelState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9905 | neighbors=[live-browser.js, globalBarModeToggles(), syncGlobalBarExpandedLabels()]
- "scripts_live_browser_applyparamvalue": "applyParamValue()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3186 | neighbors=[live-browser.js, applyParamDefaults(), updateVariantStateStylesheet()]
- "scripts_live_browser_attachsteerfocusdebug": "attachSteerFocusDebug()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10183 | neighbors=[live-browser.js, steerFocusDebugEnabled(), init()]
- "scripts_live_browser_averagergb01": "averageRgb01()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8449 | neighbors=[live-browser.js, captureElementFromRenderedAncestor(), captureElementToBlob()]
- "scripts_live_browser_bindconfigureinlinecontrolhover": "bindConfigureInlineControlHover()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1369 | neighbors=[live-browser.js, buildConfigureActionControl(), buildConfigureCountControl()]
- "scripts_live_browser_brandmarksvg": "brandMarkSvg()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10958 | neighbors=[live-browser.js, initGlobalBar(), syncAgentPollingUi()]
- "scripts_live_browser_buildconfirmedrow": "buildConfirmedRow()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2829 | neighbors=[live-browser.js, el(), updateBarContent()]
- "scripts_live_browser_canceleditingpin": "cancelEditingPin()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L881 | neighbors=[live-browser.js, renderAllPins(), onAnnotInputKey()]
- "scripts_live_browser_canrestoremanualeditelement": "canRestoreManualEditElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4367 | neighbors=[live-browser.js, normalizeManualContextText(), restoreDiscardedManualEdits()]
- "scripts_live_browser_clearhandled": "clearHandled()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9259 | neighbors=[live-browser.js, resetSvelteComponentSession(), resumeSession()]
- "scripts_live_browser_clearhandledwrapperreloadstamp": "clearHandledWrapperReloadStamp()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9414 | neighbors=[live-browser.js, handledWrapperReloadKey(), scheduleHandledRuntimeWrapperReload()]
- "scripts_live_browser_clearscrolly": "clearScrollY()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L227 | neighbors=[live-browser.js, cleanup(), cleanupAcceptedSession()]
- "scripts_live_browser_clearsteerawaittimer": "clearSteerAwaitTimer()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10357 | neighbors=[live-browser.js, scheduleSteerAwaitTimeout(), unlockSteerChat()]
- "scripts_live_browser_clearsteerfocusrecovertimer": "clearSteerFocusRecoverTimer()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10084 | neighbors=[live-browser.js, scheduleSteerFocusRecover(), teardown()]
- "scripts_live_browser_closedclippath": "closedClipPath()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4802 | neighbors=[live-browser.js, hideParamsPanel(), positionParamsPanel()]
- "scripts_live_browser_collectfontcsstext": "collectFontCssText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7988 | neighbors=[live-browser.js, captureElementToBlob(), inlineFontUrls()]
- "scripts_live_browser_configureinputshellstyle": "configureInputShellStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1305 | neighbors=[live-browser.js, buildConfigureRow(), buildInsertConfigureRow()]
- "scripts_live_browser_configuremodifierpillstyle": "configureModifierPillStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1334 | neighbors=[live-browser.js, configureBarPalette(), configureRowTextMetrics()]
- "scripts_live_browser_csscolortorgb01": "cssColorToRgb01()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8392 | neighbors=[live-browser.js, captureElementToBlob(), resolvePaperRgb()]
- "scripts_live_browser_cyclevariant": "cycleVariant()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6583 | neighbors=[live-browser.js, selectVariant(), handleKeyDown()]
- "scripts_live_browser_describemountfailure": "describeMountFailure()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5704 | neighbors=[live-browser.js, probePreviewTree(), mountSvelteComponentVariant()]
- "scripts_live_browser_directmixedtextrestorenodes": "directMixedTextRestoreNodes()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4402 | neighbors=[live-browser.js, mixedTextWrapRestoreHint(), restoreMixedTextNodeManualEdit()]
- "scripts_live_browser_discardedwrappers": "discardedWrappers()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6724 | neighbors=[live-browser.js, cleanup(), releaseDiscardedStaticWrappers()]
- "scripts_live_browser_discardstatestyleid": "discardStateStyleId()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6696 | neighbors=[live-browser.js, removeDiscardStateStylesheet(), showOriginalDuringDiscard()]
- "scripts_live_browser_dismisstoast": "dismissToast()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9356 | neighbors=[live-browser.js, showBar(), showToast()]
- "scripts_live_browser_documentrefclasssuffix": "documentRefClassSuffix()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3662 | neighbors=[live-browser.js, normalizeDocumentRefToken(), documentRefSegment()]
- "scripts_live_browser_documentrefidsuffix": "documentRefIdSuffix()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3658 | neighbors=[live-browser.js, normalizeDocumentRefToken(), documentRefSegment()]
- "scripts_live_browser_editbadgeproxytargets": "editBadgeProxyTargets()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4603 | neighbors=[live-browser.js, usesShadowChromeRoot(), syncEditBadgeHitProxies()]
- "scripts_live_browser_elementmatchesmanualrefsegment": "elementMatchesManualRefSegment()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4467 | neighbors=[live-browser.js, indexAmongSameTag(), queryManualEditRef()]
- "scripts_live_browser_ensureconfigureinputstyle": "ensureConfigureInputStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2375 | neighbors=[live-browser.js, buildConfigureRow(), buildInsertConfigureRow()]
- "scripts_live_browser_ensureinsertcreatetooltip": "ensureInsertCreateTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2298 | neighbors=[live-browser.js, el(), showInsertCreateTooltip()]
- "scripts_live_browser_ensurespinkeyframes": "ensureSpinKeyframes()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3864 | neighbors=[live-browser.js, buildSavingRow(), initGlobalBar()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-020.json

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
