# Lumanu MCP POC — Planning Docs

This folder breaks the implementation brief into maintainable files instead of one large prompt.

Start with:

`CLAUDE.md`

That file tells Claude Code which documents to read and in what order.

## Structure

```text
lumanu-mcp-poc-docs/
├── CLAUDE.md
├── README.md
└── docs/
    ├── 01-domain-story.md
    ├── 02-official-api-sources.md
    ├── 03-mock-data-plan.md
    ├── 04-provider-architecture.md
    ├── 05-mcp-tools.md
    ├── 06-aws-deployment.md
    ├── 07-security-observability-testing.md
    └── 08-definition-of-done.md
```

## Why this structure

- `CLAUDE.md` stays small and acts as the permanent entrypoint.
- Domain knowledge is isolated from infrastructure decisions.
- Mock-data rules can evolve without rewriting MCP design.
- Provider architecture is documented separately because it is the main USP.
- Deployment, security, observability, and tests can evolve independently.
- Claude Code can read only the relevant file while working on a specific task.

## Recommended repository placement

Copy these files into the root of the actual implementation repository.

Then ask Claude Code to:

```text
Read CLAUDE.md and all referenced planning files.
Create an implementation plan first.
Do not change verified Lumanu domain/API terminology without checking the official docs.
```
