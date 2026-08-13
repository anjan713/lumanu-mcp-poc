# 05 — MCP Tool Design

Do not expose one MCP tool for every Lumanu REST endpoint.

Expose tools that make sense to an AI agent.

## Initial read tools

```text
list_workspaces
get_workspace_overview
list_partners
get_partner
get_partner_payment_readiness
list_payables
get_payable
get_wallet_balance
list_wallet_transactions
get_project_payment_summary
explain_payment_blocker
```

## Initial write tools

```text
approve_payable
cancel_payable
fund_payables
```

## Read vs write

Clearly distinguish inspection from state changes.

For write tools:

- validate current state
- validate input
- enforce idempotency where applicable
- emit structured logs
- write audit information
- return the new state

This should feel like financial infrastructure, not toy CRUD.

## Example interaction

User:

`Which creators are currently ready to be paid?`

Expected MCP-assisted result:

```text
Maya Patel
Ready for funding
$2,500

Alex Rivera
Blocked
Reason: payable needs approval

Sarah Chen
Blocked
Reason: onboarding/W-9 incomplete

StudioX LLC
Already funded/scheduled
```

## Example mutation flow

User:

`Approve Alex and tell me whether Maya and Alex can both be funded.`

Expected operation sequence:

```text
approve_payable(Alex)
   ↓
get_wallet_balance()
   ↓
list approved unpaid Payables
   ↓
Maya = $2,500
Alex = $7,500
   ↓
Required = $10,000
Wallet = $15,000
   ↓
Funding possible = yes
Remaining = $5,000
```

## MCP transport

The production deliverable is a remote MCP endpoint using Streamable HTTP.

Expected shape:

```text
https://<deployment>/mcp
```

Local STDIO support may exist for development, but it is not the main deliverable.

## Hiring-team experience

The reviewer should receive:

- MCP URL
- authentication instructions
- 5 example prompts

Suggested prompts:

```text
Show me the Acme workspace and summarize its payment situation.

Which creators are blocked from being paid and why?

Which approved Payables are waiting for funding?

Can Acme fund every Payable that is currently ready?

Approve Alex's Payable and tell me whether Maya and Alex can now both be funded.
```
