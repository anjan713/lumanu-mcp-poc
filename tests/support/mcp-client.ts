/**
 * A real MCP client talking to a real MCP server over an in-memory transport.
 *
 * Shared by every tool-level test, so that all of them exercise the same path a
 * deployed client takes — through tool registration, argument validation and
 * the content-block encoding — rather than calling a handler directly.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildMcpServer } from '@/mcp/server';
import { InMemoryLumanuProvider, type LumanuProvider } from '@/providers';

import { silentLogger } from './silent-logger';

export async function connect(
  provider: LumanuProvider = new InMemoryLumanuProvider(),
): Promise<Client> {
  const server = buildMcpServer({ provider, logger: silentLogger() });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** The JSON a tool answered with, parsed back out of its text block. */
export function payloadOf(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  const [block] = content;

  expect(block?.type).toBe('text');
  return JSON.parse(block?.text ?? '{}') as Record<string, unknown>;
}

/** Calls a tool on a fresh connection unless one is supplied. */
export async function call(
  name: string,
  args: Record<string, unknown> = {},
  client?: Client,
): Promise<Record<string, unknown>> {
  const connected = client ?? (await connect());

  return payloadOf(await connected.callTool({ name, arguments: args }));
}
