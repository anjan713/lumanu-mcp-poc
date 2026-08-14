# Grouping configuration by topic, not by consumer, put a database password into AWS

## Summary

We had one function, `loadDataLayerConfig`, returning three mandatory values: the Supabase
connection string, the Hasura endpoint, and the Hasura admin secret. The deployed MCP server
called it. The deployed MCP server uses only two of those three — it reaches the seeded data
over GraphQL and never opens a PostgreSQL socket.

The consequence was not a wasted variable. It was a database password that had to be created
in AWS SSM Parameter Store to satisfy a validation check rather than a caller. The
configuration group had been drawn around a *topic* — "the data layer" — instead of around a
*consumer*, and in a system where configuration becomes stored credentials, that turns a
naming choice into a security surface.

## What we found

`MockLumanuProvider` reads exactly two fields from its config:

```ts
uri: new URL('/v1/graphql', config.hasuraEndpoint).toString(),
headers: { 'x-hasura-admin-secret': config.hasuraAdminSecret },
```

`config.databaseUrl` appears nowhere in that file. Yet `createProvider` called
`loadDataLayerConfig()`, which does this:

```ts
databaseUrl: parseDatabaseUrl(required(env, 'SUPABASE_DB_URL')),
```

`required` throws when the value is absent or empty. So the Lambda could not cold-start
without a connection string it would never open.

Because the deployed function reads its environment from SSM Parameter Store, "the Lambda
requires this variable" and "this value must be stored in AWS" are the same statement. The
register in `docs/10` therefore listed five parameters, one of which was a PostgreSQL URL
containing the Supabase password.

The real consumers of `databaseUrl` are `scripts/db/connect.ts`, `scripts/db/smoke-test.ts`
and the migrate/seed scripts. All of them speak SQL, which Hasura deliberately does not
expose. All of them run from a developer machine against a gitignored `.env`. None of them
run in AWS.

## Why it matters

Three consequences, in increasing order of seriousness.

**The deploy would have failed at the first request, not at deploy time.** Had we created only
the four parameters the function genuinely needs, CloudFormation would have reported success
and the first `POST /mcp` would have returned 500 with a `ConfigError` about a value nothing
was going to use.

**It widened the credential footprint for no benefit.** The Supabase password would have
existed in a second system, with a second set of access controls and a second thing to rotate,
purely because of how a TypeScript interface had been grouped.

**It was invisible to the type system and to the tests.** Every test passed. `tsc` was happy.
`DataLayerConfig` is a superset of what the provider needs, so passing it where a narrower type
would do is perfectly legal — structural typing has nothing to say about a field being unused.
The only signal was someone reading the resource register and asking why a GraphQL client
needed a database URL.

## Details

The original assumption was that "configuration the mock data layer needs" was a coherent
group. It reads well, and for a while it was true: when the config module was written, the
scripts and the provider were the only consumers and both were local, so the distinction cost
nothing.

Deployment is what made the grouping wrong. Once one consumer moved into Lambda and the other
stayed on a laptop, they stopped having the same needs, and the union of their needs became
the deployed function's requirement.

The file's own comment had already made the correct argument one level up:

> only `MockLumanuProvider` and the database scripts need it: the MCP server running against
> `RealLumanuProvider` has no database at all, and should not fail to start over a connection
> string it will never open.

That reasoning is exactly right, and it applies just as well to the mock provider. We had
drawn the line between `real` and `mock` when it also needed drawing between *the provider*
and *the scripts*.

The subtle distinction worth remembering: `MockLumanuProvider` is not the mock *server*, and
Hasura is not the mock *API*. `MockLumanuProvider` is code inside the Lambda that turns
database rows into exact Lumanu wire format. Hasura is a GraphQL read layer beneath it,
internal only. The Lambda's dependency is on Hasura, not on PostgreSQL, and the configuration
should say so.

**How the system behaves now.** `loadHasuraConfig` returns the two values the provider uses,
and is what `createProvider` calls. `loadDataLayerConfig` extends it with `databaseUrl` and is
called only by the `scripts/db/*` tools. The Supavisor session-mode port check (ADR 0002) stays
on the database branch, where every caller that opens a socket still passes through it.

**What this does not fix.** The Hasura admin secret is functionally equivalent to full database
access — see [the Hasura export discovery](./2026-08-13-hasura-export-contains-database-password.md).
Removing the connection string reduces what is *stored* in AWS, not what an attacker holding
the remaining secret could *reach*. This is a least-privilege and correctness fix, not a
blast-radius reduction, and describing it as the latter would be overclaiming.

## How we verified it

A test at the wiring seam rather than the config seam, because the config function was never
wrong — the call site was:

```ts
it('needs no database connection string, because nothing here opens one', () => {
  expect(process.env['SUPABASE_DB_URL']).toBeUndefined();
  expect(() => createProvider(loadConfig({}))).not.toThrow();
});
```

Confirmed by replicating the defect: reverting `createProvider` to `loadDataLayerConfig` turns
that test red with the original `ConfigError`, and restoring it turns it green. Without that
mutation check the test would have been indistinguishable from one that passes because it
asserts nothing — the same failure mode recorded in
[the OpenAPI drift note](./2026-08-12-openapi-validation-misses-field-renames.md).

Also verified by reading `MockLumanuProvider` for every use of `config.` — two fields, both
Hasura.

## Resulting decision

Configuration is grouped by **who reads it**, not by **what it is about**. `loadHasuraConfig`
serves the provider; `loadDataLayerConfig` serves the database scripts and extends it.

The deployed environment holds four SSM parameters — `HASURA_GRAPHQL_ENDPOINT`,
`HASURA_ADMIN_SECRET`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`. `SUPABASE_DB_URL` stays in the
gitignored `.env` and never enters AWS.

The general rule this project now follows: **a mandatory configuration value is a stored
credential.** Before adding a field to a config group that a deployed component loads, check
that the component actually reads it.

## Related files

- `src/config/index.ts`
- `src/providers/index.ts`
- `src/providers/mock.ts`
- `tests/provider-selection.test.ts`
- `tests/config.test.ts`
- `docs/10-aws-resource-register.md`
- `docs/adr/0003-ssm-parameter-store-rather-than-secrets-manager.md`
