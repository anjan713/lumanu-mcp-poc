# 04 — Provider Architecture

This is the most important part of the POC.

## The claim

`MockLumanuProvider` can be replaced by `RealLumanuProvider` without changing MCP tools,
tool descriptions, client setup, business reasoning, authentication, observability, or any
test above the provider boundary.

The architecture exists to make that claim *testable* rather than asserted.

## Layering

```text
MCP Tool
   ↓
Domain Service
   ↓
LumanuProvider
   ├── InMemoryLumanuProvider  → seed fixture
   ├── MockLumanuProvider      → Apollo → Hasura Cloud v2 → Supabase
   └── RealLumanuProvider      → Lumanu REST API
```

Forbidden, without exception:

```text
MCP Tool → SQL
MCP Tool → Hasura
MCP Tool → Apollo
Domain Service → anything but LumanuProvider
```

Lambda handlers and transport code stay thin. All derived reasoning — Payment Readiness,
Payment Blocker, Funding Capacity — lives in domain services and is computed from provider
return values.

## The provider returns exact Lumanu wire format

`LumanuProvider` methods return Lumanu-compatible wire models, **not** cleaned-up internal
DTOs. That means preserving Lumanu's field naming including snake_case, its nullability, its
enum values, its pagination semantics, its `{ data, total, limit, offset }` envelopes, and
its money, date and identifier representations.

No parallel camelCase model is introduced. Derived business concepts are computed *from*
Lumanu-shaped objects rather than from an alternative payment data model.

Recorded as [ADR 0001](./adr/0001-provider-returns-lumanu-wire-format.md).

```text
MockLumanuProvider
   ↓
Hasura / PostgreSQL
   ↓
map database records into exact Lumanu API shapes

RealLumanuProvider
   ↓
Lumanu REST API
   ↓
returns the same shapes natively
```

Method surface, typed from the harvested schemas rather than `unknown`:

```ts
interface LumanuProvider {
  listWorkspaces(...): Promise<...>;
  getWorkspace(...): Promise<...>;

  listPartners(...): Promise<...>;
  getPartner(...): Promise<...>;

  listPayables(...): Promise<...>;
  getPayable(...): Promise<...>;
  approvePayable(...): Promise<...>;
  cancelPayable(...): Promise<...>;

  getWorkspaceBalance(...): Promise<...>;
  listBalanceTransactions(...): Promise<...>;

  createFunding(...): Promise<...>;
}
```

## Three implementations, one contract

**`InMemoryLumanuProvider`** — over the seed fixture. No network, no credentials. This is
what tool-level tests inject, which is why a fresh clone can run the full suite green
without provisioning anything.

**`MockLumanuProvider`** — Apollo Client against Hasura Cloud v2 over Supabase PostgreSQL,
mapping database records into Lumanu shapes. This is the deployed default.

**`RealLumanuProvider`** — a compiling skeleton against Lumanu's REST API using
client-credentials tokens. Unexercised, because no sandbox credentials are available.

One reusable suite holds all three to the same standard:

```ts
describeLumanuProviderContract(() => new InMemoryLumanuProvider());
describeLumanuProviderContract(() => new MockLumanuProvider());
describeLumanuProviderContract(() => new RealLumanuProvider());
```

This does double duty. It evidences the swap, and it is what stops the in-memory fake from
drifting away from the provider that talks to a real database — without it, the tool tests
would be proving nothing.

## Provider selection

By configuration, never by code change:

```text
LUMANU_PROVIDER=mock
LUMANU_PROVIDER=real
```

## Hasura

Hasura is an internal data access layer only. It is never exposed to MCP clients — and
since Hasura Cloud is a public endpoint, that is a security boundary rather than a style
rule. The admin secret lives in SSM Parameter Store and reaches nothing above the provider.

Funding is the one operation Hasura cannot express as a plain mutation: it needs
conditional validation with rollback, and a Hasura mutation cannot abort when a guard
fails. It is therefore a PostgreSQL function tracked in Hasura and called through Apollo
like any other operation — atomic, and with the layering intact.

## Apollo and GraphQL Codegen

```text
Hasura schema
   ↓
GraphQL Codegen
   ↓
generated TypeScript types
   ↓
Apollo Client
   ↓
MockLumanuProvider
```

Generated types are committed, so a fresh clone typechecks without Hasura credentials.

## Code layout

```text
src/
  mcp/
  domain/
  providers/
  graphql/
  generated/
  auth/
  config/
  observability/
  db/
scripts/
infra/
tests/
docs/
```
