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
 * The surface grows one ticket at a time. It carries the two Workspace reads
 * the tracer bullet needs; Partners, Payables, the Workspace Balance and
 * Funding arrive in tickets 05 and 07. Adding a method here is what forces
 * every implementation to answer for it, which is the point.
 */

import type { GetWorkspaceResponse, ListWorkspacesResponse } from './wire';

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

export const LIST_DEFAULTS = { limit: 25, offset: 0 } as const;

/** Raised when an identifier names nothing. Distinguishable from a transport failure. */
export class LumanuNotFoundError extends Error {
  public override readonly name = 'LumanuNotFoundError';

  public constructor(resource: string, id: string) {
    super(`No ${resource} with id ${id}`);
  }
}

export interface LumanuProvider {
  listWorkspaces(query?: ListQuery): Promise<ListWorkspacesResponse>;
  getWorkspace(id: string): Promise<GetWorkspaceResponse>;
}

/**
 * Applies Lumanu's paging to an already-fetched list.
 *
 * Shared because every implementation owes callers the same envelope, and an
 * in-memory fake that paged differently from the database would make the
 * contract suite meaningless — it would pass while proving nothing.
 */
export function paginate<Item>(
  items: readonly Item[],
  query: ListQuery | undefined,
): { data: readonly Item[]; total: number; limit: number; offset: number } {
  const limit = query?.limit ?? LIST_DEFAULTS.limit;
  const offset = query?.offset ?? LIST_DEFAULTS.offset;

  return {
    data: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
