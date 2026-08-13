/**
 * Drops everything this project created, so `db:reset` can rebuild from zero.
 *
 * Named tables rather than `drop schema public cascade`, because Supabase puts
 * extensions and its own objects in `public` too and dropping the schema takes
 * them with it.
 *
 * Tables are untracked in Hasura first. Dropping a table Hasura still tracks
 * leaves the metadata inconsistent, and Hasura then refuses unrelated metadata
 * calls until it is fixed — a confusing failure to hit on the next migration.
 */

import { callHasura, connect, run } from './connect';

const TABLES_NEWEST_FIRST = [
  'schema_migrations',
  'audit_events',
  'balance_transactions',
  'funding_payables',
  'fundings',
  'payables',
  'partners',
  'projects',
  'workspaces',
];

run(async () => {
  const { client, config } = await connect();

  for (const table of TABLES_NEWEST_FIRST) {
    await callHasura(config, '/v1/metadata', {
      type: 'pg_untrack_table',
      args: { source: 'default', table: { schema: 'public', name: table }, cascade: true },
    }).catch(() => undefined);
  }

  await client.query(`drop table if exists ${TABLES_NEWEST_FIRST.join(', ')} cascade`);
  await client.end();

  console.log(`Dropped ${TABLES_NEWEST_FIRST.length} tables and untracked them in Hasura.`);
});
