/**
 * `RealLumanuProvider`, as far as it can honestly be tested without an account.
 *
 * Lumanu issues credentials on request only, so nothing here proves how Lumanu
 * behaves. What it does prove is everything on this side of the wire: that the
 * paths this provider calls are the ones Lumanu publishes, that every request
 * carries a bearer token obtained with the `client_credentials` grant, that
 * paging and ordering are sent the way Lumanu documents them, and that a
 * response comes back through the boundary unreshaped.
 *
 * The transport is a constructor seam, not a stubbed global. `fetch` is never
 * patched here — see the discovery note on jose, where stubbing it turned out
 * to intercept nothing and the seam was the better fix.
 *
 * **What this deliberately does not do** is run the shared contract suite
 * against a hand-written Lumanu. The suite's value is that it holds an
 * implementation to a standard set outside it; run against a server I wrote, it
 * would hold this provider to my own guess and report that as evidence. The
 * suite is wired up for real credentials in `tests/integration/real-provider.test.ts`
 * and skips until they exist.
 */

import { LumanuApiError, RealLumanuProvider, LUMANU_ROUTES, type HttpTransport } from '@/providers/real';
import {
  LumanuInvalidInputError,
  LumanuInvalidStateError,
  LumanuNotFoundError,
  LumanuQueryError,
} from '@/providers/lumanu-provider';
import type { LumanuApiConfig } from '@/config';

import spec from '../docs/lumanu-reference/openapi.json';
import { expectMatchesLumanuSchema } from './support/lumanu-schema';

const CONFIG: LumanuApiConfig = {
  baseUrl: 'https://api.demo.lumanu.link/api/rest',
  tokenUrl: 'https://auth.demo.lumanu.link/oauth/token',
  clientId: 'client-id',
  clientSecret: 'shhh-the-client-secret',
  audience: 'https://lumanu-demo.hasura.app/v1/graphql',
};

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PARTNER_ID = '22222222-2222-4222-8222-222222222222';
const PAYABLE_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';

/**
 * Lumanu-shaped bodies for the stub to answer with. Each is validated against
 * Lumanu's own schema below, so a fixture cannot drift into a shape Lumanu
 * would never send and quietly make these tests pass.
 */
const WORKSPACE = {
  id: WORKSPACE_ID,
  display_name: 'Acme US',
  funding_fee_percent: null,
  additive_funding_fee: null,
};
const PARTNER = { id: PARTNER_ID, name: 'Maya Patel', status: 'completed_w9' };
const PAYABLE = {
  id: PAYABLE_ID,
  workspace_id: WORKSPACE_ID,
  vendor_display_name: 'Maya Patel',
  amount: 250_000,
  amount_denomination: 'us_cents',
  description: 'Summer Creator Campaign — Instagram deliverables',
  status: 'approved',
};
const PROJECT = { id: PROJECT_ID, name: 'Summer Creator Campaign' };
const ACCOUNT = {
  display_name: 'Acme US',
  balance: { balance: 1_500_000, available_balance: 1_500_000 },
  denomination: 'us_cents',
};
const TRANSACTION = {
  id: '44444444-4444-4444-8444-444444444444',
  amount: 1_000_000,
  amount_denomination: 'us_cents',
  balance_change: -1_000_000,
  ending_balance: 1_500_000,
  type: 'payment',
  status: 'processed',
};
const FUNDING = {
  id: '66666666-6666-4666-8666-666666666666',
  workspace_id: WORKSPACE_ID,
  method: 'balance',
  status: 'completed',
  amount: 250_000,
  payable_ids: [PAYABLE_ID],
};

