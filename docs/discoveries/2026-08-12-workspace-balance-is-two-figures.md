# The Workspace Balance is two figures, not one

## Summary

We modelled the Workspace Balance as a single number: the money a Workspace has pre-funded
and can draw on. Lumanu returns an account whose `balance` is an *object* carrying two
integers — `balance` and `available_balance`. They are not the same figure, and the one that
governs whether a Funding can proceed is `available_balance`.

## What we found

`GET /workspace/{id}/wallet` returns an `Account`:

```json
{
  "balance": { "available_balance": 100000, "balance": 100431 },
  "display_name": "Test Platform Org 7",
  "denomination": "us_cents",
  "created_at": "2025-04-29T21:32:37.12041+00:00",
  "updated_at": "2025-04-29T21:32:39.190731+00:00"
}
```

Note the nesting: the field named `balance` contains an object that itself has a field named
`balance`. Both inner fields are `integer` and `readOnly`.

In Lumanu's own published example the two differ — `100431` held against `100000` available.

`Transaction` complements this with `balance_change` and `ending_balance` alongside `amount`,
so the ledger explains how a figure was reached, with `type` of `deposit`, `fee`, `payment`,
`withdrawal` or `invoice` and `status` of `pending` or `processed`.

## Why it matters

Funding Capacity — "can this Workspace pay everything currently ready?" — is a subtraction,
and picking the wrong operand gives a confidently wrong answer. Reading `balance` where
`available_balance` was meant would report capacity the Workspace does not have, and the
error would surface as a rejected Funding against the real API rather than as a bad number
in a test.

The nesting makes this easy to get wrong in a way that still compiles and still validates:
`account.balance` is a legitimate expression that yields an object, and
`account.balance.balance` is a legitimate expression that yields the wrong integer.

## Details

The original model came from the domain story, where the Workspace Balance is described as
one quantity because that is how a finance operator thinks about it — "we have $15,000". That
framing is right for the glossary and wrong for the wire.

The distinction is the ordinary one in payment systems: money *held* versus money *free to
commit*. A pending debit reduces what you can spend before it reduces what you hold. Lumanu
publishes no description for either inner field, so this reading is an inference — from the
field names, and from the published example where the available figure is the lower of the
two, which is the direction the distinction predicts.

That inference is worth flagging as an inference. It is well supported and it is not
documented. If a Lumanu sandbox ever becomes available, confirming the relationship between
the two figures under a pending transaction is a cheap and worthwhile check.

For this POC the two are seeded equal, because nothing in the canonical Acme scenario holds
funds back: the balance opens at $25,000, StudioX's $10,000 Funding is history, and $15,000
stands. Seeding them equal is a property of the scenario, not a simplification of the model
— the wire type keeps both figures rather than flattening to one, so a scenario that did
hold funds back would need no change to the provider boundary.

The glossary is unchanged and still correct. "Workspace Balance: the money a Workspace has
already pre-funded and can draw on to pay Partners" describes `available_balance` precisely.
`CONTEXT.md` describes meaning; it does not describe wire shape.

## How we verified it

Read from the harvested `Account` schema in `docs/lumanu-reference/openapi.json`, including
Lumanu's own `x-examples` block quoted above. A test asserts the nesting directly, so a
re-harvest that flattened `balance` to a number would fail rather than silently change what
the provider reads:

```
it('reports the Workspace Balance as an object of two figures, not a number', ...)
```

The `us_cents` denomination on `Account` is enum-constrained, unlike the same concept on
`Payable` — see the contract-mismatch discovery.

## Resulting decision

> The Workspace Balance that Funding Capacity is measured against, and that
> `get_workspace_balance` reports, is `available_balance`. Both figures are preserved on the
> wire type rather than flattened to one. The canonical seed sets them equal.

## Related files

- `src/providers/wire.ts` — the `Account` type and its note
- `docs/lumanu-reference/fragments/get-workspace-wallet.json`
- `tests/lumanu-contract.test.ts` — the nesting assertion
- `docs/02-official-api-sources.md` — "The Workspace Balance is an account with two figures"
- `CONTEXT.md` — the Workspace Balance glossary entry
