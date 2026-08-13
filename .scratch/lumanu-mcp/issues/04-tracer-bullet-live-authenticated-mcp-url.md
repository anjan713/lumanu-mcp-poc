# 04 — Tracer bullet: one tool, end to end, deployed and authenticated

**What to build:** The narrowest complete path through every layer, deployed. A hiring
reviewer adds the server to Claude Code using a documented command, asks a question, and
gets a Lumanu-shaped answer from a real database. One tool is enough — the point of this
ticket is that every layer and every piece of infrastructure is proven working together,
so the tickets that follow only add tools rather than discovering deployment problems.

This is the highest-risk ticket after 03 and it produces the single most important
deliverable: a live MCP URL. First-deploy IAM surprises are common, so proving an empty
stack deploys is worth doing before the tool is finished.

**Blocked by:** 03. Also gated on human account setup: Auth0 tenant with an API and a
machine-to-machine application, and AWS credentials.

**Status:** ready-for-agent

- [ ] The `LumanuProvider` interface exists, typed from the harvested schemas, returning exact Lumanu wire format
- [ ] `InMemoryLumanuProvider` satisfies it over the seed fixture, with no network or credentials
- [ ] `MockLumanuProvider` satisfies it through Apollo Client against Hasura
- [ ] The implementation is selected by configuration, with no code change
- [ ] No MCP tool or domain service reaches SQL, Hasura or Apollo directly
- [ ] The MCP server speaks stateless Streamable HTTP over `POST /mcp` with no session state
- [ ] `list_workspaces` returns a Lumanu-shaped Workspace, including the `{ data, total, limit, offset }` envelope
- [ ] Infrastructure is deployed to `us-east-1` as code, and stack outputs include the MCP endpoint
- [ ] Secrets are read from AWS at runtime; none are committed
- [ ] A request bearing a valid Auth0 token succeeds
- [ ] A request with no token, an expired token, or a wrong audience is rejected
- [ ] Signing-key rotation works, because validation goes through JWKS
- [ ] Claude Code connects to the deployed URL and returns the Workspace, using only the documented steps
- [ ] Structured logs carry a correlation id, tool name, provider, duration and outcome
