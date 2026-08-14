# Lumanu MCP POC

A remote MCP server that lets an AI agent reason about creator payments across Lumanu
concepts — Workspaces, Partners, Projects, Payables, Workspace Balance and Funding — using
realistic mock data shaped exactly like Lumanu's real API.

> **Mock today. Real Lumanu tomorrow. MCP tools remain unchanged.**

```text
today:
MCP → Domain Service → LumanuProvider → MockLumanuProvider → Hasura Cloud v2 → Supabase

future:
MCP → Domain Service → LumanuProvider → RealLumanuProvider → Lumanu REST API
```

Nothing above `LumanuProvider` changes between those two lines, and one contract suite runs
against every implementation to prove it.

## Status

Work is tracked as eight tracer-bullet tickets in
[`.scratch/lumanu-mcp/issues/`](./.scratch/lumanu-mcp/issues/), against the spec in
[`.scratch/lumanu-mcp/spec.md`](./.scratch/lumanu-mcp/spec.md).

| # | Ticket | Status |
| --- | --- | --- |
| 01 | Repo foundation, corrected docs, ADRs | done |
| 02 | Lumanu contract harvested and typed | done |
| 03 | Data layer live: Supabase, Hasura, schema, seed | done |
| 04 | Tracer bullet: live authenticated MCP URL | built, **not deployed** |
| 05 | Read tools over the canonical data | done |
| 06 | Payment reasoning | done |
| 07 | Write tools with atomic funding | done |
| 08 | Provider swap proven, reviewer onboarding | done |

**Nothing is deployed to AWS.** The stack is written, validated and bundled, and the four
SSM parameters it reads have not been created — so the MCP URL below is a shape rather than
a live address. Everything else runs locally against Supabase and Hasura Cloud, and the
whole test suite runs with no credentials at all.

## Connect

### 1. The MCP URL

Created by `npm run deploy`, which prints it as the `McpEndpoint` stack output:

```text
https://<api-id>.execute-api.us-east-1.amazonaws.com/mcp
```

To read it back later, without redeploying:

```bash
aws cloudformation describe-stacks --stack-name lumanu-mcp-poc-prod --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='McpEndpoint'].OutputValue" --output text
```

One endpoint, `POST /mcp`, stateless Streamable HTTP. Every request is independent — no
session identifier, no resumable stream — so any Lambda container can serve any request.

### 2. A demo token

The endpoint validates an Auth0 machine-to-machine JWT on every request: signature against
the tenant's published JWKS, plus issuer, audience and expiry. Mint one with the
`client_credentials` grant; it lasts 24 hours.

```bash
export TOKEN=$(curl -s --request POST \
  --url "https://$AUTH0_DOMAIN/oauth/token" \
  --header 'content-type: application/json' \
  --data "{\"client_id\":\"$AUTH0_M2M_CLIENT_ID\",\"client_secret\":\"$AUTH0_M2M_CLIENT_SECRET\",\"audience\":\"$AUTH0_AUDIENCE\",\"grant_type\":\"client_credentials\"}" \
  | jq -r .access_token)
```

An expired token, a token for the wrong audience, and no token at all are each rejected
with `401` and a `WWW-Authenticate: Bearer` header, per RFC 6750.

### 3. Add it to Claude Code

```bash
claude mcp add --transport http lumanu <mcp-url> --header "Authorization: Bearer $TOKEN"
```

## Five things to ask it

The figures are fixed by a seeded fixture, so these answers are the same every time. The
scenario is one Workspace (`Acme US`), one Project (`Summer Creator Campaign`), four
Partners, and a Workspace Balance of $15,000 after StudioX's $10,000 Funding.

1. **"Which Partners in Acme US can I pay right now, and who is blocked?"** — Maya is ready
   with $2,500 approved. Alex is blocked on approval. Sarah has not finished onboarding.
   StudioX has already been funded and has nothing outstanding.
2. **"Why can't I pay Alex?"** — one binding reason, not a list: his $7,500 Payable is
   unapproved. It says the blocker is resolvable here, and names `approve_payable` as the
   tool that clears it.
3. **"Does the Workspace Balance cover everything that's ready to pay?"** — $2,500 required
   against $15,000 available, leaving $12,500. Only work that is genuinely ready counts, so
   Alex's blocked $7,500 does not inflate the requirement.
4. **"Approve Alex's Payable, then fund both him and Maya."** — approval, then one Funding
   of $10,000, leaving $5,000, with both Payables moved to `will_pay`. All or nothing: had
   either been unapproved or either Partner un-onboarded, nothing at all would have moved.
5. **"Show me the balance history for Acme US."** — every movement with the balance it left
   behind, so the $15,000 can be read back to the $25,000 it opened at.

Question 2 is the one worth watching. Several conditions can fail at once, and the answer
reports the one furthest upstream, because clearing anything downstream of it changes
nothing. See [`docs/05`](./docs/05-mcp-tools.md) for the precedence.

