# 05 — Read tools over the canonical data

**What to build:** Everything a finance operator needs to see the current situation without
issuing several queries and reconciling them by hand. After this ticket a reviewer can ask
what the Workspace holds, who its Partners are, what is owed, and how the balance reached
its current figure — and get answers that look exactly like Lumanu's own responses.

These tools return facts. The conclusions drawn from them are ticket 06.

**Blocked by:** 04

**Status:** ready-for-agent

- [x] `get_workspace_overview` answers balance, Partner count and Payable totals in one call
- [x] `list_partners` and `get_partner` return Lumanu-shaped Partners with a single combined onboarding and tax status
- [x] `list_payables` and `get_payable` return Lumanu-shaped Payables, and Payables can be filtered by status
- [x] `get_workspace_balance` returns the current Workspace Balance
- [~] `list_workspace_transactions` returns Balance Transactions, and each identifies the Funding and Partner it relates to
- [x] The StudioX debit is visible in transaction history and explains the move from $25,000 to $15,000
- [x] `get_project_payment_summary` reports what the Summer Creator Campaign has committed, paid and still owes
- [x] List tools honour Lumanu's `limit`, `offset`, `order_by` and `order_by_direction`, with Lumanu's defaults
- [x] List responses carry the `{ data, total, limit, offset }` envelope
- [x] Tool results avoid Partner personal data not needed to answer the question
- [x] Every tool is described in terms of business intent, so an agent can choose between them without guessing at REST semantics

## Not met, and why

**`list_workspace_transactions` does not identify the Funding or the Partner.** Lumanu's
`Transaction` schema has nine fields and no reference of any kind — no `funding_id`, no
Partner — and there is no endpoint that lists Fundings, so the correlation cannot be
reconstructed above the provider either. The internal schema does hold
`balance_transactions.funding_id`, so publishing it would be one line; it is not published
because a field `RealLumanuProvider` could never produce is exactly the drift ADR 0001 exists
to prevent.

The Partner is named in the transaction description — *"Funding — StudioX LLC"* — which is how
the StudioX debit is identified today, and is what the criterion below it turns on.

See [the discovery note](../../../docs/discoveries/2026-08-13-lumanus-wire-format-carries-no-joins.md)
and `docs/05-mcp-tools.md`.

## Met, but differently than the wording suggests

- **Payables cannot be filtered by status at the provider.** Lumanu publishes no such
  parameter, so `list_payables` reads the whole set, filters, then pages. `total` describes
  what matched.
- **A Payable carries no `partner_id`.** The Partner is named by display name and Lumanu id,
  as Lumanu names it. The email address Lumanu also carries is withheld from list results.
- **"Lumanu's defaults" for `order_by` do not exist.** Lumanu publishes `order_by` as a
  free-form string and documents no default. Every implementation here defaults to
  `created_at` ascending and accepts a closed set of fields per collection, refusing anything
  else — a shared default is what lets the contract suite compare a page from the fixture with
  a page from the database, and a closed set is what stops an arbitrary string reaching SQL.

## Added beyond the ticket

- `list_projects`, because `get_project_payment_summary` needs a `project_id` and nothing else
  returns one.
- `type` on `list_workspace_transactions`, which is a parameter Lumanu does publish and is how
  the history is narrowed to money out.
- Budget figures on the Project summary, since the canonical Project carries a budget and
  "still owes" is hard to read without it.
