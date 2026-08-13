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
explain_payment_blocker
```

Two names changed from the original list, because [`CONTEXT.md`](../CONTEXT.md) bans bare
"Wallet" as ambiguous between the Workspace Balance and a Partner's own stored-value
account: `get_wallet_balance` → `get_workspace_balance`, and `list_wallet_transactions` →
`list_workspace_transactions`.

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

```text
1. Partner status is not completed_w9      → onboarding incomplete
2. Payable is unapproved, or absent        → needs approval
3. Workspace Balance is insufficient       → insufficient funds
```

Each blocker states whether a tool in this server can resolve it. Alex's can be fixed by
`approve_payable`; Sarah's cannot be fixed here at all. "Here is what I can unblock, and
here is what I cannot" is a better answer than four status strings.

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
