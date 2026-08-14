/**
 * One contract suite, run against every `LumanuProvider` implementation.
 *
 * This is the project's central claim made testable. `InMemoryLumanuProvider`
 * and `MockLumanuProvider` are held to the same standard here, and
 * `RealLumanuProvider` drops in unchanged when Lumanu sandbox credentials
 * exist. If the mock can genuinely be swapped for the real thing, this suite
 * passes against both without modification; if it cannot, this is where that
 * shows up.
 *
 * Every assertion is about **external behaviour** — the shape and content of
 * what comes back. Nothing here knows whether the answer came from a fixture,
 * from Hasura, or from Lumanu, and nothing asserts that a particular method
 * was called or that a query had a given form.
 *
 * Where Lumanu publishes a schema, responses are validated against it, so a
 * provider cannot satisfy this suite by inventing a plausible shape.
 */

import type { LumanuProvider } from '@/providers/lumanu-provider';
import {
  LIST_DEFAULTS,
  LumanuInsufficientBalanceError,
  LumanuInvalidInputError,
  LumanuInvalidStateError,
  LumanuNotFoundError,
  LumanuQueryError,
} from '@/providers/lumanu-provider';
import { dollars, IDS } from '@/seed/canonical';

import { expectMatchesLumanuSchema } from './lumanu-schema';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const DOLLARS_2500 = dollars(2_500);
const DOLLARS_5000 = dollars(5_000);
const DOLLARS_10000 = dollars(10_000);
const DOLLARS_15000 = dollars(15_000);

export interface ContractSubject {
  /** Builds the provider under test. */
  readonly create: () => LumanuProvider | Promise<LumanuProvider>;
  /** Cleans up connections, if the implementation opens any. */
  readonly dispose?: (provider: LumanuProvider) => Promise<void>;
  /** Records this provider is known to hold. */
  readonly knownWorkspaceId: string;
  readonly knownProjectId: string;
  /** A Partner who has completed onboarding, and so carries a Lumanu id. */
  readonly knownPartnerId: string;
  readonly knownPayableId: string;
  /**
   * Restores the scenario, so the write tests each start from a known state.
   *
   * Without it the mutating tests are skipped rather than run in whatever order
   * they happen to be declared, because a write suite that depends on the
   * previous test's leftovers proves nothing about either implementation.
   */
  readonly reset?: () => Promise<LumanuProvider>;
}

/**
 * @param name  How this implementation is named in test output.
 * @param subject  How to build it, and what it is known to contain.
 */
