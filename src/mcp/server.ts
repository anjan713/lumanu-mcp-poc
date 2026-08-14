/**
 * The MCP tool surface.
 *
 * Tools are business-oriented, not a REST wrapper. An agent should be able to
 * pick one from its name and description without knowing anything about
 * Lumanu's endpoints — see docs/05.
 *
 * Every tool reaches its data through `LumanuProvider` and nothing else. No
 * tool touches SQL, Hasura or Apollo, which is what lets the provider be
 * swapped without any of this changing. Where a tool answers a question Lumanu
 * has no single endpoint for, the arithmetic is in `src/domain` and this file
 * only calls it.
 */

import { McpServer, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import { z } from 'zod';

import { collectAll } from '@/domain/collect';
import { filterByStatus } from '@/domain/payables';
import { projectPaymentSummary, workspaceOverview } from '@/domain/summaries';
import {
  LIST_DEFAULTS,
  REACHABLE_PAYABLE_STATUSES,
  type ListQuery,
  type LumanuProvider,
  type Payable,
  type TransactionQuery,
  type TransactionType,
} from '@/providers';

import { partnerForDetail, partnerForList, payableForList } from './redact';

export const SERVER_INFO = {
  name: 'lumanu-mcp-poc',
  version: '0.1.0',
} as const;

/**
 * Tools answer with JSON in a text block. MCP clients present that to a model,
 * and the model reasons better over the exact wire shape than over prose —
 * so the Lumanu envelope is passed through rather than summarised away.
 */
function jsonResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export interface ServerDependencies {
  readonly provider: LumanuProvider;
  readonly logger: Logger;
}

// --- Shared argument shapes ------------------------------------------------

const workspaceId = z
  .string()
  .describe('The Workspace to ask about. Use list_workspaces to find it.');

const paging = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('How many to return. Lumanu defaults to 25.'),
  offset: z.number().int().min(0).optional().describe('How many to skip. Defaults to 0.'),
  order_by: z.string().optional().describe('Field to order by. Defaults to created_at.'),
  order_by_direction: z.enum(['asc', 'desc']).optional().describe('Defaults to asc.'),
};

/**
 * Only the paging keys the caller actually supplied.
 *
 * Zod hands an absent optional over as an explicit `undefined`, which under
 * `exactOptionalPropertyTypes` is a different thing from absent — and which the
 * provider would take as "ordered by undefined" rather than "not ordered". The
 * keys are dropped rather than passed, so Lumanu's own defaults still apply.
 */
function listQuery(args: {
  limit?: number | undefined;
  offset?: number | undefined;
  order_by?: string | undefined;
  order_by_direction?: 'asc' | 'desc' | undefined;
  type?: TransactionType | undefined;
}): ListQuery & TransactionQuery {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined),
  ) as ListQuery & TransactionQuery;
}

/**
 * Builds a server instance.
 *
 * Called per request in Lambda, because a stateless transport must not carry
 * anything between requests. Construction is cheap; the provider and its
 * connection pool are what get reused.
 */
