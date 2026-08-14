# Readiness that includes the balance makes Funding Capacity unanswerable

## Summary

Payment Readiness and Funding Capacity are both defined in terms of what is "ready to fund",
and we implemented both from one assessment that checked onboarding, approval and the
Workspace Balance. Funding Capacity then reported `sufficient: true` for a Workspace holding
$1,000 against $2,500 of approved work.

It was not an arithmetic mistake. The two concepts mean different things by "ready", and
sharing one definition made the second question answer itself.

## What we found

The single assessment marked a Partner blocked when the balance did not cover what they were
owed. Funding Capacity then totalled the Partners who came back `ready`:

```
balance $1,000, Maya approved for $2,500

assess(Maya, balance $1,000)  →  blocked: insufficient_balance
ready partners                →  []
required_amount               →  $0
sufficient  =  $1,000 >= $0   →  true      ← wrong, and always true
```

Anything the balance could not cover was removed from the set before the total was taken. The
requirement could therefore never exceed the balance, so `sufficient` was `true` for every
Workspace in every state, and `shortfall` was permanently `null` — the field the whole
concept exists to produce.

The failing test was the one asserting a shortfall. Every other test passed, including all
four canonical Partners, because the canonical balance of $15,000 comfortably covers the
$2,500 that is ready.

## Why it matters

A tool that always answers "yes, you can afford it" is worse than no tool. It is confidently
wrong in exactly the situation a finance operator most needs it to be right, and there is no
symptom — the answer is well-formed, plausible, and the reasoning behind it is invisible.

It would also have survived a demo. The canonical scenario is deliberately solvent, so the
figures a reviewer checks would all have been correct. Only a Workspace short of money would
have shown it, and this POC has no such Workspace.

The general lesson is about derived concepts specifically. Two definitions that share a phrase
— here, "ready to fund" — look like they should share an implementation, and factoring out the
common part is the obvious move. When one of the two exists *to test the very condition the
shared part already applied*, factoring it out silently removes the question.

## Details

`CONTEXT.md` defines the two:

> **Payment Readiness**: Whether a given Payable can be funded right now.
>
> **Funding Capacity**: Whether the Workspace Balance covers the total of every Payable that
> is currently ready to fund.

Read closely, the second contains its own answer if the first includes the balance. "Every
Payable currently ready to fund" would already mean "every Payable the balance covers", and
asking whether the balance covers those is asking whether the balance covers what the balance
covers.

The original assumption was that readiness was one predicate with three conditions, and that
both tools were views over it. What prompted the question was writing the shortfall assertion
before the implementation: it is the only test in the ticket that requires an insolvent
Workspace, and it is the only one that could have caught this.

**How the system behaves now.** `assess` takes the available balance or `null`:

| Caller | Balance | Because |
| --- | --- | --- |
| `partnerPaymentReadiness` | included | "Can I pay this person right now" genuinely includes whether the money is there. |
| `fundingCapacity` rows | `null` | The rows say whether the *work* is ready. The total says whether the *money* is. |

This produces one payload where a Partner row reads `ready` while `sufficient` reads `false`,
which looks like a contradiction and is not: the work is ready and the money is short. That
combination is the correct answer, and it is the answer the tool exists to give.

The subtle part, easy to forget and easy to "fix" later: asking about Maya alone and asking
about Maya inside a capacity report can legitimately return different states for Maya. A test
now asserts both, with the reason, so that removing the apparent inconsistency fails.

## How we verified it

The test written before the implementation, against a Workspace holding $1,000:

```ts
it('states the shortfall when the balance does not cover it', ...)
  expect(capacity['sufficient']).toBe(false);   // received: true
```

Two further tests were added afterwards to hold the distinction in place:

- a Workspace holding $8,000 against Maya's $2,500 and an approved Alex at $7,500 — each fits
  individually, the total does not, and capacity reports a $2,000 shortfall. This is the case
  that justifies Funding Capacity being a separate question at all.
- the same Partner assessed both ways in one test, asserting `ready` in the capacity rows and
  `blocked` when asked about alone, with the reasoning in the test's own comment.

## Resulting decision

Payment Readiness includes the Workspace Balance. Funding Capacity assesses each Partner on
onboarding and approval only, and reports on the balance itself rather than consuming it as an
input. `assess` takes `availableBalance: number | null`, and Funding Capacity passes a named
`IGNORE_BALANCE` constant rather than a bare `null` — the distinction being that this is "do
not ask", not "not known".

`CONTEXT.md` now states Funding Capacity in terms of Partner Status and approval rather than in
terms of Payment Readiness, so that the circularity cannot be reintroduced by someone
implementing faithfully from the glossary.

## Related files

- `src/domain/readiness.ts`
- `src/mcp/server.ts`
- `tests/payment-reasoning.test.ts`
- `CONTEXT.md`
