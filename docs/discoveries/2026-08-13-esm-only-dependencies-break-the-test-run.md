# ESM-only dependencies do not load in this project's tests

## Summary

We added `@faker-js/faker` and got version 10, which ships ES modules only. This project
compiles to CommonJS, and Jest could not load the library at all — the test suite failed
before running a single assertion. Faker is pinned to version 9, which ships both formats.
The wider point is that any new dependency has to be checked for a CommonJS build before it
is adopted.

## What we found

`npm install @faker-js/faker` resolved to 10.5.0, whose `package.json` declares
`"type": "module"` and exports one entry point with no `require` condition:

```json
{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
```

Jest, running ts-jest with `module: "commonjs"`, failed on import:

```
SyntaxError: Cannot use import statement outside a module
  at Object.<anonymous> (scripts/db/texture.ts:15:1)
```

Version 9.9.0 keeps a `require` condition alongside the ESM one:

```json
{ ".": {
    "default": { "types": "./dist/index.d.ts",  "default": "./dist/index.js"  },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" } } }
```

With 9.9.0 the same import works unchanged.

## Why it matters

The failure is total rather than partial: the suite cannot run, so it cannot tell you
anything about the rest of the system. It also looks like a configuration fault in the
project rather than a property of the dependency, which sends you to `jest.config.js` and
`tsconfig.json` first — both of which are fine.

The cost of the wrong fix is high. Converting the project to ESM to satisfy one library
would change the module format of every file, the Jest setup, the build output and the
Lambda bundle, for a dependency used only to generate decorative seed data.

## Details

The original assumption was that a current, popular, well-maintained library would load in a
current, ordinary Node project. That assumption is now out of date. The ecosystem is moving
to ESM-only publishing, and this project is deliberately CommonJS: it targets Node 20 on
Lambda, ts-jest transpiles to CommonJS, and every other dependency here works that way.

What caused us to notice was writing the first test that imported the seed's Faker-based
generator. The library had already been used successfully by `npm run db:seed` — `tsx` loads
ESM without complaint — so the dependency looked fine until a test touched it.

That is the subtle part, and it is easy to forget: **a dependency can work in the scripts and
still be unusable in the tests.** The scripts run under `tsx`, which handles ESM. The tests
run under ts-jest, which does not. Proving a package works by running a script proves nothing
about whether it works under test.

The corrected understanding and the rule now followed:

- Before adopting a dependency, check that its `exports` map has a `require` condition. If it
  has only `default` or `import`, it will not load in the test run.
- Prefer pinning to the newest version that still publishes CommonJS over converting the
  project to ESM. The conversion is a large change with its own risks, and it is not
  justified by a seed-data library.
- Revisit this when there is a reason to move the whole project to ESM, not one library at a
  time.

One consequence specific to Faker: version 9 and version 10 produce different values from the
same seed. Downgrading changed every generated name, email and amount. The canonical Acme
figures were unaffected — they are written out by hand and never generated — but the database
had to be seeded again, and the determinism fingerprint recomputed. Faker's seed guarantees
determinism within a version, not across versions.

## How we verified it

The failure and the fix were both observed directly. Version 10 produced the syntax error
above; version 9.9.0 ran the same eight-test suite green with no other change.

The exports maps were read from the registry rather than inferred:

```
$ npm view @faker-js/faker@10.5.0 exports --json   # no "require" condition
$ npm view @faker-js/faker@9.9.0  exports --json   # has "require" -> dist/index.cjs
```

After downgrading, a full `db:reset` and a re-run of the determinism fingerprint confirmed
the seed is still byte-identical run to run — just to different values than before.

## Resulting decision

> `@faker-js/faker` is pinned to `^9`. This project targets CommonJS, and a dependency must
> publish a CommonJS build to be usable in the test run. Working under `tsx` is not evidence
> that a package works under Jest.

## Related files

- `package.json` — the `^9` pin
- `scripts/db/texture.ts` — the only place Faker is used
- `tests/seed-texture.test.ts` — the suite that could not load version 10
- `jest.config.js`, `tsconfig.json` — the CommonJS setup that is correct and was not the fault
