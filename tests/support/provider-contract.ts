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
import { LIST_DEFAULTS, LumanuQueryError } from '@/providers/lumanu-provider';

import { expectMatchesLumanuSchema } from './lumanu-schema';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

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
  });
}
