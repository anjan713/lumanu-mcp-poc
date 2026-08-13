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
| 01 | Repo foundation, corrected docs, ADRs | in progress |
| 02 | Lumanu contract harvested and typed | not started |
| 03 | Data layer live: Supabase, Hasura, schema, seed | not started |
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

Decisions with lasting consequences are recorded in [`docs/adr/`](./docs/adr/).

## Local setup

```bash
npm install
cp .env.example .env      # fill in Supabase, Hasura and Auth0 values
npm run typecheck
npm test
```

The test suite runs green with **no credentials** — tool-level tests inject an in-memory
provider. Credentials are only needed for the integration suite and for deployment.

## Deliberately out of scope for the one-day POC

Not partially implemented — a half-wired integration is worse than an absent one.

| Omitted | How it would be added |
| --- | --- |
| Doppler | Replace `.env` loading with the Doppler CLI locally; AWS already uses Secrets Manager |
| OpenTelemetry | Wrap tool, domain and provider calls in spans; the layering already gives clean boundaries |
| Sentry | Initialise in the Lambda handler and attach the existing correlation id |
| Playwright | Needs a frontend first |
| Next.js / React status page | The deliverable is an MCP URL, not a dashboard |
| Local Docker | Development runs against Supabase and Hasura Cloud directly |

Out of scope as product decisions rather than time cuts: invoice and post-funding flows,
Vendor Wallets, multiple Workspaces or currencies, funding fees, webhook infrastructure,
the full MCP OAuth authorization-server flow, and MCP session persistence.
