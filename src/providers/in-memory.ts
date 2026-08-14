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

import { randomUUID } from 'node:crypto';

import {
  CANONICAL,
  type BalanceTransactionRow,
  type FundingRow,
  type PartnerRow,
  type PayableRow,
  type ProjectRow,
  type WorkspaceRow,
} from '@/seed/canonical';

import {
  LumanuInsufficientBalanceError,
  LumanuInvalidInputError,
  LumanuInvalidStateError,
  LumanuNotFoundError,
  orderedPage,
  type ListQuery,
  type LumanuProvider,
  type PayableQuery,
  type TransactionQuery,
} from './lumanu-provider';
import { AUDIT, ONBOARDED } from './writes';
import {
  toAccount,
  toFunding,
  toPartner,
  toPartnerDetail,
  toPayable,
  toProject,
  toProjectDetail,
  toTransaction,
  toWorkspace,
} from './to-wire';
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
 * The rows this provider serves. Every collection defaults to the canonical
 * scenario; a caller overrides only what its case needs — an empty Workspace
 * list, or enough Workspaces to page through.
 */
export interface Scenario {
  readonly workspaces: readonly WorkspaceRow[];
  readonly projects: readonly ProjectRow[];
  readonly partners: readonly PartnerRow[];
  readonly payables: readonly PayableRow[];
  readonly fundings: readonly FundingRow[];
  readonly fundingPayables: ReadonlyArray<{ funding_id: string; payable_id: string }>;
  readonly balanceTransactions: readonly BalanceTransactionRow[];
  readonly auditEvents: readonly AuditEventRow[];
}

/** What `audit_events` holds. Not a Lumanu shape — no endpoint serves these. */
export interface AuditEventRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly event_type: string;
  readonly subject_id: string;
  readonly created_at: string;
}

const CANONICAL_SCENARIO: Scenario = {
  workspaces: [CANONICAL.workspace],
  projects: [CANONICAL.project],
  partners: CANONICAL.partners,
  payables: CANONICAL.payables,
  fundings: CANONICAL.fundings,
  fundingPayables: CANONICAL.fundingPayables,
  balanceTransactions: CANONICAL.balanceTransactions,
  auditEvents: [],
};

/**
 * The writes mutate, so the rows are held as mutable copies of whatever was
 * supplied. Two providers built from the same scenario are independent — a test
 * that funds something cannot change what the next test sees.
 */
type MutableScenario = {
  -readonly [Key in keyof Scenario]: Array<Scenario[Key][number]>;
};

export class InMemoryLumanuProvider implements LumanuProvider {
  private readonly rows: MutableScenario;

  public constructor(override: Partial<Scenario> = {}) {
    const merged = { ...CANONICAL_SCENARIO, ...override };

    this.rows = {
      workspaces: [...merged.workspaces],
      projects: [...merged.projects],
      partners: [...merged.partners],
      payables: [...merged.payables],
      fundings: [...merged.fundings],
      fundingPayables: [...merged.fundingPayables],
      balanceTransactions: [...merged.balanceTransactions],
      auditEvents: [...merged.auditEvents],
    };
  }

