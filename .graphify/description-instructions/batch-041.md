# Node Description Batch 42 of 55

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

- "data_memory_repository_memoryrepository_updatelot": ".updateLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L379 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_updateorder": ".updateOrder()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L369 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_updatereview": ".updateReview()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L637 | neighbors=[MemoryRepository]
- "data_memory_repository_newestfirst": "newestFirst()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L769 | neighbors=[memory-repository.ts]
- "data_memory_repository_repository": "Repository" | kind=code-symbol | neighbors=[MemoryRepository]
- "data_seed_listings": "LISTINGS" | kind=code-symbol | source=api/src/data/seed.ts:L439 | neighbors=[seed.ts]
- "data_seed_listingseed": "ListingSeed" | kind=code-symbol | source=api/src/data/seed.ts:L419 | neighbors=[seed.ts]
- "data_seed_lot_buyers": "LOT_BUYERS" | kind=code-symbol | source=api/src/data/seed.ts:L1183 | neighbors=[seed.ts]
- "data_seed_lot_items": "LOT_ITEMS" | kind=code-symbol | source=api/src/data/seed.ts:L1224 | neighbors=[seed.ts]
- "data_seed_now": "NOW" | kind=code-symbol | source=api/src/data/seed.ts:L60 | neighbors=[seed.ts]
- "data_seed_posts": "POSTS" | kind=code-symbol | source=api/src/data/seed.ts:L1079 | neighbors=[seed.ts]
- "data_seed_postseed": "PostSeed" | kind=code-symbol | source=api/src/data/seed.ts:L1064 | neighbors=[seed.ts]
- "functions_admin_routes_admindeleteresourceroute": "adminDeleteResourceRoute" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L398 | neighbors=[admin-routes.ts]
- "functions_admin_routes_admindeleteuserroute": "adminDeleteUserRoute" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L397 | neighbors=[admin-routes.ts]
- "functions_admin_routes_admindisputesroute": "adminDisputesRoute" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L400 | neighbors=[admin-routes.ts]
- "functions_admin_routes_adminescrowroute": "adminEscrowRoute" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L399 | neighbors=[admin-routes.ts]
- "functions_admin_routes_adminresolveroute": "adminResolveRoute" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L401 | neighbors=[admin-routes.ts]
- "functions_admin_routes_adminsuspendroute": "adminSuspendRoute" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L396 | neighbors=[admin-routes.ts]
- "functions_admin_routes_adminuserdetailroute": "adminUserDetailRoute" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L395 | neighbors=[admin-routes.ts]
- "functions_admin_routes_adminusersroute": "adminUsersRoute" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L394 | neighbors=[admin-routes.ts]
- "functions_admin_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L403 | neighbors=[admin-routes.ts]
- "functions_admin_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L29 | neighbors=[admin-routes.ts]
- "functions_auth_routes_login": "login()" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L8 | neighbors=[auth-routes.ts]
- "functions_auth_routes_loginroute": "loginRoute" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L64 | neighbors=[auth-routes.ts]
- "functions_auth_routes_logout": "logout()" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L42 | neighbors=[auth-routes.ts]
- "functions_auth_routes_logoutroute": "logoutRoute" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L66 | neighbors=[auth-routes.ts]
- "functions_auth_routes_me": "me()" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L54 | neighbors=[auth-routes.ts]
- "functions_auth_routes_meroute": "meRoute" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L67 | neighbors=[auth-routes.ts]
- "functions_auth_routes_signup": "signup()" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L23 | neighbors=[auth-routes.ts]
- "functions_auth_routes_signuproute": "signupRoute" | kind=code-symbol | source=api/src/functions/auth-routes.ts:L65 | neighbors=[auth-routes.ts]
- "functions_catalog_routes_addcomment": "addComment()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L353 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_addcommentroute": "addCommentRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L589 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L595 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_bumplisting": "bumpListing()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L338 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_bumplistingroute": "bumpListingRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L588 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_createlisting": "createListing()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L143 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_createlistingroute": "createListingRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L586 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_createorder": "createOrder()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L398 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_createorderroute": "createOrderRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L591 | neighbors=[catalog-routes.ts]
- "functions_catalog_routes_feedroute": "feedRoute" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L584 | neighbors=[catalog-routes.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-041.json

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
