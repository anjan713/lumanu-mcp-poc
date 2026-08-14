/**
 * `LumanuProvider` over Lumanu's own REST API.
 *
 * This is the other half of the project's central claim. Nothing above the
 * provider boundary changes when this replaces `MockLumanuProvider`: the MCP
 * tools, their descriptions, the domain reasoning, the transport, the
 * authentication and the logging are all written against the interface rather
 * than against either implementation.
 *
 * **It is a skeleton, and it is unexercised.** Lumanu issues credentials on
 * request only — there is no self-serve signup — so this project has no sandbox
 * account. What is proven here is that it compiles against the same interface,
 * that the paths it calls are the ones Lumanu publishes, and that it maps
 * Lumanu's answers back without reshaping them. What is *not* proven is that
 * Lumanu behaves as expected at the other end, and no amount of local testing
 * could prove that. `tests/integration/real-provider.test.ts` runs the shared
 * contract suite against this class the moment credentials exist.
 *
 * The class is deliberately thin. Because `LumanuProvider` returns exact Lumanu
 * wire format (ADR 0001), a response body needs no mapping at all — the work
 * `MockLumanuProvider` does in `to-wire.ts` exists only because rows are not
 * Lumanu-shaped, and here they already are. That thinness is the evidence: had
 * the interface been designed around a tidier internal model, this file would
 * be a second translation layer written against a contract nobody here can run.
 */

import type { LumanuApiConfig } from '@/config';

import {
  LumanuInvalidInputError,
  LumanuInvalidStateError,
  LumanuNotFoundError,
  resolveOrder,
  type Collection,
  type ListQuery,
  type LumanuProvider,
  type PayableQuery,
  type TransactionQuery,
} from './lumanu-provider';
import { LIST_DEFAULTS } from './lumanu-provider';
import type {
  ApprovePayableResponse,
  CancelPayableResponse,
  CreateFundingRequest,
  CreateFundingResponse,
  GetPartnerResponse,
  GetPayableResponse,
  GetProjectResponse,
  GetWorkspaceBalanceResponse,
  GetWorkspaceResponse,
  ListBalanceTransactionsResponse,
  ListPartnersResponse,
  ListPayablesResponse,
  ListProjectsResponse,
  ListWorkspacesResponse,
} from './wire';

/**
 * How this provider reaches the network.
 *
 * A constructor seam rather than a mocked global. No test in this project stubs
 * `fetch` or `node:https`: an earlier attempt to do that for the Auth0 JWKS
 * failed silently because jose does not use `fetch` at all, and the lesson was
 * to substitute the dependency rather than the transport underneath it. Here
 * the substitution is what lets a test drive every path this class builds
 * without a Lumanu account.
 */
export type HttpTransport = (request: Request) => Promise<Response>;

/**
 * Lumanu's paths, exactly as the harvested fragments declare them.
 *
 * Written as templates rather than assembled inline so that the set can be
 * checked against `docs/lumanu-reference/openapi.json` — a re-harvest that
 * moves an endpoint then fails a test here instead of failing in production
 * against an account nobody here can log into. `/payable` is the collection,
 * not `/payables`, and approve and cancel are POST; both were open questions
 * that the harvest closed.
 */
export const LUMANU_ROUTES = {
  listWorkspaces: { name: 'listWorkspaces', method: 'GET', path: '/workspace' },
  getWorkspace: { name: 'getWorkspace', method: 'GET', path: '/workspace/{id}' },
  listPartners: { name: 'listPartners', method: 'GET', path: '/workspace/{id}/partner' },
  getPartner: { name: 'getPartner', method: 'GET', path: '/workspace/{id}/partner/{partnerId}' },
  listPayables: { name: 'listPayables', method: 'GET', path: '/payable' },
  getPayable: { name: 'getPayable', method: 'GET', path: '/payable/{id}' },
  listProjects: { name: 'listProjects', method: 'GET', path: '/workspace/{id}/project' },
  getProject: { name: 'getProject', method: 'GET', path: '/workspace/{id}/project/{projectId}' },
  getWorkspaceBalance: { name: 'getWorkspaceBalance', method: 'GET', path: '/workspace/{id}/wallet' },
  listBalanceTransactions: {
    name: 'listBalanceTransactions',
    method: 'GET',
    path: '/workspace/{id}/wallet/transaction',
  },
  approvePayable: { name: 'approvePayable', method: 'POST', path: '/payable/{id}/approve' },
  cancelPayable: { name: 'cancelPayable', method: 'POST', path: '/payable/{id}/cancel' },
  createFunding: { name: 'createFunding', method: 'POST', path: '/funding' },
} as const satisfies Record<string, { name: string; method: 'GET' | 'POST'; path: string }>;