## Documentation

Read [`CONTEXT.md`](./CONTEXT.md) first — it is the authoritative glossary, and it wins over
every other document. Then:

| Document | Covers |
| --- | --- |
| [01 — Domain story](./docs/01-domain-story.md) | Entities, the canonical scenario, what the MCP should conclude |
| [02 — Official API sources](./docs/02-official-api-sources.md) | Lumanu's real contract and how it is harvested |
| [03 — Mock data plan](./docs/03-mock-data-plan.md) | Deterministic seed, schema, scale |
| [04 — Provider architecture](./docs/04-provider-architecture.md) | The swap boundary — the main USP |
| [05 — MCP tools](./docs/05-mcp-tools.md) | Tool surface, blocker precedence, funding semantics |
| [06 — Deployment](./docs/06-aws-deployment.md) | AWS, Supabase, Hasura Cloud, human setup steps |
| [07 — Security, observability, testing](./docs/07-security-observability-testing.md) | Auth0, secrets, logging, the two test seams |
| [08 — Definition of done](./docs/08-definition-of-done.md) | The completion bar for the one-day build |
| [09 — AWS cost model](./docs/09-aws-cost-model.md) | Every AWS service used, what it costs, and how to track it |
| [10 — AWS resource register](./docs/10-aws-resource-register.md) | Every AWS resource this project creates, and how to remove it |

Decisions with lasting consequences are recorded in [`docs/adr/`](./docs/adr/). Things this
project learned the hard way — a wrong assumption, a contract that disagreed with our
documentation, a test that proved less than it claimed — are in
[`docs/discoveries/`](./docs/discoveries/).

## Local setup

```bash
npm install
cp .env.example .env      # fill in Supabase, Hasura and Auth0 values
npm run typecheck
npm test
```

The test suite runs green with **no credentials** — tool-level tests inject an in-memory
provider. Credentials are only needed for the integration suite and for deployment.

### Lumanu's contract

Lumanu publishes no single OpenAPI document; each reference page embeds a fragment for one
endpoint. Those fragments are harvested and committed, so nothing in the build reaches the
network:

```bash
npm run harvest:contract   # re-fetch and re-stitch  → docs/lumanu-reference/
npm run generate:types     # stitched spec → types   → src/generated/lumanu-api.ts
```

Both outputs are committed. Run them only when Lumanu updates its documentation; the diff
then states exactly what changed in the contract, and `npm test` says whether this project
depended on it. `src/providers/wire.ts` is the readable view of those types, and it is what
the provider layer is written against.

### The data layer

Before anything touches the schema, prove the connection:

```bash
npm run db:smoke
```

Three checks, in the order they can fail: Supabase reachable on the Supavisor session-mode
pooler, Hasura Cloud reachable with the admin secret, and — the one that matters — Hasura
actually pointed at *that same* database, proven by reading back a row written over the
direct connection. Hasura answering GraphQL proves only that Hasura is awake.

Then build it:

```bash
npm run db:migrate     # apply db/migrations/*.sql
npm run db:seed        # write the canonical Acme scenario
npm run hasura:track   # track tables and relationships, export hasura/metadata.json
npm run db:reset       # all of the above, from an empty database
```

`db:reset` is repeatable and deterministic — the same rows, byte for byte, every time — so
a demo can be re-run after mutations. The scenario itself is data, in
[`src/seed/canonical.ts`](./src/seed/canonical.ts), shared by the seed and (from ticket 05)
the in-memory provider. That is why the figures a reviewer checks are tested without
credentials.

Migrations are plain SQL rather than the Hasura CLI, so no extra binary is needed;
`hasura/metadata.json` is committed with the source connection details stripped.

## Swapping the provider

One environment variable, and no code change:

```bash
LUMANU_PROVIDER=mock   # Apollo → Hasura Cloud v2 → Supabase   (the default)
LUMANU_PROVIDER=real   # RealLumanuProvider → Lumanu REST API
```

Selecting one selects its credentials and stops asking for the other's. `mock` needs
`HASURA_GRAPHQL_ENDPOINT` and `HASURA_ADMIN_SECRET`; `real` needs `LUMANU_API_BASE_URL`,
`LUMANU_TOKEN_URL`, `LUMANU_CLIENT_ID` and `LUMANU_CLIENT_SECRET`. An unrecognised value
fails at startup rather than falling back, because a typo that quietly served mock data
from a production endpoint would be the worst possible failure of this design.

Deployed, that means a different set of SSM parameters: the stack currently reads the two
Hasura values and two Auth0 values, and a `real` deployment would store the four `LUMANU_*`
values in their place. The template's parameter list is where that change would be made —
see [`docs/10`](./docs/10-aws-resource-register.md).

Nothing above the boundary changes: the sixteen tools, their descriptions, the payment
reasoning, the transport, authentication and logging are written against `LumanuProvider`
and cannot tell which implementation they hold.

