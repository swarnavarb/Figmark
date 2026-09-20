# Node Description Batch 20 of 55

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

- "functions_dispute_routes_escalate": "escalate()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L476 | neighbors=[dispute-routes.ts, message(), ownDispute()]
- "functions_dispute_routes_evidencefrom": "evidenceFrom()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L79 | neighbors=[dispute-routes.ts, open(), reply()]
- "functions_dispute_routes_note": "note()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L119 | neighbors=[dispute-routes.ts, open(), settleDispute()]
- "functions_dispute_routes_offer": "offer()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L382 | neighbors=[dispute-routes.ts, message(), ownDispute()]
- "functions_dispute_routes_settleasescrow": "settleAsEscrow()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L516 | neighbors=[dispute-routes.ts, ownDispute(), settleDispute()]
- "functions_dispute_routes_withdraw": "withdraw()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L454 | neighbors=[dispute-routes.ts, ownDispute(), settleDispute()]
- "functions_fulfilment_routes_supplierfrom": "supplierFrom()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L54 | neighbors=[fulfilment-routes.ts, buildLot(), updateLotDetails()]
- "functions_fulfilment_routes_updatelotdetails": "updateLotDetails()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L88 | neighbors=[fulfilment-routes.ts, supplierFrom(), userForHandle()]
- "functions_message_routes_defaultvoice": "defaultVoice()" | kind=code-symbol | source=api/src/functions/message-routes.ts:L68 | neighbors=[message-routes.ts, send(), thread()]
- "functions_message_routes_partyfor": "partyFor()" | kind=code-symbol | source=api/src/functions/message-routes.ts:L89 | neighbors=[message-routes.ts, send(), thread()]
- "functions_order_routes_claimpayment": "claimPayment()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L526 | neighbors=[order-routes.ts, note(), ownOrder()]
- "functions_order_routes_confirm": "confirm()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L351 | neighbors=[order-routes.ts, ownOrder(), release()]
- "functions_order_routes_orderstate": "orderState()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L469 | neighbors=[order-routes.ts, ownOrder(), settle()]
- "functions_order_routes_pay": "pay()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L120 | neighbors=[order-routes.ts, note(), ownOrder()]
- "functions_order_routes_rejectorder": "rejectOrder()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L685 | neighbors=[order-routes.ts, note(), ownOrder()]
- "functions_order_routes_review": "review()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L374 | neighbors=[order-routes.ts, ownOrder(), rescore()]
- "functions_order_routes_settle": "settle()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L102 | neighbors=[order-routes.ts, orderState(), release()]
- "functions_order_routes_settleclaim": "settleClaim()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L603 | neighbors=[order-routes.ts, note(), ownOrder()]
- "functions_power_sale_advanceall": "advanceAll()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L272 | neighbors=[power-sale.ts, advancePowerSale(), power-sale-routes.ts]
- "functions_power_sale_dueat": "dueAt()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L107 | neighbors=[power-sale.ts, advancePowerSale(), minutes()]
- "functions_power_sale_minutes": "minutes()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L40 | neighbors=[power-sale.ts, advancePowerSale(), dueAt()]
- "functions_power_sale_routes_bodystore": "bodyStore()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L64 | neighbors=[power-sale-routes.ts, readBody(), shopFor()]
- "functions_power_sale_routes_positive": "positive()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L135 | neighbors=[power-sale-routes.ts, create(), readItem()]
- "functions_power_sale_routes_read": "read()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L246 | neighbors=[power-sale-routes.ts, card(), shopFor()]
- "functions_power_sale_routes_readbody": "readBody()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L76 | neighbors=[power-sale-routes.ts, create(), bodyStore()]
- "functions_power_sale_routes_stop": "stop()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L267 | neighbors=[power-sale-routes.ts, card(), shopFor()]
- "functions_power_sale_routes_trimmed": "trimmed()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L131 | neighbors=[power-sale-routes.ts, create(), readItem()]
- "functions_preorder_counts": "counts()" | kind=code-symbol | source=api/src/functions/preorder.ts:L62 | neighbors=[preorder.ts, reconcilePreOrder(), viewOf()]
- "functions_preorder_referrer": "referrer()" | kind=code-symbol | source=api/src/functions/preorder.ts:L193 | neighbors=[catalog-routes.ts, preorder.ts, preorder-routes.ts]
- "functions_preorder_routes_campaign": "campaign()" | kind=code-symbol | source=api/src/functions/preorder-routes.ts:L22 | neighbors=[preorder-routes.ts, pledge(), read()]
- "functions_preorder_viewof": "viewOf()" | kind=code-symbol | source=api/src/functions/preorder.ts:L206 | neighbors=[preorder.ts, rosterOf(), counts()]
- "functions_profile_routes_credit": "credit()" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L78 | neighbors=[profile-routes.ts, creditFrom(), summarise()]
- "functions_profile_routes_summarise": "summarise()" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L30 | neighbors=[profile-routes.ts, credit(), tradeReviews()]
- "functions_seller_routes_updatestorefront": "updateStorefront()" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L75 | neighbors=[seller-routes.ts, safeLink(), slugify()]
- "functions_service_routes_distributiondetail": "distributionDetail()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L403 | neighbors=[service-routes.ts, lotsNaming(), storeCard()]
- "functions_social_routes_decorate": "decorate()" | kind=code-symbol | source=api/src/functions/social-routes.ts:L34 | neighbors=[social-routes.ts, channelThread(), socialFeed()]
- "functions_social_routes_socialfeed": "socialFeed()" | kind=code-symbol | source=api/src/functions/social-routes.ts:L79 | neighbors=[social-routes.ts, decorate(), myChannelIds()]
- "functions_want_routes_close": "close()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L409 | neighbors=[want-routes.ts, card(), findWant()]
- "functions_want_routes_offer": "offer()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L231 | neighbors=[want-routes.ts, findWant(), notifySeekers()]
- "functions_want_routes_post": "post()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L99 | neighbors=[want-routes.ts, card(), expiryFrom()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-019.json

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
