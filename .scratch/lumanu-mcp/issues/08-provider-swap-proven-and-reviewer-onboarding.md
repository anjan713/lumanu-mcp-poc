# 08 — Provider swap proven, and reviewer onboarding

**What to build:** The project's central claim, evidenced rather than asserted — and the
handful of pages that let a reviewer act on it.

The claim is that `MockLumanuProvider` can be replaced by `RealLumanuProvider` without
touching MCP tools, tool descriptions, client setup, business reasoning, authentication or
observability. A reader can only believe that if a real skeleton compiles against the same
interface and one contract suite holds every implementation to the same standard. The suite
also earns its keep internally: it is what stops the in-memory fake used by the tool tests
from drifting away from the provider that talks to a database.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] `RealLumanuProvider` compiles against the same interface, calling Lumanu's REST API with client-credentials tokens
- [ ] One reusable contract suite asserts Lumanu-shaped values: field names, snake_case, nullability, enum membership, envelope, pagination, identifier formats
- [ ] The suite runs against the in-memory provider unconditionally, with no credentials required
- [ ] The suite runs against the Hasura-backed provider when credentials are present
- [ ] The suite is written so the real provider drops in unchanged, skipped while Lumanu sandbox credentials are absent
- [ ] Provider responses are validated against the cached OpenAPI fragments, so drift from Lumanu's published contract fails the build
- [ ] The README gives the MCP URL and short instructions for obtaining a demo token
- [ ] The README shows the one command that adds the server to Claude Code
- [ ] The README lists five example prompts that this build answers precisely
- [ ] The README explains how to swap the mock provider for the real one
- [ ] The README names what was deliberately left out, so a judgement call is not mistaken for an oversight
- [ ] A fresh clone runs the full test suite green with no credentials
