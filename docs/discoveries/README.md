# Engineering Discoveries

Things this project learned that are not recoverable from the code alone — a wrong
assumption, a contract that disagreed with our documentation, a test that turned out to be
proving less than it claimed. Each file is self-contained.

- [OpenAPI validation does not detect a renamed field](./2026-08-12-openapi-validation-misses-field-renames.md) — permissive schemas make validation a weak drift detector
- [Lumanu's published contract contradicted our own documentation](./2026-08-12-lumanu-contract-contradicted-our-docs.md) — five corrections, including a false rule in the glossary
- [The Workspace Balance is two figures, not one](./2026-08-12-workspace-balance-is-two-figures.md) — `available_balance` governs funding, not `balance`
