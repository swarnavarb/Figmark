# Figmark

A marketplace for import resellers. Group-buy lots with order manifests and
buyer-visible fulfilment stages, payments held by Figmark under Buyer
Protection, and two-sided reviews gated on completed transactions.

This is the scaffold: the build and deploy pipeline, the auth seam, the data
model, and a status page that proves the whole path works. Feature modules
start from here.

## Quick start

```bash
npm run install:all     # install api/ and app/ dependencies
npm run build           # build both
npm test                # ~900 checks: routes, styles, auth seam, HTTP contract, smoke flows
npm run serve           # http://127.0.0.1:5173
```

`npm run serve` runs the built frontend with the API handlers mounted in-process,
so the whole stack runs with no cloud resources and no Functions Core Tools. For
frontend work with live reload, run `npm run dev` (Vite on :5173, proxying
`/api` to :7071) alongside `cd api && npm start` (Functions Core Tools).

Sign in with the one seeded account — `demo@figmark.in` (or its phone,
`+919812345678`) and password `figmark123`. The auth page offers to fill it in.

## Human-style QA of buying and selling

In Claude Code, `/qa-buy-sell all` (or a group like `/qa-buy-sell C`, or ids
like `/qa-buy-sell C4 D6 H2`) has Claude work the running app in a real
browser as a shop owner, a buyer and a newcomer, across the scenarios in
[.claude/skills/qa-buy-sell/SCENARIOS.md](.claude/skills/qa-buy-sell/SCENARIOS.md),
and write a bug report with screenshots to `qa-runs/`.

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
| Photo search | Claude reads the photo, when `ANTHROPIC_API_KEY` is set | Matches by picture, caption words and probable look-alikes |

`/api/health` reports which implementation actually loaded, and the status page
renders it — so a deployment running on fallbacks is visibly degraded rather
than quietly wrong.

## Documentation

- [docs/AZURE.md](docs/AZURE.md) — resources, credentials, deployment, current blockers
- [docs/AUTH.md](docs/AUTH.md) — the auth seam and how to swap in a real provider
- [docs/PUSH.md](docs/PUSH.md) — lock-screen notifications: turning them on, and installing on a phone
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md) — containers, partition keys, and why

## What's built

Sign-in and sign-up, a searchable unified catalog with filters, listing detail
with group-buy lots and their stage timeline, a one-screen sell flow, the
freight forwarder directory, and a combined profile covering listings,
purchases and follows. Social signals — bookmarks, follows, public comments and
rate-limited bumps — are wired end to end.

Photo upload works against Blob Storage (listing photos are public-read; photos
sent in chats go to a private container and are served only to the two handles
in the thread).

Photo search: the camera in the search sheet takes a photo or picks one, and
the catalogue shows what matches it first, then related items, as one list. A
perceptual fingerprint finds items listed with the same picture, even resized
or recompressed; with `ANTHROPIC_API_KEY` set, Claude also reads what the item
is and those words find it under a different picture. The search photo is
never uploaded to the photo store or kept anywhere: it is held in the browser's
memory for the search and dropped by `POST /api/search/photo` when it answers.

Seen for sale: every full-screen photo (posts, channels, listings, order
photos, collection cards), and every post and channel photo in the feed, checks whether the things in it are, or were, for
sale here and says so in a bar along the bottom. Tapping it lists the matching
listings, those on sale now first and then sold-out or ended ones, along with
the shops that have sold them. With `ANTHROPIC_API_KEY` set, Claude names each
item in the photo, up to five, and each item gets its own group. The words
shown with the photo (a post's caption, a listing's title) are searched
against listing titles too, so a post that names what is in it finds those
items without a key. The sheet ends with shops that could get the items:
those that list the brand or name (Nike, McFarlane) first, then those that
deal in the kind of thing (sneakers, action figures). When nothing is certain - a
different photo of the same figure, a caption that names nothing - the bar
still counts probable matches: a guess, with a chance on each, from the
colours of the thing itself (backdrop aside), any word the caption shares with
a title, and whether the person who posted it lists it. No key needed; the
sheet shows the probable listings and the probable shops that can get them.
`POST /api/search/photo/sales`
only reads photos stored here (never an outside link, never a chat photo), and
caches what it read for each photo, so reopening one costs nothing. It takes
one photo or up to ten (`photos: [...]`): the feed sends the photos coming into
view together as one request, and keeps answers for five minutes, across a
reload too. Listing photos keep their fingerprint on the listing, the
catalogue is held for a minute and refreshed behind the answers, and an answer
is worked out once per photo per catalogue copy, however many people see it.
The search sheet filters on the device when more letters can only narrow what
it already has, and asks for people and shops only when there can be some.

## Status

Not yet verified against live Azure: the session that produced this scaffold had
no network route to `*.documents.azure.com`, `*.blob.core.windows.net`, or the
Static Web App hostname, and no Azure credentials. Everything Azure-facing is
written and ready but unrun. See [docs/AZURE.md](docs/AZURE.md#what-still-needs-doing).
