# 09 — AWS services and what they cost

Written before anything is deployed, so the bill is a decision rather than a discovery.

Prices below are for **us-east-1**, read from AWS's public pricing pages on **2026-08-13**.
AWS changes prices; re-check before relying on these figures months from now.

## The state of the account today

Account `346380392072`, checked read-only on 2026-08-13:

| Check | Result |
| --- | --- |
| CloudFormation stacks in us-east-1 | none |
| Lambda functions in us-east-1 | none |
| Secrets Manager secrets in us-east-1 | none, and none planned — see ADR 0003 |
| Existing budget | `My Monthly Cost Budget`, $100/month |
| Spend so far this month | **$24.94** |

That last row matters. This project has deployed nothing, and the account is already spending
about $25 a month on something else. Whatever this POC costs is **on top** of that. Finding
out what the $24.94 is requires a Cost Explorer query, which is billed at $0.01 per request —
worth running once, but it is your call, not something to do silently.

## What this POC deploys

```text
Client (Claude Code)
   │  HTTPS, bearer token
   ▼
API Gateway  ──▶  Lambda (Node.js 20)  ──▶  SSM Parameter Store (+ KMS)
                       │                          
                       ├──▶ CloudWatch Logs
                       └──▶ Hasura Cloud / Supabase   ← not AWS, billed separately
```

| Service | What it does here | Billed on |
| --- | --- | --- |
| **Lambda** | Runs the MCP server. One function, invoked per request. | Requests + GB-seconds |
| **API Gateway** | The public HTTPS endpoint, `POST /mcp`. | Requests |
| **SSM Parameter Store** | Holds the Supabase URL, Hasura admin secret, Auth0 client secret as `SecureString`. | Free at standard tier |
| **KMS** | Encrypts those parameters. Uses the AWS-managed `aws/ssm` key. | Free for AWS-managed keys |
| **CloudWatch Logs** | Receives the Pino JSON log lines. | GB ingested + GB stored |
| **S3** | Artefact bucket, holding the zipped function. | GB stored + requests |
| **CloudFormation** | Creates all of the above from the Serverless config. | Free for AWS resource types |
| **IAM** | The Lambda execution role and its policies. | Free |

Supabase and Hasura Cloud are **not AWS costs**. They are billed by those vendors, on their
own free tiers for a POC of this size, and they do not appear on the AWS bill at all.

## The rates

| Service | Rate (us-east-1) | Free tier |
| --- | --- | --- |
| Lambda requests | $0.20 per 1M | 1M requests/month |
| Lambda compute | $0.0000166667 per GB-second | 400,000 GB-seconds/month |
| API Gateway — HTTP API | $1.00 per 1M | 1M/month, 12 months |
| API Gateway — REST API | $3.50 per 1M | 1M/month, 12 months |
| SSM Parameter Store, standard | **$0.00** storage and **$0.00** API calls at standard throughput | n/a — free outright |
| SSM Parameter Store, advanced | $0.05 per parameter per month | not used |
| CloudWatch Logs ingestion | $0.50 per GB | 5 GB/month |
| CloudWatch Logs storage | $0.03 per GB per month | included in the 5 GB |
| KMS, AWS-managed key | $0.00 | n/a |
| Secrets Manager (**not used** — see ADR 0003) | $0.40 per secret per month | none |
| S3 storage | about $0.023 per GB per month | 5 GB, 12 months |

