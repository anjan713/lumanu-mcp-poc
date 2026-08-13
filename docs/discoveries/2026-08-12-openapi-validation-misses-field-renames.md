# OpenAPI validation does not detect a renamed field

## Summary

We assumed that validating a value against Lumanu's published OpenAPI schema would catch
the mock drifting away from the real contract. It does not. Lumanu's schemas mark almost
nothing `required` and forbid no additional properties, so an object that has lost or
renamed a field still validates perfectly. Schema validation catches enum drift and missing
required fields, and is blind to renames — which is the commonest kind of wire drift.

## What we found

Of the nine schemas harvested into `docs/lumanu-reference/openapi.json`, seven declare no
`required` list at all:

| Schema | `required` |
| --- | --- |
| `Payable` | `workspace_id`, `amount`, `description` |
| `Funding` | `workspace_id`, `method` |
| `Workspace`, `Partner`, `PartnerDetail`, `Account`, `Transaction`, `Project`, `ProjectDetail` | *(none)* |

None of them sets `additionalProperties: false`. Under JSON Schema, that combination means
almost any object validates. Renaming `Workspace.display_name` to `displayName` in the
cached specification left the whole suite green, including the test named "matches Lumanu's
Workspace schema" — the value under test still carried `display_name`, which was now simply
an unconstrained extra property, and the renamed field was optional so its absence was fine.

Enum and required-field drift do fail. Replacing the `Partner.status` enum, or the
`amount_denomination` enum, produced real failures.

## Why it matters

The whole credibility of this POC rests on the mock being shaped like the real Lumanu API.
The contract test was the evidence for that claim, and for renames it was evidence of
nothing. Lumanu could rename a field, a re-harvest would pull the change in, every test
would stay green, and the provider mapping would keep reading a field that no longer exists
— failing only against the real API, which we have no credentials to exercise.

The failure mode is silent and arrives at exactly the moment the project claims to be
swappable.

## Details

The original assumption was the ordinary one: point a validator at the published schema,
validate what the provider returns, and drift fails the build. That is true for a schema
written to be strict. Lumanu's are not, and they are not wrong to be permissive — a public
API that forbade additional properties could not add fields without breaking clients, and
marking every field required would misdescribe an API where most fields genuinely are
optional.

What forced the question was a review pass that tried to defeat the test rather than read
it. Mutating the cached schema and observing that nothing failed is a much stronger check
than inspecting the assertions, and it is the check that should be applied to any test whose
job is to detect drift.

The corrected understanding is that a permissive schema supports two different questions,
and validation only answers the first:

1. *Is this value consistent with the contract?* — validation answers this.
2. *Does the contract still contain the fields we depend on?* — validation cannot answer
   this, because a permissive schema says yes to almost everything.

The second question has to be asked directly, by asserting the field names the schema
declares. The subtle part, easy to forget: this is not a stricter validation of the *value*.
It is an assertion about the *schema*. The thing being pinned is the contract, not the
instance.

A related gap sat behind it. `openapi.json` and `src/generated/lumanu-api.ts` are both
derived files committed next to their inputs, and nothing tied them back. A stale stitch or
stale types would have kept every other test passing.

## How we verified it

Mutation testing against the committed cache, before and after the fix.

Before: renaming `Workspace.display_name` to `displayName` in `openapi.json` left 43 of 43
tests green.

After, the same mutation fails two tests — running the two contract suites alone, hence the
40 rather than the full 54:

```
● the committed specification › was stitched from exactly the fragments committed beside it
● the fields the provider depends on › are all still declared on Workspace
Tests: 2 failed, 38 passed, 40 total
```

And the generated-types guard exits non-zero rather than passing quietly:

```
$ npm run generate:types -- --check
 ✘  Generated types are not up-to-date!
EXIT CODE: 1
```

The `required` and `additionalProperties` facts were read directly out of
`docs/lumanu-reference/openapi.json`.

## Resulting decision

Drift detection is three mechanisms, not one:

1. **Declared field names are asserted directly** for every schema the provider reads, so a
   rename or removal fails immediately and names the field. This carries the weight.
2. **The committed fragments are re-stitched and compared against `openapi.json`**, so the
   derived specification cannot drift from its own inputs.
3. **`pretest` runs the type generator in `--check` mode**, so the committed types cannot
   fall behind the committed specification.

Schema validation is kept — it catches enum drift, required-field drift and malformed values
— but it is no longer treated as sufficient on its own.

We deliberately did **not** add `additionalProperties: false` to the harvested schemas.
Lumanu is entitled to add fields, and rejecting unknown properties would make the mock fail
on changes that are not breaking. The harvested schemas are kept verbatim apart from one
narrow adaptation (see the `nullable` note in `docs/02-official-api-sources.md`).

## Related files

- `tests/support/lumanu-schema.ts` — `declaredFields`, `declaredEnum`, `expectMatchesLumanuSchema`
- `tests/lumanu-contract.test.ts` — "the fields the provider depends on"
- `tests/contract-harvest.test.ts` — "the committed specification"
- `docs/lumanu-reference/openapi.json`
- `package.json` — the `pretest` guard
- `docs/07-security-observability-testing.md` — "The harvested contract"
