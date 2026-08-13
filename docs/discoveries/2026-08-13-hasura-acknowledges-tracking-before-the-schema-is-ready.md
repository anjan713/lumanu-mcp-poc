# Hasura acknowledges table tracking before the GraphQL schema is ready

## Summary

We assumed that once Hasura's metadata API returns success for `pg_track_table`, the table is
queryable over GraphQL. It is not. The metadata call succeeds first and the GraphQL schema is
rebuilt shortly after, so a query issued immediately fails validation as though the table had
never been tracked. The fix is to retry the query, not to assume the tracking failed.

## What we found

The smoke test creates a table over the direct PostgreSQL connection, tracks it in Hasura,
then reads it back through GraphQL to prove Hasura is pointed at that same database.

`pg_track_table` returned `{"message": "success"}`. The GraphQL query issued straight
afterwards returned:

```json
[{
  "message": "field 'lumanu_mcp_smoke_probe' not found in type: 'query_root'",
  "extensions": { "path": "$.selectionSet.lumanu_mcp_smoke_probe", "code": "validation-failed" }
}]
```

Running the same query by hand a few seconds later succeeded and returned the row. Nothing
had been retried or re-tracked in between.

## Why it matters

The error names the wrong problem. `field not found in query_root` is what you also get when
tracking genuinely failed, when the table is in another schema, or — the one that matters
here — when Hasura is connected to a different database than the one you just wrote to.

That last reading is exactly what the smoke test exists to detect. So the first run of the
smoke test reported the failure it was designed to report, and the report was wrong. Time
went into checking the source configuration, which was correct all along.

Any script that tracks a table and then uses it is exposed to this: migrations, the tracking
script, and anything that adds a table at runtime.

## Details

The original assumption was that the metadata API is synchronous in effect as well as in
response — that success means the change is fully applied. For the database side of the
change that is true; the table is tracked in Hasura's metadata immediately. What lags is the
derived artefact: the GraphQL schema Hasura builds from that metadata and serves to clients.

What caused us to question it was the inconsistency between two runs. The failing smoke test
and a manual query minutes later disagreed, with no change in between. A configuration fault
does not heal on its own.

The corrected understanding:

- **The metadata API and the GraphQL schema are eventually consistent.** Success from
  `/v1/metadata` means the metadata is accepted, not that `/v1/graphql` reflects it yet.
- A `validation-failed` / `not found in type` error immediately after a tracking call is
  most likely this lag, and should be retried before it is diagnosed as anything else.
- The lag is short — under a second in practice — but it is long enough to lose a race with
  the very next statement.

The retry is bounded and matches only this error, so a genuine misconfiguration still fails
promptly rather than being retried ten times and then reported. It costs nothing in the
common case, where the schema has already been rebuilt and the first attempt succeeds.

A second, unrelated fault surfaced during the same investigation and is worth recording
alongside it, because together they made one failure look like two. The probe table was
created with `create table if not exists`. An earlier interrupted run had left a table of the
same name with a different column list, so the create silently did nothing and the insert
failed with `column "note" does not exist` — again reading like a connection problem. A probe
that is disposable by design should be dropped and rebuilt, not created-if-absent.

## How we verified it

Observed directly, twice. The first smoke-test run failed on the GraphQL read after a
successful track; a manual query of the same table minutes later returned data with no
intervening change.

`export_metadata` confirmed the source was correct throughout — same host, same database,
same session-mode port as the direct connection — which ruled out the misconfiguration the
error message suggested.

After adding the bounded retry, `npm run db:smoke` passes and is repeatable:

```
ok    Supabase reachable on the session-mode pooler — PostgreSQL 17.6 on x86_64-pc-linux-gnu
ok    Hasura Cloud reachable with the admin secret — GraphQL schema served
ok    Hasura is pointed at this same database — read the probe row written over the direct connection
```

## Resulting decision

> After a metadata change, a GraphQL query for the newly tracked table is retried on
> `not found in type` for a bounded number of attempts. The probe table is dropped and
> recreated rather than created-if-absent, so a leftover from an interrupted run cannot
> masquerade as a connection fault.

## Related files

- `scripts/db/smoke-test.ts` — `untilSchemaCatchesUp`, and the drop-then-create probe
- `scripts/db/hasura-track.ts` — tracks tables and relationships
- `README.md` — what the three smoke-test checks prove
