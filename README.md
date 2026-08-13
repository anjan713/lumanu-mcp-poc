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

Under construction. Work is tracked as eight tracer-bullet tickets in
[`.scratch/lumanu-mcp/issues/`](./.scratch/lumanu-mcp/issues/), against the spec in
[`.scratch/lumanu-mcp/spec.md`](./.scratch/lumanu-mcp/spec.md).

| # | Ticket | Status |
| --- | --- | --- |
| 01 | Repo foundation, corrected docs, ADRs | done |
| 02 | Lumanu contract harvested and typed | done |
| 03 | Data layer live: Supabase, Hasura, schema, seed | done |
| 04 | Tracer bullet: live authenticated MCP URL | not started |
| 05 | Read tools over the canonical data | not started |
| 06 | Payment reasoning | not started |
| 07 | Write tools with atomic funding | not started |
| 08 | Provider swap proven, reviewer onboarding | not started |

The MCP URL, demo-token instructions and example prompts land in ticket 08.

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
