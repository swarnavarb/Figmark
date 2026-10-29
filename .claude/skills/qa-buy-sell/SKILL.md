---
name: qa-buy-sell
description: Test every buy and sell flow in Figmark the way real people use it - two or more personas (shop owner, buyer, brand-new signup) working the running app in a real browser, tapping buttons and reading the screen, never calling the API. Covers listing, checkout, direct payment claims, bookings, advances and credit, accept/reject/cancel, payment reversal, fulfilment and lots, delivery confirmation, reviews, disputes, wants and edge cases. Use when asked to QA, smoke-test, exploratory-test or "test like a human" anything about buying, selling, orders, payments, checkout, lots or disputes. Args - "all", a group letter (A-K), scenario ids (C4 D6), or a free-text area ("refunds").
---

# Human-style buy/sell QA

You are a team of careful human testers, not a test script. Each persona is a
person on their own phone. They read what is on screen, tap what a person would
tap, type at human speed, and notice when something looks wrong, reads badly,
or disagrees with what the other person sees. Anything a person can't see,
you don't use: **no API calls, no database reads, no editing code during a run.**

## 1. Boot

```bash
bash .claude/skills/qa-buy-sell/driver/start.sh        # build, fresh in-memory data, driver
QA_SKIP_BUILD=1 bash .claude/skills/qa-buy-sell/driver/start.sh   # restart only (= reset data)
bash .claude/skills/qa-buy-sell/driver/start.sh stop
```

The run folder (screenshots, server log, your report) is printed and also
stored in `qa-runs/LATEST`. Restarting is the only way to reset data: the
server keeps everything in memory. Restart between scenario groups whenever a
scenario needs pristine stock.

## 2. Act

Every step is one command. Each returns what the person now sees: URL,
headings, notices, any open dialog, screen text, and numbered controls.

```bash
A=.claude/skills/qa-buy-sell/driver/act.mjs
node $A meera login meera@figmark.in figmark123
node $A meera open /listing/lst_my_cards
node $A meera click "Buy now"             # by visible text / label / aria-label
node $A meera click @14                   # by number from the last screen
node $A meera click "=Sign in"            # leading = means exact match
node $A meera double "Buy now"            # an impatient double tap
node $A meera type "Transaction reference" UPI-4471882211
node $A arjun choose Lot "Add to a lot later"
node $A arjun upload @16 app/public/learn/buy-feed.jpg
node $A meera press Escape | scroll down | back | reload | look | look full
node $A meera wait "Payment sent"         # waits up to 10s
node $A meera expect "Waiting for the seller"   # PASS/FAIL line, never throws
node $A meera absent "Buy now"
node $A meera shot after-claim            # full-page screenshot into the run folder
node $A meera errors                      # page errors, console errors, 4xx/5xx (with URL) since last call
node $A --desktop priya login ...         # this persona gets a desktop screen (default: phone 390x844)
```

Pipe through `grep -v '^  @[0-9]* a '` when the link list is noise. A failed
step returns an error, a screenshot path and the screen - treat it like a person
who couldn't find the button: look again before deciding it is a bug.

## 3. The people

| Persona | Sign in | Who they are |
|---|---|---|
| `arjun` | `demo@figmark.in` / `figmark123` | Verified. Owns the shop **Arjun Collects** (UPI details set, lots, routes). Seller in most scenarios; buyer from other shops. |
| `meera` | `meera@figmark.in` / `figmark123` | Verified buyer. Also a community manager - note this when she is a party to a protected order or dispute. |
| `packer` | `packer@baiyunhobby.example` / `figmark123` | Arjun's supplier: sees lot pieces, not buyers. Use for lot/packing views. |
| `nisha` (new) | sign up through "Create account" | Unverified newcomer. The email code is shown on screen on a local run; WhatsApp and Aadhaar are not configured, so she stays unable to trade - that is the point of her scenarios. |

Other seeded shops (Tokyo Line, Gadget Grid…) cannot be signed into: buying
from them only exercises the buyer's half. For two-sided flows Meera buys from
Arjun; known Arjun listing: `lst_my_cards` (Card binder, ₹180). Arjun creates
fresh listings in group B and reuses them later - write their ids down.

## 4. How to test like a person

1. **Pick scenarios** from [SCENARIOS.md](SCENARIOS.md) matching the args
   (`all`, a group letter, ids, or an area). For `all`, go group by group in
   order; restart between groups. Track them with the task tools.
2. **Before each scenario** say in one line what the person is trying to do.
3. **Walk it** step by step. After each step, actually read the screen:
   - Does the text match what just happened? Are amounts, quantities and
     names right (₹ formatting, totals × quantity, fees, balances)?
   - Is the next step obvious? Would a first-time user know what to press?
   - Is anything disabled that shouldn't be, or enabled that shouldn't be?
4. **Cross-check the other side** after every state change: switch persona,
   open the same order, and confirm both people see the same status, amount
   and timeline. Mismatches between buyer and seller views are high-value bugs.
5. **Check notifications** (`click Notifications`) on the receiving side when
   something should have told them.
6. **Try what people actually do**: double-tap, go back, reload mid-flow, open
   the same order in a second persona, type nonsense, leave a field empty.
7. Run `errors` at the end of every scenario. Any 5xx or page error is a bug
   even if the screen looked fine. A 4xx is a bug only when the screen
   did not explain the refusal, or the page asked for something it knew the
   person could not have (background noise - S3).
8. **Screenshot** every bug and every scenario's end state.

Business rules worth knowing so you judge correctly (from `shared/orders.ts`):
a checkout is invisible to the seller until the buyer pays, claims, books or
pays an advance; a claimed direct payment waits on the seller's "Did this
payment arrive?"; reject is only before acceptance, cancel only after;
cancelling a paid order starts a payment reversal; confirming delivery is the
buyer's alone; reviews need a completed order and stay hidden until both sides
write (or 14 days); Buyer Protection pricing shows but paying into it is
intentionally disabled ("Work in progress") - report that as expected, not a bug.
When unsure whether something is a bug or a rule, read the shared module
**after** the scenario (never mid-run to steer the test) and say which.

## 5. Report

Write `<run folder>/REPORT.md`:

```markdown
# Buy/sell QA - <date>   (<n> scenarios: <pass> pass, <fail> fail, <blocked> blocked)

## Bugs  (most severe first)
### [S1|S2|S3] <one-line title>   - scenario C10, persona meera
Steps: 1… 2… 3…
Expected: …   Actual: …
Evidence: shots/012-….png, `errors` output
## UX / copy issues
## Scenario results
| id | title | result | notes |
## Not covered and why
```

Severity: **S1** money wrong, order stuck, wrong person can act, data lost,
5xx. **S2** flow works but misleads, mismatch between buyer and seller, missing
notification. **S3** copy, layout, polish. Then publish nothing and commit
nothing on your own: give the user the report path and the top bugs in chat.

## 6. Parallel runs

For a long `all` run you may hand groups to the `buy-sell-tester` agent
(`.claude/agents/buy-sell-tester.md`), one group per agent, each with its own
driver port and server port so their data never collides:
`PORT=5174 QA_DRIVER_PORT=9334 QA_BASE_URL=http://127.0.0.1:5174 QA_SKIP_BUILD=1 bash .claude/skills/qa-buy-sell/driver/start.sh`
and `QA_DRIVER_PORT=9334` on every `act.mjs` call. Only do this when the user
asked for subagents or a parallel run; otherwise run inline.
