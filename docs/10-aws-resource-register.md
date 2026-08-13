# 10 — AWS resource register

Every AWS resource this project creates, what it is for, and how it is removed. Kept current
as resources are created — if something exists in the account because of this project, it
belongs in this table.

Cost is not repeated here. See [09 — AWS cost model](./09-aws-cost-model.md).

**Account:** `346380392072`  **Region:** `us-east-1`  **Stack:** `lumanu-mcp-poc-prod`

**Status legend:** `planned` — designed, not created. `live` — exists in the account.
`removed` — deleted.

Last verified against the account: **2026-08-13**.

## Created by CloudFormation

Everything here is defined in `serverless.yml`, created as one stack, and removed together
with `npx serverless remove --stage prod --region us-east-1`. None of it is created by hand.

| # | Resource | Type | Name / identifier | Purpose | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | CloudFormation stack | `AWS::CloudFormation::Stack` | `lumanu-mcp-poc-prod` | Holds every resource below. Deleting it deletes them. | planned |
| 2 | Lambda function | `AWS::Lambda::Function` | `lumanu-mcp-poc-prod-mcp` | Runs the MCP server. Node.js 20, 512 MB, 30 s timeout. | planned |
| 3 | Lambda execution role | `AWS::IAM::Role` | `lumanu-mcp-poc-prod-<region>-lambdaRole` | What the function may do: write logs, read one SSM path. Nothing else. | planned |
| 4 | Lambda log group | `AWS::Logs::LogGroup` | `/aws/lambda/lumanu-mcp-poc-prod-mcp` | Pino output. **14-day retention, set explicitly** — the default is never-expire. | planned |
| 5 | HTTP API | `AWS::ApiGatewayV2::Api` | `lumanu-mcp-poc-prod` | The public HTTPS endpoint. HTTP API, not REST — a third of the price and sufficient. | planned |
| 6 | API route | `AWS::ApiGatewayV2::Route` | `POST /mcp` | The only route. Stateless Streamable HTTP. | planned |
| 7 | API integration | `AWS::ApiGatewayV2::Integration` | AWS_PROXY → the function | Passes the request through unmodified. | planned |
| 8 | API stage | `AWS::ApiGatewayV2::Stage` | `$default` | Auto-deployed. Gives the endpoint its URL. | planned |
| 9 | Lambda permission | `AWS::Lambda::Permission` | invoke-from-apigateway | Lets the HTTP API invoke the function, and nothing else. | planned |

**Not created, deliberately:** no VPC, subnets, security groups or NAT gateway; no
authorizer resource (the token is validated inside the function, so key rotation needs no
infrastructure change); no custom domain, ACM certificate or Route 53 zone; no WAF; no DLQ;
no provisioned concurrency; no alarms.

The absence of a VPC is the single most consequential line in this document — see the
NAT gateway note in [09](./09-aws-cost-model.md).

## Created by hand, before the first deploy

These exist outside the stack because they hold secrets and must not be readable from a
committed template. They are created once and survive `serverless remove`.

| # | Resource | Type | Name | Holds | Status |
| --- | --- | --- | --- | --- | --- |
| 10 | SSM parameter | `SecureString` | `/lumanu-mcp-poc/prod/SUPABASE_DB_URL` | Supavisor session-mode connection string | planned |
| 11 | SSM parameter | `SecureString` | `/lumanu-mcp-poc/prod/HASURA_GRAPHQL_ENDPOINT` | Hasura Cloud endpoint (not secret, kept together for one read) | planned |
| 12 | SSM parameter | `SecureString` | `/lumanu-mcp-poc/prod/HASURA_ADMIN_SECRET` | Hasura admin secret | planned |
| 13 | SSM parameter | `SecureString` | `/lumanu-mcp-poc/prod/AUTH0_DOMAIN` | Auth0 tenant domain | planned |
| 14 | SSM parameter | `SecureString` | `/lumanu-mcp-poc/prod/AUTH0_AUDIENCE` | Auth0 API identifier | planned |
| 15 | KMS key | AWS-managed | `aws/ssm` | Encrypts the parameters above. Created by AWS on first use; free. | planned |
| 16 | S3 bucket | `AWS::S3::Bucket` | `serverless-framework-deployments-us-east-1-<suffix>` | Deployment artefacts. Created by Serverless on first deploy, shared across stacks, **not deleted by `serverless remove`**. | planned |

Read them back at any time — values are omitted, names only:

```bash
aws ssm get-parameters-by-path --path /lumanu-mcp-poc/prod --region us-east-1 \
  --query 'Parameters[].Name' --output table
```

## Pre-existing, not created by this project

| Resource | Note |
| --- | --- |
| Budget `My Monthly Cost Budget` | $100/month, already present. Not ours; leave it alone. |
| ~$24.94/month of existing spend | Unrelated to this project and unidentified. See [09](./09-aws-cost-model.md). |
| IAM user `msai-claude-code-cli` | The deploying identity. Not created by this project. |

## Not AWS, but part of the project's footprint

Named here so the full inventory is in one place. None of these appear on the AWS bill.

| Service | What it holds | Billed by |
| --- | --- | --- |
| Supabase | The PostgreSQL database and its seeded scenario | Supabase (free tier) |
| Hasura Cloud v2 | GraphQL over that database, internal only | Hasura (free tier) |
| Auth0 | The tenant, API and machine-to-machine application | Auth0 (free tier) |

## Verifying the register against reality

Run these to confirm the table above still matches the account. All are read-only.

```bash
REGION=us-east-1

aws cloudformation describe-stack-resources --stack-name lumanu-mcp-poc-prod --region $REGION \
  --query 'StackResources[].{Type:ResourceType,Id:PhysicalResourceId,Status:ResourceStatus}' \
  --output table

aws ssm get-parameters-by-path --path /lumanu-mcp-poc/prod --region $REGION \
  --query 'Parameters[].Name' --output table

aws logs describe-log-groups --log-group-name-prefix /aws/lambda/lumanu-mcp-poc \
  --region $REGION --query 'logGroups[].{Name:logGroupName,Retention:retentionInDays}' \
  --output table
```

The log-group retention column is worth checking specifically: a `null` there means
never-expire, which is the one setting in this stack that quietly accrues cost forever.

## Removing everything

```bash
# 1. The stack: function, role, log group, HTTP API, routes, permissions.
npx serverless remove --stage prod --region us-east-1

# 2. The parameters, which the stack does not own.
aws ssm delete-parameters --region us-east-1 --names \
  /lumanu-mcp-poc/prod/SUPABASE_DB_URL \
  /lumanu-mcp-poc/prod/HASURA_GRAPHQL_ENDPOINT \
  /lumanu-mcp-poc/prod/HASURA_ADMIN_SECRET \
  /lumanu-mcp-poc/prod/AUTH0_DOMAIN \
  /lumanu-mcp-poc/prod/AUTH0_AUDIENCE

# 3. The Serverless deployment bucket, if nothing else uses it. Costs pennies; check first.
aws s3 ls | grep serverless-framework-deployments
```

After step 1, confirm nothing is left:

```bash
aws cloudformation describe-stacks --stack-name lumanu-mcp-poc-prod --region us-east-1
# Expected: "Stack with id lumanu-mcp-poc-prod does not exist"
```
