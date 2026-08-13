---
title: Lumanu MCP POC — remote MCP server over a swappable Lumanu provider
labels: ready-for-agent
---

# Lumanu MCP POC

> Vocabulary in this spec follows `CONTEXT.md`. Notably: **Partner** (never Vendor,
> creator, or payee), **Workspace Balance** (never Wallet), **Balance Transaction**,
> **Funding** (drawing from the balance to pay Payables), **Payment Readiness**,
> **Payment Blocker**, **Funding Capacity**.

## Problem Statement

A Buyer's finance operator cannot answer simple questions about creator payments without
stitching together several screens or API calls. "Who can I pay right now?" is not a
field on any record — it is a conclusion that depends on a Partner's onboarding state, a
Payable's approval state, and whether the Workspace Balance covers the total. "Why can't
I pay this person?" has several possible answers at different points in the flow, and
only one of them is the binding one.

An AI agent given a thin wrapper over Lumanu's REST endpoints inherits exactly this
problem. It can fetch a Partner and fetch a Payable, but it has to invent the reasoning
that connects them, and it will invent it differently each time. Worse, an agent that
can call an approve endpoint and a funding endpoint without understanding the
preconditions can approve something that cannot be paid, or attempt to pay something
already paid.

Separately, there is a credibility problem. A demonstration built on mock data invites
the question "would any of this work against the real system?" — and a mock whose data
shapes were invented cannot answer it.

## Solution

A remote MCP server, reachable at a public HTTPS URL and protected by Auth0, exposing
business-oriented tools that answer the questions a finance operator actually asks. The
tools return conclusions — Payment Readiness, the binding Payment Blocker, Funding
Capacity — derived from Lumanu's own data rather than restating individual endpoints.

Every tool reads and writes through a single `LumanuProvider` abstraction whose methods
return **exact Lumanu wire-format objects**: Lumanu's field names in snake_case, its
real status enums, its nullability, its `{ data, total, limit, offset }` envelopes, its
pagination semantics. Today a `MockLumanuProvider` satisfies that abstraction by mapping
seeded PostgreSQL records into those shapes via Hasura GraphQL. Tomorrow a
`RealLumanuProvider` satisfies it by calling Lumanu's REST API. One contract test suite
runs against both, so the claim that the mock can be swapped for the real thing is
demonstrated rather than asserted.

The canonical scenario is one Buyer (Acme Brands), one Workspace (Acme US), one Project
(Summer Creator Campaign), and four Partners chosen so that each isolates exactly one
outcome: one ready to fund, one blocked by approval, one blocked by onboarding, one
already funded.

## User Stories

### Understanding the current situation

1. As a finance operator, I want to list the Workspaces I have access to, so that I know which payment environment I am working in.
2. As a finance operator, I want an overview of a Workspace in a single call, so that I can see its balance, Partner count, Payable totals and outstanding obligations without issuing five separate queries.
3. As a finance operator, I want to see my current Workspace Balance, so that I know how much I can commit right now.
4. As a finance operator, I want to see the history of Balance Transactions, so that I can understand how the balance reached its current figure.
5. As a finance operator, I want a Balance Transaction to identify which Funding and which Partner it relates to, so that a debit in the history is explainable rather than anonymous.
6. As a finance operator, I want a payment summary for a Project, so that I can see what the Summer Creator Campaign has committed, paid, and still owes.
7. As a finance operator, I want to list Partners in a Workspace, so that I can see everyone I might pay.
8. As a finance operator, I want each Partner to show its onboarding and tax state as a single status, so that I am not left reconciling two fields that could disagree.
9. As a finance operator, I want to fetch one Partner in detail, so that I can investigate a specific case.
10. As a finance operator, I want to list Payables, so that I can see every obligation the Workspace has recorded.
11. As a finance operator, I want to filter Payables by status, so that I can look at just the approved ones or just the unapproved ones.
12. As a finance operator, I want to fetch one Payable in detail, so that I can check its amount, status and Partner before acting on it.
13. As a finance operator, I want list results to be paginated the way Lumanu paginates them, so that behaviour does not change when the real API is connected.

### Reasoning about who can be paid

