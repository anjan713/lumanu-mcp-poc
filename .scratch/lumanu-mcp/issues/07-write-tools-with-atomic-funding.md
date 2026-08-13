# 07 — Write tools with atomic funding

**What to build:** The ability to change state, behaving like financial infrastructure
rather than CRUD. An agent that can approve and fund without understanding preconditions can
approve something that cannot be paid, or pay something already paid — so every write
validates current state first, returns the resulting state, and leaves an audit record.

Funding is the hard one. It must check every Payable's status, check every Partner's status,
total the amounts, verify and debit the balance, record the Funding and its Balance
Transaction, and move Payables to `will_pay` — all or nothing. A Hasura mutation runs its
fields in one transaction but cannot abort when a guard fails, so a guard-based mutation can
debit the balance while skipping the Payable updates. Funding is therefore a PostgreSQL
function tracked in Hasura and called through Apollo, which keeps the layering intact.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] `approve_payable` moves an `unapproved` Payable to `approved` and returns the new state
- [ ] Approving a Payable that is already funded or canceled is rejected
- [ ] `cancel_payable` withdraws an obligation raised in error and returns the new state
- [ ] Cancelling a funded Payable is rejected, so committed money cannot be silently unwound
- [ ] `fund_payables` draws from the Workspace Balance, records a Balance Transaction, and moves Payables to `will_pay`
- [ ] Funding is atomic: a failure part-way leaves balance and Payable statuses consistent
- [ ] Insufficient balance rejects the entire request, leaving all state untouched
- [ ] Any `unapproved` or `canceled` Payable in the request rejects the entire request
- [ ] Any Partner not `completed_w9` rejects the entire request
- [ ] An already-funded Payable in the request is a no-op returning its existing Funding, not an error
- [ ] A Payable is never funded twice, so a retried request cannot double-debit
- [ ] A mixed batch funds only what needs funding
- [ ] Every state change writes an audit event named after Lumanu's corresponding webhook event
- [ ] Errors are distinguishable by kind: not found, invalid input, invalid state, insufficient balance
- [ ] After approving Alex, funding Maya and Alex requires $10,000 against $15,000 and leaves $5,000 — asserted directly
