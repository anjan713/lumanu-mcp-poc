/**
 * The same contract suite as `tests/in-memory-provider.test.ts`, run against
 * the provider that talks to a real database. That the two suites are the same
 * suite is the point — it is what makes the swap claim evidence rather than
 * prose.
 *
 * Skipped when the data layer is not configured, so a fresh clone stays green.
 * Run `npm run db:reset` first.
 */

import { config as loadDotenv } from 'dotenv';

import { applySeed } from '../../scripts/db/apply-seed';
import { connect } from '../../scripts/db/connect';
import { loadDataLayerConfig, loadHasuraConfig } from '@/config';
import {
  LumanuInsufficientBalanceError,
  LumanuInvalidStateError,
} from '@/providers/lumanu-provider';
import { MockLumanuProvider } from '@/providers/mock';
import type { LumanuProvider } from '@/providers/lumanu-provider';
import { CANONICAL, IDS } from '@/seed/canonical';

import { describeLumanuProviderContract } from '../support/provider-contract';

loadDotenv({ quiet: true });

const configured = Boolean(
  process.env['HASURA_GRAPHQL_ENDPOINT'] && process.env['HASURA_ADMIN_SECRET'],
);

/** Reseeds the database, so each write test starts from the canonical scenario. */
async function reseed(): Promise<void> {
  const { client } = await connect();
  try {
    await applySeed(client);
  } finally {
    await client.end();
  }
}

