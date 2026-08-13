# 08 — Definition of Done

The POC is complete when all of the following are true.

## API/domain

- [ ] Lumanu `llms.txt` is fetched/referenceable.
- [ ] Current OpenAPI specification is discovered from official Lumanu documentation.
- [ ] Important Lumanu API contracts are generated or validated from OpenAPI.
- [ ] Domain assumptions are checked against official docs.
- [ ] Canonical Maya/Alex/Sarah/StudioX scenarios exist.

## Mock data

- [ ] Faker.js generates deterministic relational data.
- [ ] PostgreSQL persists mock state.
- [ ] Multiple valid business states exist.
- [ ] Database can be reset to the same seed.

## Data/provider architecture

- [ ] Hasura exposes internal GraphQL over PostgreSQL.
- [ ] Apollo Client is used by the mock provider.
- [ ] GraphQL Codegen generates typed query/mutation models.
- [ ] `LumanuProvider` abstraction exists.
- [ ] `MockLumanuProvider` works.
- [ ] `RealLumanuProvider` skeleton exists.
- [ ] Provider contract tests exist.

## MCP

- [ ] Business-oriented MCP tools work.
- [ ] Read/write tools are clearly separated.
- [ ] Write operations validate state and support safe retries/idempotency where appropriate.
- [ ] Remote Streamable HTTP MCP works.
- [ ] Hiring reviewer can connect using documented URL/auth instructions.

## AWS

- [ ] Lambda deployment works.
- [ ] API Gateway exposes the MCP endpoint.
- [ ] CloudFormation creates AWS infrastructure.
- [ ] Serverless Framework deployment is reproducible where used.
- [ ] Important stack outputs include MCP endpoint.
- [ ] No normal deployment step requires manual console configuration.

## Security

- [ ] Auth0 protects the remote endpoint.
- [ ] AWS secrets use KMS-backed storage.
- [ ] Doppler handles local secrets/config.
- [ ] Secrets are not committed.

## Observability

- [ ] Pino structured logs exist.
- [ ] OpenTelemetry tracing exists.
- [ ] Sentry error reporting exists.
- [ ] Request correlation IDs exist.

## Testing

- [ ] Jest unit tests pass.
- [ ] Integration tests pass.
- [ ] Provider contract tests pass.
- [ ] Important mock responses are validated against OpenAPI where practical.
- [ ] Playwright smoke test passes.

## Developer experience

- [ ] Docker local environment works.
- [ ] Minimal Next.js/React demo page exists.
- [ ] README explains local setup.
- [ ] README explains AWS deployment.
- [ ] README explains MCP client connection.
- [ ] README explains mock → real Lumanu provider swap.

## Final reviewer demo

The hiring reviewer should need only:

```text
MCP URL
authentication instructions
example prompts
```

The core architectural story must be obvious:

```text
today:
MCP → LumanuProvider → MockLumanuProvider → Hasura/PostgreSQL

future:
MCP → LumanuProvider → RealLumanuProvider → Lumanu API
```
