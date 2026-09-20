# Node Description Batch 6 of 55

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
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "data_seed_seedusers": "seedUsers()" | kind=code-symbol | source=api/src/data/seed.ts:L113 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, forwarder(), handler(), iso()]
- "scripts_live_browser_buildcyclingrow": "buildCyclingRow()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2650 | neighbors=[live-browser.js, buildDots(), cyclingCounterText(), cyclingShownVariant(), el(), ensureCyclingRenderable()]
- "scripts_live_browser_disableinlineedit": "disableInlineEdit()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3461 | neighbors=[live-browser.js, applyEditing(), cancelEditing(), cancelEditingToPicking(), completeSourceInjection(), unwrapMixedContentTextNodes()]
- "scripts_live_browser_handleaccept": "handleAccept()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8700 | neighbors=[live-browser.js, findVariantsWrapper(), isFrameworkComponentPreviewMode(), readVisibleVariantFromDOM(), saveSession(), sendEvent()]
- "scripts_live_browser_hidehighlight": "hideHighlight()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L412 | neighbors=[live-browser.js, cancelEditingToPicking(), cancelInsertConfigure(), cleanup(), cleanupAcceptedSession(), exitConfigureToPicking()]
- "scripts_live_browser_injectvariantsfromsource": "injectVariantsFromSource()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6358 | neighbors=[live-browser.js, completeSourceInjection(), findVariantsWrapper(), injectSvelteComponentsFromManifest(), isJsxSourceFile(), isSvelteComponentManifestPath()]
- "scripts_live_browser_sendevent": "sendEvent()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7354 | neighbors=[live-browser.js, captureAndEmit(), discardOrphanedSession(), handleAccept(), handleDiscard(), maybePrefetchPage()]
- "scripts_live_browser_updateglobalbarstate": "updateGlobalBarState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11524 | neighbors=[live-browser.js, initGlobalBar(), onDetectMessage(), refreshLiveControlsForManualApply(), toggleDesignPanel(), toggleDetect()]
- "shared_enums_ordercheckpoint": "OrderCheckpoint" | kind=code-symbol | source=shared/enums.ts:L272 | neighbors=[LotPeople.tsx, fulfilment-routes.ts, LotsPage.tsx, ServicesPage.tsx, board.ts, enums.ts]
- "shared_models_dispute": "Dispute" | kind=code-symbol | source=shared/models.ts:L1013 | neighbors=[api.ts, cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, dispute-routes.ts]
- "commit:repo:github.com/swarnavarb/Figmark@03261702e9cfd24e2a58c8dd66d2eaeacb2ebaa5": "0326170 Maintenance ran in front of every request, on every cold worker" | kind=Commit | source=git | neighbors=[api.ts, DisputesView.tsx, main.tsx, UsersView.tsx, claude/figmark-connection-icpfax, claude/new-session-13ackt]
- "commit:repo:github.com/swarnavarb/Figmark@27d0f52e845d1261c48755d8fc518c8161a6692b": "27d0f52 Announcements are a choice the shop makes, not everything it says" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, f26bb32 Wanted: the half of the market …, social-routes.ts, SocialPage.tsx, smoke-api.mjs]
- "components_ui_avatar": "Avatar()" | kind=code-symbol | source=app/src/components/ui.tsx:L60 | neighbors=[ui.tsx, DisputePage.tsx, ForwardersPage.tsx, ListingPage.tsx, MessagesPage.tsx, ProfileByHandlePage.tsx]
- "scripts_azure_check": "azure-check.mjs" | kind=code-symbol | source=scripts/azure-check.mjs:L1 | neighbors=[f4ae77f The lot board: count the pieces…, describe(), failed, loadSettings(), record(), require]
- "scripts_live_browser_clearannotations": "clearAnnotations()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L547 | neighbors=[live-browser.js, cancelEditingToPicking(), cancelInsertConfigure(), updateClearChip(), handleClick(), handleGo()]
- "scripts_live_browser_handleserverlost": "handleServerLost()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7325 | neighbors=[live-browser.js, hideAnnotOverlay(), hideBar(), hideHighlight(), hideShaderOverlay(), saveSession()]
- "scripts_live_browser_initglobalbar": "initGlobalBar()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11085 | neighbors=[live-browser.js, init(), barPaletteForTheme(), brandMarkSvg(), detectPageTheme(), el()]
- "scripts_live_browser_refreshlivecontrolsformanualapply": "refreshLiveControlsForManualApply()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3996 | neighbors=[live-browser.js, hidePendingApplyDock(), closeTunePopover(), hasTextRows(), hideActionPicker(), renderEditBadge()]
- "scripts_live_browser_unlocksteerchat": "unlockSteerChat()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10419 | neighbors=[live-browser.js, maybeCompleteSteer(), clearSteerAwaitTimer(), focusPageChatInput(), pageChatExpandedWidth(), sendSteerCheckpoint()]
- "scripts_modern_screenshot_umd_x": "x()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L14 | neighbors=[modern-screenshot.umd.js, er(), fe(), Kt(), qt(), tr()]
- "shared_handles_checkusername": "checkUsername()" | kind=code-symbol | source=shared/handles.ts:L37 | neighbors=[mock-provider.ts, cosmos-repository.ts, message-routes.ts, seller-routes.ts, AuthPage.tsx, ProfileByHandlePage.tsx]
- "shared_models_post": "Post" | kind=code-symbol | source=shared/models.ts:L1058 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, power-sale.ts, social-routes.ts]
- "shared_models_review": "Review" | kind=code-symbol | source=shared/models.ts:L910 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, order-routes.ts, profile-routes.ts]
- "shared_parties_personref": "personRef()" | kind=code-symbol | source=shared/parties.ts:L44 | neighbors=[catalog-routes.ts, dispute-routes.ts, insight-routes.ts, order-routes.ts, preorder.ts, profile-routes.ts]
- "shared_preorder": "preorder.ts" | kind=code-symbol | source=shared/preorder.ts:L1 | neighbors=[8992ccb A fill meter you can join, and …, preorder.ts, FeedPage.tsx, index.ts, models.ts, PreOrder]
- "storage_memory_store": "memory-store.ts" | kind=code-symbol | source=api/src/storage/memory-store.ts:L1 | neighbors=[a5a184e Orders, Track, and the statione…, f4ae77f The lot board: count the pieces…, blob-store.ts, index.ts, extensionFor(), MemoryPhotoStore]
- "commit:repo:github.com/swarnavarb/Figmark@0f3553524d3896abd1c88e16f39fc9fe6c667fba": "0f35535 Add the Impeccable design skill" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 8cf0d9b Give Figmark a vibrant colour i…, live-browser.js, live-browser-dom.js, live-browser-ignores.js]
- "commit:repo:github.com/swarnavarb/Figmark@a2f74f9d3cafb2dc4d701cb303b68a8b7910cece": "a2f74f9 A channel is a shop's room, and it can be spoken in" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 27d0f52 Announcements are a choice the …, social-routes.ts, SocialPage.tsx, smoke-api.mjs]
- "functions_admin_routes_operator": "operator()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L32 | neighbors=[admin-routes.ts, deleteAccount(), deleteResource(), disputes(), escrowRights(), resolveDispute()]
- "functions_order_routes_ownorder": "ownOrder()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L41 | neighbors=[order-routes.ts, checkout(), claimPayment(), confirm(), orderState(), pay()]
- "scripts_live_browser_abortsveltecomponentinjection": "abortSvelteComponentInjection()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6127 | neighbors=[live-browser.js, hideBar(), hideShaderOverlay(), removeVariantStateStylesheet(), saveSession(), showMountErrorCard()]
- "scripts_live_browser_cancelediting": "cancelEditing()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3539 | neighbors=[live-browser.js, applyEditing(), disableInlineEdit(), renderEditBadge(), restoreInlineEditDrafts(), setLiveState()]
- "scripts_live_browser_escapehtml": "escapeHtml()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12916 | neighbors=[live-browser.js, buildCollapsible(), inlineMd(), renderColorTiles(), renderComponentTiles(), renderMarkdown()]
- "scripts_live_browser_focussteerchat": "focusSteerChat()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10257 | neighbors=[live-browser.js, shouldFocusSteerChat(), shouldSteerAutoFocus(), steerFocusLog(), steerFocusTargetLabel(), syncPageChatChrome()]
- "scripts_live_browser_hideannotoverlay": "hideAnnotOverlay()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L526 | neighbors=[live-browser.js, cancelEditingToPicking(), cancelInsertConfigure(), enterEditingMode(), handleGo(), handleInsertCreate()]
- "scripts_live_browser_hideshaderoverlay": "hideShaderOverlay()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L8533 | neighbors=[live-browser.js, abortSvelteComponentInjection(), completeSourceInjection(), handleServerLost(), removeStrayShaderNode(), injectSvelteComponentsFromManifest()]
- "scripts_live_browser_isframeworkcomponentpreviewmode": "isFrameworkComponentPreviewMode()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5021 | neighbors=[live-browser.js, handleAccept(), injectSvelteComponentsFromManifest(), recoverMissedGenerationCompletion(), rememberSessionFileMeta(), restoreFromActiveSessions()]
- "scripts_live_browser_showvariantindom": "showVariantInDOM()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4997 | neighbors=[live-browser.js, completeSourceInjection(), resumeSession(), findVariantsWrapper(), mountSvelteComponentVariant(), refreshParamsPanel()]
- "scripts_live_browser_startvoice": "startVoice()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10576 | neighbors=[live-browser.js, isEmbeddedPreviewBrowser(), releaseVoiceEngine(), showToast(), steerSpeechRecognitionCtor(), steerVoiceUnavailableMessage()]
- "scripts_live_browser_syncagentpollingui": "syncAgentPollingUi()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10984 | neighbors=[live-browser.js, initGlobalBar(), agentHasWorkInFlight(), agentStatusText(), barPaletteForTheme(), brandMarkSvg()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-005.json

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
