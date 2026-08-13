/**
 * Writes the canonical Acme scenario into Supabase.
 *
 *   npm run db:seed
 *
 * Wipes the data tables first, so this is repeatable and a demo can be re-run
 * after mutations. The scenario itself lives in `src/seed/canonical.ts` — this
 * script only puts it in a database.
 *
 * Faker adds a handful of extra Partners and Payables for texture, seeded so
 * the result is identical every time. The texture is constrained so it cannot
 * disturb the figures the demo turns on: generated Partners are never
 * `completed_w9` and generated Payables are never `approved`, so nothing
 * generated can enter the ready-to-fund total. It introduces no second
 * Workspace, no second Project and no other funding model.
 */

import { CANONICAL } from '../../src/seed/canonical';

import { connect, run } from './connect';
import { generateTexture } from './texture';

/** Emptied in dependency order: children before the rows they point at. */
const TABLES_NEWEST_FIRST = [
  'audit_events',
  'balance_transactions',
  'funding_payables',
  'fundings',
  'payables',
  'partners',
  'projects',
  'workspaces',
];

/**
 * Builds a single multi-row INSERT from a list of uniform objects, taking the
 * column names from the first row. Parameterised rather than interpolated —
 * the values are seed data, but a script that builds SQL by concatenation is a
 * bad habit to leave lying around in a repository someone will copy from.
 */
function insertMany<Row extends object>(
  table: string,
  rows: readonly Row[],
): { text: string; values: unknown[] } {
  const columns = Object.keys(rows[0] ?? {});
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const fields = row as Record<string, unknown>;
    return `(${columns.map((column) => `$${values.push(fields[column])}`).join(', ')})`;
  });

  return {
    text: `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')}`,
    values,
  };
}

run(async () => {
  const { client } = await connect();
  const texture = generateTexture();

  try {
    await client.query('begin');
    await client.query(`truncate ${TABLES_NEWEST_FIRST.join(', ')} cascade`);

    const batches: Array<[string, readonly object[]]> = [
      ['workspaces', [CANONICAL.workspace]],
      ['projects', [CANONICAL.project]],
      ['partners', [...CANONICAL.partners, ...texture.partners]],
      ['payables', [...CANONICAL.payables, ...texture.payables]],
      ['fundings', CANONICAL.fundings],
      ['funding_payables', CANONICAL.fundingPayables],
      ['balance_transactions', CANONICAL.balanceTransactions],
    ];

    for (const [table, rows] of batches) {
      if (rows.length === 0) continue;
      const { text, values } = insertMany(table, rows);
      await client.query(text, values);
      console.log(`  seeded  ${String(rows.length).padStart(2)}  ${table}`);
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }

  console.log(
    `\nAcme US seeded: $${(CANONICAL.workspace.balance_cents / 100).toLocaleString('en-US')} ` +
      `balance, ${CANONICAL.partners.length} canonical Partners ` +
      `plus ${texture.partners.length} generated for texture.`,
  );
});
