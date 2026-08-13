# 02 — Official Lumanu API Sources

Lumanu's current developer documentation is the source of truth. Where this project's
assumptions conflict with it, the official specification wins.

## Primary references

- Introduction: `https://developers.lumanu.com/docs/intro`
- Core concepts: `https://developers.lumanu.com/docs/core-concepts`
- Documentation index: `https://developers.lumanu.com/llms.txt`
- API reference pages: `https://developers.lumanu.com/reference/<endpoint>.md`

## There is no single OpenAPI document

This is the important finding, and it changes the workflow originally planned here.

`llms.txt` lists 15 guides and roughly 30 `reference/*.md` pages. **It links no
`openapi.json` or `openapi.yaml`.** Instead, each reference page embeds an OpenAPI 3.1
fragment describing that one endpoint.

So "discover the machine-readable specification" resolves to: fetch the reference pages for
the endpoints in use, extract their fragments, and stitch them into a local specification.

That is now a build step, and it has been run:

```bash
npm run harvest:contract   # fetch, extract, stitch  → docs/lumanu-reference/
npm run generate:types     # stitch → TypeScript      → src/generated/lumanu-api.ts
```

```text
docs/lumanu-reference/
  llms.txt
  fragments/<endpoint>.json   ← 14 endpoints, one file each, verbatim
  openapi.json                ← stitched: 14 paths, 9 schemas
```

Fourteen endpoints are cached — the eleven behind the `LumanuProvider` methods, plus
`get-funding` and the two Project reads. Everything committed, so no build step, typecheck
or test requires network access. The fragments overlap heavily, since every page that
mentions a Payable ships the whole `Payable` schema; the stitcher deduplicates and **aborts
if two pages define the same schema differently**, naming both, because that would be a real
finding rather than something to merge away. Nothing conflicted on the harvest of
2026-08-12.

Re-run `harvest:contract` when Lumanu updates its documentation. The diff on
`docs/lumanu-reference/` is then a readable statement of what changed in the contract this
project claims compatibility with, and `npm test` says whether anything here depended on it.

## Source-of-truth rules

The harvested fragments govern:

- endpoint paths and HTTP methods
- request and response field names
- enums
- nullability and required/optional fields
- pagination parameters and response envelopes
- identifier formats
- the representation of monetary amounts

Lumanu's guides govern business meaning, workflow semantics, entity relationships, and how
onboarding and payment states should be interpreted.

## Confirmed facts

Established from the official documentation and not to be re-derived:

**Environments and authentication.** Sandbox `https://api.demo.lumanu.link/api/rest`;
production `https://api.lumanu.com/api/rest`. Authentication is OAuth — `client_credentials`
for server-to-server, authorization-code for third-party apps — not API keys. Tokens are
bearer tokens valid 24 hours. Credentials are issued on request only; there is no
self-serve signup. **This project has no sandbox credentials**, so `RealLumanuProvider`
remains an unexercised skeleton.

**Lumanu runs Hasura.** The sandbox API audience is
`https://lumanu-demo.hasura.app/v1/graphql`, and the REST base path `/api/rest` is Hasura's
REST Endpoints feature. Lumanu's own stack is Hasura Cloud over PostgreSQL behind an OAuth
provider — which is why this project's mock uses the same shape. See
[ADR 0002](./adr/0002-hasura-cloud-v2-over-ddn.md).

**Response envelope.** List endpoints return `{ data, total, limit, offset }`, with query
parameters `limit` (default 25), `offset` (default 0), `order_by`, and `order_by_direction`
of `asc` or `desc`.

**Workspace fields** include `id`, `display_name`, `profile_image_url`, `created_at`,
`updated_at`, `funding_fee_percent` (nullable), `additive_funding_fee` (nullable), and
`vendor_invite_url`.

**Partner onboarding** is `POST /workspace/{id}/partner/invite`, returning an
`invitation_id`; the permanent `lumanu_id` arrives via the `partner-invite.claimed`
webhook. Payables are created against `payee_email`, with `payee_lumanu_id` available once
onboarding completes.

**Webhooks** exist — `payable.created`, `payable.approved`, `payable.paid`,
`transfer.created`, `partner-invite.claimed` — and are out of scope here, though internal
audit events are named after them.

## What the harvest settled

Read from the fragments on 2026-08-12. Where any of this contradicted something written
elsewhere in these docs, the fragment won and the doc was corrected.

### Monetary amounts

Amounts are **integers in an explicitly named unit**. There is no decimal representation
anywhere in the contract, and no currency code either: every amount travels beside a
denomination field — `amount_denomination` on `Payable`, `Transaction` and `Funding`,
`denomination` on `Account`, `budget_denomination` on `Project`.

