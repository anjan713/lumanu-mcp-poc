---
status: accepted
---

# The provider boundary returns exact Lumanu wire format

`LumanuProvider` methods return Lumanu-compatible wire models — snake_case field names,
Lumanu's real enum values including a nullable Payable status, its `{ data, total, limit,
offset }` envelopes, its pagination semantics, and its money, date and identifier
representations — rather than cleaned-up internal DTOs. No parallel camelCase model exists
anywhere in the system. Derived business concepts such as Payment Readiness, Payment
Blocker and Funding Capacity are computed in domain services *from* these Lumanu-shaped
objects.

We chose this because the project's central claim is that `MockLumanuProvider` can be
replaced by `RealLumanuProvider` without changing anything above the provider boundary, and
that claim is only testable if both implementations return the same shapes. One contract
suite, validated against Lumanu's published OpenAPI fragments, then holds every
implementation to the same standard.

## Considered options

**Clean camelCase domain models at the provider boundary**, with each implementation
mapping internally. Rejected: it hides the mapping inside the implementation we cannot
exercise today, so the mock and the real provider could diverge arbitrarily while both
satisfying the interface. The honest reviewer question — "would this actually work against
real Lumanu?" — gets a much weaker answer.

**A hybrid**, clean models for some entities and wire format for others. Rejected as the
worst of both: a reader has to learn which entities follow which rule.

## Consequences

Lumanu's naming leaks one layer inward. Domain services read `payable.status` and
`partner.status` in snake_case and must handle a status enum that includes `null`. That
mapping cost is real, and it is paid deliberately in exchange for a swap boundary that can
be tested rather than asserted.

Because Lumanu's REST layer is Hasura's REST Endpoints feature, the envelope and pagination
this decision commits us to are close to what Hasura produces natively — so the cost of
fidelity in the mock is lower than it would be against a hand-rolled API.
