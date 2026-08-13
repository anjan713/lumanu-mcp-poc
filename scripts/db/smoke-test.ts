/**
 * The fail-fast check, run before any schema work.
 *
 *   npm run db:smoke
 *
 * Connecting Hasura Cloud v2 to Supabase is the least certain step in this
 * build, so it gets proven on its own rather than discovered halfway through a
 * migration. Three questions, in the order they can fail:
 *
 *   1. Can we reach Supabase at all, on the session-mode pooler?
 *   2. Can we reach Hasura Cloud, with the admin secret we hold?
 *   3. Is Hasura actually pointed at *that* database — can it read a table we
 *      just created through the direct connection?
 *
 * The third is the one that matters. Hasura answering GraphQL proves only that
 * Hasura is awake; it says nothing about which database is behind it, and a
 * project connected to the wrong source fails much later and much less
 * legibly.
 *
 * If this resists, the fallback is self-hosted Hasura v2 CE, which changes
 * nothing above the provider boundary. See ADR 0002.
 */

import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

import { loadDataLayerConfig, type DataLayerConfig } from '../../src/config';

loadDotenv();

/** A table Hasura is asked to read, then dropped. Named so it is obviously disposable. */
const PROBE_TABLE = 'lumanu_mcp_smoke_probe';

type Step = { readonly name: string; readonly run: () => Promise<string> };

async function queryHasura(
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
    throw new Error(`Hasura returned ${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Hasura Cloud acknowledges a metadata change before it has finished
 * rebuilding the GraphQL schema, so a newly tracked table is briefly absent
 * from `query_root`. Retries rather than sleeps, so the common case — already
 * rebuilt — costs nothing.
 */
async function untilSchemaCatchesUp<T>(attempt: () => Promise<T>, attempts = 10): Promise<T> {
  for (let remaining = attempts; ; remaining -= 1) {
    try {
      return await attempt();
    } catch (error) {
      const rebuilding = String(error).includes('not found in type');
      if (!rebuilding || remaining <= 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function main(): Promise<void> {
  const config = loadDataLayerConfig();
  const client = new Client({ connectionString: config.databaseUrl });

  const steps: Step[] = [
    {
      name: 'Supabase reachable on the session-mode pooler',
      run: async () => {
        await client.connect();
        const { rows } = await client.query<{ version: string }>('select version()');
        return rows[0]?.version.split(',')[0] ?? 'connected';
      },
    },
    {
      name: 'Hasura Cloud reachable with the admin secret',
      run: async () => {
        const result = await queryHasura(config, '/v1/graphql', {
          query: '{ __schema { queryType { name } } }',
        });
        if (result['errors'] !== undefined) {
          throw new Error(JSON.stringify(result['errors']));
        }
        return 'GraphQL schema served';
      },
    },
    {
      name: 'Hasura is pointed at this same database',
      run: async () => {
        // Dropped and rebuilt rather than created-if-absent: a probe left
        // behind by an interrupted run may have the wrong shape, and a stale
        // one would fail in a way that looks like a connection problem.
        await cleanUp(config, client);
        await client.query(`create table ${PROBE_TABLE} (id int primary key, note text)`);
        await client.query(`insert into ${PROBE_TABLE} (id, note) values (1, 'hello')`);

        await queryHasura(config, '/v1/metadata', {
          type: 'pg_track_table',
          args: { source: 'default', table: { schema: 'public', name: PROBE_TABLE } },
        });

        // `pg_track_table` returns success before the GraphQL schema has been
        // rebuilt, so querying straight away races and fails validation with
        // "field not found in type: 'query_root'". Retry until it appears.
        const rows = await untilSchemaCatchesUp(async () => {
          const result = await queryHasura(config, '/v1/graphql', {
            query: `{ ${PROBE_TABLE} { id note } }`,
          });
          if (result['errors'] !== undefined) throw new Error(JSON.stringify(result['errors']));
          return (result['data'] as Record<string, Array<{ note: string }>>)[PROBE_TABLE];
        });

        if (rows?.[0]?.note !== 'hello') {
          throw new Error(`Hasura read back ${JSON.stringify(rows)} rather than the probe row.`);
        }
        return 'read the probe row written over the direct connection';
      },
    },
  ];

  let failed = false;
  for (const step of steps) {
    try {
      console.log(`  ok    ${step.name} — ${await step.run()}`);
    } catch (error) {
      console.error(`  FAIL  ${step.name}`);
      console.error(`        ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
      break;
    }
  }

  await cleanUp(config, client);
  await client.end().catch(() => undefined);

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log('\nData layer reachable. Safe to run migrations.');
}

/** Leaves no trace: the probe table is untracked and dropped either way. */
async function cleanUp(config: DataLayerConfig, client: Client): Promise<void> {
  await queryHasura(config, '/v1/metadata', {
    type: 'pg_untrack_table',
    args: { source: 'default', table: { schema: 'public', name: PROBE_TABLE } },
  }).catch(() => undefined);

  await client.query(`drop table if exists ${PROBE_TABLE}`).catch(() => undefined);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
