# Node Description Batch 52 of 55

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

- "scripts_smoke_api_repository_dispute": "repository_dispute()" | kind=code-symbol | source=scripts/smoke-api.mjs:L116 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_repository_user": "repository_user()" | kind=code-symbol | source=scripts/smoke-api.mjs:L115 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_saleitem": "saleItem()" | kind=code-symbol | source=scripts/smoke-api.mjs:L3426 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_sessioncookie": "sessionCookie" | kind=code-symbol | source=scripts/smoke-api.mjs:L222 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_shopless": "shopless" | kind=code-symbol | source=scripts/smoke-api.mjs:L1446 | neighbors=[smoke-api.mjs]
- "scripts_smoke_api_visitorauth": "visitorAuth" | kind=code-symbol | source=scripts/smoke-api.mjs:L2380 | neighbors=[smoke-api.mjs]
- "scripts_smoke_auth_auth": "auth" | kind=code-symbol | source=scripts/smoke-auth.mjs:L21 | neighbors=[smoke-auth.mjs]
- "scripts_smoke_auth_base": "base" | kind=code-symbol | source=scripts/smoke-auth.mjs:L10 | neighbors=[smoke-auth.mjs]
- "scripts_smoke_auth_bearer": "bearer" | kind=code-symbol | source=scripts/smoke-auth.mjs:L138 | neighbors=[smoke-auth.mjs]
- "scripts_smoke_auth_repository": "repository" | kind=code-symbol | source=scripts/smoke-auth.mjs:L19 | neighbors=[smoke-auth.mjs]
- "scripts_smoke_auth_requestwith": "requestWith()" | kind=code-symbol | source=scripts/smoke-auth.mjs:L17 | neighbors=[smoke-auth.mjs]
- "scripts_smoke_auth_stubstore": "stubStore()" | kind=code-symbol | source=scripts/smoke-auth.mjs:L395 | neighbors=[smoke-auth.mjs]
- "scripts_smoke_cosmos_seed_base": "base" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L17 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_calls": "calls" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L38 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_check": "check()" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L25 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_containers": "containers" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L141 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_fakecontainer": "fakeContainer()" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L42 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_halfseeded": "halfSeeded" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L191 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_provisioned": "provisioned()" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L135 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_repaired": "repaired" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L193 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_repository": "repository" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L142 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_repositoryon": "repositoryOn()" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L90 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_resetcalls": "resetCalls()" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L39 | neighbors=[smoke-cosmos-seed.mjs]
- "scripts_smoke_cosmos_seed_unreachable": "unreachable" | kind=code-symbol | source=scripts/smoke-cosmos-seed.mjs:L501 | neighbors=[smoke-cosmos-seed.mjs]
- "shared_board_isticked": "isTicked()" | kind=code-symbol | source=shared/board.ts:L38 | neighbors=[board.ts]
- "shared_catalog_catalogkind": "CatalogKind" | kind=code-symbol | source=shared/catalog.ts:L99 | neighbors=[catalog.ts]
- "shared_catalog_catalogsort": "CatalogSort" | kind=code-symbol | source=shared/catalog.ts:L118 | neighbors=[catalog.ts]
- "shared_catalog_category": "Category" | kind=code-symbol | source=shared/catalog.ts:L36 | neighbors=[catalog.ts]
- "shared_catalog_categorygroup": "CategoryGroup" | kind=code-symbol | source=shared/catalog.ts:L48 | neighbors=[catalog.ts]
- "shared_catalog_kindshape": "KindShape" | kind=code-symbol | source=shared/catalog.ts:L128 | neighbors=[catalog.ts]
- "shared_catalog_searchshape": "SearchShape" | kind=code-symbol | source=shared/catalog.ts:L164 | neighbors=[catalog.ts]
- "shared_containers_containerdefinition": "ContainerDefinition" | kind=code-symbol | source=shared/containers.ts:L19 | neighbors=[containers.ts]
- "shared_containers_containername": "ContainerName" | kind=code-symbol | source=shared/containers.ts:L257 | neighbors=[containers.ts]
- "shared_enums_capabilities": "CAPABILITIES" | kind=code-symbol | source=shared/enums.ts:L18 | neighbors=[enums.ts]
- "shared_enums_dispute_statuses": "DISPUTE_STATUSES" | kind=code-symbol | source=shared/enums.ts:L134 | neighbors=[enums.ts]
- "shared_enums_escrow_states": "ESCROW_STATES" | kind=code-symbol | source=shared/enums.ts:L131 | neighbors=[enums.ts]
- "shared_enums_listing_statuses": "LISTING_STATUSES" | kind=code-symbol | source=shared/enums.ts:L104 | neighbors=[enums.ts]
- "shared_enums_lot_statuses": "LOT_STATUSES" | kind=code-symbol | source=shared/enums.ts:L101 | neighbors=[enums.ts]
- "shared_enums_order_statuses": "ORDER_STATUSES" | kind=code-symbol | source=shared/enums.ts:L107 | neighbors=[enums.ts]
- "shared_enums_payment_statuses": "PAYMENT_STATUSES" | kind=code-symbol | source=shared/enums.ts:L124 | neighbors=[enums.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-051.json

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
