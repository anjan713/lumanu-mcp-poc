/**
 * The swap boundary.
 *
 * Everything above this interface — MCP tools, domain services, transport,
 * authentication, logging — is written once and never changes when the data
 * behind it changes. Today `MockLumanuProvider` satisfies it out of Supabase.
 * Tomorrow `RealLumanuProvider` satisfies it out of Lumanu's REST API. That is
 * the whole claim of this project, and one contract suite runs against every
 * implementation so the claim is tested rather than asserted.
 *
 * Every return type resolves to a schema harvested from Lumanu's own reference
 * pages, so these methods return **exact Lumanu wire format**: snake_case,
 * Lumanu's enums, Lumanu's nullability, Lumanu's `{ data, total, limit, offset }`
 * envelope. No tidier internal model exists to convert to. See ADR 0001.
 *
 * The method set mirrors Lumanu's endpoints one for one, including their
 * asymmetries — Payables are scoped by a query parameter while Partners,
 * Projects and the Workspace Balance are scoped by a path parameter. Smoothing
 * that over would be a small kindness now and a lie when `RealLumanuProvider`
 * arrives.
 *
 * What is *not* here is as deliberate: no filter by Payable status, and no
 * derived total, readiness or capacity. Lumanu publishes no status filter, and
 * a provider that invented one would be doing domain work at the wire boundary.
 * Those belong in `src/domain`, computed from what these methods return.
 */

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
  TransactionType,
} from './wire';

/**
 * Lumanu's list parameters, as published. `limit` defaults to 25 and `offset`
 * to 0 — those defaults belong to Lumanu, so every implementation applies them
 * rather than each caller repeating them.
 */
export interface ListQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly order_by?: string;
  readonly order_by_direction?: 'asc' | 'desc';
}

/**
 * Payables are the one collection Lumanu does not scope by path. Its filters
 * are `workspace_id` and `project_id` and nothing else — in particular there is
 * no status filter, which is why `list_payables` filters above this boundary.
 */
export interface PayableQuery extends ListQuery {
  readonly workspace_id?: string;
  readonly project_id?: string;
}

/** Balance Transactions are the one collection Lumanu does filter, by type. */
export interface TransactionQuery extends ListQuery {
  readonly type?: TransactionType;
}

export const LIST_DEFAULTS = { limit: 25, offset: 0 } as const;

/**
 * The kinds a caller can respond to differently: fix the identifier, fix the
 * request, clear the blocking state, or wait for money. Anything outside this
 * set is a fault rather than a refusal, and is not dressed up as one.
 */
export type LumanuErrorKind =
  | 'not_found'
  | 'invalid_input'
  | 'invalid_state'
  | 'insufficient_balance';

/**
 * The base every refusal shares.
 *
 * `kind` lives on the error rather than in a lookup table beside it, so a new
 * subclass cannot leave a caller matching on a name it has never heard of.
 * `detail()` carries what that kind needs a caller to act on — the amounts for
 * a shortfall, the current state for a bad transition — for the same reason:
 * one place decides, rather than an `instanceof` ladder at every call site.
 */
export abstract class LumanuError extends Error {
  public abstract readonly kind: LumanuErrorKind;

  public detail(): Record<string, unknown> {
    return {};
  }
}

/**
 * Lumanu publishes `order_by` as a free-form string and documents no default.
 * Every implementation here sorts by `created_at` ascending unless told
 * otherwise, so that a page from the fixture and a page from the database are
 * the same page — without a shared default the contract suite could only
 * compare sets, and paging assertions would be meaningless.
 */
export const ORDER_DEFAULTS = { order_by: 'created_at', order_by_direction: 'asc' } as const;

/**
 * The wire fields each collection may be ordered by.
 *
 * A closed set rather than a passthrough. `MockLumanuProvider` turns these into
 * SQL identifiers, so accepting an arbitrary string would be both an injection
 * surface and a promise no implementation could keep — the fixture cannot sort
 * by a column it does not hold.
 */