14. As a finance operator, I want to ask which Partners are ready to be paid and get a direct answer, so that I do not have to derive readiness myself from three different fields.
15. As a finance operator, I want Payment Readiness to account for the Partner's onboarding state, so that I am never told someone is payable when they cannot legally be paid.
16. As a finance operator, I want Payment Readiness to account for the Payable's approval state, so that unapproved work is never presented as payable.
17. As a finance operator, I want Payment Readiness to account for the Workspace Balance, so that I am not told something is fundable when there is no money for it.
18. As a finance operator, I want to ask why a specific Partner cannot be paid and receive the single binding reason, so that I know what to fix first rather than reading a list of everything wrong.
19. As a finance operator, I want the binding Payment Blocker to be the one furthest upstream, so that an incomplete onboarding state is reported ahead of a missing approval, and a missing approval ahead of an insufficient balance.
20. As a finance operator, I want the Payment Blocker to tell me whether it is something these tools can fix, so that I know when to act here and when to go elsewhere.
21. As a finance operator, I want to ask a Partner-centric readiness question and still get an answer when that Partner has no Payable at all, so that someone who has been onboarded but never invoiced is not invisible.
22. As a finance operator, I want to ask whether the Workspace can fund everything currently ready, so that I get Funding Capacity as a yes or no with the shortfall or remainder stated.
23. As a finance operator, I want Funding Capacity to sum only Payables that are genuinely ready, so that obligations blocked upstream do not inflate the requirement.
24. As a finance operator, I want to know the balance that would remain after funding, so that I can decide whether to proceed.

### Changing state

25. As a finance operator, I want to approve a Payable, so that work I have signed off can proceed toward payment.
26. As a finance operator, I want approval to be rejected if the Payable is not in a state where approval is meaningful, so that I cannot approve something already funded or canceled.
27. As a finance operator, I want to cancel a Payable, so that an obligation raised in error is withdrawn.
28. As a finance operator, I want cancellation to be rejected once a Payable has been funded, so that money already committed cannot be silently unwound.
29. As a finance operator, I want to fund a set of approved Payables, so that Partners get paid.
30. As a finance operator, I want funding to draw from the Workspace Balance and record a Balance Transaction, so that the money movement is auditable.
31. As a finance operator, I want funding to be rejected in full if the balance will not cover the total, so that I never end up with a partially applied payment run.
32. As a finance operator, I want funding to be rejected if any requested Payable is unapproved, so that approval cannot be bypassed.
33. As a finance operator, I want funding to be rejected if any Partner's onboarding is incomplete, so that money is never sent to someone who cannot receive it.
34. As a finance operator, I want a Payable that is already funded to be a no-op rather than an error when it appears in a funding request, so that a retry does not fail outright.
35. As a finance operator, I want a Payable never to be funded twice, so that a retried or duplicated request cannot double-debit the balance.
36. As a finance operator, I want the whole funding operation to be atomic, so that a failure part-way leaves the balance and the Payables consistent with each other.
37. As a finance operator, I want every state change to return the resulting state, so that I can confirm what happened without a follow-up read.
38. As a finance operator, I want every state change recorded in an audit log, so that there is a record of what was changed and when.

### Working through an AI agent

39. As an AI agent, I want tools whose names and descriptions describe business intent, so that I can select the right one without guessing at REST semantics.
40. As an AI agent, I want read tools clearly separated from write tools, so that I do not mutate state while merely investigating.
41. As an AI agent, I want write tools to reject invalid requests with a specific, actionable reason, so that I can explain the failure to the user instead of retrying blindly.
42. As an AI agent, I want to chain approval and funding in one conversation and be told the resulting Funding Capacity, so that I can answer "approve Alex, then tell me whether Maya and Alex can both be funded" in one pass.
43. As an AI agent, I want a retried write after a timeout to be safe, so that network failure does not become double payment.
44. As an AI agent, I want errors distinguishable by kind — invalid input, invalid state, insufficient balance, not found — so that I can respond appropriately to each.
45. As an AI agent, I want tool results to avoid unnecessary Partner personal data, so that I am not carrying more sensitive information than the answer requires.

### Connecting as a reviewer

