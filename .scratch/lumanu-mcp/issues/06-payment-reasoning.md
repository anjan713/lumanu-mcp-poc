# 06 — Payment reasoning

**What to build:** The substance of the demo. "Who can I pay right now?" is not a field on
any record — it is a conclusion combining a Partner's onboarding state, a Payable's approval
state, and whether the Workspace Balance covers the total. "Why can't I pay this person?"
has several possible answers, and only one of them is the one to act on.

This is what separates these tools from a wrapper over REST endpoints: the reasoning lives
here, once, rather than being reinvented by an agent on every conversation.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `get_partner_payment_readiness` answers whether a Partner can be paid right now
- [ ] Readiness accounts for Partner onboarding state, so nobody who cannot legally be paid is reported as payable
- [ ] Readiness accounts for Payable approval state, so unapproved work is never reported as payable
- [ ] Readiness accounts for the Workspace Balance
- [ ] `explain_payment_blocker` returns the single binding reason, not a list of everything wrong
- [ ] Blocker precedence is upstream-first: incomplete Partner status, then unapproved or absent Payable, then insufficient balance
- [ ] Each blocker states whether a tool in this server can resolve it
- [ ] Both tools are keyed on Partner, so Sarah Chen is reachable despite having no Payable
- [ ] Funding Capacity answers whether the balance covers everything currently ready, with the shortfall or remainder stated
- [ ] Funding Capacity totals only genuinely ready Payables, so blocked obligations do not inflate the requirement
- [ ] Maya resolves as ready, Alex as blocked by approval, Sarah as blocked by onboarding, StudioX as already funded
