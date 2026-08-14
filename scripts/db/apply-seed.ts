/**
 * Writes the canonical Acme scenario into an open connection.
 *
 * Separate from `seed.ts` because that file calls `run()` at module scope and
 * so cannot be imported without executing — the hazard recorded in
 * `docs/discoveries/2026-08-13-a-script-that-runs-on-import.md`. The contract
 * suite needs to reseed between write tests, which makes this a second caller.
 */

import type { Client } from 'pg';

import { CANONICAL } from '../../src/seed/canonical';

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

export interface SeedReport {
  readonly canonicalPartners: number;
  readonly generatedPartners: number;
}

/**
 * Wipes the data tables and rewrites the scenario, in one transaction, so a
 * demo or a test can be re-run after mutations.
 *
 * @param onTable Called per table written, for scripts that report progress.
 */
export async function applySeed(
  client: Client,
  onTable: (table: string, rows: number) => void = () => undefined,
): Promise<SeedReport> {
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
      onTable(table, rows.length);
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }

  return {
    canonicalPartners: CANONICAL.partners.length,
    generatedPartners: texture.partners.length,
  };
}
