# 05 — MCP Tool Design

Do not expose one tool per Lumanu REST endpoint. Expose tools that answer the questions a
finance operator actually asks.

## Read tools

```text
list_workspaces
get_workspace_overview
list_partners
get_partner
get_partner_payment_readiness
list_payables
get_payable
get_workspace_balance
list_workspace_transactions
get_project_payment_summary
list_projects
get_partner_payment_readiness
explain_payment_blocker
get_funding_capacity
```

Two names changed from the original list, because [`CONTEXT.md`](../CONTEXT.md) bans bare
"Wallet" as ambiguous between the Workspace Balance and a Partner's own stored-value
account: `get_wallet_balance` → `get_workspace_balance`, and `list_wallet_transactions` →
`list_workspace_transactions`.

Two were added while building: `list_projects`, because `get_project_payment_summary` needs a
`project_id` and nothing else returns one; and `get_funding_capacity`, because Funding
Capacity is a named concept in `CONTEXT.md` with no surface otherwise, and the point of these
tools is that the reasoning happens once here rather than being reinvented by an agent on
every conversation.

The last three draw **conclusions**; everything above them returns **facts**.

### What the tools do that the endpoints do not

Three of these answer questions Lumanu has no endpoint for, and the difference is where the
work lives. `LumanuProvider` mirrors Lumanu's endpoints exactly, including their gaps; the
arithmetic sits above it in `src/domain`. See [ADR 0001](./adr/0001-provider-returns-lumanu-wire-format.md).

| Tool | Why it is not a passthrough |
| --- | --- |
| `get_workspace_overview` | Four reads — Workspace, balance, Partners, Payables — reconciled into one answer. |
| `get_project_payment_summary` | Committed, funded and outstanding are sums Lumanu does not publish. |
| `list_payables` with `status` | **Lumanu's Payables endpoint has no status filter.** Its query parameters are `workspace_id`, `project_id`, `limit`, `offset`, `order_by` and `order_by_direction`. The filter is applied above the provider, over the whole set, so `total` describes what matched rather than the page it came from. |

### What a Partner's details lose on the way out

The provider returns what Lumanu returns — that fidelity is not negotiable — and the
reduction happens at the edge, in `src/mcp/redact.ts`. The rule is need rather than
sensitivity: a question about who is ready to be paid is answered by names and statuses, so a
contact address in that answer is personal data spent for nothing.

| Tool | Withheld | Why |
| --- | --- | --- |
| `list_partners` | `email`, `emails`, `notes` | The question is who the Partners are and what state they are in. |
| `get_partner` | `notes` | A lookup of one Partner did ask for the contact address. |
| `list_payables` | `vendor_email` | A Payable names its Partner three ways. `vendor_display_name` and `payee_lumanu_id` already identify them; without this, a page of Payables hands back every address `list_partners` had just withheld. |

`notes` is withheld everywhere. It is free text a Buyer writes about a Partner, it answers no
question this server offers, and it is the field most likely to hold something nobody meant
to publish.

### `paid` is never offered

`list_payables` takes a `status`, and its enum is Lumanu's minus `paid`. The state is real in
Lumanu's contract but no flow here produces it, so offering it would invite an agent to ask a
question this system can only ever answer with an empty list. `PAYABLE_STATUSES` still holds
every member, because that constant exists to be checked against the contract rather than
shown to anyone; the tool surface uses `REACHABLE_PAYABLE_STATUSES`.

### A Balance Transaction cannot name its Funding

`list_workspace_transactions` was specified to have each transaction identify the Funding and
the Partner it relates to. It does not, and cannot.

Lumanu's `Transaction` schema carries nine fields: `id`, `description`, `created_at`, `amount`,
`amount_denomination`, `balance_change`, `ending_balance`, `status` and `type`. There is no
`funding_id`, no Partner reference, and no endpoint that lists Fundings — only
`POST /funding` and `GET /funding/{id}`, so a correlation cannot be computed above the
boundary either.

The internal schema does hold `balance_transactions.funding_id`, so this could be published.
It is not, because a field `RealLumanuProvider` could never produce is exactly the drift ADR
0001 exists to prevent — the mock would answer a question the real API cannot, and the swap
would stop being true the day it mattered.

What is available is the description, which names the Partner: *"Funding — StudioX LLC"*.
That is how the StudioX debit is identified in the history today. Correlating the two properly
needs either a Lumanu endpoint that lists Fundings, or a `funding_id` on the Transaction.

### Ordering

Every list tool takes `order_by` and `order_by_direction`, defaulting to `created_at` ascending.
The orderable fields are a closed set per collection — an unsupported one is refused rather
than ignored, because a caller who asked for an order and silently did not get one has no way
to notice. Ties break by `id`, so a repeated call returns a repeatable page.

## Write tools

```text
approve_payable
cancel_payable
fund_payables
```

## Reasoning tools are keyed on Partner

`get_partner_payment_readiness` and `explain_payment_blocker` take a **Partner**, not a
Payable. Sarah Chen has no Payable at all, so a Payable-centric design would make her
invisible to precisely the question she exists to answer.

