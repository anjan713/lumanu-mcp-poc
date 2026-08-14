---
status: accepted
---

# Funding is a PostgreSQL function, not a Hasura mutation

`fund_payables` — and, for consistency, `approve_payable` and `cancel_payable` — are plpgsql
functions in `db/migrations/0002_write_functions.sql`, tracked in Hasura and exposed as GraphQL
mutations. `MockLumanuProvider` calls them like any other operation, so nothing above the
provider boundary changes.

## Why not an ordinary Hasura mutation

A Hasura mutation runs all of its fields in a single transaction. That sounds like enough, and
it is the reason the option was considered at all. It is not enough, because **a Hasura
mutation has no way to abort**.

Guards in a mutation are `where` clauses. A `where` clause that matches nothing updates zero
rows and reports success. So a mutation shaped like

```graphql
mutation {
  debit:  update_workspaces(where: {..., available_balance_cents: {_gte: 1000000}}, ...)
  settle: update_payables(where: {id: {_in: [...]}, status: {_eq: "approved"}}, ...)
}
```

commits whatever each field managed to do. If the Payables turn out not to be approved, the
second field updates nothing — and the debit in the first field is committed anyway. The
Workspace Balance goes down and nobody gets paid.

Checking `affected_rows` afterwards does not help. By the time the client can read it, the
transaction has committed.

Funding has to check every Payable's status, check every Partner's status, total the amounts,
verify and debit the balance, record the Funding and its Balance Transaction, and move the
Payables to `will_pay` — and any one of those checks must be able to stop all of it. Only
something running inside the transaction can do that.

## Why the functions return an outcome row rather than raising

`raise exception` inside plpgsql would also be atomic, and was the first shape tried. The
problem is on the way back out: Hasura surfaces the failure as a GraphQL error string, and the
provider would have to parse prose to tell "insufficient balance" from "this Payable is not
approved" from "no such Payable".

Those have to be distinguishable. They call for four different responses — add money, approve
the Payable, fix the identifier, fix the request — and an agent that receives one opaque
failure can only retry, which is the worst possible reflex in a payment tool.

So each function returns one row naming what happened:

```
ok | not_found | invalid_input | invalid_state | insufficient_balance
```

with the subject, the current state, and the required and available amounts where they apply.
`MockLumanuProvider` maps that to the same typed errors `InMemoryLumanuProvider` raises. A
rejection is a normal return, and returns nothing to the database — the function has written
nothing at that point, because every check precedes every write.

## What this costs

**The rules exist twice.** They are in plpgsql for the database and in TypeScript for the
in-memory fixture, and nothing but the contract suite stops them drifting apart. That suite
runs the same write assertions against both, which is the only reason this is acceptable
rather than reckless.

Two caveats on that mitigation, both worth knowing before relying on it:

- The suite only holds the database to account **when credentials are present**. Without them
  the Hasura subject skips, and what remains is the fixture agreeing with itself.
- Two rules cannot be reached through the public interface from canonical data — funding a
  Payable whose Partner is not onboarded, and a shortfall — because the scenario contains
  neither case and no write can create one. Both are covered per implementation instead,
  and the contract suite says so where the tests would otherwise appear to be missing.

`src/providers/writes.ts` names the Partner status and the audit events for the TypeScript
side. A migration cannot import from `src/`, so the SQL spells the same values out again;
that file removes one source of drift, not the source of drift.

**A table exists that holds no rows.** Hasura refuses to track a function that does not return
a table, so `write_outcomes` is a real table used purely as a return shape. It is commented as
such in the migration and in the tracking script.

**Migrations now carry logic.** `db/migrations` was schema; it is now schema and behaviour, and
a reviewer reading only the TypeScript will not find the funding rules.

## What we get

The property the ticket actually asks for: a failure part-way leaves the balance and the
Payable statuses consistent with each other. Asserted directly against the real database in
`tests/integration/mock-provider.test.ts`, which funds an invalid batch and then checks that
the balance is unchanged, the valid Payable in the batch is untouched, and no `fundings` or
`funding_payables` row was created.

Row-level locking comes with it. `select ... for update` on the Workspace holds the balance for
the rest of the transaction, so two concurrent Fundings cannot both read the same available
balance and both conclude that they fit.

## Consequences

`RealLumanuProvider` is unaffected. Lumanu's own `POST /funding` performs these checks
server-side and returns an error; that provider will map its failures to the same typed errors,
and the interface above the boundary does not change. This decision is about how *the mock*
keeps a promise the real API keeps for itself.

Moving away is contained: the functions are one migration file and one branch of one provider.
Nothing above `LumanuProvider` knows they exist.
