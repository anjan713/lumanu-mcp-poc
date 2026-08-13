/**
 * The MCP tool surface.
 *
 * Tools are business-oriented, not a REST wrapper. An agent should be able to
 * pick one from its name and description without knowing anything about
 * Lumanu's endpoints — see docs/05.
 *
 * Every tool reaches its data through `LumanuProvider` and nothing else. No
 * tool touches SQL, Hasura or Apollo, which is what lets the provider be
 * swapped without any of this changing.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import { z } from 'zod';

import type { LumanuProvider } from '@/providers';

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
      'businesses paid by a Workspace. Amounts are integers in US cents.',
  });

  server.registerTool(
    'list_workspaces',
    {
      title: 'List Workspaces',
      description:
        'List the Lumanu Workspaces available. A Workspace is a Buyer’s isolated payment ' +
        'environment, owning its own Partners, Projects, Payables and balance. Start here ' +
        'to find the workspace_id that other tools need.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('How many to return. Lumanu defaults to 25.'),
        offset: z.number().int().min(0).optional().describe('How many to skip. Defaults to 0.'),
      },
    },
    async ({ limit, offset }) => {
      const started = Date.now();
      const call = logger.child({ tool_name: 'list_workspaces' });

      try {
        const result = await provider.listWorkspaces({
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
        });

        call.info(
          { duration_ms: Date.now() - started, success: true, count: result.data?.length ?? 0 },
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
    },
  );

  return server;
}
