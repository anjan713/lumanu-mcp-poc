/**
 * Applies the SQL migrations in `db/migrations`.
 *
 *   npm run db:migrate
 *
 * Deliberately not the Hasura CLI. The CLI would need a `hasura` binary on the
 * path and a config file holding the admin secret; plain SQL applied over the
 * connection this project already opens keeps the migration files readable on
 * their own and the toolchain to what `npm install` provides.
 *
 * Each file runs inside a transaction and is recorded, so re-running applies
 * only what is new.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { connect, run } from './connect';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

run(async () => {
  const { client } = await connect();

  await client.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query<{ name: string }>('select name from schema_migrations')).rows.map(
      (row) => row.name,
    ),
  );

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log(`Up to date — ${applied.size} migration(s) already applied.`);
    await client.end();
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`  applied  ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw new Error(
        `${file} failed and was rolled back: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  await client.end();
  console.log(`\n${pending.length} migration(s) applied.`);
});
