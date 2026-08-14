# Lumanu MCP POC

A remote MCP server that lets an AI agent reason about creator payments across Lumanu
concepts — Workspaces, Partners, Projects, Payables, Workspace Balance and Funding.

## The story

It is Thursday. Acme Brands ran a Summer Creator Campaign and four Partners did the work.
Someone in finance has to decide who gets paid tomorrow, out of a Workspace Balance of
$15,000.

| Partner | Owed | Situation |
| --- | --- | --- |
| Maya Patel | $2,500 | Onboarded, work approved. Ready. |
| Alex Rivera | $7,500 | Onboarded, but nobody approved the Payable yet. |
| Sarah Chen | — | Tax paperwork unfinished. **Nobody at Acme can fix this.** |
| StudioX | $10,000 | Funded last month. Nothing to do. |

Their question is one sentence: *who am I paying tomorrow, and what is stopping the rest?*

No screen answers it. It is four Partner records, three Payable records, one balance, and
three rules that live in somebody's head.

## Why an MCP server, when there is already a dashboard

A dashboard shows you **what is**. It is the system of record, and it is where you click the
button that moves money. This is for the question *before* that click, and it adds three
things a screen cannot.

**It does the join.** Payment Readiness is Partner Status *plus* Payable approval *plus* the
Workspace Balance. A dashboard puts each on a different screen and leaves the operator to
combine them — correctly on a good day.

**It gives the binding reason, not a list.** Sarah fails two checks: she has not onboarded,
and nothing has been raised for her. A screen shows two red flags. Raising a Payable would be
wasted work, because her Partner Status blocks payment anyway — so the tools report the reason
*furthest upstream*, and say whether it can be fixed here at all.

**It answers where the work already happens**, with the same rules. `fund_payables` runs the
identical all-or-nothing validation and writes the same audit record — no back door.

It does not replace the dashboard for browsing, for seeing money before it moves, or for
audit review.

## Architecture

Sixteen business-oriented tools, not an OpenAPI conversion, over a seeded fixture shaped
**exactly** like Lumanu's wire format — snake_case, real enums, the
`{ data, total, limit, offset }` envelope — harvested from Lumanu's own reference pages.

> **Mock today. Real Lumanu tomorrow. MCP tools remain unchanged.**

```text
Claude Code → API Gateway → Lambda → MCP Server (stateless HTTP, POST /mcp)
                                          ↓
                                    Domain Services   ← the reasoning lives here
                                          ↓
                                    LumanuProvider    ← the swap boundary
                  ┌───────────────────────┼───────────────────────┐
         InMemoryLumanuProvider    MockLumanuProvider      RealLumanuProvider
           (fixture, no creds)  (Apollo → Hasura → Supabase)  (Lumanu REST API)
```

`LumanuProvider` returns exact Lumanu wire format, so no parallel internal model exists. The
derived answers — Payment Readiness, Payment Blocker, Funding Capacity — are computed above it
in domain services, and no tool ever touches SQL, Hasura or Apollo. Funding is atomic: all of
it or none, and a retry cannot pay twice. One contract suite runs against every
implementation, so the swap is tested rather than claimed. `RealLumanuProvider` compiles but
is unexercised — Lumanu issues credentials on request only.

**Nothing is deployed to AWS yet.** The stack is written, validated and bundled.

## How to run it

```bash
npm install
cp .env.example .env               # Supabase, Hasura and Auth0 values
npm run typecheck
npm test                           # 451 tests, green with no credentials at all

npm run db:smoke                   # prove Hasura is pointed at that same database
npm run db:reset                   # migrate, seed the canonical scenario, track tables
npm run bundle && npm run deploy   # prints McpEndpoint
```

The first four need nothing provisioned; the rest need Supabase, Hasura and AWS. The MCP URL
is `https://<api-id>.execute-api.us-east-1.amazonaws.com/mcp`. Mint a 24-hour demo token,
validated on every request:

```bash
export TOKEN=$(curl -s -X POST "https://$AUTH0_DOMAIN/oauth/token" \
  -H 'content-type: application/json' \
  -d "{\"client_id\":\"$AUTH0_M2M_CLIENT_ID\",\"client_secret\":\"$AUTH0_M2M_CLIENT_SECRET\",\"audience\":\"$AUTH0_AUDIENCE\",\"grant_type\":\"client_credentials\"}" | jq -r .access_token)

claude mcp add --transport http lumanu <mcp-url> --header "Authorization: Bearer $TOKEN"
```

## What to ask it

The seed is fixed, so every answer below is the same every time.

**Looking around.** *"List the Partners in Acme US and their onboarding status"* · *"What's
outstanding for Maya?"* · *"What has the Summer Creator Campaign committed, and how much of it
is funded?"*

**The reasoning — the point of this build.**

1. *"Who can I pay in Acme US, and who is blocked?"* — Maya is ready at $2,500. Alex needs
   approval. Sarah has not onboarded. StudioX is already funded.
2. *"Why can't I pay Alex?"* — one binding reason, naming `approve_payable` as the tool that
   clears it. Ask the same of Sarah and it says the fix is not available here at all.
3. *"Does the Workspace Balance cover what's ready?"* — $2,500 of $15,000. Alex's blocked
   $7,500 does not inflate the requirement, so the number means something.
4. *"Approve Alex's Payable, then fund both him and Maya."* — one Funding of $10,000, leaving
   $5,000, both Payables moved to `will_pay`.
5. *"Show me the balance history"* — every movement with the balance it left behind.

**Ask it to do the wrong thing** — the part worth watching in a payments demo. *"Fund Alex"*
before approving him is refused, and Maya is left untouched even if you name them together.
*"Fund Maya twice"* debits once and returns the Funding that already paid for it. *"Cancel
StudioX's Payable"* is refused, because the money has already left. Each refusal names its
kind, so an agent knows whether to fix the request, wait for money, or stop.

## Swapping the provider

One environment variable, no code change. `LUMANU_PROVIDER=mock` reaches Supabase through
Hasura; `real` reaches Lumanu's REST API. Each asks for its own credentials and stops asking
for the other's. An unrecognised value fails at startup rather than quietly serving mock data.

## Not included

Deliberate omissions, not oversights: Doppler, OpenTelemetry, Sentry, Playwright, a Next.js
status page, local Docker, and Plaid, Unit, Codat, Persona and TaxBit. As product decisions:
invoice funding, Vendor Wallets, multiple Workspaces or currencies, funding fees, webhooks,
the full MCP OAuth flow, and MCP session persistence.

Read [`CONTEXT.md`](./CONTEXT.md) first — the glossary that wins over every other document.
Design documents sit in [`docs/`](./docs/), and decisions in [`docs/adr/`](./docs/adr/).