46. As a hiring reviewer, I want a public MCP endpoint URL, so that I can connect without running anything locally.
47. As a hiring reviewer, I want short instructions for obtaining a demo access token, so that authentication is not a research exercise.
48. As a hiring reviewer, I want to add the server to Claude Code in one documented command, so that I am asking questions within a minute.
49. As a hiring reviewer, I want five example prompts, so that I can see the intended behaviour without inventing a scenario.
50. As a hiring reviewer, I want unauthenticated requests rejected, so that I can see the endpoint is genuinely protected.
51. As a hiring reviewer, I want requests bearing an expired or wrongly-scoped token rejected, so that I can see the validation is real and not a string comparison.

### Reviewing the code

52. As a hiring reviewer, I want the `LumanuProvider` interface to be readable in one sitting, so that I can see exactly what the swap boundary is.
53. As a hiring reviewer, I want a `RealLumanuProvider` that compiles against the same interface, so that the swap is evidenced in code rather than described in prose.
54. As a hiring reviewer, I want one contract test suite applied to every provider implementation, so that interchangeability is tested rather than claimed.
55. As a hiring reviewer, I want provider return values validated against Lumanu's published schemas, so that I can trust the mock has not drifted into invention.
56. As a hiring reviewer, I want to see that no MCP tool reaches SQL or Hasura directly, so that the layering is real.
57. As a hiring reviewer, I want to clone the repo and run the tests green with no credentials, so that I can evaluate the work without provisioning anything.
58. As a hiring reviewer, I want the README to explain how to swap the mock provider for the real one, so that I can judge the migration path.
59. As a hiring reviewer, I want deliberately-omitted scope named explicitly, so that I can distinguish a judgement call from an oversight.

### Operating and developing

60. As a developer, I want the seed data to be deterministic, so that tests, demos and CI all observe the same figures.
61. As a developer, I want a single command to reset the database to that identical state, so that a demo can be re-run after mutations.
62. As a developer, I want to switch provider implementations by configuration, so that no code changes when the real API becomes available.
63. As a developer, I want Lumanu's published schemas cached in the repo, so that the build does not depend on fetching a website.
64. As a developer, I want structured logs with a correlation id per request, so that I can follow one MCP call through the layers.
65. As a developer, I want tool name, provider, duration and outcome on every log line, so that I can see what was slow or failing without adding instrumentation.
66. As a developer, I want secrets read from AWS at runtime rather than committed, so that the repository is safe to share.
67. As a developer, I want infrastructure defined as code, so that the deployment is reproducible without console clicks.

## Implementation Decisions

### Layering

The dependency chain is fixed: **MCP tool → domain service → `LumanuProvider` →
implementation**. No tool may reach SQL, Hasura, or Apollo. Domain services hold all
derived reasoning — Payment Readiness, Payment Blocker, Funding Capacity — and reach it
only through provider return values. Transport and Lambda handler code stay thin.

### The provider contract

`LumanuProvider` methods return exact Lumanu wire-format objects. No camelCase mirror
model is introduced anywhere; derived concepts are computed from Lumanu-shaped objects
rather than from a parallel internal payment model. This is recorded as ADR 0001.

Method surface, typed from the harvested schemas rather than `unknown`:
`listWorkspaces`, `getWorkspace`, `listPartners`, `getPartner`, `listPayables`,
`getPayable`, `approvePayable`, `cancelPayable`, `getWorkspaceBalance`,
`listBalanceTransactions`, `createFunding`.

Three implementations satisfy it:

- **`InMemoryLumanuProvider`** — over the seed fixture; no network, no credentials. Used by tool-level tests.
- **`MockLumanuProvider`** — Apollo Client → Hasura Cloud v2 → Supabase PostgreSQL, mapping database records into Lumanu shapes.
- **`RealLumanuProvider`** — a compiling skeleton against Lumanu's REST API, using client-credentials tokens. Not exercised, as no sandbox credentials are available.

Selection is by configuration (`LUMANU_PROVIDER`), not by code change.

### Lumanu schemas are harvested, not hand-written

