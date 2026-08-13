# 04 — Provider Architecture

This is the most important architectural part of the POC.

## Goal

The MCP tool surface must not depend directly on mock storage.

Build:

```ts
interface LumanuProvider {
  listWorkspaces(...args: unknown[]): Promise<unknown>;
  getWorkspace(...args: unknown[]): Promise<unknown>;

  listPartners(...args: unknown[]): Promise<unknown>;
  getPartner(...args: unknown[]): Promise<unknown>;

  listPayables(...args: unknown[]): Promise<unknown>;
  getPayable(...args: unknown[]): Promise<unknown>;
  approvePayable(...args: unknown[]): Promise<unknown>;
  cancelPayable(...args: unknown[]): Promise<unknown>;

  getWallet(...args: unknown[]): Promise<unknown>;
  listWalletTransactions(...args: unknown[]): Promise<unknown>;

  createFunding(...args: unknown[]): Promise<unknown>;
}
```

The exact signatures should be typed from domain/OpenAPI models rather than `unknown`.

## Implementations

### MockLumanuProvider

```text
MockLumanuProvider
   ↓
Apollo Client
   ↓
Hasura GraphQL
   ↓
PostgreSQL
```

### RealLumanuProvider

```text
RealLumanuProvider
   ↓
Lumanu REST API
```

Initially, the real provider can be a contract-compliant skeleton.

## Provider selection

Example:

```text
LUMANU_PROVIDER=mock
```

Future:

```text
LUMANU_PROVIDER=real
```

## Dependency rule

Never do this:

```text
MCP Tool → SQL
```

Never do this:

```text
MCP Tool → Hasura directly
```

Use:

```text
MCP Tool
  ↓
Domain Service
  ↓
LumanuProvider
```

## Why this is the USP

The hiring team should be able to swap:

```text
MockLumanuProvider
```

for:

```text
RealLumanuProvider
```

without changing:

- MCP tools
- tool descriptions
- client setup
- business reasoning
- authentication
- observability
- tests above the provider boundary

## Hasura

Use Hasura only as an internal data access layer.

Do not expose Hasura directly to MCP clients.

## Apollo + GraphQL Codegen

Use Apollo Client from `MockLumanuProvider`.

Use GraphQL Code Generator so Hasura queries/mutations have generated TypeScript types.

Suggested flow:

```text
Hasura schema
   ↓
GraphQL Codegen
   ↓
generated TS types
   ↓
Apollo Client
   ↓
MockLumanuProvider
```

## Suggested code layers

```text
transport/
mcp/
domain/
providers/
graphql/
generated/
observability/
config/
```

Keep Lambda handlers and transport code thin.
