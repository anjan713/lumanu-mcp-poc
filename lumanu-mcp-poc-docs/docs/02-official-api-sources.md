# 02 — Official Lumanu API Sources

Treat Lumanu's current developer documentation as the source of truth.

## Primary references

- Introduction:
  `https://developers.lumanu.com/docs/intro`

- Core concepts:
  `https://developers.lumanu.com/docs/core-concepts`

- API reference example:
  `https://developers.lumanu.com/reference/get-workspaces`

- AI-readable documentation index:
  `https://developers.lumanu.com/llms.txt`

## OpenAPI workflow

At the beginning of implementation:

1. Fetch Lumanu's current `llms.txt`.
2. Discover the official machine-readable OpenAPI specification from Lumanu's documentation/index.
3. Do not guess the OpenAPI URL.
4. Cache the discovered files locally.

Suggested location:

```text
docs/lumanu-reference/
  llms.txt
  openapi.json
```

or:

```text
docs/lumanu-reference/
  llms.txt
  openapi.yaml
```

## Source-of-truth rules

Use OpenAPI for:

- endpoint paths
- HTTP methods
- request fields
- response fields
- enums
- pagination
- errors
- identifiers
- required/optional fields

Use Lumanu's guides/core concepts for:

- business meaning
- workflow semantics
- entity relationships
- onboarding/payment state interpretation

If our assumptions conflict with the official Lumanu specification, the official specification wins.

## Mock compatibility

We are mocking Lumanu's official API behavior.

Do not invent Lumanu response shapes when an official schema exists.

Where practical:

```text
OpenAPI
   ↓
generated TypeScript types
   ↓
Mock provider
   ↓
contract validation
```

The mock layer should be believable enough that a future real Lumanu provider can satisfy the same domain contract.
