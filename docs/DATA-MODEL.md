# Data model

Defined in `shared/models.ts` (documents), `shared/enums.ts` (vocabularies) and
`shared/containers.ts` (the physical Cosmos schema). The provisioning script and
the Cosmos repository both read `containers.ts`, so a query can never assume a
partition key the container was not created with.

The shape extends AxisTwelve's Lot → Customer → Order model: `Lot` is one
shipment, `User` covers both sides of the trade, and `Order` is one manifest line.

## Containers

| Container | Partition key | Why |
|---|---|---|
| `users` | `/id` | Point reads by id dominate. One record per account, covering buyer, seller and forwarder facets. |
| `userParts` | `/userId` | The account's growing lists, one document per part: collection and shelves, share and invite logs, affiliate records, push endpoints, devices, calculator sheets. See below. |
| `usernames` | `/id` | Reservation records making usernames globally unique; see below. |
| `listings` | `/sellerId` | Storefronts and seller dashboards read one seller at a time. |
| `lots` | `/sellerId` | Lots are always managed in the context of their seller. |
| `orders` | `/lotId` | **Generating a lot manifest is the hot path** and becomes a single-partition read. |
| `reviews` | `/subjectId` | Reviews are read as "everything about this user" — exactly one partition. |
| `disputes` | `/orderId` | A dispute belongs to one order and is always fetched with it. |
| `sessions` | `/id` | Mock-auth revocation list. TTL-expiring, so it stays tiny. |
| `notifications` | `/userId` | "Everything waiting for me". Expires 90 days after its last write. |
| `siteContent` | `/id` | Operator-written pages, settings, and the logs kept as lists (fee ledger, audit trail). TTL enabled per document. |

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
- **Lot writes are checked like order writes.** `updateLot` is conditional on
  the etag it was read with, so the shop and its forwarder moving a lot at
  once, or a note landing while it moves, merge or are refused - never one
  quietly losing the other's event.
- **Lookups by id are point reads once seen.** `getOrder` and `getListing` know
  only an id, and orders are partitioned by lot, so each was a query across
  every partition. The repository remembers which partition each id was last
  read or written in (bounded) and reads it directly, falling back to the
  query when it has not seen it or it has moved.
- **`filledCount` on `Lot` is denormalised** from the orders in that lot, so
  listing lots does not require counting orders per lot. It must be updated in
  the same operation that creates or cancels an order.

## Keeping the database small

- **Indexing is opt-out per path.** Every field is indexed unless the
  container excludes it, and the index costs storage like the data does. So
  anything read whole and never filtered or sorted by - an order's timeline,
  photos and payments; a user's verification, trust and profile prose; a
  notice's words; every `siteContent` document's `data` - is excluded in
  `shared/containers.ts`. Composite indexes exist only where a query sorts on
  them. Before excluding a path, check no query in `cosmos-repository.ts`
  filters or sorts on it.
- **Policies reach existing containers.** Creating a container applies its
  policy, but a container created earlier keeps the old one. The API compares
  each container's indexing and TTL with the schema on start-up (remembered by
  a hash, so it is one point read once done) and replaces what differs;
  `npm run azure:provision` does the same. Unique keys cannot change after
  creation and are kept.
- **Expiry instead of sweeping.** Notifications expire 90 days after their
  last write; a notice taken back by an undo is deleted at once. Audit-trail
  days carry their own 90-day `ttl`.
- **Logs are split by period, never trimmed.** The fee ledger is one
  `siteContent` document per month (`fee-ledger-YYYY-MM`) and the audit trail
  one per day (`audit-YYYY-MM-DD`); a period that outgrows 512 KB carries on in
  `<id>.2`, `<id>.3` (`api/src/site-log.ts`). The queues that are trimmed
  (dispute actions, community notices, content reports) are also held under
  1.5 MB, well inside Cosmos's 2 MB item limit.
- **The audit trail is off by default.** An operator turns it on from the
  console's Audit trail tab. While off nothing is written - not even the switch
  being turned off.
