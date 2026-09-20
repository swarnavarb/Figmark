# Node Description Batch 23 of 55

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

- "scripts_live_browser_selectvariant": "selectVariant()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6548 | neighbors=[live-browser.js, cycleVariant(), showManualApplyBusyToast()]
- "scripts_live_browser_sendsteercheckpoint": "sendSteerCheckpoint()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7430 | neighbors=[live-browser.js, sendEvent(), unlockSteerChat()]
- "scripts_live_browser_setclippath": "setClipPath()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4806 | neighbors=[live-browser.js, hideParamsPanel(), positionParamsPanel()]
- "scripts_live_browser_setimportantstyle": "setImportantStyle()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4498 | neighbors=[live-browser.js, initEditBadgeHitProxies(), styleEditBadgeProxy()]
- "scripts_live_browser_shouldresumemanualapplyloading": "shouldResumeManualApplyLoading()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3936 | neighbors=[live-browser.js, readStoredManualApplyState(), updatePendingCounter()]
- "scripts_live_browser_shoulduseancestorcropshaderproxy": "shouldUseAncestorCropShaderProxy()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8096 | neighbors=[live-browser.js, captureElementToBlob(), isFrameworkComponentPreviewMode()]
- "scripts_live_browser_showagentpolltooltip": "showAgentPollTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11037 | neighbors=[live-browser.js, agentStatusText(), ensureAgentPollTooltip()]
- "scripts_live_browser_showinsertline": "showInsertLine()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1952 | neighbors=[live-browser.js, handleMouseMove(), ensureInsertLine()]
- "scripts_live_browser_showoriginalduringdiscard": "showOriginalDuringDiscard()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6700 | neighbors=[live-browser.js, cleanup(), discardStateStyleId()]
- "scripts_live_browser_sourcehintforelement": "sourceHintForElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3612 | neighbors=[live-browser.js, applyEditing(), parseSourceLoc()]
- "scripts_live_browser_startagentstatuspoll": "startAgentStatusPoll()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11079 | neighbors=[live-browser.js, fetchAgentPollingStatus(), stopAgentStatusPoll()]
- "scripts_live_browser_startplaceholderedgeresize": "startPlaceholderEdgeResize()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2225 | neighbors=[live-browser.js, onAnnotDown(), materializePlaceholderWidth()]
- "scripts_live_browser_steerfocusdebugenabled": "steerFocusDebugEnabled()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10166 | neighbors=[live-browser.js, attachSteerFocusDebug(), steerFocusLog()]
- "scripts_live_browser_steerfocustargetlabel": "steerFocusTargetLabel()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10159 | neighbors=[live-browser.js, focusSteerChat(), steerFocusLog()]
- "scripts_live_browser_steervoiceerrormessage": "steerVoiceErrorMessage()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10493 | neighbors=[live-browser.js, isEmbeddedPreviewBrowser(), steerVoiceUnavailableMessage()]
- "scripts_live_browser_steervoiceunavailablemessage": "steerVoiceUnavailableMessage()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10489 | neighbors=[live-browser.js, startVoice(), steerVoiceErrorMessage()]
- "scripts_live_browser_stopagentstatuspoll": "stopAgentStatusPoll()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11061 | neighbors=[live-browser.js, startAgentStatusPoll(), teardown()]
- "scripts_live_browser_stripsvelteblockregions": "stripSvelteBlockRegions()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5549 | neighbors=[live-browser.js, buildSveltePropValuesV2(), stripSvelteKeyDelimiters()]
- "scripts_live_browser_styleeditbadgeproxy": "styleEditBadgeProxy()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4524 | neighbors=[live-browser.js, setImportantStyle(), syncEditBadgeHitProxies()]
- "scripts_live_browser_unwrapmixedcontenttextnodes": "unwrapMixedContentTextNodes()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3428 | neighbors=[live-browser.js, disableInlineEdit(), stripManualEditRuntimeState()]
- "scripts_live_browser_waitforvariantanchorandretry": "waitForVariantAnchorAndRetry()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5181 | neighbors=[live-browser.js, enterRecoveryWaitingForAnchor(), queueCheckpoint()]
- "scripts_live_browser_watchfordiscardedframeworkwrapperremoval": "watchForDiscardedFrameworkWrapperRemoval()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6752 | neighbors=[live-browser.js, cleanup(), removeDiscardStateStylesheet()]
- "scripts_live_browser_watchforhandledruntimewrapper": "watchForHandledRuntimeWrapper()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9471 | neighbors=[live-browser.js, scheduleAcceptCleanup(), scheduleHandledRuntimeWrapperReload()]
- "scripts_live_browser_writescrolly": "writeScrollY()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L225 | neighbors=[live-browser.js, handleGo(), handleInsertCreate()]
- "scripts_modern_screenshot_umd_be": "be()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, q(), ye()]
- "scripts_modern_screenshot_umd_ee": "Ee()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, vt(), Rt()]
- "scripts_modern_screenshot_umd_er": "er()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L14 | neighbors=[modern-screenshot.umd.js, k(), x()]
- "scripts_modern_screenshot_umd_ft": "ft()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, dt(), jt()]
- "scripts_modern_screenshot_umd_j": "J()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, fe(), ue()]
- "scripts_modern_screenshot_umd_kt": "Kt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L14 | neighbors=[modern-screenshot.umd.js, k(), x()]
- "scripts_modern_screenshot_umd_me": "me()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, L(), ye()]
- "scripts_modern_screenshot_umd_ot": "Ot()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, de(), z()]
- "scripts_modern_screenshot_umd_p": "P()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, ae(), q()]
- "scripts_modern_screenshot_umd_se": "Se()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, Ct(), Tt()]
- "scripts_modern_screenshot_umd_st": "St()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, ne(), Tt()]
- "scripts_modern_screenshot_umd_tr": "tr()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L14 | neighbors=[modern-screenshot.umd.js, k(), x()]
- "scripts_modern_screenshot_umd_v": "v()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, jt(), x()]
- "scripts_modern_screenshot_umd_ve": "Ve()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, ne(), x()]
- "shared_board_bycustomer": "byCustomer()" | kind=code-symbol | source=shared/board.ts:L52 | neighbors=[fulfilment-routes.ts, board.ts, tally()]
- "shared_board_countcheckpoints": "countCheckpoints()" | kind=code-symbol | source=shared/board.ts:L43 | neighbors=[board.ts, tally(), insights.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-022.json

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