export const ORDERABLE_FIELDS = {
  workspaces: ['created_at', 'updated_at', 'display_name'],
  partners: ['created_at', 'updated_at', 'name', 'status'],
  payables: ['created_at', 'updated_at', 'amount', 'status'],
  projects: ['created_at', 'updated_at', 'name'],
  transactions: ['created_at', 'amount'],
} as const satisfies Record<string, readonly string[]>;

export type Collection = keyof typeof ORDERABLE_FIELDS;

/**
 * How every implementation answers an identifier that names nothing.
 *
 * **A single-resource read fails. A scoped list returns an empty page.**
 *
 * Lumanu's published contract does not settle this: of the fourteen harvested
 * operations, only `get-workspace-partner` and `get-workspace-project` declare
 * a 404 at all, and the rest are silent — the same permissiveness recorded in
 * the OpenAPI drift note. So the rule is argued rather than derived.
 *
 * A list has a coherent empty representation and `{ data: [], total: 0 }` is a
 * true statement about a Workspace that holds nothing. A single read has none:
 * there is no empty Partner. Verifying the Workspace before every list would
 * also cost a second round trip per call, in Lambda, to guard a case the domain
 * services already catch — `workspaceOverview` reads the Workspace first, and
 * fails there.
 *
 * The contract suite holds both implementations to this, which is how the two
 * were found disagreeing about it in the first place.
 *
 * Raised only by the single-resource reads, and distinguishable from a
 * transport failure.
 */
export class LumanuNotFoundError extends LumanuError {
  public override readonly name = 'LumanuNotFoundError';
  public override readonly kind = 'not_found';

  public constructor(
    public readonly resource: string,
    public readonly id: string,
  ) {
    super(`No ${resource} with id ${id}`);
  }

  public override detail(): Record<string, unknown> {
    return { resource: this.resource, id: this.id };
  }
}

/**
 * Raised when a query asks for something no implementation can answer — an
 * order by a field none of them holds, for instance. Malformed rather than
 * merely unsatisfiable, so it reads as invalid input.
 */
export class LumanuQueryError extends LumanuError {
  public override readonly name = 'LumanuQueryError';
  public override readonly kind = 'invalid_input';
}

/**
 * Raised when a write asks for a transition the record's current state does not
 * allow — approving something already funded, cancelling something already
 * paid for, funding something nobody approved.
 *
 * Distinct from a not-found and from a shortfall because the responses differ:
 * a not-found means the identifier is wrong, a shortfall means wait or add
 * money, and this means the request was answerable but wrong to make. An agent
 * that cannot tell them apart can only retry blindly.
 */
export class LumanuInvalidStateError extends LumanuError {
  public override readonly name = 'LumanuInvalidStateError';
  public override readonly kind = 'invalid_state';

  public constructor(
    public readonly resource: string,
    public readonly id: string,
    public readonly currentState: string,
    detail: string,
  ) {
    super(`${resource} ${id} is ${currentState}: ${detail}`);
  }

  public override detail(): Record<string, unknown> {
    return { resource: this.resource, id: this.id, current_state: this.currentState };
  }
}

/** Raised when the Workspace Balance does not cover what a Funding would draw. */
export class LumanuInsufficientBalanceError extends LumanuError {
  public override readonly name = 'LumanuInsufficientBalanceError';
  public override readonly kind = 'insufficient_balance';

  public constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(
      `Funding needs ${required} but only ${available} is available — ` +
        `short by ${required - available}.`,
    );
  }

  public override detail(): Record<string, unknown> {
    return {
      required: this.required,
      available: this.available,
      shortfall: this.required - this.available,
    };
  }
}

/** Raised when a request is malformed rather than merely unsatisfiable. */
export class LumanuInvalidInputError extends LumanuError {
  public override readonly name = 'LumanuInvalidInputError';
  public override readonly kind = 'invalid_input';
}

export interface LumanuProvider {
  listWorkspaces(query?: ListQuery): Promise<ListWorkspacesResponse>;
  getWorkspace(id: string): Promise<GetWorkspaceResponse>;

