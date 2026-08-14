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

import { loadHasuraConfig } from '@/config';
import { MockLumanuProvider } from '@/providers/mock';
import type { LumanuProvider } from '@/providers/lumanu-provider';
import { CANONICAL } from '@/seed/canonical';

import { describeLumanuProviderContract } from '../support/provider-contract';

loadDotenv({ quiet: true });

const configured = Boolean(
  process.env['HASURA_GRAPHQL_ENDPOINT'] && process.env['HASURA_ADMIN_SECRET'],
);

if (configured) {
  jest.setTimeout(30_000);

  describeLumanuProviderContract('MockLumanuProvider', {
    create: () => new MockLumanuProvider(loadHasuraConfig()),
    dispose: (provider: LumanuProvider) => (provider as MockLumanuProvider).dispose(),
    knownWorkspaceId: CANONICAL.workspace.id,
  });
} else {
  describe('MockLumanuProvider contract', () => {
    it.skip('needs Hasura credentials', () => undefined);
  });
}
