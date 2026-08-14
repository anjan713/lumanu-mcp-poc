# Hasura only tracks a function that returns a table

## Summary

The write functions were first written to return a composite type — a `create type
write_outcome as (...)` naming exactly the fields the provider needed. Hasura refused to track
any of them, so none could be called over GraphQL, and the whole design of routing writes
through PostgreSQL functions was briefly in doubt.

The fix is small once known: return `setof` a real table, and create a table whose only purpose
is to be that return shape.

## What we found

`pg_track_function` fails outright:

```
Inconsistent object: in function "approve_payable": the function "approve_payable"
cannot be tracked because the function does not return a table
```

Hasura v2 will track a function returning `setof <tracked table>`. It will not track one
returning a composite type, a base type, or a scalar, however well-defined that type is — the
return type has to be a table Hasura already knows about.

So the migration creates one:

```sql
create table write_outcomes (
  outcome    text not null,
  detail     text,
  subject    text,
  state      text,
  required   bigint,
  available  bigint,
  funding_id uuid,
  payable_id uuid
);
```

No row is ever inserted into it. It exists so that `returns setof write_outcomes` is legal, and
it is tracked alongside the eight real tables so that Hasura will accept the functions.

## Why it matters

Without this, the writes could not go through Hasura at all, and the alternatives were both
bad. Calling PostgreSQL directly from the Lambda would have put a second data path beside the
one every read uses and made the admin secret no longer the only credential in play. Falling
back to Hasura mutations would have meant giving up atomicity, which is the entire reason the
functions exist — see [ADR 0005](../adr/0005-funding-is-a-postgresql-function.md).

The wider point is about how the constraint was found. It is not in the shape of the problem
and not derivable from the SQL: a composite type is the obviously correct return type for
"tell me what happened", and it works perfectly in `psql`. The constraint lives entirely in
Hasura's tracking rules, and the only way to learn it was to try.

## Details

The original assumption was that Hasura's function support was about *invocation* — that
anything callable in SQL would be callable over GraphQL, with the return type mapped
automatically. It is really about *schema*: Hasura builds its GraphQL types from tracked
tables, so a function's return type has to already be one of them.

Two consequences follow that are easy to forget later:

**The table shape and the function's `return query` must agree exactly**, in column order and
type. `return query select 'ok'::text, null::text, ...` positions values by ordinal, not by
name, so adding a column to `write_outcomes` without updating every `return query` in the file
produces a runtime error rather than a compile-time one. Every literal in the migration is cast
explicitly for the same reason.

**The table is visible to a reader of the schema** and looks like a real one. It is commented
in the migration and in `scripts/db/hasura-track.ts`, because a table that is never written to
otherwise reads as an oversight.

The functions are also marked `volatile`, which is what makes Hasura expose them as mutations
rather than queries. A `stable` function returning the same shape would appear under
`query_root` and read as a lookup.

## How we verified it

A one-off probe against the real Hasura metadata API, before committing to the design:

```
pg_track_function { function: { schema: 'public', name: 'approve_payable' } }
→ 400: the function "approve_payable" cannot be tracked because it does not return a table
```

After rewriting the migration to return `setof write_outcomes` and tracking the table,
`npm run hasura:track` reports `exposed 3 write functions as mutations`, and the full contract
suite — 76 tests including every write assertion — passes against the live database.

## Resulting decision

The write functions return `setof write_outcomes`, and `write_outcomes` is a tracked table that
never holds a row. It is created in `db/migrations/0002_write_functions.sql` and tracked in
`scripts/db/hasura-track.ts`, both with a comment saying what it is for.

## Related files

- `db/migrations/0002_write_functions.sql`
- `scripts/db/hasura-track.ts`
- `src/providers/mock.ts`
- `docs/adr/0005-funding-is-a-postgresql-function.md`
