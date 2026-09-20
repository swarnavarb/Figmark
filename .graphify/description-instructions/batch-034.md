# Node Description Batch 35 of 55

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

- "shared_enums_checkpoint_labels": "CHECKPOINT_LABELS" | kind=code-symbol | source=shared/enums.ts:L275 | neighbors=[LotPeople.tsx, enums.ts]
- "shared_enums_checkpoint_side": "CHECKPOINT_SIDE" | kind=code-symbol | source=shared/enums.ts:L295 | neighbors=[LotPeople.tsx, enums.ts]
- "shared_enums_direct_stage_labels": "DIRECT_STAGE_LABELS" | kind=code-symbol | source=shared/enums.ts:L81 | neighbors=[enums.ts, fulfilment.ts]
- "shared_enums_direct_stages": "DIRECT_STAGES" | kind=code-symbol | source=shared/enums.ts:L78 | neighbors=[enums.ts, fulfilment.ts]
- "shared_enums_directstage": "DirectStage" | kind=code-symbol | source=shared/enums.ts:L79 | neighbors=[enums.ts, fulfilment.ts]
- "shared_enums_dispute_reasons": "DISPUTE_REASONS" | kind=code-symbol | source=shared/enums.ts:L191 | neighbors=[dispute-routes.ts, enums.ts]
- "shared_enums_disputestatus": "DisputeStatus" | kind=code-symbol | source=shared/enums.ts:L141 | neighbors=[enums.ts, models.ts]
- "shared_enums_escrowstate": "EscrowState" | kind=code-symbol | source=shared/enums.ts:L132 | neighbors=[enums.ts, models.ts]
- "shared_enums_listingstatus": "ListingStatus" | kind=code-symbol | source=shared/enums.ts:L105 | neighbors=[enums.ts, models.ts]
- "shared_enums_lot_progress_checkpoints": "LOT_PROGRESS_CHECKPOINTS" | kind=code-symbol | source=shared/enums.ts:L310 | neighbors=[board.ts, enums.ts]
- "shared_enums_lotstatus": "LotStatus" | kind=code-symbol | source=shared/enums.ts:L102 | neighbors=[enums.ts, models.ts]
- "shared_enums_orderstatus": "OrderStatus" | kind=code-symbol | source=shared/enums.ts:L116 | neighbors=[enums.ts, models.ts]
- "shared_enums_paymentstatus": "PaymentStatus" | kind=code-symbol | source=shared/enums.ts:L125 | neighbors=[enums.ts, models.ts]
- "shared_enums_review_directions": "REVIEW_DIRECTIONS" | kind=code-symbol | source=shared/enums.ts:L213 | neighbors=[order-routes.ts, enums.ts]
- "shared_enums_reviewdirection": "ReviewDirection" | kind=code-symbol | source=shared/enums.ts:L218 | neighbors=[enums.ts, models.ts]
- "shared_enums_seller_dispute_reasons": "SELLER_DISPUTE_REASONS" | kind=code-symbol | source=shared/enums.ts:L184 | neighbors=[disputes.ts, enums.ts]
- "shared_enums_sellertier": "SellerTier" | kind=code-symbol | source=shared/enums.ts:L35 | neighbors=[enums.ts, models.ts]
- "shared_enums_store_permission_labels": "STORE_PERMISSION_LABELS" | kind=code-symbol | source=shared/enums.ts:L239 | neighbors=[ShopPage.tsx, enums.ts]
- "shared_enums_verificationstatus": "VerificationStatus" | kind=code-symbol | source=shared/enums.ts:L26 | neighbors=[enums.ts, models.ts]
- "shared_fulfilment_lotof": "lotOf()" | kind=code-symbol | source=shared/fulfilment.ts:L146 | neighbors=[fulfilment.ts, isLotEvent()]
- "shared_fulfilment_progressof": "progressOf()" | kind=code-symbol | source=shared/fulfilment.ts:L79 | neighbors=[fulfilment.ts, stagesFor()]
- "shared_handles_threadidfor": "threadIdFor()" | kind=code-symbol | source=shared/handles.ts:L77 | neighbors=[message-routes.ts, handles.ts]
- "shared_insights_aggregatebox": "aggregateBox()" | kind=code-symbol | source=shared/insights.ts:L77 | neighbors=[insights.ts, packingEstimate()]
- "shared_insights_boxestimate": "BoxEstimate" | kind=code-symbol | source=shared/insights.ts:L84 | neighbors=[insights.ts, api.ts]
- "shared_insights_doortodoor": "doorToDoor()" | kind=code-symbol | source=shared/insights.ts:L198 | neighbors=[insight-routes.ts, insights.ts]
- "shared_insights_lotphase": "LotPhase" | kind=code-symbol | source=shared/insights.ts:L238 | neighbors=[insights.ts, api.ts]
- "shared_insights_phase_labels": "PHASE_LABELS" | kind=code-symbol | source=shared/insights.ts:L240 | neighbors=[ShopPage.tsx, insights.ts]
- "shared_insights_segment_labels": "SEGMENT_LABELS" | kind=code-symbol | source=shared/insights.ts:L148 | neighbors=[ShopPage.tsx, insights.ts]
- "shared_models_disputeevidence": "DisputeEvidence" | kind=code-symbol | source=shared/models.ts:L961 | neighbors=[dispute-routes.ts, models.ts]
- "shared_models_disputemessage": "DisputeMessage" | kind=code-symbol | source=shared/models.ts:L976 | neighbors=[dispute-routes.ts, models.ts]
- "shared_models_handlerprofile": "HandlerProfile" | kind=code-symbol | source=shared/models.ts:L333 | neighbors=[service-routes.ts, models.ts]
- "shared_models_lotsupplier": "LotSupplier" | kind=code-symbol | source=shared/models.ts:L699 | neighbors=[fulfilment-routes.ts, models.ts]
- "shared_models_notificationkind": "NotificationKind" | kind=code-symbol | source=shared/models.ts:L1224 | neighbors=[notify.ts, models.ts]
- "shared_models_paymentclaim": "PaymentClaim" | kind=code-symbol | source=shared/models.ts:L852 | neighbors=[models.ts, api.ts]
- "shared_models_stageeventkind": "StageEventKind" | kind=code-symbol | source=shared/models.ts:L583 | neighbors=[fulfilment.ts, models.ts]
- "shared_orders_autoreleasedue": "autoReleaseDue()" | kind=code-symbol | source=shared/orders.ts:L64 | neighbors=[order-routes.ts, orders.ts]
- "shared_orders_orderaction": "OrderAction" | kind=code-symbol | source=shared/orders.ts:L40 | neighbors=[orders.ts, api.ts]
- "shared_orders_protectionfeeminor": "protectionFeeMinor()" | kind=code-symbol | source=shared/orders.ts:L43 | neighbors=[order-routes.ts, orders.ts]
- "shared_posts_isannouncement": "isAnnouncement()" | kind=code-symbol | source=shared/posts.ts:L14 | neighbors=[SocialPage.tsx, posts.ts]
- "shared_preorder_preorderstate": "PreOrderState" | kind=code-symbol | source=shared/preorder.ts:L12 | neighbors=[preorder.ts, preorder.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-034.json

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