Lumanu publishes no single OpenAPI document; each `reference/*.md` page embeds an
OpenAPI 3.1 fragment for one endpoint. A script fetches the fragments for the endpoints
in use and caches them in the repo. Those fragments — not this spec and not the domain
docs — are the source of truth for field names, nullability, enums, envelopes,
pagination parameters, identifier formats, and **the representation of monetary
amounts**. The amount representation is currently unknown and must be read from the
harvested fragment before the schema is written; internal storage is integer cents, and
any conversion belongs in the provider mapping layer.

Confirmed already and expected to be reproduced: the `{ data, total, limit, offset }`
envelope; `limit` defaulting to 25 and `offset` to 0, with `order_by` and
`order_by_direction` of `asc`/`desc`; snake_case throughout; Workspace fields including
`display_name`, `funding_fee_percent` (nullable) and `additive_funding_fee` (nullable);
the six-value Partner status enum; the Payable status enum. Where this spec and a
harvested fragment disagree, the fragment wins.

### Data model

Tables: `workspaces`, `projects`, `partners`, `payables`, `fundings`,
`funding_payables`, `balance_transactions`, `audit_events`. No separate `vendors` table —
with one Workspace, a Partner/Vendor split would add a join that earns nothing, so
Partner is a single table. Should a second Workspace ever be introduced, that is the
point at which the split becomes worthwhile.

The Workspace Balance is stored on the Workspace as integer cents **and** derived
ledger-style from `balance_transactions`. The redundancy is deliberate: the stored column
gives funding a single row to lock, and the ledger gives the history a real purpose. A
test asserts the two agree.

`audit_events` rows are named after Lumanu's real webhook event names — `payable.created`,
`payable.approved`, `payable.paid`, and so on — so that a future real integration has an
obvious place to land inbound events. No webhook delivery is built.

### Funding must be atomic, and Hasura cannot express it as a mutation

Funding requires conditional validation and rollback: check every Payable's status,
check every Partner's status, total the amounts, verify and debit the balance, insert the
Funding, insert the Balance Transaction, move Payables to `will_pay`. A Hasura mutation
executes its fields in one transaction but cannot abort on a guard failing, so a
guard-based multi-field mutation can leave the balance updated while Payable updates are
skipped, or the reverse.

Therefore funding is implemented as a **PostgreSQL function tracked in Hasura and exposed
as a GraphQL mutation**. All validation and mutation happen inside one transaction, with
the Workspace row locked for the balance check. The provider calls it through Apollo like
any other operation, so the "no tool touches SQL" rule holds and the layering is
unchanged.

### Idempotency

State-based, with no idempotency-key subsystem. Within a funding request: `approved`
Payables are funded; `will_pay` Payables are treated as no-ops and their existing Funding
is returned rather than re-debited; `unapproved` or `canceled` Payables reject the entire
request; a Partner whose status is not `completed_w9` rejects the entire request; an
insufficient balance rejects the entire request. A retry of a fully-completed request
returns the original result without moving money.

### MCP tools

Eleven read tools — `list_workspaces`, `get_workspace_overview`, `list_partners`,
`get_partner`, `get_partner_payment_readiness`, `list_payables`, `get_payable`,
`get_workspace_balance`, `list_workspace_transactions`, `get_project_payment_summary`,
`explain_payment_blocker` — and three write tools: `approve_payable`, `cancel_payable`,
`fund_payables`.

Two renames from the original tool list, forced by the glossary banning bare "Wallet":
`get_wallet_balance` becomes `get_workspace_balance`, and `list_wallet_transactions`
becomes `list_workspace_transactions`.

`get_partner_payment_readiness` and `explain_payment_blocker` are keyed on **Partner**,
not Payable. One canonical Partner has no Payable at all, so a Payable-centric design
would make her invisible to exactly the question she exists to answer.

Payment Blocker precedence, most upstream first: incomplete Partner status → Payable
unapproved or absent → insufficient Workspace Balance. Only the binding blocker is
reported as the reason, and each blocker states whether a tool in this server can
resolve it.

Write tools validate current state before acting, return the resulting state, and emit an
audit event. Errors are typed by kind — not found, invalid input, invalid state,
insufficient balance — so an agent can respond differently to each.

### Transport and authentication

