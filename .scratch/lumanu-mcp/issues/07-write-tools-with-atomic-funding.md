# 07 — Write tools with atomic funding

**What to build:** The ability to change state, behaving like financial infrastructure
rather than CRUD. An agent that can approve and fund without understanding preconditions can
approve something that cannot be paid, or pay something already paid — so every write
validates current state first, returns the resulting state, and leaves an audit record.

Funding is the hard one. It must check every Payable's status, check every Partner's status,
total the amounts, verify and debit the balance, record the Funding and its Balance
Transaction, and move Payables to `will_pay` — all or nothing. A Hasura mutation runs its
fields in one transaction but cannot abort when a guard fails, so a guard-based mutation can
debit the balance while skipping the Payable updates. Funding is therefore a PostgreSQL
function tracked in Hasura and called through Apollo, which keeps the layering intact.

**Blocked by:** 06

**Status:** ready-for-agent

- [x] `approve_payable` moves an `unapproved` Payable to `approved` and returns the new state
- [x] Approving a Payable that is already funded or canceled is rejected
- [x] `cancel_payable` withdraws an obligation raised in error and returns the new state
- [x] Cancelling a funded Payable is rejected, so committed money cannot be silently unwound
- [x] `fund_payables` draws from the Workspace Balance, records a Balance Transaction, and moves Payables to `will_pay`
- [x] Funding is atomic: a failure part-way leaves balance and Payable statuses consistent
- [x] Insufficient balance rejects the entire request, leaving all state untouched
- [x] Any `unapproved` or `canceled` Payable in the request rejects the entire request
- [x] Any Partner not `completed_w9` rejects the entire request
- [x] An already-funded Payable in the request is a no-op returning its existing Funding, not an error
- [x] A Payable is never funded twice, so a retried request cannot double-debit
- [x] A mixed batch funds only what needs funding
- [x] Every state change writes an audit event named after Lumanu's corresponding webhook event
- [x] Errors are distinguishable by kind: not found, invalid input, invalid state, insufficient balance
- [x] After approving Alex, funding Maya and Alex requires $10,000 against $15,000 and leaves $5,000 — asserted directly

## Worth knowing

**The functions return an outcome row rather than raising.** Raising would be atomic too, but
the reason would have to be parsed back out of a GraphQL error string to tell "insufficient
balance" from "not approved" — and the caller has to tell them apart. See
[ADR 0005](../../../docs/adr/0005-funding-is-a-postgresql-function.md).

**Hasura will not track a function that does not return a table**, so `write_outcomes` is a real
table that never holds a row, existing only as a return shape. See
[the discovery note](../../../docs/discoveries/2026-08-13-hasura-only-tracks-functions-that-return-a-table.md).

**The rules exist twice** — plpgsql for the database, TypeScript for the fixture — and only the
contract suite stops them drifting. That suite now runs its write assertions against both, and
the Hasura side reseeds before each one.

## Verified per implementation rather than through the shared suite

Two rules cannot be reached through the public interface from canonical data, because the
scenario contains neither case and no write creates one. Both are covered against **both**
implementations, just not through the shared suite — which says so where the tests would
otherwise look missing.

**"Any Partner not `completed_w9` rejects the entire request."** Needs a Payable belonging to
an un-onboarded Partner. Sarah Chen is the un-onboarded Partner and deliberately has no
Payable. `in-memory-provider.test` constructs one; `integration/mock-provider.test` uses a
generated Payable, whose Partner is never `completed_w9` by construction, and asserts the
rejection names the **Partner** — `invalid_state` alone would not distinguish it from "not
approved".

**"Insufficient balance rejects the entire request."** Every approved Payable fits inside the
$15,000 balance. `write-tools.test` builds a Workspace holding $100; `integration/mock-provider.test`
lowers the balance directly, then asserts the error, the untouched balance, the unchanged
Payable and that no `fundings` row was written.

## Bugs the review found

**Duplicate `payable_ids` in one request.** The loop decides what to fund by looking for an
existing Funding link, and none exists yet inside the transaction — so the same id twice was
counted twice. In the fixture that debited $5,000 for a $2,500 Payable; in SQL the unique
constraint caught the second insert, but as a raw `duplicate key value violates unique
constraint` rather than as an outcome row, which is exactly the opaque failure ADR 0005 exists
to prevent. Both now deduplicate, and both guards were confirmed by removing them and watching
the new tests fail.

**A contract test asserted the opposite of its name.** `rejects the whole request when the
balance does not cover it` funded $10,000 against $15,000 and asserted it *succeeded*. The tell
was an imported `LumanuInsufficientBalanceError` that the file never used. The SQL shortfall
branch had no test reaching it at all.

**`payable.canceled` was never asserted.** Deleting the audit insert from `cancel_payable`
failed nothing. Both audit tests now cover all three events.

**Input checks ran in a different order in each implementation.** The fixture resolved the
Workspace before validating `method`, so an unknown Workspace with `method: "invoice"` gave
`not_found` in one and `invalid_input` in the other. The fixture now validates first, and the
contract suite asserts the order.

## Audit event names

`payable.approved`, `payable.canceled`, `funding.created`.

`docs/03` names `payable.paid` as a third example. It is not used: funding here moves a Payable
to `will_pay` and no flow reaches `paid`. Worth stating plainly — **these names are not
harvested.** No webhook reference was among the fourteen pages this project extracted its
contract from, so unlike every field name and enum in `wire.ts` they are our convention rather
than a verified fact.

## Also fixed here

`CreateFundingRequest` had resolved to `never` since ticket 02 — the request-body extraction did
not allow for `requestBody` being generated as optional. Nothing failed, because `never` is
assignable to everything and accepts nothing.
[Discovery note](../../../docs/discoveries/2026-08-13-a-type-that-silently-resolved-to-never.md).

`resolvable_here` on the approval blocker is now `true` and names `approve_payable`, which
ticket 06 deferred until the tool existed.

The error classes now share a `LumanuError` base carrying `kind` and `detail()`, replacing a
name-keyed lookup table beside an `instanceof` ladder — two dispatch mechanisms that could
disagree, dropping the amounts from a shortfall.

`LumanuQueryError` maps to `invalid_input`, so a **read** tool given an unsupported `order_by`
now returns the same structured refusal a write does. That is a change the ticket did not ask
for; it is kept because one shape for every refusal is easier for an agent than two, and
`isError` was already set either way.
