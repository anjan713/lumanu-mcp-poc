/**
 * `LumanuProvider` over the canonical seed fixture.
 *
 * No network, no credentials, no database. This is what tool-level tests
 * inject, which is why a fresh clone runs the whole suite green without
 * provisioning anything.
 *
 * It reads the same `src/seed/canonical.ts` that `npm run db:seed` writes into
 * Supabase, so the fake and the database hold the same scenario by
 * construction rather than by discipline. The contract suite then holds both
 * to the same Lumanu wire format, which is what stops this from becoming a
 * comfortable place for drift to hide.
 */

import { CANONICAL, type WorkspaceRow } from '@/seed/canonical';

import {
  LumanuNotFoundError,
  paginate,
  type ListQuery,
  type LumanuProvider,
} from './lumanu-provider';
import type { GetWorkspaceResponse, ListWorkspacesResponse, Workspace } from './wire';

/**
 * Internal row to Lumanu wire format.
 *
 * The balance is deliberately absent: Lumanu does not put it on the Workspace.
 * It is served from `GET /workspace/{id}/wallet` as an `Account`, and mixing
 * the two here would invent a shape Lumanu does not publish.
 */
function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    display_name: row.display_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    funding_fee_percent: row.funding_fee_percent,
    additive_funding_fee: row.additive_funding_fee,
    vendor_invite_url: row.vendor_invite_url,
  };
}

export class InMemoryLumanuProvider implements LumanuProvider {
  private readonly workspaces: readonly WorkspaceRow[];

  /**
   * Defaults to the canonical scenario. A caller may supply its own rows to
   * set up a case the canonical four do not cover — an empty Workspace list,
   * or enough Workspaces to page through.
   */
  public constructor(workspaces: readonly WorkspaceRow[] = [CANONICAL.workspace]) {
    this.workspaces = workspaces;
  }

  // Both are `async` so that a failure arrives as a rejected promise rather
  // than a synchronous throw. The interface is asynchronous, so a caller is
  // entitled to write `.catch(...)` and see every error — a synchronous throw
  // escapes that entirely, and no other implementation can throw that way.
  public async listWorkspaces(query?: ListQuery): Promise<ListWorkspacesResponse> {
    const page = paginate(this.workspaces, query);

    return {
      data: page.data.map(toWorkspace),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  public async getWorkspace(id: string): Promise<GetWorkspaceResponse> {
    const row = this.workspaces.find((workspace) => workspace.id === id);
    if (row === undefined) {
      throw new LumanuNotFoundError('Workspace', id);
    }

    return toWorkspace(row);
  }
}