/** What the stub answers for a given path, before any per-test override. */
function cannedBody(pathname: string): unknown {
  const page = (item: unknown): unknown => ({ data: [item], total: 1, limit: 25, offset: 0 });

  if (pathname.endsWith('/wallet')) return ACCOUNT;
  if (pathname.endsWith('/wallet/transaction')) return page(TRANSACTION);
  if (pathname.endsWith('/approve') || pathname.endsWith('/cancel')) return PAYABLE;
  if (pathname.endsWith('/funding')) return FUNDING;
  if (/\/partner\/[^/]+$/.test(pathname)) return { ...PARTNER, payables_count: 1 };
  if (pathname.endsWith('/partner')) return page(PARTNER);
  if (/\/project\/[^/]+$/.test(pathname)) return PROJECT;
  if (pathname.endsWith('/project')) return page(PROJECT);
  if (/\/payable\/[^/]+$/.test(pathname)) return PAYABLE;
  if (pathname.endsWith('/payable')) return page(PAYABLE);
  if (/\/workspace\/[^/]+$/.test(pathname)) return WORKSPACE;
  return page(WORKSPACE);
}

interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly authorization: string | null;
  readonly body: string;
}

interface Stub {
  readonly transport: HttpTransport;
  readonly calls: Recorded[];
  /** Every call except the token exchanges. */
  readonly apiCalls: Recorded[];
  readonly tokenCalls: Recorded[];
}

/**
 * A transport that answers the token exchange and then serves canned bodies,
 * recording everything it was asked for.
 *
 * @param answer  Overrides the canned response for an API request. Returning
 *                `undefined` falls through to the canned one.
 */
function stub(answer?: (request: Recorded) => Response | undefined): Stub {
  const calls: Recorded[] = [];
  let minted = 0;

  const transport: HttpTransport = async (request) => {
    const recorded: Recorded = {
      method: request.method,
      url: new URL(request.url),
      authorization: request.headers.get('authorization'),
      body: await request.text(),
    };
    calls.push(recorded);

    if (recorded.url.toString() === CONFIG.tokenUrl) {
      minted += 1;
      return Response.json({ access_token: `token-${minted}`, expires_in: 86_400 });
    }

    return answer?.(recorded) ?? Response.json(cannedBody(recorded.url.pathname));
  };

  return {
    transport,
    calls,
    get apiCalls() {
      return calls.filter((call) => call.url.toString() !== CONFIG.tokenUrl);
    },
    get tokenCalls() {
      return calls.filter((call) => call.url.toString() === CONFIG.tokenUrl);
    },
  };
}

function providerOver(target: Stub, now: () => number = () => 0): RealLumanuProvider {
  return new RealLumanuProvider(CONFIG, target.transport, now);
}

/**
 * The error a call rejected with. A call that resolves fails here rather than
 * leaving the assertions below to run against a successful response and pass
 * for the wrong reason.
 */
async function refusalOf(work: Promise<unknown>): Promise<Error> {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error,
  );

  if (!(outcome instanceof Error)) {
    throw new Error('Expected the call to be refused, but it succeeded.');
  }
  return outcome;
}

/** Every read and write, so a sweep can assert something about all of them. */
async function callEveryMethod(provider: RealLumanuProvider): Promise<void> {
  await provider.listWorkspaces();
  await provider.getWorkspace(WORKSPACE_ID);
  await provider.listPartners(WORKSPACE_ID);
  await provider.getPartner(WORKSPACE_ID, PARTNER_ID);
  await provider.listPayables({ workspace_id: WORKSPACE_ID });
  await provider.getPayable(PAYABLE_ID);
  await provider.listProjects(WORKSPACE_ID);
  await provider.getProject(WORKSPACE_ID, PROJECT_ID);
  await provider.getWorkspaceBalance(WORKSPACE_ID);
  await provider.listBalanceTransactions(WORKSPACE_ID);
  await provider.approvePayable(PAYABLE_ID);
  await provider.cancelPayable(PAYABLE_ID);
  await provider.createFunding({
    workspace_id: WORKSPACE_ID,
    method: 'balance',
    payable_ids: [PAYABLE_ID],
  });
}

/**
 * Lumanu's server URL carries a path of its own — `/api/rest` — so the
 * published templates describe what comes after it.
 */
const BASE_PATH = new URL(CONFIG.baseUrl).pathname;

/** `/workspace/{id}/partner/{partnerId}` → a matcher for a filled-in path. */
function pathMatcher(template: string): RegExp {
  return new RegExp(`^${BASE_PATH}${template.replace(/\{\w+\}/g, '[^/]+')}$`);
}

