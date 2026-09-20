# Node Description Batch 44 of 55

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

- "functions_fulfilment_routes_updatelotdetailsroute": "updateLotDetailsRoute" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1096 | neighbors=[fulfilment-routes.ts]
- "functions_health_health": "health()" | kind=code-symbol | source=api/src/functions/health.ts:L15 | neighbors=[health.ts]
- "functions_health_healthroute": "healthRoute" | kind=code-symbol | source=api/src/functions/health.ts:L66 | neighbors=[health.ts]
- "functions_insight_routes_insightsroute": "insightsRoute" | kind=code-symbol | source=api/src/functions/insight-routes.ts:L267 | neighbors=[insight-routes.ts]
- "functions_insight_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/insight-routes.ts:L31 | neighbors=[insight-routes.ts]
- "functions_insight_routes_round": "round()" | kind=code-symbol | source=api/src/functions/insight-routes.ts:L62 | neighbors=[insight-routes.ts]
- "functions_message_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/message-routes.ts:L346 | neighbors=[message-routes.ts]
- "functions_message_routes_inboxroute": "inboxRoute" | kind=code-symbol | source=api/src/functions/message-routes.ts:L340 | neighbors=[message-routes.ts]
- "functions_message_routes_publicprofile": "publicProfile()" | kind=code-symbol | source=api/src/functions/message-routes.ts:L237 | neighbors=[message-routes.ts]
- "functions_message_routes_publicprofileroute": "publicProfileRoute" | kind=code-symbol | source=api/src/functions/message-routes.ts:L344 | neighbors=[message-routes.ts]
- "functions_message_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/message-routes.ts:L24 | neighbors=[message-routes.ts]
- "functions_message_routes_sendmessageroute": "sendMessageRoute" | kind=code-symbol | source=api/src/functions/message-routes.ts:L343 | neighbors=[message-routes.ts]
- "functions_message_routes_setusername": "setUsername()" | kind=code-symbol | source=api/src/functions/message-routes.ts:L306 | neighbors=[message-routes.ts]
- "functions_message_routes_setusernameroute": "setUsernameRoute" | kind=code-symbol | source=api/src/functions/message-routes.ts:L341 | neighbors=[message-routes.ts]
- "functions_message_routes_threadroute": "threadRoute" | kind=code-symbol | source=api/src/functions/message-routes.ts:L342 | neighbors=[message-routes.ts]
- "functions_notification_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/notification-routes.ts:L73 | neighbors=[notification-routes.ts]
- "functions_notification_routes_list": "list()" | kind=code-symbol | source=api/src/functions/notification-routes.ts:L16 | neighbors=[notification-routes.ts]
- "functions_notification_routes_markread": "markRead()" | kind=code-symbol | source=api/src/functions/notification-routes.ts:L44 | neighbors=[notification-routes.ts]
- "functions_notification_routes_notificationsreadroute": "notificationsReadRoute" | kind=code-symbol | source=api/src/functions/notification-routes.ts:L71 | neighbors=[notification-routes.ts]
- "functions_notification_routes_notificationsroute": "notificationsRoute" | kind=code-symbol | source=api/src/functions/notification-routes.ts:L70 | neighbors=[notification-routes.ts]
- "functions_notify_noticedraft": "NoticeDraft" | kind=code-symbol | source=api/src/functions/notify.ts:L19 | neighbors=[notify.ts]
- "functions_notify_repo": "Repo" | kind=code-symbol | source=api/src/functions/notify.ts:L17 | neighbors=[notify.ts]
- "functions_order_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/order-routes.ts:L762 | neighbors=[order-routes.ts]
- "functions_order_routes_checkoutroute": "checkoutRoute" | kind=code-symbol | source=api/src/functions/order-routes.ts:L760 | neighbors=[order-routes.ts]
- "functions_order_routes_claimpaymentroute": "claimPaymentRoute" | kind=code-symbol | source=api/src/functions/order-routes.ts:L670 | neighbors=[order-routes.ts]
- "functions_order_routes_confirmroute": "confirmRoute" | kind=code-symbol | source=api/src/functions/order-routes.ts:L757 | neighbors=[order-routes.ts]
- "functions_order_routes_escrowrecord": "escrowRecord()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L272 | neighbors=[order-routes.ts]
- "functions_order_routes_orderstateroute": "orderStateRoute" | kind=code-symbol | source=api/src/functions/order-routes.ts:L759 | neighbors=[order-routes.ts]
- "functions_order_routes_payroute": "payRoute" | kind=code-symbol | source=api/src/functions/order-routes.ts:L669 | neighbors=[order-routes.ts]
- "functions_order_routes_rejectorderroute": "rejectOrderRoute" | kind=code-symbol | source=api/src/functions/order-routes.ts:L756 | neighbors=[order-routes.ts]
- "functions_order_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/order-routes.ts:L38 | neighbors=[order-routes.ts]
- "functions_order_routes_reviewroute": "reviewRoute" | kind=code-symbol | source=api/src/functions/order-routes.ts:L758 | neighbors=[order-routes.ts]
- "functions_order_routes_settleclaimroute": "settleClaimRoute" | kind=code-symbol | source=api/src/functions/order-routes.ts:L755 | neighbors=[order-routes.ts]
- "functions_power_sale_repo": "Repo" | kind=code-symbol | source=api/src/functions/power-sale.ts:L6 | neighbors=[power-sale.ts]
- "functions_power_sale_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L298 | neighbors=[power-sale-routes.ts]
- "functions_power_sale_routes_bodies": "bodies" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L63 | neighbors=[power-sale-routes.ts]
- "functions_power_sale_routes_powersalecreateroute": "powerSaleCreateRoute" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L294 | neighbors=[power-sale-routes.ts]
- "functions_power_sale_routes_powersalereadroute": "powerSaleReadRoute" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L295 | neighbors=[power-sale-routes.ts]
- "functions_power_sale_routes_powersalesroute": "powerSalesRoute" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L293 | neighbors=[power-sale-routes.ts]
- "functions_power_sale_routes_powersalestoproute": "powerSaleStopRoute" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L296 | neighbors=[power-sale-routes.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-043.json

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
