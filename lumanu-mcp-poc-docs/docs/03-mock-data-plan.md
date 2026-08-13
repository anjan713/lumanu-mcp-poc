# 03 — Mock Data Plan

Use:

`@faker-js/faker`

## Deterministic seed

Use a fixed seed so local development, tests, demos, and CI all see reproducible data.

Example:

```ts
faker.seed(713);
```

## Important rule

Faker should generate realistic values, but must not randomly destroy the canonical demo scenarios.

Hard-code the business states for:

- Maya Patel
- Alex Rivera
- Sarah Chen
- StudioX LLC

Then generate additional relational records around them.

## Suggested scale

Generate approximately:

```text
3 Workspaces
8-12 Projects
30-50 Partners/Vendors
75-150 Payables
Wallets
Wallet transaction history
Funding records
```

Keep the dataset small enough for a POC but large enough that MCP queries are interesting.

## Generate relational data

Do not create disconnected random records.

Generate:

```text
Workspace
  ↓
Projects
  ↓
Partners
  ↓
Vendors
  ↓
Payables
  ↓
Funding
  ↓
Wallet transactions
```

## Faker can generate

- names
- emails
- company names
- project/campaign names
- descriptions
- timestamps
- addresses when required by schema
- invoice references
- identifiers
- metadata

## Business states should be controlled

Example:

```text
Maya     → approved
Alex     → unapproved
Sarah    → awaiting_w9_submission
StudioX  → will_pay
```

Additional records should cover diverse valid states discovered in Lumanu's official schemas.

## Persistence

Persist generated data in PostgreSQL.

Suggested internal entities:

```text
workspaces
projects
vendors
partners
payables
wallets
wallet_transactions
fundings
funding_payables
audit_events
```

Do not blindly use this schema.

First inspect Lumanu's official API schemas, then design an internal database model that can be mapped cleanly into Lumanu-compatible provider responses.

## Seed commands

Provide commands similar to:

```text
npm run db:migrate
npm run db:seed
npm run db:reset
```

`db:reset` should recreate the same deterministic dataset.