**`RealLumanuProvider` is a compiling skeleton, and it is unexercised.** Lumanu issues API
credentials on request only — there is no self-serve signup — so this project has no
sandbox account. What is proven locally is that it satisfies the same interface, that every
path it calls is one the harvested contract publishes, that each request carries a
`client_credentials` bearer token, and that a response crosses the boundary unreshaped.
What is not proven is how Lumanu behaves at the other end, and no local test could prove
that. [`tests/integration/real-provider.test.ts`](./tests/integration/real-provider.test.ts)
adds it as a third subject of the same contract suite and skips until credentials exist.

The class is thin — thirteen methods, no mapping layer — and that thinness is the evidence.
Because the provider returns exact Lumanu wire format ([ADR 0001](./docs/adr/0001-provider-returns-lumanu-wire-format.md)),
a Lumanu response needs no translation at all. Had the interface been designed around a
tidier internal model, this file would be a second translation layer written against a
contract nobody here can run.

## Testing

```bash
npm test          # everything; the integration suites skip without credentials
npm run typecheck
```

Behaviour is asserted at two seams, and only two:

- **The MCP tool surface** — a real MCP client over an in-memory transport, calling the
  tools an agent would call. No HTTP, no database.
- **`LumanuProvider`** — one contract suite,
  [`tests/support/provider-contract.ts`](./tests/support/provider-contract.ts), run against
  every implementation. It is not a suite per provider: the same assertions run against the
  in-memory fixture unconditionally, against Hasura when credentials are present, and
  against Lumanu when sandbox credentials exist.

Two smaller **substitution points** exist below those, and neither is a place behaviour is
asserted: the token verifier takes an optional key source, and `RealLumanuProvider` takes
its HTTP transport. Both are constructor dependencies rather than mocked globals, because
[stubbing `fetch` once turned out to intercept nothing at all](./docs/discoveries/2026-08-13-mocking-fetch-did-not-intercept-jose.md).
No test in this project patches `fetch`, `node:https`, or any other network primitive.

That second seam is the swap claim made testable, and it earned its keep by catching the
two implementations disagreeing about what "not found" means for a list — a divergence
invisible from either one alone, because the interface had simply never said. It is also
where the order input checks run in is now pinned, after the two were found answering an
unknown Workspace differently depending on which check happened to run first.

It covers the reads against every implementation and the writes against the two this
project can restore to a known state. Writing against Lumanu is not covered: restoring a
sandbox is not something this project can do, and a write suite whose tests inherit each
other's leftovers proves nothing. That gap is stated in the test file rather than left to
be inferred from a skipped test.

Provider responses are validated against the harvested Lumanu schemas rather than against
expectations written here, so a provider cannot satisfy the suite by inventing a plausible
shape. Validation alone cannot catch a *renamed* field — Lumanu marks almost nothing
required and forbids no extra properties — so the field names the provider depends on are
asserted separately. See
[the discovery note](./docs/discoveries/2026-08-12-openapi-validation-misses-field-renames.md).

## Deliberately out of scope for the one-day POC

Not partially implemented — a half-wired integration is worse than an absent one.

| Omitted | How it would be added |
| --- | --- |
| Doppler | Replace `.env` loading with the Doppler CLI locally; AWS already uses SSM Parameter Store |
| OpenTelemetry | Wrap tool, domain and provider calls in spans; the layering already gives clean boundaries |
| Sentry | Initialise in the Lambda handler and attach the existing correlation id |
| Playwright | Needs a frontend first |
| Next.js / React status page | The deliverable is an MCP URL, not a dashboard |
| Local Docker | Development runs against Supabase and Hasura Cloud directly |

Out of scope as product decisions rather than time cuts: invoice and post-funding flows,
Vendor Wallets, multiple Workspaces or currencies, funding fees, webhook infrastructure,
the full MCP OAuth authorization-server flow, and MCP session persistence.

### Three things that are incomplete rather than omitted

Named here so a reader does not have to find them.

**The stack is not deployed.** Written, validated and bundled; the four SSM parameters it
reads have not been created. See [`docs/10`](./docs/10-aws-resource-register.md) for exactly
what a deploy would create and what it would cost.

**`RealLumanuProvider` has never spoken to Lumanu**, because credentials are issued on
request only. The contract suite is wired up and skipping, which is the honest state.

**Two of the four refusal kinds cannot be mapped from Lumanu's contract yet.** Lumanu
publishes no error schema at all — of the fourteen harvested operations, two declare a
`404` and none declares an error body — so a `404` is mapped because Lumanu declares it, a
`409` on a write is read as a refused transition because that is what `409` means, and
everything else is reported as a fault carrying Lumanu's own status and body rather than
sorted into a kind this project invented. A shortfall in particular carries two amounts
that cannot be guessed. See
[the discovery note](./docs/discoveries/2026-08-13-lumanu-publishes-no-error-contract.md).
