# Node Description Batch 46 of 55

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

- "functions_service_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/service-routes.ts:L30 | neighbors=[service-routes.ts]
- "functions_service_routes_servicedirectoryroute": "serviceDirectoryRoute" | kind=code-symbol | source=api/src/functions/service-routes.ts:L462 | neighbors=[service-routes.ts]
- "functions_service_routes_serviceshubroute": "servicesHubRoute" | kind=code-symbol | source=api/src/functions/service-routes.ts:L461 | neighbors=[service-routes.ts]
- "functions_social_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/social-routes.ts:L380 | neighbors=[social-routes.ts]
- "functions_social_routes_channels": "channels()" | kind=code-symbol | source=api/src/functions/social-routes.ts:L98 | neighbors=[social-routes.ts]
- "functions_social_routes_channelsroute": "channelsRoute" | kind=code-symbol | source=api/src/functions/social-routes.ts:L374 | neighbors=[social-routes.ts]
- "functions_social_routes_channelthreadroute": "channelThreadRoute" | kind=code-symbol | source=api/src/functions/social-routes.ts:L375 | neighbors=[social-routes.ts]
- "functions_social_routes_createforumroute": "createForumRoute" | kind=code-symbol | source=api/src/functions/social-routes.ts:L378 | neighbors=[social-routes.ts]
- "functions_social_routes_createpost": "createPost()" | kind=code-symbol | source=api/src/functions/social-routes.ts:L197 | neighbors=[social-routes.ts]
- "functions_social_routes_createpostroute": "createPostRoute" | kind=code-symbol | source=api/src/functions/social-routes.ts:L376 | neighbors=[social-routes.ts]
- "functions_social_routes_listforumsroute": "listForumsRoute" | kind=code-symbol | source=api/src/functions/social-routes.ts:L377 | neighbors=[social-routes.ts]
- "functions_social_routes_postcard": "PostCard" | kind=code-symbol | source=api/src/functions/social-routes.ts:L20 | neighbors=[social-routes.ts]
- "functions_social_routes_socialfeedroute": "socialFeedRoute" | kind=code-symbol | source=api/src/functions/social-routes.ts:L373 | neighbors=[social-routes.ts]
- "functions_template_routes_allowed_types": "ALLOWED_TYPES" | kind=code-symbol | source=api/src/functions/template-routes.ts:L127 | neighbors=[template-routes.ts]
- "functions_template_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/template-routes.ts:L313 | neighbors=[template-routes.ts]
- "functions_template_routes_assignordertolot": "assignOrderToLot()" | kind=code-symbol | source=api/src/functions/template-routes.ts:L207 | neighbors=[template-routes.ts]
- "functions_template_routes_assignordertolotroute": "assignOrderToLotRoute" | kind=code-symbol | source=api/src/functions/template-routes.ts:L311 | neighbors=[template-routes.ts]
- "functions_template_routes_deletetemplate": "deleteTemplate()" | kind=code-symbol | source=api/src/functions/template-routes.ts:L111 | neighbors=[template-routes.ts]
- "functions_template_routes_deletetemplateroute": "deleteTemplateRoute" | kind=code-symbol | source=api/src/functions/template-routes.ts:L308 | neighbors=[template-routes.ts]
- "functions_template_routes_listtemplates": "listTemplates()" | kind=code-symbol | source=api/src/functions/template-routes.ts:L29 | neighbors=[template-routes.ts]
- "functions_template_routes_listtemplatesroute": "listTemplatesRoute" | kind=code-symbol | source=api/src/functions/template-routes.ts:L306 | neighbors=[template-routes.ts]
- "functions_template_routes_photo": "photo()" | kind=code-symbol | source=api/src/functions/template-routes.ts:L174 | neighbors=[template-routes.ts]
- "functions_template_routes_photoroute": "photoRoute" | kind=code-symbol | source=api/src/functions/template-routes.ts:L310 | neighbors=[template-routes.ts]
- "functions_template_routes_savetemplate": "saveTemplate()" | kind=code-symbol | source=api/src/functions/template-routes.ts:L51 | neighbors=[template-routes.ts]
- "functions_template_routes_savetemplateroute": "saveTemplateRoute" | kind=code-symbol | source=api/src/functions/template-routes.ts:L307 | neighbors=[template-routes.ts]
- "functions_template_routes_templatebody": "TemplateBody" | kind=code-symbol | source=api/src/functions/template-routes.ts:L36 | neighbors=[template-routes.ts]
- "functions_template_routes_upload": "upload()" | kind=code-symbol | source=api/src/functions/template-routes.ts:L138 | neighbors=[template-routes.ts]
- "functions_template_routes_uploadroute": "uploadRoute" | kind=code-symbol | source=api/src/functions/template-routes.ts:L309 | neighbors=[template-routes.ts]
- "functions_tracking_routes_additems": "addItems()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L205 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_additemsroute": "addItemsRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L742 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L756 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_deleteroute": "deleteRoute()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L137 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_deleterouteroute": "deleteRouteRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L740 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_itemcard": "itemCard()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L152 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_listroutes": "listRoutes()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L38 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_listroutesroute": "listRoutesRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L738 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_lotcandidatesroute": "lotCandidatesRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L741 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_myitems": "myItems()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L661 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_myitemsroute": "myItemsRoute" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L747 | neighbors=[tracking-routes.ts]
- "functions_tracking_routes_noteonlot": "noteOnLot()" | kind=code-symbol | source=api/src/functions/tracking-routes.ts:L489 | neighbors=[tracking-routes.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-045.json

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
