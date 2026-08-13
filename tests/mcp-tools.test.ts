/**
 * Seam 1 — the MCP tool surface.
 *
 * The primary seam, and the highest available. A real MCP client talks to a
 * real MCP server over an in-memory transport, with `InMemoryLumanuProvider`
 * injected. No network, no credentials, no database.
 *
 * Everything here asserts what a client actually receives. Nothing asserts
 * that a provider method was called or that a query had a given shape — a test
 * that did would pass just as happily against a broken tool.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildMcpServer } from '@/mcp/server';
import { InMemoryLumanuProvider } from '@/providers';
import type { LumanuProvider } from '@/providers';
import { CANONICAL } from '@/seed/canonical';

import { expectMatchesLumanuSchema } from './support/lumanu-schema';
import { silentLogger } from './support/silent-logger';

/** Connects a client to a server carrying the given provider. */
async function connect(provider: LumanuProvider = new InMemoryLumanuProvider()): Promise<Client> {
  const server = buildMcpServer({ provider, logger: silentLogger() });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** The JSON a tool answered with, parsed back out of its text block. */
function payloadOf(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  const [block] = content;

  expect(block?.type).toBe('text');
  return JSON.parse(block?.text ?? '{}') as Record<string, unknown>;
}

describe('the tool surface an agent sees', () => {
  it('advertises list_workspaces', async () => {
    const { tools } = await (await connect()).listTools();

    expect(tools.map((tool) => tool.name)).toContain('list_workspaces');
  });

  it('describes the tool in business terms, not REST terms', async () => {
    const { tools } = await (await connect()).listTools();
    const tool = tools.find((candidate) => candidate.name === 'list_workspaces');

    expect(tool?.description).toMatch(/Workspace/);
    expect(tool?.description).not.toMatch(/GET |endpoint|REST|\/workspace/);
  });

  it('never says Vendor, creator or payee where an agent can read it', async () => {
    const { tools } = await (await connect()).listTools();
    const visible = JSON.stringify(tools);

    expect(visible).not.toMatch(/\bvendor\b/i);
    expect(visible).not.toMatch(/\bpayee\b/i);
    expect(visible).not.toMatch(/\bwallet\b/i);
  });

  it('publishes an input schema so an agent can call it without guessing', async () => {
    const { tools } = await (await connect()).listTools();
    const tool = tools.find((candidate) => candidate.name === 'list_workspaces');

    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual(['limit', 'offset']);
  });
});

describe('list_workspaces', () => {
  it('returns the canonical Workspace', async () => {
    const client = await connect();
    const payload = payloadOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));

    const workspaces = payload['data'] as Array<{ display_name: string }>;
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.display_name).toBe('Acme US');
  });

  it("returns Lumanu's envelope, so behaviour will not change when the real API is connected", async () => {
    const client = await connect();
    const payload = payloadOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));

    expect(Object.keys(payload).sort()).toEqual(['data', 'limit', 'offset', 'total']);
    expect(payload['total']).toBe(1);
    expect(payload['limit']).toBe(25);
    expect(payload['offset']).toBe(0);
  });

  it('returns Workspaces that validate against Lumanu’s published schema', async () => {
    const client = await connect();
    const payload = payloadOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));

    for (const workspace of payload['data'] as unknown[]) {
      expectMatchesLumanuSchema('Workspace', workspace);
    }
  });

  it('honours the paging it is given', async () => {
    const many = Array.from({ length: 4 }, (_, index) => ({
      ...CANONICAL.workspace,
      id: `9f8b1c34-0000-4000-8000-00000000020${index}`,
    }));
    const client = await connect(new InMemoryLumanuProvider(many));

    const payload = payloadOf(
      await client.callTool({ name: 'list_workspaces', arguments: { limit: 2, offset: 1 } }),
    );

    expect(payload['total']).toBe(4);
    expect(payload['limit']).toBe(2);
    expect((payload['data'] as unknown[]).length).toBe(2);
  });

  it('rejects a limit outside the range it advertises', async () => {
    const client = await connect();

    const result = await client.callTool({ name: 'list_workspaces', arguments: { limit: 0 } });

    expect(result.isError).toBe(true);
  });

  it('rejects an argument of the wrong type rather than guessing', async () => {
    const client = await connect();

    const result = await client.callTool({
      name: 'list_workspaces',
      arguments: { limit: 'twenty' },
    });

    expect(result.isError).toBe(true);
  });

  it('reports a provider failure as a tool error rather than crashing the server', async () => {
    const failing: LumanuProvider = {
      listWorkspaces: () => Promise.reject(new Error('Hasura is unreachable')),
      getWorkspace: () => Promise.reject(new Error('Hasura is unreachable')),
    };
    const client = await connect(failing);

    const result = await client.callTool({ name: 'list_workspaces', arguments: {} });

    expect(result.isError).toBe(true);
    // The server is still usable afterwards.
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });
});

describe('the layering', () => {
  it('reaches its data only through the provider it was given', async () => {
    // A provider that answers with a Workspace no database contains. If the
    // tool consulted anything else, this could not be the answer.
    const invented = {
      ...CANONICAL.workspace,
      id: '9f8b1c34-0000-4000-8000-0000000003ff',
      display_name: 'Nowhere Ltd',
    };
    const client = await connect(new InMemoryLumanuProvider([invented]));

    const payload = payloadOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));

    expect((payload['data'] as Array<{ display_name: string }>)[0]?.display_name).toBe(
      'Nowhere Ltd',
    );
  });
});
