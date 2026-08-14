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

- [x] `RealLumanuProvider` compiles against the same interface, calling Lumanu's REST API with client-credentials tokens
- [x] One reusable contract suite asserts Lumanu-shaped values: field names, snake_case, nullability, enum membership, envelope, pagination, identifier formats
- [x] The suite runs against the in-memory provider unconditionally, with no credentials required
- [x] The suite runs against the Hasura-backed provider when credentials are present
- [x] The suite is written so the real provider drops in unchanged, skipped while Lumanu sandbox credentials are absent — **reads only**, see below
- [x] Provider responses are validated against the cached OpenAPI fragments, so drift from Lumanu's published contract fails the build
- [ ] The README gives the MCP URL and short instructions for obtaining a demo token
- [x] The README shows the one command that adds the server to Claude Code
- [x] The README lists five example prompts that this build answers precisely
- [x] The README explains how to swap the mock provider for the real one
- [x] The README names what was deliberately left out, so a judgement call is not mistaken for an oversight
- [x] A fresh clone runs the full test suite green with no credentials

## The one criterion this ticket cannot close

**The MCP URL.** Nothing is deployed. The stack is written, validated and bundled, and the
four SSM parameters it reads have not been created, so there is no live address to publish.
The README gives the URL's exact form, the command that prints it after a deploy, and the
command that reads it back later — but a shape is not an address, and this is not ticked.

The demo-token instructions beside it are complete and do not depend on the deploy.

## What is proven, and what is only compiled

`RealLumanuProvider` has never spoken to Lumanu, and no local test could make it. What
`tests/real-provider.test.ts` proves is everything on this side of the wire, over a
transport supplied through the constructor:

- every path it calls exists in the harvested contract with that method — so a re-harvest
  that moves an endpoint fails on every clone rather than against an account nobody here
  can log into;
- one `client_credentials` token is minted, carried on all thirteen calls, shared by
  concurrent callers, and renewed a minute before it lapses;
- paging, ordering and Lumanu's asymmetric scoping go out as query parameters as published;
- a response crosses the boundary unreshaped — which is the point of ADR 0001, since a
  Lumanu body needs no mapping at all.

The transport is a **constructor seam, not a stubbed global**, following the jose note:
`globalThis.fetch` is not a chokepoint in Node, and substituting the dependency is both
more honest and more durable than intercepting a transport.

**What is deliberately not done** is running the shared contract suite against a
hand-written Lumanu. The suite's whole value is that it holds an implementation to a
standard set outside it; run against a server I wrote, it would hold this provider to my own
guess and report that as evidence.

**What cannot be done at all** is proving the writes against Lumanu. The shared write block
needs the scenario restored between tests, and a sandbox cannot be. So approving, cancelling
and funding against Lumanu stay unverified — and that is a fact about what this project can
reach, not an omission to be tidied later.

## Lumanu publishes no error contract

The finding of this ticket, and it limits the swap. Of the fourteen harvested operations,
two declare a `404` and none declares an error body — including all three writes. So two of
the four refusal kinds cannot be recovered from an HTTP response, and
`LumanuInsufficientBalanceError` in particular carries two amounts that cannot be guessed.

`404` is mapped because Lumanu declares it; `409` on a write is read as a refused
transition because that is what `409` means; everything else becomes a `LumanuApiError`
carrying the status and body verbatim.
[Discovery note](../../../docs/discoveries/2026-08-13-lumanu-publishes-no-error-contract.md).

## What the reviews found

**A claim I made was false.** Both the ticket and the discovery note said that when
credentials arrived, the contract suite's write assertions would reveal Lumanu's real
statuses. They will not. The write block runs only where the scenario can be restored
between tests, and a Lumanu sandbox cannot be — so `reset` is omitted and the writes skip.
They also name the canonical Acme records by id, which no sandbox holds. Corrected in all
three places, and the test file now says so where a reader would otherwise have to infer it
from a skipped test. **Against Lumanu, only the reads are covered.**

**The token request was JSON.** RFC 6749 §4.4.2 defines the `client_credentials` request as
`application/x-www-form-urlencoded`. Since Lumanu publishes no token endpoint at all, the
standard is the one part of this exchange that can be got right rather than guessed — and a
server that also accepts JSON accepts form encoding too, while the reverse does not hold.
Now form-encoded.

**A new contract test would have failed a real sandbox.** It asserted that every Payable
comes back in a status *this POC* can reach, which excludes `paid`. A real sandbox may well
hold a `paid` Payable, so the assertion held Lumanu to this project's scope — the opposite
of what a contract suite is for. It now checks Lumanu's whole published enum, read from the
harvested fragment. That `paid` never reaches an agent is a property of the tool surface,
and `tests/mcp-tools.test.ts` is where it belongs.

**The skip guard named four variables and the provider needed six.** A half-filled
environment would have run the suite and failed every test in `beforeAll` on a configuration
error, which reads as "Lumanu is broken". The guard now names everything
`loadLumanuApiConfig` requires, and a test holds that list to being both sufficient and
minimal by removing each variable in turn.

**Three tests asserted less than their names claimed.** One "answers a write with the
resulting record" only re-read the stub's own constant; it now answers `/approve` with a
distinguishable body and asserts no second request was made. One "sends the base path
Lumanu publishes" sent nothing at all — it compared two literals; it now drives every method
and checks the URLs. And two `createFunding` refusal tests were the same three lines twice.

**Four guards no test could reach.** A `409` from a read, a `409` naming a Funding, a grant
that omits `expires_in`, and a grant with no `access_token` — each now has a test that fails
without it. A fifth, a `Math.max` floor on the token lifetime, turned out to be **inert**: a
negative offset and a zero offset both mean "already expired". It was deleted rather than
tested, which is the honest answer for a guard with no observable effect.

**`LumanuApiError` put Lumanu's raw path in its message.** A fault is rethrown by the tool
wrapper rather than answered as a refusal, so that message is the one thing here an agent
reads — and Lumanu serves the Workspace Balance from a path containing the word the glossary
bans. The message names the operation now; the path stays on the error for the log line.

## The divergence the contract suite caught immediately

Written the obvious way, the read methods were not `async` — each was a single `return
this.send(...)`. But `resolveOrder` and the funding checks throw *before* any request is
sent, and a `Promise`-returning method that throws synchronously is caught by neither
`.catch` nor `expect(...).rejects`. Three tests went red at once, on the same assertion
style the shared contract suite uses, which is exactly where this would have bitten with
real credentials. Every method is `async` now, and the reason is recorded on the class.

## Also here

`loadLumanuApiConfig` is separate from `loadHasuraConfig` for the reason established in
ticket 04: selecting a provider selects its credentials and stops asking for the other's.
A deployment running `real` holds no Hasura admin secret, and `createProvider` is asserted
on both directions of that.

`LUMANU_TOKEN_URL` is configured rather than derived, and marked as **not harvested** —
Lumanu documents the `client_credentials` grant and the audience but publishes no token
endpoint among the fourteen pages. Same treatment as the audit event names in ticket 07.

Two small additions to the contract suite, both aimed at criterion 2. Every Payable a
provider returns must be in a status this POC can actually reach, which schema validation
cannot catch because `paid` is a real member of Lumanu's enum. And in
`tests/lumanu-contract.test.ts`, one test proves the identifier `format` is genuinely
enforced — a JSON Schema validator ignores unknown formats unless given them, so without
`ajv-formats` registered every identifier assertion in the project would have kept passing
while checking nothing.