Lumanu constrains that field to an enum of exactly one value, `us_cents`, on `Transaction`,
`Funding` and `Account`. On `Payable` and `Project` it is an unconstrained string, carrying
`us_cents` only as an example. That is an inconsistency in Lumanu's own documents rather
than a second unit: no other value appears anywhere. This project therefore treats
`us_cents` as the only unit it emits, while the wire types stay as loose as the contract is
— `AmountDenomination` is derived from `Transaction`, the narrowest published statement of
the unit, and is not forced onto the fields Lumanu left open.

So this project's internal storage of integer cents *is* the wire representation, and the
provider mapping performs no monetary conversion. The denomination is carried rather than
dropped: an integer amount with the unit stripped off is exactly the ambiguity Lumanu
avoided by publishing the field.

### Two open questions closed

`/payable` **is the collection path**, not `/payables`; approve and cancel are both
**`POST`**, not `PUT`:

```text
GET  /payable                 GET  /payable/{id}
POST /payable/{id}/approve    POST /payable/{id}/cancel
```

### Payables carry three status fields, not two

The earlier note here said two. The fragment shows three, and they are not
interchangeable:

- `status` — payor approval intent: `unapproved`, `approved`, `will_pay`, `canceled`,
  `paid`. This is the one the reasoning in this POC keys off.
- `payable_status` — the fuller lifecycle, accounting for payee state, transfers and
  reversals: `not_approved`, `approved`, `scheduled`, `awaiting_payment`, `awaiting_payee`,
  `paid`, `canceled`, `reversed`.
- `vendor_status` — an unconstrained string, not an enum. The example value is `"verified"`.
  An earlier note here gave `"Awaiting signup"`, which the fragment does not support.

`paid` **is** a real value of `status`, contrary to what `CONTEXT.md` and doc 01 previously
asserted. It is carried in the wire types for fidelity, and no flow in this POC produces
it: funding moves a Payable to `will_pay`, and settlement is evidenced by the Funding and
its Balance Transaction. Both documents have been corrected to say that rather than to deny
the value exists.

### Partner status is a single nullable enum

Six values — `missing_metadata_file_us_taxes`, `in_process`, `awaiting_w9_submission`,
`w8_submitted`, `awaiting_w8_submission`, `completed_w9` — confirming that Lumanu has one
combined onboarding-and-tax status rather than the two fields doc 01 originally invented.
It is **nullable**, and `null` is meaningful: a Partner invited but not yet through any
check has no status at all. `PartnerDetail` extends `Partner` with `payables_count`,
`legal_business_name`, `emails` and `has_wallet` — that last being the Vendor Wallet, which
is out of scope here but present on the wire.

### The Workspace Balance is an account with two figures

`GET /workspace/{id}/wallet` returns an `Account` whose `balance` is an object, not a
number:

```json
{ "balance": { "available_balance": 100000, "balance": 100431 }, "denomination": "us_cents" }
```

`balance` is the total held; `available_balance` is what can actually be committed. The
Workspace Balance a finance operator asks about, and that Funding Capacity is measured
against, is `available_balance`. This POC seeds the two equal, since nothing in the
canonical scenario holds funds back — but the distinction is preserved in the wire type
rather than flattened away.

`Transaction` carries `balance_change` and `ending_balance` alongside `amount`, with
`type` of `deposit`, `fee`, `payment`, `withdrawal` or `invoice`, and `status` of `pending`
or `processed`. The $10,000 StudioX Funding is therefore a `payment` transaction with a
`balance_change` of `-1000000` and an `ending_balance` of `1500000`.

### Funding matches the modelled flow

`POST /funding` requires `workspace_id` and `method`, where `method` is `balance` or
`invoice`. `payable_ids` is required when the method is `balance` — the mode this POC
models — and mutually exclusive with a bare `amount`. Fee fields `base_amount`,
`fee_amount`, `fee_percent` and `is_fee_additive` are all nullable, which is what lets this
POC fix fees at zero without inventing anything.

### One quirk to know about

The documents declare OpenAPI **3.1** but express nullability with 3.0's `nullable: true`
keyword, which JSON Schema 2020-12 does not define. A validator reading them literally
would ignore the keyword and then reject the `null` Lumanu genuinely returns. The contract
test suite translates `nullable: true` into a `null` union before validating; it is the one
adaptation made to the harvested schemas, and it is deliberately narrow.

Separately, the prose embedded in `info.description` gives the API base URLs as
`partner-api.lumanu.link` and `partner-api.lumanu.com`, while the machine-readable
`servers` block gives `api.demo.lumanu.link/api/rest` and `api.lumanu.com/api/rest`. The
`servers` block governs, per the source-of-truth rules above.

## Mock compatibility

```text
harvested OpenAPI fragments
   ↓
generated TypeScript types
   ↓
LumanuProvider interface
   ↓
every implementation
   ↓
contract validation
```

Do not invent Lumanu response shapes where an official schema exists. The mock must be
believable enough that a future real provider satisfies the same contract unchanged.
