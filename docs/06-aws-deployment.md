# 06 — Deployment

## Goal

A hiring reviewer connects an MCP client to a public, authenticated endpoint. Nothing runs
locally.

## Runtime architecture

```text
Claude Code
      ↓  Authorization: Bearer <Auth0 JWT>
  API Gateway
      ↓
    Lambda  (Node.js 20)
      ↓
  MCP Server  (stateless Streamable HTTP)
      ↓
 Domain Services
      ↓
 LumanuProvider
      ↓
MockLumanuProvider
      ↓
  Apollo Client
      ↓
Hasura Cloud v2
      ↓
Supabase PostgreSQL
```

## The data layer is not in AWS

Supabase hosts PostgreSQL; Hasura Cloud v2 hosts the GraphQL layer. Both are reached from
Lambda over public HTTPS.

> This supersedes an earlier plan for an AWS-hosted database. The reason is not only cost:
> Lumanu's own API runs on Hasura Cloud over a managed PostgreSQL, so hosting the mock's
> data layer the same way is faithful rather than expedient.

The consequence is that **no VPC is required** — no private subnets, no security groups, no
NAT gateway. It also means the Hasura endpoint is on the public internet, so the rule that
Hasura is never exposed to MCP clients is a security boundary, not a style preference.

Supabase is connected via the Supavisor **session-mode** pooler on port 5432. Not the
direct `db.<ref>.supabase.co` host, which may be IPv6-only; and not transaction mode on
6543, which breaks the prepared statements Hasura uses by default.

## AWS components

- API Gateway
- Lambda (Node.js 20)
- IAM
- CloudWatch
- SSM Parameter Store, KMS-encrypted `SecureString` (ADR 0003)
- AWS KMS

Region: `us-east-1`.

What each of these costs, and how to keep the bill visible, is in
[09 — AWS cost model](./09-aws-cost-model.md). The short version: about $1.20 a month, all
of it Lambda and API Gateway inside their free allowances, because the no-VPC design avoids
the NAT gateway that would otherwise
dominate the bill.

## Infrastructure as code

A committed CloudFormation template describes Lambda, API Gateway and supporting
resources. These are not competing requirements:

```text
infra/cloudformation.yml
   ↓
CloudFormation
   ↓
Lambda + API Gateway + IAM + Secrets
```

No normal deployment step requires console configuration. Stack outputs include:

```text
McpEndpoint
Environment
Region
```

`FrontendUrl` is no longer an output — there is no frontend.

## Workflow

```text
npm install
npm run generate     # GraphQL Codegen + Lumanu OpenAPI types
npm run test
npm run deploy
```

## One-time human setup

These cannot be automated and gate the build:

1. Supabase project → Supavisor session-mode connection string
2. Hasura Cloud v2 project → connected to Supabase, admin secret
3. Auth0 tenant → an API (the audience) and a machine-to-machine application
4. AWS credentials for `us-east-1`

Steps 1–2 should be smoke-tested — track one table, run one query — before any schema work.
It is the least certain step in the build. If it resists, the fallback is self-hosted
Hasura v2 CE, which changes nothing above the provider boundary.

Proving an empty stack deploys is worth doing equally early; first-deploy IAM surprises are
common and expensive at the end of a day.

## Deliberately out of scope for the one-day POC

Not partially implemented — a half-wired integration is worse than an absent one. Each is
named in the README with a line on how it would be added.

- **Next.js / React status page** — the deliverable is an MCP URL, not a dashboard
- **Local Docker environment** — development runs against Supabase and Hasura Cloud directly; maintaining two topologies costs more than it returns
- **Doppler** — `.env.example` locally, SSM Parameter Store in AWS
- **OpenTelemetry** — Pino structured logs carry correlation ids instead
- **Sentry**
- **Playwright** — there is no frontend to smoke-test
