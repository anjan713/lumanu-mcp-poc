# The two providers disagreed about what "not found" means for a list

## Summary

Asked for the Partners of a Workspace that does not exist, `InMemoryLumanuProvider` threw and
`MockLumanuProvider` returned an empty page. Both had passed every test they had until the
contract suite grew to cover the new methods, and then the same test failed against one
implementation and passed against the other.

Lumanu's published contract does not settle it: of fourteen harvested operations only two
declare a 404 at all. The rule had to be argued rather than derived.

## What we found

The two implementations had made the same decision independently and made it differently:

```ts
// InMemoryLumanuProvider — verified the Workspace, then filtered
this.workspace(workspaceId);              // throws LumanuNotFoundError
const partners = rows.filter(...)

// MockLumanuProvider — one query, scoped by a where clause
where: { workspace_id: { _eq: $workspace_id } }   // matches nothing, returns []
```

Neither is obviously wrong, which is why neither author noticed. The fixture had a Workspace
list in hand and checking it was free; the Hasura implementation would have needed a second
round trip to check, so it did not.

Looking to the contract for an answer produced very little. Only `get-workspace-partner` and
`get-workspace-project` declare a 404 response. `get-workspace`, `get-payable`,
`get-workspace-wallet`, and every list operation declare a 200 and nothing else — including
the single-resource reads, which certainly must be able to fail.

## Why it matters

The divergence is invisible in the happy path, which is where fixtures are usually exercised.
Every tool-level test injects `InMemoryLumanuProvider`, so the whole suite would have encoded
"unknown Workspace throws" as the observed behaviour of the system, and the deployed server
running `MockLumanuProvider` would have returned an empty list instead.

An agent would then have read `{ data: [], total: 0 }` as "this Workspace has no Partners",
which is a different and much more damaging answer than "no such Workspace" — it is a
plausible statement about a real Workspace, so nothing downstream has any reason to question
it.

More broadly: this is the failure mode the whole provider abstraction is exposed to. Two
implementations of one interface will diverge wherever the interface is silent, and they will
diverge in the cases nobody wrote down.

## Details

The original assumption was that the contract suite's job was to check *shape* — snake_case,
envelopes, enums, nullability. That is what it did for the two Workspace methods it started
with. What this showed is that the more valuable thing it checks is *behaviour in the cases
the interface never stated*, because those are exactly the cases where two authors making
reasonable local choices will make different ones.

The rule now stated on the interface, and enforced by the suite:

> **A single-resource read fails. A scoped list returns an empty page.**

The argument, since the contract does not supply one:

- A list has a coherent empty representation. `{ data: [], total: 0 }` is a true statement
  about a Workspace holding nothing, and about a Workspace that does not exist it is at worst
  incomplete rather than false.
- A single read has no empty representation. There is no empty Partner, so it must fail.
- Verifying the Workspace before every list would cost a second round trip per call, in
  Lambda, to guard a case the domain services already catch — `workspaceOverview` reads the
  Workspace first and fails there, so a tool answering a real question still reports the real
  problem.

The easy thing to forget: this makes the *provider* permissive and the *domain services*
strict. That is deliberate. The provider's job is to be what Lumanu is; deciding that a
question about a nonexistent Workspace deserves an error is a judgement, and judgements
belong above the boundary.

## How we verified it

The contract suite grew from 14 tests to 51 with the ticket 05 methods, and was run against
both implementations. Two tests failed against `MockLumanuProvider` and passed against
`InMemoryLumanuProvider`:

```
● MockLumanuProvider — LumanuProvider contract › listPartners › scopes Partners to the Workspace asked for
    expect(received).rejects.toThrow()
    Received promise resolved instead of rejected
● MockLumanuProvider — LumanuProvider contract › listBalanceTransactions › rejects an unknown Workspace
    expect(received).rejects.toThrow()
```

This required the Hasura-backed suite to actually run — it skips itself when the data layer is
not configured, and on a fresh clone the divergence would still be sitting there undetected.
That is worth remembering: a contract suite that skips is a contract suite that proves
nothing.

Which behaviour to keep was then decided by reading all fourteen harvested operations for
declared 404 responses, which found only two.

## Resulting decision

Scoped list methods return an empty envelope for a Workspace that holds nothing, including one
that does not exist. Single-resource reads throw `LumanuNotFoundError`. The rule is stated on
`LumanuNotFoundError` in `src/providers/lumanu-provider.ts`, and the contract suite asserts
both halves against every implementation.

## Related files

- `src/providers/lumanu-provider.ts`
- `src/providers/in-memory.ts`
- `src/providers/mock.ts`
- `tests/support/provider-contract.ts`
- `tests/integration/mock-provider.test.ts`
