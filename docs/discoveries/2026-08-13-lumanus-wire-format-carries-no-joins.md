# Lumanu's wire format carries almost none of the joins the tools assumed

## Summary

Ticket 05 specified tools that filter Payables by status, identify the Partner on a Payable,
and identify the Funding and Partner behind a Balance Transaction. Building them, we found
that Lumanu's published contract supports none of the three directly: there is no status
filter, no `partner_id` on a Payable, and no reference of any kind on a Transaction.

Two of the three are recoverable above the provider boundary. The third is not recoverable at
all, and the tool ships without it rather than with an invented field.

## What we found

**A Payable has no `partner_id`.** Lumanu identifies the Partner by three denormalised
fields instead:

```
vendor_display_name   "StudioX LLC"
vendor_email          "billing@studiox.example.com"
payee_lumanu_id       "LUM100004"
```

`payee_lumanu_id` is the only stable identifier of the three, and a Partner who has not
finished onboarding does not have one — Sarah Chen's `lumanu_id` is null. So a Payable
belonging to an un-onboarded Partner cannot be joined back to that Partner by id at all.

**The Payables endpoint has no status filter.** Its complete query parameter set is
`limit`, `offset`, `workspace_id`, `project_id`, `order_by`, `order_by_direction`. Status is
absent even though `status` is the field the whole approval flow turns on.

**A Transaction references nothing.** The full schema is nine fields — `id`, `description`,
`created_at`, `amount`, `amount_denomination`, `balance_change`, `ending_balance`, `status`,
`type`. No `funding_id`, no Partner, no Payable. And there is no endpoint that *lists*
Fundings, only `POST /funding` and `GET /funding/{id}`, so the correlation cannot be
reconstructed by fetching the other side either.

The only thing linking the StudioX debit to StudioX is free text: `"Funding — StudioX LLC"`.

## Why it matters

Had we not checked, the obvious implementation would have added `partner_id` to the Payable
and `funding_id` to the Transaction — both are columns the internal schema already holds, so
both are one line of mapping code away. Every test would have passed. The provider contract
suite would have passed, because it validates against Lumanu's schemas and Lumanu marks
almost nothing `required` and sets no `additionalProperties: false` — the same weakness
recorded in [the OpenAPI drift note](./2026-08-12-openapi-validation-misses-field-renames.md).

The failure would have arrived on the day `RealLumanuProvider` was connected, in the form of
tools that had been working for months returning `undefined` for the field every downstream
agent had learned to rely on. That is precisely the drift ADR 0001 exists to prevent, and it
would have been introduced by the most natural-looking code in the change.

The status filter matters differently. Filtering a page rather than the set produces a `total`
that describes the page — so `list_payables(status: "approved")` would report "1 approved
Payable" when it meant "1 approved Payable on this page of 25".

## Details

The original assumption was that Lumanu's REST resources would be relationally shaped, with
foreign keys between them, because the internal schema is. The internal schema's own header
comment had already flagged the Payable case:

> a Payable stores `partner_id`, and the provider resolves that into the `vendor_email` /
> `vendor_display_name` pair Lumanu returns

What prompted us to look harder was writing the acceptance criteria as tests. "Payables can be
filtered by status" has an obvious provider-level implementation, and the harvested
`get-payables` operation does not offer one. Reading the rest of the operations for the same
reason turned up the other two.

**How the system behaves now.** Three different answers, because the three cases genuinely
differ:

| Case | Resolution |
| --- | --- |
| Partner on a Payable | Provider maps `partner_id` into Lumanu's three fields. Nothing above sees an id. |
| Status filter | `list_payables` reads the whole set through `collectAll`, filters, then pages. `total` describes what matched. |
| Funding on a Transaction | **Not implemented.** The tool returns Lumanu's Transaction unchanged. |

The subtle distinction that is easy to forget: the first two are *presentation* problems, so
they can be solved above the boundary from data Lumanu does return. The third is a *data*
problem — the information is not in any Lumanu response, so no amount of work above the
boundary produces it. Adding it would mean the mock could answer a question the real API
cannot, which makes the swap claim false.

The cost of the status filter is real and worth stating: filtering above the provider means
reading every Payable in the Workspace to answer a filtered query. At POC scale that is three
rows. At real scale it is the reason Lumanu should be asked for the filter.

## How we verified it

Read directly from the generated types, which are produced from the harvested fragments:

- `components['schemas']['Payable']` — no `partner_id`; `vendor_display_name`,
  `vendor_email`, `payee_lumanu_id` present
- `operations['get-payables']['parameters']['query']` — six parameters, no `status`
- `components['schemas']['Transaction']` — nine fields, no reference of any kind
- `operations` — no list-Fundings operation among the fourteen harvested

The contract suite asserts the first as behaviour rather than as a type:

```ts
it('names the Partner the way Lumanu does, without inventing a partner_id', ...)
it('offers no status filter, because Lumanu publishes none', ...)
```

The status filter's total is asserted at the tool seam, against a filtered set smaller than
the page size, so a page-filtering implementation would still pass — the assertion that
catches it is that `total` equals the number matched, not the number returned.

## Resulting decision

`LumanuProvider` mirrors Lumanu's endpoints including their gaps. Filtering and totals are
computed above it in `src/domain`. Where Lumanu carries no link at all, no link is published:
`list_workspace_transactions` returns Lumanu's Transaction unchanged, and the Partner is named
only in the description, exactly as Lumanu names it.

## Related files

- `src/providers/lumanu-provider.ts`
- `src/providers/to-wire.ts`
- `src/domain/payables.ts`
- `src/domain/collect.ts`
- `src/mcp/server.ts`
- `tests/support/provider-contract.ts`
- `docs/05-mcp-tools.md`
