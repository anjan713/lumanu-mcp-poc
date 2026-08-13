# Hasura's metadata export contains the database password

## Summary

We planned to commit Hasura's exported metadata so the Hasura project can be rebuilt from
the repository. The export turned out to include each source's full connection string, with
the Supabase password in clear text. Committing it unmodified would have put a live database
password in Git history. The export is now stripped of source configuration before it is
written.

## What we found

`POST /v1/metadata` with `{"type": "export_metadata", "version": 2}` returns every source's
`configuration` block, and that block carries `connection_info.database_url` in full:

```json
{
  "sources": [{
    "name": "default",
    "kind": "postgres",
    "tables": [ ... ],
    "configuration": {
      "connection_info": {
        "database_url": "postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
        "isolation_level": "read-committed",
        "use_prepared_statements": false
      }
    }
  }]
}
```

The password is not masked, hashed or referenced indirectly. It is the same string that
`SUPABASE_DB_URL` holds in the gitignored `.env`.

There is a second consequence, separate from the commit. Anyone holding the Hasura admin
secret can make this request and read the database password. The admin secret is therefore
not only a Hasura credential — it is also a Supabase credential.

## Why it matters

`hasura/metadata.json` is committed on purpose, so that the Hasura project is reproducible.
That is the right decision. But the naive version of it — export, write to file, commit —
publishes a database password to every clone and to the whole of Git history, where deleting
it later does not remove it.

The failure is silent. The export succeeds, the file looks like configuration, and nothing
warns that a credential is inside it.

## Details

The original assumption was that metadata describes *shape* — which tables are tracked, what
the relationships are called — and that connection details live elsewhere, in the Hasura
project's own settings. That is how the Hasura Console presents it: you configure a data
source once in the UI, and afterwards you work with tables and relationships.

The export does not maintain that separation. It returns the source definition whole, and
the source definition is the connection.

What caused us to look was reading the export before writing it to disk, while adding the
tracking script. The connection string was the second field in the response.

The corrected understanding has two parts, and the second is easy to forget:

1. **The exported metadata is not safe to commit as-is.** Strip `configuration` from every
   source. What remains — `name`, `kind`, `tables` — is the reproducible part, and it is all
   the repository needs.
2. **The Hasura admin secret is a Supabase credential.** Treat its exposure as exposure of
   the database password too. If the admin secret leaks, rotating it is not enough; the
   database password must be rotated as well.

An unrelated detail worth keeping from the same response: the source is configured with
`use_prepared_statements: false`. Our documentation says the Supavisor session-mode pooler is
required *because* Hasura uses prepared statements by default. That reasoning still holds as
the general rule, but this particular project has them turned off, so session mode is
belt-and-braces here rather than strictly load-bearing. We did not change it — the
requirement is real for a default Hasura configuration, and matching the documented setup is
worth more than saving a port number.

## How we verified it

Read directly from the live `export_metadata` response while building
`scripts/db/hasura-track.ts`. The password returned matched the one in `.env`.

After adding the stripping step, the written file was searched for the password, the pooler
host name and the string `database_url`:

```
$ grep -ciE "password|database_url|pooler" hasura/metadata.json
0
```

The remaining source keys are `name`, `kind`, `tables` — confirmed by reading the committed
file back. Eight tables and eighteen relationships survive the strip, which is everything
needed to rebuild the project.

## Resulting decision

> `scripts/db/hasura-track.ts` deletes `configuration` from every source before writing
> `hasura/metadata.json`. The committed metadata describes tracked tables and relationships
> only, never how to connect. The Hasura admin secret is treated as equivalent in
> sensitivity to the Supabase password, because it yields it.

## Related files

- `scripts/db/hasura-track.ts` — the export and the strip
- `hasura/metadata.json` — the committed result
- `.env.example` — documents `HASURA_ADMIN_SECRET` and `SUPABASE_DB_URL`
- `docs/adr/0002-hasura-cloud-v2-over-ddn.md` — the session-mode pooler requirement