describe('the routes RealLumanuProvider calls', () => {
  const paths = spec.paths as Record<string, Record<string, unknown>>;

  /**
   * The point of pinning these. A re-harvest that moves or renames an endpoint
   * fails here, in a suite that runs on every clone — rather than failing
   * against a Lumanu account nobody on this project can log into.
   */
  it.each(Object.entries(LUMANU_ROUTES))(
    '%s is a path Lumanu publishes, with that method',
    (_name, route) => {
      const operation = paths[route.path]?.[route.method.toLowerCase()];

      expect(operation).toBeDefined();
    },
  );

  it('calls one published path per interface method, and no others', async () => {
    const target = stub();

    await callEveryMethod(providerOver(target));

    const templates = Object.values(LUMANU_ROUTES).map((route) => ({
      ...route,
      matcher: pathMatcher(route.path),
    }));

    const unpublished = target.apiCalls
      .filter(
        (call) =>
          !templates.some(
            (template) =>
              template.method === call.method && template.matcher.test(call.url.pathname),
          ),
      )
      .map((call) => `${call.method} ${call.url.pathname}`);

    expect(target.apiCalls).toHaveLength(13);
    expect(unpublished).toEqual([]);
  });

  it('names each route after the method that uses it', () => {
    for (const [key, route] of Object.entries(LUMANU_ROUTES)) {
      expect(route.name).toBe(key);
    }
  });

  it('sends every request to a base URL Lumanu publishes as a server', async () => {
    const target = stub();

    await callEveryMethod(providerOver(target));

    const servers = spec.servers.map((server) => server.url);
    expect(servers).toContain(CONFIG.baseUrl);
    for (const call of target.apiCalls) {
      expect(call.url.toString().startsWith(CONFIG.baseUrl)).toBe(true);
    }
  });

  it('fills path parameters into the URL rather than sending them as a query', async () => {
    const target = stub();

    await providerOver(target).getPartner(WORKSPACE_ID, PARTNER_ID);

    const [call] = target.apiCalls;
    expect(call?.url.pathname).toBe(`/api/rest/workspace/${WORKSPACE_ID}/partner/${PARTNER_ID}`);
    expect(call?.url.search).toBe('');
  });
});