export function describeLumanuProviderContract(name: string, subject: ContractSubject): void {
  describe(`${name} — LumanuProvider contract`, () => {
    let provider: LumanuProvider;

    beforeAll(async () => {
      provider = await subject.create();
    });

    afterAll(async () => {
      await subject.dispose?.(provider);
    });

    describe('listWorkspaces', () => {
      it("returns Lumanu's envelope, not a bare array", async () => {
        const result = await provider.listWorkspaces();

        expect(Array.isArray(result)).toBe(false);
        expect(Object.keys(result).sort()).toEqual(['data', 'limit', 'offset', 'total']);
        expect(Array.isArray(result.data)).toBe(true);
      });

      it('returns Workspaces that validate against Lumanu’s published schema', async () => {
        const { data } = await provider.listWorkspaces();

        expect(data?.length).toBeGreaterThan(0);
        for (const workspace of data ?? []) {
          expectMatchesLumanuSchema('Workspace', workspace);
        }
      });

      it('uses snake_case field names, as Lumanu does', async () => {
        const [workspace] = (await provider.listWorkspaces()).data ?? [];

        expect(workspace).toHaveProperty('display_name');
        expect(workspace).not.toHaveProperty('displayName');
      });

      it('does not put the Workspace Balance on the Workspace, because Lumanu does not', async () => {
        const [workspace] = (await provider.listWorkspaces()).data ?? [];

        expect(workspace).not.toHaveProperty('balance');
        expect(workspace).not.toHaveProperty('balance_cents');
        expect(workspace).not.toHaveProperty('available_balance');
      });

      it('applies Lumanu’s paging defaults when none are given', async () => {
        const result = await provider.listWorkspaces();

        expect(result.limit).toBe(LIST_DEFAULTS.limit);
        expect(result.offset).toBe(LIST_DEFAULTS.offset);
      });

      it('echoes the paging it was asked for', async () => {
        const result = await provider.listWorkspaces({ limit: 1, offset: 0 });

        expect(result.limit).toBe(1);
        expect(result.offset).toBe(0);
        expect(result.data?.length).toBeLessThanOrEqual(1);
      });

      it('reports the total independently of the page size', async () => {
        const full = await provider.listWorkspaces();
        const paged = await provider.listWorkspaces({ limit: 1 });

        expect(paged.total).toBe(full.total);
      });

      it('returns an empty page rather than failing when the offset is past the end', async () => {
        const { total } = await provider.listWorkspaces();
        const beyond = await provider.listWorkspaces({ offset: (total ?? 0) + 10 });

        expect(beyond.data).toEqual([]);
        expect(beyond.total).toBe(total);
      });

      it('identifies Workspaces with a stable identifier', async () => {
        const first = await provider.listWorkspaces();
        const second = await provider.listWorkspaces();

        expect(first.data?.map((row) => row.id)).toEqual(second.data?.map((row) => row.id));
      });
    });

    describe('getWorkspace', () => {
      it('returns one Workspace, not an envelope', async () => {
        const workspace = await provider.getWorkspace(subject.knownWorkspaceId);

        expect(workspace).not.toHaveProperty('data');
        expect(workspace.id).toBe(subject.knownWorkspaceId);
      });

      it('returns a Workspace that validates against Lumanu’s published schema', async () => {
        expectMatchesLumanuSchema(
          'Workspace',
          await provider.getWorkspace(subject.knownWorkspaceId),
        );
      });

      it('agrees with what listWorkspaces reported for the same Workspace', async () => {
        const listed = (await provider.listWorkspaces()).data?.find(
          (row) => row.id === subject.knownWorkspaceId,
        );

        expect(await provider.getWorkspace(subject.knownWorkspaceId)).toEqual(listed);
      });

      it('preserves null where Lumanu documents a nullable field', async () => {
        const workspace = await provider.getWorkspace(subject.knownWorkspaceId);

        // Fees are unset in this scenario. Null must survive as null rather
        // than becoming 0 or undefined — the three mean different things.
        expect(workspace.funding_fee_percent).toBeNull();
        expect(workspace.additive_funding_fee).toBeNull();
      });

      it('rejects an unknown identifier rather than returning an empty object', async () => {
        await expect(provider.getWorkspace(MISSING_ID)).rejects.toThrow();
      });
    });

    describe('ordering', () => {
      it('applies the same default order to every implementation', async () => {
        const { data } = await provider.listPartners(subject.knownWorkspaceId);
        const timestamps = (data ?? []).map((partner) => partner.created_at ?? '');

        expect(timestamps).toEqual([...timestamps].sort());
      });

      it('orders by a named field', async () => {
        const { data } = await provider.listPartners(subject.knownWorkspaceId, {
          order_by: 'name',
        });
        const names = (data ?? []).map((partner) => partner.name ?? '');

        expect(names).toEqual([...names].sort());
      });

      it('reverses on request', async () => {
        const ascending = await provider.listPartners(subject.knownWorkspaceId, {
          order_by: 'name',
        });
        const descending = await provider.listPartners(subject.knownWorkspaceId, {
          order_by: 'name',
          order_by_direction: 'desc',
        });

        expect(descending.data?.map((partner) => partner.name)).toEqual(
          ascending.data?.map((partner) => partner.name).reverse(),
        );
      });

      /**
       * Silently ignoring an unsupported order would leave a caller who asked
       * for one with no way to notice they did not get it — and the fixture and
       * the database would be free to disagree about what "ignored" means.
       */
      it('refuses an order it cannot honour rather than ignoring it', async () => {
        await expect(
          provider.listPartners(subject.knownWorkspaceId, { order_by: 'salary' }),
        ).rejects.toThrow(LumanuQueryError);
      });
    });

    describe('listPartners', () => {
      it("returns Lumanu's envelope of Partners", async () => {
        const result = await provider.listPartners(subject.knownWorkspaceId);

        expect(Object.keys(result).sort()).toEqual(['data', 'limit', 'offset', 'total']);
        expect(result.data?.length).toBeGreaterThan(0);
      });

      it('returns Partners that validate against Lumanu’s published schema', async () => {
        const { data } = await provider.listPartners(subject.knownWorkspaceId);

        for (const partner of data ?? []) {
          expectMatchesLumanuSchema('Partner', partner);
        }
      });

      /**
       * One field covering onboarding and tax state together, never two. A
       * provider that split them would be inventing a model Lumanu does not
       * publish, and the reasoning in later tickets keys off this one value.
       */
      it('carries a single combined onboarding and tax status', async () => {
        const [partner] = (await provider.listPartners(subject.knownWorkspaceId)).data ?? [];

        expect(partner).toHaveProperty('status');
        expect(partner).not.toHaveProperty('onboarding_status');
        expect(partner).not.toHaveProperty('tax_status');
      });

      /**
       * A list has a coherent empty representation, so an unknown Workspace
       * gets one rather than a failure. The single-resource reads are the ones
       * that must fail — see the note on `LumanuNotFoundError`. Both
       * implementations were caught disagreeing about this here.
       */
      it('returns an empty page for a Workspace that holds nothing', async () => {
        const result = await provider.listPartners(MISSING_ID);

        expect(result.data).toEqual([]);
        expect(result.total).toBe(0);
      });

      it('scopes Partners to the Workspace asked for', async () => {
        const { data } = await provider.listPartners(subject.knownWorkspaceId);
        const elsewhere = await provider.listPartners(MISSING_ID);

        expect(data?.length).toBeGreaterThan(0);
        expect(elsewhere.data).toEqual([]);
      });

      it('pages independently of the total', async () => {
        const full = await provider.listPartners(subject.knownWorkspaceId);
        const paged = await provider.listPartners(subject.knownWorkspaceId, { limit: 1 });

        expect(paged.total).toBe(full.total);
        expect(paged.data?.length).toBe(1);
      });
    });

    describe('getPartner', () => {
      it('returns the detail Lumanu adds on top of a Partner', async () => {
        const partner = await provider.getPartner(
          subject.knownWorkspaceId,
          subject.knownPartnerId,
        );

        expectMatchesLumanuSchema('PartnerDetail', partner);
        expect(partner.id).toBe(subject.knownPartnerId);
        expect(typeof partner.payables_count).toBe('number');
      });

      it('agrees with what listPartners reported for the same Partner', async () => {
        const listed = (await provider.listPartners(subject.knownWorkspaceId)).data?.find(
          (row) => row.id === subject.knownPartnerId,
        );
        const fetched = await provider.getPartner(
          subject.knownWorkspaceId,
          subject.knownPartnerId,
        );

        expect(fetched.name).toBe(listed?.name);
        expect(fetched.status).toBe(listed?.status);
      });

      it('rejects a Partner that belongs to another Workspace', async () => {
        await expect(provider.getPartner(MISSING_ID, subject.knownPartnerId)).rejects.toThrow();
      });

      it('rejects an unknown Partner', async () => {
        await expect(
          provider.getPartner(subject.knownWorkspaceId, MISSING_ID),
        ).rejects.toThrow();
      });
    });

    describe('listPayables', () => {
      it("returns Lumanu's envelope of Payables", async () => {
        const result = await provider.listPayables({ workspace_id: subject.knownWorkspaceId });

        expect(Object.keys(result).sort()).toEqual(['data', 'limit', 'offset', 'total']);
        expect(result.data?.length).toBeGreaterThan(0);
      });

      it('returns Payables that validate against Lumanu’s published schema', async () => {
        const { data } = await provider.listPayables({ workspace_id: subject.knownWorkspaceId });

        for (const payable of data ?? []) {
          expectMatchesLumanuSchema('Payable', payable);
        }
      });

      /**
       * Lumanu's Payable has no `partner_id`. It names the Partner by display
       * name, email and Lumanu id instead. A provider that added an id would be
       * publishing a field `RealLumanuProvider` could never produce.
       */
      it('names the Partner the way Lumanu does, without inventing a partner_id', async () => {
        const [payable] = (await provider.listPayables({
          workspace_id: subject.knownWorkspaceId,
        })).data ?? [];

        expect(payable).not.toHaveProperty('partner_id');
        expect(typeof payable?.vendor_display_name).toBe('string');
      });

      it('states amounts as integers in the denomination it names', async () => {
        const [payable] = (await provider.listPayables({
          workspace_id: subject.knownWorkspaceId,
        })).data ?? [];

        expect(Number.isInteger(payable?.amount)).toBe(true);
        expect(payable?.amount_denomination).toBe('us_cents');
      });

      it('filters by Project', async () => {
        const all = await provider.listPayables({ workspace_id: subject.knownWorkspaceId });
        const scoped = await provider.listPayables({ project_id: subject.knownProjectId });

        expect(scoped.data?.length).toBeGreaterThan(0);
        expect(scoped.total).toBeLessThanOrEqual(all.total ?? 0);
        for (const payable of scoped.data ?? []) {
          expect(payable.project_id).toBe(subject.knownProjectId);
        }
      });

      /**
       * Deliberately absent from the provider. Lumanu publishes no status
       * filter on this endpoint, so offering one here would be a promise
       * `RealLumanuProvider` could not keep — the filtering happens above.
       */
      it('offers no status filter, because Lumanu publishes none', async () => {
        const unfiltered = await provider.listPayables({
          workspace_id: subject.knownWorkspaceId,
        });
        const statuses = new Set((unfiltered.data ?? []).map((payable) => payable.status));

        expect(statuses.size).toBeGreaterThan(1);
      });
    });

    describe('getPayable', () => {
      it('returns one Payable, not an envelope', async () => {
        const payable = await provider.getPayable(subject.knownPayableId);

        expectMatchesLumanuSchema('Payable', payable);
        expect(payable).not.toHaveProperty('data');
        expect(payable.id).toBe(subject.knownPayableId);
      });

      it('rejects an unknown Payable', async () => {
        await expect(provider.getPayable(MISSING_ID)).rejects.toThrow();
      });
    });

    describe('listProjects and getProject', () => {
      it('returns Projects that validate against Lumanu’s published schema', async () => {
        const { data } = await provider.listProjects(subject.knownWorkspaceId);

        expect(data?.length).toBeGreaterThan(0);
        for (const project of data ?? []) {
          expectMatchesLumanuSchema('Project', project);
        }
      });

      it('returns the detail Lumanu adds on top of a Project', async () => {
        const project = await provider.getProject(
          subject.knownWorkspaceId,
          subject.knownProjectId,
        );

        expectMatchesLumanuSchema('ProjectDetail', project);
        expect(project.id).toBe(subject.knownProjectId);
      });

      it('rejects an unknown Project', async () => {
        await expect(
          provider.getProject(subject.knownWorkspaceId, MISSING_ID),
        ).rejects.toThrow();
      });
    });

    describe('getWorkspaceBalance', () => {
      it('returns the Workspace Balance as an Account, which is where Lumanu puts it', async () => {
        const account = await provider.getWorkspaceBalance(subject.knownWorkspaceId);

        expectMatchesLumanuSchema('Account', account);
        expect(account).not.toHaveProperty('data');
      });

      /**
       * Two figures, not one. `available_balance` is what may actually be
       * committed, and it is the one funding decisions are measured against —
       * a provider that collapsed them into a single number would make every
       * later capacity answer wrong in exactly the cases that matter.
       */
      it('reports both what is held and what may be committed', async () => {
        const { balance } = await provider.getWorkspaceBalance(subject.knownWorkspaceId);

        expect(typeof balance?.balance).toBe('number');
        expect(typeof balance?.available_balance).toBe('number');
      });

      it('states the denomination rather than leaving the unit implicit', async () => {
        const account = await provider.getWorkspaceBalance(subject.knownWorkspaceId);

        expect(account.denomination).toBe('us_cents');
      });

      it('rejects an unknown Workspace', async () => {
        await expect(provider.getWorkspaceBalance(MISSING_ID)).rejects.toThrow();
      });
    });

    describe('listBalanceTransactions', () => {
      it('returns Balance Transactions that validate against Lumanu’s published schema', async () => {
        const { data } = await provider.listBalanceTransactions(subject.knownWorkspaceId);

        expect(data?.length).toBeGreaterThan(0);
        for (const transaction of data ?? []) {
          expectMatchesLumanuSchema('Transaction', transaction);
        }
      });

      /**
       * Each row carries the balance it left behind, so the history reads
       * without re-summing it — and so a reader can see how the balance
       * reached its current figure from the rows alone.
       */
      it('carries the running balance on every row', async () => {
        const { data } = await provider.listBalanceTransactions(subject.knownWorkspaceId);

        for (const transaction of data ?? []) {
          expect(typeof transaction.ending_balance).toBe('number');
          expect(typeof transaction.balance_change).toBe('number');
        }
      });

      it('filters by transaction type, which Lumanu does publish', async () => {
        const all = await provider.listBalanceTransactions(subject.knownWorkspaceId);
        const payments = await provider.listBalanceTransactions(subject.knownWorkspaceId, {
          type: 'payment',
        });

        expect(payments.total).toBeLessThan(all.total ?? 0);
        for (const transaction of payments.data ?? []) {
          expect(transaction.type).toBe('payment');
        }
      });

      it('agrees with the Workspace Balance about where the history ends', async () => {
        const account = await provider.getWorkspaceBalance(subject.knownWorkspaceId);
        const { data } = await provider.listBalanceTransactions(subject.knownWorkspaceId, {
          order_by: 'created_at',
          order_by_direction: 'desc',
        });

        expect(data?.[0]?.ending_balance).toBe(account.balance?.balance);
      });

      it('returns an empty history for a Workspace that holds nothing', async () => {
        const result = await provider.listBalanceTransactions(MISSING_ID);

        expect(result.data).toEqual([]);
        expect(result.total).toBe(0);
      });
    });

    describeWrites(subject);
  });
}