export type LumanuRoute = (typeof LUMANU_ROUTES)[keyof typeof LUMANU_ROUTES];

/** What a single-resource read is about, so a `404` can name it. */
interface Subject {
  readonly resource: string;
  readonly id: string;
}

/**
 * A Lumanu response this provider cannot turn into one of the four refusal
 * kinds — a fault rather than a refusal.
 *
 * The refusal kinds exist so that a caller can respond differently to a wrong
 * identifier, a malformed request, a bad transition and a shortfall. Lumanu
 * publishes no error contract to map them from: of the fourteen harvested
 * operations only two declare any error status at all, both `404`, and none
 * declares an error body. So `404` is mapped because Lumanu declares it, and
 * everything else arrives here with the status and body intact rather than
 * being sorted into a kind this project invented. See the discovery note.
 *
 * The message names the **operation**, and the path is carried as a field for
 * the log line. A fault is rethrown by the tool wrapper rather than answered as
 * a refusal, so its message reaches the agent — and Lumanu serves the Workspace
 * Balance from a path containing the word this project's glossary bans. The
 * operation name is the more useful half of that message anyway.
 */
export class LumanuApiError extends Error {
  public override readonly name = 'LumanuApiError';

  public constructor(
    public readonly status: number,
    public readonly operation: string,
    public readonly method: string,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`Lumanu answered ${status} to ${method} ${operation}: ${body || '(no body)'}`);
  }
}

/** An OAuth token and the moment it stops being usable. */
interface CachedToken {
  readonly value: string;
  readonly expiresAt: number;
}

/**
 * Tokens are renewed this long before they expire, so a request is never sent
 * with one that lapses in flight.
 */
const RENEW_BEFORE_MS = 60_000;

/** Lumanu's tokens last 24 hours; this is the floor if the response omits it. */
const DEFAULT_LIFETIME_SECONDS = 3_600;

/**
 * Every method here is `async`, including the ones whose body is a single
 * `return`. That is not decoration: `resolveOrder` and the funding checks throw
 * before any request is sent, and a `Promise`-returning method that throws
 * synchronously is refused by `.catch` and by `expect(...).rejects` alike. The
 * other implementations are async throughout, so a synchronous throw here would
 * be a divergence the shared contract suite is written to catch — and did.
 */
export class RealLumanuProvider implements LumanuProvider {
  private token: CachedToken | undefined;
  /** The in-flight token request, so concurrent callers mint one token, not many. */
  private pending: Promise<string> | undefined;

  public constructor(
    private readonly config: LumanuApiConfig,
    private readonly transport: HttpTransport = (request) => fetch(request),
    private readonly now: () => number = Date.now,
  ) {}

  public async listWorkspaces(query?: ListQuery): Promise<ListWorkspacesResponse> {
    return this.send(LUMANU_ROUTES.listWorkspaces, { query: listParams('workspaces', query) });
  }

  public async getWorkspace(id: string): Promise<GetWorkspaceResponse> {
    return this.send(LUMANU_ROUTES.getWorkspace, {
      params: { id },
      subject: { resource: 'Workspace', id },
    });
  }

  public async listPartners(workspaceId: string, query?: ListQuery): Promise<ListPartnersResponse> {
    return this.send(LUMANU_ROUTES.listPartners, {
      params: { id: workspaceId },
      query: listParams('partners', query),
    });
  }

  public async getPartner(workspaceId: string, partnerId: string): Promise<GetPartnerResponse> {
    return this.send(LUMANU_ROUTES.getPartner, {
      params: { id: workspaceId, partnerId },
      subject: { resource: 'Partner', id: partnerId },
    });
  }

