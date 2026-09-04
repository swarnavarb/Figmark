# Architecture

## Shape

```
Browser  ──►  Static Web App  ──►  Managed Functions (api/)  ──►  Cosmos DB
   │            (app/dist)              │                    └──►  Blob Storage
   └── shared/ types ───────────────────┘
```

One Static Web App serves the built frontend and routes `/api/*` to managed
Azure Functions in the same deployment, so there is no separate API host, no
CORS, and one deployment unit.

## Seams

Three things are abstracted behind an interface, each with a working fallback:

| Seam | Interface | Implementations |
|---|---|---|
| Identity | `AuthService` (`api/src/auth/types.ts`) | `MockAuthProvider`, `StaticWebAppsAuthProvider` |
| Persistence | `Repository` (`api/src/data/repository.ts`) | `CosmosRepository`, `MemoryRepository` |
| Photos | `PhotoStore` (`api/src/storage/types.ts`) | `BlobPhotoStore`, `MemoryPhotoStore` |

Each is resolved by a factory that reads `config.ts` and caches the instance for
the lifetime of the function host. Handlers depend on the interface only.

Two properties follow, and both are worth keeping:

- **The app runs with nothing provisioned.** Contributors clone and run; CI
  tests the real handlers without cloud resources.
- **A failing dependency does not take the API down.** `init()` records the
  failure rather than throwing, `/api/health` reports it, and the status page
  renders it. A misconfigured deployment says so instead of returning 500s.

## Shared code

`shared/` holds the domain model and the wire contracts. It is compiled into the
API by a `tsconfig` rooted above `api/` (hence the `dist/api/src` + `dist/shared`
output layout) and aliased into the app by Vite. A change to a response shape
breaks the typecheck on both sides at once.

This is also why CI pre-builds both halves and deploys with `skip_app_build` and
`skip_api_build` — Oryx running `npm install` inside `api/` alone would not
reproduce that layout.

## Errors

Handlers throw; the `handler()` wrapper in `api/src/functions/http.ts` translates.
`AuthError` carries its own status (401/403/501); anything else is logged with
detail and returned as a bare 500. Each route module exports the *wrapped* form
that is actually served, so the smoke tests exercise the real path rather than a
handler with its error translation stripped off.

## Testing

`npm test` runs two scripts against the compiled output:

- `scripts/smoke-auth.mjs` — the auth seam and repository directly: sign-in,
  role checks, tampered tokens, revocation, manifest assembly.
- `scripts/smoke-api.mjs` — the HTTP contract: status codes, response bodies,
  cookie attributes, and that a buyer cannot read a seller's manifest.

They use stand-in request and context objects rather than an Azure Functions
host, so they run anywhere in about a second. `scripts/dev-server.mjs` mounts the
same handlers on a real HTTP server when the full stack needs exercising.

## Conventions

- TypeScript strict everywhere, including `noUncheckedIndexedAccess`.
- No feature code reads auth state directly — see [AUTH.md](AUTH.md).
- Money in minor units, weight in grams, both integers.
- Enums are `const` arrays with derived union types.