**A caveat on the free tier.** AWS replaced the old free tier for accounts created after
15 July 2025 with a $200 credit usable for 6 months. If this account is newer than that date,
the 12-month allowances above do not apply the way they read, and the always-free allowances
(Lambda, CloudWatch's 5 GB) are the ones that carry. Check the account's creation date in the
Billing console before treating any 12-month figure as available.

## What it costs to run

A hiring reviewer's usage is a few hundred requests over the life of the demo. Assume a
generous 5,000 requests a month, a 512 MB function averaging 400 ms, and log volume far
under a gigabyte:

| Service | Monthly |
| --- | --- |
| Lambda (5,000 requests, ~1,000 GB-s) | $0.00 — inside the always-free allowance |
| API Gateway HTTP API (5,000 requests) | $0.01, or $0.00 on the 12-month allowance |
| CloudWatch Logs (well under 5 GB) | $0.00 |
| S3 deployment bucket (~10 MB) | $0.00 |
| KMS (AWS-managed key) | $0.00 |
| SSM Parameter Store (3 `SecureString` parameters) | $0.00 |
| **Total** | **about $0.01 a month, and $0.00 on the free tier** |

There is effectively no AWS bill. Every service in this architecture is free at this volume,
and stays free unless traffic grows by three orders of magnitude.

### Why not Secrets Manager

Secrets Manager was the original choice, and it would have been the entire AWS bill: $0.40
per secret per month with no free tier, so about $1.20 a month against a total that is
otherwise zero. Parameter Store standard parameters cost nothing to store and nothing to
read at standard throughput, and `SecureString` values are KMS-encrypted exactly as Secrets
Manager values are.

What that gives up is automatic rotation, which this POC does not use. The reasoning, and
what it would take to move back, is in
[ADR 0003](./adr/0003-ssm-parameter-store-rather-than-secrets-manager.md).

## What is deliberately not deployed, and what that avoids

These are the line items that turn a small POC into an expensive one. None of them are here.

| Not used | What it would have cost |
| --- | --- |
| **NAT Gateway** | ~$0.045/hour, about **$32/month**, plus $0.045/GB processed — running whether or not traffic flows |
| VPC, private subnets, security groups | Free in themselves, but they are what forces a NAT gateway |
| RDS or Aurora | From roughly $15/month for the smallest instance; the database is Supabase |
| ElastiCache | Not needed; the Lambda is stateless |
| ECR / Fargate | Not needed; the function is a zip, not a container |
| Route 53 hosted zone + ACM | $0.50/month per zone; the API Gateway default domain is used |
| Provisioned concurrency | Billed per GB-second continuously, even while idle |
| WAF | ~$5/month per web ACL plus per-rule and per-request charges |
| Multi-region or DR | Doubles everything |

The single most valuable line there is the NAT gateway. The decision in `docs/06` to keep the
Lambda outside a VPC — possible only because Supabase and Hasura are reached over public
HTTPS — is what keeps this a free project instead of a thirty-two-dollar one. It is by far
the largest cost decision in the architecture, and it was made by not needing a VPC.

## Three traps worth setting guards against before deploying

**CloudWatch log retention defaults to "never expire".** Ingestion is nearly free at this
volume, but storage accrues forever and is easy to forget for years. Set retention explicitly
in the Serverless config — 14 days is plenty for a POC.

**API Gateway REST costs 3.5× HTTP.** `docs/06` says only "API Gateway". For a stateless JSON
`POST /mcp` with a bearer token, an HTTP API does everything needed at $1.00/M instead of
$3.50/M. The difference is immaterial at demo volume and material at any real volume, so it
is worth choosing on purpose. REST API is only necessary here if we later want API Gateway
features the HTTP API lacks — request validation models, usage plans, or API keys.

**A failing Lambda that retries can bill a surprising amount.** Asynchronous invocations retry
twice by default. This function is synchronous behind API Gateway, so it does not apply, but
it is the usual way a small Lambda produces a large bill and worth stating.

## Tracking the cost

A $100 monthly budget already exists. Before deploying, three cheap things make this project's
share of the bill visible on its own:

1. **Tag everything.** `npm run deploy` applies stack tags to every resource it creates.
   Tagging `project=lumanu-mcp-poc` is what makes the next two steps possible.
2. **Activate the tag as a cost allocation tag** in Billing → Cost allocation tags. Until it
   is activated, Cost Explorer cannot group by it. It only applies from activation onward, so
   doing it before the first deploy is worth more than doing it after.
3. **Add a second budget scoped to that tag** — AWS gives two budgets free of charge, and one
   is already used. A $5/month budget filtered to `project=lumanu-mcp-poc` will alert long
   before this project could plausibly cost anything.

To read the spend afterwards:

```bash
# What this project cost, by service, this month. Cost Explorer bills $0.01 per request.
aws ce get-cost-and-usage \
  --time-period Start=2026-08-01,End=2026-08-31 \
  --granularity MONTHLY --metrics UnblendedCost \
  --filter '{"Tags":{"Key":"project","Values":["lumanu-mcp-poc"]}}' \
  --group-by Type=DIMENSION,Key=SERVICE
```

## Removing it entirely

The whole deployment is one CloudFormation stack, so it can be removed completely:

```bash
aws cloudformation delete-stack --stack-name lumanu-mcp-poc-prod --region us-east-1
```

That deletes the Lambda, the API Gateway, the IAM role and the log groups. Two things survive
on purpose and must be removed by hand if you want the cost to reach zero:

- **The SSM parameters**, which Serverless does not manage because they are created by hand
  before the first deploy. They cost nothing, so leaving them is harmless, but
  `aws ssm delete-parameters` removes them.
- **The artefact bucket** in S3, which holds past deployment zips. Pennies, but it lingers.

## Summary

- This POC adds effectively **nothing** — about a cent a month, and zero on the free tier.
- Every service is inside a free allowance at demo volume, and Parameter Store is free outright.
- The account already spends about **$25 a month** on something unrelated to this project.
- The expensive mistakes — NAT gateway, RDS, provisioned concurrency — are all avoided by the
  no-VPC design already recorded in `docs/06`.
