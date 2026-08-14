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

import {
  CANONICAL,
  type BalanceTransactionRow,
  type PartnerRow,
  type PayableRow,
  type ProjectRow,
  type WorkspaceRow,
} from '@/seed/canonical';

import {
  LumanuNotFoundError,
  orderedPage,
  type ListQuery,
  type LumanuProvider,
  type PayableQuery,
  type TransactionQuery,
} from './lumanu-provider';
import {
  toAccount,
  toPartner,
  toPartnerDetail,
  toPayable,
  toProject,
  toProjectDetail,
  toTransaction,
  toWorkspace,
} from './to-wire';
import type {
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
 * The rows this provider serves. Every collection defaults to the canonical
 * scenario; a caller overrides only what its case needs — an empty Workspace
 * list, or enough Workspaces to page through.
 */
export interface Scenario {
  readonly workspaces: readonly WorkspaceRow[];
  readonly projects: readonly ProjectRow[];
  readonly partners: readonly PartnerRow[];
  readonly payables: readonly PayableRow[];
  readonly balanceTransactions: readonly BalanceTransactionRow[];
}

const CANONICAL_SCENARIO: Scenario = {
  workspaces: [CANONICAL.workspace],
  projects: [CANONICAL.project],
  partners: CANONICAL.partners,
  payables: CANONICAL.payables,
  balanceTransactions: CANONICAL.balanceTransactions,
};

export class InMemoryLumanuProvider implements LumanuProvider {
  private readonly rows: Scenario;

  public constructor(override: Partial<Scenario> = {}) {
    this.rows = { ...CANONICAL_SCENARIO, ...override };
  }

  // Every method is `async` so that a failure arrives as a rejected promise
  // rather than a synchronous throw. The interface is asynchronous, so a caller
  // is entitled to write `.catch(...)` and see every error — a synchronous
  // throw escapes that entirely, and no other implementation can throw that way.

  public async listWorkspaces(query?: ListQuery): Promise<ListWorkspacesResponse> {
    return envelope(orderedPage(this.rows.workspaces.map(toWorkspace), 'workspaces', query));
  }

  public async getWorkspace(id: string): Promise<GetWorkspaceResponse> {
    return toWorkspace(this.workspace(id));
  }

  public async listPartners(workspaceId: string, query?: ListQuery): Promise<ListPartnersResponse> {
    const partners = this.rows.partners.filter((row) => row.workspace_id === workspaceId);

    return envelope(orderedPage(partners.map(toPartner), 'partners', query));
  }

  public async getPartner(workspaceId: string, partnerId: string): Promise<GetPartnerResponse> {
    const row = this.rows.partners.find(
      (partner) => partner.id === partnerId && partner.workspace_id === workspaceId,
    );
    if (row === undefined) {
      throw new LumanuNotFoundError('Partner', partnerId);
    }

    const count = this.rows.payables.filter((payable) => payable.partner_id === partnerId).length;
    return toPartnerDetail(row, count);
  }

  public async listPayables(query?: PayableQuery): Promise<ListPayablesResponse> {
    const payables = this.rows.payables.filter(
      (row) =>
        (query?.workspace_id === undefined || row.workspace_id === query.workspace_id) &&
        (query?.project_id === undefined || row.project_id === query.project_id),
    );

    return envelope(orderedPage(payables.map((row) => this.payable(row)), 'payables', query));
  }

  public async getPayable(id: string): Promise<GetPayableResponse> {
    const row = this.rows.payables.find((payable) => payable.id === id);
    if (row === undefined) {
      throw new LumanuNotFoundError('Payable', id);
    }

    return this.payable(row);
  }

  public async listProjects(workspaceId: string, query?: ListQuery): Promise<ListProjectsResponse> {
    const projects = this.rows.projects.filter((row) => row.workspace_id === workspaceId);

    return envelope(orderedPage(projects.map(toProject), 'projects', query));
  }

  public async getProject(workspaceId: string, projectId: string): Promise<GetProjectResponse> {
    const row = this.rows.projects.find(
      (project) => project.id === projectId && project.workspace_id === workspaceId,
    );
    if (row === undefined) {
      throw new LumanuNotFoundError('Project', projectId);
    }

    return toProjectDetail(row);
  }

  public async getWorkspaceBalance(workspaceId: string): Promise<GetWorkspaceBalanceResponse> {
    return toAccount(this.workspace(workspaceId));
  }

  public async listBalanceTransactions(
    workspaceId: string,
    query?: TransactionQuery,
  ): Promise<ListBalanceTransactionsResponse> {
    const transactions = this.rows.balanceTransactions.filter(
      (row) =>
        row.workspace_id === workspaceId && (query?.type === undefined || row.type === query.type),
    );

    return envelope(orderedPage(transactions.map(toTransaction), 'transactions', query));
  }

  /** Resolves the Partner a Payable names, which Lumanu's shape needs and does not carry. */
  private payable(row: PayableRow): GetPayableResponse {
    return toPayable(
      row,
      this.rows.partners.find((partner) => partner.id === row.partner_id),
    );
  }

  private workspace(id: string): WorkspaceRow {
    const row = this.rows.workspaces.find((workspace) => workspace.id === id);
    if (row === undefined) {
      throw new LumanuNotFoundError('Workspace', id);
    }
    return row;
  }
}

/** Widens the page helper's readonly arrays into the mutable arrays Lumanu's types declare. */
function envelope<Item>(page: {
  data: readonly Item[];
  total: number;
  limit: number;
  offset: number;
}): { data: Item[]; total: number; limit: number; offset: number } {
  return { data: [...page.data], total: page.total, limit: page.limit, offset: page.offset };
}