  public async listPayables(query?: PayableQuery): Promise<ListPayablesResponse> {
    return this.send(LUMANU_ROUTES.listPayables, {
      query: {
        ...listParams('payables', query),
        // Payables are the one collection Lumanu scopes by query parameter
        // rather than by path, and it publishes no status filter — which is why
        // `list_payables` filters above the provider boundary.
        ...optional('workspace_id', query?.workspace_id),
        ...optional('project_id', query?.project_id),
      },
    });
  }

  public async getPayable(id: string): Promise<GetPayableResponse> {
    return this.send(LUMANU_ROUTES.getPayable, {
      params: { id },
      subject: { resource: 'Payable', id },
    });
  }

  public async listProjects(workspaceId: string, query?: ListQuery): Promise<ListProjectsResponse> {
    return this.send(LUMANU_ROUTES.listProjects, {
      params: { id: workspaceId },
      query: listParams('projects', query),
    });
  }

  public async getProject(workspaceId: string, projectId: string): Promise<GetProjectResponse> {
    return this.send(LUMANU_ROUTES.getProject, {
      params: { id: workspaceId, projectId },
      subject: { resource: 'Project', id: projectId },
    });
  }

  public async getWorkspaceBalance(workspaceId: string): Promise<GetWorkspaceBalanceResponse> {
    return this.send(LUMANU_ROUTES.getWorkspaceBalance, {
      params: { id: workspaceId },
      subject: { resource: 'Workspace', id: workspaceId },
    });
  }

  public async listBalanceTransactions(
    workspaceId: string,
    query?: TransactionQuery,
  ): Promise<ListBalanceTransactionsResponse> {
    return this.send(LUMANU_ROUTES.listBalanceTransactions, {
      params: { id: workspaceId },
      query: { ...listParams('transactions', query), ...optional('type', query?.type) },
    });
  }

  // --- Writes ---------------------------------------------------------------

  public async approvePayable(id: string): Promise<ApprovePayableResponse> {
    return this.send(LUMANU_ROUTES.approvePayable, {
      params: { id },
      subject: { resource: 'Payable', id },
    });
  }

  public async cancelPayable(id: string): Promise<CancelPayableResponse> {
    return this.send(LUMANU_ROUTES.cancelPayable, {
      params: { id },
      subject: { resource: 'Payable', id },
    });
  }

  public async createFunding(request: CreateFundingRequest): Promise<CreateFundingResponse> {
    // Checked here rather than left to Lumanu, and in the same order as every
    // other implementation, because the contract suite asserts that order: an
    // unsupported method must be reported as invalid input before an identifier
    // is looked up, so the two answers cannot depend on which check runs first.
    if (request.method !== 'balance') {
      throw new LumanuInvalidInputError(
        'Only method "balance" is supported. Invoice funding is out of scope for this POC.',
      );
    }
    if ((request.payable_ids ?? []).length === 0) {
      throw new LumanuInvalidInputError('payable_ids is required when method is "balance".');
    }

    return this.send(LUMANU_ROUTES.createFunding, {
      subject: { resource: 'Funding', id: request.workspace_id ?? '' },
      body: request,
    });
  }

