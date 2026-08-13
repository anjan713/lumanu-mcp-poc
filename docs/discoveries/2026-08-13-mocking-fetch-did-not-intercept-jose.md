# Stubbing `fetch` did not intercept jose, and the seam was the better fix

## Summary

To test the Lambda handler offline we stubbed `globalThis.fetch` so the Auth0 JWKS could be
served from a locally generated key. It had no effect: jose's Node build fetches a remote
JWKS with `node:https`, not `fetch`. Every valid-token case failed with a 401 and the real
DNS lookup hung the test suite. The fix was not a better mock but a dependency seam — the
handler now takes its runtime, so the test supplies a verifier that already holds the keys.

## What we found

The stub looked right and did nothing:

```ts
globalThis.fetch = ((input: unknown) => {
  if (String(input).includes('jwks.json')) {
    return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] })));
  }
  throw new Error(`unexpected fetch: ${String(input)}`);
}) as typeof globalThis.fetch;
```

jose 5's CommonJS build resolves a remote key set through Node's HTTPS module:

```js
// node_modules/jose/dist/node/cjs/runtime/fetch_jwks.js
const https = require("node:https");
const fetchJwks = async (url, timeout, options) => {
    switch (url.protocol) {
        case 'https:': get = https.get; break;
```

So `createRemoteJWKSet` never consulted the stub. It made a real request to
`https://tenant.us.auth0.com/.well-known/jwks.json` — a domain that does not exist — which
produced two symptoms at once:

- every test with a valid token failed with **401**, because key resolution failed and the
  signature could not be checked; and
- the suite **hung**, because the outstanding DNS lookup kept the process alive.

The tests that expected a 401 all passed, which made the failure look narrower than it was.

## Why it matters

The wrong lesson here is "stub `https` as well". That would have worked and would have been
worse: the test would then depend on which HTTP client jose uses internally, and a jose
upgrade that moved to `fetch` — which version 6 does — would break it again for a reason that
has nothing to do with this project's behaviour.

More importantly, a test that mocks the network is asserting less than it appears to. The
question worth answering is "does the handler reject a token that is not properly signed",
and that question is better answered by giving the verifier real keys and real signatures than
by intercepting a transport.

## Details

The original assumption was that `globalThis.fetch` is the network in modern Node, so
stubbing it intercepts anything a library does. That is true for libraries written against
web standards, and false for libraries that keep a Node-specific path — which jose 5
deliberately does, because it predates `fetch` being universally available and ships separate
`node`, `browser` and `webapi` builds.

Two things sent the diagnosis down blind alleys before the real cause was found, and both are
worth recording because they are individually plausible:

1. **`jest.config.js` sets `restoreMocks: true`.** The stub was originally installed with
   `jest.spyOn` in `beforeAll`, so it really was being torn down after the first test. That is
   a genuine problem and fixing it — assigning `globalThis.fetch` directly — was a genuine
   improvement. It just was not the cause, because the stub was never consulted either way.
2. **The handler leaked an unclosed MCP server**, which independently kept the process alive.
   Fixing that was also correct and also did not resolve the 401s. See the companion note,
   `2026-08-13-a-per-request-mcp-server-must-be-closed.md`.

Having two real defects and one false lead in the same failure is what made this take three
attempts. The signal that finally separated them: the hang and the 401s had to share a cause,
because they appeared and disappeared together across the valid-token tests only.

The corrected understanding:

- **`globalThis.fetch` is not a chokepoint for network access in Node.** A library may use
  `node:https`, `node:http`, an agent, or its own pooled client. Verify what a library
  actually calls before stubbing at that level, or do not stub at that level.
- **Prefer a seam to a mock.** The handler now exposes `createHandler(load)`, which takes the
  runtime — configuration, logger, provider, token verifier — rather than constructing it
  from the environment. Production calls the version that builds it from configuration; the
  test passes one holding `InMemoryLumanuProvider` and a verifier constructed with a local key
  set.

`createTokenVerifier` already supported this: it accepts an optional `keys` source and falls
back to `createRemoteJWKSet` when none is given. The test therefore exercises the same
verifier, the same algorithms list, the same issuer and audience checks and the same real
RS256 signature verification as production. The only thing substituted is where the public
key came from.

This is the same substitution the provider abstraction makes everywhere else in this project,
applied one layer higher. It is worth noticing that the fix made the test *stronger* rather
than merely greener — nothing about authentication is faked now, whereas the fetch stub was
faking the step that decides whether a token is trustworthy.

## How we verified it

The internal transport was read directly out of the installed package rather than inferred:

```
$ grep -n "https\|fetch" node_modules/jose/dist/node/cjs/runtime/fetch_jwks.js
4:const https = require("node:https");
11:        case 'https:':
12:            get = https.get;
```

Before the change: 3 failed, 8 passed, and the suite required `--forceExit` to terminate. The
three failures were exactly the valid-token cases.

After replacing the stub with an injected runtime, and with no mocking of any network API:

```
Tests:       11 passed, 11 total
Time:        3.886 s
```

The suite exits on its own, and the forged-token, wrong-audience, wrong-issuer and expired
cases in `tests/auth.test.ts` continue to pass against genuinely signed tokens.

## Resulting decision

> The Lambda handler exposes `createHandler(load)`, taking its runtime rather than building it
> from the environment, so tests substitute the provider and the token verifier directly. No
> test in this project mocks `fetch`, `node:https`, or any other network primitive.

## Related files

- `src/lambda/handler.ts` — `createHandler`, `buildRuntime`, and the exported `handler`
- `src/auth/verify.ts` — the optional `keys` source that makes local key sets possible
- `tests/lambda-handler.test.ts` — supplies the runtime; stubs nothing
- `tests/auth.test.ts` — real signatures, locally generated keys
- `jest.config.js` — `restoreMocks: true`, the false lead
