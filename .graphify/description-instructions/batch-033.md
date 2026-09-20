# Node Description Batch 34 of 55

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

- "scripts_modern_screenshot_umd_et": "Et()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, Tt()]
- "scripts_modern_screenshot_umd_gt": "Gt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L10 | neighbors=[modern-screenshot.umd.js, _e()]
- "scripts_modern_screenshot_umd_ht": "ht()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, ye()]
- "scripts_modern_screenshot_umd_ie": "Ie()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, Re()]
- "scripts_modern_screenshot_umd_it": "It()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, ne()]
- "scripts_modern_screenshot_umd_lt": "Lt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, Re()]
- "scripts_modern_screenshot_umd_mt": "Mt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, de()]
- "scripts_modern_screenshot_umd_pt": "pt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, ye()]
- "scripts_modern_screenshot_umd_t": "_t()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, ne()]
- "scripts_modern_screenshot_umd_ue": "ue()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, J()]
- "scripts_modern_screenshot_umd_ut": "ut()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, ye()]
- "scripts_modern_screenshot_umd_vt": "vt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L6 | neighbors=[modern-screenshot.umd.js, Ee()]
- "scripts_modern_screenshot_umd_w": "W()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, ae()]
- "scripts_modern_screenshot_umd_we": "we()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, ne()]
- "scripts_modern_screenshot_umd_wt": "wt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L1 | neighbors=[modern-screenshot.umd.js, ye()]
- "scripts_modern_screenshot_umd_zt": "Zt()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L14 | neighbors=[modern-screenshot.umd.js, k()]
- "scripts_smoke_api_day": "day()" | kind=code-symbol | source=scripts/smoke-api.mjs:L3803 | neighbors=[smoke-api.mjs, order()]
- "scripts_smoke_api_newbuyer": "newBuyer()" | kind=code-symbol | source=scripts/smoke-api.mjs:L3068 | neighbors=[smoke-api.mjs, req()]
- "scripts_smoke_api_opencampaign": "openCampaign()" | kind=code-symbol | source=scripts/smoke-api.mjs:L3049 | neighbors=[smoke-api.mjs, req()]
- "scripts_smoke_api_order": "order()" | kind=code-symbol | source=scripts/smoke-api.mjs:L3804 | neighbors=[smoke-api.mjs, day()]
- "scripts_smoke_api_waitingitem": "waitingItem()" | kind=code-symbol | source=scripts/smoke-api.mjs:L4293 | neighbors=[smoke-api.mjs, req()]
- "scripts_smoke_auth_check": "check()" | kind=code-symbol | source=scripts/smoke-auth.mjs:L24 | neighbors=[smoke-auth.mjs, expectAuthError()]
- "scripts_smoke_auth_expectautherror": "expectAuthError()" | kind=code-symbol | source=scripts/smoke-auth.mjs:L29 | neighbors=[smoke-auth.mjs, check()]
- "shared_board_checkpointcount": "CheckpointCount" | kind=code-symbol | source=shared/board.ts:L18 | neighbors=[board.ts, insights.ts]
- "shared_capabilities_istransactable": "isTransactable()" | kind=code-symbol | source=shared/capabilities.ts:L27 | neighbors=[capabilities.ts, deriveCapabilities()]
- "shared_capabilities_usercapabilities": "UserCapabilities" | kind=code-symbol | source=shared/capabilities.ts:L12 | neighbors=[capabilities.ts, contracts.ts]
- "shared_catalog_catalog_kind_labels": "CATALOG_KIND_LABELS" | kind=code-symbol | source=shared/catalog.ts:L101 | neighbors=[FeedPage.tsx, catalog.ts]
- "shared_catalog_catalog_kinds": "CATALOG_KINDS" | kind=code-symbol | source=shared/catalog.ts:L98 | neighbors=[FeedPage.tsx, catalog.ts]
- "shared_catalog_catalog_sort_labels": "CATALOG_SORT_LABELS" | kind=code-symbol | source=shared/catalog.ts:L120 | neighbors=[FeedPage.tsx, catalog.ts]
- "shared_catalog_catalog_sorts": "CATALOG_SORTS" | kind=code-symbol | source=shared/catalog.ts:L117 | neighbors=[FeedPage.tsx, catalog.ts]
- "shared_catalog_categoriesin": "categoriesIn()" | kind=code-symbol | source=shared/catalog.ts:L87 | neighbors=[catalog-routes.ts, catalog.ts]
- "shared_catalog_category_groups": "CATEGORY_GROUPS" | kind=code-symbol | source=shared/catalog.ts:L71 | neighbors=[FeedPage.tsx, catalog.ts]
- "shared_catalog_matcheskind": "matchesKind()" | kind=code-symbol | source=shared/catalog.ts:L143 | neighbors=[memory-repository.ts, catalog.ts]
- "shared_containers_container_list": "CONTAINER_LIST" | kind=code-symbol | source=shared/containers.ts:L259 | neighbors=[cosmos-repository.ts, containers.ts]
- "shared_containers_containerbody": "containerBody()" | kind=code-symbol | source=shared/containers.ts:L274 | neighbors=[cosmos-repository.ts, containers.ts]
- "shared_disputes_disputeaction": "DisputeAction" | kind=code-symbol | source=shared/disputes.ts:L37 | neighbors=[disputes.ts, api.ts]
- "shared_disputes_feerefunded": "feeRefunded()" | kind=code-symbol | source=shared/disputes.ts:L122 | neighbors=[dispute-routes.ts, disputes.ts]
- "shared_disputes_loserof": "loserOf()" | kind=code-symbol | source=shared/disputes.ts:L112 | neighbors=[dispute-routes.ts, disputes.ts]
- "shared_disputes_splitfor": "splitFor()" | kind=code-symbol | source=shared/disputes.ts:L87 | neighbors=[dispute-routes.ts, disputes.ts]
- "shared_enums_buyer_dispute_reasons": "BUYER_DISPUTE_REASONS" | kind=code-symbol | source=shared/enums.ts:L176 | neighbors=[disputes.ts, enums.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-033.json

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
