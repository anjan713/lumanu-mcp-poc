# A generated type silently resolved to `never` for five tickets

## Summary

`CreateFundingRequest` had been exported from `src/providers/wire.ts` since ticket 02 and was
`never` the whole time. The conditional type that extracts a request body from a generated
operation did not match, because `openapi-typescript` emits `requestBody` as *optional* even
where the operation requires one.

Nothing failed. `never` is assignable to every type and accepts no value, so it produces no
error until something finally tries to use it — which happened in ticket 07, five tickets later.

## What we found

The extraction was written the obvious way:

```ts
type RequestBody<Operation> = Operation extends {
  requestBody: { content: { 'application/json': infer Body } };
} ? Body : never;
```

The generated operation is:

```ts
"create-funding": {
    requestBody?: {                       // ← optional
        content: { "application/json": components["schemas"]["Funding"] };
    };
    ...
}
```

`{ requestBody?: X }` does not extend `{ requestBody: X }`, so the conditional took its false
branch and the type became `never`.

The failure mode is what makes this worth writing down. A type alias resolving to `never` is
not an error anywhere:

- `export type CreateFundingRequest = never` compiles.
- Nothing that *reads* the type complains, because `never` is assignable to everything.
- A function typed `(request: never) => ...` compiles until someone tries to call it.

The error finally appeared as `Property 'workspace_id' does not exist on type 'never'` inside
the implementation — a message about the call site, not about the extraction, and one that
reads like a bug in the new code rather than in a type written five tickets earlier.

## Why it matters

This project's whole claim rests on generated types being a real check against Lumanu's
contract. `wire.ts` exists so that a re-harvest either still compiles or names exactly what
Lumanu changed. A type that resolves to `never` participates in neither: it cannot fail to
compile, and it cannot report a change.

Had `create-funding`'s request body changed shape in a re-harvest, nothing would have noticed.
The type was not checking the contract; it only looked as though it was.

It is also the same lesson as
[the OpenAPI drift note](./2026-08-12-openapi-validation-misses-field-renames.md), one level
up. There, validation looked like a drift detector and was not, because Lumanu marks almost
nothing `required`. Here, a type looked like a contract assertion and was not, because it had
quietly collapsed. **Both were checks that could not fail, and a check that cannot fail reads
exactly like a check that keeps passing.**

## Details

The original assumption was that a type alias derived from generated types is self-verifying —
if the extraction were wrong, the compiler would say so. That is true for most type errors and
false for `never` specifically, because `never` is the bottom type: it satisfies every
constraint and every assignment.

The nine sibling aliases in the same file are all *response* extractions, and those matched,
because `responses` is not optional. `CreateFundingRequest` was the only request-body
extraction in the file, so there was no second case to reveal the pattern.

The corrected extraction unwraps the optional before matching the content type:

```ts
type RequestBody<Operation> = Operation extends { requestBody?: infer Wrapper }
  ? NonNullable<Wrapper> extends { content: { 'application/json': infer Body } }
    ? Body
    : never
  : never;
```

The subtle part to remember: this is not a rule about `openapi-typescript`. It is a rule about
any conditional type whose false branch is `never` — the false branch is silent, so a
mismatched pattern is indistinguishable from a correct one until a value shows up.

## How we verified it

The type now asserts itself, alongside the enum and envelope guards already in `wire.ts`:

```ts
const CONTRACT_STILL_MATCHES: [
  ...
  CreateFundingRequest extends never ? never : true,
] = [true, true, true, true];
```

Reverting the extraction to its original form makes that line fail to compile, which is the
mutation check the original code could not have passed. Beyond the guard, the type is now
genuinely load-bearing: `LumanuProvider.createFunding` takes it, and both implementations and
the contract suite construct values of it.

## Resulting decision

Conditional type extractions in `wire.ts` are asserted in `CONTRACT_STILL_MATCHES` rather than
assumed. Any new one gets a line there, because the cost is one line and the alternative is a
type that cannot fail.

## Related files

- `src/providers/wire.ts`
- `src/generated/lumanu-api.ts`
- `src/providers/lumanu-provider.ts`
