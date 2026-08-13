# 03 — Data layer live: Supabase, Hasura Cloud v2, schema, deterministic seed

**What to build:** The mock's persistent store, and the canonical scenario living in it.
Until this exists there is nothing for a provider to read. The first acceptance criterion is
deliberately the smallest possible end-to-end proof, because connecting Hasura Cloud v2 to
Supabase is the least certain step in the whole build and it is worth failing fast: if it
resists, the fallback is self-hosted Hasura v2 CE, which changes nothing above the provider
boundary.

Once the connection is proven, the full schema and the deterministic seed follow. The seed
is the demo — the figures a reviewer will check are the ones this ticket writes.

**Blocked by:** 02. Also gated on human account setup: Supabase project, Hasura Cloud v2
project, and the session-mode pooler connection string.

**Status:** ready-for-agent

- [ ] Smoke test first: Hasura Cloud v2 connected to Supabase, one table tracked, one successful query — before any further schema work
- [ ] The connection uses the Supavisor session-mode pooler, not a direct connection and not transaction mode
- [ ] Schema covers Workspaces, Projects, Partners, Payables, Fundings, the Funding/Payable join, Balance Transactions, and audit events
- [ ] There is no separate Vendor table; Partner is a single table
- [ ] The Workspace Balance is stored as integer cents and a Balance Transaction ledger exists alongside it
- [ ] Hasura metadata and migrations are committed to the repo
- [ ] `db:migrate`, `db:seed` and `db:reset` all work, and are documented
- [ ] The seed is deterministic: reset reproduces byte-identical canonical figures
- [ ] Maya Patel is `completed_w9` with an `approved` $2,500 Payable
- [ ] Alex Rivera is `completed_w9` with an `unapproved` $7,500 Payable
- [ ] Sarah Chen is `awaiting_w9_submission` with no Payable at all
- [ ] StudioX LLC is `completed_w9` with a `will_pay` $10,000 Payable
- [ ] Acme US opens at $25,000, StudioX's $10,000 Funding is present as history, and the current balance is $15,000
- [ ] A test asserts the stored balance equals the sum of Balance Transactions
- [ ] Generated extra records add texture without introducing a second Workspace, Project, or funding model
