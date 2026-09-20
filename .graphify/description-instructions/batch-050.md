# Node Description Batch 51 of 55

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

- "scripts_live_browser_dom_createlivebrowserdomhelpers": "createLiveBrowserDomHelpers()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-dom.js:L12 | neighbors=[live-browser-dom.js]
- "scripts_live_browser_findprosedescription": "findProseDescription()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12418 | neighbors=[live-browser.js]
- "scripts_live_browser_humanizekey": "humanizeKey()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12414 | neighbors=[live-browser.js]
- "scripts_live_browser_ignores_globtoregex": "globToRegex()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-ignores.js:L59 | neighbors=[live-browser-ignores.js]
- "scripts_live_browser_isinsertcreateenabled": "isInsertCreateEnabled()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2291 | neighbors=[live-browser.js]
- "scripts_live_browser_ismeaningfulmanualcontextpiece": "isMeaningfulManualContextPiece()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1068 | neighbors=[live-browser.js]
- "scripts_live_browser_keepsteerpointerinside": "keepSteerPointerInside()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10310 | neighbors=[live-browser.js]
- "scripts_live_browser_normalizecsscolor": "normalizeCssColor()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12788 | neighbors=[live-browser.js]
- "scripts_live_browser_oninlineinput": "onInlineInput()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3481 | neighbors=[live-browser.js]
- "scripts_live_browser_positionpendingdock": "positionPendingDock()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3827 | neighbors=[live-browser.js]
- "scripts_live_browser_proxymouseevent": "proxyMouseEvent()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4550 | neighbors=[live-browser.js]
- "scripts_live_browser_rationale_5317": "NOTE: the compiled component imported from the dev server already carries" | kind=entity | source=.agents/skills/impeccable/scripts/live-browser.js:L5317 | neighbors=[live-browser.js]
- "scripts_live_browser_rationale_6923": "NOTE: do NOT clear the persistent scroll key here. startScrollLock" | kind=entity | source=.agents/skills/impeccable/scripts/live-browser.js:L6923 | neighbors=[live-browser.js]
- "scripts_live_browser_rationale_8097": "TODO: Enable this proxy for React/Vue/etc. adapters once their live" | kind=entity | source=.agents/skills/impeccable/scripts/live-browser.js:L8097 | neighbors=[live-browser.js]
- "scripts_live_browser_rationale_9204": "NOTE: scrollY is stored under a separate key (writeScrollY). Storing" | kind=entity | source=.agents/skills/impeccable/scripts/live-browser.js:L9204 | neighbors=[live-browser.js]
- "scripts_live_browser_savedesignprefs": "saveDesignPrefs()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L11819 | neighbors=[live-browser.js]
- "scripts_live_browser_session_createlivebrowsersessionstate": "createLiveBrowserSessionState()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser-session.js:L11 | neighbors=[live-browser-session.js]
- "scripts_live_browser_shouldadvancephase": "shouldAdvancePhase()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L158 | neighbors=[live-browser.js]
- "scripts_live_browser_sourcehassessionwrapper": "sourceHasSessionWrapper()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L6220 | neighbors=[live-browser.js]
- "scripts_live_browser_splitfontfamily": "splitFontFamily()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12408 | neighbors=[live-browser.js]
- "scripts_live_browser_unwrapsvelteglobalselector": "unwrapSvelteGlobalSelector()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5431 | neighbors=[live-browser.js]
- "scripts_live_browser_variantcounttooltiptext": "variantCountTooltipText()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1469 | neighbors=[live-browser.js]
- "scripts_modern_screenshot_umd_ge": "ge()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js]
- "scripts_modern_screenshot_umd_oe": "oe()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L10 | neighbors=[modern-screenshot.umd.js]
- "scripts_provision_cosmos_cosmosclient": "{ CosmosClient }" | kind=code-symbol | source=scripts/provision-cosmos.mjs:L66 | neighbors=[provision-cosmos.mjs]
- "scripts_provision_cosmos_loadsettings": "loadSettings()" | kind=code-symbol | source=scripts/provision-cosmos.mjs:L44 | neighbors=[provision-cosmos.mjs]
- "scripts_provision_cosmos_require": "require" | kind=code-symbol | source=scripts/provision-cosmos.mjs:L25 | neighbors=[provision-cosmos.mjs]
- "scripts_smoke_api_auth": "auth" | kind=code-symbol | source=scripts/smoke-api.mjs:L207 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_bystanderauth": "bystanderAuth" | kind=code-symbol | source=scripts/smoke-api.mjs:L2635 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_check": "check()" | kind=code-symbol | source=scripts/smoke-api.mjs:L141 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_cookieauth": "cookieAuth" | kind=code-symbol | source=scripts/smoke-api.mjs:L232 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_ctx": "ctx" | kind=code-symbol | source=scripts/smoke-api.mjs:L111 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_directauth": "directAuth" | kind=code-symbol | source=scripts/smoke-api.mjs:L1841 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_escrow": "escrow" | kind=code-symbol | source=scripts/smoke-api.mjs:L2200 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_expirecampaign": "expireCampaign()" | kind=code-symbol | source=scripts/smoke-api.mjs:L122 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_fns": "fns" | kind=code-symbol | source=scripts/smoke-api.mjs:L10 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_helper": "helper" | kind=code-symbol | source=scripts/smoke-api.mjs:L1129 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_meanscore": "meanScore()" | kind=code-symbol | source=scripts/smoke-api.mjs:L2148 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_noticesfor": "noticesFor()" | kind=code-symbol | source=scripts/smoke-api.mjs:L119 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_packer": "packer" | kind=code-symbol | source=scripts/smoke-api.mjs:L1571 | neighbors=[smoke-api.mjs]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-050.json

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
