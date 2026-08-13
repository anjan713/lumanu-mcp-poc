# 02 — Lumanu contract harvested and typed

**What to build:** Lumanu publishes no single OpenAPI document — each API reference page
embeds an OpenAPI 3.1 fragment for one endpoint. Without those fragments cached locally,
every wire shape in this project would be hand-written from memory, and the claim that the
mock is Lumanu-compatible would rest on nothing. This ticket makes Lumanu's published
contract a build artefact: fetched once, cached in the repo, and turned into TypeScript
types the provider layer is written against.

It also resolves the one open technical unknown — how Lumanu represents monetary amounts —
which the database schema in ticket 03 depends on.

**Blocked by:** 01

**Status:** done

- [x] A documented command fetches the reference pages for the endpoints in use and caches their OpenAPI fragments in the repo — `npm run harvest:contract`
- [x] Cached fragments are committed, so no build step requires network access — 14 fragments plus the stitched `openapi.json`
- [x] TypeScript types are generated from the fragments and are what the provider layer is typed against — `src/generated/lumanu-api.ts`, surfaced as `src/providers/wire.ts`; `pretest` fails if they fall out of sync with the cache
- [x] The representation of monetary amounts is determined from the fragments and recorded in the docs — integer, in a unit named beside it; `us_cents` throughout
- [x] A test validates a sample response against its cached fragment and fails if the shape drifts
- [x] The endpoints covered are at least: list and get Workspace, list and get Partner, list and get Payable, approve Payable, cancel Payable, create Funding — plus Workspace Balance, Balance Transactions, get Funding and the two Project reads
- [x] Where a fragment contradicts an assumption written in the docs, the fragment wins and the doc is corrected — five corrections, listed in docs/02 under "What the harvest settled"

**Note on the drift criterion.** Schema validation alone does not satisfy it. Lumanu marks
almost nothing `required` and forbids no additional properties, so a renamed or removed
field still validates — the commonest kind of wire drift, invisible. Enum drift and missing
required fields do fail validation. The gap is closed by asserting the declared field names
directly, by re-stitching the committed fragments and comparing against `openapi.json`, and
by failing the test run when the generated types no longer match the cache.
