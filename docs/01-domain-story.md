# 01 — Lumanu Domain Story

> Vocabulary follows [`CONTEXT.md`](../CONTEXT.md), which is authoritative. **Partner**,
> never Vendor or creator. **Workspace Balance**, never Wallet.

## The scenario

A fictional creator-payments platform, **CreatorFlow**, has a customer: **Acme Brands**.
Acme runs a creator campaign called `Summer Creator Campaign` and pays for it from a
Lumanu-style Buyer Workspace, `Acme US`.

The POC models exactly one Workspace, one Project, and four canonical Partners. This is a
deliberate constraint — see [08-definition-of-done.md](./08-definition-of-done.md).

## Entities

### Buyer

The business making payments. Here, `Acme Brands`.

### Workspace

A Buyer's dedicated payment environment, owning its own Partners, Projects, Payables,
balance and funding history. Here, `Acme US`.

```text
Buyer
  ↓
Workspace
  ├── Project
  ├── Partner
  ├── Payable
  ├── Workspace Balance
  │     └── Balance Transaction
  └── Funding
```

### Partner

A person or business receiving money from a Workspace. Lumanu's own documentation uses
"vendor" and "partner" interchangeably — "vendors (or 'partners')" — and **Partner** is the
term this project uses everywhere a user or an AI agent can see: tool names, tool
descriptions, arguments and results.

> An internal `vendors` table was considered and rejected. With one Workspace it adds a
> join that earns nothing. A second Workspace would be the point at which a global payee
> identity separate from workspace membership starts to pay for itself.

### Partner status

One value covering a Partner's combined onboarding **and** tax state. Lumanu's real enum:

```text
missing_metadata_file_us_taxes
in_process
awaiting_w9_submission
completed_w9
awaiting_w8_submission
w8_submitted
```

There is no separate "onboarding state" and "tax state" — that was an earlier error in this
document. A Partner has one status.

### Project

A grouping of spend inside a Workspace. Here, `Summer Creator Campaign`.

### Payable

One payment obligation from a Workspace to a Partner. Lumanu's real `status` enum, read
from the harvested fragment:

```text
unapproved
approved
will_pay
canceled
paid
```

`will_pay` means the Payable has been funded and is scheduled to reach the Partner, and is
the terminal state here — settlement is evidenced by a Funding and its Balance Transaction.

`paid` is real, and unused: no flow in this POC produces it. It is carried in the wire
types because the fragment defines it, and an earlier draft of this document was wrong to
say it did not exist. The field is optional rather than nullable, so a Payable may carry no
status at all; that too is unused here.

Lumanu also publishes a second, richer `payable_status` — tracking payee state, transfers
and reversals — and an unconstrained `vendor_status` string. Both are carried; the
reasoning in this POC keys off `status`. See
[docs/02](./02-official-api-sources.md#payables-carry-three-status-fields-not-two).

### Workspace Balance

The money a Workspace has already pre-funded and can draw on. Every credit and debit is
recorded as a **Balance Transaction**, so the history explains the current figure.

### Funding

In Lumanu, `POST /funding` is dual-mode:

```text
method: "invoice"  → money INTO the Workspace
                     (invoice to the Buyer's finance team → link-deposit → balance)

method: "balance"  → money OUT to Partners
                     (draw from the pre-funded balance to pay approved Payables)
```

**This POC models `method: "balance"` only.** Acme US is pre-funded; invoice funding and
the post-funding flow are out of scope.

> An earlier version of this document defined Funding purely as an outflow. That was
> wrong: in Lumanu, funding is primarily how money *arrives*, and paying Partners is the
> `balance` case of the same operation.

## The canonical scenario

Acme US opens at **$25,000**. StudioX's $10,000 Funding has already happened and appears in
history, leaving a current balance of **$15,000**.

| Partner | Partner status | Payable | Payable status | Outcome |
| --- | --- | --- | --- | --- |
| Maya Patel | `completed_w9` | $2,500 | `approved` | Ready to fund |
| Alex Rivera | `completed_w9` | $7,500 | `unapproved` | Blocked: needs approval |
| Sarah Chen | `awaiting_w9_submission` | none | — | Blocked: onboarding incomplete |
| StudioX LLC | `completed_w9` | $10,000 | `will_pay` | Already funded |

Each Partner isolates exactly one outcome. Sarah deliberately has **no Payable** — Alex
already demonstrates an unapproved one, and giving her a second blocker would muddy the
distinction. An earlier "expected payment: $4,000" for Sarah has been removed: it is not a
Lumanu concept and there is nowhere in the wire format to put it.

### Balance arithmetic

```text
Opening balance                $25,000
StudioX Funding                -$10,000
                               ────────
Current balance                $15,000
```

After approving Alex:

```text
Maya                            $2,500
Alex                            $7,500
                               ────────
Required                       $10,000
Available                      $15,000
Remaining after funding         $5,000
```

Funding fees are fixed at zero for this POC, so $10,000 of Payables requires exactly
$10,000. Lumanu's real `funding_fee_percent` and `additive_funding_fee` fields are present
in the wire format but not exercised.

## What the MCP should conclude

`Which Partners are ready to be paid?`

```text
Maya      → ready to fund
Alex      → blocked: Payable needs approval        (this server can fix it)
Sarah     → blocked: onboarding incomplete         (this server cannot fix it)
StudioX   → already funded
```

`Why can't Sarah be paid?`

Her Partner status is `awaiting_w9_submission`. Note she has no Payable either — but
onboarding is the **binding** blocker, because it is furthest upstream and nothing
downstream matters until it clears.

`Can Acme fund every Payable that is currently ready?`

This requires combining the Workspace Balance, the Payables, and each Partner's status —
not returning one API response. That combination is the point of the project.
