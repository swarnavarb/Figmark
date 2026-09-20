# Node Description Batch 43 of 55

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

- "functions_catalog_routes_forwarders": "forwarders()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L558 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_forwardersroute": "forwardersRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L593 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_listingdetailroute": "listingDetailRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L585 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_myactivity": "myActivity()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L531 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_myactivityroute": "myActivityRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L592 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_togglefollow": "toggleFollow()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L386 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_togglefollowroute": "toggleFollowRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L590 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_togglelike": "toggleLike()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L328 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_togglelikeroute": "toggleLikeRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L587 | neighbors=[catalog-routes.ts]
- "functions_dispute_routes_acceptdisputeroute": "acceptDisputeRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L627 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L631 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_escalatedisputeroute": "escalateDisputeRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L629 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_escrowholdingsroute": "escrowHoldingsRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L623 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_holdings": "holdings()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L570 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_offerdisputeroute": "offerDisputeRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L626 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_opendisputeroute": "openDisputeRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L621 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_readdisputeroute": "readDisputeRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L624 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_replydisputeroute": "replyDisputeRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L625 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L46 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_settleasescrowroute": "settleAsEscrowRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L622 | neighbors=[dispute-routes.ts]
- "functions_dispute_routes_withdrawdisputeroute": "withdrawDisputeRoute" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L628 | neighbors=[dispute-routes.ts]
- "functions_fulfilment_routes_advancestageroute": "advanceStageRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1093 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1099 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_assigntolotroute": "assignToLotRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1092 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_createlotroute": "createLotRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1090 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_lotboardroute": "lotBoardRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1087 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_lotcontentsroute": "lotContentsRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1091 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_lotdetailsbody": "LotDetailsBody" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L41 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_lotorrefusal": "LotOrRefusal" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L202 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_lotsboardroute": "lotsBoardRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1086 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_mylotsroute": "myLotsRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1089 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_ordertracking": "orderTracking()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L653 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_ordertrackingroute": "orderTrackingRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1097 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_packable_stages": "PACKABLE_STAGES" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L988 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_setcheckpointroute": "setCheckpointRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1088 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_setcrewroute": "setCrewRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1095 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_settrackingroute": "setTrackingRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1094 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_supplierlotroute": "supplierLotRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1085 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_supplierlots": "supplierLots()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L990 | neighbors=[fulfilment-routes.ts]
- "functions_fulfilment_routes_supplierlotsroute": "supplierLotsRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1084 | neighbors=[fulfilment-routes.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-042.json

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