Stateless Streamable HTTP: `POST /mcp` on API Gateway, every request independent, no
session identifiers, no long-lived `GET` event stream, no resumability, JSON responses.
API Gateway now supports response streaming, so this is a deliberate choice rather than a
constraint: every tool is request/response, and statelessness means any Lambda instance
can serve any request.

Auth0 Machine-to-Machine with the `client_credentials` grant. The Lambda validates the
bearer JWT's signature via JWKS — so key rotation works — along with issuer, audience and
expiry. The full MCP OAuth authorization-server flow is not implemented; the reviewer
receives instructions for minting a demo token.

### Deployment

Serverless Framework generating CloudFormation, deploying Lambda on the Node.js 20
runtime plus API Gateway into `us-east-1`. Stack outputs include the MCP endpoint. No
VPC, no NAT gateway, and no AWS-hosted database: Supabase and Hasura Cloud are reached
over public HTTPS. Secrets — the Supabase connection string, the Hasura admin secret, the
Auth0 client secret — live in Secrets Manager with KMS-backed encryption and are read at
runtime.

Supabase is connected via the Supavisor **session-mode** connection string on port 5432,
because transaction-mode pooling breaks the prepared statements Hasura uses by default,
and direct connections may be IPv6-only. Hasura metadata and migrations are committed.

### Seed data

Deterministic Faker with a fixed seed, and the canonical business states hard-coded so
generated data cannot disturb them. Acme US opens at $25,000, StudioX's $10,000 Funding
is present as history, and the current balance is $15,000 with a matching Balance
Transaction.

| Partner | Partner status | Payable | Payable status | Outcome |
| --- | --- | --- | --- | --- |
| Maya Patel | `completed_w9` | $2,500 | `approved` | Ready to fund |
| Alex Rivera | `completed_w9` | $7,500 | `unapproved` | Blocked: needs approval |
| Sarah Chen | `awaiting_w9_submission` | none | — | Blocked: onboarding incomplete |
| StudioX LLC | `completed_w9` | $10,000 | `will_pay` | Already funded |

The consequence that must hold: after approving Alex, ready-to-fund totals $10,000
against a $15,000 balance, leaving $5,000. A test asserts these figures directly, because
they are the numbers a reviewer will check.

Faker may add a small number of additional Partners and Payables for texture. It must not
introduce a second Workspace, a second Project, or a funding model outside the canonical
flow.

### Observability

Pino structured JSON logs carrying a correlation id per request, plus tool name, provider,
duration and outcome, and an error code on failure. No secrets are logged, and Partner
personal data is kept out of log lines.

## Testing Decisions

A good test here asserts external behaviour: what a tool returns, and what state a write
leaves behind. It does not assert that a particular provider method was called, that a
GraphQL document had a given shape, or that a domain function was invoked. Tests are
written against the two seams below and nowhere else — no test mocks Apollo or Hasura.

### Seam 1 — the MCP tool surface

The primary seam, and the highest available. Tests construct the MCP server in-process,
inject `InMemoryLumanuProvider`, call tools through an in-memory transport, and assert on
results. Fast, hermetic, and runnable on a fresh clone with no credentials — which is
itself user story 57.

Covered here:

- Each canonical Partner's Payment Readiness resolves to its intended outcome.
- Sarah's blocker is reported as onboarding, and she is reachable despite having no Payable.
- Alex's blocker is reported as approval, and marked as resolvable by these tools.
- Blocker precedence: when more than one condition fails, only the most upstream is reported.
- Funding Capacity before and after approving Alex, asserting $10,000 required against $15,000 and $5,000 remaining.
- An approved Payable can be funded; an unapproved one cannot.
- A Partner who is not `completed_w9` cannot be funded.
- Insufficient balance rejects the whole request, leaving balance and Payable statuses untouched.
- A `will_pay` Payable is not funded twice, and re-requesting it returns the existing Funding without debiting.
- A mixed batch of `will_pay` and `approved` Payables funds only what needs funding.
- Funding updates the balance and writes a matching Balance Transaction.
- Approving an already-funded or canceled Payable is rejected; cancelling a funded Payable is rejected.
- Write tools return resulting state and write an audit event.
- Errors are distinguishable by kind.
- Read tools honour Lumanu's pagination parameters and envelope.

