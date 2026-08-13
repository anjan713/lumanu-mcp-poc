---
status: accepted
---

# SSM Parameter Store rather than Secrets Manager

Runtime secrets — the Supabase connection string, the Hasura admin secret, the Auth0 client
secret — are stored as SSM Parameter Store `SecureString` parameters under a single path,
not as Secrets Manager secrets. Earlier documents named Secrets Manager; this supersedes
them.

We changed because Secrets Manager was the entire AWS bill for this project and Parameter
Store does the same job here for nothing. Secrets Manager charges $0.40 per secret per month
with no free tier, so three secrets cost about $1.20 a month while every other service in the
architecture sat inside a free allowance. Parameter Store standard parameters are free to
store and free to read at standard throughput, and `SecureString` values are encrypted with
KMS exactly as Secrets Manager values are. See [09 — AWS cost model](../09-aws-cost-model.md).

The security properties that matter here are unchanged: values are KMS-encrypted at rest,
never committed, read at runtime by the Lambda's execution role, and scoped by an IAM policy
to one parameter path. A reviewer asking "are secrets read from AWS at runtime rather than
committed?" gets the same answer either way.

## What we give up

**Automatic rotation.** Secrets Manager can rotate a credential on a schedule via a Lambda.
Parameter Store cannot. This POC rotates nothing — the Supabase and Hasura credentials are
long-lived and rotated by hand at the vendor — so the feature we are giving up is one we
were never going to use. If rotation becomes a requirement, moving back is a change to one
module and one IAM policy, because nothing above `loadDataLayerConfig` knows where the values
came from.

**Cross-account sharing and resource policies.** Secrets Manager supports both; Parameter
Store standard does not. Irrelevant to a single-account POC.

**The 4 KB value limit** on standard parameters. Every value here is a connection string or a
client secret, far below it. A value that grew past 4 KB would need the advanced tier, which
costs $0.05 per parameter per month — still an eighth of Secrets Manager.

## Consequences

The stack description in `CLAUDE.md`, `docs/06` and the spec previously said "AWS Secrets
Manager with KMS-backed encryption". Those have been corrected rather than left to
contradict the code, since a reviewer reading the docs and then the IAM policy would
otherwise find a discrepancy and have no way to tell which was intended.

KMS still appears in the architecture, and is still free: `SecureString` uses the
AWS-managed `aws/ssm` key. A customer-managed key would cost $1 a month and buy nothing at
this scale.

Reads happen once per Lambda container rather than once per request, so a warm container
makes no SSM calls at all. That matters less for cost — standard throughput is free — than
for latency and for staying clear of the account-wide throughput limit.
