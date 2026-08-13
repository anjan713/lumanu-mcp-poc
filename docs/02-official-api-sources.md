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
That is a build step — see [ticket 02](../.scratch/lumanu-mcp/issues/02-lumanu-contract-harvested-and-typed.md).

Cached locally at:

```text
docs/lumanu-reference/
  llms.txt
  fragments/<endpoint>.json
  openapi.json          ← stitched from the fragments
```

Cached files are committed, so no build step requires network access.

## Source-of-truth rules

The harvested fragments govern:

- endpoint paths and HTTP methods
- request and response field names
- enums
- nullability and required/optional fields
- pagination parameters and response envelopes
- identifier formats
- **the representation of monetary amounts** — currently unknown, and to be read from the
  fragments rather than assumed

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

**Payables carry two status fields**: `status` and a separate `vendor_status` (for example
`"Awaiting signup"`).

**Webhooks** exist — `payable.created`, `payable.approved`, `payable.paid`,
`transfer.created`, `partner-invite.claimed` — and are out of scope here, though internal
audit events are named after them.

**Known documentation inconsistencies** to resolve from the reference pages rather than the
guides: `POST` vs `PUT` on `/payable/{id}/approve`, and `/payable` vs `/payables`.

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