  /** The audit trail this provider has written. No Lumanu endpoint serves it. */
  public get auditEvents(): readonly AuditEventRow[] {
    return this.rows.auditEvents;
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
    return this.payable(this.payableRow(id));
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

  // --- Writes -------------------------------------------------------------

  public async approvePayable(id: string): Promise<ApprovePayableResponse> {
    const row = this.payableRow(id);

    if (row.status !== 'unapproved') {
      throw new LumanuInvalidStateError(
        'Payable',
        id,
        row.status,
        'only an unapproved Payable can be approved.',
      );
    }

    return this.transition(row, 'approved', 'approved', AUDIT.approved);
  }

  public async cancelPayable(id: string): Promise<CancelPayableResponse> {
    const row = this.payableRow(id);

    // `will_pay` is excluded on purpose: the money has already left the
    // Workspace Balance, so cancelling would unwind a commitment silently.
    if (row.status !== 'unapproved' && row.status !== 'approved') {
      throw new LumanuInvalidStateError(
        'Payable',
        id,
        row.status,
        'only a Payable that has not been funded can be cancelled.',
      );
    }

    return this.transition(row, 'canceled', 'canceled', AUDIT.canceled);
  }

  /**
   * Every check runs before anything is written, so a rejection leaves the
   * balance and the Payable statuses exactly as they were. That is what makes
   * this atomic here; `MockLumanuProvider` gets the same property from a
   * PostgreSQL function — see ADR 0005.
   */
  public async createFunding(request: CreateFundingRequest): Promise<CreateFundingResponse> {
    // The request is judged before anything is looked up, so that a malformed
    // request and an unknown Workspace cannot depend on which came first —
    // the SQL function checks in this order too, and the contract suite holds
    // both to it.
    if (request.method !== 'balance') {
      throw new LumanuInvalidInputError(
        `Only method "balance" is supported. Invoice funding is out of scope for this POC.`,
      );
    }
    if (request.payable_ids === undefined || request.payable_ids.length === 0) {
      throw new LumanuInvalidInputError('payable_ids is required when method is "balance".');
    }

    const workspace = this.workspace(request.workspace_id);
    // Deduplicated, because what is funded is decided by looking for an
    // existing Funding link and no link exists yet within this call — so the
    // same id twice would be counted twice and debited twice.
    const requested = [...new Set(request.payable_ids)].map((id) => this.payableRow(id));

    for (const payable of requested) {
      if (payable.workspace_id !== request.workspace_id) {
        throw new LumanuInvalidInputError(
          `Payable ${payable.id} belongs to a different Workspace.`,
        );
      }
    }

    // Already funded is a no-op rather than a failure, which is what makes a
    // retried request safe: the second attempt finds nothing left to fund and
    // debits nothing.
    const funded = requested.filter((payable) => this.fundingOf(payable.id) !== undefined);
    const toFund = requested.filter((payable) => this.fundingOf(payable.id) === undefined);

    for (const payable of toFund) {
      if (payable.status !== 'approved') {
        throw new LumanuInvalidStateError(
          'Payable',
          payable.id,
          payable.status,
          'only an approved Payable can be funded.',
        );
      }

      const partner = this.rows.partners.find((row) => row.id === payable.partner_id);
      if (partner?.status !== ONBOARDED) {
        throw new LumanuInvalidStateError(
          'Partner',
          partner?.id ?? payable.partner_id,
          partner?.status ?? 'unknown',
          `a Partner must be ${ONBOARDED} before their Payables can be funded.`,
        );
      }
    }

    const total = toFund.reduce((sum, payable) => sum + payable.amount_cents, 0);
    if (total > workspace.available_balance_cents) {
      throw new LumanuInsufficientBalanceError(total, workspace.available_balance_cents);
    }

    if (toFund.length === 0) {
      const existing = this.rows.fundings.find(
        (row) => row.id === this.fundingOf(funded[0]?.id ?? ''),
      );
      if (existing === undefined) {
        throw new LumanuInvalidInputError('No Payables in this request need funding.');
      }
      return toFunding(existing);
    }

    return this.commitFunding(workspace, toFund, total);
  }

  /** Nothing above is written until every check above has passed. */
  private commitFunding(
    workspace: WorkspaceRow,
    toFund: readonly PayableRow[],
    total: number,
  ): CreateFundingResponse {
    const now = new Date().toISOString();
    const funding: FundingRow = {
      id: randomUUID(),
      workspace_id: workspace.id,
      method: 'balance',
      status: 'completed',
      amount_cents: total,
      // Fees are fixed at zero for this POC, so the debit equals the total.
      fee_amount_cents: 0,
      fee_percent: 0,
      created_at: now,
      updated_at: now,
    };
    const remaining = workspace.balance_cents - total;

    this.rows.fundings.push(funding);
    this.replaceWorkspace({
      ...workspace,
      balance_cents: remaining,
      available_balance_cents: workspace.available_balance_cents - total,
      updated_at: now,
    });

    for (const payable of toFund) {
      this.rows.fundingPayables.push({ funding_id: funding.id, payable_id: payable.id });
      this.replacePayable({
        ...payable,
        status: 'will_pay',
        payable_status: 'scheduled',
        updated_at: now,
      });
    }

    this.rows.balanceTransactions.push({
      id: randomUUID(),
      workspace_id: workspace.id,
      funding_id: funding.id,
      description: `Funding — ${this.namesOf(toFund)}`,
      amount_cents: total,
      balance_change_cents: -total,
      ending_balance_cents: remaining,
      status: 'processed',
      type: 'payment',
      created_at: now,
    });

    this.audit(workspace.id, AUDIT.funded, funding.id, now);
    return toFunding(funding);
  }

  private transition(
    row: PayableRow,
    status: string,
    lifecycle: string,
    event: string,
  ): GetPayableResponse {
    const now = new Date().toISOString();
    const updated = { ...row, status, payable_status: lifecycle, updated_at: now };

    this.replacePayable(updated);
    this.audit(row.workspace_id, event, row.id, now);

    return this.payable(updated);
  }

  private audit(workspaceId: string, eventType: string, subjectId: string, at: string): void {
    this.rows.auditEvents.push({
      id: randomUUID(),
      workspace_id: workspaceId,
      event_type: eventType,
      subject_id: subjectId,
      created_at: at,
    });
  }

  /** The Funding a Payable has already been paid by, if any. */
  private fundingOf(payableId: string): string | undefined {
    return this.rows.fundingPayables.find((link) => link.payable_id === payableId)?.funding_id;
  }

  private namesOf(payables: readonly PayableRow[]): string {
    const names = payables.map(
      (payable) =>
        this.rows.partners.find((partner) => partner.id === payable.partner_id)?.name ??
        'unknown Partner',
    );

    return [...new Set(names)].join(', ');
  }

  private replacePayable(row: PayableRow): void {
    this.rows.payables = this.rows.payables.map((existing) =>
      existing.id === row.id ? row : existing,
    );
  }

  private replaceWorkspace(row: WorkspaceRow): void {
    this.rows.workspaces = this.rows.workspaces.map((existing) =>
      existing.id === row.id ? row : existing,
    );
  }

  private payableRow(id: string): PayableRow {
    const row = this.rows.payables.find((payable) => payable.id === id);
    if (row === undefined) {
      throw new LumanuNotFoundError('Payable', id);
    }
    return row;
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
