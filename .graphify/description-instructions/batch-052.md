# Node Description Batch 53 of 55

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

- "shared_enums_seller_tiers": "SELLER_TIERS" | kind=code-symbol | source=shared/enums.ts:L34 | neighbors=[enums.ts]
- "shared_enums_verification_statuses": "VERIFICATION_STATUSES" | kind=code-symbol | source=shared/enums.ts:L25 | neighbors=[enums.ts]
- "shared_fulfilment_nextstage": "nextStage()" | kind=code-symbol | source=shared/fulfilment.ts:L101 | neighbors=[fulfilment.ts]
- "shared_fulfilment_pre_lot_stages": "PRE_LOT_STAGES" | kind=code-symbol | source=shared/fulfilment.ts:L56 | neighbors=[fulfilment.ts]
- "shared_fulfilment_preorderopen": "preOrderOpen()" | kind=code-symbol | source=shared/fulfilment.ts:L107 | neighbors=[fulfilment.ts]
- "shared_handles_taken": "TAKEN" | kind=code-symbol | source=shared/handles.ts:L27 | neighbors=[handles.ts]
- "shared_handles_usernameproblem": "UsernameProblem" | kind=code-symbol | source=shared/handles.ts:L34 | neighbors=[handles.ts]
- "shared_insights_boxclass": "BoxClass" | kind=code-symbol | source=shared/insights.ts:L44 | neighbors=[insights.ts]
- "shared_insights_boxclassfor": "boxClassFor()" | kind=code-symbol | source=shared/insights.ts:L61 | neighbors=[insights.ts]
- "shared_insights_large_words": "LARGE_WORDS" | kind=code-symbol | source=shared/insights.ts:L55 | neighbors=[insights.ts]
- "shared_insights_mini_words": "MINI_WORDS" | kind=code-symbol | source=shared/insights.ts:L54 | neighbors=[insights.ts]
- "shared_insights_progress": "PROGRESS" | kind=code-symbol | source=shared/insights.ts:L219 | neighbors=[insights.ts]
- "shared_insights_segment": "Segment" | kind=code-symbol | source=shared/insights.ts:L146 | neighbors=[insights.ts]
- "shared_models_disputeoffer": "DisputeOffer" | kind=code-symbol | source=shared/models.ts:L994 | neighbors=[models.ts]
- "shared_models_disputeresolution": "DisputeResolution" | kind=code-symbol | source=shared/models.ts:L1003 | neighbors=[models.ts]
- "shared_models_escrowrecord": "EscrowRecord" | kind=code-symbol | source=shared/models.ts:L891 | neighbors=[models.ts]
- "shared_models_forwarderroute": "ForwarderRoute" | kind=code-symbol | source=shared/models.ts:L287 | neighbors=[models.ts]
- "shared_models_listingphoto": "ListingPhoto" | kind=code-symbol | source=shared/models.ts:L357 | neighbors=[models.ts]
- "shared_models_lotcostmodel": "LotCostModel" | kind=code-symbol | source=shared/models.ts:L737 | neighbors=[models.ts]
- "shared_models_lotforwarder": "LotForwarder" | kind=code-symbol | source=shared/models.ts:L723 | neighbors=[models.ts]
- "shared_models_lothandler": "LotHandler" | kind=code-symbol | source=shared/models.ts:L682 | neighbors=[models.ts]
- "shared_models_orderprotection": "OrderProtection" | kind=code-symbol | source=shared/models.ts:L873 | neighbors=[models.ts]
- "shared_models_postchannel": "PostChannel" | kind=code-symbol | source=shared/models.ts:L1047 | neighbors=[models.ts]
- "shared_models_postkind": "PostKind" | kind=code-symbol | source=shared/models.ts:L1050 | neighbors=[models.ts]
- "shared_models_postreach": "PostReach" | kind=code-symbol | source=shared/models.ts:L1056 | neighbors=[models.ts]
- "shared_models_postvoice": "PostVoice" | kind=code-symbol | source=shared/models.ts:L1053 | neighbors=[models.ts]
- "shared_models_powersalestatus": "PowerSaleStatus" | kind=code-symbol | source=shared/models.ts:L1284 | neighbors=[models.ts]
- "shared_models_wantstatus": "WantStatus" | kind=code-symbol | source=shared/models.ts:L1157 | neighbors=[models.ts]
- "shared_routes_basedocument": "BaseDocument" | kind=code-symbol | neighbors=[TrackingRoute]
- "shared_routes_built_in_descriptions": "BUILT_IN_DESCRIPTIONS" | kind=code-symbol | source=shared/routes.ts:L245 | neighbors=[routes.ts]
- "shared_routes_built_in_sides": "BUILT_IN_SIDES" | kind=code-symbol | source=shared/routes.ts:L256 | neighbors=[routes.ts]
- "shared_routes_built_in_triggers": "BUILT_IN_TRIGGERS" | kind=code-symbol | source=shared/routes.ts:L266 | neighbors=[routes.ts]
- "shared_routes_hassteps": "HasSteps" | kind=code-symbol | source=shared/routes.ts:L112 | neighbors=[routes.ts]
- "shared_routes_poststeps": "postSteps()" | kind=code-symbol | source=shared/routes.ts:L125 | neighbors=[routes.ts]
- "shared_routes_presetstep": "PresetStep" | kind=code-symbol | source=shared/routes.ts:L293 | neighbors=[routes.ts]
- "shared_routes_routepreset": "RoutePreset" | kind=code-symbol | source=shared/routes.ts:L301 | neighbors=[routes.ts]
- "shared_routes_stepstate": "StepState" | kind=code-symbol | source=shared/routes.ts:L521 | neighbors=[routes.ts]
- "shared_routes_ticks": "Ticks" | kind=code-symbol | source=shared/routes.ts:L159 | neighbors=[routes.ts]
- "shared_services_provides": "provides()" | kind=code-symbol | source=shared/services.ts:L138 | neighbors=[services.ts]
- "shared_services_service_kinds": "SERVICE_KINDS" | kind=code-symbol | source=shared/services.ts:L22 | neighbors=[services.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-052.json

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
