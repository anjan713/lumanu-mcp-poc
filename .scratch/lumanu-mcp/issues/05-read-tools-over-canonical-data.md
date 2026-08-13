# 05 — Read tools over the canonical data

**What to build:** Everything a finance operator needs to see the current situation without
issuing several queries and reconciling them by hand. After this ticket a reviewer can ask
what the Workspace holds, who its Partners are, what is owed, and how the balance reached
its current figure — and get answers that look exactly like Lumanu's own responses.

These tools return facts. The conclusions drawn from them are ticket 06.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] `get_workspace_overview` answers balance, Partner count and Payable totals in one call
- [ ] `list_partners` and `get_partner` return Lumanu-shaped Partners with a single combined onboarding and tax status
- [ ] `list_payables` and `get_payable` return Lumanu-shaped Payables, and Payables can be filtered by status
- [ ] `get_workspace_balance` returns the current Workspace Balance
- [ ] `list_workspace_transactions` returns Balance Transactions, and each identifies the Funding and Partner it relates to
- [ ] The StudioX debit is visible in transaction history and explains the move from $25,000 to $15,000
- [ ] `get_project_payment_summary` reports what the Summer Creator Campaign has committed, paid and still owes
- [ ] List tools honour Lumanu's `limit`, `offset`, `order_by` and `order_by_direction`, with Lumanu's defaults
- [ ] List responses carry the `{ data, total, limit, offset }` envelope
- [ ] Tool results avoid Partner personal data not needed to answer the question
- [ ] Every tool is described in terms of business intent, so an agent can choose between them without guessing at REST semantics
