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
in AWS Secrets Manager with KMS-backed encryption, and are read at runtime.

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

Tests are written at **two seams and nowhere else**. Nothing mocks Apollo or Hasura, and no
test asserts that a particular provider method was called or that a GraphQL document had a
given shape. A good test here asserts what a tool returns and what state a write leaves
behind.

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
describeLumanuProviderContract(() => new InMemoryLumanuProvider());  // always
describeLumanuProviderContract(() => new MockLumanuProvider());      // with credentials
describeLumanuProviderContract(() => new RealLumanuProvider());      // skipped: no credentials
```

It asserts Lumanu-shaped values: field names, snake_case, nullability, enum membership,
envelope structure, pagination behaviour, identifier formats. Where a harvested OpenAPI
fragment exists, responses are validated against it, so drift from Lumanu's published
contract fails the build.

This proves the swap boundary is real — and it is also what makes the in-memory fake used
at Seam 1 trustworthy rather than a place for drift to hide.

### Additional checks

The stored Workspace Balance equals the sum of Balance Transactions. A reseeded database
reproduces byte-identical canonical figures.

### Not tested

Auth0 validation against live Auth0, CloudFormation deployment, and the harvest script's
network fetching. Each is verified by hand once.

## Out of scope

OpenTelemetry, Sentry, Doppler and Playwright are deliberately excluded — see
[06-aws-deployment.md](./06-aws-deployment.md). Pino with correlation ids covers the
observability need for a POC of this size, and there is no frontend for Playwright to
exercise.
