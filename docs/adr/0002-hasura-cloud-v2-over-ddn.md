---
status: accepted
---

# Hasura Cloud v2 rather than Hasura DDN

The mock's data access layer is Hasura Cloud **v2** over Supabase PostgreSQL, even though
Hasura now sells DDN and v2 is plainly not the direction of the product.

We chose v2 because it is the smaller, established path for a one-day proof of concept:
familiar metadata, a familiar CLI, and a well-trodden Codegen workflow, with no time budget
available for learning DDN's supergraph and connector model. Lumanu's own API also runs on
Hasura Cloud v2 — its token audience is `https://lumanu-demo.hasura.app/v1/graphql` — so
this is additionally the faithful choice.

**Not** because DDN lacks RESTified endpoints. It has them via a plugin. Hasura's REST
Endpoints feature is irrelevant to this project in any case: Lumanu compatibility is the
provider's responsibility, and the contract boundary is Hasura GraphQL →
`MockLumanuProvider` → Lumanu wire-format objects. This is recorded because the reasoning
is easy to reconstruct wrongly.

## Consequences

We are building on a product in maintenance. If v2 Cloud signup is ever closed, the
fallback is self-hosted Hasura v2 CE, whose Docker image is still published — that changes
nothing above the provider boundary, at the cost of running a container somewhere.

Supabase must be reached through the Supavisor session-mode pooler on port 5432. Direct
connections may be IPv6-only, and transaction-mode pooling on 6543 breaks the prepared
statements Hasura uses by default.

Funding cannot be expressed as a plain Hasura mutation: it needs conditional validation
with rollback, and a Hasura mutation runs its fields in one transaction but cannot abort
when a guard fails. It is therefore a PostgreSQL function tracked in Hasura and called
through Apollo, which keeps the operation atomic and the layering intact.
