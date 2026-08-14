/**
 * The same contract suite again, this time against Lumanu itself.
 *
 * There is no third suite here. `describeLumanuProviderContract` is the one
 * written for `InMemoryLumanuProvider` and run unchanged against
 * `MockLumanuProvider`; this file adds a third subject and nothing else. That
 * is what "the real provider drops in unchanged" has to mean to be worth
 * claiming — if satisfying Lumanu had needed its own assertions, the interface
 * would have been shaped around the mock rather than around Lumanu.
 *
 * **It skips.** Lumanu issues credentials on request only, with no self-serve
 * signup, and this project has none. The file is here so that obtaining an
 * account is the entire remaining step: fill in the environment and the suite
 * runs.
 *
 * **It covers the reads only, and will not grow to cover the writes.** `reset`
 * is omitted, so the shared write block skips rather than running its tests in
 * whatever order they happen to be declared — a write suite whose tests inherit
 * each other's leftovers proves nothing about either implementation. Restoring
 * a Lumanu sandbox to a known state is not something this project can do, and
 * the write tests name the canonical Acme records by id, which a sandbox will
 * not hold. So approving, cancelling and funding against Lumanu stay unproven,
 * and this comment is where that is admitted rather than left to be discovered
 * from a skipped test.
 */

import { config as loadDotenv } from 'dotenv';

import { loadLumanuApiConfig } from '@/config';
import { RealLumanuProvider } from '@/providers/real';

import { describeLumanuProviderContract } from '../support/provider-contract';

loadDotenv({ quiet: true });

/**
 * The sandbox's own identifiers. The canonical Acme scenario is this project's
 * fixture, not Lumanu's, so nothing here can be assumed — a real sandbox holds
 * whatever it holds.
 */
const KNOWN = {
  workspaceId: process.env['LUMANU_WORKSPACE_ID'],
  projectId: process.env['LUMANU_PROJECT_ID'],
  partnerId: process.env['LUMANU_PARTNER_ID'],
  payableId: process.env['LUMANU_PAYABLE_ID'],
};

/**
 * Everything `loadLumanuApiConfig` requires, not only the credentials. A guard
 * that checked less would let a half-filled environment run the suite and fail
 * every test in `beforeAll` on a configuration error — which reads as "Lumanu
 * is broken" rather than "you have not finished setting this up".
 */
const CREDENTIALS = [
  'LUMANU_API_BASE_URL',
  'LUMANU_TOKEN_URL',
  'LUMANU_CLIENT_ID',
  'LUMANU_CLIENT_SECRET',
];

const configured =
  CREDENTIALS.every((key) => Boolean(process.env[key])) && Object.values(KNOWN).every(Boolean);

if (configured) {
  // Every call crosses the public internet to Lumanu.
  jest.setTimeout(120_000);

  describeLumanuProviderContract('RealLumanuProvider', {
    create: () => new RealLumanuProvider(loadLumanuApiConfig()),
    knownWorkspaceId: KNOWN.workspaceId!,
    knownProjectId: KNOWN.projectId!,
    knownPartnerId: KNOWN.partnerId!,
    knownPayableId: KNOWN.payableId!,
  });
} else {
  describe('RealLumanuProvider contract', () => {
    it.skip('needs Lumanu sandbox credentials, which are issued on request only', () => undefined);
  });
}

/**
 * Runs either way, because it is about this file rather than about Lumanu.
 *
 * The guard above decides between skipping and running. If it named fewer
 * variables than the provider actually needs, a half-filled environment would
 * run the suite and fail every test in `beforeAll` on a configuration error —
 * which reads as "Lumanu is broken" rather than "you have not finished setting
 * this up". So the list is held to being both sufficient and minimal.
 */
describe('the guard on this suite', () => {
  const filled = Object.fromEntries(CREDENTIALS.map((key) => [key, 'set']));

  it('names exactly what the provider will ask the environment for', () => {
    expect(() => loadLumanuApiConfig(filled)).not.toThrow();

    for (const key of CREDENTIALS) {
      const { [key]: _omitted, ...incomplete } = filled;

      expect(() => loadLumanuApiConfig(incomplete)).toThrow(key);
    }
  });
});
