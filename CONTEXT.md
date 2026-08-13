# Lumanu MCP POC

A proof-of-concept MCP server that lets an AI agent reason about creator payments for a
single fictional Buyer, using mock data shaped exactly like Lumanu's real API.

This glossary is authoritative. Where a term here disagrees with `docs/01`–`docs/08`,
this file wins.

## Language

### Parties and containers

**Buyer**:
The business that owes money to creators. In this POC, Acme Brands.
_Avoid_: Customer, client, brand, advertiser

**Workspace**:
A Buyer's isolated payment environment, owning its own Partners, Projects, Payables,
and balance. In this POC there is exactly one: Acme US.
_Avoid_: Account, tenant, organization, environment

**Project**:
A grouping of spend inside a Workspace. In this POC there is exactly one:
Summer Creator Campaign.
_Avoid_: Campaign, budget, program

**Partner**:
A person or business that receives money from a Workspace. This is the only term used
for a payee anywhere a user or an AI agent can see — tool names, tool descriptions,
arguments, and results.
_Avoid_: Vendor, creator, payee, supplier, recipient

> `Vendor` may exist as an internal storage term only, never in the public surface.

**Partner Status**:
A single value describing a Partner's combined onboarding and tax state — for example
`completed_w9` or `awaiting_w9_submission`. There is one such value per Partner, not a
separate onboarding state and tax state.
_Avoid_: Onboarding state, tax state, KYC status, verification status

### Money owed

**Payable**:
One payment obligation from a Workspace to a Partner, for a fixed amount.
_Avoid_: Invoice, bill, payout request, line item

**Payable Status**:
The lifecycle value of a Payable: `unapproved`, `approved`, `will_pay`, or `canceled`.
`will_pay` means the Payable has been funded and is scheduled to reach the Partner.
There is no `paid` status — settlement is evidenced by a Funding and its Balance
Transaction.
_Avoid_: Paid, settled, complete, pending

### Money held and moved

**Workspace Balance**:
The money a Workspace has already pre-funded and can draw on to pay Partners.
_Avoid_: Wallet, wallet balance, account balance, float

> A **Vendor Wallet** — the stored-value account a Partner holds and withdraws from — is
> a real Lumanu concept and is deliberately out of scope here. Bare "Wallet" is banned
> precisely because it is ambiguous between the two.

**Balance Transaction**:
A single credit or debit recorded against the Workspace Balance.
_Avoid_: Wallet transaction, ledger entry, journal entry

**Funding**:
The operation that draws money from the Workspace Balance to pay a set of approved
Payables, moving each to `will_pay` and recording a Balance Transaction. Funding a
Workspace *from outside* — invoice funding — is out of scope.
_Avoid_: Payout, disbursement, settlement, transfer, top-up

### Derived concepts

These are not Lumanu API fields. They are conclusions the domain layer reaches by
combining Partner Status, Payable Status, and Workspace Balance.

**Payment Readiness**:
Whether a given Payable can be funded right now.

**Payment Blocker**:
The single binding reason a Payable cannot be funded right now. When more than one
condition fails, the blocker is the one furthest upstream — an incomplete Partner Status
outranks an unapproved Payable, which outranks an insufficient Workspace Balance.

**Funding Capacity**:
Whether the Workspace Balance covers the total of every Payable that is currently
ready to fund.
