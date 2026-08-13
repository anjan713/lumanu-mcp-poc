# A script that runs on import nearly let a test wipe the database

## Summary

The seed script starts its work at module scope, which is normal for a script you run from
the command line. We then wanted to unit-test the generator inside it. Importing the module
to reach that generator would have executed the seed — truncating and rewriting the live
Supabase database on every `npm test`. The generator was moved into a module that does
nothing when loaded.

## What we found

`scripts/db/seed.ts` ends with a call at module scope:

```ts
run(async () => {
  const { client } = await connect();
  await client.query(`truncate ${TABLES_NEWEST_FIRST.join(', ')} cascade`);
  ...
});
```

That is correct for an entry point. `npm run db:seed` loads the file and the work happens.

The generator that produces the extra Faker Partners and Payables originally lived in the
same file. Testing it meant `import { generateTexture } from '../scripts/db/seed'`, and an
import in JavaScript executes the module body. Jest would therefore have run `truncate ...
cascade` against whatever database `.env` pointed at, every time the suite ran.

Nothing warns about this. The import looks ordinary, the type checker is satisfied, and the
test would have passed — after destroying the data it was not looking at.

## Why it matters

The blast radius is the whole seeded scenario, and the trigger is the most routine command in
the project. Anyone running `npm test` with a populated `.env` would have wiped Acme US, and
the test output would have been green.

It would also have been slow and confusing to diagnose: the symptom is "my data keeps
disappearing", and the cause is an import statement in an unrelated test file.

## Details

The original assumption was the ordinary one — a function is a function, so put it where it
is used and import it when you need it elsewhere. That holds for pure modules. It does not
hold for a module whose top level *is* the program.

What caused us to catch it was writing the import line and stopping at it, before running the
test. The hazard is visible only if you think about what loading the module does, because
nothing in the tooling flags it.

The corrected understanding, and the rule now followed:

- **An entry point does work at module scope. A library does not.** Do not put both in one
  file.
- A file with a module-scope call is not importable. Treat the presence of `run(...)`,
  `main()` or any top-level side effect as a signal that the file can only be executed.
- Pure logic worth testing goes in its own module, which the entry point imports. That is
  the direction the dependency must run: entry point → library, never the reverse.

`scripts/db/texture.ts` now holds the generator and exports it. It declares constants and a
function, and does nothing on load. `scripts/db/seed.ts` imports it and remains the entry
point.

The same shape already existed elsewhere and is worth noticing for the same reason:
`scripts/lib/harvest.ts` holds the pure parsing and stitching logic, and
`scripts/harvest-lumanu-contract.ts` is the entry point that fetches and writes. The
contract-harvest tests import the library, never the entry point. Ticket 02 got this right by
accident of structure; ticket 03 nearly got it wrong.

A related consequence, which is why the fix was worth more than a comment: the test that now
exists guards the constraint that generated texture can never enter the ready-to-fund total.
That test is only possible because the generator can be imported safely.

## How we verified it

Confirmed by reading the module structure rather than by triggering the fault — deliberately
running a database-destroying import to prove it destroys the database is not a useful
experiment.

```
$ grep -n "^run(" scripts/db/seed.ts
58:run(async () => {

$ grep -n "^run(\|^main(" scripts/db/texture.ts
(no matches)
```

`tests/seed-texture.test.ts` imports `scripts/db/texture` and runs with no credentials and no
database connection. The suite passes on a clone with no `.env`.

## Resulting decision

> Logic that a test needs lives in a module with no module-scope side effects. Command-line
> entry points import that module and are never imported themselves. `scripts/db/seed.ts` is
> the entry point; `scripts/db/texture.ts` is the importable generator.

## Related files

- `scripts/db/seed.ts` — the entry point, runs on load
- `scripts/db/texture.ts` — the importable generator
- `tests/seed-texture.test.ts` — imports the generator, touches no database
- `scripts/lib/harvest.ts` and `scripts/harvest-lumanu-contract.ts` — the same split
