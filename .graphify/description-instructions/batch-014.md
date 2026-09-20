# Node Description Batch 15 of 55

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

- "data_seed_seedfollows": "seedFollows()" | kind=code-symbol | source=api/src/data/seed.ts:L1012 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]
- "data_seed_seedforums": "seedForums()" | kind=code-symbol | source=api/src/data/seed.ts:L1041 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]
- "data_seed_seedlikes": "seedLikes()" | kind=code-symbol | source=api/src/data/seed.ts:L1023 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]
- "data_seed_seedlots": "seedLots()" | kind=code-symbol | source=api/src/data/seed.ts:L595 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]
- "data_seed_seedopenlot": "seedOpenLot()" | kind=code-symbol | source=api/src/data/seed.ts:L1329 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]
- "data_seed_seedpledges": "seedPledges()" | kind=code-symbol | source=api/src/data/seed.ts:L891 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, seededCounts()]
- "data_seed_seedshippedlot": "seedShippedLot()" | kind=code-symbol | source=api/src/data/seed.ts:L1291 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]
- "data_seed_seedwantoffers": "seedWantOffers()" | kind=code-symbol | source=api/src/data/seed.ts:L937 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]
- "functions_admin_routes_row": "row()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L38 | neighbors=[admin-routes.ts, escrowRights(), suspend(), userDetail()]
- "functions_admin_routes_userdetail": "userDetail()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L88 | neighbors=[admin-routes.ts, deletionBlockers(), operator(), row()]
- "functions_dispute_routes_open": "open()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L211 | neighbors=[dispute-routes.ts, evidenceFrom(), message(), note()]
- "functions_dispute_routes_reply": "reply()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L333 | neighbors=[dispute-routes.ts, evidenceFrom(), message(), ownDispute()]
- "functions_fulfilment_routes_buildlot": "buildLot()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L206 | neighbors=[fulfilment-routes.ts, createLot(), supplierFrom(), template-routes.ts]
- "functions_http_toerrorresponse": "toErrorResponse()" | kind=code-symbol | source=api/src/functions/http.ts:L51 | neighbors=[http.ts, error(), json(), storeStatus()]
- "functions_insight_routes_insights": "insights()" | kind=code-symbol | source=api/src/functions/insight-routes.ts:L70 | neighbors=[insight-routes.ts, names(), shaped(), shopFor()]
- "functions_message_routes_handlesfor": "handlesFor()" | kind=code-symbol | source=api/src/functions/message-routes.ts:L27 | neighbors=[message-routes.ts, inbox(), send(), thread()]
- "functions_message_routes_send": "send()" | kind=code-symbol | source=api/src/functions/message-routes.ts:L185 | neighbors=[message-routes.ts, defaultVoice(), handlesFor(), partyFor()]
- "functions_message_routes_thread": "thread()" | kind=code-symbol | source=api/src/functions/message-routes.ts:L154 | neighbors=[message-routes.ts, defaultVoice(), handlesFor(), partyFor()]
- "functions_order_routes_checkout": "checkout()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L212 | neighbors=[order-routes.ts, hasAnyDetail(), ownOrder(), suggestEscrow()]
- "functions_order_routes_release": "release()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L72 | neighbors=[order-routes.ts, confirm(), note(), settle()]
- "functions_power_sale_routes_card": "card()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L82 | neighbors=[power-sale-routes.ts, create(), read(), stop()]
- "functions_power_sale_routes_readitem": "readItem()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L141 | neighbors=[power-sale-routes.ts, create(), positive(), trimmed()]
- "functions_preorder_reconcilepreorder": "reconcilePreOrder()" | kind=code-symbol | source=api/src/functions/preorder.ts:L89 | neighbors=[catalog-routes.ts, preorder.ts, counts(), preorder-routes.ts]
- "functions_preorder_rosterof": "rosterOf()" | kind=code-symbol | source=api/src/functions/preorder.ts:L227 | neighbors=[catalog-routes.ts, preorder.ts, viewOf(), preorder-routes.ts]
- "functions_service_routes_lotsnaming": "lotsNaming()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L299 | neighbors=[service-routes.ts, consignments(), distribution(), distributionDetail()]
- "functions_want_routes_card": "card()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L36 | neighbors=[want-routes.ts, close(), post(), readWant()]
- "pages_profilebyhandlepage_profilebyhandlepage": "ProfileByHandlePage()" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L31 | neighbors=[ProfileByHandlePage.tsx, gradeFor(), withScheme(), main.tsx]
- "scripts_live_browser_abandonforeignsession": "abandonForeignSession()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7396 | neighbors=[live-browser.js, cleanup(), markSessionHandled(), showToast()]
- "scripts_live_browser_agenthasworkinflight": "agentHasWorkInFlight()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10969 | neighbors=[live-browser.js, agentStatusText(), steerQueuedBehindGeneration(), syncAgentPollingUi()]
- "scripts_live_browser_applyconfigurebarchrome": "applyConfigureBarChrome()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1240 | neighbors=[live-browser.js, syncConfigureInputChrome(), showBar(), updateBarContent()]
- "scripts_live_browser_applyoriginalattrstosvelteanchor": "applyOriginalAttrsToSvelteAnchor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5732 | neighbors=[live-browser.js, parseOriginalMarkupElement(), commitAcceptedSvelteComponentToDom(), mountSvelteComponentVariant()]
- "scripts_live_browser_applyparamdefaults": "applyParamDefaults()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3211 | neighbors=[live-browser.js, applyParamValue(), openTunePopover(), refreshParamsPanel()]
- "scripts_live_browser_applysavedsessionmeta": "applySavedSessionMeta()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9008 | neighbors=[live-browser.js, rememberSessionFileMeta(), restoreSessionWithoutWrapper(), resumeSession()]
- "scripts_live_browser_beginnewliveconfiguration": "beginNewLiveConfiguration()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2046 | neighbors=[live-browser.js, setLiveState(), handleClick(), handleKeyDown()]
- "scripts_live_browser_buildannotationsforcapture": "buildAnnotationsForCapture()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L899 | neighbors=[live-browser.js, buildPinElement(), pointsToPath(), captureElementToBlob()]
- "scripts_live_browser_buildconfiguresubmitbutton": "buildConfigureSubmitButton()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1649 | neighbors=[live-browser.js, buildConfigureRow(), el(), buildInsertConfigureRow()]
- "scripts_live_browser_buildconfiguretrailingcluster": "buildConfigureTrailingCluster()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1630 | neighbors=[live-browser.js, buildConfigureRow(), el(), buildInsertConfigureRow()]
- "scripts_live_browser_buildconfigurevoicebutton": "buildConfigureVoiceButton()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1607 | neighbors=[live-browser.js, buildConfigureRow(), el(), buildInsertConfigureRow()]
- "scripts_live_browser_builddots": "buildDots()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2850 | neighbors=[live-browser.js, buildCyclingRow(), el(), buildGeneratingRow()]
- "scripts_live_browser_buildplaceholderresizehandles": "buildPlaceholderResizeHandles()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2184 | neighbors=[live-browser.js, cursorForPlaceholderEdge(), el(), syncPlaceholderResizeHandles()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-014.json

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
