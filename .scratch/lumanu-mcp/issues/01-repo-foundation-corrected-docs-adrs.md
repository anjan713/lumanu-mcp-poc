# 01 — Repo foundation, corrected docs, ADRs

**What to build:** A repository a fresh agent session can trust. Today the planning docs
contradict decisions that have since been settled — Funding's direction, the Partner/Vendor
split, the invented tax-state field, the data scale, the AWS-hosted database — so an agent
following them builds the wrong system. After this ticket the docs, `CLAUDE.md` and
`CONTEXT.md` agree with each other, the reasoning behind the two hard-to-reverse choices is
recorded, and there is a TypeScript project that builds and tests.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The original planning brief is committed to git history before any correction, so the pre-decision state is recoverable
- [ ] Planning docs live at `docs/` and `CLAUDE.md` references resolve
- [ ] Doc 01 describes Funding as Lumanu does: money into the Workspace, with `method: "balance"` as the outflow that pays Payables
- [ ] Doc 01 states one Partner status covering onboarding and tax state, not two separate fields
- [ ] Doc 01's canonical scenario matches the agreed table, with Sarah having no Payable and no "expected payment" figure
- [ ] Doc 01 records the opening balance of $25,000, StudioX's $10,000 history, and the $15,000 current balance
- [ ] Doc 03's data scale is corrected to one Workspace, one Project, four canonical Partners
- [ ] Doc 06 describes Supabase and Hasura Cloud v2, not an AWS-hosted database, and no VPC
- [ ] Docs name the cut items under "Deliberately out of scope for the one-day POC"
- [ ] `CLAUDE.md` no longer mandates Doppler, OpenTelemetry, Sentry, Playwright, Next.js or Docker, and no longer lists Vendor as a public entity
- [ ] ADR 0001 records why the provider returns exact Lumanu wire format rather than clean domain models
- [ ] ADR 0002 records why Hasura Cloud v2 was chosen over DDN, for the agreed reason
- [ ] TypeScript, Jest and Pino are configured in the agreed layout, and `npm test` and a typecheck both pass
