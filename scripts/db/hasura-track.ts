/**
 * Tracks the schema in Hasura and commits the resulting metadata.
 *
 *   npm run hasura:track
 *
 * Hasura is an internal data access layer, never exposed to MCP clients — the
 * admin secret reaches nothing above the provider boundary. Tracking is done
 * over the metadata API rather than the Hasura CLI so the toolchain stays to
 * what `npm install` provides.
 *
 * Relationships are declared explicitly rather than left to Hasura's
 * suggestions, because the provider's queries depend on their names: renaming
 * `partner` to `partnerByPartnerId` would break `MockLumanuProvider` with no
 * warning from the type system.
 *
 * The exported metadata is written to `hasura/metadata.json` and committed, so
 * the Hasura project can be rebuilt from the repository.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { callHasura, connect, run } from './connect';

const TABLES = [
  'workspaces',
  'projects',
  'partners',
  'payables',
  'fundings',
  'funding_payables',
  'balance_transactions',
  'audit_events',
];

/** `foreign_key_constraint_on` lets Hasura derive the join from the schema. */
type Relationship =
  | { kind: 'object'; table: string; name: string; column: string }
  | { kind: 'array'; table: string; name: string; from: string; column: string };

const RELATIONSHIPS: readonly Relationship[] = [
  { kind: 'object', table: 'projects', name: 'workspace', column: 'workspace_id' },
  { kind: 'object', table: 'partners', name: 'workspace', column: 'workspace_id' },
  { kind: 'object', table: 'payables', name: 'workspace', column: 'workspace_id' },
  { kind: 'object', table: 'payables', name: 'project', column: 'project_id' },
  // The one the provider leans on hardest: a Payable's wire format carries
  // vendor_email and vendor_display_name, which live on the Partner.
  { kind: 'object', table: 'payables', name: 'partner', column: 'partner_id' },
  { kind: 'object', table: 'fundings', name: 'workspace', column: 'workspace_id' },
  { kind: 'object', table: 'funding_payables', name: 'funding', column: 'funding_id' },
  { kind: 'object', table: 'funding_payables', name: 'payable', column: 'payable_id' },
  { kind: 'object', table: 'balance_transactions', name: 'workspace', column: 'workspace_id' },
  { kind: 'object', table: 'balance_transactions', name: 'funding', column: 'funding_id' },

  { kind: 'array', table: 'workspaces', name: 'projects', from: 'projects', column: 'workspace_id' },
  { kind: 'array', table: 'workspaces', name: 'partners', from: 'partners', column: 'workspace_id' },
  { kind: 'array', table: 'workspaces', name: 'payables', from: 'payables', column: 'workspace_id' },
  { kind: 'array', table: 'workspaces', name: 'fundings', from: 'fundings', column: 'workspace_id' },
  {
    kind: 'array',
    table: 'workspaces',
    name: 'balance_transactions',
    from: 'balance_transactions',
    column: 'workspace_id',
  },
  { kind: 'array', table: 'partners', name: 'payables', from: 'payables', column: 'partner_id' },
  { kind: 'array', table: 'projects', name: 'payables', from: 'payables', column: 'project_id' },
  {
    kind: 'array',
    table: 'fundings',
    name: 'funding_payables',
    from: 'funding_payables',
    column: 'funding_id',
  },
];

/** Metadata calls are idempotent in effect: already-applied is not a failure. */
const alreadyApplied = (error: unknown): boolean =>
  /already-tracked|already-exists|already exists/i.test(String(error));

run(async () => {
  const { client, config } = await connect();
  await client.end();

  for (const name of TABLES) {
    await callHasura(config, '/v1/metadata', {
      type: 'pg_track_table',
      args: { source: 'default', table: { schema: 'public', name } },
    }).catch((error: unknown) => {
      if (!alreadyApplied(error)) throw error;
    });
  }
  console.log(`  tracked  ${TABLES.length} tables`);

  for (const relationship of RELATIONSHIPS) {
    const using =
      relationship.kind === 'object'
        ? { foreign_key_constraint_on: relationship.column }
        : {
            foreign_key_constraint_on: {
              table: { schema: 'public', name: relationship.from },
              column: relationship.column,
            },
          };

    await callHasura(config, '/v1/metadata', {
      type: `pg_create_${relationship.kind}_relationship`,
      args: {
        source: 'default',
        table: { schema: 'public', name: relationship.table },
        name: relationship.name,
        using,
      },
    }).catch((error: unknown) => {
      if (!alreadyApplied(error)) {
        throw new Error(
          `${relationship.table}.${relationship.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
  }
  console.log(`  related  ${RELATIONSHIPS.length} relationships`);

  const exported = await callHasura(config, '/v1/metadata', {
    type: 'export_metadata',
    version: 2,
    args: {},
  });

  // The exported source configuration embeds the database URL, password and
  // all. Only the table and relationship metadata is committed.
  const metadata = exported['metadata'] as {
    sources?: Array<{ configuration?: unknown; [key: string]: unknown }>;
  };
  for (const source of metadata.sources ?? []) delete source['configuration'];

  const target = path.join(__dirname, '..', '..', 'hasura', 'metadata.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  console.log(`\nMetadata exported to hasura/metadata.json (connection details stripped).`);
});
