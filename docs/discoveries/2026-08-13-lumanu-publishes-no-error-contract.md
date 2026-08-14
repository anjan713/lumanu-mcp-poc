# Lumanu publishes no error contract, so half the refusal vocabulary cannot be mapped

## Summary

The provider interface answers a failed call with one of four refusal kinds — `not_found`,
`invalid_input`, `invalid_state`, `insufficient_balance` — because an agent responds
differently to each. Writing `RealLumanuProvider` we assumed those kinds could be recovered
from Lumanu's HTTP responses. They cannot: the harvested contract declares almost no error
statuses and no error body anywhere. Only `404` is derivable from what Lumanu publishes.
The rest are reported as faults carrying Lumanu's own status and body, rather than sorted
into a kind this project invented.

## What we found

Across the fourteen harvested operations, exactly two declare any response other than
`200`:

```text
GET /workspace/{id}/partner/{partnerId}   200, 404
GET /workspace/{id}/project/{projectId}   200, 404
```

Every other operation — including all three writes, and including `POST /funding`, the one
operation that can fail for a reason involving money — declares `200` and nothing else. No
operation declares an error response body, and `components.schemas` contains no `Error`,
`Problem` or equivalent schema.

So there is nothing to read a reason out of. A refused Funding arrives as some status with
some body, and which status and which body is not a published fact.

## Why it matters

The four kinds are not decoration. They exist because the correct response to each is
different, and the tool descriptions promise as much:

- `not_found` — the identifier is wrong; fix it and retry.
- `invalid_input` — the request is malformed; do not retry it unchanged.
- `invalid_state` — the request was answerable but wrong to make; read the record first.
- `insufficient_balance` — nothing is wrong; retry when there is money.

An agent that cannot tell a shortfall from a bad transition can only retry blindly, and
retrying a payment blindly is exactly what financial infrastructure must not encourage. Had
we guessed a mapping — `402` for a shortfall, say — the guess would have been invisible: it
compiles, it reads plausibly, and the first person to find out it was wrong would be a
caller retrying a Funding that will never succeed.

`LumanuInsufficientBalanceError` makes the problem concrete. It carries `required` and
`available`, and reports the shortfall as the difference. Those are two amounts. There is
no published field to read either from, and no defensible default — `0` would be a lie
about the balance.

## Details

The original assumption was that a REST API returns machine-readable errors, so mapping
them is a matter of reading the schema. That is true of the mock, which is why it was not
noticed until this ticket: the PostgreSQL write functions return an **outcome row** naming
what happened, and `MockLumanuProvider` maps that row onto the four kinds exactly.
[ADR 0005](../adr/0005-funding-is-a-postgresql-function.md) argued for that shape on the
grounds that a reason parsed out of a GraphQL error string could not be relied on — the
same argument, one layer down, and the mock is the implementation where we controlled the
answer.

What questioned the assumption was writing the `catch` in `RealLumanuProvider` and having
nothing to write in it.

The corrected understanding, and the rule now:

- **`404` on a single-resource read → `LumanuNotFoundError`.** Lumanu declares it, and the
  resource and identifier are known at the call site.
- **`404` on a list → a fault.** A list has no missing record to name, and the
  interface's rule is that a scoped list returns an empty page rather than failing. An
  unexplained `404` from a list endpoint is something else, and dressing it as a not-found
  would tell a caller to fix an identifier that is fine.
- **`409` on a write → `LumanuInvalidStateError`.** Not published, but `409` means exactly
  this in HTTP and only a write can produce one. The current state is reported as
  `unknown`, because there is no body to read it from and guessing it would be worse than
  admitting it. A `409` from a *read* is a fault: reporting it as a bad transition would
  tell a caller to go and fix a state that is fine.
- **Everything else → `LumanuApiError`**, carrying the status, the method, the path and
  Lumanu's own body. A fault, not a refusal, and it says so.

The gap is deliberately visible rather than papered over — and it will not close itself.

An earlier version of this note claimed the contract suite's write assertions would reveal
the real statuses once credentials arrived. **That was wrong**, and the spec review caught
it. The suite's write block runs only where the scenario can be restored between tests, and
a Lumanu sandbox cannot be: `reset` is omitted, so the writes skip. They also name the
canonical Acme records by id, which no sandbox holds. So no assertion anywhere will
execute against a refused Lumanu write.

What *will* happen with credentials is narrower and worth stating exactly: the read half of
the suite runs, which exercises the `404` mapping — the only one Lumanu publishes. The
`409` reading and the missing shortfall mapping stay unverified until someone makes a real
Funding fail on purpose and records what came back. That is a manual step, not a test, and
naming it here is the point of the note.

## How we verified it

Read out of the harvested contract rather than inferred:

```
$ node -e "const s=require('./docs/lumanu-reference/openapi.json');
  for (const [p,ops] of Object.entries(s.paths))
    for (const [m,op] of Object.entries(ops))
      if (op.responses) console.log(m, p, Object.keys(op.responses).join(','))"

post   /funding                                 200
get    /payable                                 200
post   /payable/{id}/approve                    200
post   /payable/{id}/cancel                     200
get    /workspace/{id}/partner/{partnerId}      200,404
get    /workspace/{id}/project/{projectId}      200,404
...
```

The mapping that does exist is covered in `tests/real-provider.test.ts`, including the case
that keeps it honest: a `404` from a list endpoint must **not** become a
`LumanuNotFoundError`.

## Resulting decision

> `RealLumanuProvider` maps only the failures Lumanu's published contract supports. Every
> other non-2xx response becomes a `LumanuApiError` carrying the status and body verbatim,
> rather than being sorted into a refusal kind this project invented.

## Related files

- `src/providers/real.ts` — `LumanuApiError`, and the `failure` method that decides
- `src/providers/lumanu-provider.ts` — the four kinds and why they are distinct
- `tests/real-provider.test.ts` — the mapping, and the list-endpoint counter-case
- `docs/adr/0005-funding-is-a-postgresql-function.md` — the same argument about the mock
