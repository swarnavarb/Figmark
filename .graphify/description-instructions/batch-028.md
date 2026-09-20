# Node Description Batch 29 of 55

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

- "functions_power_sale_routes_list": "list()" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L119 | neighbors=[power-sale-routes.ts, shopFor()]
- "functions_power_sale_shoppost": "shopPost()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L45 | neighbors=[power-sale.ts, advancePowerSale()]
- "functions_power_sale_windowleftminutes": "windowLeftMinutes()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L139 | neighbors=[power-sale.ts, power-sale-routes.ts]
- "functions_preorder_routes_pledge": "pledge()" | kind=code-symbol | source=api/src/functions/preorder-routes.ts:L66 | neighbors=[preorder-routes.ts, campaign()]
- "functions_preorder_routes_read": "read()" | kind=code-symbol | source=api/src/functions/preorder-routes.ts:L44 | neighbors=[preorder-routes.ts, campaign()]
- "functions_profile_routes_creditfrom": "creditFrom()" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L41 | neighbors=[profile-routes.ts, credit()]
- "functions_profile_routes_tradereviews": "tradeReviews()" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L209 | neighbors=[profile-routes.ts, summarise()]
- "functions_seller_routes_safelink": "safeLink()" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L39 | neighbors=[seller-routes.ts, updateStorefront()]
- "functions_seller_routes_slugify": "slugify()" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L22 | neighbors=[seller-routes.ts, updateStorefront()]
- "functions_service_routes_consignments": "consignments()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L332 | neighbors=[service-routes.ts, lotsNaming()]
- "functions_service_routes_distribution": "distribution()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L365 | neighbors=[service-routes.ts, lotsNaming()]
- "functions_service_routes_offerservice": "offerService()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L214 | neighbors=[service-routes.ts, slugOf()]
- "functions_service_routes_packsforanyone": "packsForAnyone()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L153 | neighbors=[service-routes.ts, servicesHub()]
- "functions_service_routes_providersof": "providersOf()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L95 | neighbors=[service-routes.ts, serviceDirectory()]
- "functions_service_routes_servicedirectory": "serviceDirectory()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L166 | neighbors=[service-routes.ts, providersOf()]
- "functions_service_routes_serviceshub": "servicesHub()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L126 | neighbors=[service-routes.ts, packsForAnyone()]
- "functions_service_routes_slugof": "slugOf()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L291 | neighbors=[service-routes.ts, offerService()]
- "functions_service_routes_storecard": "storeCard()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L317 | neighbors=[service-routes.ts, distributionDetail()]
- "functions_social_routes_channelthread": "channelThread()" | kind=code-symbol | source=api/src/functions/social-routes.ts:L142 | neighbors=[social-routes.ts, decorate()]
- "functions_social_routes_createforum": "createForum()" | kind=code-symbol | source=api/src/functions/social-routes.ts:L332 | neighbors=[social-routes.ts, listForums()]
- "functions_social_routes_listforums": "listForums()" | kind=code-symbol | source=api/src/functions/social-routes.ts:L318 | neighbors=[social-routes.ts, createForum()]
- "functions_social_routes_mychannelids": "myChannelIds()" | kind=code-symbol | source=api/src/functions/social-routes.ts:L73 | neighbors=[social-routes.ts, socialFeed()]
- "functions_tracking_routes_lotcandidates": "lotCandidates()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L179 | neighbors=[tracking-routes.ts, namesFor()]
- "functions_tracking_routes_namesfor": "namesFor()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L167 | neighbors=[tracking-routes.ts, lotCandidates()]
- "functions_tracking_routes_ownedorder": "ownedOrder()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L559 | neighbors=[tracking-routes.ts, stepItem()]
- "functions_tracking_routes_stepitem": "stepItem()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L583 | neighbors=[tracking-routes.ts, ownedOrder()]
- "functions_want_routes_alsome": "alsoMe()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L365 | neighbors=[want-routes.ts, findWant()]
- "functions_want_routes_expiryfrom": "expiryFrom()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L31 | neighbors=[want-routes.ts, post()]
- "functions_want_routes_notifyseekers": "notifySeekers()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L324 | neighbors=[want-routes.ts, offer()]
- "pages_authpage_authpage": "AuthPage()" | kind=code-symbol | source=app/src/pages/AuthPage.tsx:L17 | neighbors=[AuthPage.tsx, main.tsx]
- "pages_disputepage_disputepage": "DisputePage()" | kind=code-symbol | source=app/src/pages/DisputePage.tsx:L18 | neighbors=[DisputePage.tsx, main.tsx]
- "pages_escrowpage_escrowpage": "EscrowPage()" | kind=code-symbol | source=app/src/pages/EscrowPage.tsx:L20 | neighbors=[EscrowPage.tsx, main.tsx]
- "pages_feedpage_feedpage": "FeedPage()" | kind=code-symbol | source=app/src/pages/FeedPage.tsx:L29 | neighbors=[FeedPage.tsx, main.tsx]
- "pages_forwarderspage_forwarderspage": "ForwardersPage()" | kind=code-symbol | source=app/src/pages/ForwardersPage.tsx:L13 | neighbors=[ForwardersPage.tsx, main.tsx]
- "pages_listingpage_listingpage": "ListingPage()" | kind=code-symbol | source=app/src/pages/ListingPage.tsx:L9 | neighbors=[ListingPage.tsx, main.tsx]
- "pages_lotboardpage_lotboardpage": "LotBoardPage()" | kind=code-symbol | source=app/src/pages/LotBoardPage.tsx:L16 | neighbors=[LotBoardPage.tsx, main.tsx]
- "pages_lotspage_lotdetail": "LotDetail()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L945 | neighbors=[LotsPage.tsx, ShopPage.tsx]
- "pages_lotspage_lotspage": "LotsPage()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L29 | neighbors=[LotsPage.tsx, main.tsx]
- "pages_lotspage_summarise": "summarise()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L360 | neighbors=[LotsPage.tsx, NewLotForm()]
- "pages_messagespage_messagebutton": "MessageButton()" | kind=code-symbol | source=app/src/pages/MessagesPage.tsx:L391 | neighbors=[MessagesPage.tsx, ProfileByHandlePage.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-028.json

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