/**
 * The write half of the contract.
 *
 * Every test starts from a freshly restored scenario, because these mutate and
 * a suite whose tests depend on each other's leftovers proves nothing. The
 * canonical Partners are used by name: Maya is onboarded with an approved
 * Payable, Alex is onboarded with an unapproved one, Sarah is not onboarded,
 * and StudioX has already been funded.
 */
function describeWrites(subject: ContractSubject): void {
  const restore = subject.reset;

  if (restore === undefined) {
    describe('writes', () => {
      it.skip('needs a reset hook, so that each test starts from a known state', () => undefined);
    });
    return;
  }

  describe('writes', () => {
    let provider: LumanuProvider;

    beforeEach(async () => {
      provider = await restore();
    });

    describe('approvePayable', () => {
      it('moves an unapproved Payable to approved and returns the new state', async () => {
        const payable = await provider.approvePayable(IDS.alexPayable);

        expect(payable.status).toBe('approved');
        expect(payable.id).toBe(IDS.alexPayable);
        // Returned rather than requiring a second read to find out.
        expect((await provider.getPayable(IDS.alexPayable)).status).toBe('approved');
      });

      it('rejects a Payable that has already been funded', async () => {
        await expect(provider.approvePayable(IDS.studioXPayable)).rejects.toThrow(
          LumanuInvalidStateError,
        );
      });

      it('rejects a Payable that is already approved', async () => {
        await expect(provider.approvePayable(IDS.mayaPayable)).rejects.toThrow(
          LumanuInvalidStateError,
        );
      });

      it('rejects an unknown Payable as not found, not as invalid state', async () => {
        await expect(provider.approvePayable(MISSING_ID)).rejects.toThrow(LumanuNotFoundError);
      });

      it('leaves the Payable untouched when it rejects', async () => {
        await expect(provider.approvePayable(IDS.studioXPayable)).rejects.toThrow();

        expect((await provider.getPayable(IDS.studioXPayable)).status).toBe('will_pay');
      });
    });

    describe('cancelPayable', () => {
      it('withdraws an unapproved obligation and returns the new state', async () => {
        const payable = await provider.cancelPayable(IDS.alexPayable);

        expect(payable.status).toBe('canceled');
      });

      it('withdraws an approved but unfunded obligation', async () => {
        expect((await provider.cancelPayable(IDS.mayaPayable)).status).toBe('canceled');
      });

      /**
       * The money has already left the Workspace Balance. Cancelling would
       * unwind a commitment with no corresponding credit, so the balance and
       * the Payable would stop agreeing with each other.
       */
      it('refuses to cancel a funded Payable, so committed money is not silently unwound', async () => {
        await expect(provider.cancelPayable(IDS.studioXPayable)).rejects.toThrow(
          LumanuInvalidStateError,
        );
      });

      it('rejects an unknown Payable as not found', async () => {
        await expect(provider.cancelPayable(MISSING_ID)).rejects.toThrow(LumanuNotFoundError);
      });
    });

    describe('createFunding', () => {
      const fund = (payableIds: string[]): Promise<unknown> =>
        provider.createFunding({
          workspace_id: subject.knownWorkspaceId,
          method: 'balance',
          payable_ids: payableIds,
        });

      it('draws from the Workspace Balance and moves the Payable to will_pay', async () => {
        const before = await provider.getWorkspaceBalance(subject.knownWorkspaceId);

        await fund([IDS.mayaPayable]);

        const after = await provider.getWorkspaceBalance(subject.knownWorkspaceId);
        expect((after.balance?.balance ?? 0) - (before.balance?.balance ?? 0)).toBe(-DOLLARS_2500);
        expect((await provider.getPayable(IDS.mayaPayable)).status).toBe('will_pay');
      });

      it('returns a Funding that validates against Lumanu’s published schema', async () => {
        const funding = await fund([IDS.mayaPayable]);

        expectMatchesLumanuSchema('Funding', funding);
        expect((funding as { amount?: number }).amount).toBe(DOLLARS_2500);
      });

      it('records a Balance Transaction explaining the movement', async () => {
        await fund([IDS.mayaPayable]);

        const { data } = await provider.listBalanceTransactions(subject.knownWorkspaceId, {
          order_by: 'created_at',
          order_by_direction: 'desc',
        });
        const [latest] = data ?? [];

        expect(latest?.type).toBe('payment');
        expect(latest?.balance_change).toBe(-DOLLARS_2500);
        expect(latest?.description).toContain('Maya');
      });

      it('rejects the whole request when any Payable is unapproved', async () => {
        await expect(fund([IDS.mayaPayable, IDS.alexPayable])).rejects.toThrow(
          LumanuInvalidStateError,
        );
      });

      /**
       * The Partner-status rejection is **not** asserted here.
       *
       * It needs a Payable belonging to a Partner who has not completed
       * onboarding, and the canonical scenario has none — Sarah Chen is the
       * un-onboarded Partner and she deliberately has no Payable at all. No
       * write in this interface can create one, so the case cannot be reached
       * through the public API from canonical data.
       *
       * Both implementations are covered, separately: `in-memory-provider.test`
       * constructs the scenario directly, and `integration/mock-provider.test`
       * uses a generated Payable, whose Partner is never `completed_w9` by
       * construction. Asserting it here with a Partner who *is* onboarded would
       * have been a test that passes without exercising the rule.
       */
      it('rejects the whole request when a Payable was cancelled', async () => {
        await provider.cancelPayable(IDS.alexPayable);

        await expect(fund([IDS.mayaPayable, IDS.alexPayable])).rejects.toThrow(
          LumanuInvalidStateError,
        );
      });

      it('leaves every balance and status untouched when it rejects', async () => {
        const before = await provider.getWorkspaceBalance(subject.knownWorkspaceId);

        await expect(fund([IDS.mayaPayable, IDS.alexPayable])).rejects.toThrow();

        const after = await provider.getWorkspaceBalance(subject.knownWorkspaceId);
        expect(after.balance?.balance).toBe(before.balance?.balance);
        expect((await provider.getPayable(IDS.mayaPayable)).status).toBe('approved');
      });

      /**
       * The shortfall rejection is **not** asserted here.
       *
       * Every approved Payable in the canonical scenario fits inside the
       * $15,000 balance — $2,500 and $7,500 together are $10,000 — and no write
       * in this interface can lower the balance without also funding something
       * or raise an amount above it. So the case cannot be reached through the
       * public API from canonical data.
       *
       * Both implementations are covered separately: `write-tools.test`
       * constructs a Workspace holding $100, and `integration/mock-provider.test`
       * lowers the balance directly and checks that the SQL branch rejects and
       * writes nothing. An earlier version of this test funded $10,000 against
       * $15,000 and asserted that it succeeded — under a name that said the
       * opposite.
       */
      it('rejects the whole request when a Partner in it is invalid, leaving the rest alone', async () => {
        await provider.cancelPayable(IDS.alexPayable);
        const before = await provider.getWorkspaceBalance(subject.knownWorkspaceId);

        await expect(fund([IDS.mayaPayable, IDS.alexPayable])).rejects.toThrow(
          LumanuInvalidStateError,
        );

        const after = await provider.getWorkspaceBalance(subject.knownWorkspaceId);
        expect(after.balance?.balance).toBe(before.balance?.balance);
      });

      it('reports the method it does not support before looking anything up', async () => {
        await expect(
          provider.createFunding({
            workspace_id: MISSING_ID,
            method: 'invoice',
            payable_ids: [MISSING_ID],
          }),
        ).rejects.toThrow(LumanuInvalidInputError);
      });

      /**
       * Idempotency is by state rather than by an idempotency key. A retried
       * request finds the Payable already linked to a Funding, funds nothing,
       * and debits nothing.
       */
      it('is a no-op on a Payable that is already funded, returning its existing Funding', async () => {
        const first = (await fund([IDS.mayaPayable])) as { id?: string };
        const balance = await provider.getWorkspaceBalance(subject.knownWorkspaceId);

        const second = (await fund([IDS.mayaPayable])) as { id?: string };

        expect(second.id).toBe(first.id);
        expect((await provider.getWorkspaceBalance(subject.knownWorkspaceId)).balance?.balance).toBe(
          balance.balance?.balance,
        );
      });

      it('never funds a Payable twice, so a retry cannot double-debit', async () => {
        await fund([IDS.studioXPayable]);

        const account = await provider.getWorkspaceBalance(subject.knownWorkspaceId);
        expect(account.balance?.balance).toBe(DOLLARS_15000);
      });

      it('funds only what needs funding in a mixed batch', async () => {
        const before = await provider.getWorkspaceBalance(subject.knownWorkspaceId);

        // StudioX is already funded; Maya is not. Only Maya is drawn for.
        await fund([IDS.studioXPayable, IDS.mayaPayable]);

        const after = await provider.getWorkspaceBalance(subject.knownWorkspaceId);
        expect((before.balance?.balance ?? 0) - (after.balance?.balance ?? 0)).toBe(DOLLARS_2500);
      });

      it('rejects an unknown Payable as not found', async () => {
        await expect(fund([MISSING_ID])).rejects.toThrow(LumanuNotFoundError);
      });

      it('rejects a request with no Payables as invalid input', async () => {
        await expect(fund([])).rejects.toThrow(LumanuInvalidInputError);
      });

      it('rejects invoice funding, which this POC does not model', async () => {
        await expect(
          provider.createFunding({
            workspace_id: subject.knownWorkspaceId,
            method: 'invoice',
            payable_ids: [IDS.mayaPayable],
          }),
        ).rejects.toThrow(LumanuInvalidInputError);
      });
    });

    describe('the demo sequence', () => {
      /**
       * The flow the README promises, asserted end to end: approve Alex, then
       * fund Maya and Alex together against the $15,000 balance.
       */
      it('approves Alex, then funds Maya and Alex for $10,000, leaving $5,000', async () => {
        await provider.approvePayable(IDS.alexPayable);

        const funding = (await provider.createFunding({
          workspace_id: subject.knownWorkspaceId,
          method: 'balance',
          payable_ids: [IDS.mayaPayable, IDS.alexPayable],
        })) as { amount?: number };

        expect(funding.amount).toBe(DOLLARS_10000);

        const account = await provider.getWorkspaceBalance(subject.knownWorkspaceId);
        expect(account.balance?.balance).toBe(DOLLARS_5000);
        expect(account.balance?.available_balance).toBe(DOLLARS_5000);
      });
    });
  });
}