  /**
   * One request, with the bearer token attached and the response handed back
   * exactly as Lumanu sent it.
   *
   * `subject` is what a failure would be about. The list endpoints omit it
   * deliberately: a scoped list answers an unknown scope with an empty page
   * rather than a failure, so a `404` from one is something unexplained rather
   * than a missing record — see the rule on `LumanuNotFoundError`.
   */
  private async send<Body>(
    route: LumanuRoute,
    options: {
      readonly params?: Record<string, string>;
      readonly query?: Record<string, string>;
      readonly subject?: Subject;
      readonly body?: unknown;
    } = {},
  ): Promise<Body> {
    const { params = {}, query = {}, subject, body } = options;
    const path = fillPath(route.path, params);
    const url = new URL(`${this.config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const response = await this.transport(
      new Request(url.toString(), {
        method: route.method,
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

    if (!response.ok) {
      throw await this.failure(response, route, path, subject);
    }

    return (await response.json()) as Body;
  }

  private async failure(
    response: Response,
    route: LumanuRoute,
    path: string,
    subject: Subject | undefined,
  ): Promise<Error> {
    // A body that cannot be read must not replace the status with a transport
    // error: the status is the more useful half, and losing it would turn a
    // clear "Lumanu said 500" into something unattributable.
    const text = await response.text().catch(() => '');

    if (subject === undefined) {
      return new LumanuApiError(response.status, route.name, route.method, path, text);
    }

    if (response.status === 404) {
      return new LumanuNotFoundError(subject.resource, subject.id);
    }

    // A write refused because of the record's current state is the one other
    // refusal that can be recognised without inventing a contract: `409` means
    // exactly that in HTTP, and only a write can produce one. The state is
    // reported as unknown because Lumanu publishes no error body to read it
    // from, and guessing it would be worse than admitting it.
    if (response.status === 409 && route.method === 'POST') {
      return new LumanuInvalidStateError(
        subject.resource,
        subject.id,
        'unknown',
        text || 'Lumanu refused this transition.',
      );
    }

    return new LumanuApiError(response.status, route.name, route.method, path, text);
  }

  /**
   * A bearer token for the `client_credentials` grant, cached until shortly
   * before it expires.
   *
   * Lumanu's tokens last 24 hours, so minting one per request would be both
   * slow and rude. The in-flight promise is shared rather than the result
   * alone: a cold Lambda container serving concurrent requests would otherwise
   * mint one token per request and cache the last to finish.
   */
  private async accessToken(): Promise<string> {
    const cached = this.token;
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return cached.value;
    }

    this.pending ??= this.mintToken().finally(() => {
      this.pending = undefined;
    });

    return this.pending;
  }

  /**
   * Form-encoded, not JSON. RFC 6749 §4.4.2 defines the `client_credentials`
   * request as `application/x-www-form-urlencoded`, and since Lumanu publishes
   * no token endpoint at all this is the one part of the exchange that can be
   * got right from a standard rather than guessed. Servers that also accept
   * JSON accept this too; the reverse is not true.
   */
  private async mintToken(): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      ...(this.config.audience === undefined ? {} : { audience: this.config.audience }),
    });

    const response = await this.transport(
      new Request(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: form.toString(),
      }),
    );

    if (!response.ok) {
      // The body is deliberately not carried into the message: a failed token
      // exchange can echo back what was sent, and what was sent is the client
      // secret.
      throw new Error(
        `Could not obtain a Lumanu access token: the token endpoint answered ${response.status}.`,
      );
    }

    const granted = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (granted.access_token === undefined) {
      throw new Error('The Lumanu token endpoint returned no access_token.');
    }

    // No floor on the result. A token shorter-lived than the renewal window
    // gives a negative offset and is therefore already expired, which is the
    // correct answer: it is renewed on the next call. Clamping to zero would
    // produce the same behaviour by a longer route.
    const lifetime = (granted.expires_in ?? DEFAULT_LIFETIME_SECONDS) * 1_000;
    this.token = {
      value: granted.access_token,
      expiresAt: this.now() + lifetime - RENEW_BEFORE_MS,
    };

    return granted.access_token;
  }
}

/**
 * Lumanu's paging and ordering, as query parameters.
 *
 * `resolveOrder` is called rather than passing `order_by` through, so that an
 * unsupported field is refused here exactly as it is by every other
 * implementation. Lumanu would probably refuse it too, but "probably" is not
 * something the contract suite can hold two implementations to.
 */
function listParams(collection: Collection, query: ListQuery | undefined): Record<string, string> {
  const { field, direction } = resolveOrder(collection, query);

  return {
    limit: String(query?.limit ?? LIST_DEFAULTS.limit),
    offset: String(query?.offset ?? LIST_DEFAULTS.offset),
    order_by: field,
    order_by_direction: direction,
  };
}

function optional(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

/** `/workspace/{id}/partner/{partnerId}` → `/workspace/abc/partner/def`. */
function fillPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`No value for {${name}} in ${template}.`);
    }
    return encodeURIComponent(value);
  });
}
