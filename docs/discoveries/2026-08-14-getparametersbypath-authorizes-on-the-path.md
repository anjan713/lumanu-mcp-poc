# `GetParametersByPath` authorizes on the path, not on the parameters under it

## Summary

The Lambda's IAM policy granted `ssm:GetParametersByPath` on
`parameter/lumanu-mcp-poc/prod/*` — the parameters beneath the path. Every cold start failed
with `AccessDeniedException` on that exact action, on a policy that visibly granted it. The
cause is that `GetParametersByPath` is authorized against **the path being queried**, which is
a different ARN with no trailing `/*`. The policy now lists both.

A second defect hid the first: the handler logged the failure through an optional logger that
only exists once the runtime has been built, so the one error that reliably prevents the
runtime from building produced a 500 with an entirely empty log stream.

## What we found

The policy read:

```yaml
Action: [ssm:GetParametersByPath, ssm:GetParameters, ssm:GetParameter]
Resource: !Sub 'arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter${SsmParameterPath}/*'
```

which expands to `arn:aws:ssm:us-east-1:<account>:parameter/lumanu-mcp-poc/prod/*`.

The denial named a different resource:

```
User: arn:aws:sts::<account>:assumed-role/lumanu-mcp-poc-prod-lambda-role/lumanu-mcp-poc-prod-mcp
is not authorized to perform: ssm:GetParametersByPath
on resource: arn:aws:ssm:us-east-1:<account>:parameter/lumanu-mcp-poc/prod
```

No `/*`. IAM was evaluating the request against the **path**, and the policy said nothing
about the path — only about its children. The three actions in that one statement do not
share a resource shape:

| Action | Authorized against |
| --- | --- |
| `GetParameter`, `GetParameters` | each parameter — `…:parameter/lumanu-mcp-poc/prod/HASURA_ADMIN_SECRET` |
| `GetParametersByPath` | the path — `…:parameter/lumanu-mcp-poc/prod` |

Both ARNs are now listed, and the deployment came up on the next attempt.

## Why it matters

This is invisible from every angle except a real deployment.

The policy reads correctly. The action is granted, the path is right, the wildcard looks like
the obvious way to cover parameters underneath. Nothing in the template, the types, or any
local test can distinguish it from a working policy — the failure exists only in IAM's
evaluation, and only at runtime, in AWS.

It is also the *first* thing a deployment does. `loadSecrets()` runs before configuration is
parsed, before the provider is built, before a token is validated. So the symptom is total:
every request returns 500, including unauthenticated ones, because the runtime never finishes
building.

## Details

The original assumption was that a wildcard under a path covers operations on the path. That
holds for many AWS resource hierarchies and it does not hold here. `GetParametersByPath` takes
the path as its argument, so the path is the resource; the parameters it returns are results,
not the thing being authorized.

What made this take longer than it should have was the second defect, in the handler:

```ts
let log: Logger | undefined;
try {
  const { logger, provider, verifyToken, config } = supplied ?? (await getRuntime());
  log = forRequest(logger, { request_id: requestId });
  …
} catch (error) {
  log?.error({ … }, 'request failed');   // log is undefined here
  return jsonRpcError(500, 'Internal error. See server logs for the request id above.', requestId);
}
```

`logger` is one of the things `buildRuntime()` returns. So when `buildRuntime()` throws, `log`
is still `undefined`, `log?.error` does nothing, and the caller is handed a 500 whose message
tells them to go and read logs that do not exist. The log stream contained `START`, `END` and
`REPORT` and not one application line.

That is the wrong way round. The failures that happen *before* the logger exists — a missing
secret, a denied SSM read, an unrecognised provider — are precisely the failures a fresh
deployment hits, and they were the only ones that could not be seen. The catch now falls back
to `console.error` with the same structured fields, which reaches CloudWatch regardless.

Adding that fallback surfaced the IAM error on the very next invocation.

The general lesson is narrower than "log more": **an error handler must not depend on
something that the failing code was responsible for constructing.** The logger came from the
runtime, and the runtime was what failed.

## How we verified it

Deploying, invoking, and reading CloudWatch — there is no other way to reach this.

1. Deployed. `POST /mcp` returned 500 both with and without a token. Log stream empty.
2. Added the `console.error` fallback in the catch, redeployed, invoked again. The log stream
   then carried the `AccessDeniedException` above, naming the resource ARN without `/*`.
3. Added the path ARN to the policy, redeployed, and the same request returned a valid MCP
   `initialize` result. An unauthenticated request returned 401, as it should have all along.
4. Ran the full demo flow against the deployed endpoint: the blocker for Alex, the approval,
   funding Maya and Alex for $10,000, the balance falling to $5,000, a retry returning the
   same Funding rather than debiting twice, and cancelling a funded Payable being refused as
   `invalid_state`.

## Resulting decision

> The execution-role policy lists **both** the path ARN and the `/*` ARN for the parameter
> statement, because `GetParametersByPath` and `GetParameter` authorize against different
> resources.
>
> The Lambda's error handler logs through `console.error` when the runtime failed to build,
> because the configured logger is part of the runtime that failed.

## Related files

- `infra/cloudformation.yml` — the `read-own-parameters` policy, and the comment explaining the two ARNs
- `src/lambda/handler.ts` — the fallback in the catch block
- `src/config/secrets.ts` — `SsmParameterReader.byPath`, the call being authorized
