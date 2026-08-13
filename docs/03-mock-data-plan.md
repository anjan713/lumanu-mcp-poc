# 03 — Mock Data Plan

## Scale

**One** Workspace, **one** Project, **four** canonical Partners. Faker adds a small amount
of texture around them — a few extra Partners and Payables — and nothing more.

> An earlier version of this document called for 3 Workspaces, 8–12 Projects, 30–50
> Partners and 75–150 Payables. That is superseded. The POC demonstrates one payment flow
> cleanly rather than reproducing the platform; extra Workspaces and funding models would
> add surface without adding evidence.

Faker must **not** introduce a second Workspace, a second Project, a second funding model,
another currency, or a non-zero funding fee.

## Determinism

A fixed seed, so local development, tests, CI and the deployed database all observe
identical figures:

```ts
faker.seed(713);
```

The canonical business states are **hard-coded**, not generated. Faker supplies realistic
names, emails, descriptions, timestamps and invoice references around them, and can never
disturb them.

The README and the reviewer's example prompts quote exact figures, so a change to the seed
that moves those numbers is a breaking change.

## Canonical data

Acme US opens at **$25,000**; StudioX's $10,000 Funding is present as history; the current
balance is **$15,000**.

| Partner | Partner status | Payable | Payable status |
| --- | --- | --- | --- |
| Maya Patel | `completed_w9` | $2,500 | `approved` |
| Alex Rivera | `completed_w9` | $7,500 | `unapproved` |
| Sarah Chen | `awaiting_w9_submission` | none | — |
| StudioX LLC | `completed_w9` | $10,000 | `will_pay` |

Sarah has no Payable. That is intentional — see
[01-domain-story.md](./01-domain-story.md).

## Relational generation

Records are generated as a connected graph, never as disconnected rows:

```text
Workspace
  ↓
Project
  ↓
Partner
  ↓
Payable
  ↓
Funding
  ↓
Balance Transaction
```

## Persistence

PostgreSQL, hosted on Supabase. Internal tables:

```text
workspaces
projects
partners
payables
fundings
funding_payables
balance_transactions
audit_events
```

There is **no `vendors` table** — Partner is a single table.

Money is stored as **integer cents**, USD only — which is exactly what Lumanu's wire format
uses, so the provider mapping performs no monetary conversion at all. Every amount in the
harvested schemas is an `integer` accompanied by a denomination field, and `us_cents` is
the only value that appears anywhere in the contract; there is no decimal representation.
The
denomination is carried through rather than dropped, because dropping it is how an integer
amount silently becomes ambiguous. See [docs/02](./02-official-api-sources.md#monetary-amounts).

The Workspace Balance is stored on the Workspace **and** derivable from
`balance_transactions`. The redundancy is deliberate: the stored column gives funding a
single row to lock, and the ledger gives the transaction history a real purpose. A test
asserts the two agree.

`audit_events` rows are named after Lumanu's real webhook events — `payable.created`,
`payable.approved`, `payable.paid` — so a future real integration has an obvious place to
land inbound events. No webhook delivery is built.

This internal schema is designed to map cleanly into Lumanu-compatible responses; it is not
a copy of Lumanu's own storage.

## Commands

```text
npm run db:migrate
npm run db:seed
npm run db:reset
```

`db:reset` recreates a byte-identical dataset. A test asserts this.
