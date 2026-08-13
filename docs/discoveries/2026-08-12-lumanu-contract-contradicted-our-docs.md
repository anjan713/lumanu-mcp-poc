# Lumanu's published contract contradicted our own documentation

## Summary

Our domain documents were written from reading Lumanu's guides and from reasoning about the
payment flow, before any machine-readable schema was in hand. When the OpenAPI fragments
were harvested and read, five of those written assumptions turned out to be wrong — including
one stated as a rule in the authoritative glossary. The fragments are now the source of
truth, and the documents were corrected to match them.

## What we found

| We had written | The fragment says |
| --- | --- |
| "There is **no `paid` status**" (`CONTEXT.md`, `docs/01`, `CLAUDE.md`) | `Payable.status` enum is `unapproved`, `approved`, `canceled`, `will_pay`, **`paid`** |
| `Payable.status` includes `null` | It does not. The field is *optional*, not nullable — absent, never null |
| "Payables carry **two** status fields: `status` and `vendor_status`" | **Three**: `status`, `payable_status`, `vendor_status` |
| `vendor_status` example `"Awaiting signup"` | An unconstrained string; the published example is `"verified"` |
| Open question: `POST` vs `PUT` on approve; `/payable` vs `/payables` | `POST /payable/{id}/approve`; the collection is `/payable` |
| Money representation "currently unknown" | Integer, with the unit named in a sibling field; `us_cents` throughout |

Two things the fragments *confirmed* rather than corrected: Partner status really is one
combined onboarding-and-tax enum of six values, not the two separate fields an early draft
had invented — and it is nullable, so a Partner invited but not yet through any check has no
status at all.

One correction was to a claim made **during** this work rather than before it. The first
write-up of the money finding said all five denomination fields carry a `us_cents` enum.
Only three do:

```
Transaction.amount_denomination  {"enum":["us_cents"]}
Funding.amount_denomination      {"enum":["us_cents"]}
Account.denomination             {"enum":["us_cents"]}
Payable.amount_denomination      {"type":"string"}            <- unconstrained
Project.budget_denomination      {"type":"string","nullable":true}  <- unconstrained
```

## Why it matters

Two of these would have produced wrong code rather than merely wrong prose.

`payable_status` is a genuinely different field from `status`, with an eight-value lifecycle
enum covering payee state, transfers and reversals. A domain layer written against a
document claiming only two status fields exist would have had no idea which one it was
reading, and the two disagree by design — a Payable can be `approved` by payor intent while
its lifecycle status is `awaiting_payee`.

The `paid` correction matters in the other direction. The glossary did not merely omit
`paid`; it asserted the value did not exist. A wire type built to that assertion would fail
to parse a real Lumanu response, and the failure would appear only against the real API.

## Details

The original assumption was reasonable and still produced bad results: the guides on
`developers.lumanu.com` describe the payment flow in prose, the prose is accurate about
*meaning*, and it is silent or imprecise about *shape*. Writing the domain model from the
guides captured the business logic correctly and the field-level contract incorrectly.

What caused us to question it was simply having the fragments in hand for the first time.
None of these were subtle inferences — each is visible in the JSON. The lesson is about
sequencing, not cleverness: the contract has to be harvested before the domain documents are
written against it, or the documents encode guesses that later read as facts.

The `paid` case has a subtlety worth keeping straight, because it is easy to re-break. Two
different statements were tangled together:

- *"Lumanu has no `paid` status"* — **false**, and it was in the glossary as a rule.
- *"No flow in this POC produces `paid`"* — **true**, and the reason the rule was written.

The fix was not to start using `paid`. It was to carry the value faithfully in the wire
types, keep `will_pay` as this POC's terminal state, and stop denying the value exists.
Settlement here is evidenced by a Funding and its Balance Transaction, never by a status
change. `CONTEXT.md`, `docs/01` and `CLAUDE.md` now say that, rather than the false version.

The denomination correction has the same shape: `us_cents` is the only value appearing
anywhere in the contract, but Lumanu only *constrains* it on three of five fields. So this
project emits `us_cents` everywhere while the wire types stay exactly as loose as the
contract is. `AmountDenomination` is derived from `Transaction`, the narrowest published
statement of the unit, and is not forced onto the fields Lumanu left open.

## How we verified it

Every row above was read directly from the harvested fragments in
`docs/lumanu-reference/fragments/`, which are committed verbatim. The cache is faithful: a
live re-fetch of `developers.lumanu.com/reference/get-payable.md` extracted a fragment
byte-identical to the committed `get-payable.json`.

The status enums are now asserted in tests against the cached fragment rather than against a
hand-written list, so the code and the contract are compared to each other rather than to a
second copy of the code.

## Resulting decision

> The harvested OpenAPI fragments are the source of truth for field names, nullability,
> enums, envelopes, pagination, identifiers and money. Where a fragment and a document
> disagree, the fragment wins and the document is corrected — including `CONTEXT.md`, which
> is otherwise authoritative.

`CONTEXT.md` remains authoritative for *vocabulary* — which words we use in tool names,
descriptions and results. It is not authoritative for *contract facts*.

## Related files

- `docs/lumanu-reference/fragments/` — the fragments, verbatim
- `docs/02-official-api-sources.md` — "What the harvest settled"
- `docs/01-domain-story.md`, `CONTEXT.md` — corrected
- `src/providers/wire.ts` — `PayableStatus`, `PayableLifecycleStatus`, `AmountDenomination`
- `tests/lumanu-contract.test.ts` — status vocabularies asserted against the fragment
