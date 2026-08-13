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
import { LIST_DEFAULTS } from '@/providers/lumanu-provider';

import { expectMatchesLumanuSchema } from './lumanu-schema';

export interface ContractSubject {
  /** Builds the provider under test. */
  readonly create: () => LumanuProvider | Promise<LumanuProvider>;
  /** Cleans up connections, if the implementation opens any. */
  readonly dispose?: (provider: LumanuProvider) => Promise<void>;
  /** A Workspace identifier this provider is known to hold. */
  readonly knownWorkspaceId: string;
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
        await expect(
          provider.getWorkspace('00000000-0000-4000-8000-000000000000'),
        ).rejects.toThrow();
      });
    });
  });
}
