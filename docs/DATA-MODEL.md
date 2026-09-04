# Data model

Defined in `shared/models.ts` (documents), `shared/enums.ts` (vocabularies) and
`shared/containers.ts` (the physical Cosmos schema). The provisioning script and
the Cosmos repository both read `containers.ts`, so a query can never assume a
partition key the container was not created with.

The shape extends AxisTwelve's Lot → Customer → Order model: `Lot` is the batch,
`User` covers both sides of the trade, and `Order` is one manifest line.

## Containers

| Container | Partition key | Why |
|---|---|---|
| `users` | `/id` | Point reads by id dominate. |
| `usernames` | `/id` | Reservation records making usernames globally unique; see below. |
| `listings` | `/sellerId` | Storefronts and seller dashboards read one seller at a time. |
| `lots` | `/sellerId` | Lots are always managed in the context of their seller. |
| `orders` | `/lotId` | **Generating a lot manifest is the hot path** and becomes a single-partition read. |
| `reviews` | `/subjectId` | Reviews are read as "everything about this user" — exactly one partition. |
| `disputes` | `/orderId` | A dispute belongs to one order and is always fetched with it. |
| `sessions` | `/id` | Mock-auth revocation list. TTL-expiring, so it stays tiny. |

Throughput is provisioned on the *database* (1000 RU/s shared) rather than per
container, which fits the Cosmos free tier exactly.

### Trade-offs taken

- **`orders` by `/lotId`** makes the manifest cheap and a buyer's order history
  cross-partition. That is the right way round — manifests are generated
  constantly by sellers, order history is opened occasionally by one buyer — and
  a composite index on `(buyerId, createdAt)` keeps the cross-partition query
  ordered. Revisit with a materialised per-buyer view if it gets hot.
- **The unified catalog is cross-partition** by construction, since it spans all
  sellers. Partitioning listings by seller is what keeps storefronts to a single
  partition; the catalog is the query that pays for it. It will need a search
  index (Azure AI Search) rather than a Cosmos query once filters and
  reverse-image search land.
- **Usernames are unique via a reservation container, not a unique key.**
  Cosmos enforces unique keys *within a logical partition*, and `users` is
  partitioned by `/id` — so a unique key on `/username` would be vacuous, since
  every user is alone in its partition. Instead, `usernames` holds one document
  per name with the lowercased username as its `id`: creating it either succeeds
  or returns 409, which is the constraint. Writing it before the user document
  makes a claimed-but-unused name the only failure mode, and sign-in becomes two
  point reads instead of a cross-partition query. Email needs the same treatment
  when sign-up lands.

  The unique key on `reviews` *is* meaningful: it is scoped to `/subjectId`, and
  every review of one order in one direction shares that subject.
- **`filledCount` on `Lot` is denormalised** from the orders in that lot, so
  listing lots does not require counting orders per lot. It must be updated in
  the same operation that creates or cancels an order.

## Money and weight

All amounts are integers in **minor units** (paise) with an explicit `currency`,
never floats. Only the UI converts, in `app/src/format.ts`. Weights are integer
grams, feeding both the packing/box estimator and the per-lot landed-cost model.

## Lots and stages

`LOT_STAGES` is ordered, and that order *is* the fulfilment pipeline:

```
ordering → china_wh_received → dispatched_from_china
  → india_received → qc_repack → local_dispatch → delivered
```

Progress is computed from the index, so the seller's working view and the
buyer's tracking timeline render from one array. Every transition appends a
`StageEvent` with who recorded it and when, which is what buyer status pings and
the time-in-stage analytics will read.

`LotStatus` (`draft`/`open`/`filled`/`closed`/`cancelled`) is deliberately
separate: it describes the group-buy's commercial lifecycle, which moves
independently of where the physical goods are.

## Trust, reviews and escrow

- **`VerificationState`** carries a status per artefact — phone, email,
  government ID, address, payment method, bank/UPI-to-ID match, business
  registration — plus who last reviewed it. Sellers need ID and bank match to
  reach `verified`; business registration is the additional Pro-tier evidence.
- **`TrustSignals`** keeps the published score alongside its components
  (completed transactions, disputes lost, on-time dispatch rate, repeat-customer
  rate) so the weighting can be tuned without recomputing from scratch, and so
  fraud checks can flag sudden drops or clustered new-account reviews. Nothing
  computes it yet.
- **`Review`** is written against a completed order — `orderId` is required, and
  a unique key on `(orderId, direction)` enforces at most one review per side
  per order. `revealed`/`revealAt` implement the blind simultaneous reveal that
  stops retaliatory rating.
- **`EscrowRecord`** is embedded in the order rather than stored separately: it
  has the same lifetime and is always read with it. `autoReleaseAt` is the
  deadline for release when the buyer neither confirms nor disputes.

## Conventions

- Every document has `id`, `createdAt`, `updatedAt`. `createdAt` is never mutated.
- Vocabularies are `const` arrays with a derived union type, not TypeScript
  `enum`s, so the same values work in the API (compiled by `tsc`) and the
  browser (bundled by Vite) with no runtime shim.
- Snapshot fields — `Order.itemName`, `Order.unitPriceMinor` — are copied at
  order time because listings can be edited afterwards and a manifest must
  reflect what was actually bought.
- Large or never-queried properties (`description`, `photos`, `stageHistory`,
  `evidence`) are excluded from indexing to keep write RU cost down.

## Not yet modelled

Wishlists and restock notifications, the community feed, the payout ledger,
buying-agent contact book, and image hashes for reverse-image search
(`ListingPhoto.imageHash` is reserved but unused).
