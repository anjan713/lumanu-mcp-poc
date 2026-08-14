/**
 * The two questions that need several Lumanu reads and some arithmetic:
 * what a Workspace currently looks like, and where a Project's money stands.
 *
 * Both exist because a finance operator asking either one would otherwise issue
 * three or four calls and reconcile them by hand — which is precisely the work
 * an MCP should be doing. Every figure is derived from Lumanu-shaped objects;
 * nothing here reaches past `LumanuProvider`.
 */

import { US_CENTS, type LumanuProvider, type Partner, type Payable } from '@/providers';

import { collectAll } from './collect';
import { groupByStatus } from './group';
import { totalsOf, type PayableTotals } from './payables';

export interface WorkspaceOverview {
  readonly workspace_id: string;
  readonly display_name: string;
  /** Two figures, because Lumanu holds two. Funding is measured against the second. */
  readonly balance: {
    readonly balance: number;
    readonly available_balance: number;
    readonly denomination: string;
  };
  readonly partners: {
    readonly count: number;
    readonly by_status: ReadonlyArray<{ status: string; count: number }>;
  };
  readonly payables: PayableTotals;
  readonly project_count: number;
}

/**
 * Everything a first question needs, in one call.
 *
 * The reads run together rather than in sequence: they are independent, and in
 * Lambda each one is a round trip that a reviewer waits on.
 */
export async function workspaceOverview(
  provider: LumanuProvider,
  workspaceId: string,
): Promise<WorkspaceOverview> {
  const [workspace, account, partners, payables, projects] = await Promise.all([
    provider.getWorkspace(workspaceId),
    provider.getWorkspaceBalance(workspaceId),
    collectAll<Partner>((query) => provider.listPartners(workspaceId, query)),
    collectAll<Payable>((query) => provider.listPayables({ ...query, workspace_id: workspaceId })),
    collectAll((query) => provider.listProjects(workspaceId, query)),
  ]);

  return {
    workspace_id: workspaceId,
    display_name: workspace.display_name ?? '',
    balance: {
      balance: account.balance?.balance ?? 0,
      available_balance: account.balance?.available_balance ?? 0,
      denomination: account.denomination ?? US_CENTS,
    },
    partners: { count: partners.length, by_status: partnersByStatus(partners) },
    payables: totalsOf(payables),
    project_count: projects.length,
  };
}

export interface ProjectPaymentSummary {
  readonly project_id: string;
  readonly name: string;
  readonly budget_amount: number | null;
  readonly budget_denomination: string | null;
  /** The budget less what has been committed. Negative means over budget. */
  readonly budget_remaining: number | null;
  readonly payables: PayableTotals;
}

export async function projectPaymentSummary(
  provider: LumanuProvider,
  workspaceId: string,
  projectId: string,
): Promise<ProjectPaymentSummary> {
  const [project, payables] = await Promise.all([
    provider.getProject(workspaceId, projectId),
    collectAll<Payable>((query) => provider.listPayables({ ...query, project_id: projectId })),
  ]);

  const totals = totalsOf(payables);
  const budget = project.budget_amount ?? null;

  return {
    project_id: projectId,
    name: project.name ?? '',
    budget_amount: budget,
    budget_denomination: project.budget_denomination ?? null,
    budget_remaining: budget === null ? null : budget - totals.committed_amount,
    payables: totals,
  };
}

function partnersByStatus(
  partners: readonly Partner[],
): ReadonlyArray<{ status: string; count: number }> {
  return groupByStatus(partners).map(({ status, items }) => ({ status, count: items.length }));
}