### Payment Blocker precedence

When several conditions fail, report only the **binding** one — the furthest upstream:

| Rank | Code | Condition | Resolvable here |
| --- | --- | --- | --- |
| 1 | `partner_onboarding_incomplete` | Partner status is not `completed_w9` | No — the Partner submits their own tax documents |
| 2 | `no_payable` | Nothing outstanding to fund | No — creating Payables is out of scope |
| 2 | `payable_needs_approval` | Everything outstanding is `unapproved` | **Yes** — a Buyer decision inside the Workspace |
| 3 | `insufficient_balance` | The balance does not cover what is owed | No — topping up is invoice funding, out of scope |

Ranks 2 share a rung: in both cases there is nothing approved to fund. They stay separate
codes because the actions differ — raise a Payable, or approve the one that exists.

Reporting only the binding reason is not brevity for its own sake. Clearing a downstream
condition while an upstream one still fails changes nothing, so naming the downstream one
sends a Buyer to do work that cannot help. Approving a Payable for a Partner who cannot
legally be paid moves nobody closer to being paid.

Each blocker states whether it can be resolved here. Alex's can; Sarah's cannot. "Here is what
I can unblock and here is what I cannot" is a better answer than four status strings.

### Three states, not two

`get_partner_payment_readiness` answers `ready`, `blocked` or `already_funded`. Collapsing the
last two into "not ready" would put StudioX — already funded, nothing wrong — in the same
bucket as Sarah, whose onboarding is incomplete.

There is no state for "onboarded but owed nothing". Having nothing to pay is a reason a
Partner cannot be paid, so it is the `no_payable` blocker; a state as well would report the
same condition two different ways depending on what else happened to be wrong.

### `resolvable_here` is false everywhere, for now

It means *a tool in this server can clear this today*, and none can — the write tools arrive
in ticket 07. Approving a Payable is the one blocker a Buyer can clear without leaving the
Workspace, and its `resolution` says so; the boolean flips when `approve_payable` is actually
registered. Claiming `true` beforehand would send an agent looking for a tool that is not
there.

### Readiness includes the balance; Funding Capacity does not

`get_funding_capacity` assesses each Partner on onboarding and approval **only**, and reports
on the balance itself rather than treating it as an input to the rows.

If its rows also required the balance to cover them, nothing unaffordable could ever be ready,
the requirement could never exceed the balance, and `sufficient` would be `true` for every
Workspace in every state — the shortfall the tool exists to report could never be reported.

So one payload can show a Partner as `ready` while `sufficient` is `false`. That is not a
contradiction: the work is ready and the money is short. Asking about that Partner alone
returns `blocked`, because "can I pay this person right now" does include whether the money is
there. See [the discovery note](./discoveries/2026-08-13-readiness-that-includes-the-balance-makes-capacity-vacuous.md).

## Read versus write

Write tools must:

- validate current state before acting
- validate input
- be safe to retry
- emit structured logs
- write an audit event
- return the resulting state

Errors are distinguishable by kind — not found, invalid input, invalid state, insufficient
balance — so an agent can respond appropriately rather than retrying blindly.

### Funding semantics

`fund_payables` maps to Lumanu's `POST /funding` with `method: "balance"`.

Idempotency is state-based; there is no idempotency-key subsystem:

```text
approved            → funded
will_pay            → no-op, returns the existing Funding, never re-debited
unapproved          → rejects the whole request
canceled            → rejects the whole request
Partner ≠ completed_w9  → rejects the whole request
insufficient balance    → rejects the whole request
```

The whole operation is atomic. A failure part-way must leave the balance and the Payable
statuses consistent with each other.

This should feel like financial infrastructure, not CRUD.

## Example interaction

`Which Partners are currently ready to be paid?`

```text
Maya Patel      Ready to fund                    $2,500
Alex Rivera     Blocked: Payable needs approval  $7,500   (fixable here)
Sarah Chen      Blocked: onboarding incomplete            (not fixable here)
StudioX LLC     Already funded                  $10,000
```

## Example mutation flow

`Approve Alex and tell me whether Maya and Alex can both be funded.`

```text
approve_payable(Alex)
   ↓
get_workspace_balance()          → $15,000
   ↓
list approved, unfunded Payables → Maya $2,500, Alex $7,500
   ↓
Required  $10,000
Available $15,000
   ↓
Fundable: yes.  Remaining: $5,000
```

## Transport

A remote MCP endpoint over stateless Streamable HTTP:

```text
POST https://<deployment>/mcp
```

Every request is independent. No session identifiers, no long-lived `GET` event stream, no
subscriptions, no resumability. API Gateway does support response streaming, so this is a
deliberate choice: every tool here is request/response, and statelessness means any Lambda
instance can serve any request.

## Reviewer experience

The reviewer receives an MCP URL, instructions for obtaining a demo token, and five
prompts:

```text
Show me the Acme workspace and summarize its payment situation.

Which Partners are blocked from being paid, and why?

Which approved Payables are waiting for funding?

Can Acme fund every Payable that is currently ready?

Approve Alex's Payable and tell me whether Maya and Alex can now both be funded.
```