describe('authentication', () => {
  /**
   * Form-encoded, as RFC 6749 §4.4.2 defines the grant. Lumanu publishes no
   * token endpoint among the fourteen harvested pages, so the standard is the
   * only thing available to be right about here — and a server that also takes
   * JSON takes this too, while the reverse does not hold.
   */
  it('obtains a token with the client_credentials grant before the first call', async () => {
    const target = stub();

    await providerOver(target).listWorkspaces();

    const [token] = target.tokenCalls;
    expect(token?.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(token?.body ?? ''))).toEqual({
      grant_type: 'client_credentials',
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      audience: CONFIG.audience,
    });
  });

  it('carries the token on every request, reads and writes alike', async () => {
    const target = stub();

    await callEveryMethod(providerOver(target));

    for (const call of target.apiCalls) {
      expect(call.authorization).toBe('Bearer token-1');
    }
  });

  /**
   * Lumanu's tokens last 24 hours. Minting one per request would be slow, rude,
   * and — in a Lambda serving a burst — a way to get rate-limited by the
   * authorization server rather than by the API.
   */
  it('mints one token and reuses it across every call', async () => {
    const target = stub();

    await callEveryMethod(providerOver(target));

    expect(target.tokenCalls).toHaveLength(1);
  });

  it('mints one token for concurrent callers, not one each', async () => {
    const target = stub();
    const provider = providerOver(target);

    await Promise.all([
      provider.listWorkspaces(),
      provider.listPartners(WORKSPACE_ID),
      provider.getPayable(PAYABLE_ID),
    ]);

    expect(target.tokenCalls).toHaveLength(1);
  });

  it('renews the token before it expires rather than after', async () => {
    const target = stub();
    let clock = 0;
    const provider = providerOver(target, () => clock);

    await provider.listWorkspaces();
    // A minute before the 24-hour token lapses, so a request already in flight
    // cannot be the one that discovers it has expired.
    clock = 86_400_000 - 60_000;
    await provider.listWorkspaces();

    expect(target.tokenCalls).toHaveLength(2);
    expect(target.apiCalls[1]?.authorization).toBe('Bearer token-2');
  });

  /**
   * A token that says nothing about its lifetime is assumed to be short-lived
   * rather than eternal. The alternative — caching it forever — fails much
   * later and much more confusingly, as a run of 401s from a token that lapsed.
   */
  it('assumes an hour when the grant does not say how long the token lasts', async () => {
    const granting = (): Response => Response.json({ access_token: 'token-1' });
    let clock = 0;
    const calls: string[] = [];
    const transport: HttpTransport = (request) => {
      calls.push(request.url);
      return Promise.resolve(
        request.url === CONFIG.tokenUrl ? granting() : Response.json(cannedBody('/workspace')),
      );
    };
    const provider = new RealLumanuProvider(CONFIG, transport, () => clock);

    await provider.listWorkspaces();
    clock = 3_600_000 - 60_000;
    await provider.listWorkspaces();

    expect(calls.filter((url) => url === CONFIG.tokenUrl)).toHaveLength(2);
  });

  it('fails by name when the grant carries no token at all', async () => {
    const transport: HttpTransport = (request) =>
      Promise.resolve(
        request.url === CONFIG.tokenUrl
          ? Response.json({ token_type: 'Bearer' })
          : Response.json(cannedBody('/workspace')),
      );

    const error = await refusalOf(new RealLumanuProvider(CONFIG, transport).listWorkspaces());

    expect(error.message).toContain('access_token');
  });

  it('does not put the client secret in the error when the token exchange fails', async () => {
    const target = stub();
    const failing: HttpTransport = (request) =>
      new URL(request.url).toString() === CONFIG.tokenUrl
        ? Promise.resolve(new Response(`invalid_client: ${CONFIG.clientSecret}`, { status: 401 }))
        : target.transport(request);
    const provider = new RealLumanuProvider(CONFIG, failing);

    const error = await refusalOf(provider.listWorkspaces());

    expect(error.message).toContain('401');
    expect(error.message).not.toContain(CONFIG.clientSecret);
  });
});

describe('paging and ordering', () => {
  it("applies Lumanu's defaults when the caller asks for none", async () => {
    const target = stub();

    await providerOver(target).listWorkspaces();

    const query = target.apiCalls[0]?.url.searchParams;
    expect(query?.get('limit')).toBe('25');
    expect(query?.get('offset')).toBe('0');
    expect(query?.get('order_by')).toBe('created_at');
    expect(query?.get('order_by_direction')).toBe('asc');
  });

  it('passes the paging and ordering it was given', async () => {
    const target = stub();

    await providerOver(target).listPartners(WORKSPACE_ID, {
      limit: 5,
      offset: 10,
      order_by: 'name',
      order_by_direction: 'desc',
    });

    const query = target.apiCalls[0]?.url.searchParams;
    expect(query?.get('limit')).toBe('5');
    expect(query?.get('order_by')).toBe('name');
    expect(query?.get('order_by_direction')).toBe('desc');
  });

  /**
   * Payables are the one collection Lumanu scopes by query parameter rather
   * than by path — an asymmetry the interface preserves rather than smooths
   * over, precisely so that this provider can be written against it.
   */
  it('scopes Payables by query parameter, which is how Lumanu scopes them', async () => {
    const target = stub();

    await providerOver(target).listPayables({
      workspace_id: WORKSPACE_ID,
      project_id: PROJECT_ID,
    });

    const query = target.apiCalls[0]?.url.searchParams;
    expect(query?.get('workspace_id')).toBe(WORKSPACE_ID);
    expect(query?.get('project_id')).toBe(PROJECT_ID);
  });

  it('filters Balance Transactions by type, the one filter Lumanu publishes', async () => {
    const target = stub();

    await providerOver(target).listBalanceTransactions(WORKSPACE_ID, { type: 'payment' });

    expect(target.apiCalls[0]?.url.searchParams.get('type')).toBe('payment');
  });

  /**
   * Refused here rather than passed to Lumanu, so that all three
   * implementations answer an unsupported order the same way. Lumanu would
   * probably refuse it too, but "probably" is not something a contract suite
   * can hold two implementations to.
   */
  it('refuses an order it cannot honour without spending a request on it', async () => {
    const target = stub();

    await expect(
      providerOver(target).listPartners(WORKSPACE_ID, { order_by: 'salary' }),
    ).rejects.toThrow(LumanuQueryError);
    expect(target.calls).toHaveLength(0);
  });
});

