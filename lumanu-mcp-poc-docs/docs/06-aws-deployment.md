# 06 — AWS Deployment

## Main goal

The hiring team must be able to connect an MCP client to a public remote endpoint.

## Runtime architecture

```text
Claude Code / MCP Client
          ↓
      Auth0/OAuth
          ↓
      API Gateway
          ↓
       Lambda
          ↓
     MCP Server
          ↓
    Domain Services
          ↓
    LumanuProvider
       ↓
 MockLumanuProvider
       ↓
   Hasura GraphQL
       ↓
    PostgreSQL
```

## AWS components

Use as appropriate:

- API Gateway
- AWS Lambda
- IAM
- CloudWatch
- AWS KMS
- Secrets Manager or SSM
- PostgreSQL-compatible AWS database
- networking/security groups if required
- runtime for Hasura

## CloudFormation

CloudFormation is the infrastructure foundation.

Do not rely on manual console configuration as the normal deployment path.

Infrastructure should be reproducible.

## Serverless Framework

Serverless Framework can be used for Lambda/API packaging and can generate CloudFormation for the serverless portion.

Do not treat Serverless Framework and CloudFormation as competing requirements.

Suggested model:

```text
Serverless Framework
   ↓
CloudFormation
   ↓
Lambda + API Gateway + supporting resources
```

Use direct CloudFormation templates/stacks for resources that are cleaner to manage separately.

## Required outputs

CloudFormation should expose useful outputs such as:

```text
McpEndpoint
FrontendUrl
Environment
Region
```

## Desired workflow

Aim for something close to:

```text
npm install
npm run generate
npm run test
npm run deploy
```

## Node/runtime

Use:

```text
TypeScript
Node.js 20
AWS Lambda Node.js runtime
```

## Docker

Provide local Docker Compose.

Ideally:

```text
docker compose up
```

starts:

- PostgreSQL
- Hasura
- local MCP server
- optional Next.js demo

## Next.js + React

The frontend is secondary.

Build only a minimal status/demo page:

```text
Lumanu MCP POC

MCP status: online
Provider: mock
Workspace: Acme US
Wallet: $15,000

MCP endpoint:
https://...

Example prompts:
...
```

Do not turn the project into a dashboard exercise.
