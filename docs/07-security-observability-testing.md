# 07 — Security, Observability, and Testing

## Auth0

The remote MCP endpoint is protected by Auth0 using the **machine-to-machine
`client_credentials`** grant.

```text
Reviewer
   ↓ client_id + client_secret
Auth0  →  access token
   ↓ Authorization: Bearer <JWT>
API Gateway → Lambda
   ↓ validate
MCP Server
```

The Lambda validates every request's JWT:

- signature, via **JWKS**, so signing-key rotation works
- issuer
- audience
- expiry

The full MCP OAuth authorization-server flow — protected-resource metadata, dynamic client
registration, PKCE — is **not** implemented. The reviewer connects with Claude Code, which
accepts a bearer header, and receives short instructions for minting a demo token. This
mirrors how Lumanu's own API authenticates.

Unauthenticated requests, expired tokens, and tokens with the wrong audience are all
rejected.

## Secrets

The Supabase connection string, the Hasura admin secret, and the Auth0 client secret live
in AWS SSM Parameter Store as KMS-encrypted `SecureString` parameters, and are read at
runtime by the Lambda execution role. See ADR 0003.

Never committed: database credentials, Auth0 secrets, future Lumanu API credentials,
private signing material. `.env.example` documents the shape with placeholder values only.

Locally, secrets come from a gitignored `.env`. Doppler is out of scope — see
[06-aws-deployment.md](./06-aws-deployment.md).

## Pino

Structured JSON logs. Every MCP request carries:

```text
request_id      correlation id
tool_name
provider        mock | real
workspace_id    where safe
duration_ms
success
error_code      on failure
```

No secrets. No Partner personal data beyond what the log line needs.

## Testing

The system under test has **two seams and no others**. Nothing mocks Apollo or Hasura, and
no test asserts that a particular provider method was called or that a GraphQL document had
a given shape. A good test here asserts what a tool returns and what state a write leaves
behind.

Build tooling is not the system under test, and has its own small seam — see
[The harvested contract](#the-harvested-contract) below. The rule that matters is that no
test reaches *between* the two product seams, not that no other code may be tested at all.

### Seam 1 — the MCP tool surface

The primary seam, and the highest available. Tests construct the MCP server in-process,
inject `InMemoryLumanuProvider`, call tools through an in-memory transport, and assert on
results. No network, no credentials — so a fresh clone runs the suite green.

Required cases:

```text
each canonical Partner resolves to its intended outcome
Sarah is reachable and blocked by onboarding, despite having no Payable
Alex is blocked by approval, and it is marked fixable here
blocker precedence reports only the most upstream failure
Funding Capacity before and after approving Alex: $10,000 of $15,000, $5,000 remaining
an approved Payable can be funded
an unapproved Payable cannot be funded
a Partner who is not completed_w9 cannot be funded
insufficient balance blocks Funding and leaves all state untouched
a will_pay Payable is not funded twice
a mixed batch funds only what needs funding
Funding updates the balance and writes a matching Balance Transaction
approving a funded or canceled Payable is rejected
cancelling a funded Payable is rejected
write tools return the resulting state and write an audit event
errors are distinguishable by kind
read tools honour Lumanu's pagination and envelope
```

### Seam 2 — the `LumanuProvider` contract

One reusable suite, run against every implementation:

```ts
describeLumanuProviderContract('InMemoryLumanuProvider', subject);  // always
describeLumanuProviderContract('MockLumanuProvider', subject);      // with Hasura credentials
describeLumanuProviderContract('RealLumanuProvider', subject);      // skipped: no Lumanu account
```

It asserts Lumanu-shaped values: field names, snake_case, nullability, enum membership,
envelope structure, pagination behaviour, identifier formats. Where a harvested OpenAPI
fragment exists, responses are validated against it, so drift from Lumanu's published
contract fails the build.

This proves the swap boundary is real — and it is also what makes the in-memory fake used
at Seam 1 trustworthy rather than a place for drift to hide.

### The harvested contract

Not a product seam — this tests the build tooling that caches Lumanu's published schemas,
and the cache it produces. Three things are checked, because each fails differently:

- **Extraction and stitching**, on synthetic pages: that a fragment is read out of a
  reference page correctly, and that two pages defining the same schema differently abort
  the harvest rather than silently picking one.
- **The committed cache**, on the real files: that `openapi.json` is exactly what
  re-stitching the committed fragments produces, and that the generated types are exactly
  what the committed spec generates. Both are derived files committed beside their inputs,
  so without this they could drift apart while every other test kept passing.
- **The declared field names and enums** of each schema the provider reads.

That last one carries the weight, and is worth explaining. Validating a value against
Lumanu's schema cannot catch a field being renamed or removed: Lumanu marks almost nothing
`required` and forbids no additional properties, so an object missing a renamed field still
validates perfectly. Enum drift and missing required fields do fail validation; renames do
not. Since a rename is the commonest kind of wire drift and the one that would silently
break the provider mapping, the field names are asserted directly.

### Additional checks

The stored Workspace Balance equals the sum of Balance Transactions. A reseeded database
reproduces byte-identical canonical figures.

### Not tested

Auth0 validation against live Auth0, CloudFormation deployment, and the harvest script's
network fetching — the parsing and stitching it wraps are covered above, but no test
fetches from `developers.lumanu.com`. Each is verified by hand once.

## Out of scope

OpenTelemetry, Sentry, Doppler and Playwright are deliberately excluded — see
[06-aws-deployment.md](./06-aws-deployment.md). Pino with correlation ids covers the
observability need for a POC of this size, and there is no frontend for Playwright to
exercise.