describe('what comes back', () => {
  /**
   * The provider returns exact Lumanu wire format, so a response body needs no
   * mapping at all — and a test that the body survives the boundary untouched
   * is a test that no mapping crept in. This is the thing that would have to be
   * rewritten if the interface had been designed around a tidier model.
   */
  it('returns Lumanu’s body unreshaped', async () => {
    const target = stub();

    const workspace = await providerOver(target).getWorkspace(WORKSPACE_ID);

    expect(workspace).toEqual(WORKSPACE);
    expectMatchesLumanuSchema('Workspace', workspace);
  });

  it('returns the list envelope Lumanu sends, not a bare array', async () => {
    const target = stub();

    const result = await providerOver(target).listPayables({ workspace_id: WORKSPACE_ID });

    expect(Object.keys(result).sort()).toEqual(['data', 'limit', 'offset', 'total']);
    for (const payable of result.data ?? []) expectMatchesLumanuSchema('Payable', payable);
  });

  /**
   * The write's own answer, not a re-read of the record afterwards. The stub
   * answers `/approve` with a body distinguishable from what `GET /payable/{id}`
   * would return, so a provider that quietly followed up with a read would fail
   * here rather than pass on a coincidence.
   */
  it('answers a write with the write’s own response, without a second read', async () => {
    const approved = { ...PAYABLE, status: 'approved', description: 'answered by approve' };
    const target = stub((request) =>
      request.url.pathname.endsWith('/approve') ? Response.json(approved) : undefined,
    );

    const payable = await providerOver(target).approvePayable(PAYABLE_ID);

    expectMatchesLumanuSchema('Payable', payable);
    expect(payable.description).toBe('answered by approve');
    expect(target.apiCalls).toHaveLength(1);
  });

  it('sends the Funding request as Lumanu documents it', async () => {
    const target = stub();

    const funding = await providerOver(target).createFunding({
      workspace_id: WORKSPACE_ID,
      method: 'balance',
      payable_ids: [PAYABLE_ID],
    });

    expect(JSON.parse(target.apiCalls[0]?.body ?? '{}')).toEqual({
      workspace_id: WORKSPACE_ID,
      method: 'balance',
      payable_ids: [PAYABLE_ID],
    });
    expectMatchesLumanuSchema('Funding', funding);
  });
});

