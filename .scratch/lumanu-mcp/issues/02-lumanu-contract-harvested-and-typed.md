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

**Status:** ready-for-agent

- [ ] A documented command fetches the reference pages for the endpoints in use and caches their OpenAPI fragments in the repo
- [ ] Cached fragments are committed, so no build step requires network access
- [ ] TypeScript types are generated from the fragments and are what the provider layer is typed against
- [ ] The representation of monetary amounts is determined from the fragments and recorded in the docs
- [ ] A test validates a sample response against its cached fragment and fails if the shape drifts
- [ ] The endpoints covered are at least: list and get Workspace, list and get Partner, list and get Payable, approve Payable, cancel Payable, create Funding
- [ ] Where a fragment contradicts an assumption written in the docs, the fragment wins and the doc is corrected