### Seam 2 — the `LumanuProvider` contract

A single reusable suite, `describeLumanuProviderContract(factory)`, asserting that a
provider returns Lumanu-shaped values: field names, snake_case, nullability, enum
membership, envelope structure, pagination behaviour, identifier formats. Where a
harvested OpenAPI fragment exists for an endpoint, responses are validated against it, so
drift from Lumanu's published contract fails the build.

Run against `InMemoryLumanuProvider` unconditionally — this is what makes the Seam 1 fake
trustworthy rather than a place for drift to hide. Run against `MockLumanuProvider` as an
integration suite when Hasura and Supabase credentials are present. Written so
`RealLumanuProvider` drops in unchanged, skipped while Lumanu sandbox credentials are
absent.

### Additional checks

One test asserts the stored Workspace Balance equals the sum of Balance Transactions,
guarding the deliberate redundancy in the schema. One test asserts a reseeded database
reproduces byte-identical canonical figures. There is no prior art in this repository —
these suites establish the pattern.

Not tested: Auth0 token validation against live Auth0, CloudFormation deployment, and the
harvest script's network fetching. Each is verified by hand once and is not worth
automating within this budget.

## Out of Scope

Deliberately omitted for the one-day build, to be stated as such in the README with one
line each on how they would be added: Doppler, OpenTelemetry, Sentry, Playwright, the
Next.js/React status page, and a local Docker environment. These are not partially
implemented — a half-wired integration is worse than an absent one.

Out of scope as product decisions, not time cuts: the invoice and post-funding flows;
Vendor Wallets, meaning the stored-value account a Partner holds and withdraws from;
multiple Workspaces; multiple Projects; multiple currencies; funding fees, which are
fixed at zero so that $10,000 of Payables requires exactly $10,000; webhook endpoints,
signing, retries and event infrastructure; additional onboarding models; the full MCP
OAuth authorization-server flow; MCP session persistence, subscriptions and resumability;
and Plaid, Unit, Codat, Persona and TaxBit.

Lumanu's `paid` Payable status is real but unused — the harvested fragment defines it, and
no flow here produces it, since `will_pay` is this POC's terminal state. Lumanu's second
`payable_status` field and its unconstrained `vendor_status` are carried on the wire but
not reasoned over. Partner statuses beyond `completed_w9` and `awaiting_w9_submission` are
likewise modelled in the enum but not seeded.

## Further Notes

**Highest-risk step, and it comes first.** Connecting Hasura Cloud v2 to Supabase is the
least certain part of the build. Before any schema work: create the Supabase project,
connect Hasura using the session-mode pooler string, track one table, and run one
successful query. If it resists, the fallback is self-hosted Hasura v2 CE, which changes
nothing above the provider boundary but costs an hour. Proving an empty Serverless stack
deploys into the target AWS account is worth doing equally early, since first-deploy IAM
surprises are common and expensive at the end of a day.

**Hasura Cloud v2 over DDN** is recorded as ADR 0002. The reason is that v2 is the
smaller, established path for a short POC — not that DDN lacks RESTified endpoints, which
it now has via a plugin. Hasura's REST endpoints are irrelevant here in any case: Lumanu
compatibility is the provider's responsibility, and the contract boundary is Hasura
GraphQL → `MockLumanuProvider` → Lumanu wire-format objects.

**The domain docs contain known errors** and are corrected before implementation begins.
For the record: doc 01 defined Funding as an outflow when Lumanu's `POST /funding` is
primarily an inflow, with `method: "balance"` being the outflow case; doc 01 split Partner
tax state across two fields where Lumanu has one enum; doc 01's "expected payment
$4,000" for Sarah has been removed, as it is not a Lumanu concept and Alex already
demonstrates an unapproved Payable; doc 03's scale of three Workspaces and 75–150
Payables is superseded; doc 06's AWS-hosted database is superseded by Supabase.

**The five reviewer prompts** the README ships with should be the ones this build answers
precisely: summarise the Acme workspace; who is blocked and why; which approved Payables
await funding; can Acme fund everything currently ready; approve Alex's Payable and say
whether Maya and Alex can both now be funded.
