# 07 — Security, Observability, and Testing

## Auth0

Protect the remote MCP server using Auth0 with OAuth/OIDC-compatible authentication.

Conceptual flow:

```text
MCP Client
   ↓
Auth0
   ↓ access token
API Gateway / Lambda
   ↓
MCP Server
```

Provide reviewer-friendly demo authentication without requiring Lumanu internal credentials.

## AWS KMS

Use AWS KMS-backed encryption for AWS secrets/configuration where appropriate.

Do not commit:

- database credentials
- Auth0 secrets
- future Lumanu API credentials
- private signing material

Use Secrets Manager or SSM where appropriate.

## Doppler

Use Doppler for local developer secret/config management.

Suggested split:

```text
local development → Doppler
AWS deployment    → Secrets Manager/SSM + KMS
```

## Pino

Use structured JSON logs.

Useful fields:

```text
request_id
tool_name
workspace_id when safe
provider
duration_ms
success
error_code
```

Do not log secrets.

Avoid unnecessary creator PII in logs.

## OpenTelemetry

Trace:

```text
MCP request
  ↓
tool execution
  ↓
domain service
  ↓
provider
  ↓
GraphQL / database
```

Capture:

- tool latency
- provider latency
- database latency
- failures
- request correlation

## Sentry

Capture unexpected application failures.

Attach safe context:

```text
request_id
tool_name
provider
operation
```

Do not attach secrets or unnecessary financial/PII payloads.

## Jest

Use Jest for:

- domain tests
- provider tests
- integration tests
- contract tests

Important cases:

```text
approved Payable can be funded

unapproved Payable cannot be funded

insufficient Wallet balance blocks Funding

will_pay Payable is not funded twice

Sarah is not payment-ready

Funding updates Wallet state correctly

Mock provider satisfies LumanuProvider contract
```

## Provider contract tests

Create a reusable suite.

Conceptually:

```ts
describeLumanuProvider(() => new MockLumanuProvider());
```

Later:

```ts
describeLumanuProvider(() => new RealLumanuProvider());
```

This proves the swap boundary is real.

## OpenAPI contract validation

Where practical:

```text
Mock response
   ↓
OpenAPI validation
   ↓
valid Lumanu-shaped response
```

Use this to prevent drift between the mock implementation and Lumanu's current API contract.

## Playwright

Use Playwright only for high-value smoke/E2E flows.

Examples:

- status page loads
- MCP endpoint information renders
- mock environment is healthy
- optional authenticated reviewer flow

Do not over-invest in frontend E2E coverage.
