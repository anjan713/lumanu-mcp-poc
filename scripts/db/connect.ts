/** Shared plumbing for the database scripts. Not part of the shipped bundle. */

import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

import { loadDataLayerConfig, type DataLayerConfig } from '../../src/config';

/**
 * Reads `.env` and opens a connection. Every database script goes through
 * here, so the session-mode pooler check in `loadDataLayerConfig` cannot be
 * skipped by one of them opening its own client.
 */
export async function connect(): Promise<{ client: Client; config: DataLayerConfig }> {
  loadDotenv({ quiet: true });
  const config = loadDataLayerConfig();
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  return { client, config };
}

/** Calls Hasura's metadata or GraphQL API with the admin secret. */
export async function callHasura(
  config: DataLayerConfig,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, config.hasuraEndpoint), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': config.hasuraAdminSecret,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Hasura ${path} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Runs a script's `main`, reporting failures without a stack-trace wall. */
export function run(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
