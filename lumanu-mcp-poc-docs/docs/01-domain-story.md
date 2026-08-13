# 01 — Lumanu Domain Story

## Fictional platform

We operate a fictional creator-payments platform called **CreatorFlow**.

One of CreatorFlow's customers is **Acme Brands**.

Acme Brands runs a creator campaign called:

`Summer Creator Campaign`

Acme has a Lumanu-style Buyer Workspace:

`Acme US`

The Workspace has its own vendors/partners, projects, wallet, payables, funding records, and payment state.

## Main entities

### Buyer

The business making payments.

Example:

`Acme Brands`

### Workspace

A dedicated payment environment for a Buyer.

Example:

`Acme US`

Important relationship:

```text
Buyer
  ↓
Workspace
  ├── Project
  ├── Partner
  ├── Payable
  ├── Wallet
  └── Funding
```

### Vendor

The person or business receiving money.

Examples:

- Maya Patel
- Alex Rivera
- Sarah Chen
- StudioX LLC

### Partner

The relationship between a Vendor and a specific Workspace.

Conceptually:

```text
Vendor + Workspace = Partner relationship
```

Partner state is useful for determining onboarding/payment readiness.

### Project

A logical grouping for spend/payments inside a Workspace.

Example:

`Summer Creator Campaign`

### Payable

A payment obligation.

Example:

```text
Acme Brands owes Maya Patel $2,500
```

That obligation is represented as a Payable.

### Wallet

The Workspace's available funds and transaction history.

Example:

`Acme US Wallet = $15,000`

### Funding

The operation that provides money for approved Payables.

Approval does not mean the creator has already been paid.

---

# Canonical demo creators

These four records must always exist even if additional Faker data is generated.

## Maya Patel

TikTok creator.

```text
Partner onboarding: completed
Tax state: completed_w9

Payable: $2,500
Payable status: approved

Funding: not funded
```

Meaning:

Maya is ready for funding.

---

## Alex Rivera

YouTube creator.

```text
Partner onboarding: completed
Tax state: completed_w9

Payable: $7,500
Payable status: unapproved
```

Meaning:

Alex cannot be funded until the Payable is approved.

---

## Sarah Chen

Instagram creator.

```text
Partner status: awaiting_w9_submission
Expected payment: $4,000
```

Meaning:

Sarah is blocked by onboarding/tax requirements.

---

## StudioX LLC

Creator management agency.

```text
Partner onboarding: completed

Payable: $10,000
Payable status: will_pay
```

Meaning:

The Payable has already been funded/scheduled.

---

# Wallet scenario

Initial Acme Wallet balance:

`$15,000`

If Maya is funded:

```text
$15,000 - $2,500 = $12,500
```

If Alex is approved and both Maya + Alex are funded:

```text
Maya: $2,500
Alex: $7,500

Required: $10,000
Wallet: $15,000
Remaining: $5,000
```

---

# Expected AI reasoning

Example:

`Who is ready to be paid?`

Expected interpretation:

```text
Maya      → ready for funding
Alex      → blocked by approval
Sarah     → blocked by onboarding
StudioX   → already funded/scheduled
```

Example:

`Why can't Sarah be paid?`

Expected answer:

Her Partner/onboarding state is still waiting for W-9 completion.

Example:

`Can Acme fund all approved unpaid Payables?`

The MCP should combine Wallet + Payables + payment state rather than simply returning one REST response.