describe('refusals', () => {
  const answering = (status: number, body = ''): Stub =>
    stub(() => new Response(body, { status }));

  it('turns a 404 on a single read into a named not-found', async () => {
    const target = answering(404);

    const error = await refusalOf(providerOver(target).getPayable(PAYABLE_ID));

    expect(error).toBeInstanceOf(LumanuNotFoundError);
    expect((error as LumanuNotFoundError).resource).toBe('Payable');
    expect((error as LumanuNotFoundError).id).toBe(PAYABLE_ID);
  });

  /**
   * A list has no missing record to name. Lumanu declares a 404 on only two of
   * the fourteen harvested operations, both single reads, so a 404 from a list
   * endpoint is something unexplained rather than an empty scope — and dressing
   * it as a not-found would tell a caller to fix an identifier that is fine.
   */
  it('does not dress an unexplained 404 on a list as a missing record', async () => {
    const target = answering(404);

    const error = await refusalOf(providerOver(target).listPartners(WORKSPACE_ID));

    expect(error).toBeInstanceOf(LumanuApiError);
    expect(error).not.toBeInstanceOf(LumanuNotFoundError);
  });

  it('reads a 409 on a write as a refused transition', async () => {
    const target = answering(409, 'already funded');

    const error = await refusalOf(providerOver(target).approvePayable(PAYABLE_ID));

    expect(error).toBeInstanceOf(LumanuInvalidStateError);
    expect((error as LumanuInvalidStateError).resource).toBe('Payable');
  });

  it('names the Funding when a Funding is the thing refused', async () => {
    const target = answering(409, 'the balance moved');

    const error = await refusalOf(
      providerOver(target).createFunding({
        workspace_id: WORKSPACE_ID,
        method: 'balance',
        payable_ids: [PAYABLE_ID],
      }),
    );

    expect(error).toBeInstanceOf(LumanuInvalidStateError);
    expect((error as LumanuInvalidStateError).resource).toBe('Funding');
  });

  /**
   * Only a write can refuse a transition, so a `409` from a read is not one —
   * it is something unexplained, and reporting it as a bad transition would
   * tell a caller to go and fix a state that is fine.
   */
  it('does not read a 409 on a read as a refused transition', async () => {
    const target = answering(409);

    const error = await refusalOf(providerOver(target).getPayable(PAYABLE_ID));

    expect(error).toBeInstanceOf(LumanuApiError);
    expect(error).not.toBeInstanceOf(LumanuInvalidStateError);
  });

  /**
   * The status is the more useful half of a failure. A body that cannot be read
   * must not replace "Lumanu said 500" with an unattributable transport error.
   */
  it('still reports the status when the error body cannot be read', async () => {
    const unreadable = new ReadableStream({
      start: (controller) => controller.error(new Error('the connection dropped')),
    });
    const target = stub(() => new Response(unreadable, { status: 500 }));

    const error = await refusalOf(providerOver(target).getWorkspace(WORKSPACE_ID));

    expect(error).toBeInstanceOf(LumanuApiError);
    expect((error as LumanuApiError).status).toBe(500);
    expect(error.message).toContain('(no body)');
  });

  /**
   * Lumanu's own endpoint for the Workspace Balance contains a word this
   * project's glossary bans, and a fault is rethrown by the tool wrapper rather
   * than answered as a refusal — so its message is the one thing here an agent
   * can read. It names the operation instead; the path stays on the error for
   * the log line.
   */
  it('names the operation rather than the path, which an agent can read', async () => {
    const target = answering(500);

    const error = await refusalOf(providerOver(target).getWorkspaceBalance(WORKSPACE_ID));

    expect(error.message).toContain('getWorkspaceBalance');
    expect(error.message).not.toMatch(/wallet/i);
    expect((error as LumanuApiError).path).toContain('/wallet');
  });

  /**
   * Lumanu publishes no error body, so every other status arrives as a fault
   * carrying what Lumanu actually said. Sorting those into refusal kinds would
   * mean inventing a contract — the one thing this project has refused to do
   * everywhere else. See the discovery note.
   */
  it('reports any other failure with what Lumanu said, rather than guessing a kind', async () => {
    const target = answering(500, 'upstream exploded');

    const error = await refusalOf(providerOver(target).getWorkspace(WORKSPACE_ID));

    expect(error).toBeInstanceOf(LumanuApiError);
    expect((error as LumanuApiError).status).toBe(500);
    expect((error as LumanuApiError).path).toContain('/workspace/');
    expect(error.message).toContain('upstream exploded');
  });

  /**
   * Refused here rather than by Lumanu, and in the same order as every other
   * implementation — the contract suite asserts that order, so an unsupported
   * method must be reported before an identifier is looked up.
   */
  it.each([
    ['invoice funding, which this POC does not model', { method: 'invoice' as const }],
    ['a Funding naming no Payables', { payable_ids: [] }],
  ])('refuses %s without spending a request on it', async (_name, invalid) => {
    const target = stub();

    await expect(
      providerOver(target).createFunding({
        workspace_id: WORKSPACE_ID,
        method: 'balance',
        payable_ids: [PAYABLE_ID],
        ...invalid,
      }),
    ).rejects.toThrow(LumanuInvalidInputError);
    expect(target.calls).toHaveLength(0);
  });
});
