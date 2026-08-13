# A per-request MCP server must be closed, or it leaks

## Summary

The Lambda handler builds a fresh `McpServer` for each request, because a stateless
transport must not carry anything between callers. We assumed that when the handler returned
and the server went out of scope, that was the end of it. It is not: `server.connect(transport)`
registers handlers and holds the transport open, and without an explicit `close()` every
invocation leaves a live server behind.

## What we found

The original handler did this:

```ts
const server = buildMcpServer({ provider, logger });
const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

await server.connect(transport);
const response = await transport.handleRequest(toRequest(event));
const body = await response.text();

return { statusCode: response.status, headers, body };
```

Every assertion about the response passed. The response was correct, the status was correct,
the MCP handshake completed. What was wrong was invisible in the result.

The symptom appeared in the test run instead: Jest completed every test and then never
exited. `--detectOpenHandles --forceExit` finished the suite in five seconds, which is how we
knew the tests themselves were fine and something was holding the process open.

## Why it matters

Two different consequences, and the test one is the harmless half.

In Lambda, a container is reused across invocations. A connected server that is never closed
is retained for the life of that container, so a warm container accumulates one leaked
server, transport and handler registration per request served. Memory grows with traffic
rather than with concurrency, and the container is eventually recycled by the platform rather
than by anything we control — which means the failure mode is a slow climb in memory and,
on a long-lived container, an out-of-memory kill that looks unrelated to any particular
request.

Locally, and in CI, it is the reason a green test suite hangs. That is worth stating plainly
because it sends you looking in the wrong place: nothing had failed, so the instinct is to
suspect the test harness rather than the code under test.

## Details

The original assumption was ordinary JavaScript reasoning: the function returns, nothing
references the server, the garbage collector deals with it. That holds for a plain object. It
does not hold for something that has registered itself with another live object.

`server.connect(transport)` is the step that breaks it. It wires the server's request
handlers into the transport and starts the transport listening. From that point the transport
holds a reference to the server, and — for a transport with any underlying I/O — the runtime
holds a reference to the transport. Nothing is unreachable, so nothing is collected.

What caused us to question it was a hanging test suite with no failures. That combination is
the useful signal: a failing test tells you what is wrong, but a suite that passes and then
refuses to exit tells you something was left running, and the thing under test is the first
place to look.

The corrected understanding, and the rule now followed:

- **`connect()` is paired with `close()`.** If a server is built per request, it is closed
  per request. If it were built per container, it would be closed on shutdown.
- The close belongs in a `finally`, not after the return value is computed. A tool that
  throws must not skip the cleanup, and the handler has a catch block that turns errors into
  JSON-RPC responses — so without `finally`, every error path leaked.
- `close()` is allowed to fail without failing the request. The response has already been
  produced by that point, and reporting a cleanup failure to the caller would replace a good
  answer with a bad one.

The subtle part, easy to forget: **a leak of this kind never shows up in an assertion about
the response.** Every test of what the handler returns can pass, permanently, while the
handler leaks on every call. The only cheap signal is process lifetime, which is why "the
suite hangs" is worth treating as a finding rather than a nuisance to be silenced with
`--forceExit`.

## How we verified it

Before the fix, `npx jest tests/lambda-handler.test.ts` never returned; the command was
killed at 300 seconds twice. The same run with `--forceExit` completed in 5.0 seconds with
the tests themselves accounted for, which located the problem after the tests rather than
inside them.

After adding the `finally` block, the suite completes and exits on its own:

```
Tests:       11 passed, 11 total
Time:        3.886 s
```

No `--forceExit` and no `--detectOpenHandles` are used in `npm test`, so a future leak of the
same kind will hang the suite again rather than being masked.

## Resulting decision

> The Lambda handler closes the MCP server in a `finally` block, so every request — including
> every failed request — tears down the server it built. `npm test` deliberately does not pass
> `--forceExit`, so that a resource left open fails visibly instead of quietly.

## Related files

- `src/lambda/handler.ts` — the `finally` block around `handleRequest`
- `tests/lambda-handler.test.ts` — the suite that exits cleanly only because of it
- `jest.config.js` — no `forceExit`, on purpose
