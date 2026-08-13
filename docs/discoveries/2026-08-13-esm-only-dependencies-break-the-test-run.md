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

## Update, 2026-08-13 — the check above is not sufficient

This happened a second time, with `jose`, and it defeated the rule this note originally
gave.

`jose` 6.2.8 publishes only `{ "types": ..., "default": "./dist/webapi/index.js" }` — no
`require` condition, ESM only. But the quick check `node -e "require('jose')"` **succeeded**,
so the package looked usable. Jest then failed on it exactly as Faker had:

```
SyntaxError: Unexpected token 'export'
  at node_modules/jose/dist/webapi/index.js:1
```

The reason is that Node 22 and later can `require()` an ES module. The local runtime is Node
24, so plain `require` resolves and executes it happily. Jest's CommonJS runtime is not
Node's `require` — it has its own module registry and resolver, and it does not implement
`require(esm)`. So the two disagree, and the more convenient check is the one that lies.

Worse, the disagreement is version-dependent: on Node 20, which is what this project deploys
to on Lambda, `require('jose')` would have failed too. The check passed only because the
development machine is two majors ahead of the deployment target.

**The reliable check is the package's `exports` map, not whether anything can load it.**

```
$ npm view <package> exports --json
```

If the `.` entry has no `require` condition, the package is ESM-only and will not load under
ts-jest, whatever `node -e` says. `@aws-sdk/client-ssm` has no `exports` map at all and
declares `main: ./dist-cjs/index.js`, which is also fine — the absence of an `exports` map
means the old `main` field governs, and that points at CommonJS.

`jose` is pinned to `^5` for the same reason Faker is pinned to `^9`: version 5 publishes a
`require` condition pointing at `dist/node/cjs`, version 6 dropped it.

## Resulting decision

> `@faker-js/faker` is pinned to `^9` and `jose` to `^5`. This project targets CommonJS, and
> a dependency must publish a CommonJS build to be usable in the test run. Neither working
> under `tsx` nor loading under `node -e "require(...)"` is evidence that a package works
> under Jest — on Node 22+, `require()` of an ES module succeeds where Jest still fails.
> Check the `exports` map for a `require` condition instead.

## Related files

- `package.json` — the `^9` pin
- `scripts/db/texture.ts` — the only place Faker is used
- `tests/seed-texture.test.ts` — the suite that could not load version 10
- `jest.config.js`, `tsconfig.json` — the CommonJS setup that is correct and was not the fault