/** Reads directly, for the things Lumanu publishes no endpoint for. */
async function queryRows<Row extends Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const { client } = await connect();
  try {
    return (await client.query<Row>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

if (configured) {
  // Each write test reseeds over the network before it runs, which is slower
  // than any in-process suite and is the price of testing the real thing.
  jest.setTimeout(120_000);

  describeLumanuProviderContract('MockLumanuProvider', {
    create: () => new MockLumanuProvider(loadHasuraConfig()),
    dispose: (provider: LumanuProvider) => (provider as MockLumanuProvider).dispose(),
    knownWorkspaceId: CANONICAL.workspace.id,
    knownProjectId: CANONICAL.project.id,
    knownPartnerId: IDS.maya,
    knownPayableId: IDS.mayaPayable,
    reset: async () => {
      await reseed();
      return new MockLumanuProvider(loadHasuraConfig());
    },
  });

  describe('MockLumanuProvider specifics', () => {
    let provider: MockLumanuProvider;

    beforeEach(async () => {
      await reseed();
      provider = new MockLumanuProvider(loadHasuraConfig());
    });

    afterEach(async () => {
      await provider.dispose();
    });

    /**
     * The shared contract suite cannot assert this — see the note there. The
     * generated texture supplies the case: `scripts/db/texture.ts` never gives
     * a generated Partner `completed_w9`, so any generated Payable belongs to
     * someone who cannot be paid.
     */
    it('refuses to fund a Payable whose Partner has not completed onboarding', async () => {
      const [row] = await queryRows<{ id: string }>(
        `select p.id from payables p
           join partners pr on pr.id = p.partner_id
          where pr.status is distinct from 'completed_w9'
            and p.status = 'unapproved'
          limit 1`,
      );
      expect(row).toBeDefined();

      // Approved first, so that approval cannot be what the rejection is about.
      // Asserted rather than swallowed: if this failed, the funding below would
      // still reject and the test would pass for the wrong reason.
      expect((await provider.approvePayable(row!.id)).status).toBe('approved');

      const error = await provider
        .createFunding({
          workspace_id: CANONICAL.workspace.id,
          method: 'balance',
          payable_ids: [row!.id],
        })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      expect(error).toBeInstanceOf(LumanuInvalidStateError);
      // The Partner is what is wrong, not the Payable — `invalid_state` alone
      // would not distinguish this from "not approved".
      expect((error as LumanuInvalidStateError).resource).toBe('Partner');
    });

    /**
     * The shortfall branch cannot be reached from canonical data through the
     * public interface: every approved Payable fits inside the $15,000 balance
     * and no write raises an amount or lowers the balance without funding
     * something. The balance is lowered directly so that the SQL branch is
     * exercised at all — without this it is dead code that no test reaches.
     */
    it('refuses a Funding the balance cannot cover, and writes nothing', async () => {
      await queryRows(
        `update workspaces set balance_cents = $1, available_balance_cents = $1 where id = $2`,
        [10_000, CANONICAL.workspace.id],
      );

      const error = await provider
        .createFunding({
          workspace_id: CANONICAL.workspace.id,
          method: 'balance',
          payable_ids: [IDS.mayaPayable],
        })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      expect(error).toBeInstanceOf(LumanuInsufficientBalanceError);
      expect((error as LumanuInsufficientBalanceError).required).toBe(250_000);
      expect((error as LumanuInsufficientBalanceError).available).toBe(10_000);

      const [after] = await queryRows<{ balance: string; fundings: string }>(
        `select w.balance_cents as balance, (select count(*) from fundings) as fundings
           from workspaces w where w.id = $1`,
        [CANONICAL.workspace.id],
      );
      expect(after).toEqual({ balance: '10000', fundings: '1' });
      expect((await provider.getPayable(IDS.mayaPayable)).status).toBe('approved');
    });

    /**
     * Passing the same Payable twice in one request. The loop decides what to
     * fund by looking for an existing Funding link, and none exists yet inside
     * the transaction — so without deduplication the amount is counted twice
     * and the unique constraint fires as an unhandled exception rather than as
     * an outcome row.
     */
    it('funds a Payable once even when it is named twice in the same request', async () => {
      const before = await provider.getWorkspaceBalance(CANONICAL.workspace.id);

      const funding = await provider.createFunding({
        workspace_id: CANONICAL.workspace.id,
        method: 'balance',
        payable_ids: [IDS.mayaPayable, IDS.mayaPayable],
      });

      expect(funding.amount).toBe(250_000);
      const after = await provider.getWorkspaceBalance(CANONICAL.workspace.id);
      expect((before.balance?.balance ?? 0) - (after.balance?.balance ?? 0)).toBe(250_000);
    });

    /**
     * The property a Hasura mutation could not have given us. Every guard runs
     * before the first write, inside one transaction, so a rejection leaves the
     * balance, the Payable statuses and the ledger agreeing with each other.
     */
    it('leaves the database consistent when a Funding is rejected part-way', async () => {
      const before = await provider.getWorkspaceBalance(CANONICAL.workspace.id);

      // Maya is fundable, Alex is not. A guard that ran after the debit would
      // leave the balance short with nothing to show for it.
      await expect(
        provider.createFunding({
          workspace_id: CANONICAL.workspace.id,
          method: 'balance',
          payable_ids: [IDS.mayaPayable, IDS.alexPayable],
        }),
      ).rejects.toThrow(LumanuInvalidStateError);

      const after = await provider.getWorkspaceBalance(CANONICAL.workspace.id);
      expect(after.balance?.balance).toBe(before.balance?.balance);
      expect((await provider.getPayable(IDS.mayaPayable)).status).toBe('approved');

      const [counts] = await queryRows<{ fundings: string; links: string }>(
        `select (select count(*) from fundings) as fundings,
                (select count(*) from funding_payables) as links`,
      );
      // Only the canonical StudioX Funding, and only its one link.
      expect(counts).toEqual({ fundings: '1', links: '1' });
    });

    it('writes an audit event for every state change', async () => {
      await provider.approvePayable(IDS.alexPayable);
      await provider.cancelPayable(IDS.alexPayable);
      await provider.createFunding({
        workspace_id: CANONICAL.workspace.id,
        method: 'balance',
        payable_ids: [IDS.mayaPayable],
      });

      const rows = await queryRows<{ event_type: string }>(
        'select event_type from audit_events order by created_at',
      );

      expect(rows.map((row) => row.event_type)).toEqual([
        'payable.approved',
        'payable.canceled',
        'funding.created',
      ]);
    });

    it('records the Funding, its links and its Balance Transaction together', async () => {
      await provider.createFunding({
        workspace_id: CANONICAL.workspace.id,
        method: 'balance',
        payable_ids: [IDS.mayaPayable],
      });

      const [row] = await queryRows<{ funding_id: string; ending: string; events: string }>(
        `select bt.funding_id, bt.ending_balance_cents as ending,
                (select count(*) from audit_events where event_type = 'funding.created') as events
           from balance_transactions bt
          where bt.type = 'payment'
          order by bt.created_at desc
          limit 1`,
      );

      expect(row?.funding_id).toBeTruthy();
      expect(row?.ending).toBe(String(CANONICAL.workspace.balance_cents - 250_000));
      expect(row?.events).toBe('1');
    });

    it('leaves the database as it found it', async () => {
      await reseed();
      const account = await provider.getWorkspaceBalance(CANONICAL.workspace.id);

      expect(account.balance?.balance).toBe(CANONICAL.workspace.balance_cents);
      expect(loadDataLayerConfig().databaseUrl).toContain('5432');
    });
  });
} else {
  describe('MockLumanuProvider contract', () => {
    it.skip('needs Hasura credentials', () => undefined);
  });
}
