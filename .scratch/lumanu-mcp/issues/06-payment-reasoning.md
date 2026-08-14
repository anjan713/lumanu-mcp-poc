# 06 — Payment reasoning

**What to build:** The substance of the demo. "Who can I pay right now?" is not a field on
any record — it is a conclusion combining a Partner's onboarding state, a Payable's approval
state, and whether the Workspace Balance covers the total. "Why can't I pay this person?"
has several possible answers, and only one of them is the one to act on.

This is what separates these tools from a wrapper over REST endpoints: the reasoning lives
here, once, rather than being reinvented by an agent on every conversation.

**Blocked by:** 05

**Status:** ready-for-agent

- [x] `get_partner_payment_readiness` answers whether a Partner can be paid right now
- [x] Readiness accounts for Partner onboarding state, so nobody who cannot legally be paid is reported as payable
- [x] Readiness accounts for Payable approval state, so unapproved work is never reported as payable
- [x] Readiness accounts for the Workspace Balance
- [x] `explain_payment_blocker` returns the single binding reason, not a list of everything wrong
- [x] Blocker precedence is upstream-first: incomplete Partner status, then unapproved or absent Payable, then insufficient balance
- [x] Each blocker states whether a tool in this server can resolve it
- [x] Both tools are keyed on Partner, so Sarah Chen is reachable despite having no Payable
- [x] Funding Capacity answers whether the balance covers everything currently ready, with the shortfall or remainder stated
- [x] Funding Capacity totals only genuinely ready Payables, so blocked obligations do not inflate the requirement
- [x] Maya resolves as ready, Alex as blocked by approval, Sarah as blocked by onboarding, StudioX as already funded

## Worth knowing

**Funding Capacity excludes the balance from its Partner rows, and it must.** Both concepts
speak of what is "ready to fund", and implementing them from one assessment made Funding
Capacity report `sufficient: true` for a Workspace holding $1,000 against $2,500 of approved
work — anything unaffordable was removed from the set before the total was taken, so the
requirement could never exceed the balance. Readiness for one Partner includes the balance;
Funding Capacity's rows do not, and it reports on the balance instead. A row can therefore read
`ready` while `sufficient` reads `false`. See
[the discovery note](../../../docs/discoveries/2026-08-13-readiness-that-includes-the-balance-makes-capacity-vacuous.md).

**Readiness has three states, not two.** `ready`, `blocked`, `already_funded`. Collapsing the
last two into "not ready" would put StudioX in the same bucket as Sarah.

**`no_payable` and `payable_needs_approval` are separate codes at the same rank.** Both mean
there is nothing approved to fund; the actions differ.

**`CONTEXT.md` was updated.** It defined both concepts over a Payable, and this ticket requires
them keyed on Partner so that Sarah is reachable. The glossary is authoritative, so it was
corrected rather than left to disagree with what shipped.

## Added beyond the ticket

- `get_funding_capacity`. The ticket names Funding Capacity in two criteria without naming a
  tool, and the preamble asks for the reasoning to live here once rather than be reinvented by
  an agent — so it is exposed rather than left for an agent to assemble from the read tools.

## Carried to ticket 07

**`resolvable_here` is false on every blocker, including approval.** It means "a tool in this
server can clear this today", and none can until the write tools exist. Approving is the one
blocker a Buyer can clear without leaving the Workspace and the `resolution` prose says so, but
the boolean must not claim a tool that is not registered. Ticket 07 flips this entry to `true`
and can then name `approve_payable`.

Note that `docs/05-mcp-tools.md`'s example interaction shows Alex as "fixable here". That
describes the finished product, and becomes true in ticket 07.