export function buildMcpServer({ provider, logger }: ServerDependencies): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions:
      'Tools for reasoning about creator payments in Lumanu. Partners are the people and ' +
      'businesses paid by a Workspace. Amounts are integers in US cents. Start with ' +
      'get_workspace_overview for the current situation, then narrow with the list tools.',
  });

  /**
   * Registers one tool, with the logging every tool owes a correlated request.
   * Written once rather than per tool: nine copies of the same try/catch is
   * nine chances for one of them to stop reporting a failure.
   */
  function tool<Args extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Args,
    run: (args: z.infer<z.ZodObject<Args>>) => Promise<unknown> | unknown,
  ): void {
    // One cast, at one seam. `ToolCallback<Args>` is a conditional type over
    // the shape, and TypeScript cannot prove a generic function body satisfies
    // it — the SDK still validates the arguments against `inputSchema` before
    // this runs, so the shape is checked where it matters.
    const callback = (async (args: Record<string, unknown>) => {
      const started = Date.now();
      const call = logger.child({ tool_name: name });

      try {
        const result = await run(args as z.infer<z.ZodObject<Args>>);

        call.info(
          { duration_ms: Date.now() - started, success: true, count: countOf(result) },
          'tool completed',
        );
        return jsonResult(result);
      } catch (error) {
        call.error(
          {
            duration_ms: Date.now() - started,
            success: false,
            error_code: error instanceof Error ? error.name : 'UnknownError',
          },
          'tool failed',
        );
        throw error;
      }
    }) as unknown as ToolCallback<Args>;

    server.registerTool(name, { title: titleOf(name), description, inputSchema }, callback);
  }

  tool(
    'list_workspaces',
    'List the Lumanu Workspaces available. A Workspace is a Buyer’s isolated payment ' +
      'environment, owning its own Partners, Projects, Payables and balance. Start here to ' +
      'find the workspace_id that other tools need.',
    { limit: paging.limit, offset: paging.offset },
    (args) => provider.listWorkspaces(listQuery(args)),
  );

  tool(
    'get_workspace_overview',
    'The current situation in one call: the Workspace Balance, how many Partners there are ' +
      'and what state they are in, and what is owed across all Payables. Use this first — it ' +
      'answers what would otherwise take four separate calls to reconcile.',
    { workspace_id: workspaceId },
    (args) => workspaceOverview(provider, args.workspace_id),
  );

  tool(
    'get_workspace_balance',
    'The Workspace Balance: money the Buyer has pre-funded and can draw on to pay Partners. ' +
      'Two figures are returned — the total held, and the amount actually available to ' +
      'commit. Funding decisions are measured against the available figure.',
    { workspace_id: workspaceId },
    (args) => provider.getWorkspaceBalance(args.workspace_id),
  );

  tool(
    'list_workspace_transactions',
    'The Balance Transaction history for a Workspace: every movement in and out of the ' +
      'Workspace Balance, each carrying the balance it left behind. Use it to explain how ' +
      'the balance reached its current figure. Filter by type to see only money out.',
    {
      workspace_id: workspaceId,
      type: z
        .enum(['deposit', 'payment', 'withdrawal', 'fee'])
        .optional()
        .describe('Only transactions of this type. Money paid out is "payment".'),
      ...paging,
    },
    (args) => {
      const { workspace_id, ...query } = args;
      return provider.listBalanceTransactions(workspace_id, listQuery(query));
    },
  );

  tool(
    'list_partners',
    'The Partners a Workspace pays — the people and businesses receiving money. Each carries ' +
      'one status covering onboarding and tax state together, which is what determines ' +
      'whether they can be paid at all. Contact details are omitted; use get_partner for one.',
    { workspace_id: workspaceId, ...paging },
    async (args) => {
      const { workspace_id, ...query } = args;
      const result = await provider.listPartners(workspace_id, listQuery(query));

      return { ...result, data: (result.data ?? []).map(partnerForList) };
    },
  );

  tool(
    'get_partner',
    'One Partner in full, including how many Payables they hold and their onboarding and tax ' +
      'status. Use it when a specific Partner’s situation is the question.',
    {
      workspace_id: workspaceId,
      partner_id: z.string().describe('The Partner to fetch, from list_partners.'),
    },
    async (args) => partnerForDetail(await provider.getPartner(args.workspace_id, args.partner_id)),
  );

  tool(
    'list_payables',
    'What a Workspace owes: each Payable is one amount owed to one Partner, usually for work ' +
      'on a Project. Filter by status to separate what still needs approving from what is ' +
      'approved and ready, and from what has already been funded.',
    {
      workspace_id: workspaceId,
      project_id: z.string().optional().describe('Only Payables belonging to this Project.'),
      // Lumanu's enum minus `paid`, which no flow here produces. Offering it
      // would put a state in front of an agent that this system cannot reach.
      status: z
        .enum(REACHABLE_PAYABLE_STATUSES)
        .optional()
        .describe(
          'Only Payables with this approval status. "unapproved" still needs a decision, ' +
            '"approved" is ready to fund, "will_pay" has been funded.',
        ),
      ...paging,
    },
    async (args) => {
      const { workspace_id, project_id, status, ...query } = args;
      const scope = {
        workspace_id,
        ...(project_id === undefined ? {} : { project_id }),
      };

      if (status === undefined) {
        const result = await provider.listPayables({ ...listQuery(query), ...scope });

        return { ...result, data: (result.data ?? []).map(payableForList) };
      }

      // Lumanu publishes no status filter on this endpoint. Filtering a page
      // would report a total describing the page rather than what matched, so
      // the whole set is read, filtered, then paged here. The ordering is still
      // the provider's; only the paging is applied afterwards.
      const { limit: _limit, offset: _offset, ...ordering } = listQuery(query);
      const matching = filterByStatus(
        await collectAll<Payable>((page) =>
          provider.listPayables({ ...page, ...ordering, ...scope }),
        ),
        status,
      );

      const limit = query.limit ?? LIST_DEFAULTS.limit;
      const offset = query.offset ?? LIST_DEFAULTS.offset;

      return {
        data: matching.slice(offset, offset + limit).map(payableForList),
        total: matching.length,
        limit,
        offset,
      };
    },
  );

  tool(
    'get_payable',
    'One Payable in full: the amount owed, which Partner it is owed to, which Project it ' +
      'belongs to, and where it stands in the approval sequence.',
    { payable_id: z.string().describe('The Payable to fetch, from list_payables.') },
    (args) => provider.getPayable(args.payable_id),
  );

  tool(
    'get_project_payment_summary',
    'Where a Project’s money stands: what has been committed to Partners, how much of that ' +
      'has already been funded from the Workspace Balance, what is still outstanding, and ' +
      'how it compares with the Project budget.',
    {
      workspace_id: workspaceId,
      project_id: z.string().describe('The Project to summarise.'),
    },
    (args) => projectPaymentSummary(provider, args.workspace_id, args.project_id),
  );

  tool(
    'list_projects',
    'The Projects in a Workspace. A Project groups the Payables for one piece of work and ' +
      'may carry a budget. Use it to find the project_id other tools need.',
    { workspace_id: workspaceId, ...paging },
    (args) => {
      const { workspace_id, ...query } = args;
      return provider.listProjects(workspace_id, listQuery(query));
    },
  );

  return server;
}

/** `get_workspace_overview` → `Get Workspace Overview`. */
function titleOf(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** How many records a result carries, for the log line. Absent when it is not a list. */
function countOf(result: unknown): number | undefined {
  const data = (result as { data?: unknown } | null)?.data;

  return Array.isArray(data) ? data.length : undefined;
}
