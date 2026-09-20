# Node Description Batch 47 of 55

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

- "functions_tracking_routes_noteonlotroute": "noteOnLotRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L744 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L27 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_routebody": "RouteBody" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L80 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_saveroute": "saveRoute()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L87 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_saverouteroute": "saveRouteRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L739 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_setlotroute": "setLotRoute()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L390 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_setlotrouteroute": "setLotRouteRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L745 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_stepitemroute": "stepItemRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L746 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_steplot": "stepLot()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L293 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_steplotroute": "stepLotRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L743 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_templatefrom": "templateFrom()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L750 | neighbors=[tracking-routes.ts]
- "functions_want_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/want-routes.ts:L437 | neighbors=[want-routes.ts]
- "functions_want_routes_board": "board()" | kind=code-symbol | source=api/src/functions/want-routes.ts:L63 | neighbors=[want-routes.ts]
- "functions_want_routes_wantalsomeroute": "wantAlsoMeRoute" | kind=code-symbol | source=api/src/functions/want-routes.ts:L435 | neighbors=[want-routes.ts]
- "functions_want_routes_wantcloseroute": "wantCloseRoute" | kind=code-symbol | source=api/src/functions/want-routes.ts:L434 | neighbors=[want-routes.ts]
- "functions_want_routes_wantofferroute": "wantOfferRoute" | kind=code-symbol | source=api/src/functions/want-routes.ts:L433 | neighbors=[want-routes.ts]
- "functions_want_routes_wantpostroute": "wantPostRoute" | kind=code-symbol | source=api/src/functions/want-routes.ts:L431 | neighbors=[want-routes.ts]
- "functions_want_routes_wantreadroute": "wantReadRoute" | kind=code-symbol | source=api/src/functions/want-routes.ts:L432 | neighbors=[want-routes.ts]
- "functions_want_routes_wantsboardroute": "wantsBoardRoute" | kind=code-symbol | source=api/src/functions/want-routes.ts:L430 | neighbors=[want-routes.ts]
- "pages_authpage_mode": "Mode" | kind=code-symbol | source=app/src/pages/AuthPage.tsx:L8 | neighbors=[AuthPage.tsx]
- "pages_disputepage_acceptbutton": "AcceptButton()" | kind=code-symbol | source=app/src/pages/DisputePage.tsx:L167 | neighbors=[DisputePage.tsx]
- "pages_disputepage_disputeactions": "DisputeActions()" | kind=code-symbol | source=app/src/pages/DisputePage.tsx:L200 | neighbors=[DisputePage.tsx]
- "pages_escrowpage_settledialog": "SettleDialog()" | kind=code-symbol | source=app/src/pages/EscrowPage.tsx:L135 | neighbors=[EscrowPage.tsx]
- "pages_escrowpage_tile": "Tile()" | kind=code-symbol | source=app/src/pages/EscrowPage.tsx:L205 | neighbors=[EscrowPage.tsx]
- "pages_feedpage_listingcard": "ListingCard()" | kind=code-symbol | source=app/src/pages/FeedPage.tsx:L259 | neighbors=[FeedPage.tsx]
- "pages_feedpage_picker": "Picker()" | kind=code-symbol | source=app/src/pages/FeedPage.tsx:L237 | neighbors=[FeedPage.tsx]
- "pages_feedpage_price_bands": "PRICE_BANDS" | kind=code-symbol | source=app/src/pages/FeedPage.tsx:L16 | neighbors=[FeedPage.tsx]
- "pages_listingpage_preorderpanel": "PreOrderPanel()" | kind=code-symbol | source=app/src/pages/ListingPage.tsx:L276 | neighbors=[ListingPage.tsx]
- "pages_listingpage_roster": "Roster()" | kind=code-symbol | source=app/src/pages/ListingPage.tsx:L432 | neighbors=[ListingPage.tsx]
- "pages_lotspage_additemspanel": "AddItemsPanel()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L840 | neighbors=[LotsPage.tsx]
- "pages_lotspage_changeroutedialog": "ChangeRouteDialog()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L603 | neighbors=[LotsPage.tsx]
- "pages_lotspage_crewcard": "CrewCard()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L162 | neighbors=[LotsPage.tsx]
- "pages_lotspage_editlotdialog": "EditLotDialog()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L684 | neighbors=[LotsPage.tsx]
- "pages_lotspage_lot_sections": "LOT_SECTIONS" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L930 | neighbors=[LotsPage.tsx]
- "pages_lotspage_lotitemrow": "LotItemRow()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L731 | neighbors=[LotsPage.tsx]
- "pages_lotspage_lotsection": "LotSection" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L928 | neighbors=[LotsPage.tsx]
- "pages_lotspage_stagebadge": "StageBadge()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L328 | neighbors=[LotsPage.tsx]
- "pages_lotspage_stagetrack": "StageTrack()" | kind=code-symbol | source=app/src/pages/LotsPage.tsx:L333 | neighbors=[LotsPage.tsx]
- "pages_messagespage_gaptoobig": "gapTooBig()" | kind=code-symbol | source=app/src/pages/MessagesPage.tsx:L386 | neighbors=[MessagesPage.tsx]
- "pages_orderpage_buypanel": "BuyPanel()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L499 | neighbors=[OrderPage.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-046.json

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