- **Deleting takes the leftovers along.** Deleting an account deletes its
  notifications, saves (dropping each listing's saved count), follows both ways
  (dropping follower counts), hunts with their answers and seekers, and the
  reviews on its page. Deleting a listing deletes its comments, pledges and
  saves. Pledges, answers and reviews the account left on other people's pages
  stay, like its orders. A one-off pass on start-up removed what deletions
  before this left behind, along with withdrawn notices and audit days older
  than 90 days.

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

### The lot holds the step

The lot is the one record of where a consignment is. Moving a lot, noting
something on it or giving it a new route writes the lot and nothing else, so a
crate of forty items is one write rather than forty-one - and there is no
half-moved lot when one of those writes fails.

Each order stores only what is its own: paid, ticked in at the warehouse,
dispatched, delivered, a step this one item took. The repository reads every
order with its lot applied and writes back only what the caller changed
(`api/src/data/lot-view.ts`, wrapped around whichever store loads):

- **News.** Lot events buyers should read carry `seq`, the lot's running count
  (`Lot.seq`). An order remembers the last one it already holds
  (`Order.lotSeenSeq`) and reads the rest off the lot. Events the lot keeps to
  itself - closing, reopening - carry no `seq` and reach no timeline. A counter
  rather than a time, because a join and a move can land in the same
  millisecond.
- **Position.** An item follows its lot once the lot has moved
  (`Lot.movedSeq`) since the item was last placed on its own
  (`Order.positionSeq` - it joined, or the seller moved it alone).
- **Reach.** An item called off or refunded hears nothing more; one delivered
  on its own hears notes but not moves; everything else travels with the lot.
- **Leaving.** An item that joins another lot, leaves one, or stops keeps
  what it was told as its own history, since it will not read that lot again.

Orders written before this hold copies of every lot event and no counters, so
they read exactly as they did, and the next move of their lot reaches them.

`LotStatus` (`draft`/`open`/`filled`/`closed`/`cancelled`) is deliberately
separate: it describes the group-buy's commercial lifecycle, which moves
independently of where the physical goods are.

## One account, both sides

There is no buyer account and no seller account. A single `User` record carries
everything, and what it may do is derived rather than declared:

- **`sellerProfile`** is `null` until the account lists something. Its presence
  is what makes an account a seller — not a role, not a second signup.
- **`forwarderProfile`** is the same idea for freight forwarders, who share the
  account base rather than living in a separate system.
- **`isAdmin`** is the one genuine assigned role, so it is stored.
- Everything else (`canBuy`, `canSell`, `canForward`) is computed by
  `deriveCapabilities` from verification state, in `shared/capabilities.ts`.

Buyer and seller trust are **separate records** (`buyerTrust`, `sellerTrust`),
because they genuinely diverge: a long-standing reliable buyer can be brand new
at selling, and one combined number would lend unearned credibility to a first
listing. Only `sellerTrust` carries the dispatch and repeat-customer stats.

## Forwarders

Forwarders self-list; nothing about them is admin-entered. `ForwarderProfile`
holds the company, the China→India routes with claimed rates and turnaround, and
a trust record fed by ratings from sellers whose lots they actually shipped —
the same completed-transaction gate as buyer and seller reviews, so a rating
cannot exist without a shipment behind it.

`Lot.forwarder` deliberately does **not** require a directory pick. A seller
already working with someone off-platform types in the name, contact and
tracking reference, and the lot behaves identically (`forwarderUserId` is then
`null`). Directory adoption grows because sellers find it useful, not because
the schema forces it. Tracking is the reference as entered — there is no live
carrier API pull yet.

## Trust, reviews and held payments

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
- **`PaymentHold`** (`order.hold`) is embedded in the order rather than stored
  separately: it has the same lifetime and is always read with it. Figmark
  itself holds every payment bought with Buyer Protection. `autoReleaseAt` is
  the deadline for release when the buyer neither confirms nor disputes.
- **`OrderProtection.managerId`** is the community manager the system assigns
  at checkout. They are paid a share of the protection fee (Figmark keeps its
  commission), hear any dispute on the purchase, and - once the buyer, the
  seller and the decision agree (`Dispute.agreements`, or a settlement) -
  release the held money as `Dispute.releaseDuty` says. A missed deadline,
  to decide or to release, notifies the operators; two days later it moves to
  another active manager.

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

## Concurrent writes

Orders, listings and users are read, changed in memory and written back whole,
so every such write is conditional on the etag it was read with
(`api/src/data/concurrency.ts`). When another write got there first, the two
changes are compared field by field against what both started from: fields
only this writer changed are applied on top of the winner (a seller's edit
survives a view being counted), and a field both changed - even to the same
value - refuses the write with `409 changed_meanwhile`. That is what stops two
`pay` calls recording two payments, and a stale stock count overwriting a sale.
`pay` saves the order before the protection fee reaches the ledger, and placing
an order claims it before taking stock, so the request that loses has charged
and taken nothing. The in-memory store is one process and writes in place, so
it has no such check.

## An account and its parts

The lists on an account that only grow live in `userParts`, one document per
part in the account's partition (`api/src/data/user-parts.ts`): `collection`
(cards and shelves), `sharing`, `affiliate`, `push`, `devices` and `profit`.
On the `users` row they pushed it toward Cosmos's 2 MB item limit, and every
screen touching any of them wrote the same document.

`getUserById` reads the row and its parts (one single-partition query) and
hands back one user. `updateUser` writes only the parts that changed, each
checked against its own etag, then the row. So saving a collection card and
turning notifications on never contend; two screens changing the same part
merge or are refused like any other checked write. Users read from list
queries carry no parts, and saving one leaves the parts alone.

Rows written before the split carried these fields inline; a one-off pass on
start-up saves each such account once, which moves them into their parts. The
game state (`quest`) stays on the row: it is capped, and the leaderboard sorts
on it.

## Not yet modelled

Wishlists and restock notifications, the community feed, the payout ledger,
buying-agent contact book, and image hashes for reverse-image search
(`ListingPhoto.imageHash` is reserved but unused).
