# Engineering Discoveries

Things this project learned that are not recoverable from the code alone — a wrong
assumption, a contract that disagreed with our documentation, a test that turned out to be
proving less than it claimed. Each file is self-contained.

### The Lumanu contract

- [OpenAPI validation does not detect a renamed field](./2026-08-12-openapi-validation-misses-field-renames.md) — permissive schemas make validation a weak drift detector
- [Lumanu's published contract contradicted our own documentation](./2026-08-12-lumanu-contract-contradicted-our-docs.md) — five corrections, including a false rule in the glossary
- [The Workspace Balance is two figures, not one](./2026-08-12-workspace-balance-is-two-figures.md) — `available_balance` governs funding, not `balance`

### The data layer

- [Hasura's metadata export contains the database password](./2026-08-13-hasura-export-contains-database-password.md) — the admin secret is also a Supabase credential
- [Hasura acknowledges table tracking before the GraphQL schema is ready](./2026-08-13-hasura-acknowledges-tracking-before-the-schema-is-ready.md) — a success response that is not yet true
- [A script that runs on import nearly let a test wipe the database](./2026-08-13-a-script-that-runs-on-import.md) — entry points must not be importable
- [ESM-only dependencies do not load in this project's tests](./2026-08-13-esm-only-dependencies-break-the-test-run.md) — check the `exports` map; `require()` succeeding is not evidence