  listPartners(workspaceId: string, query?: ListQuery): Promise<ListPartnersResponse>;
  getPartner(workspaceId: string, partnerId: string): Promise<GetPartnerResponse>;

  listPayables(query?: PayableQuery): Promise<ListPayablesResponse>;
  getPayable(id: string): Promise<GetPayableResponse>;

  listProjects(workspaceId: string, query?: ListQuery): Promise<ListProjectsResponse>;
  getProject(workspaceId: string, projectId: string): Promise<GetProjectResponse>;

  /** The Workspace Balance. Lumanu serves it as an `Account`, not on the Workspace. */
  getWorkspaceBalance(workspaceId: string): Promise<GetWorkspaceBalanceResponse>;
  listBalanceTransactions(
    workspaceId: string,
    query?: TransactionQuery,
  ): Promise<ListBalanceTransactionsResponse>;

  // --- Writes -------------------------------------------------------------
  //
  // Each validates the record's current state before acting and returns the
  // resulting state, so a caller never has to re-read to find out what
  // happened. Rejections arrive as the typed errors above.

  approvePayable(id: string): Promise<ApprovePayableResponse>;
  cancelPayable(id: string): Promise<CancelPayableResponse>;

  /**
   * Draws from the Workspace Balance to pay a set of approved Payables, moving
   * each to `will_pay` and recording a Balance Transaction.
   *
   * All or nothing. A failure part-way must leave the balance and the Payable
   * statuses consistent with each other — see ADR 0005 for why the mock
   * implements this as a PostgreSQL function rather than a Hasura mutation.
   *
   * Idempotent by state rather than by key: a Payable already funded is a
   * no-op, so a retried request cannot debit twice.
   */
  createFunding(request: CreateFundingRequest): Promise<CreateFundingResponse>;
}

/**
 * Checks an `order_by` against what the collection supports, and returns the
 * ordering to apply.
 *
 * Rejecting an unsupported field rather than ignoring it is the same choice
 * `loadConfig` makes about an unrecognised provider: a caller who asked for an
 * order and silently did not get one has no way to notice.
 */
export function resolveOrder(
  collection: Collection,
  query: ListQuery | undefined,
): { field: string; direction: 'asc' | 'desc' } {
  const field = query?.order_by ?? ORDER_DEFAULTS.order_by;
  const allowed: readonly string[] = ORDERABLE_FIELDS[collection];

  if (!allowed.includes(field)) {
    throw new LumanuQueryError(
      `${collection} cannot be ordered by "${field}". Supported: ${allowed.join(', ')}.`,
    );
  }

  return { field, direction: query?.order_by_direction ?? ORDER_DEFAULTS.order_by_direction };
}

/**
 * Applies Lumanu's ordering and paging to an already-fetched list.
 *
 * Shared because every implementation owes callers the same envelope, and an
 * in-memory fake that paged differently from the database would make the
 * contract suite meaningless — it would pass while proving nothing.
 */
export function orderedPage<Item extends Record<string, unknown>>(
  items: readonly Item[],
  collection: Collection,
  query: ListQuery | undefined,
): { data: readonly Item[]; total: number; limit: number; offset: number } {
  const { field, direction } = resolveOrder(collection, query);
  const limit = query?.limit ?? LIST_DEFAULTS.limit;
  const offset = query?.offset ?? LIST_DEFAULTS.offset;

  const sorted = [...items].sort((left, right) => {
    const order = compare(left[field], right[field]);
    // Ties broken by id, so a repeated call returns a repeatable page. Without
    // it, two records sharing a timestamp could swap between calls and page
    // boundaries would move under the caller.
    return (order === 0 ? compare(left['id'], right['id']) : order) * (direction === 'asc' ? 1 : -1);
  });

  return {
    data: sorted.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

/** Nulls sort last, matching PostgreSQL's default for ascending order. */
function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;

  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left) < String(right) ? -1 : 1;
}
