/**
 * Writes the canonical Acme scenario into Supabase.
 *
 *   npm run db:seed
 *
 * Wipes the data tables first, so this is repeatable and a demo can be re-run
 * after mutations. The scenario itself lives in `src/seed/canonical.ts`, and the
 * writing lives in `apply-seed.ts` — this file only supplies a connection and
 * prints what happened.
 *
 * Faker adds a handful of extra Partners and Payables for texture, seeded so
 * the result is identical every time. The texture is constrained so it cannot
 * disturb the figures the demo turns on: generated Partners are never
 * `completed_w9` and generated Payables are never `approved`, so nothing
 * generated can enter the ready-to-fund total. It introduces no second
 * Workspace, no second Project and no other funding model.
 */

import { CANONICAL } from '../../src/seed/canonical';

import { applySeed } from './apply-seed';
import { connect, run } from './connect';

run(async () => {
  const { client } = await connect();

  try {
    const report = await applySeed(client, (table, rows) => {
      console.log(`  seeded  ${String(rows).padStart(2)}  ${table}`);
    });

    console.log(
      `\nAcme US seeded: $${(CANONICAL.workspace.balance_cents / 100).toLocaleString('en-US')} ` +
        `balance, ${report.canonicalPartners} canonical Partners ` +
        `plus ${report.generatedPartners} generated for texture.`,
    );
  } finally {
    await client.end();
  }
});
