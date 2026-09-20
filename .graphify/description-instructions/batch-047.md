# Node Description Batch 48 of 55

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

- "pages_orderpage_changelotdialog": "ChangeLotDialog()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L248 | neighbors=[OrderPage.tsx]
- "pages_orderpage_directpay": "DirectPay()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L631 | neighbors=[OrderPage.tsx]
- "pages_orderpage_disputeform": "DisputeForm()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L939 | neighbors=[OrderPage.tsx]
- "pages_orderpage_downscale": "downscale()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L734 | neighbors=[OrderPage.tsx]
- "pages_orderpage_escrowpicker": "EscrowPicker()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L765 | neighbors=[OrderPage.tsx]
- "pages_orderpage_orderactions": "OrderActions()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L330 | neighbors=[OrderPage.tsx]
- "pages_orderpage_reviewpanel": "ReviewPanel()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L1029 | neighbors=[OrderPage.tsx]
- "pages_orderpage_settleclaim": "SettleClaim()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L865 | neighbors=[OrderPage.tsx]
- "pages_orderpage_stat": "Stat()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L848 | neighbors=[OrderPage.tsx]
- "pages_profilebyhandlepage_creditcard": "CreditCard()" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L381 | neighbors=[ProfileByHandlePage.tsx]
- "pages_profilebyhandlepage_pagereviewform": "PageReviewForm()" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L499 | neighbors=[ProfileByHandlePage.tsx]
- "pages_profilebyhandlepage_reviewstab": "ReviewsTab()" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L412 | neighbors=[ProfileByHandlePage.tsx]
- "pages_profilebyhandlepage_tab": "Tab" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L29 | neighbors=[ProfileByHandlePage.tsx]
- "pages_profilepage_myitems": "MyItems()" | kind=code-symbol | source=app/src/pages/ProfilePage.tsx:L49 | neighbors=[ProfilePage.tsx]
- "pages_profilepage_mypagesettings": "MyPageSettings()" | kind=code-symbol | source=app/src/pages/ProfilePage.tsx:L362 | neighbors=[ProfilePage.tsx]
- "pages_profilepage_tab": "Tab" | kind=code-symbol | source=app/src/pages/ProfilePage.tsx:L12 | neighbors=[ProfilePage.tsx]
- "pages_profilepage_tab_labels": "TAB_LABELS" | kind=code-symbol | source=app/src/pages/ProfilePage.tsx:L14 | neighbors=[ProfilePage.tsx]
- "pages_profilepage_usernamesettings": "UsernameSettings()" | kind=code-symbol | source=app/src/pages/ProfilePage.tsx:L439 | neighbors=[ProfilePage.tsx]
- "pages_routespage_routerow": "RouteRow()" | kind=code-symbol | source=app/src/pages/RoutesPage.tsx:L76 | neighbors=[RoutesPage.tsx]
- "pages_sellpage_lasttemplate": "lastTemplate()" | kind=code-symbol | source=app/src/pages/SellPage.tsx:L26 | neighbors=[SellPage.tsx]
- "pages_sellpage_remembertemplate": "rememberTemplate()" | kind=code-symbol | source=app/src/pages/SellPage.tsx:L34 | neighbors=[SellPage.tsx]
- "pages_sellpage_shape": "Shape" | kind=code-symbol | source=app/src/pages/SellPage.tsx:L58 | neighbors=[SellPage.tsx]
- "pages_servicespage_distributiondetail": "DistributionDetail()" | kind=code-symbol | source=app/src/pages/ServicesPage.tsx:L574 | neighbors=[ServicesPage.tsx]
- "pages_servicespage_offerform": "OfferForm()" | kind=code-symbol | source=app/src/pages/ServicesPage.tsx:L353 | neighbors=[ServicesPage.tsx]
- "pages_shoppage_analytics": "Analytics()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1758 | neighbors=[ShopPage.tsx]
- "pages_shoppage_days": "days()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1861 | neighbors=[ShopPage.tsx]
- "pages_shoppage_drill": "Drill" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1517 | neighbors=[ShopPage.tsx]
- "pages_shoppage_drill_hints": "DRILL_HINTS" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1519 | neighbors=[ShopPage.tsx]
- "pages_shoppage_drillrows": "DrillRows()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1704 | neighbors=[ShopPage.tsx]
- "pages_shoppage_escrow_words": "ESCROW_WORDS" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1073 | neighbors=[ShopPage.tsx]
- "pages_shoppage_fileintolot": "FileIntoLot()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1206 | neighbors=[ShopPage.tsx]
- "pages_shoppage_lotcard": "LotCard()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1532 | neighbors=[ShopPage.tsx]
- "pages_shoppage_lots": "Lots()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1425 | neighbors=[ShopPage.tsx]
- "pages_shoppage_myitems": "MyItems()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L546 | neighbors=[ShopPage.tsx]
- "pages_shoppage_orderfilter": "OrderFilter" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L641 | neighbors=[ShopPage.tsx]
- "pages_shoppage_orders": "Orders()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L656 | neighbors=[ShopPage.tsx]
- "pages_shoppage_payment_words": "PAYMENT_WORDS" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1066 | neighbors=[ShopPage.tsx]
- "pages_shoppage_people": "People()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L2209 | neighbors=[ShopPage.tsx]
- "pages_shoppage_person": "Person()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1868 | neighbors=[ShopPage.tsx]
- "pages_shoppage_proinsights": "ProInsights()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1888 | neighbors=[ShopPage.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-047.json

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
