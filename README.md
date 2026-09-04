# Figmark

A marketplace for import resellers. Group-buy lots with order manifests and
buyer-visible fulfilment stages, escrow-held payments, and two-sided reviews
gated on completed transactions.

This is the scaffold: the build and deploy pipeline, the auth seam, the data
model, and a status page that proves the whole path works. Feature modules
start from here.

## Quick start

```bash
npm run install:all     # install api/ and app/ dependencies
npm run build           # build both
npm test                # 30 checks over the auth seam and HTTP contract
npm run serve           # http://127.0.0.1:5173
```

`npm run serve` runs the built frontend with the API handlers mounted in-process,
so the whole stack runs with no cloud resources and no Functions Core Tools. For
frontend work with live reload, run `npm run dev` (Vite on :5173, proxying
`/api` to :7071) alongside `cd api && npm start` (Functions Core Tools).

Signing in uses the seeded mock accounts — `admin`, `kaiju` (seller), `ravi`,
`meera` (buyers), all with password `figmark-dev`.

## Layout

```
shared/     Domain model and wire contracts, used by both sides
api/        Azure Functions (v4, TypeScript) — the backend
app/        Vite + React frontend
scripts/    Azure connectivity check, provisioning, smoke tests, dev server
docs/       Architecture, Azure setup, auth swap-in, data model
```

`shared/` is compiled into the API by `tsc` and aliased into the app by Vite, so
one change to a wire contract fails the typecheck on both sides at once.

## How it degrades

Every external dependency has an in-process fallback, so the app boots and is
browsable with nothing provisioned:

| Seam | Configured | Fallback |
|---|---|---|
| Database | Cosmos DB, when `COSMOS_ENDPOINT` is set | In-memory store with seeded data |
| Storage | Blob Storage, when `STORAGE_ACCOUNT` is set | In-memory (photos resolve to nothing) |
| Auth | Static Web Apps identity, when `AUTH_MODE=swa` | Mock username/password provider |

`/api/health` reports which implementation actually loaded, and the status page
renders it — so a deployment running on fallbacks is visibly degraded rather
than quietly wrong.

## Documentation

- [docs/AZURE.md](docs/AZURE.md) — resources, credentials, deployment, current blockers
- [docs/AUTH.md](docs/AUTH.md) — the auth seam and how to swap in a real provider
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md) — containers, partition keys, and why

## Status

Built and verified: the domain model, the auth seam with role-based access
control, the repository layer with both backends, the API routes, the frontend,
and the GitHub Actions pipeline.

Not yet verified against live Azure: the session that produced this scaffold had
no network route to `*.documents.azure.com`, `*.blob.core.windows.net`, or the
Static Web App hostname, and no Azure credentials. Everything Azure-facing is
written and ready but unrun. See [docs/AZURE.md](docs/AZURE.md#what-still-needs-doing).
