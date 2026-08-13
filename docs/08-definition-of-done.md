# 08 — Definition of Done

Scoped to a **one-day build**. The live MCP URL and the provider-swap story matter more
than stack completeness — see "Deliberately out of scope" below, which is part of the
definition of done rather than an admission against it.

## API and domain

- [ ] Lumanu `llms.txt` fetched and referenceable
- [ ] Per-endpoint OpenAPI fragments harvested from the official reference pages and cached in the repo
- [ ] The representation of monetary amounts determined from the fragments, not assumed
- [ ] Provider types generated or validated from the harvested fragments
- [ ] Domain assumptions checked against the official documentation, with conflicts resolved in the documentation's favour
- [ ] The canonical scenario exists: Maya, Alex, Sarah, StudioX

## Mock data

- [ ] Faker generates deterministic relational data around hard-coded canonical states
- [ ] PostgreSQL on Supabase persists mock state
- [ ] `db:reset` reproduces byte-identical figures
- [ ] Opening balance $25,000, StudioX's $10,000 in history, current balance $15,000
- [ ] Stored Workspace Balance agrees with the sum of Balance Transactions

## Provider architecture

- [ ] Hasura Cloud v2 exposes internal GraphQL over Supabase PostgreSQL
- [ ] Apollo Client is used by `MockLumanuProvider`
- [ ] GraphQL Codegen generates typed operations, committed to the repo
- [ ] The `LumanuProvider` abstraction exists and returns exact Lumanu wire format
- [ ] `InMemoryLumanuProvider` works
- [ ] `MockLumanuProvider` works
- [ ] `RealLumanuProvider` compiles against the same interface
- [ ] One contract suite runs against all three implementations
- [ ] No MCP tool or domain service reaches SQL, Hasura or Apollo directly
- [ ] Provider implementation is selected by configuration, not code change

## MCP

- [ ] Eleven business-oriented read tools work
- [ ] Three write tools work
- [ ] Read and write tools are clearly separated
- [ ] Write tools validate state, return the resulting state, and write an audit event
- [ ] Funding is atomic and cannot double-pay a `will_pay` Payable
- [ ] Payment Blocker reports only the binding reason, and whether this server can fix it
- [ ] Remote stateless Streamable HTTP works
- [ ] A reviewer connects using the documented URL and auth instructions

## Deployment

- [ ] Lambda deployment works
- [ ] API Gateway exposes the MCP endpoint
- [ ] Serverless Framework generates CloudFormation reproducibly
- [ ] Stack outputs include the MCP endpoint
- [ ] No normal deployment step requires console configuration

## Security

- [ ] Auth0 machine-to-machine tokens protect the endpoint
- [ ] JWT signature, issuer, audience and expiry are validated via JWKS
- [ ] Unauthenticated and wrong-audience requests are rejected
- [ ] AWS secrets use KMS-backed storage
- [ ] No secrets committed

## Observability

- [ ] Pino structured logs
- [ ] Correlation id per request
- [ ] Tool name, provider, duration and outcome on every request

## Testing

- [ ] Tool-surface tests pass with no credentials
- [ ] Provider contract tests pass
- [ ] Mock responses validated against the harvested fragments
- [ ] A fresh clone runs the full suite green

## Developer and reviewer experience

- [ ] README explains local setup
- [ ] README explains deployment
- [ ] README explains MCP client connection and how to obtain a demo token
- [ ] README lists five example prompts this build answers precisely
- [ ] README explains the mock → real provider swap
- [ ] README names what was deliberately left out

## Deliberately out of scope for the one-day POC

Named in the README with one line each on how they would be added. **Not partially
implemented.**

- [ ] Doppler
- [ ] OpenTelemetry
- [ ] Sentry
- [ ] Playwright
- [ ] Next.js / React status page
- [ ] Local Docker environment

Out of scope as product decisions rather than time cuts: invoice and post-funding flows;
Vendor Wallets; multiple Workspaces, Projects or currencies; funding fees; webhook
infrastructure; additional onboarding models; the full MCP OAuth authorization-server flow;
MCP session persistence and resumability; and Plaid, Unit, Codat, Persona and TaxBit.

## The story a reviewer should see immediately

```text
today:
MCP → Domain Service → LumanuProvider → MockLumanuProvider → Hasura Cloud v2 → Supabase

future:
MCP → Domain Service → LumanuProvider → RealLumanuProvider → Lumanu REST API
```

Nothing above `LumanuProvider` changes between those two lines. One contract suite proves
it.
